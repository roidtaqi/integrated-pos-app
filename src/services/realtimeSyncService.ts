import { db, type SyncQueue } from './db';
import { productService } from './productService';

type ConnectionStatus = 'DISABLED' | 'CONNECTING' | 'CONNECTED' | 'OFFLINE' | 'ERROR';

interface RealtimeConfig {
  enabled: boolean;
  url: string;
}

const DEFAULT_URL = 'ws://localhost:8787';
const listeners = new Set<(status: ConnectionStatus) => void>();

let socket: WebSocket | null = null;
let status: ConnectionStatus = 'DISABLED';
let reconnectTimer: number | undefined;
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

async function logSync(message: string, ok = true) {
  await db.sync_logs.add({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    type: 'EXPORT_SALES',
    status: ok ? 'SUCCESS' : 'FAILED',
    records_processed: 0,
    message,
    created_at: new Date().toISOString()
  });
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
}

async function handleServerState(message: { latest_catalog?: unknown }) {
  const latestCatalog = message.latest_catalog as { payload?: unknown } | null | undefined;
  if (!latestCatalog?.payload) return;

  const result = await productService.importProductsFromJson(latestCatalog.payload as Parameters<typeof productService.importProductsFromJson>[0]);
  if (result.success) {
    await logSync(`Realtime catalog diterima: ${result.count} produk`);
  }
}

async function handleCatalogSnapshot(message: { payload?: unknown }) {
  if (!message.payload) return;

  const result = await productService.importProductsFromJson(message.payload as Parameters<typeof productService.importProductsFromJson>[0]);
  if (result.success) {
    await logSync(`Realtime catalog update diterapkan: ${result.count} produk`);
  }
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

export const realtimeSyncService = {
  async getConfig(): Promise<RealtimeConfig> {
    const settings = await db.app_settings.bulkGet(['realtime_enabled', 'realtime_url']);
    return {
      enabled: settings[0]?.value === 'true',
      url: settings[1]?.value || DEFAULT_URL
    };
  },

  async saveConfig(config: RealtimeConfig) {
    const now = new Date().toISOString();
    await db.app_settings.bulkPut([
      { key: 'realtime_enabled', value: String(config.enabled), updated_at: now },
      { key: 'realtime_url', value: config.url || DEFAULT_URL, updated_at: now }
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
    if (config.enabled) {
      await this.connect(config.url);
    }
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
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('pos-sync-queue-created', () => {
    void publishPendingQueue();
  });
}
