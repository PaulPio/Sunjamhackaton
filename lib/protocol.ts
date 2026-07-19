// Wire protocol between phone controllers and the desktop screen.
// The screen is the authoritative host.

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
  | { t: 'swing'; dir: SwingDir; intensity: number }
  | { t: 'block'; on: boolean }
  | { t: 'calibrate' };

export type FxKind =
  | 'landedHit'
  | 'tookHit'
  | 'wasBlocked'
  | 'didBlock'
  | 'gotParried'
  | 'didParry';

/** Screen -> phone */
export type ScreenMsg =
  | { t: 'assign'; player: PlayerIndex }
  | { t: 'full' }
  | { t: 'fx'; kind: FxKind }
  | { t: 'hud'; hp: number; stamina: number; phase: GamePhase };

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
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

export function peerIdForRoom(code: string): string {
  return `duellink-v2-${code}`;
}

export function localChannelForRoom(code: string): string {
  return `duellink-local-${code}`;
}

/** QR / share URL for phones to join as controllers. */
export function joinUrlForRoom(code: string): string {
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? '';
  return `${origin}/controller?room=${code}`;
}
