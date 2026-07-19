'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Game, type GameEvent, WINS_NEEDED } from '@/lib/game';
import {
  startLocalHost,
  startPeerHost,
  type HostHandle,
  type Link,
} from '@/lib/link';
import {
  joinUrlForRoom,
  randomRoomCode,
  type ControllerMsg,
  type PlayerIndex,
  type ScreenMsg,
} from '@/lib/protocol';
import {
  DUMMY_COLOR,
  GameArena,
  P1_COLOR,
  P2_COLOR,
  type GameArenaHandle,
} from '@/components/GameArena';

const HUD_SEND_INTERVAL_MS = 100;

declare global {
  interface Window {
    __game?: Game;
    __screenReady?: boolean;
  }
}

export default function ScreenDesktop() {
  const code = useMemo(() => {
    if (typeof window === 'undefined') return '----';
    const q = new URLSearchParams(window.location.search).get('code');
    return q?.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || randomRoomCode();
  }, []);

  const joinUrl = useMemo(() => (code === '----' ? '' : joinUrlForRoom(code)), [code]);

  const arenaRef = useRef<GameArenaHandle>(null);
  const gameRef = useRef(new Game());
  const linksRef = useRef<[Link | null, Link | null]>([null, null]);
  const hostsRef = useRef<HostHandle[]>([]);
  const lastHudSend = useRef(0);

  const [showLobby, setShowLobby] = useState(true);
  const [slots, setSlots] = useState<[boolean, boolean]>([false, false]);
  const [netStatus, setNetStatus] = useState('connecting…');
  const [banner, setBanner] = useState<{ text: string; sub?: string; cls?: string } | null>(
    null,
  );
  const [bars, setBars] = useState({ hp0: 100, st0: 100, hp1: 100, st1: 100 });
  const [round, setRound] = useState(1);
  const [wins, setWins] = useState<[number, number]>([0, 0]);
  const [p2Name, setP2Name] = useState('P2');
  const bannerTimer = useRef<number | undefined>(undefined);

  const showBanner = useCallback((text: string, opts?: { sub?: string; ms?: number; cls?: string }) => {
    setBanner({ text, sub: opts?.sub, cls: opts?.cls });
    if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    const ms = opts?.ms ?? 1200;
    if (ms > 0) {
      bannerTimer.current = window.setTimeout(() => setBanner(null), ms);
    }
  }, []);

  const sendTo = useCallback((i: PlayerIndex, msg: ScreenMsg) => {
    linksRef.current[i]?.send(msg);
  }, []);

  const presentCount = useCallback(() => linksRef.current.filter(Boolean).length, []);

  useEffect(() => {
    const game = gameRef.current;
    window.__game = game;

    const onControllerLost = (slot: PlayerIndex) => {
      linksRef.current[slot] = null;
      arenaRef.current?.setConnected(slot, false);
      setSlots((s) => {
        const next: [boolean, boolean] = [...s] as [boolean, boolean];
        next[slot] = false;
        return next;
      });
      if (presentCount() === 0) {
        game.toLobby();
        arenaRef.current?.setDummyMode(false);
        setP2Name('P2');
        setWins([0, 0]);
        setBanner(null);
        setShowLobby(true);
      } else if (!game.solo && game.phase !== 'lobby' && game.phase !== 'matchEnd') {
        game.pause();
        showBanner(`P${slot + 1} DISCONNECTED`, { sub: `rejoin with code ${code}`, ms: 0 });
      }
    };

    const onControllerMsg = (i: PlayerIndex, msg: ControllerMsg) => {
      const now = performance.now();
      switch (msg.t) {
        case 'orient':
          arenaRef.current?.setSwordQuat(i, msg.q);
          break;
        case 'calibrate':
          arenaRef.current?.calibrate(i);
          break;
        case 'block':
          game.setBlock(i, msg.on, now);
          break;
        case 'swing':
          if (game.phase === 'lobby' && presentCount() === 1 && i === 0) {
            setShowLobby(false);
            showBanner('TRAINING MODE', { sub: 'a challenger can still join!', ms: 1600 });
            arenaRef.current?.setDummyMode(true);
            setP2Name('DUMMY');
            game.startMatch(true, now + 400);
          } else {
            game.swing(i, msg.dir, msg.intensity, now);
          }
          break;
        case 'join':
          break;
        default: {
          const _exhaustive: never = msg;
          void _exhaustive;
        }
      }
    };

    const onControllerLink = (link: Link) => {
      const slot = linksRef.current.findIndex((l) => l === null) as PlayerIndex | -1;
      if (slot === -1) {
        link.send({ t: 'full' } satisfies ScreenMsg);
        setTimeout(() => link.close(), 200);
        return;
      }
      linksRef.current[slot] = link;
      link.send({ t: 'assign', player: slot } satisfies ScreenMsg);
      arenaRef.current?.setConnected(slot, true);
      setSlots((s) => {
        const next: [boolean, boolean] = [...s] as [boolean, boolean];
        next[slot] = true;
        return next;
      });
      link.onMessage((raw) => onControllerMsg(slot, raw as ControllerMsg));
      link.onClose(() => onControllerLost(slot));

      const now = performance.now();
      if (presentCount() === 2) {
        arenaRef.current?.setDummyMode(false);
        setP2Name('P2');
        setShowLobby(false);
        if (game.phase === 'paused') {
          showBanner('BACK IN THE FIGHT', { ms: 1200 });
          game.resumeRound(now + 600);
        } else if (game.phase === 'lobby') {
          showBanner('DUEL STARTING', { ms: 1200 });
          game.startMatch(false, now + 600);
        } else {
          showBanner('A CHALLENGER APPEARS!', { ms: 1800 });
          game.startMatch(false, now + 900);
        }
      }
    };

    hostsRef.current = [
      startLocalHost(code, onControllerLink),
      startPeerHost(code, onControllerLink, (s) => {
        setNetStatus(
          s.kind === 'online'
            ? '✓ online — phones can join from anywhere'
            : s.kind === 'connecting'
              ? 'connecting to pairing service…'
              : `⚠ pairing service unreachable (${s.reason}) — same-device tabs still work`,
        );
      }),
    ];

    const offGame = game.onEvent((ev: GameEvent) => {
      const dummyColor = game.solo ? DUMMY_COLOR : P2_COLOR;
      switch (ev.e) {
        case 'phase':
          if (ev.phase === 'fight') showBanner('FIGHT!', { cls: 'big', ms: 900 });
          break;
        case 'countdown':
          if (ev.n > 0) {
            showBanner(String(ev.n), { cls: 'big', ms: 700 });
            setRound(game.round);
            setWins([...game.roundWins] as [number, number]);
          }
          break;
        case 'swing':
          arenaRef.current?.playSwing(ev.attacker, ev.dir, ev.intensity);
          break;
        case 'hit': {
          const target = (1 - ev.attacker) as PlayerIndex;
          arenaRef.current?.hitFx(target, ev.dmg);
          sendTo(ev.attacker, { t: 'fx', kind: 'landedHit' });
          sendTo(target, { t: 'fx', kind: 'tookHit' });
          break;
        }
        case 'blocked': {
          arenaRef.current?.clashFx(ev.attacker === 0 ? P2_COLOR : P1_COLOR, false);
          sendTo(ev.attacker, { t: 'fx', kind: 'wasBlocked' });
          sendTo((1 - ev.attacker) as PlayerIndex, { t: 'fx', kind: 'didBlock' });
          break;
        }
        case 'parried': {
          arenaRef.current?.clashFx('#ffd75a', true);
          showBanner('PARRY!', { ms: 800 });
          sendTo(ev.attacker, { t: 'fx', kind: 'gotParried' });
          sendTo((1 - ev.attacker) as PlayerIndex, { t: 'fx', kind: 'didParry' });
          break;
        }
        case 'roundEnd': {
          const name = ev.winner === 0 ? 'P1' : game.solo ? 'DUMMY' : 'P2';
          showBanner(`${name} TAKES ROUND ${game.round}`, { ms: 2200 });
          setWins([...game.roundWins] as [number, number]);
          arenaRef.current?.clashFx(ev.winner === 0 ? P1_COLOR : dummyColor, true);
          break;
        }
        case 'matchEnd': {
          const name = ev.winner === 0 ? 'PLAYER 1' : game.solo ? 'THE DUMMY' : 'PLAYER 2';
          showBanner(`${name} WINS THE MATCH`, {
            sub: 'swing to rematch · R to restart',
            ms: 0,
            cls: 'big',
          });
          break;
        }
        default: {
          const _exhaustive: never = ev;
          void _exhaustive;
        }
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyF') {
        document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen?.();
      } else if (e.code === 'KeyR' && game.phase === 'matchEnd') {
        game.startMatch(game.solo, performance.now());
      }
    };
    window.addEventListener('keydown', onKey);

    let raf = 0;
    let lastBarUi = 0;
    const frame = () => {
      const now = performance.now();
      game.update(now);
      const [f0, f1] = game.fighters;
      arenaRef.current?.syncFighters(
        f0.blocking,
        f1.blocking,
        now < f0.stunnedUntil,
        now < f1.stunnedUntil,
      );
      if (now - lastBarUi > HUD_SEND_INTERVAL_MS) {
        lastBarUi = now;
        setBars({
          hp0: f0.hp,
          st0: f0.stamina,
          hp1: f1.hp,
          st1: f1.stamina,
        });
        lastHudSend.current = now;
        for (const i of [0, 1] as const) {
          sendTo(i, {
            t: 'hud',
            hp: game.fighters[i].hp,
            stamina: game.fighters[i].stamina,
            phase: game.phase,
          });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.__screenReady = true;

    return () => {
      cancelAnimationFrame(raf);
      offGame();
      window.removeEventListener('keydown', onKey);
      for (const h of hostsRef.current) h.stop();
      for (const l of linksRef.current) l?.close();
      if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    };
  }, [code, presentCount, sendTo, showBanner]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-arena text-neon">
      <GameArena ref={arenaRef} />

      {/* Combat HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 md:p-6">
        <FighterHud
          name="P1"
          color={P1_COLOR}
          hp={bars.hp0}
          stamina={bars.st0}
          wins={wins[0]}
          align="left"
        />
        <div className="pt-2 text-center font-display text-sm tracking-[0.3em] text-neon/70 md:text-base">
          ROUND {round}
          <div className="mt-1 text-[10px] tracking-widest text-neon/40">
            FIRST TO {WINS_NEEDED}
          </div>
        </div>
        <FighterHud
          name={p2Name}
          color={p2Name === 'DUMMY' ? DUMMY_COLOR : P2_COLOR}
          hp={bars.hp1}
          stamina={bars.st1}
          wins={wins[1]}
          align="right"
        />
      </div>

      {banner && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="text-center">
            <div
              className={`font-display font-extrabold tracking-widest text-neon drop-shadow-[0_0_24px_rgba(0,229,255,0.55)] ${
                banner.cls === 'big' ? 'text-5xl md:text-7xl' : 'text-3xl md:text-5xl'
              }`}
            >
              {banner.text}
            </div>
            {banner.sub && (
              <div className="mt-3 font-body text-lg tracking-wide text-neon/70">{banner.sub}</div>
            )}
          </div>
        </div>
      )}

      {showLobby && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#05010d]/90 backdrop-blur-sm">
          <div className="mx-4 grid max-w-4xl gap-8 rounded-2xl border border-cyan-400/20 bg-panel p-6 shadow-[0_0_60px_rgba(255,45,117,0.15)] md:grid-cols-2 md:p-10">
            <div className="flex flex-col items-center justify-center text-center">
              <h1 className="font-display text-4xl font-extrabold tracking-[0.2em] text-neon md:text-5xl">
                DUEL LINK
              </h1>
              <p className="mt-2 font-body text-lg text-cyan-200/80">Your phone is the sword.</p>
              <div className="mt-6 rounded-xl bg-white p-3">
                {joinUrl ? (
                  <QRCodeSVG value={joinUrl} size={200} bgColor="#ffffff" fgColor="#0b0617" />
                ) : (
                  <div className="flex h-[200px] w-[200px] items-center justify-center text-black">
                    …
                  </div>
                )}
              </div>
              <p className="mt-3 text-sm text-neon/60">Scan with your phone</p>
            </div>
            <div className="flex flex-col justify-center">
              <p className="text-sm text-neon/60">
                or open <span className="text-cyan-300">/controller</span> and enter the code
              </p>
              <div className="mt-3 font-display text-5xl font-bold tracking-[0.35em] text-p1 md:text-6xl">
                {code}
              </div>
              <div className="mt-6 space-y-2">
                <SlotRow label="P1" joined={slots[0]} color={P1_COLOR} />
                <SlotRow label="P2" joined={slots[1]} color={P2_COLOR} />
              </div>
              <p className="mt-4 text-xs text-neon/50">{netStatus}</p>
              <p className="mt-3 text-sm text-neon/70">
                One phone joined? Swing to train against a dummy. Two phones auto-start the duel.
              </p>
              <p className="mt-4 text-xs text-neon/40">
                Dev: open{' '}
                <a className="text-cyan-400 underline" href={`/controller?room=${code}&sim=1&local=1`}>
                  sim controller
                </a>{' '}
                twice · F fullscreen
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-0 right-0 z-20 text-center text-xs tracking-widest text-neon/35">
        SWING TO ATTACK · HOLD FLAT TO BLOCK (DRAINS STAMINA) · F FULLSCREEN
      </div>
    </div>
  );
}

function FighterHud({
  name,
  color,
  hp,
  stamina,
  wins,
  align,
}: {
  name: string;
  color: string;
  hp: number;
  stamina: number;
  wins: number;
  align: 'left' | 'right';
}) {
  return (
    <div className={`w-36 md:w-52 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div className="font-display text-sm tracking-widest" style={{ color }}>
        {name}
      </div>
      <div className="mt-1 h-3 overflow-hidden rounded-sm bg-white/10">
        <div
          className="h-full origin-left transition-transform duration-100"
          style={{
            background: color,
            transform: `scaleX(${Math.max(0, hp) / 100})`,
            transformOrigin: align === 'right' ? 'right' : 'left',
          }}
        />
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-white/10">
        <div
          className="h-full bg-amber-300/90 transition-transform duration-100"
          style={{
            transform: `scaleX(${Math.max(0, stamina) / 100})`,
            transformOrigin: align === 'right' ? 'right' : 'left',
          }}
        />
      </div>
      <div className={`mt-2 flex gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {[0, 1].map((i) => (
          <span
            key={i}
            className="inline-block h-2.5 w-2.5 rounded-full border"
            style={{
              borderColor: color,
              background: i < wins ? color : 'transparent',
              boxShadow: i < wins ? `0 0 8px ${color}` : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SlotRow({ label, joined, color }: { label: string; joined: boolean; color: string }) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 font-body text-lg ${
        joined ? 'border-opacity-80 bg-white/5' : 'border-white/15 text-neon/50'
      }`}
      style={{ borderColor: joined ? color : undefined, color: joined ? color : undefined }}
    >
      {label} · {joined ? '⚔️ armed' : 'waiting…'}
    </div>
  );
}
