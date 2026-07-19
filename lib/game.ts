import type { GamePhase, PlayerIndex, SwingDir } from './protocol';

export const HP_MAX = 100;
export const STAMINA_MAX = 100;
const STAMINA_COST = 30;
const STAMINA_REGEN_PER_S = 28;
/** Stamina drained per second while holding a block. */
const BLOCK_DRAIN_PER_S = 22;
/** Extra stamina cost when a blocked hit lands on your guard. */
const BLOCK_HIT_COST = 12;
const WEAK_FACTOR = 0.35;
const SWING_COOLDOWN_MS = 500;
const PARRY_WINDOW_MS = 250;
const PARRY_STUN_MS = 900;
const DMG_BASE = 8;
const DMG_SCALE = 9;
const COUNTDOWN_STEP_MS = 800;
const ROUND_END_LINGER_MS = 2600;
const REMATCH_LOCKOUT_MS = 1200;
export const WINS_NEEDED = 2;

export interface Fighter {
  hp: number;
  stamina: number;
  blocking: boolean;
  blockSince: number;
  stunnedUntil: number;
  lastSwingAt: number;
  isDummy: boolean;
}

export type GameEvent =
  | { e: 'phase'; phase: GamePhase }
  | { e: 'countdown'; n: number }
  | { e: 'swing'; attacker: PlayerIndex; dir: SwingDir; intensity: number }
  | { e: 'hit'; attacker: PlayerIndex; dmg: number }
  | { e: 'blocked'; attacker: PlayerIndex }
  | { e: 'parried'; attacker: PlayerIndex }
  | { e: 'roundEnd'; winner: PlayerIndex }
  | { e: 'matchEnd'; winner: PlayerIndex };

function freshFighter(isDummy = false): Fighter {
  return {
    hp: HP_MAX,
    stamina: STAMINA_MAX,
    blocking: false,
    blockSince: -Infinity,
    stunnedUntil: 0,
    lastSwingAt: -Infinity,
    isDummy,
  };
}

export class Game {
  phase: GamePhase = 'lobby';
  fighters: [Fighter, Fighter] = [freshFighter(), freshFighter()];
  roundWins: [number, number] = [0, 0];
  round = 1;
  solo = false;

  private countdownLeft = 0;
  private nextTickAt = 0;
  private roundEndAt = 0;
  private matchEndAt = 0;
  private dummyNextActionAt = 0;
  private dummyBlockUntil = 0;
  private lastUpdateAt = 0;
  private listeners: Array<(ev: GameEvent) => void> = [];

  onEvent(cb: (ev: GameEvent) => void) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }
  private emit(ev: GameEvent) {
    for (const cb of this.listeners) cb(ev);
  }
  private setPhase(phase: GamePhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.emit({ e: 'phase', phase });
  }

  startMatch(solo: boolean, now: number) {
    this.solo = solo;
    this.roundWins = [0, 0];
    this.round = 1;
    this.beginRound(now);
  }

  private beginRound(now: number) {
    this.fighters = [freshFighter(), freshFighter(this.solo)];
    this.countdownLeft = 3;
    this.nextTickAt = now;
    this.setPhase('countdown');
  }

  pause() {
    if (this.phase === 'countdown' || this.phase === 'fight') this.setPhase('paused');
  }

  resumeRound(now: number) {
    if (this.phase === 'paused') this.beginRound(now);
  }

  toLobby() {
    this.setPhase('lobby');
    this.fighters = [freshFighter(), freshFighter()];
    this.roundWins = [0, 0];
    this.round = 1;
  }

  swing(i: PlayerIndex, dir: SwingDir, intensity: number, now: number) {
    if (this.phase === 'matchEnd') {
      if (now - this.matchEndAt > REMATCH_LOCKOUT_MS) this.startMatch(this.solo, now);
      return;
    }
    if (this.phase !== 'fight') return;
    const me = this.fighters[i];
    const foe = this.fighters[(1 - i) as PlayerIndex];
    if (now < me.stunnedUntil) return;
    if (now - me.lastSwingAt < SWING_COOLDOWN_MS) return;
    me.lastSwingAt = now;
    this.emit({ e: 'swing', attacker: i, dir, intensity });

    const hasStamina = me.stamina >= STAMINA_COST;
    me.stamina = Math.max(0, me.stamina - STAMINA_COST);
    const dmg = Math.round((DMG_BASE + DMG_SCALE * intensity) * (hasStamina ? 1 : WEAK_FACTOR));

    if (foe.blocking) {
      foe.stamina = Math.max(0, foe.stamina - BLOCK_HIT_COST);
      if (foe.stamina <= 0) {
        foe.blocking = false;
      }
      if (now - foe.blockSince < PARRY_WINDOW_MS && !foe.isDummy && foe.blocking) {
        me.stunnedUntil = now + PARRY_STUN_MS;
        this.emit({ e: 'parried', attacker: i });
      } else if (foe.blocking) {
        this.emit({ e: 'blocked', attacker: i });
      } else {
        // Guard broke from stamina — hit goes through at reduced force.
        const breakDmg = Math.round(dmg * 0.6);
        foe.hp = Math.max(0, foe.hp - breakDmg);
        this.emit({ e: 'hit', attacker: i, dmg: breakDmg });
        if (foe.hp <= 0) this.endRound(i, now);
      }
      return;
    }
    foe.hp = Math.max(0, foe.hp - dmg);
    this.emit({ e: 'hit', attacker: i, dmg });
    if (foe.hp <= 0) this.endRound(i, now);
  }

  setBlock(i: PlayerIndex, on: boolean, now: number) {
    const f = this.fighters[i];
    if (on && f.stamina <= 0) {
      if (f.blocking) {
        f.blocking = false;
      }
      return;
    }
    if (f.blocking === on) return;
    f.blocking = on;
    if (on) f.blockSince = now;
  }

  private endRound(winner: PlayerIndex, now: number) {
    this.roundWins[winner]++;
    this.roundEndAt = now;
    this.setPhase('roundEnd');
    this.emit({ e: 'roundEnd', winner });
  }

  update(now: number) {
    const dt = this.lastUpdateAt ? Math.min(0.1, (now - this.lastUpdateAt) / 1000) : 0;
    this.lastUpdateAt = now;

    if (this.phase === 'countdown' && now >= this.nextTickAt) {
      if (this.countdownLeft > 0) {
        this.emit({ e: 'countdown', n: this.countdownLeft });
        this.countdownLeft--;
        this.nextTickAt = now + COUNTDOWN_STEP_MS;
      } else {
        this.emit({ e: 'countdown', n: 0 });
        this.setPhase('fight');
      }
    }

    if (this.phase === 'fight') {
      for (let i = 0; i < 2; i++) {
        const f = this.fighters[i];
        if (f.blocking) {
          f.stamina = Math.max(0, f.stamina - BLOCK_DRAIN_PER_S * dt);
          if (f.stamina <= 0) {
            f.blocking = false;
          }
        } else {
          f.stamina = Math.min(STAMINA_MAX, f.stamina + STAMINA_REGEN_PER_S * dt);
        }
      }
      if (this.solo) {
        const dummy = this.fighters[1];
        if (dummy.blocking && now >= this.dummyBlockUntil) this.setBlock(1, false, now);
        if (!dummy.blocking && now >= this.dummyNextActionAt && dummy.stamina > 20) {
          this.setBlock(1, true, now);
          this.dummyBlockUntil = now + 500 + Math.random() * 500;
          this.dummyNextActionAt = now + 1400 + Math.random() * 1400;
        }
      }
    }

    if (this.phase === 'roundEnd' && now - this.roundEndAt >= ROUND_END_LINGER_MS) {
      const champion = this.roundWins.findIndex((w) => w >= WINS_NEEDED);
      if (champion >= 0) {
        this.matchEndAt = now;
        this.setPhase('matchEnd');
        this.emit({ e: 'matchEnd', winner: champion as PlayerIndex });
      } else {
        this.round++;
        this.beginRound(now);
      }
    }
  }
}
