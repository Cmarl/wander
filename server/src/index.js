/**
 * wander-net — presence and movement relay.
 *
 * There is no world state here. Wander's terrain, biomes and props are a pure
 * function of a fixed seed, so every client already generates a byte-identical
 * world offline. The only thing that has to cross the wire is where each player
 * is and what they're riding — about forty bytes a tick. That's why this fits
 * in a free-tier Durable Object: no chunks, no entities, no authority over the
 * environment, nothing to persist.
 *
 * One Durable Object per world name. Sockets are accepted through the
 * hibernation API so an idle world costs nothing while nobody is moving.
 */

const MAX_PLAYERS = 16;
/** Ignore anything faster than this per socket, so one client can't flood a room. */
const MIN_MESSAGE_INTERVAL_MS = 35;
const DEFAULT_WORLD = "overland";

const sanitizeWorld = (raw) =>
  (raw || DEFAULT_WORLD).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || DEFAULT_WORLD;

const sanitizeName = (raw) =>
  (raw || "wanderer").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 16) || "wanderer";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
    }
    if (url.pathname !== "/ws") {
      return new Response("wander-net", { status: 404 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }

    const world = sanitizeWorld(url.searchParams.get("world"));
    const room = env.ROOMS.get(env.ROOMS.idFromName(world));
    return room.fetch(request);
  },
};

export class WorldRoom {
  constructor(state) {
    this.state = state;
    /**
     * Latest position per player, in memory only. If the object hibernates this
     * is lost, which is fine — every client resends within a tick, and stale
     * coordinates are worth less than the storage write would cost.
     */
    this.live = new Map();
    this.lastSeen = new Map();
  }

  async fetch(request) {
    const existing = this.state.getWebSockets();
    if (existing.length >= MAX_PLAYERS) {
      return new Response("world full", { status: 503 });
    }

    const url = new URL(request.url);
    const name = sanitizeName(url.searchParams.get("name"));
    const colour = Number.parseInt(url.searchParams.get("colour") || "", 10) || 0xd8c04a;
    const id = Math.floor(Math.random() * 0x7fffffff);

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    // Identity has to survive hibernation; position does not.
    server.serializeAttachment({ id, name, colour });

    const peers = [];
    for (const ws of existing) {
      const a = ws.deserializeAttachment();
      if (!a) continue;
      const p = this.live.get(a.id) || [0, 0, 0, 0, 0, 0];
      peers.push([a.id, a.name, a.colour, ...p]);
    }

    server.send(JSON.stringify(["w", id, peers]));
    this.broadcast(JSON.stringify(["j", id, name, colour]), server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    const a = ws.deserializeAttachment();
    if (!a) return;

    const now = Date.now();
    if (now - (this.lastSeen.get(a.id) || 0) < MIN_MESSAGE_INTERVAL_MS) return;
    this.lastSeen.set(a.id, now);

    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(m) || m[0] !== "m") return;

    const st = [num(m[1]), num(m[2]), num(m[3]), num(m[4]), m[5] === 1 ? 1 : 0, num(m[6])];
    this.live.set(a.id, st);
    this.broadcast(JSON.stringify(["s", a.id, ...st]), ws);
  }

  webSocketClose(ws) {
    this.drop(ws);
  }

  webSocketError(ws) {
    this.drop(ws);
  }

  drop(ws) {
    const a = ws.deserializeAttachment();
    if (!a) return;
    this.live.delete(a.id);
    this.lastSeen.delete(a.id);
    this.broadcast(JSON.stringify(["l", a.id]), ws);
  }

  broadcast(data, except) {
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // A socket that's already gone will be cleaned up by its close handler.
      }
    }
  }
}
