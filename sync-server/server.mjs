import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { WebSocketServer } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.SYNC_DATA_DIR || join(__dirname, '..', '.sync-data');
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
    )
  `);
}

async function loadState() {
  if (pool) {
    await ensureDatabase();
    const result = await pool.query('select value from sync_state where key = $1', ['realtime']);
    const parsed = result.rows[0]?.value;
    if (parsed) {
      state.latestCatalogEvent = parsed.latestCatalogEvent || null;
      state.latestPosSnapshotEvent = parsed.latestPosSnapshotEvent || null;
      state.salesEvents = parsed.salesEvents || [];
      state.stockEvents = parsed.stockEvents || [];
      state.eventIds = parsed.eventIds || {};
      return;
    }
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
    const posSnapshot = state.latestPosSnapshotEvent?.payload || null;
    sendJson(response, 200, {
      ok: true,
      service: 'integrated-pos-sync-server',
      storage: pool ? 'postgres' : 'file',
      latest_catalog: Boolean(state.latestCatalogEvent),
      latest_pos_snapshot: Boolean(state.latestPosSnapshotEvent),
      pos_snapshot_stats: getPosSnapshotStats(posSnapshot),
      sales_events: state.salesEvents.length
    });
    return;
  }

  if (url.pathname.startsWith('/api/') && !isAuthorized(request)) {
    sendJson(response, 401, { ok: false, message: 'Unauthorized' });
    return;
  }

  if (url.pathname === '/api/state' && request.method === 'GET') {
    const posSnapshot = state.latestPosSnapshotEvent?.payload || null;
    sendJson(response, 200, {
      ok: true,
      latest_catalog: Boolean(state.latestCatalogEvent),
      latest_pos_snapshot: Boolean(state.latestPosSnapshotEvent),
      pos_snapshot_updated_at: state.latestPosSnapshotEvent?.received_at || state.latestPosSnapshotEvent?.created_at || null,
      pos_snapshot_stats: getPosSnapshotStats(posSnapshot),
      sales_events: state.salesEvents.length,
      stock_events: state.stockEvents.length,
      event_ids: Object.keys(state.eventIds).length,
      storage: pool ? 'postgres' : 'file'
    });
    return;
  }

  if (url.pathname === '/api/pos/snapshot' && request.method === 'GET') {
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
      const event = body?.type === 'pos.snapshot'
        ? body
        : {
            type: 'pos.snapshot',
            event_id: body?.event_id || `pos_snapshot_${Date.now()}_${crypto.randomUUID()}`,
            source: body?.source || 'integrated-pos-app',
            payload: body?.payload || body,
            created_at: body?.created_at || new Date().toISOString()
          };

      const duplicate = rememberEvent(event.event_id);
      if (!duplicate) {
        state.latestPosSnapshotEvent = {
          ...event,
          received_at: new Date().toISOString(),
          source_client_id: 'http-api'
        };
        await persistState();
      }

      broadcast(state.latestPosSnapshotEvent, (target) => target.app === 'pos');
      sendJson(response, 200, {
        ok: true,
        duplicate,
        event_id: event.event_id,
        stats: getPosSnapshotStats(event.payload)
      });
    } catch (error) {
      console.error(error);
      sendJson(response, 400, { ok: false, message: 'Invalid POS snapshot payload' });
    }
    return;
  }

  if (url.pathname === '/api/inventory/snapshot' && request.method === 'GET') {
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
