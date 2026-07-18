// Wire protocol between the phone controllers and the desktop screen.
// The screen is the authoritative host: controllers only send inputs and
// receive feedback/HUD state.

export type Quat = [number, number, number, number]; // x, y, z, w
export type PlayerIndex = 0 | 1;
export type SwingDir = 'horizontal' | 'vertical' | 'thrust';

export type GamePhase =
  | 'lobby'
  | 'countdown'
  | 'fight'
  | 'roundEnd'
  | 'matchEnd'
  | 'paused';

/** Phone -> screen */
export type ControllerMsg =
  | { t: 'join' }
  | { t: 'orient'; q: Quat }
  | { t: 'swing'; dir: SwingDir; intensity: number } // intensity 0..1
  | { t: 'block'; on: boolean }
  | { t: 'calibrate' };

/** Feedback events the phone reacts to (flash/vibrate/sound). */
export type FxKind =
  | 'landedHit' // your swing damaged the foe
  | 'tookHit' // you got damaged
  | 'wasBlocked' // your swing got blocked
  | 'didBlock' // you blocked a swing
  | 'gotParried' // you are stunned by a perfect block
  | 'didParry'; // your perfect block stunned the foe

/** Screen -> phone */
export type ScreenMsg =
  | { t: 'assign'; player: PlayerIndex }
  | { t: 'full' }
  | { t: 'fx'; kind: FxKind }
  | { t: 'hud'; hp: number; stamina: number; phase: GamePhase };

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O — unambiguous
export const CODE_LENGTH = 4;

export function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z]/g, '');
}

/** PeerJS ids share a global namespace on the public cloud, so prefix ours. */
export function peerIdForRoom(code: string): string {
  return `duellink-v1-${code}`;
}

/** BroadcastChannel name for same-browser (sim/local-tab) controllers. */
export function localChannelForRoom(code: string): string {
  return `duellink-local-${code}`;
}

/** URL a phone can open to join this room directly (encoded in the QR). */
export function joinUrlForRoom(code: string): string {
  return `${location.origin}${location.pathname}#room=${code}`;
}
