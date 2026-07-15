import pg from 'pg';

const { Client } = pg;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-sync-token'
};

const TRUSTED_APP_ORIGINS = new Set([
  'https://calckastur.roidtaqi.workers.dev',
  'https://poskastur.roidtaqi.workers.dev'
]);

function isTrustedAppOrigin(origin) {
  if (!origin) return false;
  if (TRUSTED_APP_ORIGINS.has(origin)) return true;

  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

const POS_TABLES = [
  ['users', 'pos_users'],
  ['roles', 'pos_roles'],
  ['permissions', 'pos_permissions'],
  ['outlets', 'pos_outlets'],
  ['products', 'pos_products'],
  ['productUnits', 'pos_product_units'],
  ['productBarcodes', 'pos_product_barcodes'],
  ['stockBalances', 'pos_stock_balances'],
  ['stockMovements', 'pos_stock_movements'],
  ['transactions', 'pos_transactions'],
  ['transactionItems', 'pos_transaction_items'],
  ['payments', 'pos_payments'],
  ['shifts', 'pos_shifts'],
  ['cashMovements', 'pos_cash_movements'],
  ['customers', 'pos_customers'],
  ['syncLogs', 'pos_sync_logs'],
  ['syncQueue', 'pos_sync_queue'],
  ['auditLogs', 'pos_audit_logs'],
  ['appSettings', 'pos_app_settings', 'setting_key']
];

const INVENTORY_TABLES = [
  ['categories', 'inventory_categories'],
  ['brands', 'inventory_brands'],
  ['suppliers', 'inventory_suppliers'],
  ['products', 'inventory_products'],
  ['productUnits', 'inventory_product_units'],
  ['marginRules', 'inventory_margin_rules'],
  ['priceCalculations', 'inventory_price_calculations'],
  ['priceHistories', 'inventory_price_histories'],
  ['productUnitCostHistories', 'inventory_product_unit_cost_histories'],
  ['csvImportBatches', 'inventory_csv_import_batches'],
  ['csvImportRows', 'inventory_csv_import_rows'],
  ['appSettings', 'inventory_app_settings', 'setting_key'],
  ['posSales', 'inventory_pos_sales'],
  ['realtimeSyncLogs', 'inventory_realtime_sync_logs']
];

const BASE_SCHEMA = `
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
`;

const ensuredConnections = new Set();

function tableConfigs(domain) {
  return domain === 'pos' ? POS_TABLES : INVENTORY_TABLES;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' }
  });
}

function rowId(row, prefix, index) {
  return String(row?.id ?? row?.key ?? `${prefix}_${index}`);
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decodeMessage(message) {
  try {
    if (typeof message === 'string') return JSON.parse(message);
    return JSON.parse(new TextDecoder().decode(message));
  } catch {
    return null;
  }
}

function connectionString(env) {
  if (!env.HYPERDRIVE?.connectionString) {
    throw new Error('Binding HYPERDRIVE belum dikonfigurasi');
  }
  return env.HYPERDRIVE.connectionString;
}

async function withDatabase(env, callback) {
  const url = connectionString(env);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await ensureDatabase(client, url);
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function ensureDatabase(client, connectionId) {
  if (ensuredConnections.has(connectionId)) return;
  await client.query(BASE_SCHEMA);

  for (const [snapshotKey, table, customKey] of [...POS_TABLES, ...INVENTORY_TABLES]) {
    const key = customKey || 'id';
    await client.query(`create table if not exists ${table} (${key} text primary key, raw jsonb not null)`);
    void snapshotKey;
  }
  ensuredConnections.add(connectionId);
}

async function rememberEvent(client, eventId) {
  if (!eventId) return false;
  const result = await client.query(
    'insert into sync_event_ids (event_id) values ($1) on conflict (event_id) do nothing returning event_id',
    [eventId]
  );
  return result.rowCount === 0;
}

async function replaceSnapshot(client, domain, event) {
  const snapshot = event.payload || {};
  await client.query('begin');
  try {
    for (const [snapshotKey, table, customKey] of tableConfigs(domain)) {
      const key = customKey || 'id';
      const rows = Array.isArray(snapshot[snapshotKey]) ? snapshot[snapshotKey] : [];
      await client.query(`delete from ${table}`);
      for (const [index, row] of rows.entries()) {
        await client.query(
          `insert into ${table} (${key}, raw) values ($1,$2::jsonb)`,
          [rowId(row, `${domain}_${snapshotKey}`, index), JSON.stringify(row ?? {})]
        );
      }
    }

    const receivedAt = event.received_at || new Date().toISOString();
    const payloadMeta = domain === 'pos'
      ? {
          schemaVersion: snapshot.schemaVersion ?? 1,
          exportedAt: snapshot.exportedAt ?? event.created_at ?? receivedAt,
          sourceDeviceId: snapshot.sourceDeviceId ?? event.source_device_id ?? null
        }
      : { exportedAt: snapshot.exportedAt ?? event.created_at ?? receivedAt };

    await client.query(
      `insert into cloud_snapshot_meta (
        domain, snapshot_type, event_id, source, source_device_id, source_client_id,
        created_at, received_at, payload_meta, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
      on conflict (domain) do update set
        snapshot_type=excluded.snapshot_type,
        event_id=excluded.event_id,
        source=excluded.source,
        source_device_id=excluded.source_device_id,
        source_client_id=excluded.source_client_id,
        created_at=excluded.created_at,
        received_at=excluded.received_at,
        payload_meta=excluded.payload_meta,
        updated_at=now()`,
      [
        domain,
        event.type || (domain === 'pos' ? 'pos.snapshot' : 'catalog.snapshot'),
        event.event_id ?? null,
        event.source ?? null,
        event.source_device_id ?? snapshot.sourceDeviceId ?? null,
        event.source_client_id ?? null,
        toIso(event.created_at),
        toIso(receivedAt),
        JSON.stringify(payloadMeta)
      ]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function readSnapshotMeta(client, domain) {
  const result = await client.query('select * from cloud_snapshot_meta where domain=$1', [domain]);
  return result.rows[0] || null;
}

function snapshotUpdatedAt(meta) {
  return toIso(meta?.received_at) || toIso(meta?.updated_at) || toIso(meta?.created_at);
}

function snapshotHasNotChanged(meta, since) {
  const updatedAt = snapshotUpdatedAt(meta);
  if (!since || !updatedAt) return false;

  const sinceTime = Date.parse(since);
  const updatedTime = Date.parse(updatedAt);
  if (!Number.isNaN(sinceTime) && !Number.isNaN(updatedTime)) {
    return updatedTime <= sinceTime;
  }
  return updatedAt === since;
}

async function readSnapshot(client, domain, knownMeta) {
  const snapshot = {};
  for (const [snapshotKey, table, customKey] of tableConfigs(domain)) {
    const key = customKey || 'id';
    const result = await client.query(`select raw from ${table} order by ${key}`);
    snapshot[snapshotKey] = result.rows.map((row) => row.raw);
  }

  const meta = knownMeta === undefined ? await readSnapshotMeta(client, domain) : knownMeta;
  const payloadMeta = meta?.payload_meta || {};
  const exportedAt = payloadMeta.exportedAt || toIso(meta?.updated_at) || new Date().toISOString();
  const payload = domain === 'pos'
    ? {
        schemaVersion: payloadMeta.schemaVersion ?? 1,
        exportedAt,
        sourceDeviceId: payloadMeta.sourceDeviceId ?? meta?.source_device_id ?? null,
        ...snapshot
      }
    : { exportedAt, ...snapshot };
  return { meta, payload };
}

function snapshotEvent(domain, result) {
  const { meta, payload } = result;
  const stats = domain === 'pos' ? posStats(payload) : inventoryStats(payload);
  if (!meta && stats.records === 0) return null;
  return {
    type: meta?.snapshot_type || (domain === 'pos' ? 'pos.snapshot' : 'catalog.snapshot'),
    event_id: meta?.event_id || `${domain}_snapshot_from_postgres`,
    source: meta?.source || (domain === 'pos' ? 'integrated-pos-app' : 'inventory-pricing-app'),
    source_device_id: meta?.source_device_id || payload.sourceDeviceId || null,
    payload,
    created_at: toIso(meta?.created_at) || payload.exportedAt,
    received_at: toIso(meta?.received_at) || toIso(meta?.updated_at) || payload.exportedAt,
    source_client_id: meta?.source_client_id || 'postgres'
  };
}

async function readEvents(client, table, limit = 1000) {
  const safeLimit = Math.min(Math.max(Number(limit) || 250, 1), 1000);
  const result = await client.query(
    `select raw from ${table} order by received_at desc limit $1`,
    [safeLimit]
  );
  return result.rows.map((row) => row.raw).reverse();
}

async function saveRealtimeEvent(client, table, event, entityId) {
  await client.query(
    `insert into ${table} (event_id,entity_id,source,source_client_id,payload,created_at,received_at,raw)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)
     on conflict (event_id) do update set
       entity_id=excluded.entity_id, source=excluded.source,
       source_client_id=excluded.source_client_id, payload=excluded.payload,
       created_at=excluded.created_at, received_at=excluded.received_at, raw=excluded.raw`,
    [
      event.event_id,
      entityId ?? null,
      event.source ?? null,
      event.source_client_id ?? null,
      JSON.stringify(event.payload ?? null),
      toIso(event.created_at),
      toIso(event.received_at) || new Date().toISOString(),
      JSON.stringify(event)
    ]
  );
}

function posStats(snapshot) {
  const keys = POS_TABLES.map(([key]) => key);
  return {
    records: keys.reduce((total, key) => total + (snapshot?.[key]?.length || 0), 0),
    transactions: snapshot?.transactions?.length || 0,
    shifts: snapshot?.shifts?.length || 0,
    cash_movements: snapshot?.cashMovements?.length || 0,
    customers: snapshot?.customers?.length || 0,
    products: snapshot?.products?.length || 0
  };
}

function inventoryStats(snapshot) {
  const keys = INVENTORY_TABLES.map(([key]) => key);
  return {
    records: keys.reduce((total, key) => total + (snapshot?.[key]?.length || 0), 0),
    products: snapshot?.products?.length || 0,
    product_units: snapshot?.productUnits?.length || 0,
    price_calculations: snapshot?.priceCalculations?.length || 0,
    price_histories: snapshot?.priceHistories?.length || 0
  };
}

async function readState(client) {
  const [inventory, pos, sales, stock, eventCount] = await Promise.all([
    readSnapshot(client, 'inventory'),
    readSnapshot(client, 'pos'),
    readEvents(client, 'sync_sales_events', 1000),
    readEvents(client, 'sync_stock_events', 1000),
    client.query('select count(*)::int as count from sync_event_ids')
  ]);
  return {
    catalogEvent: snapshotEvent('inventory', inventory),
    posEvent: snapshotEvent('pos', pos),
    sales,
    stock,
    eventCount: Number(eventCount.rows[0]?.count || 0)
  };
}

export class SyncHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      if (!this.isAuthorized(request)) {
        return jsonResponse({ ok: false, message: 'Unauthorized' }, 401);
      }
      return this.upgradeWebSocket();
    }
    return this.handleHttp(request);
  }

  upgradeWebSocket() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const connection = {
      id: crypto.randomUUID(),
      app: 'unknown',
      name: 'Unknown client',
      connected_at: new Date().toISOString()
    };
    server.serializeAttachment(connection);
    server.send(JSON.stringify({
      type: 'server.ready',
      client_id: connection.id,
      server_time: new Date().toISOString()
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleHttp(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/') && !this.isAuthorized(request)) {
      return jsonResponse({ ok: false, message: 'Unauthorized' }, 401);
    }

    try {
      return await withDatabase(this.env, async (client) => {
        if (url.pathname === '/health') {
          const state = await readState(client);
          return jsonResponse({
            ok: true,
            service: 'kastur-cloudflare-sync-server',
            storage: 'postgres',
            latest_catalog: Boolean(state.catalogEvent),
            latest_pos_snapshot: Boolean(state.posEvent),
            pos_snapshot_stats: posStats(state.posEvent?.payload),
            inventory_snapshot_stats: inventoryStats(state.catalogEvent?.payload),
            sales_events: state.sales.length
          });
        }

        if (url.pathname === '/api/state' && request.method === 'GET') {
          const state = await readState(client);
          return jsonResponse({
            ok: true,
            latest_catalog: Boolean(state.catalogEvent),
            latest_pos_snapshot: Boolean(state.posEvent),
            pos_snapshot_updated_at: state.posEvent?.received_at || state.posEvent?.created_at || null,
            pos_snapshot_stats: posStats(state.posEvent?.payload),
            inventory_snapshot_updated_at: state.catalogEvent?.received_at || state.catalogEvent?.created_at || null,
            inventory_snapshot_stats: inventoryStats(state.catalogEvent?.payload),
            sales_events: state.sales.length,
            stock_events: state.stock.length,
            event_ids: state.eventCount,
            storage: 'postgres'
          });
        }

        if (url.pathname === '/api/pos/snapshot' && request.method === 'GET') {
          const meta = await readSnapshotMeta(client, 'pos');
          const updatedAt = snapshotUpdatedAt(meta);
          if (snapshotHasNotChanged(meta, url.searchParams.get('since'))) {
            return jsonResponse({ ok: true, not_modified: true, snapshot: null, updated_at: updatedAt });
          }

          const event = snapshotEvent('pos', await readSnapshot(client, 'pos', meta));
          return jsonResponse({
            ok: true,
            event,
            snapshot: event?.payload || null,
            stats: posStats(event?.payload),
            updated_at: event?.received_at || event?.created_at || null
          });
        }

        if (url.pathname === '/api/inventory/snapshot' && request.method === 'GET') {
          const meta = await readSnapshotMeta(client, 'inventory');
          const updatedAt = snapshotUpdatedAt(meta);
          if (snapshotHasNotChanged(meta, url.searchParams.get('since'))) {
            return jsonResponse({ ok: true, not_modified: true, snapshot: null, updated_at: updatedAt });
          }

          const event = snapshotEvent('inventory', await readSnapshot(client, 'inventory', meta));
          return jsonResponse({
            ok: true,
            event,
            snapshot: event?.payload || null,
            updated_at: event?.received_at || event?.created_at || null
          });
        }

        if (url.pathname === '/api/pos/sales' && request.method === 'GET') {
          return jsonResponse({ ok: true, sales: await readEvents(client, 'sync_sales_events', url.searchParams.get('limit')) });
        }

        if (url.pathname === '/api/pos/snapshot' && ['POST', 'PUT'].includes(request.method)) {
          const body = await request.json();
          const receivedAt = new Date().toISOString();
          const event = body?.type === 'pos.snapshot' ? body : {
            type: 'pos.snapshot',
            event_id: body?.event_id || `pos_snapshot_${Date.now()}_${crypto.randomUUID()}`,
            source: body?.source || 'integrated-pos-app',
            source_device_id: body?.source_device_id || body?.payload?.sourceDeviceId || null,
            payload: body?.payload || body,
            created_at: body?.created_at || receivedAt
          };
          event.source_device_id ||= event.payload?.sourceDeviceId || null;
          event.received_at = receivedAt;
          event.source_client_id = 'http-api';
          const duplicate = await rememberEvent(client, event.event_id);
          if (!duplicate) await replaceSnapshot(client, 'pos', event);
          this.broadcast(event, 'pos');
          return jsonResponse({
            ok: true,
            duplicate,
            event_id: event.event_id,
            updated_at: event.received_at,
            source_device_id: event.source_device_id,
            stats: posStats(event.payload)
          });
        }

        if (url.pathname === '/api/inventory/snapshot' && ['POST', 'PUT'].includes(request.method)) {
          const body = await request.json();
          const event = body?.type === 'catalog.snapshot' ? body : {
            type: 'catalog.snapshot',
            event_id: body?.event_id || `catalog_${Date.now()}_${crypto.randomUUID()}`,
            source: body?.source || 'inventory-pricing-app',
            payload: body?.payload || body,
            created_at: body?.created_at || new Date().toISOString()
          };
          event.received_at = new Date().toISOString();
          event.source_client_id = 'http-api';
          const duplicate = await rememberEvent(client, event.event_id);
          if (!duplicate) await replaceSnapshot(client, 'inventory', event);
          this.broadcast(event, 'pos');
          return jsonResponse({
            ok: true,
            duplicate,
            event_id: event.event_id,
            updated_at: event.received_at,
            products: event.payload?.products?.length || 0
          });
        }

        return new Response('Kastur realtime sync server\n', { status: 200, headers: CORS_HEADERS });
      });
    } catch (error) {
      console.error(error);
      return jsonResponse({ ok: false, message: error instanceof Error ? error.message : 'Internal server error' }, 500);
    }
  }

  isAuthorized(request) {
    const apiToken = this.env.SYNC_API_TOKEN || '';
    if (apiToken) {
      const tokenMatches = request.headers.get('authorization') === `Bearer ${apiToken}`
        || request.headers.get('x-sync-token') === apiToken;
      if (tokenMatches) return true;
    }
    return isTrustedAppOrigin(request.headers.get('origin'));
  }

  send(socket, message) {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  broadcast(message, targetApp) {
    for (const socket of this.ctx.getWebSockets()) {
      const connection = socket.deserializeAttachment() || {};
      if (!targetApp || connection.app === targetApp) this.send(socket, message);
    }
  }

  async webSocketMessage(socket, raw) {
    const message = decodeMessage(raw);
    if (!message || typeof message.type !== 'string') {
      this.send(socket, { type: 'error', message: 'Invalid message' });
      return;
    }

    const connection = socket.deserializeAttachment() || { id: crypto.randomUUID(), app: 'unknown' };

    try {
      if (message.type === 'client.hello') {
        connection.app = message.app || 'unknown';
        connection.name = message.client_name || connection.name || 'Unknown client';
        connection.outlet_id = message.outlet_id;
        socket.serializeAttachment(connection);
        await withDatabase(this.env, async (client) => {
          const state = await readState(client);
          this.send(socket, {
            type: 'server.state',
            server_time: new Date().toISOString(),
            latest_catalog: connection.app === 'pos' ? state.catalogEvent : null,
            latest_pos_snapshot: connection.app === 'pos' ? state.posEvent : null,
            pending_sales: connection.app === 'inventory' ? state.sales.slice(-250) : [],
            pending_stock: connection.app === 'inventory' ? state.stock.slice(-250) : []
          });
        });
        return;
      }

      if (message.type === 'sync.request_state') {
        await withDatabase(this.env, async (client) => {
          const state = await readState(client);
          this.send(socket, {
            type: 'server.state',
            server_time: new Date().toISOString(),
            latest_catalog: connection.app === 'pos' ? state.catalogEvent : null,
            latest_pos_snapshot: connection.app === 'pos' ? state.posEvent : null,
            pending_sales: connection.app === 'inventory' ? state.sales.slice(-250) : [],
            pending_stock: connection.app === 'inventory' ? state.stock.slice(-250) : []
          });
        });
        return;
      }

      await withDatabase(this.env, async (client) => {
        const duplicate = await rememberEvent(client, message.event_id);
        const receivedEvent = {
          ...message,
          received_at: new Date().toISOString(),
          source_client_id: connection.id
        };

        if (message.type === 'catalog.snapshot') {
          if (!duplicate) await replaceSnapshot(client, 'inventory', receivedEvent);
          this.send(socket, { type: 'ack', event_id: message.event_id, entity: 'catalog', status: 'ACCEPTED', duplicate });
          this.broadcast(receivedEvent, 'pos');
          return;
        }

        if (message.type === 'sale.created') {
          if (!duplicate) {
            await saveRealtimeEvent(client, 'sync_sales_events', receivedEvent, message.payload?.transaction_id);
          }
          this.send(socket, {
            type: 'ack', event_id: message.event_id, entity: 'transaction',
            entity_id: message.payload?.transaction_id, status: 'ACCEPTED', duplicate
          });
          this.broadcast(receivedEvent, 'inventory');
          return;
        }

        if (message.type === 'stock.movement') {
          if (!duplicate) {
            await saveRealtimeEvent(client, 'sync_stock_events', receivedEvent, message.payload?.stock_movement_id);
          }
          this.send(socket, { type: 'ack', event_id: message.event_id, entity: 'stock_movement', status: 'ACCEPTED', duplicate });
          this.broadcast(receivedEvent, 'inventory');
          return;
        }

        this.send(socket, { type: 'error', message: `Unknown message type: ${message.type}` });
      });
    } catch (error) {
      console.error(error);
      this.send(socket, { type: 'error', message: error instanceof Error ? error.message : 'Server error' });
    }
  }

  webSocketClose(socket, code, reason) {
    socket.close(code, reason);
  }
}

export default {
  fetch(request, env) {
    const id = env.SYNC_HUB.idFromName('kastur-global');
    return env.SYNC_HUB.get(id).fetch(request);
  }
};
