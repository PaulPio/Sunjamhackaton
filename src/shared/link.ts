// Transport layer. Two ways a controller can reach the screen:
//  1. PeerJS (WebRTC data channel via the free public signaling cloud) — real
//     phones anywhere on the internet, no backend of our own.
//  2. BroadcastChannel — another tab in the same browser. Used by the ?sim=1
//     keyboard controller and the automated tests; also a handy fallback when
//     the PeerJS cloud is unreachable.
// The screen listens on both at once.

import Peer, { type DataConnection } from 'peerjs';
import { localChannelForRoom, peerIdForRoom } from './protocol';

// STUN alone (PeerJS's bare default) only works when a device can find a
// direct path — e.g. the same Wi-Fi as the host. A second phone on a
// stricter network (cellular, guest Wi-Fi, symmetric NAT) needs a TURN
// relay or its connection just hangs until it times out. Open Relay
// Project's free public TURN server fixes that at no cost — it's the
// standard fallback for demos/hackathons that can't run their own TURN.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:openrelay.metered.ca:80' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];
const PEER_OPTS = { config: { iceServers: ICE_SERVERS } };

export interface Link {
  send(msg: unknown): void;
  onMessage(cb: (msg: any) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

class Emitter {
  private msgCbs: Array<(m: any) => void> = [];
  private closeCbs: Array<() => void> = [];
  closed = false;
  onMessage(cb: (m: any) => void) {
    this.msgCbs.push(cb);
  }
  onClose(cb: () => void) {
    this.closeCbs.push(cb);
  }
  emitMessage(m: any) {
    for (const cb of this.msgCbs) cb(m);
  }
  emitClose() {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.closeCbs) cb();
  }
}

// ---------------------------------------------------------------------------
// PeerJS
// ---------------------------------------------------------------------------

class PeerLink extends Emitter implements Link {
  constructor(private conn: DataConnection) {
    super();
    conn.on('data', (d) => this.emitMessage(d));
    conn.on('close', () => this.emitClose());
    conn.on('error', () => this.emitClose());
  }
  send(msg: unknown) {
    if (this.conn.open) this.conn.send(msg);
  }
  close() {
    this.conn.close();
    this.emitClose();
  }
}

export interface HostHandle {
  stop(): void;
}

export type HostStatus =
  | { kind: 'online' }
  | { kind: 'offline'; reason: string }
  | { kind: 'connecting' };

/**
 * Listen for controllers over PeerJS. Non-fatal if the signaling cloud is
 * unreachable — local (same-browser) controllers still work via startLocalHost.
 */
export function startPeerHost(
  code: string,
  onLink: (link: Link) => void,
  onStatus: (s: HostStatus) => void,
): HostHandle {
  onStatus({ kind: 'connecting' });
  let stopped = false;
  const peer = new Peer(peerIdForRoom(code), PEER_OPTS);
  peer.on('open', () => {
    if (!stopped) onStatus({ kind: 'online' });
  });
  peer.on('connection', (conn) => {
    conn.on('open', () => onLink(new PeerLink(conn)));
  });
  peer.on('error', (err: any) => {
    if (stopped) return;
    // 'unavailable-id' = another screen holds this code; anything network-ish
    // means the cloud is unreachable. Either way, local play still works.
    onStatus({ kind: 'offline', reason: String(err?.type ?? err) });
  });
  peer.on('disconnected', () => {
    if (!stopped && !peer.destroyed) peer.reconnect();
  });
  return {
    stop() {
      stopped = true;
      peer.destroy();
    },
  };
}

export function connectPeerController(code: string, timeoutMs = 16000): Promise<Link> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_OPTS);
    let settled = false;
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      peer.destroy();
      reject(new Error(why));
    };
    // TURN relay allocation adds a round trip on top of plain STUN, so a
    // stricter-network device legitimately needs a bit longer than a
    // same-Wi-Fi one before we call it a real timeout.
    const timer = setTimeout(() => fail('Connection timed out'), timeoutMs);
    peer.on('error', (err: any) => fail(String(err?.type ?? err)));
    peer.on('open', () => {
      const conn = peer.connect(peerIdForRoom(code), { reliable: true });
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const link = new PeerLink(conn);
        link.onClose(() => peer.destroy());
        resolve(link);
      });
      conn.on('error', (err: any) => fail(String(err?.type ?? err)));
    });
  });
}

// ---------------------------------------------------------------------------
// BroadcastChannel (same-browser tabs: sim controllers + tests)
// ---------------------------------------------------------------------------
// BroadcastChannel is a shared bus, so we multiplex per-controller sessions:
//   {k:'hello', id}            controller -> host: request to join
//   {k:'helloAck', id}         host -> controller: session accepted
//   {k:'msg', id, dir, data}   payload; dir 'c2h' | 'h2c'
//   {k:'bye', id, dir}         either side hangs up

class LocalLink extends Emitter implements Link {
  constructor(
    private bc: BroadcastChannel,
    private id: string,
    private dir: 'c2h' | 'h2c',
  ) {
    super();
  }
  send(msg: unknown) {
    if (!this.closed) this.bc.postMessage({ k: 'msg', id: this.id, dir: this.dir, data: msg });
  }
  close() {
    this.bc.postMessage({ k: 'bye', id: this.id, dir: this.dir });
    this.emitClose();
  }
}

export function startLocalHost(code: string, onLink: (link: Link) => void): HostHandle {
  const bc = new BroadcastChannel(localChannelForRoom(code));
  const links = new Map<string, LocalLink>();
  bc.onmessage = (ev) => {
    const m = ev.data;
    if (m?.k === 'hello' && typeof m.id === 'string' && !links.has(m.id)) {
      const link = new LocalLink(bc, m.id, 'h2c');
      links.set(m.id, link);
      link.onClose(() => links.delete(m.id));
      bc.postMessage({ k: 'helloAck', id: m.id });
      onLink(link);
    } else if (m?.k === 'msg' && m.dir === 'c2h') {
      links.get(m.id)?.emitMessage(m.data);
    } else if (m?.k === 'bye' && m.dir === 'c2h') {
      links.get(m.id)?.emitClose();
    }
  };
  return {
    stop() {
      bc.close();
    },
  };
}

export function connectLocalController(code: string, timeoutMs = 3000): Promise<Link> {
  return new Promise((resolve, reject) => {
    const bc = new BroadcastChannel(localChannelForRoom(code));
    const id = Math.random().toString(36).slice(2, 10);
    let link: LocalLink | null = null;
    const timer = setTimeout(() => {
      if (!link) {
        bc.close();
        reject(new Error('No screen found in this browser for that code'));
      }
    }, timeoutMs);
    bc.onmessage = (ev) => {
      const m = ev.data;
      if (m?.k === 'helloAck' && m.id === id && !link) {
        clearTimeout(timer);
        link = new LocalLink(bc, id, 'c2h');
        resolve(link);
      } else if (link && m?.k === 'msg' && m.id === id && m.dir === 'h2c') {
        link.emitMessage(m.data);
      } else if (link && m?.k === 'bye' && m.id === id && m.dir === 'h2c') {
        link.emitClose();
      }
    };
    bc.postMessage({ k: 'hello', id });
  });
}
