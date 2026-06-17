import Dexie, { type EntityTable } from 'dexie';

export type RoleName = 'Owner' | 'Admin' | 'Supervisor' | 'Kasir';
export type PaymentMethod = 'cash' | 'qris' | 'transfer' | 'edc';
export type TransactionStatus = 'COMPLETED' | 'HELD' | 'VOIDED' | 'REFUNDED';
export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED';
export type StockMovementType = 'SALE' | 'REFUND' | 'VOID' | 'ADJUSTMENT' | 'IMPORT' | 'SYNC';
export type CashMovementType = 'CASH_IN' | 'CASH_OUT';
export type PermissionCode =
  | 'dashboard:view'
  | 'pos:use'
  | 'products:read'
  | 'products:manage'
  | 'stock:read'
  | 'stock:manage'
  | 'shift:manage'
  | 'reports:view'
  | 'customers:manage'
  | 'sync:manage'
  | 'settings:manage'
  | 'discount:apply'
  | 'void:manage'
  | 'refund:manage'
  | 'cash:manage'
  | 'users:manage'
  | 'receipt:print';

export interface Role {
  id: string;
  name: RoleName;
  description: string;
  permissions: PermissionCode[];
}

export interface Permission {
  id: string;
  code: PermissionCode;
  name: string;
}

export interface User {
  id: string;
  name: string;
  role_id: string;
  role: RoleName;
  pin: string;
  is_active: boolean;
  created_at: string;
}

export interface Outlet {
  id: string;
  name: string;
  address: string;
  phone: string;
  is_default: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  brand: string;
  is_active: boolean;
  source: 'LOCAL' | 'INVENTORY_PRICING_APP';
  updated_at: string;
}

export interface ProductUnit {
  id: string;
  product_id: string;
  unit_name: string;
  conversion_to_base: number;
  active_selling_price: number;
  cost_price: number;
  effective_date: string;
}

export interface ProductBarcode {
  id: string;
  product_id: string;
  unit_id?: string;
  barcode: string;
}

export interface StockBalance {
  id: string;
  product_id: string;
  outlet_id: string;
  qty: number;
  low_stock_threshold: number;
  last_updated: string;
}

export interface StockMovement {
  id: string;
  product_id: string;
  unit_id?: string;
  outlet_id: string;
  type: StockMovementType;
  qty_change: number;
  created_at: string;
  reference_id?: string;
  note?: string;
}

export interface Transaction {
  id: string;
  cashier_id: string;
  outlet_id: string;
  shift_id?: string;
  customer_id?: string;
  created_at: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  paid: number;
  change: number;
  status: TransactionStatus;
  sync_status: SyncStatus;
}

export interface TransactionItem {
  id: string;
  transaction_id: string;
  product_id: string;
  product_name: string;
  unit_id: string;
  unit_name: string;
  qty: number;
  unit_price: number;
  discount: number;
  subtotal: number;
}

export interface Payment {
  id: string;
  transaction_id: string;
  method: PaymentMethod;
  amount: number;
}

export interface Shift {
  id: string;
  cashier_id: string;
  outlet_id: string;
  opened_at: string;
  closed_at?: string;
  starting_cash: number;
  expected_cash?: number;
  actual_cash?: number;
  difference?: number;
  status: 'OPEN' | 'CLOSED';
}

export interface CashMovement {
  id: string;
  shift_id: string;
  cashier_id: string;
  outlet_id: string;
  type: CashMovementType;
  amount: number;
  note: string;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  notes?: string;
  address?: string;
  points: number;
  created_at: string;
}

export interface SyncLog {
  id: string;
  type: 'IMPORT_PRODUCT' | 'EXPORT_SALES' | 'IMPORT_CSV' | 'BACKUP_RESTORE';
  status: 'SUCCESS' | 'FAILED';
  records_processed: number;
  message: string;
  created_at: string;
}

export interface SyncQueue {
  id: string;
  entity: 'transaction' | 'stock_movement' | 'catalog';
  entity_id: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: string;
  status: SyncStatus;
  retry_count: number;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  entity: string;
  entity_id: string;
  metadata?: string;
  created_at: string;
}

export interface AppSetting {
  key: string;
  value: string;
  updated_at: string;
}

export class POSDatabase extends Dexie {
  users!: EntityTable<User, 'id'>;
  roles!: EntityTable<Role, 'id'>;
  permissions!: EntityTable<Permission, 'id'>;
  outlets!: EntityTable<Outlet, 'id'>;
  products!: EntityTable<Product, 'id'>;
  product_units!: EntityTable<ProductUnit, 'id'>;
  product_barcodes!: EntityTable<ProductBarcode, 'id'>;
  stock_balances!: EntityTable<StockBalance, 'id'>;
  stock_movements!: EntityTable<StockMovement, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  transaction_items!: EntityTable<TransactionItem, 'id'>;
  payments!: EntityTable<Payment, 'id'>;
  shifts!: EntityTable<Shift, 'id'>;
  cash_movements!: EntityTable<CashMovement, 'id'>;
  customers!: EntityTable<Customer, 'id'>;
  sync_logs!: EntityTable<SyncLog, 'id'>;
  sync_queue!: EntityTable<SyncQueue, 'id'>;
  audit_logs!: EntityTable<AuditLog, 'id'>;
  app_settings!: EntityTable<AppSetting, 'key'>;

  constructor() {
    super('IntegratedPOSAppDB');
    this.version(6).stores({
      users: 'id, role, role_id, pin',
      roles: 'id, name',
      permissions: 'id, code',
      outlets: 'id',
      products: 'id, sku, barcode, category, brand',
      product_units: 'id, product_id, unit_name',
      product_barcodes: 'id, barcode, product_id, unit_id',
      stock_balances: 'id, [product_id+outlet_id], product_id, outlet_id, qty',
      stock_movements: 'id, product_id, unit_id, outlet_id, type, created_at, reference_id',
      transactions: 'id, cashier_id, outlet_id, shift_id, created_at, status, sync_status',
      transaction_items: 'id, transaction_id, product_id',
      payments: 'id, transaction_id, method',
      shifts: 'id, [cashier_id+status], cashier_id, outlet_id, status, opened_at',
      cash_movements: 'id, shift_id, cashier_id, outlet_id, type, created_at',
      customers: 'id, name, phone',
      sync_logs: 'id, type, status, created_at',
      sync_queue: 'id, entity, entity_id, status, created_at',
      audit_logs: 'id, user_id, action, entity, created_at',
      app_settings: 'key'
    });
  }
}

export const db = new POSDatabase();

const now = () => new Date().toISOString();

export const DEFAULT_PERMISSIONS: Permission[] = [
  { id: 'perm_dashboard_view', code: 'dashboard:view', name: 'Lihat dashboard' },
  { id: 'perm_pos_use', code: 'pos:use', name: 'Gunakan kasir' },
  { id: 'perm_products_read', code: 'products:read', name: 'Lihat produk' },
  { id: 'perm_products_manage', code: 'products:manage', name: 'Kelola produk' },
  { id: 'perm_stock_read', code: 'stock:read', name: 'Lihat stok' },
  { id: 'perm_stock_manage', code: 'stock:manage', name: 'Kelola stok' },
  { id: 'perm_shift_manage', code: 'shift:manage', name: 'Kelola shift' },
  { id: 'perm_reports_view', code: 'reports:view', name: 'Lihat laporan' },
  { id: 'perm_customers_manage', code: 'customers:manage', name: 'Kelola pelanggan' },
  { id: 'perm_sync_manage', code: 'sync:manage', name: 'Sinkronisasi data' },
  { id: 'perm_settings_manage', code: 'settings:manage', name: 'Kelola pengaturan' },
  { id: 'perm_discount_apply', code: 'discount:apply', name: 'Beri diskon' },
  { id: 'perm_void_manage', code: 'void:manage', name: 'Void transaksi' },
  { id: 'perm_refund_manage', code: 'refund:manage', name: 'Refund transaksi' },
  { id: 'perm_cash_manage', code: 'cash:manage', name: 'Cash in/out' },
  { id: 'perm_users_manage', code: 'users:manage', name: 'Kelola user' },
  { id: 'perm_receipt_print', code: 'receipt:print', name: 'Cetak struk' }
];

const cashierPermissions: PermissionCode[] = ['dashboard:view', 'pos:use', 'shift:manage', 'customers:manage', 'receipt:print'];
const supervisorPermissions: PermissionCode[] = [
  ...cashierPermissions,
  'reports:view',
  'stock:read',
  'discount:apply',
  'void:manage',
  'refund:manage',
  'cash:manage'
];
const adminPermissions: PermissionCode[] = [
  'dashboard:view',
  'pos:use',
  'products:read',
  'products:manage',
  'stock:read',
  'stock:manage',
  'shift:manage',
  'reports:view',
  'customers:manage',
  'sync:manage',
  'settings:manage',
  'cash:manage',
  'receipt:print'
];
const ownerPermissions = DEFAULT_PERMISSIONS.map((permission) => permission.code);

export const DEFAULT_ROLES: Role[] = [
  { id: 'role_owner', name: 'Owner', description: 'Akses penuh seluruh aplikasi', permissions: ownerPermissions },
  { id: 'role_admin', name: 'Admin', description: 'Operasional toko, katalog, laporan, dan sync', permissions: adminPermissions },
  { id: 'role_supervisor', name: 'Supervisor', description: 'Kasir senior dengan otorisasi diskon, void, dan refund', permissions: supervisorPermissions },
  { id: 'role_kasir', name: 'Kasir', description: 'Transaksi kasir dan shift harian', permissions: cashierPermissions }
];

const DEFAULT_USERS: User[] = [
  { id: 'usr_owner', name: 'Budi Owner', role_id: 'role_owner', role: 'Owner', pin: '1111', is_active: true, created_at: now() },
  { id: 'usr_admin', name: 'Andi Admin', role_id: 'role_admin', role: 'Admin', pin: '2222', is_active: true, created_at: now() },
  { id: 'usr_spv', name: 'Siti Supervisor', role_id: 'role_supervisor', role: 'Supervisor', pin: '3333', is_active: true, created_at: now() },
  { id: 'usr_kasir1', name: 'Kasir Satu', role_id: 'role_kasir', role: 'Kasir', pin: '4444', is_active: true, created_at: now() },
  { id: 'usr_kasir2', name: 'Kasir Dua', role_id: 'role_kasir', role: 'Kasir', pin: '5555', is_active: true, created_at: now() }
];

const DEFAULT_OUTLET: Outlet = {
  id: 'outlet_001',
  name: 'Outlet Utama',
  address: 'Jl. Contoh Kasir No.123',
  phone: '08123456789',
  is_default: true,
  created_at: now()
};

const DEFAULT_SETTINGS: AppSetting[] = [
  { key: 'store_name', value: 'Integrated POS App', updated_at: now() },
  { key: 'store_address', value: 'Jl. Contoh Kasir No.123', updated_at: now() },
  { key: 'store_phone', value: '08123456789', updated_at: now() },
  { key: 'receipt_footer', value: 'Terima kasih atas kunjungan Anda', updated_at: now() },
  { key: 'tax_enabled', value: 'false', updated_at: now() },
  { key: 'tax_rate', value: '0', updated_at: now() },
  { key: 'integration_source', value: 'Inventory Pricing App', updated_at: now() }
];

export async function initializeDatabase() {
  await db.open();

  await db.transaction('rw', db.permissions, db.roles, db.users, db.outlets, db.app_settings, async () => {
    if ((await db.permissions.count()) === 0) {
      await db.permissions.bulkPut(DEFAULT_PERMISSIONS);
    }

    if ((await db.roles.count()) === 0) {
      await db.roles.bulkPut(DEFAULT_ROLES);
    }

    if ((await db.users.count()) === 0) {
      await db.users.bulkPut(DEFAULT_USERS);
    }

    if ((await db.outlets.count()) === 0) {
      await db.outlets.put(DEFAULT_OUTLET);
    }

    for (const setting of DEFAULT_SETTINGS) {
      if (!(await db.app_settings.get(setting.key))) {
        await db.app_settings.put(setting);
      }
    }
  });
}
