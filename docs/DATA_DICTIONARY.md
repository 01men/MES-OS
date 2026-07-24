# MES WMS 数据字典（模块级）

更新日期：2026-07-24

当前数据库由 TypeORM 实体生成。字段与约束的最终权威来源是 `server/src/**/*.entity.ts`；本表用于快速定位。

## 公共与安全

| 表 | 实体 | 用途 |
| --- | --- | --- |
| `rbac_user` | `User` | 用户、密码摘要、禁用状态 |
| `rbac_role` | `Role` | 角色、数据范围 |
| `rbac_permission` | `Permission` | 菜单/按钮权限码 |
| `rbac_user_role` | 关联表 | 用户与角色多对多 |
| `rbac_role_permission` | 关联表 | 角色与权限多对多 |
| `rbac_temp_grant` | `TempGrant` | 用户临时权限与到期时间 |
| `approval` | `Approval` | 审批单、步骤与状态 |
| `audit_log` | `AuditLog` | 追加式操作审计 |
| `idempotency_record` | `IdempotencyRecord` | 请求号 + 业务键 + 首次响应 |
| `numbering_sequence` | `NumberingSequence` | 按类型、日期的流水号 |
| `rule_config` | `RuleConfig` | 版本化业务规则 |
| `offline_task` | `OfflineTask` | 设备离线任务、业务时间、状态与负载 |

## 主数据与库存

| 表 | 实体 | 主业务键/用途 |
| --- | --- | --- |
| `md_material` | `Material` | `materialCode`，物料、安全库存、ABC、保质期 |
| `md_supplier` | `Supplier` | `supplierCode` |
| `md_customer` | `Customer` | `customerCode` |
| `md_warehouse` | `Warehouse` | `warehouseCode` |
| `md_location` | `Location` | `locationCode`、仓库、库区 |
| `md_work_order` | `WorkOrder` | `workOrderId` |
| `md_bom` | `Bom` | `bomCode`、产品、版本 |
| `md_bom_item` | `BomItem` | BOM 物料行 |
| `inv_stock_lot` | `StockLot` | `packageNo`，批次/库位/状态/数量 |
| `inv_stock_occupation` | `StockOccupation` | 工单备料占用 |
| `inv_stock_movement` | `StockMovement` | 库存移动与调整流水 |

## 业务与集成

| 模块 | 数据表 |
| --- | --- |
| 收料 | `rcv_purchase_order`、`rcv_arrival`、`rcv_ncr_report`、`rcv_label_print_log` |
| 备料 | `prep_order`、`prep_order_line`、`prep_task`、`prep_task_line`、`prep_scan_record`、`prep_reversal_doc` |
| 余料 | `sur_record`、`sur_process`、`sur_reminder`、`sur_print_log` |
| 挪料/返工 | `trf_transfer`、`trf_replenish_todo`、`trf_rework` |
| 退补/损耗/质量 | `rtn_return`、`rtn_replenish`、`rtn_defect`、`rtn_writeoff`、`rtn_qtransfer` |
| 盘点 | `stk_strategy`、`stk_task`、`stk_snapshot`、`stk_frozen_movement` |
| 发运 | `shp_delivery_note`、`shp_delivery_note_line`、`shp_serial_number`、`shp_scan_record`、`shp_photo`、`shp_shortage`、`shp_reversal_doc` |
| U8 集成 | `sync_task`、`u8_voucher` |

## 关键口径

- 库存唯一包装：`inv_stock_lot.packageNo`
- 接口幂等：`idempotency_record(requestId,businessKey)` 唯一
- 离线任务：`offline_task.taskNo` 唯一
- 规则配置：同一 `key` 追加 `version`，不覆盖旧版本
- 审计日志：业务 API 不提供更新或删除
- 生产迁移：禁止继续依赖 `synchronize:true`，需把本字典固化为 migration

