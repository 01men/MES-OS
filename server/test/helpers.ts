import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { NumberingSequence } from '../src/common/numbering/numbering.entity';
import { IdempotencyRecord } from '../src/common/idempotency/idempotency.entity';
import { AuditLog } from '../src/common/audit/audit.entity';
import { Approval } from '../src/common/approval/approval.entity';
import { User } from '../src/modules/rbac/entities/user.entity';
import { Role } from '../src/modules/rbac/entities/role.entity';
import { Permission } from '../src/modules/rbac/entities/permission.entity';
import { TempGrant } from '../src/modules/rbac/entities/temp-grant.entity';
import { Material } from '../src/modules/masterdata/entities/material.entity';
import { Supplier } from '../src/modules/masterdata/entities/supplier.entity';
import { Customer } from '../src/modules/masterdata/entities/customer.entity';
import { Warehouse } from '../src/modules/masterdata/entities/warehouse.entity';
import { Location } from '../src/modules/masterdata/entities/location.entity';
import { WorkOrder } from '../src/modules/masterdata/entities/work-order.entity';
import { Bom } from '../src/modules/masterdata/entities/bom.entity';
import { BomItem } from '../src/modules/masterdata/entities/bom-item.entity';
import { StockLot } from '../src/modules/inventory/entities/stock-lot.entity';
import { StockOccupation } from '../src/modules/inventory/entities/stock-occupation.entity';
import { StockMovement } from '../src/modules/inventory/entities/stock-movement.entity';
import { RuleConfig } from '../src/modules/config/rule-config.entity';
import { OfflineTask } from '../src/modules/offline/offline-task.entity';
import { U8Voucher } from '../src/modules/integration/u8-voucher.entity';
import { SyncTask } from '../src/modules/integration/sync-task.entity';

/**
 * 测试静态实体清单：与 src/database.ts 的 discoverEntities() 等价。
 * （Vitest/vite-node 环境下运行时 require .ts 不可靠，故测试侧用静态导入。）
 */
export const TEST_ENTITIES = [
  NumberingSequence,
  IdempotencyRecord,
  AuditLog,
  Approval,
  User,
  Role,
  Permission,
  TempGrant,
  Material,
  Supplier,
  Customer,
  Warehouse,
  Location,
  WorkOrder,
  Bom,
  BomItem,
  StockLot,
  StockOccupation,
  StockMovement,
  RuleConfig,
  OfflineTask,
  U8Voucher,
  SyncTask,
];

/** 内存 sqljs DataSource（每个测试用例独立实例） */
export async function createTestDataSource(): Promise<DataSource> {
  const ds = new DataSource({
    type: 'sqljs',
    synchronize: true,
    entities: TEST_ENTITIES,
    logging: false,
  } as any);
  await ds.initialize();
  return ds;
}
