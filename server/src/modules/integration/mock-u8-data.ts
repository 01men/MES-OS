/** Mock U8 供给侧数据（/mock-u8 控制器与 MockU8Adapter 共用） */
export const MOCK_PURCHASE_ORDERS = [
  {
    poNo: 'PO20260720-001',
    supplierCode: 'SUP001',
    lines: [
      { materialCode: 'M-1001', qty: 500, unit: 'PCS' },
      { materialCode: 'M-1002', qty: 200, unit: 'PCS' },
    ],
    updatedAt: '2026-07-20T08:00:00.000Z',
  },
  {
    poNo: 'PO20260722-002',
    supplierCode: 'SUP002',
    lines: [{ materialCode: 'M-2001', qty: 1000, unit: 'M' }],
    updatedAt: '2026-07-22T09:30:00.000Z',
  },
];

export const MOCK_DELIVERY_NOTES = [
  {
    dnNo: 'DN20260723-001',
    customerCode: 'CUS001',
    lines: [{ productCode: 'P-9001', qty: 50, unit: 'PCS' }],
    updatedAt: '2026-07-23T02:00:00.000Z',
  },
];

export function mockMasterData(type: string): any[] {
  const data: Record<string, any[]> = {
    material: [
      { materialCode: 'M-1001', name: '电源线', unit: 'PCS' },
      { materialCode: 'M-1002', name: '发热管', unit: 'PCS' },
    ],
    supplier: [{ supplierCode: 'SUP001', name: '宁波线缆厂' }],
    customer: [{ customerCode: 'CUS001', name: '苏泊尔' }],
  };
  return data[type] ?? [];
}

/** 增量过滤 */
export function sinceFilter<T extends { updatedAt: string }>(rows: T[], since?: string): T[] {
  if (!since) return rows;
  return rows.filter((r) => r.updatedAt > since);
}
