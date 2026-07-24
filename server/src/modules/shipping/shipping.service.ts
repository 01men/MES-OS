import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DocStatus } from '../../common/enums';
import { BizException } from '../../common/exceptions';
import { DocStatusMachine } from '../../common/doc-status.machine';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalEngineService } from '../../common/approval/approval.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { U8Adapter } from '../integration/u8-adapter';
import { SyncService } from '../integration/sync.service';
import { RuleConfigService } from '../config/rule-config.service';
import { Customer } from '../masterdata/entities/customer.entity';
import { DeliveryNote } from './entities/delivery-note.entity';
import { DeliveryNoteLine } from './entities/delivery-note-line.entity';
import { SerialNumber } from './entities/serial-number.entity';
import { ScanRecord } from './entities/scan-record.entity';
import { Shortage } from './entities/shortage.entity';
import { ShippingPhoto } from './entities/photo.entity';
import { ReversalDoc } from './entities/reversal-doc.entity';
import { checkFileIntegrity, parseUploadUrl } from './upload.util';

export const PHOTO_TYPES = ['CAR', 'SEAL', 'EMPTY', 'SIDE1', 'SIDE2', 'MARK'] as const;

export interface CreateNoteLineInput {
  orderNo?: string;
  productCode: string;
  qty: number;
  unit?: string;
}

export interface CreateNoteInput {
  customerCode: string;
  lines: CreateNoteLineInput[];
  loadingSequence?: string[];
}

export interface PhotoConfirmItem {
  photoType: string;
  url: string;
}

/**
 * 发运追溯链核心服务（REQ-022/023/025/026 + 纪要装柜顺序）。
 * 所有写路径：状态机迁移 + 审计（放行/少发/冲销）+ U8 同步（SALE_OUT）。
 */
@Injectable()
export class ShippingService {
  constructor(
    @InjectRepository(DeliveryNote)
    private readonly noteRepo: Repository<DeliveryNote>,
    @InjectRepository(DeliveryNoteLine)
    private readonly lineRepo: Repository<DeliveryNoteLine>,
    @InjectRepository(SerialNumber)
    private readonly serialRepo: Repository<SerialNumber>,
    @InjectRepository(ScanRecord)
    private readonly scanRepo: Repository<ScanRecord>,
    @InjectRepository(Shortage)
    private readonly shortageRepo: Repository<Shortage>,
    @InjectRepository(ShippingPhoto)
    private readonly photoRepo: Repository<ShippingPhoto>,
    @InjectRepository(ReversalDoc)
    private readonly reversalRepo: Repository<ReversalDoc>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectDataSource()
    private readonly ds: DataSource,
    private readonly adapter: U8Adapter,
    private readonly sync: SyncService,
    private readonly audit: AuditService,
    private readonly approval: ApprovalEngineService,
    private readonly numbering: NumberingService,
    private readonly ruleConfig: RuleConfigService,
  ) {}

  // ---------- REQ-022 发货通知 ----------

  /** 从 U8 增量拉取发货通知：dnNo 幂等，重复拉取不生成重复任务 */
  async pullNotes(since?: string, operator?: string) {
    const rows = await this.adapter.fetchDeliveryNotes(since);
    const created: string[] = [];
    const skipped: string[] = [];
    for (const row of rows ?? []) {
      const exists = await this.noteRepo.findOne({ where: { dnNo: row.dnNo } });
      if (exists) {
        skipped.push(row.dnNo);
        continue;
      }
      await this.createNoteInternal(
        {
          dnNo: row.dnNo,
          customerCode: row.customerCode,
          source: 'U8',
          u8UpdatedAt: row.updatedAt ?? null,
          lines: (row.lines ?? []).map((l: any) => ({
            orderNo: l.orderNo ?? row.dnNo,
            productCode: l.productCode,
            qty: l.qty,
            unit: l.unit ?? 'PCS',
          })),
          loadingSequence: null,
        },
        operator,
      );
      created.push(row.dnNo);
    }
    return { pulled: rows?.length ?? 0, created, skipped };
  }

  /** 销售在系统内创建发货请求（纪要：禁止微信群通知，必须走系统） */
  async createNote(input: CreateNoteInput, operator: string) {
    if (!input.lines?.length) {
      throw new BizException('NOTE_LINES_EMPTY', '发货明细不能为空');
    }
    const dnNo = await this.numbering.next('SHP');
    return this.createNoteInternal(
      {
        dnNo,
        customerCode: input.customerCode,
        source: 'SALES',
        u8UpdatedAt: null,
        lines: input.lines.map((l) => ({
          orderNo: l.orderNo ?? dnNo,
          productCode: l.productCode,
          qty: l.qty,
          unit: l.unit ?? 'PCS',
        })),
        loadingSequence: input.loadingSequence?.length
          ? JSON.stringify(input.loadingSequence)
          : null,
      },
      operator,
    );
  }

  private async createNoteInternal(
    data: {
      dnNo: string;
      customerCode: string;
      source: string;
      u8UpdatedAt: string | null;
      lines: { orderNo: string; productCode: string; qty: number; unit: string }[];
      loadingSequence: string | null;
    },
    operator?: string,
  ) {
    return this.ds.transaction(async (em) => {
      const customer = await em
        .getRepository(Customer)
        .findOne({ where: { customerCode: data.customerCode } });
      const note = await em.getRepository(DeliveryNote).save(
        em.getRepository(DeliveryNote).create({
          dnNo: data.dnNo,
          customerCode: data.customerCode,
          customerName: customer?.name ?? null,
          source: data.source,
          status: DocStatus.DRAFT,
          loadingSequence: data.loadingSequence,
          u8UpdatedAt: data.u8UpdatedAt,
        }),
      );
      let sort = 0;
      for (const l of data.lines) {
        await em.getRepository(DeliveryNoteLine).save(
          em.getRepository(DeliveryNoteLine).create({
            noteId: note.id,
            orderNo: l.orderNo,
            productCode: l.productCode,
            qty: l.qty,
            unit: l.unit,
            sortOrder: sort++,
          }),
        );
      }
      return note;
    });
  }

  async listNotes(status?: DocStatus) {
    const notes = await this.noteRepo.find({
      where: status ? { status } : {},
      order: { id: 'DESC' },
    });
    return Promise.all(notes.map((n) => this.noteSummary(n)));
  }

  async getNote(id: number) {
    const note = await this.mustGetNote(id);
    return this.noteSummary(note);
  }

  // ---------- 出库扫码（三重校验 + 装柜顺序） ----------

  async scan(noteId: number, serialNo: string, operator: string) {
    if (!serialNo) throw new BizException('SERIAL_REQUIRED', 'serialNo is required');
    const note = await this.mustGetNote(noteId);
    this.assertScannable(note);

    // 校验 1：序列号存在
    const serial = await this.serialRepo.findOne({ where: { serialNo } });
    if (!serial) {
      await this.violation(note, 'SERIAL_NOT_FOUND', serialNo, operator, '序列号不存在');
      throw new BizException('SERIAL_NOT_FOUND', `序列号 ${serialNo} 不存在`, 404);
    }

    // 校验 2：未在本单重复出库（返回原扫码时间/人员）
    const dup = await this.scanRepo.findOne({ where: { noteId, serialNo } });
    if (dup) {
      note.duplicateScanCount += 1;
      await this.noteRepo.save(note);
      await this.violation(note, 'DUPLICATE_SCAN', serialNo, operator, '重复扫描');
      throw new BizException(
        'DUPLICATE_SCAN',
        `序列号 ${serialNo} 已于 ${new Date(dup.scannedAt).toISOString()} 由 ${dup.operator} 扫入本单`,
      );
    }
    if (serial.status === 'SHIPPED') {
      await this.violation(note, 'SERIAL_ALREADY_SHIPPED', serialNo, operator, '序列号已出库');
      throw new BizException(
        'SERIAL_ALREADY_SHIPPED',
        `序列号 ${serialNo} 已随单 ${serial.shippedDnNo} 出库`,
      );
    }

    const lines = await this.lineRepo.find({ where: { noteId } });
    const scans = await this.scanRepo.find({ where: { noteId } });
    const scannedByLine = new Map<number, number>();
    for (const s of scans) {
      scannedByLine.set(s.lineId, (scannedByLine.get(s.lineId) ?? 0) + 1);
    }

    // 校验 3：属于当前客户订单（本单明细包含该成品）
    const line = lines.find((l) => l.productCode === serial.productCode);
    if (!line) {
      await this.violation(note, 'WRONG_ORDER', serialNo, operator, '归属错误：不属于本单客户订单');
      throw new BizException(
        'WRONG_ORDER',
        `序列号 ${serialNo}（${serial.productCode}）不属于本单客户订单`,
      );
    }

    // 超发阻止
    if ((scannedByLine.get(line.id) ?? 0) >= line.qty) {
      await this.violation(note, 'OVER_SHIP', serialNo, operator, '超发阻止');
      throw new BizException(
        'OVER_SHIP',
        `明细 ${line.orderNo}/${line.productCode} 应发 ${line.qty} 已扫满，禁止超发`,
      );
    }

    // 装柜顺序：有指定顺序按指定，否则按下单先后；前一订单未扫完不得扫下一订单
    const ordered = this.orderLines(lines, note.loadingSequence);
    const expected = ordered.find((l) => (scannedByLine.get(l.id) ?? 0) < l.qty);
    if (expected && line.id !== expected.id) {
      await this.violation(note, 'SEQUENCE_VIOLATION', serialNo, operator, '跳单/混扫阻止');
      throw new BizException(
        'SEQUENCE_VIOLATION',
        `装柜顺序错误：应先扫订单 ${expected.orderNo} 的 ${expected.productCode}` +
          `（还剩 ${expected.qty - (scannedByLine.get(expected.id) ?? 0)} 件），当前 ${serialNo} 属于 ${line.orderNo}`,
      );
    }

    const rec = await this.scanRepo.save(
      this.scanRepo.create({
        noteId,
        lineId: line.id,
        orderNo: line.orderNo,
        serialNo,
        productCode: serial.productCode,
        operator,
        scannedAt: new Date(),
      }),
    );
    const summary = await this.noteSummary(note);
    return { ...summary, lastScan: rec };
  }

  // ---------- REQ-023 拍照留证 ----------

  /** 照片确认：服务器端完整性校验通过才 CONFIRMED；fileName 唯一，重传不重复 */
  async confirmPhotos(noteId: number, items: PhotoConfirmItem[], operator: string) {
    const note = await this.mustGetNote(noteId);
    if (!items?.length) throw new BizException('PHOTOS_EMPTY', '照片清单不能为空');
    const confirmed: ShippingPhoto[] = [];
    const pending: { photoType: string; url: string; reason: string }[] = [];

    for (const item of items) {
      if (!PHOTO_TYPES.includes(item.photoType as any)) {
        throw new BizException('PHOTO_TYPE_INVALID', `未知照片类型 ${item.photoType}`);
      }
      const parsed = parseUploadUrl(item.url);
      if (!parsed) {
        pending.push({ photoType: item.photoType, url: item.url, reason: '非法 url' });
        continue;
      }
      // 重传不重复：同文件名直接复用已确认记录
      const existing = await this.photoRepo.findOne({ where: { fileName: parsed.name } });
      if (existing) {
        if (existing.status === 'CONFIRMED') confirmed.push(existing);
        continue;
      }
      const check = checkFileIntegrity(parsed.ym, parsed.name);
      const photo = await this.photoRepo.save(
        this.photoRepo.create({
          noteId,
          photoType: item.photoType,
          fileName: parsed.name,
          url: item.url,
          size: check.size,
          status: check.ok ? 'CONFIRMED' : 'PENDING',
          failReason: check.ok ? null : check.reason ?? null,
          uploadedBy: operator,
        }),
      );
      if (check.ok) confirmed.push(photo);
      else pending.push({ photoType: item.photoType, url: item.url, reason: check.reason! });
    }

    const allConfirmed = await this.photoRepo.find({ where: { noteId, status: 'CONFIRMED' } });
    const types = new Set(allConfirmed.map((p) => p.photoType));
    const missing = PHOTO_TYPES.filter((t) => !types.has(t));
    return {
      noteId,
      dnNo: note.dnNo,
      confirmed: confirmed.map((p) => ({ photoType: p.photoType, fileName: p.fileName, url: p.url })),
      pending,
      complete: missing.length === 0,
      missingTypes: missing,
    };
  }

  // ---------- REQ-025 放行（仓管员+司机双确认） ----------

  async release(
    noteId: number,
    body: { keeperConfirm?: boolean; driverName?: string; driverConfirm?: boolean },
    operator: string,
  ) {
    const note = await this.mustGetNote(noteId);
    if (note.status === DocStatus.SYNCED || note.status === DocStatus.REVERSED) {
      throw new BizException('SHIP_NOTE_LOCKED', `发货单 ${note.dnNo} 已${note.status === DocStatus.SYNCED ? '放行' : '冲销'}锁定，只能红字冲销`);
    }
    if (note.status === DocStatus.PENDING_APPROVAL) {
      throw new BizException('SHORT_SHIP_NOT_APPROVED', '少发申请未审批，禁止放行');
    }
    if (note.status !== DocStatus.DRAFT && note.status !== DocStatus.APPROVED) {
      throw new BizException('RELEASE_NOT_ALLOWED', `状态 ${note.status} 不允许放行`);
    }
    if (!body.keeperConfirm || !body.driverConfirm || !body.driverName?.trim()) {
      throw new BizException('DUAL_CONFIRM_REQUIRED', '放行须仓管员+司机双方确认（keeperConfirm/driverName/driverConfirm）');
    }

    const before = { status: note.status };
    const lines = await this.lineRepo.find({ where: { noteId } });
    const scans = await this.scanRepo.find({ where: { noteId } });

    // 超发/重复/归属错误未清零不得放行：放行前全量复核扫码记录
    const scannedByLine = new Map<number, number>();
    for (const s of scans) {
      const line = lines.find((l) => l.id === s.lineId);
      if (!line || line.productCode !== s.productCode) {
        throw new BizException('RELEASE_BLOCKED', `存在归属异常扫码记录 ${s.serialNo}，未清零不得放行`);
      }
      scannedByLine.set(s.lineId, (scannedByLine.get(s.lineId) ?? 0) + 1);
    }
    for (const l of lines) {
      if ((scannedByLine.get(l.id) ?? 0) > l.qty) {
        throw new BizException('RELEASE_BLOCKED', `明细 ${l.orderNo}/${l.productCode} 存在超发，未清零不得放行`);
      }
    }

    // 少发：必须已审批（状态 APPROVED）才能部分放行
    const expectedQty = lines.reduce((s, l) => s + l.qty, 0);
    const shortageQty = expectedQty - scans.length;
    if (shortageQty > 0 && note.status !== DocStatus.APPROVED) {
      throw new BizException(
        'SHORT_SHIP_NOT_APPROVED',
        `欠发 ${shortageQty} 件未走少发审批，禁止部分放行`,
      );
    }

    // 状态机：DRAFT →（双确认视为审批）→ APPROVED → PENDING_SYNC
    if (note.status === DocStatus.DRAFT) {
      note.status = DocStatusMachine.transition(note.status, DocStatus.PENDING_APPROVAL);
      note.status = DocStatusMachine.transition(note.status, DocStatus.APPROVED);
    }
    note.status = DocStatusMachine.transition(note.status, DocStatus.PENDING_SYNC);
    note.keeperConfirmBy = operator;
    note.keeperConfirmAt = new Date();
    note.driverName = body.driverName!.trim();
    note.driverConfirmAt = new Date();
    note.releasedAt = new Date();
    await this.noteRepo.save(note);

    // 扣成品库存：序列号置已出库
    for (const s of scans) {
      await this.serialRepo.update(
        { serialNo: s.serialNo },
        { status: 'SHIPPED', shippedNoteId: noteId, shippedDnNo: note.dnNo, shippedAt: new Date() },
      );
    }

    // 同步 U8 销售出库单（失败进异常队列 SYNC_ERROR，由 integration replay 补偿）
    const task = await this.sync.enqueue({
      bizType: 'shipping',
      bizKey: note.dnNo,
      voucherType: 'SALE_OUT',
      payload: {
        dnNo: note.dnNo,
        customerCode: note.customerCode,
        lines: lines.map((l) => ({
          orderNo: l.orderNo,
          productCode: l.productCode,
          qty: scannedByLine.get(l.id) ?? 0,
        })),
        serialNos: scans.map((s) => s.serialNo),
        driverName: note.driverName,
      },
    });
    note.status =
      task.status === DocStatus.SYNCED
        ? DocStatusMachine.transition(note.status, DocStatus.SYNCED)
        : DocStatusMachine.transition(note.status, DocStatus.SYNC_ERROR);
    await this.noteRepo.save(note);

    await this.audit.log({
      operator,
      action: 'shipping.release',
      docNo: note.dnNo,
      before,
      after: {
        status: note.status,
        keeperConfirmBy: note.keeperConfirmBy,
        driverName: note.driverName,
        shippedCount: scans.length,
        shortageQty,
      },
      result: note.status === DocStatus.SYNCED ? 'SUCCESS' : 'SYNC_ERROR',
    });
    const summary = await this.noteSummary(note);
    return { ...summary, syncStatus: task.status, syncTaskId: task.id };
  }

  // ---------- 少发申请（原因必填 + 配置审批） ----------

  async shortShip(noteId: number, body: { reason?: string }, operator: string) {
    const note = await this.mustGetNote(noteId);
    if (!body.reason?.trim()) {
      throw new BizException('SHORT_SHIP_REASON_REQUIRED', '少发原因必填');
    }
    if (note.status !== DocStatus.DRAFT) {
      throw new BizException('SHORT_SHIP_NOT_ALLOWED', `状态 ${note.status} 不允许发起少发申请`);
    }
    const lines = await this.lineRepo.find({ where: { noteId } });
    const scans = await this.scanRepo.find({ where: { noteId } });
    const scannedByLine = new Map<number, number>();
    for (const s of scans) {
      scannedByLine.set(s.lineId, (scannedByLine.get(s.lineId) ?? 0) + 1);
    }
    const lacks = lines
      .map((l) => ({ line: l, lack: l.qty - (scannedByLine.get(l.id) ?? 0) }))
      .filter((x) => x.lack > 0);
    if (!lacks.length) {
      throw new BizException('NO_SHORTAGE', '无欠发数量，无需少发申请');
    }

    const approver = (await this.ruleConfig.get('shipping.shortShip.approver')) ?? 'admin';
    const ap = await this.approval.create('shipping.shortShip', note.dnNo, operator, [
      { userId: approver },
    ]);

    note.status = DocStatusMachine.transition(note.status, DocStatus.PENDING_APPROVAL);
    await this.noteRepo.save(note);

    const shortages: Shortage[] = [];
    for (const { line, lack } of lacks) {
      shortages.push(
        await this.shortageRepo.save(
          this.shortageRepo.create({
            noteId,
            orderNo: line.orderNo,
            productCode: line.productCode,
            qty: lack,
            reason: body.reason.trim(),
            approvalId: ap.id,
            status: 'PENDING_APPROVAL',
            reshipStatus: 'OPEN',
          }),
        ),
      );
    }
    await this.audit.log({
      operator,
      action: 'shipping.shortShip',
      docNo: note.dnNo,
      after: { approvalId: ap.id, reason: body.reason.trim(), shortageQty: lacks.reduce((s, x) => s + x.lack, 0) },
      result: 'SUCCESS',
    });
    return { approvalId: ap.id, status: note.status, shortages };
  }

  /** 少发审批（审批人操作；通过后允许部分放行） */
  async approveShortShip(approvalId: number, approve: boolean, operator: string, roles: string[], comment?: string) {
    const ap = approve
      ? await this.approval.approve(approvalId, operator, roles, comment)
      : await this.approval.reject(approvalId, operator, roles, comment);
    if (ap.bizType === 'shipping.shortShip') {
      const note = await this.noteRepo.findOne({ where: { dnNo: ap.bizId } });
      if (note && note.status === DocStatus.PENDING_APPROVAL) {
        note.status = approve
          ? DocStatusMachine.transition(note.status, DocStatus.APPROVED)
          : DocStatusMachine.transition(note.status, DocStatus.DRAFT); // 驳回置回草稿
        await this.noteRepo.save(note);
        await this.shortageRepo.update(
          { noteId: note.id, approvalId },
          { status: approve ? 'APPROVED' : 'REJECTED' },
        );
        await this.audit.log({
          operator,
          action: approve ? 'shipping.shortShip.approve' : 'shipping.shortShip.reject',
          docNo: note.dnNo,
          after: { approvalId, status: note.status, comment },
          result: 'SUCCESS',
        });
      }
    }
    return ap;
  }

  // ---------- 红字冲销 ----------

  async reversal(noteId: number, body: { reason?: string }, operator: string) {
    const note = await this.mustGetNote(noteId);
    if (note.status !== DocStatus.SYNCED) {
      throw new BizException('REVERSAL_NOT_ALLOWED', `仅已放行(SYNCED)单据可冲销，当前 ${note.status}`);
    }
    if (!body.reason?.trim()) {
      throw new BizException('REVERSAL_REASON_REQUIRED', '冲销原因必填');
    }
    const before = { status: note.status };

    const reversalNo = await this.numbering.next('SHP');
    const doc = await this.reversalRepo.save(
      this.reversalRepo.create({
        reversalNo,
        noteId,
        dnNo: note.dnNo,
        reason: body.reason.trim(),
        status: DocStatus.DRAFT,
        createdBy: operator,
      }),
    );
    // 冲销单走状态机并同步 U8 红字销售出库
    doc.status = DocStatusMachine.transition(doc.status, DocStatus.PENDING_APPROVAL);
    doc.status = DocStatusMachine.transition(doc.status, DocStatus.APPROVED);
    doc.status = DocStatusMachine.transition(doc.status, DocStatus.PENDING_SYNC);
    await this.reversalRepo.save(doc);
    const task = await this.sync.enqueue({
      bizType: 'shipping.reversal',
      bizKey: reversalNo,
      voucherType: 'SALE_OUT',
      payload: { reversalOf: note.dnNo, redLetter: true, reason: doc.reason },
    });
    doc.status =
      task.status === DocStatus.SYNCED
        ? DocStatusMachine.transition(doc.status, DocStatus.SYNCED)
        : DocStatusMachine.transition(doc.status, DocStatus.SYNC_ERROR);
    await this.reversalRepo.save(doc);

    // 原单保留并置 REVERSED（锁定）；序列号回库
    note.status = DocStatusMachine.transition(note.status, DocStatus.REVERSED);
    await this.noteRepo.save(note);
    await this.serialRepo.update(
      { shippedNoteId: noteId },
      { status: 'IN_STOCK', shippedNoteId: null, shippedDnNo: null, shippedAt: null },
    );

    await this.audit.log({
      operator,
      action: 'shipping.reversal',
      docNo: note.dnNo,
      before,
      after: { status: note.status, reversalNo, reason: doc.reason },
      result: 'SUCCESS',
    });
    return doc;
  }

  // ---------- 成品序列号主数据 ----------

  /** 注册成品序列号（幂等：已存在的序列号跳过） */
  async registerSerials(
    items: { serialNo: string; productCode: string; batchNo?: string; workOrderId?: string }[],
    operator?: string,
  ) {
    if (!items?.length) throw new BizException('SERIALS_EMPTY', 'serials 不能为空');
    const created: string[] = [];
    const skipped: string[] = [];
    for (const item of items) {
      if (!item.serialNo || !item.productCode) {
        throw new BizException('SERIAL_INVALID', 'serialNo/productCode 必填');
      }
      const exists = await this.serialRepo.findOne({ where: { serialNo: item.serialNo } });
      if (exists) {
        skipped.push(item.serialNo);
        continue;
      }
      await this.serialRepo.save(
        this.serialRepo.create({
          serialNo: item.serialNo,
          productCode: item.productCode,
          batchNo: item.batchNo ?? null,
          workOrderId: item.workOrderId ?? null,
          status: 'IN_STOCK',
        }),
      );
      created.push(item.serialNo);
    }
    return { created, skipped };
  }

  async listSerials(filter: { status?: string; productCode?: string; workOrderId?: string }) {
    const qb = this.serialRepo.createQueryBuilder('s').orderBy('s.serialNo', 'ASC');
    if (filter.status) qb.andWhere('s.status = :status', filter);
    if (filter.productCode) qb.andWhere('s.productCode = :productCode', filter);
    if (filter.workOrderId) qb.andWhere('s.workOrderId = :workOrderId', filter);
    return qb.getMany();
  }

  // ---------- internals ----------

  async mustGetNote(id: number): Promise<DeliveryNote> {
    const note = await this.noteRepo.findOne({ where: { id } });
    if (!note) throw new BizException('NOTE_NOT_FOUND', `发货单 ${id} 不存在`, 404);
    return note;
  }

  private assertScannable(note: DeliveryNote) {
    if (note.status === DocStatus.SYNCED || note.status === DocStatus.REVERSED) {
      throw new BizException('SHIP_NOTE_LOCKED', `发货单 ${note.dnNo} 已${note.status === DocStatus.SYNCED ? '放行' : '冲销'}锁定，禁止再扫码`);
    }
    if (note.status !== DocStatus.DRAFT && note.status !== DocStatus.APPROVED) {
      throw new BizException('NOTE_NOT_SCANNABLE', `状态 ${note.status} 不允许扫码出库`);
    }
  }

  /** 装柜顺序：loadingSequence（orderNo 数组）优先，缺省按下单先后（sortOrder） */
  private orderLines(lines: DeliveryNoteLine[], loadingSequence: string | null): DeliveryNoteLine[] {
    const seq: string[] = loadingSequence ? JSON.parse(loadingSequence) : [];
    if (!seq.length) return [...lines].sort((a, b) => a.sortOrder - b.sortOrder);
    const rank = new Map(seq.map((o, i) => [o, i]));
    return [...lines].sort((a, b) => {
      const ra = rank.get(a.orderNo) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.orderNo) ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a.sortOrder - b.sortOrder;
    });
  }

  private async violation(note: DeliveryNote, code: string, serialNo: string, operator: string, remark: string) {
    await this.audit.log({
      operator,
      action: 'shipping.scan.violation',
      docNo: note.dnNo,
      after: { code, serialNo, remark },
      result: 'BLOCKED',
    });
  }

  async noteSummary(note: DeliveryNote) {
    const lines = await this.lineRepo.find({ where: { noteId: note.id } });
    const scans = await this.scanRepo.find({ where: { noteId: note.id } });
    const scannedByLine = new Map<number, number>();
    for (const s of scans) {
      scannedByLine.set(s.lineId, (scannedByLine.get(s.lineId) ?? 0) + 1);
    }
    const ordered = this.orderLines(lines, note.loadingSequence);
    const expectedQty = lines.reduce((s, l) => s + l.qty, 0);
    const next = ordered.find((l) => (scannedByLine.get(l.id) ?? 0) < l.qty) ?? null;
    const shortages = await this.shortageRepo.find({ where: { noteId: note.id } });
    return {
      id: note.id,
      dnNo: note.dnNo,
      customerCode: note.customerCode,
      customerName: note.customerName,
      source: note.source,
      status: note.status,
      loadingSequence: note.loadingSequence ? JSON.parse(note.loadingSequence) : null,
      expectedQty,
      scannedQty: scans.length,
      shortageQty: expectedQty - scans.length,
      duplicateScanCount: note.duplicateScanCount,
      keeperConfirmBy: note.keeperConfirmBy,
      driverName: note.driverName,
      releasedAt: note.releasedAt,
      nextExpected: next
        ? { orderNo: next.orderNo, productCode: next.productCode, remaining: next.qty - (scannedByLine.get(next.id) ?? 0) }
        : null,
      lines: lines.map((l) => ({
        id: l.id,
        orderNo: l.orderNo,
        productCode: l.productCode,
        qty: l.qty,
        unit: l.unit,
        scannedQty: scannedByLine.get(l.id) ?? 0,
        shortageQty: l.qty - (scannedByLine.get(l.id) ?? 0),
      })),
      shortages,
    };
  }
}
