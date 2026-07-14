import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { WebSocketServer } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.SYNC_DATA_DIR || join(__dirname, '.sync-data');
const stateFile = join(dataDir, 'realtime-sync-state.json');
const port = Number(process.env.PORT || process.env.SYNC_PORT || 8787);
const apiToken = process.env.SYNC_API_TOKEN || '';
const { Pool } = pg;
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.POSTGRES_SSL === 'true' || process.env.PGSSLMODE === 'require'
        ? { rejectUnauthorized: false }
        : undefined
    })
  : null;

const state = {
  latestCatalogEvent: null,
  latestPosSnapshotEvent: null,
  salesEvents: [],
  stockEvents: [],
  eventIds: {}
};

const clients = new Map();

function asText(value) {
  return value === undefined || value === null ? null : String(value);
}

function asNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function asTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asJson(value) {
  return JSON.stringify(value ?? null);
}

function rowId(row, prefix, index) {
  return asText(row?.id ?? row?.key ?? `${prefix}_${index}`);
}

const POS_TABLES = [
  {
    snapshotKey: 'users',
    table: 'pos_users',
    insertSql: `insert into pos_users (id, name, role_id, role, pin, phone, email, position_title, profile_note, is_active, created_at, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_user', index), row.name ?? null, row.role_id ?? null, row.role ?? null, row.pin ?? null, row.phone ?? null, row.email ?? null, row.position_title ?? null, row.profile_note ?? null, asBoolean(row.is_active), asTimestamp(row.created_at), asJson(row)],
  },
  {
    snapshotKey: 'roles',
    table: 'pos_roles',
    insertSql: `insert into pos_roles (id, name, description, permissions, raw) values ($1,$2,$3,$4::jsonb,$5::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_role', index), row.name ?? null, row.description ?? null, asJson(row.permissions ?? []), asJson(row)],
  },
  {
    snapshotKey: 'permissions',
    table: 'pos_permissions',
    insertSql: `insert into pos_permissions (id, code, name, raw) values ($1,$2,$3,$4::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_permission', index), row.code ?? null, row.name ?? null, asJson(row)],
  },
  {
    snapshotKey: 'outlets',
    table: 'pos_outlets',
    insertSql: `insert into pos_outlets (id, name, address, phone, is_default, created_at, raw) values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_outlet', index), row.name ?? null, row.address ?? null, row.phone ?? null, asBoolean(row.is_default), asTimestamp(row.created_at), asJson(row)],
  },
  {
    snapshotKey: 'products',
    table: 'pos_products',
    insertSql: `insert into pos_products (id, sku, barcode, name, category, brand, is_active, source, updated_at, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_product', index), row.sku ?? null, row.barcode ?? null, row.name ?? null, row.category ?? null, row.brand ?? null, asBoolean(row.is_active), row.source ?? null, asTimestamp(row.updated_at), asJson(row)],
  },
  {
    snapshotKey: 'productUnits',
    table: 'pos_product_units',
    insertSql: `insert into pos_product_units (id, product_id, unit_name, conversion_to_base, active_selling_price, cost_price, effective_date, raw) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_product_unit', index), row.product_id ?? null, row.unit_name ?? null, asNumber(row.conversion_to_base), asNumber(row.active_selling_price), asNumber(row.cost_price), row.effective_date ?? null, asJson(row)],
  },
  {
    snapshotKey: 'productBarcodes',
    table: 'pos_product_barcodes',
    insertSql: `insert into pos_product_barcodes (id, product_id, unit_id, barcode, raw) values ($1,$2,$3,$4,$5::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_product_barcode', index), row.product_id ?? null, row.unit_id ?? null, row.barcode ?? null, asJson(row)],
  },
  {
    snapshotKey: 'stockBalances',
    table: 'pos_stock_balances',
    insertSql: `insert into pos_stock_balances (id, product_id, outlet_id, qty, low_stock_threshold, last_updated, raw) values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_stock_balance', index), row.product_id ?? null, row.outlet_id ?? null, asNumber(row.qty), asNumber(row.low_stock_threshold), asTimestamp(row.last_updated), asJson(row)],
  },
  {
    snapshotKey: 'stockMovements',
    table: 'pos_stock_movements',
    insertSql: `insert into pos_stock_movements (id, product_id, unit_id, outlet_id, movement_type, qty_change, created_at, reference_id, note, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_stock_movement', index), row.product_id ?? null, row.unit_id ?? null, row.outlet_id ?? null, row.type ?? null, asNumber(row.qty_change), asTimestamp(row.created_at), row.reference_id ?? null, row.note ?? null, asJson(row)],
  },
  {
    snapshotKey: 'transactions',
    table: 'pos_transactions',
    insertSql: `insert into pos_transactions (id, cashier_id, outlet_id, shift_id, customer_id, created_at, subtotal, discount_total, tax_total, total, paid, change_amount, status, sync_status, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_transaction', index), row.cashier_id ?? null, row.outlet_id ?? null, row.shift_id ?? null, row.customer_id ?? null, asTimestamp(row.created_at), asNumber(row.subtotal), asNumber(row.discount_total), asNumber(row.tax_total), asNumber(row.total), asNumber(row.paid), asNumber(row.change), row.status ?? null, row.sync_status ?? null, asJson(row)],
  },
  {
    snapshotKey: 'transactionItems',
    table: 'pos_transaction_items',
    insertSql: `insert into pos_transaction_items (id, transaction_id, product_id, product_name, unit_id, unit_name, qty, unit_price, discount, subtotal, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_transaction_item', index), row.transaction_id ?? null, row.product_id ?? null, row.product_name ?? null, row.unit_id ?? null, row.unit_name ?? null, asNumber(row.qty), asNumber(row.unit_price), asNumber(row.discount), asNumber(row.subtotal), asJson(row)],
  },
  {
    snapshotKey: 'payments',
    table: 'pos_payments',
    insertSql: `insert into pos_payments (id, transaction_id, method, amount, raw) values ($1,$2,$3,$4,$5::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_payment', index), row.transaction_id ?? null, row.method ?? null, asNumber(row.amount), asJson(row)],
  },
  {
    snapshotKey: 'shifts',
    table: 'pos_shifts',
    insertSql: `insert into pos_shifts (id, cashier_id, outlet_id, opened_at, closed_at, starting_cash, expected_cash, actual_cash, difference, status, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_shift', index), row.cashier_id ?? null, row.outlet_id ?? null, asTimestamp(row.opened_at), asTimestamp(row.closed_at), asNumber(row.starting_cash), asNumber(row.expected_cash), asNumber(row.actual_cash), asNumber(row.difference), row.status ?? null, asJson(row)],
  },
  {
    snapshotKey: 'cashMovements',
    table: 'pos_cash_movements',
    insertSql: `insert into pos_cash_movements (id, shift_id, cashier_id, outlet_id, movement_type, amount, note, created_at, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_cash_movement', index), row.shift_id ?? null, row.cashier_id ?? null, row.outlet_id ?? null, row.type ?? null, asNumber(row.amount), row.note ?? null, asTimestamp(row.created_at), asJson(row)],
  },
  {
    snapshotKey: 'customers',
    table: 'pos_customers',
    insertSql: `insert into pos_customers (id, name, phone, notes, address, points, created_at, raw) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_customer', index), row.name ?? null, row.phone ?? null, row.notes ?? null, row.address ?? null, asNumber(row.points), asTimestamp(row.created_at), asJson(row)],
  },
  {
    snapshotKey: 'syncLogs',
    table: 'pos_sync_logs',
    insertSql: `insert into pos_sync_logs (id, log_type, status, records_processed, message, created_at, raw) values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_sync_log', index), row.type ?? null, row.status ?? null, asNumber(row.records_processed), row.message ?? null, asTimestamp(row.created_at), asJson(row)],
  },
  {
    snapshotKey: 'syncQueue',
    table: 'pos_sync_queue',
    insertSql: `insert into pos_sync_queue (id, entity, entity_id, operation, payload, status, retry_count, last_error, created_at, updated_at, raw) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_sync_queue', index), row.entity ?? null, row.entity_id ?? null, row.operation ?? null, asJson(row.payload ? safeJsonParse(row.payload) : null), row.status ?? null, asNumber(row.retry_count), row.last_error ?? null, asTimestamp(row.created_at), asTimestamp(row.updated_at), asJson(row)],
  },
  {
    snapshotKey: 'auditLogs',
    table: 'pos_audit_logs',
    insertSql: `insert into pos_audit_logs (id, user_id, action, entity, entity_id, metadata, created_at, raw) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_audit_log', index), row.user_id ?? null, row.action ?? null, row.entity ?? null, row.entity_id ?? null, asJson(row.metadata ? safeJsonParse(row.metadata) : null), asTimestamp(row.created_at), asJson(row)],
  },
  {
    snapshotKey: 'appSettings',
    table: 'pos_app_settings',
    insertSql: `insert into pos_app_settings (setting_key, setting_value, updated_at, raw) values ($1,$2,$3,$4::jsonb)`,
    values: (row, index) => [rowId(row, 'pos_app_setting', index), row.value ?? null, asTimestamp(row.updated_at), asJson(row)],
  },
];

const INVENTORY_TABLES = [
  {
    snapshotKey: 'categories',
    table: 'inventory_categories',
    insertSql: `insert into inventory_categories (id, name, is_active, raw) values ($1,$2,$3,$4::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_category', index), row.name ?? null, asBoolean(row.isActive), asJson(row)],
  },
  {
    snapshotKey: 'brands',
    table: 'inventory_brands',
    insertSql: `insert into inventory_brands (id, name, is_active, raw) values ($1,$2,$3,$4::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_brand', index), row.name ?? null, asBoolean(row.isActive), asJson(row)],
  },
  {
    snapshotKey: 'suppliers',
    table: 'inventory_suppliers',
    insertSql: `insert into inventory_suppliers (id, name, phone, address, is_active, raw) values ($1,$2,$3,$4,$5,$6::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_supplier', index), row.name ?? null, row.phone ?? null, row.address ?? null, asBoolean(row.isActive), asJson(row)],
  },
  {
    snapshotKey: 'products',
    table: 'inventory_products',
    insertSql: `insert into inventory_products (id, sku, name, category_id, brand_id, supplier_id, barcode, pricing_mode, is_active, notes, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_product', index), row.sku ?? null, row.name ?? null, asText(row.categoryId), asText(row.brandId), asText(row.supplierId), row.barcode ?? null, row.pricingMode ?? null, asBoolean(row.isActive), row.notes ?? null, asJson(row)],
  },
  {
    snapshotKey: 'productUnits',
    table: 'inventory_product_units',
    insertSql: `insert into inventory_product_units (id, product_id, unit_name, conversion_to_base, manual_cost, active_selling_price, min_selling_price, max_selling_price, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_product_unit', index), row.productId ?? null, row.unitName ?? null, asNumber(row.conversionToBase), asNumber(row.manualCost), asNumber(row.activeSellingPrice), asNumber(row.minSellingPrice), asNumber(row.maxSellingPrice), asJson(row)],
  },
  {
    snapshotKey: 'marginRules',
    table: 'inventory_margin_rules',
    insertSql: `insert into inventory_margin_rules (id, rule_type, reference_id, margin_percent, priority, effective_from, effective_until, is_active, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_margin_rule', index), row.ruleType ?? null, asText(row.referenceId), asNumber(row.marginPercent), asNumber(row.priority), row.effectiveFrom ?? null, row.effectiveUntil ?? null, asBoolean(row.isActive), asJson(row)],
  },
  {
    snapshotKey: 'priceCalculations',
    table: 'inventory_price_calculations',
    insertSql: `insert into inventory_price_calculations (id, product_id, product_unit_id, status, input_cost, ppn_mode, ppn_rate, base_cost, ppn_amount, final_cost, margin_percent, calculated_price, rounded_price, recommended_price, estimated_profit, actual_margin, min_price, max_price, effective_date, change_reason, created_by, approved_by, approved_at_ms, rejected_by, rejected_at_ms, rejection_reason, created_at_ms, updated_at_ms, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_price_calculation', index), row.productId ?? null, row.productUnitId ?? null, row.status ?? null, asNumber(row.inputCost), row.ppnMode ?? null, asNumber(row.ppnRate), asNumber(row.baseCost), asNumber(row.ppnAmount), asNumber(row.finalCost), asNumber(row.marginPercent), asNumber(row.calculatedPrice), asNumber(row.roundedPrice), asNumber(row.recommendedPrice), asNumber(row.estimatedProfit), asNumber(row.actualMargin), asNumber(row.minPrice), asNumber(row.maxPrice), row.effectiveDate ?? null, row.changeReason ?? null, row.createdBy ?? null, row.approvedBy ?? null, asNumber(row.approvedAt), row.rejectedBy ?? null, asNumber(row.rejectedAt), row.rejectionReason ?? null, asNumber(row.createdAt), asNumber(row.updatedAt), asJson(row)],
  },
  {
    snapshotKey: 'priceHistories',
    table: 'inventory_price_histories',
    insertSql: `insert into inventory_price_histories (id, product_id, product_unit_id, old_cost, new_cost, old_price, new_price, old_margin, new_margin, old_ppn_mode, new_ppn_mode, old_ppn_amount, new_ppn_amount, pricing_mode, change_reason, effective_date, changed_by, approved_by, approved_at_ms, created_at_ms, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_price_history', index), row.productId ?? null, row.productUnitId ?? null, asNumber(row.oldCost), asNumber(row.newCost), asNumber(row.oldPrice), asNumber(row.newPrice), asNumber(row.oldMargin), asNumber(row.newMargin), row.oldPpnMode ?? null, row.newPpnMode ?? null, asNumber(row.oldPpnAmount), asNumber(row.newPpnAmount), row.pricingMode ?? null, row.changeReason ?? null, row.effectiveDate ?? null, row.changedBy ?? null, row.approvedBy ?? null, asNumber(row.approvedAt), asNumber(row.createdAt), asJson(row)],
  },
  {
    snapshotKey: 'productUnitCostHistories',
    table: 'inventory_product_unit_cost_histories',
    insertSql: `insert into inventory_product_unit_cost_histories (id, product_id, product_unit_id, supplier_id, input_cost, ppn_mode, ppn_rate, base_cost, ppn_amount, final_cost, previous_final_cost, source, effective_date, reference_number, notes, created_by, import_batch_id, created_at_ms, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_unit_cost_history', index), row.productId ?? null, row.productUnitId ?? null, asText(row.supplierId), asNumber(row.inputCost), row.ppnMode ?? null, asNumber(row.ppnRate), asNumber(row.baseCost), asNumber(row.ppnAmount), asNumber(row.finalCost), asNumber(row.previousFinalCost), row.source ?? null, row.effectiveDate ?? null, row.referenceNumber ?? null, row.notes ?? null, row.createdBy ?? null, row.importBatchId ?? null, asNumber(row.createdAt), asJson(row)],
  },
  {
    snapshotKey: 'csvImportBatches',
    table: 'inventory_csv_import_batches',
    insertSql: `insert into inventory_csv_import_batches (id, file_name, import_type, status, total_rows, valid_rows, invalid_rows, created_at_ms, imported_at_ms, error_message, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_csv_batch', index), row.fileName ?? null, row.importType ?? null, row.status ?? null, asNumber(row.totalRows), asNumber(row.validRows), asNumber(row.invalidRows), asNumber(row.createdAt), asNumber(row.importedAt), row.errorMessage ?? null, asJson(row)],
  },
  {
    snapshotKey: 'csvImportRows',
    table: 'inventory_csv_import_rows',
    insertSql: `insert into inventory_csv_import_rows (id, batch_id, row_number, raw_data, mapped_data, status, error_message, created_at_ms, raw) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_csv_row', index), row.batchId ?? null, asNumber(row.rowNumber), asJson(row.rawData ?? null), asJson(row.mappedData ?? null), row.status ?? null, row.errorMessage ?? null, asNumber(row.createdAt), asJson(row)],
  },
  {
    snapshotKey: 'appSettings',
    table: 'inventory_app_settings',
    insertSql: `insert into inventory_app_settings (setting_key, setting_value, raw) values ($1,$2,$3::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_app_setting', index), row.value ?? null, asJson(row)],
  },
  {
    snapshotKey: 'posSales',
    table: 'inventory_pos_sales',
    insertSql: `insert into inventory_pos_sales (id, transaction_id, cashier_id, outlet_id, created_at_text, total, paid, change_amount, payload, received_at_ms, raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_pos_sale', index), row.transactionId ?? null, row.cashierId ?? null, row.outletId ?? null, row.createdAt ?? null, asNumber(row.total), asNumber(row.paid), asNumber(row.change), asJson(row.payload ? safeJsonParse(row.payload) : null), asNumber(row.receivedAt), asJson(row)],
  },
  {
    snapshotKey: 'realtimeSyncLogs',
    table: 'inventory_realtime_sync_logs',
    insertSql: `insert into inventory_realtime_sync_logs (id, direction, event_type, status, message, created_at_ms, raw) values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    values: (row, index) => [rowId(row, 'inventory_realtime_log', index), row.direction ?? null, row.eventType ?? null, row.status ?? null, row.message ?? null, asNumber(row.createdAt), asJson(row)],
  },
];

function snapshotState() {
  return {
    latestCatalogEvent: state.latestCatalogEvent,
    latestPosSnapshotEvent: state.latestPosSnapshotEvent,
    salesEvents: state.salesEvents,
    stockEvents: state.stockEvents,
    eventIds: state.eventIds
  };
}

async function ensureDatabase() {
  if (!pool) return;

  await pool.query(`
    create table if not exists sync_state (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    );

    create table if not exists cloud_snapshot_meta (
      domain text primary key,
      snapshot_type text not null,
      event_id text,
      source text,
      source_device_id text,
      source_client_id text,
      created_at timestamptz,
      received_at timestamptz,
      payload_meta jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );

    create table if not exists sync_event_ids (
      event_id text primary key,
      seen_at timestamptz not null default now()
    );

    create table if not exists sync_sales_events (
      event_id text primary key,
      entity_id text,
      source text,
      source_client_id text,
      payload jsonb not null,
      created_at timestamptz,
      received_at timestamptz not null default now(),
      raw jsonb not null
    );

    create table if not exists sync_stock_events (
      event_id text primary key,
      entity_id text,
      source text,
      source_client_id text,
      payload jsonb not null,
      created_at timestamptz,
      received_at timestamptz not null default now(),
      raw jsonb not null
    );

    create table if not exists pos_users (id text primary key, name text, role_id text, role text, pin text, phone text, email text, position_title text, profile_note text, is_active boolean, created_at timestamptz, raw jsonb not null);
    create table if not exists pos_roles (id text primary key, name text, description text, permissions jsonb not null default '[]'::jsonb, raw jsonb not null);
    create table if not exists pos_permissions (id text primary key, code text, name text, raw jsonb not null);
    create table if not exists pos_outlets (id text primary key, name text, address text, phone text, is_default boolean, created_at timestamptz, raw jsonb not null);
    create table if not exists pos_products (id text primary key, sku text, barcode text, name text, category text, brand text, is_active boolean, source text, updated_at timestamptz, raw jsonb not null);
    create table if not exists pos_product_units (id text primary key, product_id text, unit_name text, conversion_to_base numeric, active_selling_price numeric, cost_price numeric, effective_date text, raw jsonb not null);
    create table if not exists pos_product_barcodes (id text primary key, product_id text, unit_id text, barcode text, raw jsonb not null);
    create table if not exists pos_stock_balances (id text primary key, product_id text, outlet_id text, qty numeric, low_stock_threshold numeric, last_updated timestamptz, raw jsonb not null);
    create table if not exists pos_stock_movements (id text primary key, product_id text, unit_id text, outlet_id text, movement_type text, qty_change numeric, created_at timestamptz, reference_id text, note text, raw jsonb not null);
    create table if not exists pos_transactions (id text primary key, cashier_id text, outlet_id text, shift_id text, customer_id text, created_at timestamptz, subtotal numeric, discount_total numeric, tax_total numeric, total numeric, paid numeric, change_amount numeric, status text, sync_status text, raw jsonb not null);
    create table if not exists pos_transaction_items (id text primary key, transaction_id text, product_id text, product_name text, unit_id text, unit_name text, qty numeric, unit_price numeric, discount numeric, subtotal numeric, raw jsonb not null);
    create table if not exists pos_payments (id text primary key, transaction_id text, method text, amount numeric, raw jsonb not null);
    create table if not exists pos_shifts (id text primary key, cashier_id text, outlet_id text, opened_at timestamptz, closed_at timestamptz, starting_cash numeric, expected_cash numeric, actual_cash numeric, difference numeric, status text, raw jsonb not null);
    create table if not exists pos_cash_movements (id text primary key, shift_id text, cashier_id text, outlet_id text, movement_type text, amount numeric, note text, created_at timestamptz, raw jsonb not null);
    create table if not exists pos_customers (id text primary key, name text, phone text, notes text, address text, points numeric, created_at timestamptz, raw jsonb not null);
    create table if not exists pos_sync_logs (id text primary key, log_type text, status text, records_processed numeric, message text, created_at timestamptz, raw jsonb not null);
    create table if not exists pos_sync_queue (id text primary key, entity text, entity_id text, operation text, payload jsonb, status text, retry_count numeric, last_error text, created_at timestamptz, updated_at timestamptz, raw jsonb not null);
    create table if not exists pos_audit_logs (id text primary key, user_id text, action text, entity text, entity_id text, metadata jsonb, created_at timestamptz, raw jsonb not null);
    create table if not exists pos_app_settings (setting_key text primary key, setting_value text, updated_at timestamptz, raw jsonb not null);

    create table if not exists inventory_categories (id text primary key, name text, is_active boolean, raw jsonb not null);
    create table if not exists inventory_brands (id text primary key, name text, is_active boolean, raw jsonb not null);
    create table if not exists inventory_suppliers (id text primary key, name text, phone text, address text, is_active boolean, raw jsonb not null);
    create table if not exists inventory_products (id text primary key, sku text, name text, category_id text, brand_id text, supplier_id text, barcode text, pricing_mode text, is_active boolean, notes text, raw jsonb not null);
    create table if not exists inventory_product_units (id text primary key, product_id text, unit_name text, conversion_to_base numeric, manual_cost numeric, active_selling_price numeric, min_selling_price numeric, max_selling_price numeric, raw jsonb not null);
    create table if not exists inventory_margin_rules (id text primary key, rule_type text, reference_id text, margin_percent numeric, priority numeric, effective_from text, effective_until text, is_active boolean, raw jsonb not null);
    create table if not exists inventory_price_calculations (id text primary key, product_id text, product_unit_id text, status text, input_cost numeric, ppn_mode text, ppn_rate numeric, base_cost numeric, ppn_amount numeric, final_cost numeric, margin_percent numeric, calculated_price numeric, rounded_price numeric, recommended_price numeric, estimated_profit numeric, actual_margin numeric, min_price numeric, max_price numeric, effective_date text, change_reason text, created_by text, approved_by text, approved_at_ms numeric, rejected_by text, rejected_at_ms numeric, rejection_reason text, created_at_ms numeric, updated_at_ms numeric, raw jsonb not null);
    create table if not exists inventory_price_histories (id text primary key, product_id text, product_unit_id text, old_cost numeric, new_cost numeric, old_price numeric, new_price numeric, old_margin numeric, new_margin numeric, old_ppn_mode text, new_ppn_mode text, old_ppn_amount numeric, new_ppn_amount numeric, pricing_mode text, change_reason text, effective_date text, changed_by text, approved_by text, approved_at_ms numeric, created_at_ms numeric, raw jsonb not null);
    create table if not exists inventory_product_unit_cost_histories (id text primary key, product_id text, product_unit_id text, supplier_id text, input_cost numeric, ppn_mode text, ppn_rate numeric, base_cost numeric, ppn_amount numeric, final_cost numeric, previous_final_cost numeric, source text, effective_date text, reference_number text, notes text, created_by text, import_batch_id text, created_at_ms numeric, raw jsonb not null);
    create table if not exists inventory_csv_import_batches (id text primary key, file_name text, import_type text, status text, total_rows numeric, valid_rows numeric, invalid_rows numeric, created_at_ms numeric, imported_at_ms numeric, error_message text, raw jsonb not null);
    create table if not exists inventory_csv_import_rows (id text primary key, batch_id text, row_number numeric, raw_data jsonb, mapped_data jsonb, status text, error_message text, created_at_ms numeric, raw jsonb not null);
    create table if not exists inventory_app_settings (setting_key text primary key, setting_value text, raw jsonb not null);
    create table if not exists inventory_pos_sales (id text primary key, transaction_id text, cashier_id text, outlet_id text, created_at_text text, total numeric, paid numeric, change_amount numeric, payload jsonb, received_at_ms numeric, raw jsonb not null);
    create table if not exists inventory_realtime_sync_logs (id text primary key, direction text, event_type text, status text, message text, created_at_ms numeric, raw jsonb not null);

    create index if not exists idx_pos_transactions_created_at on pos_transactions (created_at);
    create index if not exists idx_pos_transactions_cashier_id on pos_transactions (cashier_id);
    create index if not exists idx_pos_shifts_cashier_status on pos_shifts (cashier_id, status);
    create index if not exists idx_inventory_products_barcode on inventory_products (barcode);
    create index if not exists idx_inventory_price_calculations_status on inventory_price_calculations (status);
    create index if not exists idx_sync_sales_received_at on sync_sales_events (received_at);
  `);
}

async function loadState() {
  if (pool) {
    await ensureDatabase();
    const legacyResult = await pool.query('select value from sync_state where key = $1', ['realtime']);
    const legacyState = legacyResult.rows[0]?.value || null;
    await migrateLegacyStateIfNeeded(legacyState);

    state.latestCatalogEvent = await buildSnapshotEventFromPostgres('inventory');
    state.latestPosSnapshotEvent = await buildSnapshotEventFromPostgres('pos');
    state.salesEvents = await loadRealtimeEventsFromPostgres('sync_sales_events');
    state.stockEvents = await loadRealtimeEventsFromPostgres('sync_stock_events');
    state.eventIds = await loadEventIdsFromPostgres();

    if (!state.latestCatalogEvent && legacyState?.latestCatalogEvent) state.latestCatalogEvent = legacyState.latestCatalogEvent;
    if (!state.latestPosSnapshotEvent && legacyState?.latestPosSnapshotEvent) state.latestPosSnapshotEvent = legacyState.latestPosSnapshotEvent;
    if (state.salesEvents.length === 0 && legacyState?.salesEvents) state.salesEvents = legacyState.salesEvents;
    if (state.stockEvents.length === 0 && legacyState?.stockEvents) state.stockEvents = legacyState.stockEvents;
    if (Object.keys(state.eventIds).length === 0 && legacyState?.eventIds) state.eventIds = legacyState.eventIds;
    return;
  }

  try {
    const raw = await readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    state.latestCatalogEvent = parsed.latestCatalogEvent || null;
    state.latestPosSnapshotEvent = parsed.latestPosSnapshotEvent || null;
    state.salesEvents = parsed.salesEvents || [];
    state.stockEvents = parsed.stockEvents || [];
    state.eventIds = parsed.eventIds || {};
  } catch {
    await mkdir(dataDir, { recursive: true });
  }
}

async function persistState() {
  if (pool) {
    await ensureDatabase();
    await pool.query(
      `
        insert into sync_state (key, value, updated_at)
        values ($1, $2::jsonb, now())
        on conflict (key)
        do update set value = excluded.value, updated_at = now()
      `,
      ['realtime', JSON.stringify(snapshotState())]
    );
    await persistEventIdsToPostgres(state.eventIds);
    await persistRealtimeEventsToPostgres('sync_sales_events', state.salesEvents, event => event.payload?.transaction_id ?? event.entity_id ?? null);
    await persistRealtimeEventsToPostgres('sync_stock_events', state.stockEvents, event => event.payload?.stock_movement_id ?? event.entity_id ?? null);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2));
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(message, predicate = () => true) {
  for (const [socket, client] of clients.entries()) {
    if (predicate(client)) send(socket, message);
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

function safeJsonParse(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function setCors(response) {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type,authorization,x-sync-token');
}

function sendJson(response, statusCode, payload) {
  setCors(response);
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request) {
  if (!apiToken) return true;
  const authorization = request.headers.authorization || '';
  const token = request.headers['x-sync-token'] || '';
  return authorization === `Bearer ${apiToken}` || token === apiToken;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function rememberEvent(eventId) {
  if (!eventId) return false;
  if (state.eventIds[eventId]) return true;
  state.eventIds[eventId] = new Date().toISOString();
  return false;
}

function buildHelloState(client) {
  return {
    type: 'server.state',
    server_time: new Date().toISOString(),
    latest_catalog: client.app === 'pos' ? state.latestCatalogEvent : null,
    latest_pos_snapshot: client.app === 'pos' ? state.latestPosSnapshotEvent : null,
    pending_sales: client.app === 'inventory' ? state.salesEvents.slice(-250) : [],
    pending_stock: client.app === 'inventory' ? state.stockEvents.slice(-250) : []
  };
}

function getPosSnapshotStats(snapshot) {
  if (!snapshot) {
    return {
      records: 0,
      transactions: 0,
      shifts: 0,
      cash_movements: 0,
      customers: 0,
      products: 0
    };
  }

  const tables = [
    snapshot.users,
    snapshot.roles,
    snapshot.permissions,
    snapshot.outlets,
    snapshot.products,
    snapshot.productUnits,
    snapshot.productBarcodes,
    snapshot.stockBalances,
    snapshot.stockMovements,
    snapshot.transactions,
    snapshot.transactionItems,
    snapshot.payments,
    snapshot.shifts,
    snapshot.cashMovements,
    snapshot.customers,
    snapshot.syncLogs,
    snapshot.syncQueue,
    snapshot.auditLogs,
    snapshot.appSettings
  ];

  return {
    records: tables.reduce((total, table) => total + (Array.isArray(table) ? table.length : 0), 0),
    transactions: snapshot.transactions?.length || 0,
    shifts: snapshot.shifts?.length || 0,
    cash_movements: snapshot.cashMovements?.length || 0,
    customers: snapshot.customers?.length || 0,
    products: snapshot.products?.length || 0
  };
}

function getInventorySnapshotStats(snapshot) {
  if (!snapshot) {
    return {
      records: 0,
      products: 0,
      product_units: 0,
      price_calculations: 0,
      price_histories: 0
    };
  }

  const tables = [
    snapshot.categories,
    snapshot.brands,
    snapshot.suppliers,
    snapshot.products,
    snapshot.productUnits,
    snapshot.marginRules,
    snapshot.priceCalculations,
    snapshot.priceHistories,
    snapshot.productUnitCostHistories,
    snapshot.csvImportBatches,
    snapshot.csvImportRows,
    snapshot.appSettings,
    snapshot.posSales,
    snapshot.realtimeSyncLogs
  ];

  return {
    records: tables.reduce((total, table) => total + (Array.isArray(table) ? table.length : 0), 0),
    products: snapshot.products?.length || 0,
    product_units: snapshot.productUnits?.length || 0,
    price_calculations: snapshot.priceCalculations?.length || 0,
    price_histories: snapshot.priceHistories?.length || 0
  };
}

function snapshotTableConfigs(domain) {
  return domain === 'pos' ? POS_TABLES : INVENTORY_TABLES;
}

function orderColumnForConfig(config) {
  return config.table.endsWith('_app_settings') ? 'setting_key' : 'id';
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return asTimestamp(value) || String(value);
}

async function replaceSnapshotRows(client, configs, snapshot) {
  for (const config of configs) {
    await client.query(`delete from ${config.table}`);
    const rows = Array.isArray(snapshot?.[config.snapshotKey]) ? snapshot[config.snapshotKey] : [];

    for (const [index, row] of rows.entries()) {
      await client.query(config.insertSql, config.values(row ?? {}, index));
    }
  }
}

async function saveSnapshotMeta(client, domain, event) {
  const payload = event.payload || {};
  const receivedAt = event.received_at || new Date().toISOString();
  const payloadMeta = domain === 'pos'
    ? {
        schemaVersion: payload.schemaVersion ?? 1,
        exportedAt: payload.exportedAt ?? event.created_at ?? receivedAt,
        sourceDeviceId: payload.sourceDeviceId ?? event.source_device_id ?? null
      }
    : {
        exportedAt: payload.exportedAt ?? event.created_at ?? receivedAt
      };

  await client.query(
    `
      insert into cloud_snapshot_meta (
        domain, snapshot_type, event_id, source, source_device_id, source_client_id,
        created_at, received_at, payload_meta, updated_at
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
      on conflict (domain)
      do update set
        snapshot_type = excluded.snapshot_type,
        event_id = excluded.event_id,
        source = excluded.source,
        source_device_id = excluded.source_device_id,
        source_client_id = excluded.source_client_id,
        created_at = excluded.created_at,
        received_at = excluded.received_at,
        payload_meta = excluded.payload_meta,
        updated_at = now()
    `,
    [
      domain,
      event.type || (domain === 'pos' ? 'pos.snapshot' : 'catalog.snapshot'),
      event.event_id ?? null,
      event.source ?? null,
      event.source_device_id ?? payload.sourceDeviceId ?? null,
      event.source_client_id ?? null,
      asTimestamp(event.created_at),
      asTimestamp(receivedAt),
      asJson(payloadMeta)
    ]
  );
}

async function persistSnapshotToPostgres(domain, event) {
  if (!pool || !event?.payload) return;

  await ensureDatabase();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await replaceSnapshotRows(client, snapshotTableConfigs(domain), event.payload);
    await saveSnapshotMeta(client, domain, event);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function readSnapshotRowsFromPostgres(config) {
  const orderColumn = orderColumnForConfig(config);
  const result = await pool.query(`select raw from ${config.table} order by ${orderColumn}`);
  return result.rows.map((row) => row.raw);
}

async function readSnapshotMeta(domain) {
  const result = await pool.query('select * from cloud_snapshot_meta where domain = $1', [domain]);
  return result.rows[0] || null;
}

async function buildSnapshotFromPostgres(domain) {
  const snapshot = {};
  for (const config of snapshotTableConfigs(domain)) {
    snapshot[config.snapshotKey] = await readSnapshotRowsFromPostgres(config);
  }

  const meta = await readSnapshotMeta(domain);
  const payloadMeta = meta?.payload_meta || {};
  const exportedAt = payloadMeta.exportedAt || toIso(meta?.updated_at) || new Date().toISOString();

  if (domain === 'pos') {
    return {
      schemaVersion: payloadMeta.schemaVersion ?? 1,
      exportedAt,
      sourceDeviceId: payloadMeta.sourceDeviceId ?? meta?.source_device_id ?? null,
      ...snapshot
    };
  }

  return {
    exportedAt,
    ...snapshot
  };
}

async function buildSnapshotEventFromPostgres(domain) {
  const meta = await readSnapshotMeta(domain);
  const snapshot = await buildSnapshotFromPostgres(domain);
  const stats = domain === 'pos' ? getPosSnapshotStats(snapshot) : getInventorySnapshotStats(snapshot);

  if (!meta && stats.records === 0) return null;

  return {
    type: meta?.snapshot_type || (domain === 'pos' ? 'pos.snapshot' : 'catalog.snapshot'),
    event_id: meta?.event_id || `${domain}_snapshot_from_postgres`,
    source: meta?.source || (domain === 'pos' ? 'integrated-pos-app' : 'inventory-pricing-app'),
    source_device_id: meta?.source_device_id || snapshot.sourceDeviceId || null,
    payload: snapshot,
    created_at: toIso(meta?.created_at) || snapshot.exportedAt,
    received_at: toIso(meta?.received_at) || toIso(meta?.updated_at) || snapshot.exportedAt,
    source_client_id: meta?.source_client_id || 'postgres'
  };
}

async function loadEventIdsFromPostgres() {
  const result = await pool.query('select event_id, seen_at from sync_event_ids');
  return result.rows.reduce((acc, row) => {
    acc[row.event_id] = toIso(row.seen_at) || new Date().toISOString();
    return acc;
  }, {});
}

async function persistEventIdsToPostgres(eventIds) {
  for (const [eventId, seenAt] of Object.entries(eventIds || {})) {
    await pool.query(
      `
        insert into sync_event_ids (event_id, seen_at)
        values ($1,$2)
        on conflict (event_id) do nothing
      `,
      [eventId, asTimestamp(seenAt) || new Date().toISOString()]
    );
  }
}

async function loadRealtimeEventsFromPostgres(table) {
  const result = await pool.query(
    `
      select raw
      from (
        select raw, received_at
        from ${table}
        order by received_at desc
        limit 1000
      ) recent
      order by received_at asc
    `
  );
  return result.rows.map((row) => row.raw);
}

async function persistRealtimeEventsToPostgres(table, events, entityIdFromEvent) {
  for (const event of events || []) {
    const eventId = event.event_id;
    if (!eventId) continue;

    await pool.query(
      `
        insert into ${table} (event_id, entity_id, source, source_client_id, payload, created_at, received_at, raw)
        values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)
        on conflict (event_id)
        do update set
          entity_id = excluded.entity_id,
          source = excluded.source,
          source_client_id = excluded.source_client_id,
          payload = excluded.payload,
          created_at = excluded.created_at,
          received_at = excluded.received_at,
          raw = excluded.raw
      `,
      [
        eventId,
        entityIdFromEvent(event),
        event.source ?? null,
        event.source_client_id ?? null,
        asJson(event.payload ?? null),
        asTimestamp(event.created_at),
        asTimestamp(event.received_at) || new Date().toISOString(),
        asJson(event)
      ]
    );
  }
}

async function migrateLegacyStateIfNeeded(legacy) {
  if (!legacy) return;

  const metaCount = Number((await pool.query('select count(*)::int as count from cloud_snapshot_meta')).rows[0]?.count || 0);
  if (metaCount === 0) {
    if (legacy.latestCatalogEvent?.payload) {
      await persistSnapshotToPostgres('inventory', legacy.latestCatalogEvent);
    }
    if (legacy.latestPosSnapshotEvent?.payload) {
      await persistSnapshotToPostgres('pos', legacy.latestPosSnapshotEvent);
    }
  }

  const eventCount = Number((await pool.query('select count(*)::int as count from sync_event_ids')).rows[0]?.count || 0);
  if (eventCount === 0) {
    await persistEventIdsToPostgres(legacy.eventIds || {});
    await persistRealtimeEventsToPostgres('sync_sales_events', legacy.salesEvents || [], event => event.payload?.transaction_id ?? event.entity_id ?? null);
    await persistRealtimeEventsToPostgres('sync_stock_events', legacy.stockEvents || [], event => event.payload?.stock_movement_id ?? event.entity_id ?? null);
  }
}

async function refreshSnapshotStateFromPostgres() {
  if (!pool) return;
  state.latestCatalogEvent = await buildSnapshotEventFromPostgres('inventory');
  state.latestPosSnapshotEvent = await buildSnapshotEventFromPostgres('pos');
}

await loadState();

const httpServer = createServer(async (request, response) => {
  setCors(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    await refreshSnapshotStateFromPostgres();
    const posSnapshot = state.latestPosSnapshotEvent?.payload || null;
    const inventorySnapshot = state.latestCatalogEvent?.payload || null;
    sendJson(response, 200, {
      ok: true,
      service: 'integrated-pos-sync-server',
      storage: pool ? 'postgres' : 'file',
      latest_catalog: Boolean(state.latestCatalogEvent),
      latest_pos_snapshot: Boolean(state.latestPosSnapshotEvent),
      pos_snapshot_stats: getPosSnapshotStats(posSnapshot),
      inventory_snapshot_stats: getInventorySnapshotStats(inventorySnapshot),
      sales_events: state.salesEvents.length
    });
    return;
  }

  if (url.pathname.startsWith('/api/') && !isAuthorized(request)) {
    sendJson(response, 401, { ok: false, message: 'Unauthorized' });
    return;
  }

  if (url.pathname === '/api/state' && request.method === 'GET') {
    await refreshSnapshotStateFromPostgres();
    const posSnapshot = state.latestPosSnapshotEvent?.payload || null;
    const inventorySnapshot = state.latestCatalogEvent?.payload || null;
    sendJson(response, 200, {
      ok: true,
      latest_catalog: Boolean(state.latestCatalogEvent),
      latest_pos_snapshot: Boolean(state.latestPosSnapshotEvent),
      pos_snapshot_updated_at: state.latestPosSnapshotEvent?.received_at || state.latestPosSnapshotEvent?.created_at || null,
      pos_snapshot_stats: getPosSnapshotStats(posSnapshot),
      inventory_snapshot_updated_at: state.latestCatalogEvent?.received_at || state.latestCatalogEvent?.created_at || null,
      inventory_snapshot_stats: getInventorySnapshotStats(inventorySnapshot),
      sales_events: state.salesEvents.length,
      stock_events: state.stockEvents.length,
      event_ids: Object.keys(state.eventIds).length,
      storage: pool ? 'postgres' : 'file'
    });
    return;
  }

  if (url.pathname === '/api/pos/snapshot' && request.method === 'GET') {
    await refreshSnapshotStateFromPostgres();
    const snapshot = state.latestPosSnapshotEvent?.payload || null;
    sendJson(response, 200, {
      ok: true,
      event: state.latestPosSnapshotEvent,
      snapshot,
      stats: getPosSnapshotStats(snapshot),
      updated_at: state.latestPosSnapshotEvent?.received_at || state.latestPosSnapshotEvent?.created_at || null
    });
    return;
  }

  if (url.pathname === '/api/pos/snapshot' && (request.method === 'POST' || request.method === 'PUT')) {
    try {
      const body = await readJsonBody(request);
      const receivedAt = new Date().toISOString();
      const event = body?.type === 'pos.snapshot'
        ? body
        : {
            type: 'pos.snapshot',
            event_id: body?.event_id || `pos_snapshot_${Date.now()}_${crypto.randomUUID()}`,
            source: body?.source || 'integrated-pos-app',
            source_device_id: body?.source_device_id || body?.payload?.sourceDeviceId || null,
            payload: body?.payload || body,
            created_at: body?.created_at || receivedAt
          };
      event.source_device_id = event.source_device_id || event.payload?.sourceDeviceId || null;

      const duplicate = rememberEvent(event.event_id);
      if (!duplicate) {
        state.latestPosSnapshotEvent = {
          ...event,
          received_at: receivedAt,
          source_client_id: 'http-api'
        };
        await persistSnapshotToPostgres('pos', state.latestPosSnapshotEvent);
        await persistState();
      }

      if (state.latestPosSnapshotEvent) {
        broadcast(state.latestPosSnapshotEvent, (target) => target.app === 'pos');
      }
      const updatedAt = state.latestPosSnapshotEvent?.received_at || state.latestPosSnapshotEvent?.created_at || receivedAt;
      sendJson(response, 200, {
        ok: true,
        duplicate,
        event_id: event.event_id,
        updated_at: updatedAt,
        source_device_id: event.source_device_id || null,
        stats: getPosSnapshotStats(event.payload)
      });
    } catch (error) {
      console.error(error);
      sendJson(response, 400, { ok: false, message: 'Invalid POS snapshot payload' });
    }
    return;
  }

  if (url.pathname === '/api/inventory/snapshot' && request.method === 'GET') {
    await refreshSnapshotStateFromPostgres();
    sendJson(response, 200, {
      ok: true,
      event: state.latestCatalogEvent,
      snapshot: state.latestCatalogEvent?.payload || null,
      updated_at: state.latestCatalogEvent?.received_at || state.latestCatalogEvent?.created_at || null
    });
    return;
  }

  if (url.pathname === '/api/inventory/snapshot' && (request.method === 'POST' || request.method === 'PUT')) {
    try {
      const body = await readJsonBody(request);
      const event = body?.type === 'catalog.snapshot'
        ? body
        : {
            type: 'catalog.snapshot',
            event_id: body?.event_id || `catalog_${Date.now()}_${crypto.randomUUID()}`,
            source: body?.source || 'inventory-pricing-app',
            payload: body?.payload || body,
            created_at: body?.created_at || new Date().toISOString()
          };

      const duplicate = rememberEvent(event.event_id);
      if (!duplicate) {
        state.latestCatalogEvent = {
          ...event,
          received_at: new Date().toISOString(),
          source_client_id: 'http-api'
        };
        await persistSnapshotToPostgres('inventory', state.latestCatalogEvent);
        await persistState();
      }

      broadcast(state.latestCatalogEvent, (target) => target.app === 'pos');
      sendJson(response, 200, {
        ok: true,
        duplicate,
        event_id: event.event_id,
        products: event.payload?.products?.length || 0
      });
    } catch (error) {
      console.error(error);
      sendJson(response, 400, { ok: false, message: 'Invalid snapshot payload' });
    }
    return;
  }

  if (url.pathname === '/api/pos/sales' && request.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') || 250);
    sendJson(response, 200, {
      ok: true,
      sales: state.salesEvents.slice(-Math.min(Math.max(limit, 1), 1000))
    });
    return;
  }

  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('Integrated POS realtime sync server. Use WebSocket clients to connect.\n');
});

const server = new WebSocketServer({ server: httpServer });

server.on('connection', (socket) => {
  const client = {
    id: crypto.randomUUID(),
    app: 'unknown',
    name: 'Unknown client',
    connected_at: new Date().toISOString()
  };
  clients.set(socket, client);

  send(socket, {
    type: 'server.ready',
    client_id: client.id,
    server_time: new Date().toISOString()
  });

  socket.on('message', async (raw) => {
    const message = safeParse(raw);
    if (!message || typeof message.type !== 'string') {
      send(socket, { type: 'error', message: 'Invalid message' });
      return;
    }

    if (message.type === 'client.hello') {
      client.app = message.app || 'unknown';
      client.name = message.client_name || client.name;
      client.outlet_id = message.outlet_id;
      send(socket, buildHelloState(client));
      console.log(`[hello] ${client.app} ${client.name}`);
      return;
    }

    if (message.type === 'sync.request_state') {
      send(socket, buildHelloState(client));
      return;
    }

    if (message.type === 'catalog.snapshot') {
      const duplicate = rememberEvent(message.event_id);
      if (!duplicate) {
        state.latestCatalogEvent = {
          ...message,
          received_at: new Date().toISOString(),
          source_client_id: client.id
        };
        await persistSnapshotToPostgres('inventory', state.latestCatalogEvent);
        await persistState();
      }

      send(socket, {
        type: 'ack',
        event_id: message.event_id,
        entity: 'catalog',
        status: 'ACCEPTED',
        duplicate
      });
      broadcast(state.latestCatalogEvent, (target) => target.app === 'pos');
      console.log(`[catalog] ${duplicate ? 'duplicate' : 'accepted'} ${message.event_id || ''}`);
      return;
    }

    if (message.type === 'sale.created') {
      const duplicate = rememberEvent(message.event_id);
      if (!duplicate) {
        state.salesEvents.push({
          ...message,
          received_at: new Date().toISOString(),
          source_client_id: client.id
        });
        state.salesEvents = state.salesEvents.slice(-1000);
        await persistState();
      }

      send(socket, {
        type: 'ack',
        event_id: message.event_id,
        entity: 'transaction',
        entity_id: message.payload?.transaction_id,
        status: 'ACCEPTED',
        duplicate
      });
      broadcast(message, (target) => target.app === 'inventory');
      console.log(`[sale] ${duplicate ? 'duplicate' : 'accepted'} ${message.payload?.transaction_id || ''}`);
      return;
    }

    if (message.type === 'stock.movement') {
      const duplicate = rememberEvent(message.event_id);
      if (!duplicate) {
        state.stockEvents.push({
          ...message,
          received_at: new Date().toISOString(),
          source_client_id: client.id
        });
        state.stockEvents = state.stockEvents.slice(-1000);
        await persistState();
      }

      send(socket, {
        type: 'ack',
        event_id: message.event_id,
        entity: 'stock_movement',
        status: 'ACCEPTED',
        duplicate
      });
      broadcast(message, (target) => target.app === 'inventory');
      return;
    }

    send(socket, { type: 'error', message: `Unknown message type: ${message.type}` });
  });

  socket.on('close', () => {
    clients.delete(socket);
    console.log(`[close] ${client.app} ${client.name}`);
  });
});

httpServer.listen(port, () => {
  console.log(`Integrated POS realtime sync server listening on port ${port}`);
});
