import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.SYNC_DATA_DIR || join(__dirname, '..', '.sync-data');
const stateFile = join(dataDir, 'realtime-sync-state.json');
const port = Number(process.env.PORT || process.env.SYNC_PORT || 8787);

const state = {
  latestCatalogEvent: null,
  salesEvents: [],
  stockEvents: [],
  eventIds: {}
};

const clients = new Map();

async function loadState() {
  try {
    const raw = await readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    state.latestCatalogEvent = parsed.latestCatalogEvent || null;
    state.salesEvents = parsed.salesEvents || [];
    state.stockEvents = parsed.stockEvents || [];
    state.eventIds = parsed.eventIds || {};
  } catch {
    await mkdir(dataDir, { recursive: true });
  }
}

async function persistState() {
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
    pending_sales: client.app === 'inventory' ? state.salesEvents.slice(-250) : [],
    pending_stock: client.app === 'inventory' ? state.stockEvents.slice(-250) : []
  };
}

await loadState();

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'integrated-pos-sync-server' }));
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
