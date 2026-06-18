import { db, type AppSetting, type SyncQueue } from './db';
import { productService } from './productService';
import { authService } from './authService';

type ConnectionStatus = 'DISABLED' | 'CONNECTING' | 'CONNECTED' | 'OFFLINE' | 'ERROR';

interface RealtimeConfig {
  enabled: boolean;
  url: string;
  apiToken?: string;
}

const DEFAULT_URL = import.meta.env.VITE_SYNC_URL || 'wss://pos-server.up.railway.app';
const DEFAULT_API_TOKEN = import.meta.env.VITE_SYNC_API_TOKEN || 'kastur-sync-2026-Roid-Nawir-8xAq72Lm';
const LAST_POS_SNAPSHOT_SETTING = 'pos_cloud_snapshot_updated_at';
const POS_DEVICE_ID_SETTING = 'pos_cloud_device_id';
const POS_LOCAL_DIRTY_SETTING = 'pos_cloud_local_dirty';
const DEVICE_SETTING_KEYS = new Set([
  'realtime_enabled',
  'realtime_url',
  'realtime_api_token',
  LAST_POS_SNAPSHOT_SETTING,
  POS_DEVICE_ID_SETTING,
  POS_LOCAL_DIRTY_SETTING
]);
const DEFAULT_AUTO_PULL_INTERVAL_MS = 120000;
const DEFAULT_AUTO_PUSH_INTERVAL_MS = 60000;
const MIN_AUTO_PULL_INTERVAL_MS = 30000;
const MIN_AUTO_PUSH_INTERVAL_MS = 15000;
const listeners = new Set<(status: ConnectionStatus) => void>();

let socket: WebSocket | null = null;
let status: ConnectionStatus = 'DISABLED';
let reconnectTimer: number | undefined;
let cloudBackupTimer: number | undefined;
let cloudPullTimer: number | undefined;
let cloudPushTimer: number | undefined;
let cloudRestoreRunning = false;
let cloudBackupRunning = false;
let manualClose = false;

function emit(nextStatus: ConnectionStatus) {
  status = nextStatus;
  listeners.forEach((listener) => listener(status));
}

function parseMessage(event: MessageEvent) {
  try {
    return JSON.parse(event.data as string);
  } catch {
    return null;
  }
}

function toHttpUrl(url: string) {
  const trimmed = (url || DEFAULT_URL).trim().replace(/\/$/, '');
  if (trimmed.startsWith('wss://')) return `https://${trimmed.slice(6)}`;
  if (trimmed.startsWith('ws://')) return `http://${trimmed.slice(5)}`;
  return trimmed;
}

function getAutoPullIntervalMs() {
  const parsed = Number(import.meta.env.VITE_POS_CLOUD_PULL_INTERVAL_MS || DEFAULT_AUTO_PULL_INTERVAL_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AUTO_PULL_INTERVAL_MS;
  return Math.max(MIN_AUTO_PULL_INTERVAL_MS, parsed);
}

function getAutoPushIntervalMs() {
  const parsed = Number(import.meta.env.VITE_POS_CLOUD_PUSH_INTERVAL_MS || DEFAULT_AUTO_PUSH_INTERVAL_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AUTO_PUSH_INTERVAL_MS;
  return Math.max(MIN_AUTO_PUSH_INTERVAL_MS, parsed);
}

async function getDeviceId() {
  const existing = await db.app_settings.get(POS_DEVICE_ID_SETTING);
  if (existing?.value) return existing.value;

  const deviceId = `pos_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
  await db.app_settings.put({
    key: POS_DEVICE_ID_SETTING,
    value: deviceId,
    updated_at: new Date().toISOString()
  });
  return deviceId;
}

async function logSync(message: string, ok = true, type: 'EXPORT_SALES' | 'CLOUD_BACKUP' | 'CLOUD_RESTORE' | 'CLOUD_CATALOG' = 'EXPORT_SALES', records = 0) {
  await db.sync_logs.add({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    type,
    status: ok ? 'SUCCESS' : 'FAILED',
    records_processed: records,
    message,
    created_at: new Date().toISOString()
  });
}

async function buildPosSnapshot() {
  const appSettings = (await db.app_settings.toArray()).filter((setting) => !DEVICE_SETTING_KEYS.has(setting.key));
  const deviceId = await getDeviceId();

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sourceDeviceId: deviceId,
    users: await db.users.toArray(),
    roles: await db.roles.toArray(),
    permissions: await db.permissions.toArray(),
    outlets: await db.outlets.toArray(),
    products: await db.products.toArray(),
    productUnits: await db.product_units.toArray(),
    productBarcodes: await db.product_barcodes.toArray(),
    stockBalances: await db.stock_balances.toArray(),
    stockMovements: await db.stock_movements.toArray(),
    transactions: await db.transactions.toArray(),
    transactionItems: await db.transaction_items.toArray(),
    payments: await db.payments.toArray(),
    shifts: await db.shifts.toArray(),
    cashMovements: await db.cash_movements.toArray(),
    customers: await db.customers.toArray(),
    syncLogs: await db.sync_logs.toArray(),
    syncQueue: await db.sync_queue.toArray(),
    auditLogs: await db.audit_logs.toArray(),
    appSettings
  };
}

type PosSnapshot = Awaited<ReturnType<typeof buildPosSnapshot>>;

function countSnapshotRecords(snapshot: Partial<PosSnapshot>) {
  return [
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
  ].reduce((total, table) => total + (table?.length || 0), 0);
}

async function importPosSnapshot(snapshot: Partial<PosSnapshot>) {
  const existingDeviceSettings = (await db.app_settings.bulkGet(Array.from(DEVICE_SETTING_KEYS)))
    .filter((setting): setting is AppSetting => Boolean(setting));
  const appSettings = (snapshot.appSettings || []).filter((setting) => !DEVICE_SETTING_KEYS.has(setting.key));

  await db.transaction(
    'rw',
    [
      db.users,
      db.roles,
      db.permissions,
      db.outlets,
      db.products,
      db.product_units,
      db.product_barcodes,
      db.stock_balances,
      db.stock_movements,
      db.transactions,
      db.transaction_items,
      db.payments,
      db.shifts,
      db.cash_movements,
      db.customers,
      db.sync_logs,
      db.sync_queue,
      db.audit_logs,
      db.app_settings
    ],
    async () => {
      await Promise.all([
        db.users.clear(),
        db.roles.clear(),
        db.permissions.clear(),
        db.outlets.clear(),
        db.products.clear(),
        db.product_units.clear(),
        db.product_barcodes.clear(),
        db.stock_balances.clear(),
        db.stock_movements.clear(),
        db.transactions.clear(),
        db.transaction_items.clear(),
        db.payments.clear(),
        db.shifts.clear(),
        db.cash_movements.clear(),
        db.customers.clear(),
        db.sync_logs.clear(),
        db.sync_queue.clear(),
        db.audit_logs.clear(),
        db.app_settings.clear()
      ]);

      if (snapshot.users?.length) await db.users.bulkPut(snapshot.users);
      if (snapshot.roles?.length) await db.roles.bulkPut(snapshot.roles);
      if (snapshot.permissions?.length) await db.permissions.bulkPut(snapshot.permissions);
      if (snapshot.outlets?.length) await db.outlets.bulkPut(snapshot.outlets);
      if (snapshot.products?.length) await db.products.bulkPut(snapshot.products);
      if (snapshot.productUnits?.length) await db.product_units.bulkPut(snapshot.productUnits);
      if (snapshot.productBarcodes?.length) await db.product_barcodes.bulkPut(snapshot.productBarcodes);
      if (snapshot.stockBalances?.length) await db.stock_balances.bulkPut(snapshot.stockBalances);
      if (snapshot.stockMovements?.length) await db.stock_movements.bulkPut(snapshot.stockMovements);
      if (snapshot.transactions?.length) await db.transactions.bulkPut(snapshot.transactions);
      if (snapshot.transactionItems?.length) await db.transaction_items.bulkPut(snapshot.transactionItems);
      if (snapshot.payments?.length) await db.payments.bulkPut(snapshot.payments);
      if (snapshot.shifts?.length) await db.shifts.bulkPut(snapshot.shifts);
      if (snapshot.cashMovements?.length) await db.cash_movements.bulkPut(snapshot.cashMovements);
      if (snapshot.customers?.length) await db.customers.bulkPut(snapshot.customers);
      if (snapshot.syncLogs?.length) await db.sync_logs.bulkPut(snapshot.syncLogs);
      if (snapshot.syncQueue?.length) await db.sync_queue.bulkPut(snapshot.syncQueue);
      if (snapshot.auditLogs?.length) await db.audit_logs.bulkPut(snapshot.auditLogs);
      if (appSettings.length) await db.app_settings.bulkPut(appSettings);
      if (existingDeviceSettings.length) await db.app_settings.bulkPut(existingDeviceSettings);
    }
  );

  return {
    records: countSnapshotRecords(snapshot),
    transactions: snapshot.transactions?.length || 0,
    shifts: snapshot.shifts?.length || 0,
    cashMovements: snapshot.cashMovements?.length || 0,
    customers: snapshot.customers?.length || 0,
    products: snapshot.products?.length || 0
  };
}

async function markQueueAccepted(eventId: string) {
  const queued = await db.sync_queue.get(eventId);
  if (!queued) return;

  await db.transaction('rw', [db.sync_queue, db.transactions], async () => {
    await db.sync_queue.update(eventId, {
      status: 'SYNCED',
      updated_at: new Date().toISOString()
    });

    if (queued.entity === 'transaction') {
      await db.transactions.update(queued.entity_id, { sync_status: 'SYNCED' });
    }
  });

  await setLocalDirty(true);
  scheduleCloudBackup();
}

async function handleServerState(message: { latest_catalog?: unknown; latest_pos_snapshot?: { source_device_id?: string; payload?: unknown } | null }) {
  const latestCatalog = message.latest_catalog as { payload?: unknown } | null | undefined;
  if (latestCatalog?.payload) {
    const result = await productService.importProductsFromJson(latestCatalog.payload as Parameters<typeof productService.importProductsFromJson>[0]);
    if (result.success) {
      await logSync(`Realtime catalog diterima: ${result.count} produk`);
    }
  }

  if (message.latest_pos_snapshot?.payload) {
    await handleRemotePosSnapshot(message.latest_pos_snapshot.source_device_id);
  }
}

async function handleCatalogSnapshot(message: { payload?: unknown }) {
  if (!message.payload) return;

  const result = await productService.importProductsFromJson(message.payload as Parameters<typeof productService.importProductsFromJson>[0]);
  if (result.success) {
    await logSync(`Realtime catalog update diterapkan: ${result.count} produk`);
  }
}

async function handleRemotePosSnapshot(sourceDeviceId?: string) {
  if (sourceDeviceId && sourceDeviceId === await getDeviceId()) return;
  if (await hasPendingLocalSync()) return;

  await realtimeSyncService.pullCloudPosSnapshot(undefined, undefined, { automated: true });
}

function send(message: unknown) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return true;
  }
  return false;
}

async function publishQueueItem(item: SyncQueue) {
  if (item.status !== 'PENDING') return false;

  const payload = JSON.parse(item.payload);
  const type = item.entity === 'transaction' ? 'sale.created' : 'stock.movement';

  return send({
    type,
    event_id: item.id,
    source: 'integrated-pos-app',
    entity_id: item.entity_id,
    payload,
    created_at: item.created_at
  });
}

async function publishPendingQueue() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  const pending = await db.sync_queue.where('status').equals('PENDING').toArray();
  for (const item of pending) {
    await publishQueueItem(item);
  }
}

function scheduleReconnect() {
  if (manualClose) return;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => {
    void realtimeSyncService.connect();
  }, 3000);
}

function scheduleCloudBackup() {
  window.clearTimeout(cloudBackupTimer);
  cloudBackupTimer = window.setTimeout(() => {
    void realtimeSyncService.pushCloudPosSnapshot(undefined, undefined, { automated: true }).catch((error) => {
      console.error(error);
      void logSync('Backup otomatis POS ke cloud gagal', false, 'CLOUD_BACKUP');
    });
  }, 1500);
}

async function hasPendingLocalSync() {
  const [pendingTransactions, pendingQueue] = await Promise.all([
    db.transactions.where('sync_status').equals('PENDING').count(),
    db.sync_queue.where('status').equals('PENDING').count()
  ]);

  return pendingTransactions > 0 || pendingQueue > 0;
}

async function getLastSeenCloudSnapshot() {
  return (await db.app_settings.get(LAST_POS_SNAPSHOT_SETTING))?.value || '';
}

async function setLocalDirty(dirty: boolean) {
  await db.app_settings.put({
    key: POS_LOCAL_DIRTY_SETTING,
    value: String(dirty),
    updated_at: new Date().toISOString()
  });
}

async function isLocalDirty() {
  return (await db.app_settings.get(POS_LOCAL_DIRTY_SETTING))?.value === 'true';
}

async function setLastSeenCloudSnapshot(updatedAt?: string | null) {
  if (!updatedAt) return;

  await db.app_settings.put({
    key: LAST_POS_SNAPSHOT_SETTING,
    value: updatedAt,
    updated_at: new Date().toISOString()
  });
}

export const realtimeSyncService = {
  getAutoPullIntervalMs,
  getAutoPushIntervalMs,

  async getConfig(): Promise<RealtimeConfig> {
    return {
      enabled: true,
      url: DEFAULT_URL,
      apiToken: DEFAULT_API_TOKEN
    };
  },

  async saveConfig(config: RealtimeConfig) {
    const now = new Date().toISOString();
    await db.app_settings.bulkPut([
      { key: 'realtime_enabled', value: String(config.enabled), updated_at: now },
      { key: 'realtime_url', value: config.url || DEFAULT_URL, updated_at: now },
      { key: 'realtime_api_token', value: config.apiToken || '', updated_at: now }
    ]);
  },

  getStatus() {
    return status;
  },

  subscribe(listener: (status: ConnectionStatus) => void) {
    listeners.add(listener);
    listener(status);
    return () => listeners.delete(listener);
  },

  async autoStart() {
    const config = await this.getConfig();
    await this.saveConfig(config);
    if (config.enabled) {
      await this.connect(config.url);
    }
    this.startAutoCloudPull();
    this.startAutoCloudPush();
  },

  startAutoCloudPull() {
    window.clearInterval(cloudPullTimer);
    const intervalMs = getAutoPullIntervalMs();

    void this.pullCloudPosSnapshot(undefined, undefined, { automated: true }).catch((error) => {
      console.error(error);
    });

    cloudPullTimer = window.setInterval(() => {
      void this.pullCloudPosSnapshot(undefined, undefined, { automated: true }).catch((error) => {
        console.error(error);
      });
    }, intervalMs);
  },

  stopAutoCloudPull() {
    window.clearInterval(cloudPullTimer);
    cloudPullTimer = undefined;
  },

  startAutoCloudPush() {
    window.clearInterval(cloudPushTimer);
    const intervalMs = getAutoPushIntervalMs();

    void this.pushCloudPosSnapshot(undefined, undefined, { automated: true }).catch((error) => {
      console.error(error);
    });

    cloudPushTimer = window.setInterval(() => {
      void this.pushCloudPosSnapshot(undefined, undefined, { automated: true }).catch((error) => {
        console.error(error);
      });
    }, intervalMs);
  },

  stopAutoCloudPush() {
    window.clearInterval(cloudPushTimer);
    cloudPushTimer = undefined;
  },

  async connect(customUrl?: string) {
    const config = await this.getConfig();
    const url = customUrl || config.url || DEFAULT_URL;
    manualClose = false;

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    emit('CONNECTING');
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      emit('CONNECTED');
      send({
        type: 'client.hello',
        app: 'pos',
        client_name: 'Kastur POS',
        outlet_id: 'outlet_001'
      });
      void publishPendingQueue();
    });

    socket.addEventListener('message', (event) => {
      const message = parseMessage(event);
      if (!message) return;

      if (message.type === 'server.state') void handleServerState(message);
      if (message.type === 'catalog.snapshot') void handleCatalogSnapshot(message);
      if (message.type === 'pos.snapshot') void handleRemotePosSnapshot(message.source_device_id);
      if (message.type === 'ack' && message.event_id) void markQueueAccepted(message.event_id);
      if (message.type === 'error') void logSync(message.message || 'Realtime sync error', false);
    });

    socket.addEventListener('close', () => {
      socket = null;
      emit(manualClose ? 'DISABLED' : 'OFFLINE');
      scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      emit('ERROR');
    });
  },

  disconnect() {
    manualClose = true;
    window.clearTimeout(reconnectTimer);
    socket?.close();
    socket = null;
    emit('DISABLED');
  },

  async pushPendingNow() {
    await publishPendingQueue();
  },

  async pullCloudCatalog(customUrl?: string, customToken?: string) {
    const config = await this.getConfig();
    const baseUrl = toHttpUrl(customUrl || config.url);
    const apiToken = customToken ?? config.apiToken;
    const response = await fetch(`${baseUrl}/api/inventory/snapshot`, {
      headers: apiToken ? { 'x-sync-token': apiToken } : undefined
    });

    if (!response.ok) {
      throw new Error(`Cloud catalog gagal: ${response.status}`);
    }

    const data = await response.json();
    if (!data.snapshot) {
      return { success: false, count: 0, message: 'Cloud belum memiliki catalog.' };
    }

    const result = await productService.importProductsFromJson(data.snapshot);
    if (result.success) {
      await logSync(`Cloud catalog diterima: ${result.count} produk`, true, 'CLOUD_CATALOG', result.count);
    }
    return result;
  },

  async pushCloudPosSnapshot(customUrl?: string, customToken?: string, options: { automated?: boolean } = {}) {
    if (cloudBackupRunning) {
      return { success: false, skipped: true, records: 0, message: 'Backup cloud sedang berjalan.' };
    }

    if (options.automated && !await isLocalDirty()) {
      return { success: true, skipped: true, records: 0, message: 'Tidak ada perubahan lokal untuk di-upload.' };
    }

    const config = await this.getConfig();
    const baseUrl = toHttpUrl(customUrl || config.url);
    const apiToken = customToken ?? config.apiToken;
    const snapshot = await buildPosSnapshot();
    const records = countSnapshotRecords(snapshot);
    const deviceId = await getDeviceId();
    cloudBackupRunning = true;

    try {
      const response = await fetch(`${baseUrl}/api/pos/snapshot`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(apiToken ? { 'x-sync-token': apiToken } : {})
        },
        body: JSON.stringify({
          source: 'integrated-pos-app',
          source_device_id: deviceId,
          payload: snapshot,
          created_at: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`Cloud POS backup gagal: ${response.status}`);
      }

      const data = await response.json();
      await setLocalDirty(false);
      await setLastSeenCloudSnapshot(data.updated_at);
      await logSync(`${options.automated ? 'Auto backup' : 'Semua data POS'} tersimpan ke cloud: ${records} records`, true, 'CLOUD_BACKUP', records);
      return {
        success: true,
        records,
        transactions: snapshot.transactions.length,
        shifts: snapshot.shifts.length,
        cashMovements: snapshot.cashMovements.length,
        customers: snapshot.customers.length,
        products: snapshot.products.length
      };
    } finally {
      cloudBackupRunning = false;
    }
  },

  async pullCloudPosSnapshot(customUrl?: string, customToken?: string, options: { automated?: boolean } = {}) {
    if (cloudRestoreRunning) {
      return { success: false, skipped: true, records: 0, message: 'Restore cloud sedang berjalan.' };
    }

    if (options.automated && await isLocalDirty()) {
      return { success: false, skipped: true, records: 0, message: 'Auto pull dilewati karena perubahan lokal belum ter-upload.' };
    }

    if (options.automated && await hasPendingLocalSync()) {
      return { success: false, skipped: true, records: 0, message: 'Auto pull dilewati karena masih ada data lokal pending.' };
    }

    const config = await this.getConfig();
    const baseUrl = toHttpUrl(customUrl || config.url);
    const apiToken = customToken ?? config.apiToken;
    cloudRestoreRunning = true;

    try {
      const response = await fetch(`${baseUrl}/api/pos/snapshot`, {
        headers: apiToken ? { 'x-sync-token': apiToken } : undefined
      });

      if (!response.ok) {
        throw new Error(`Cloud POS restore gagal: ${response.status}`);
      }

      const data = await response.json();
      if (!data.snapshot) {
        return { success: false, records: 0, message: 'Cloud belum memiliki backup POS.' };
      }

      const updatedAt = data.updated_at as string | null | undefined;
      if (options.automated && updatedAt && updatedAt === await getLastSeenCloudSnapshot()) {
        return { success: true, skipped: true, records: 0, message: 'Cloud belum berubah.' };
      }

      const result = await importPosSnapshot(data.snapshot);
      await setLastSeenCloudSnapshot(updatedAt);
      await setLocalDirty(false);
      await authService.refreshCurrentUser();
      await logSync(
        `${options.automated ? 'Auto sync' : 'Semua data POS'} diambil dari cloud: ${result.records} records`,
        true,
        'CLOUD_RESTORE',
        result.records
      );
      return { success: true, ...result };
    } finally {
      cloudRestoreRunning = false;
    }
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('pos-sync-queue-created', () => {
    void setLocalDirty(true);
    void publishPendingQueue();
    scheduleCloudBackup();
  });

  window.addEventListener('pos-data-changed', () => {
    void setLocalDirty(true);
    scheduleCloudBackup();
  });
}
