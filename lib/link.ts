// Transport: PeerJS (WebRTC) for real phones + BroadcastChannel for same-browser sim.

import Peer, { type DataConnection } from 'peerjs';
import { localChannelForRoom, peerIdForRoom } from './protocol';

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
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

class Emitter {
  private msgCbs: Array<(m: unknown) => void> = [];
  private closeCbs: Array<() => void> = [];
  closed = false;
  onMessage(cb: (m: unknown) => void) {
    this.msgCbs.push(cb);
  }
  onClose(cb: () => void) {
    this.closeCbs.push(cb);
  }
  emitMessage(m: unknown) {
    for (const cb of this.msgCbs) cb(m);
  }
  emitClose() {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.closeCbs) cb();
  }
}

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
  peer.on('error', (err: Error & { type?: string }) => {
    if (stopped) return;
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
    const timer = setTimeout(() => fail('Connection timed out'), timeoutMs);
    peer.on('error', (err: Error & { type?: string }) => fail(String(err?.type ?? err)));
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
      conn.on('error', (err: Error) => fail(String(err)));
    });
  });
}

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
