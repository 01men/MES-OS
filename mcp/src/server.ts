import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mesApi } from './api-client.js';

const toolResult = async (operation: () => Promise<unknown>) => {
  try {
    const value = await operation();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
      structuredContent: value && typeof value === 'object' ? value as Record<string, unknown> : undefined,
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    };
  }
};

export function createMesMcpServer() {
  const server = new McpServer({ name: 'mes-os', version: '0.1.0' });

  server.registerTool('mes_health', {
    title: 'MES integration health',
    description: 'Check whether the MES Open API and integration credentials are available.',
  }, async () => toolResult(() => mesApi('/health')));

  server.registerTool('list_materials', {
    title: 'List MES materials',
    description: 'List paginated material master data.',
    inputSchema: {
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    },
  }, async ({ page, pageSize }) =>
    toolResult(() => mesApi(`/materials?page=${page}&pageSize=${pageSize}`)));

  server.registerTool('upsert_material', {
    title: 'Create or update material',
    description: 'Upsert one MES material by material code.',
    inputSchema: {
      materialCode: z.string().min(1),
      name: z.string().min(1),
      unit: z.string().default('PCS'),
      safetyStock: z.number().nonnegative().default(0),
      abcClass: z.enum(['A', 'B', 'C', 'UNSET']).default('UNSET'),
    },
  }, async ({ materialCode, ...body }) =>
    toolResult(() => mesApi(`/materials/${encodeURIComponent(materialCode)}`, { method: 'PUT', body })));

  server.registerTool('list_inventory_lots', {
    title: 'List inventory lots',
    description: 'Query MES inventory lots with optional material and warehouse filters.',
    inputSchema: {
      materialCode: z.string().optional(),
      warehouseCode: z.string().optional(),
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    },
  }, async ({ materialCode, warehouseCode, page, pageSize }) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (materialCode) query.set('materialCode', materialCode);
    if (warehouseCode) query.set('warehouseCode', warehouseCode);
    return toolResult(() => mesApi(`/inventory/lots?${query}`));
  });

  server.registerTool('get_inventory_available', {
    title: 'Get available inventory',
    description: 'Calculate qualified minus occupied minus safety stock for a material.',
    inputSchema: {
      materialCode: z.string().min(1),
      warehouseCode: z.string().optional(),
    },
  }, async ({ materialCode, warehouseCode }) => {
    const query = warehouseCode ? `?warehouseCode=${encodeURIComponent(warehouseCode)}` : '';
    return toolResult(() => mesApi(`/inventory/available/${encodeURIComponent(materialCode)}${query}`));
  });

  server.registerTool('inbound_inventory', {
    title: 'Inbound an inventory lot',
    description: 'Create an idempotent inbound lot and stock movement in MES.',
    inputSchema: {
      requestId: z.string().min(1),
      packageNo: z.string().min(1),
      materialCode: z.string().min(1),
      batchNo: z.string().min(1),
      qty: z.number().positive(),
      warehouseCode: z.string().min(1),
      locationCode: z.string().min(1),
      sourceDocNo: z.string().min(1),
      workOrderId: z.string().optional(),
    },
  }, async ({ requestId, ...body }) =>
    toolResult(() => mesApi('/inventory/inbound', { method: 'POST', body, requestId })));

  server.registerTool('import_purchase_order', {
    title: 'Import U8 purchase order',
    description: 'Idempotently upsert a U8 purchase order header and its lines into MES.',
    inputSchema: {
      poNo: z.string().min(1),
      supplierCode: z.string().min(1),
      orderType: z.enum(['NORMAL', 'OUTSOURCE']).default('NORMAL'),
      status: z.string().default('OPEN'),
      lines: z.array(z.object({
        materialCode: z.string().min(1),
        qty: z.number().positive(),
        receivedQty: z.number().nonnegative().default(0),
        unit: z.string().default('PCS'),
      })).min(1),
    },
  }, async (body) =>
    toolResult(() => mesApi('/purchase-orders/import', { method: 'POST', body })));

  server.registerTool('import_delivery_note', {
    title: 'Import U8 delivery note',
    description: 'Idempotently upsert a U8 delivery note and its lines into MES.',
    inputSchema: {
      dnNo: z.string().min(1),
      customerCode: z.string().min(1),
      customerName: z.string().optional(),
      lines: z.array(z.object({
        orderNo: z.string().min(1),
        productCode: z.string().min(1),
        qty: z.number().positive(),
        unit: z.string().default('PCS'),
      })).min(1),
    },
  }, async (body) =>
    toolResult(() => mesApi('/delivery-notes/import', { method: 'POST', body })));

  server.registerTool('list_receiving_arrivals', {
    title: 'List receiving arrivals',
    description: 'List paginated receiving and IQC arrival records.',
    inputSchema: {
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    },
  }, async ({ page, pageSize }) =>
    toolResult(() => mesApi(`/receiving/arrivals?page=${page}&pageSize=${pageSize}`)));

  server.registerTool('enqueue_u8_sync', {
    title: 'Enqueue U8 voucher sync',
    description: 'Create and process an idempotent U8 synchronization task.',
    inputSchema: {
      bizType: z.string().min(1),
      bizKey: z.string().min(1),
      voucherType: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).default({}),
    },
  }, async (body) =>
    toolResult(() => mesApi('/sync/tasks', { method: 'POST', body })));

  server.registerTool('list_u8_sync_tasks', {
    title: 'List U8 sync tasks',
    description: 'List U8 synchronization tasks and their status.',
    inputSchema: {
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    },
  }, async ({ page, pageSize }) =>
    toolResult(() => mesApi(`/sync/tasks?page=${page}&pageSize=${pageSize}`)));

  return server;
}
