/**
 * U8 适配器抽象：真实环境替换为 HTTP/中间表实现（DI 替换 MockU8Adapter 即可）。
 */
export abstract class U8Adapter {
  /** 推送凭证；bizKey 幂等（重复推送不得产生重复 U8 单据） */
  abstract pushVoucher(voucherType: string, payload: unknown, bizKey: string): Promise<{ u8Id: string }>;
  /** 拉取采购订单（增量） */
  abstract fetchPurchaseOrders(since?: string): Promise<any[]>;
  /** 拉取发货通知（增量） */
  abstract fetchDeliveryNotes(since?: string): Promise<any[]>;
  /** 拉取主数据 */
  abstract fetchMasterData(type: string): Promise<any[]>;
  /** 库存上报 */
  abstract reportStock(): Promise<{ reported: boolean }>;
}
