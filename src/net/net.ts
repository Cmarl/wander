/**
 * Client half of the presence relay.
 *
 * Sends our own transform on a fixed tick (and only when it has actually
 * changed), and keeps a short buffer of each peer's last two updates so they
 * can be played back interpolated, slightly in the past. Rendering ~140 ms
 * behind the newest packet is what turns an 8 Hz feed into smooth movement.
 */

export const DEFAULT_WORLD = "overland";
const NET_ORIGIN = "wss://wander-net.marl-clyde.workers.dev";

/** Send rate. The server also rate-limits, so this is the honest ceiling. */
const SEND_HZ = 8;
const SEND_INTERVAL = 1 / SEND_HZ;
/** Resend even when still, so peers know we haven't dropped. */
const KEEPALIVE = 2.0;
/** How far behind the newest packet we render peers. */
const INTERP_DELAY = 0.14;

export interface Snapshot {
  t: number;
  x: number;
  y: number;
  z: number;
  h: number;
  driving: boolean;
  speed: number;
}

export interface Peer {
  id: number;
  name: string;
  colour: number;
  prev: Snapshot;
  next: Snapshot;
}

export type NetStatus = "offline" | "connecting" | "online";

const now = () => performance.now() / 1000;

export class Net {
  readonly peers = new Map<number, Peer>();
  status: NetStatus = "offline";
  selfId = 0;
  world = DEFAULT_WORLD;
  name = "wanderer";

  onPeerJoin?: (p: Peer) => void;
  onPeerLeave?: (id: number) => void;
  onStatus?: (s: NetStatus) => void;

  private ws: WebSocket | null = null;
  private sendTimer = 0;
  private sinceKeepalive = 0;
  private last = { x: 0, y: 0, z: 0, h: 0, driving: false };
  private retry = 0;
  private reconnectAt = 0;
  private wantConnection = false;
  private colour = 0xd8c04a;

  connect(world: string, name: string, colour = 0xd8c04a) {
    this.world = world || DEFAULT_WORLD;
    this.name = name;
    this.colour = colour;
    this.wantConnection = true;
    this.retry = 0;
    this.open();
  }

  disconnect() {
    this.wantConnection = false;
    this.ws?.close();
    this.ws = null;
    this.clearPeers();
    this.setStatus("offline");
  }

  private open() {
    if (!this.wantConnection) return;
    this.setStatus("connecting");

    // ?net= lets a tester point at a local wrangler dev instance.
    const override = new URLSearchParams(location.search).get("net");
    const origin = override || NET_ORIGIN;
    const url =
      `${origin}/ws?world=${encodeURIComponent(this.world)}` +
      `&name=${encodeURIComponent(this.name)}&colour=${this.colour}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.retry = 0;
      this.setStatus("online");
    });
    ws.addEventListener("message", (e) => this.receive(e.data as string));
    ws.addEventListener("close", () => {
      if (this.ws === ws) {
        this.ws = null;
        this.clearPeers();
        this.scheduleRetry();
      }
    });
    ws.addEventListener("error", () => ws.close());
  }

  private scheduleRetry() {
    if (!this.wantConnection) {
      this.setStatus("offline");
      return;
    }
    this.setStatus("connecting");
    // Back off so a down relay doesn't become a reconnect storm.
    this.retry = Math.min(this.retry + 1, 6);
    this.reconnectAt = now() + Math.min(1.5 * 2 ** (this.retry - 1), 30);
  }

  private clearPeers() {
    for (const id of [...this.peers.keys()]) this.onPeerLeave?.(id);
    this.peers.clear();
  }

  private setStatus(s: NetStatus) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
  }

  private receive(raw: string) {
    let m: unknown[];
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(m)) return;

    switch (m[0]) {
      case "w": {
        this.selfId = m[1] as number;
        for (const p of (m[2] as unknown[][]) ?? []) this.addPeer(p as [number, string, number, ...number[]]);
        break;
      }
      case "j":
        this.addPeer([m[1] as number, m[2] as string, m[3] as number]);
        break;
      case "l": {
        const id = m[1] as number;
        if (this.peers.delete(id)) this.onPeerLeave?.(id);
        break;
      }
      case "s":
        this.applyState(m as [string, number, number, number, number, number, number, number]);
        break;
    }
  }

  private addPeer(p: [number, string, number, ...number[]]) {
    const [id, name, colour, x = 0, y = 0, z = 0, h = 0, mode = 0, speed = 0] = p;
    if (id === this.selfId || this.peers.has(id)) return;
    const snap: Snapshot = { t: now(), x, y, z, h, driving: mode === 1, speed };
    const peer: Peer = { id, name, colour, prev: snap, next: { ...snap } };
    this.peers.set(id, peer);
    this.onPeerJoin?.(peer);
  }

  private applyState(m: [string, number, number, number, number, number, number, number]) {
    const peer = this.peers.get(m[1]);
    if (!peer) return;
    peer.prev = peer.next;
    peer.next = { t: now(), x: m[2], y: m[3], z: m[4], h: m[5], driving: m[6] === 1, speed: m[7] };
  }

  /** Where a peer should be drawn this frame. */
  sample(peer: Peer, out: { x: number; y: number; z: number; h: number }) {
    const target = now() - INTERP_DELAY;
    const span = peer.next.t - peer.prev.t;
    const t = span > 1e-4 ? Math.min(Math.max((target - peer.prev.t) / span, 0), 1.35) : 1;
    out.x = peer.prev.x + (peer.next.x - peer.prev.x) * t;
    out.y = peer.prev.y + (peer.next.y - peer.prev.y) * t;
    out.z = peer.prev.z + (peer.next.z - peer.prev.z) * t;
    // Shortest way round the circle, or peers spin on the wrap.
    let dh = ((peer.next.h - peer.prev.h + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (dh < -Math.PI) dh += Math.PI * 2;
    out.h = peer.prev.h + dh * t;
  }

  update(dt: number, self: { x: number; y: number; z: number; h: number; driving: boolean; speed: number }) {
    if (this.reconnectAt && now() >= this.reconnectAt && !this.ws) {
      this.reconnectAt = 0;
      this.open();
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.sendTimer -= dt;
    this.sinceKeepalive += dt;
    if (this.sendTimer > 0) return;
    this.sendTimer = SEND_INTERVAL;

    const moved =
      Math.abs(self.x - this.last.x) > 0.04 ||
      Math.abs(self.y - this.last.y) > 0.04 ||
      Math.abs(self.z - this.last.z) > 0.04 ||
      Math.abs(self.h - this.last.h) > 0.01 ||
      self.driving !== this.last.driving;

    if (!moved && this.sinceKeepalive < KEEPALIVE) return;
    this.sinceKeepalive = 0;
    this.last = { x: self.x, y: self.y, z: self.z, h: self.h, driving: self.driving };

    // Rounded: centimetres and milliradians are far below what anyone can see,
    // and it roughly halves the packet.
    const r = (v: number) => Math.round(v * 100) / 100;
    this.ws.send(
      JSON.stringify(["m", r(self.x), r(self.y), r(self.z), r(self.h), self.driving ? 1 : 0, r(self.speed)])
    );
  }
}
