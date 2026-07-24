import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { buildTypeOrmOptions } from './database';
import { Permission } from './modules/rbac/entities/permission.entity';
import { Role } from './modules/rbac/entities/role.entity';
import { User } from './modules/rbac/entities/user.entity';
import { Material } from './modules/masterdata/entities/material.entity';
import { Supplier } from './modules/masterdata/entities/supplier.entity';
import { Customer } from './modules/masterdata/entities/customer.entity';
import { Warehouse } from './modules/masterdata/entities/warehouse.entity';
import { Location } from './modules/masterdata/entities/location.entity';
import { WorkOrder } from './modules/masterdata/entities/work-order.entity';
import { Bom } from './modules/masterdata/entities/bom.entity';
import { StockLot } from './modules/inventory/entities/stock-lot.entity';
import { AbcClass, DataScope, PermissionType, StockStatus, YL_AREA_CODE } from './common/enums';

/** 权限目录 */
const PERMISSIONS: [string, string, PermissionType][] = [
  ['*', '超级权限', PermissionType.BUTTON],
  ['masterdata.read', '主数据查询', PermissionType.MENU],
  ['masterdata.material.create', '主数据新建', PermissionType.BUTTON],
  ['masterdata.material.update', '主数据修改', PermissionType.BUTTON],
  ['masterdata.material.delete', '主数据删除', PermissionType.BUTTON],
  ['inventory.read', '库存查询', PermissionType.MENU],
  ['inventory.inbound', '库存入库', PermissionType.BUTTON],
  ['inventory.move', '库存移动/占用/核销', PermissionType.BUTTON],
  ['inventory.adjust', '盘点调整', PermissionType.BUTTON],
  ['integration.read', '集成日志查询', PermissionType.MENU],
  ['integration.replay', '同步重放/入队', PermissionType.BUTTON],
  ['integration.reconcile', '日终对账', PermissionType.BUTTON],
  ['config.read', '规则配置查询', PermissionType.MENU],
  ['config.write', '规则配置维护', PermissionType.BUTTON],
  ['offline.sync', '离线同步', PermissionType.BUTTON],
  ['rbac.read', '用户/角色/权限查询', PermissionType.MENU],
  ['rbac.write', '用户角色分配', PermissionType.BUTTON],
  // ---- 阶段七：业务模块权限目录补全 ----
  ['receiving.read', '收料查询', PermissionType.MENU],
  ['receiving.operate', '收料操作（到货/送检/IQC/入库）', PermissionType.BUTTON],
  ['prep.read', '备料查询/齐套看板', PermissionType.MENU],
  ['prep.operate', '备料操作', PermissionType.BUTTON],
  ['surplus.read', '余料查询', PermissionType.MENU],
  ['surplus.operate', '余料处理', PermissionType.BUTTON],
  ['transfer.read', '调拨查询', PermissionType.MENU],
  ['transfer.operate', '调拨操作', PermissionType.BUTTON],
  ['returns.read', '退库查询', PermissionType.MENU],
  ['returns.operate', '退库操作', PermissionType.BUTTON],
  ['returns.qtransfer', '质量调拨电子签', PermissionType.BUTTON],
  ['stocktake.read', '盘点查询', PermissionType.MENU],
  ['stocktake.operate', '盘点操作', PermissionType.BUTTON],
  ['shipping.read', '发货查询', PermissionType.MENU],
  ['shipping.operate', '发货操作', PermissionType.BUTTON],
  ['approval.read', '审批中心查询', PermissionType.MENU],
  ['approval.operate', '审批通过/驳回', PermissionType.BUTTON],
  ['audit.read', '审计日志查询/导出', PermissionType.MENU],
];

/**
 * 角色清单（PRD 对接会 11 个岗位角色全量建立，数据范围默认 ALL）：
 * 收料员/仓管员/质检员/质量工程师/PMC计划员/生产班组长/仓库主管/财务/销售/IT运维/系统管理员
 */
const ROLES: { code: string; name: string; perms: string[] }[] = [
  { code: 'RECEIVER', name: '收料员', perms: ['masterdata.read', 'inventory.read', 'inventory.inbound', 'offline.sync', 'receiving.read', 'receiving.operate'] },
  { code: 'KEEPER', name: '仓管员', perms: ['masterdata.read', 'inventory.read', 'inventory.inbound', 'inventory.move', 'offline.sync', 'prep.read', 'prep.operate', 'surplus.read', 'surplus.operate', 'returns.read', 'returns.operate', 'returns.qtransfer'] },
  { code: 'INSPECTOR', name: '质检员', perms: ['masterdata.read', 'inventory.read', 'inventory.move', 'receiving.read', 'receiving.operate', 'returns.qtransfer'] },
  { code: 'QE', name: '质量工程师', perms: ['masterdata.read', 'inventory.read', 'inventory.move', 'receiving.read', 'receiving.operate', 'returns.qtransfer'] },
  { code: 'PMC', name: 'PMC计划员', perms: ['masterdata.read', 'inventory.read', 'transfer.read', 'transfer.operate', 'prep.read'] },
  { code: 'LEADER', name: '生产班组长', perms: ['masterdata.read', 'inventory.read', 'offline.sync', 'prep.read'] },
  { code: 'WH_MANAGER', name: '仓库主管', perms: ['masterdata.read', 'masterdata.material.create', 'masterdata.material.update', 'inventory.read', 'inventory.inbound', 'inventory.move', 'inventory.adjust', 'integration.read', 'integration.replay', 'stocktake.read', 'stocktake.operate', 'approval.read', 'approval.operate'] },
  { code: 'FINANCE', name: '财务', perms: ['integration.read', 'integration.reconcile', 'approval.read', 'approval.operate', 'audit.read'] },
  { code: 'SALES', name: '销售', perms: ['masterdata.read', 'shipping.read', 'shipping.operate'] },
  { code: 'IT_OPS', name: 'IT运维', perms: ['integration.read', 'integration.replay', 'integration.reconcile', 'config.read', 'config.write'] },
  { code: 'ADMIN', name: '系统管理员', perms: ['*'] },
];

/** 可被 CLI 与 e2e 复用的种子数据逻辑 */
export async function seedData(ds: DataSource) {
  const permRepo = ds.getRepository(Permission);
  const roleRepo = ds.getRepository(Role);
  const userRepo = ds.getRepository(User);

  const permMap = new Map<string, Permission>();
  for (const [code, name, type] of PERMISSIONS) {
    let p = await permRepo.findOne({ where: { code } });
    if (!p) p = await permRepo.save(permRepo.create({ code, name, type }));
    permMap.set(code, p);
  }

  for (const def of ROLES) {
    let role = await roleRepo.findOne({ where: { code: def.code } });
    const perms = def.perms.map((c) => permMap.get(c)!);
    if (!role) {
      role = roleRepo.create({ code: def.code, name: def.name, dataScope: DataScope.ALL, permissions: perms });
    } else {
      role.permissions = perms;
    }
    await roleRepo.save(role);
  }

  const ensureUser = async (username: string, password: string, name: string, roleCodes: string[]) => {
    let u = await userRepo.findOne({ where: { username } });
    if (u) return u;
    const roles = await roleRepo.find({ where: roleCodes.map((code) => ({ code })) as any });
    u = userRepo.create({
      username,
      name,
      passwordHash: await bcrypt.hash(password, 10),
      roles,
      disabled: false,
    });
    return userRepo.save(u);
  };
  await ensureUser('admin', 'Admin@123', '系统管理员', ['ADMIN']);
  await ensureUser('receiver01', 'Recv@123', '收料员一号', ['RECEIVER']);
  await ensureUser('keeper01', 'Keep@123', '仓管员一号', ['KEEPER']);

  // ---- 演示主数据 ----
  const matRepo = ds.getRepository(Material);
  const materials: Partial<Material>[] = [
    { materialCode: 'M-1001', name: '电源线', abcClass: AbcClass.A, safetyStock: 100, unit: 'PCS', shelfLifeDays: 720, isSpecial: false, specialStatus: 'NORMAL' },
    { materialCode: 'M-1002', name: '发热管', abcClass: AbcClass.B, safetyStock: 50, unit: 'PCS', shelfLifeDays: 365, isSpecial: true, specialStatus: 'PENDING' },
    { materialCode: 'M-2001', name: '不锈钢管', abcClass: AbcClass.C, safetyStock: 0, unit: 'M', shelfLifeDays: null, isSpecial: false, specialStatus: 'NORMAL' },
  ];
  for (const m of materials) {
    if (!(await matRepo.findOne({ where: { materialCode: m.materialCode } }))) await matRepo.save(matRepo.create(m));
  }

  const supRepo = ds.getRepository(Supplier);
  for (const s of [
    { supplierCode: 'SUP001', name: '宁波线缆厂', contact: '张三', phone: '0574-0000001' },
    { supplierCode: 'SUP002', name: '永康五金厂', contact: '李四', phone: '0579-0000002' },
  ]) {
    if (!(await supRepo.findOne({ where: { supplierCode: s.supplierCode } }))) await supRepo.save(supRepo.create(s));
  }

  const cusRepo = ds.getRepository(Customer);
  for (const c of [
    { customerCode: 'CUS001', name: '苏泊尔', contact: '王五' },
    { customerCode: 'CUS002', name: '九阳', contact: '赵六' },
  ]) {
    if (!(await cusRepo.findOne({ where: { customerCode: c.customerCode } }))) await cusRepo.save(cusRepo.create(c));
  }

  const whRepo = ds.getRepository(Warehouse);
  for (const w of [
    { warehouseCode: 'WH01', name: '原材料仓' },
    { warehouseCode: 'WH02', name: '成品仓' },
  ]) {
    if (!(await whRepo.findOne({ where: { warehouseCode: w.warehouseCode } }))) await whRepo.save(whRepo.create(w));
  }

  const locRepo = ds.getRepository(Location);
  for (const l of [
    { locationCode: 'WH01-A-01', warehouseCode: 'WH01', areaCode: 'A', name: 'A区01位' },
    { locationCode: 'WH01-B-01', warehouseCode: 'WH01', areaCode: 'B', name: 'B区01位' },
    { locationCode: 'WH01-YL-01', warehouseCode: 'WH01', areaCode: YL_AREA_CODE, name: '余料区01位' },
    { locationCode: 'WH02-C-01', warehouseCode: 'WH02', areaCode: 'C', name: '成品C区01位' },
  ]) {
    if (!(await locRepo.findOne({ where: { locationCode: l.locationCode } }))) await locRepo.save(locRepo.create(l));
  }

  const woRepo = ds.getRepository(WorkOrder);
  if (!(await woRepo.findOne({ where: { workOrderId: 'WO20260724-001' } }))) {
    await woRepo.save(woRepo.create({ workOrderId: 'WO20260724-001', productCode: 'P-9001', planQty: 100, planDate: '2026-07-25', status: 'RELEASED' }));
  }

  const bomRepo = ds.getRepository(Bom);
  if (!(await bomRepo.findOne({ where: { bomCode: 'BOM-P9001-V1' } }))) {
    await bomRepo.save(
      bomRepo.create({
        bomCode: 'BOM-P9001-V1',
        productCode: 'P-9001',
        version: 1,
        items: [
          { bomCode: 'BOM-P9001-V1', materialCode: 'M-1001', qty: 1, unit: 'PCS' },
          { bomCode: 'BOM-P9001-V1', materialCode: 'M-1002', qty: 2, unit: 'PCS' },
        ] as any,
      }),
    );
  }

  // ---- 初始库存 ----
  const lotRepo = ds.getRepository(StockLot);
  if (!(await lotRepo.findOne({ where: { packageNo: 'PKG-INIT-0001' } }))) {
    await lotRepo.save(
      lotRepo.create({
        packageNo: 'PKG-INIT-0001',
        materialCode: 'M-1001',
        batchNo: 'B20260724',
        warehouseCode: 'WH01',
        locationCode: 'WH01-A-01',
        qty: 500,
        status: StockStatus.QUALIFIED,
        workOrderId: null,
        sourceDocNo: 'INIT-SEED',
        receivedAt: new Date(),
        expiryDate: null,
      }),
    );
  }

  return { ok: true };
}

/** CLI 入口：npm run seed */
async function main() {
  const ds = new DataSource(buildTypeOrmOptions(false) as any);
  await ds.initialize();
  await seedData(ds);
  await ds.destroy();
  // eslint-disable-next-line no-console
  console.log('Seed done: admin/Admin@123, receiver01/Recv@123, keeper01/Keep@123');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
