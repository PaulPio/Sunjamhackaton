'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  connectLocalController,
  connectPeerController,
  type Link,
} from '@/lib/link';
import {
  CODE_LENGTH,
  normalizeRoomCode,
  type ControllerMsg,
  type GamePhase,
  type ScreenMsg,
} from '@/lib/protocol';
import { requestMotionPermission, startSensors, type SensorHandle } from '@/lib/sensors';
import { startSimSensors } from '@/lib/sim';

const PLAYER_COLORS = ['#ff2d75', '#00e5ff'];
const PLAYER_NAMES = ['P1', 'P2'];

const PHASE_TEXT: Record<GamePhase, string> = {
  lobby: 'WAITING FOR THE DUEL…',
  countdown: 'GET READY…',
  fight: 'FIGHT!',
  roundEnd: 'ROUND OVER',
  matchEnd: 'MATCH OVER — SWING TO REMATCH',
  paused: 'PAUSED — WAITING FOR OPPONENT',
};

type Stage =
  | { kind: 'code'; error?: string }
  | { kind: 'message'; html: string; retry?: boolean }
  | { kind: 'arm' }
  | { kind: 'fight' };

export default function ControllerApp() {
  const opts = useMemo(() => {
    if (typeof window === 'undefined') return { sim: false, local: false, room: '' };
    const sp = new URLSearchParams(window.location.search);
    return {
      sim: sp.get('sim') === '1',
      local: sp.get('local') === '1' || sp.get('sim') === '1',
      room: normalizeRoomCode(sp.get('room') ?? ''),
    };
  }, []);

  const [stage, setStage] = useState<Stage>(() =>
    opts.room.length === CODE_LENGTH
      ? { kind: 'message', html: 'Connecting…' }
      : { kind: 'code' },
  );
  const [player, setPlayer] = useState(-1);
  const [room, setRoom] = useState(opts.room);
  const [hp, setHp] = useState(100);
  const [stamina, setStamina] = useState(100);
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [blocking, setBlocking] = useState(false);
  const [flash, setFlash] = useState<'red' | 'white' | 'gold' | null>(null);
  const [armError, setArmError] = useState('');
  const [braveWarn, setBraveWarn] = useState(false);
  const [codeInput, setCodeInput] = useState('');

  const linkRef = useRef<Link | null>(null);
  const sensorsRef = useRef<SensorHandle | null>(null);
  const playerRef = useRef(-1);

  const send = useCallback((msg: ControllerMsg) => {
    linkRef.current?.send(msg);
  }, []);

  const doFlash = useCallback((kind: 'red' | 'white' | 'gold') => {
    setFlash(null);
    requestAnimationFrame(() => setFlash(kind));
  }, []);

  const stopFighting = useCallback(() => {
    sensorsRef.current?.stop();
    sensorsRef.current = null;
  }, []);

  const calibrate = useCallback(() => {
    send({ t: 'calibrate' });
    doFlash('white');
    navigator.vibrate?.(20);
  }, [doFlash, send]);

  const startFighting = useCallback(() => {
    setStage({ kind: 'fight' });
    const events = {
      onOrient: (q: [number, number, number, number]) => send({ t: 'orient', q }),
      onSwing: (dir: 'horizontal' | 'vertical' | 'thrust', intensity: number) => {
        send({ t: 'swing', dir, intensity });
      },
      onBlock: (on: boolean) => {
        send({ t: 'block', on });
        setBlocking(on);
        if (on) navigator.vibrate?.(15);
      },
    };
    sensorsRef.current = opts.sim
      ? startSimSensors(events, calibrate)
      : startSensors(events);
    setTimeout(calibrate, 400);
    if (!opts.sim) {
      setTimeout(() => {
        if (sensorsRef.current && !sensorsRef.current.sawOrientation()) {
          setPhase('lobby');
          setStage({
            kind: 'fight',
          });
        }
      }, 3000);
    }
  }, [calibrate, opts.sim, send]);

  const arm = useCallback(async () => {
    setArmError('');
    if (!opts.sim) {
      const granted = await requestMotionPermission();
      if (!granted) {
        setArmError('Motion access denied — allow motion & orientation for this site and retry.');
        return;
      }
    }
    startFighting();
  }, [opts.sim, startFighting]);

  const onScreenMsg = useCallback(
    (msg: ScreenMsg) => {
      switch (msg.t) {
        case 'assign':
          playerRef.current = msg.player;
          setPlayer(msg.player);
          document.body.style.setProperty('--player-color', PLAYER_COLORS[msg.player]);
          setStage({ kind: 'arm' });
          break;
        case 'full':
          setStage({
            kind: 'message',
            html: 'This duel already has two swords.<br/><small>Wait for the next match!</small>',
          });
          break;
        case 'fx':
          switch (msg.kind) {
            case 'tookHit':
              doFlash('red');
              navigator.vibrate?.([60, 40, 90]);
              break;
            case 'landedHit':
              navigator.vibrate?.(40);
              break;
            case 'didBlock':
              doFlash('white');
              navigator.vibrate?.(30);
              break;
            case 'wasBlocked':
              navigator.vibrate?.(25);
              break;
            case 'didParry':
              doFlash('gold');
              navigator.vibrate?.([30, 30, 60]);
              break;
            case 'gotParried':
              doFlash('red');
              navigator.vibrate?.([30, 30, 30, 30, 120]);
              break;
            default: {
              const _exhaustive: never = msg.kind;
              void _exhaustive;
            }
          }
          break;
        case 'hud':
          setHp(msg.hp);
          setStamina(msg.stamina);
          setPhase(msg.phase);
          break;
        default: {
          const _exhaustive: never = msg;
          void _exhaustive;
        }
      }
    },
    [doFlash],
  );

  const connect = useCallback(
    async (code: string) => {
      setRoom(code);
      setStage({ kind: 'message', html: 'Connecting…' });
      try {
        const link =
          opts.local || opts.sim
            ? await connectLocalController(code)
            : await connectPeerController(code);
        linkRef.current = link;
        link.onMessage((raw) => onScreenMsg(raw as ScreenMsg));
        link.onClose(() => {
          stopFighting();
          setStage({ kind: 'message', html: 'Disconnected from the screen.', retry: true });
        });
        link.send({ t: 'join' } satisfies ControllerMsg);
        setStage({ kind: 'message', html: 'Waiting for a sword slot…' });
      } catch (err) {
        setStage({
          kind: 'message',
          html:
            `Couldn't reach the screen for code <b>${code}</b>.<br/>` +
            `<small>${err instanceof Error ? err.message : String(err)}</small><br/>` +
            `<small>Make sure the arena is open on the desktop.</small>`,
          retry: true,
        });
      }
    },
    [onScreenMsg, opts.local, opts.sim, stopFighting],
  );

  useEffect(() => {
    (navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }).brave
      ?.isBrave?.()
      .then((isBrave) => {
        if (isBrave) setBraveWarn(true);
      })
      .catch(() => {});

    if (opts.room.length === CODE_LENGTH) {
      void connect(opts.room);
    }

    return () => {
      stopFighting();
      linkRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, []);

  const color = player >= 0 ? PLAYER_COLORS[player] : '#d9f1ff';

  return (
    <div className="relative flex min-h-full flex-col bg-arena text-neon">
      <div
        className={`pointer-events-none absolute inset-0 z-50 ${
          flash === 'red' ? 'flash-red' : flash === 'white' ? 'flash-white' : flash === 'gold' ? 'flash-gold' : ''
        }`}
      />
      <header className="flex items-center justify-between px-4 py-3">
        <span className="font-display text-lg tracking-widest" style={{ color }}>
          {player >= 0 ? PLAYER_NAMES[player] : 'SWORD'}
        </span>
        <span className="font-display tracking-[0.3em] text-neon/60">{room}</span>
        {opts.sim && (
          <span className="rounded border border-amber-300/50 px-2 py-0.5 text-xs text-amber-200">
            SIM
          </span>
        )}
      </header>

      {braveWarn && (
        <p className="mx-4 mb-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Brave Shields can block phone↔screen connections. Turn Shields off for this site, or use
          Chrome/Safari.
        </p>
      )}

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
        {stage.kind === 'code' && (
          <>
            <h2 className="font-display text-2xl tracking-widest">JOIN A DUEL</h2>
            <p className="mt-2 text-neon/70">
              Enter the {CODE_LENGTH}-letter code shown on the big screen
            </p>
            <input
              className="mt-6 w-48 border-b-2 border-cyan-400 bg-transparent text-center font-display text-4xl tracking-[0.4em] outline-none"
              maxLength={CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="ABCD"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const c = normalizeRoomCode(codeInput);
                  if (c.length === CODE_LENGTH) void connect(c);
                }
              }}
            />
            <button
              type="button"
              className="mt-8 rounded-xl border-2 border-cyan-400 px-10 py-4 font-display text-xl tracking-widest text-cyan-200 active:scale-95"
              onClick={() => {
                const c = normalizeRoomCode(codeInput);
                if (c.length === CODE_LENGTH) void connect(c);
              }}
            >
              JOIN
            </button>
            {stage.error && <p className="mt-4 text-p1">{stage.error}</p>}
          </>
        )}

        {stage.kind === 'message' && (
          <>
            <div
              className="font-body text-lg leading-relaxed text-neon/90"
              dangerouslySetInnerHTML={{ __html: stage.html }}
            />
            {stage.retry && (
              <button
                type="button"
                className="mt-8 rounded-xl border-2 border-cyan-400 px-10 py-4 font-display tracking-widest"
                onClick={() => (room ? void connect(room) : setStage({ kind: 'code' }))}
              >
                TRY AGAIN
              </button>
            )}
          </>
        )}

        {stage.kind === 'arm' && (
          <>
            <h2 className="font-display text-2xl tracking-widest" style={{ color }}>
              YOU ARE {PLAYER_NAMES[player]}
            </h2>
            <ol className="mt-6 list-decimal space-y-2 pl-5 text-left text-neon/80">
              <li>Grip your phone like a sword handle</li>
              <li>Hold it upright, screen facing the big screen</li>
              <li>Tap ARM to calibrate</li>
            </ol>
            <button
              type="button"
              className="mt-10 rounded-2xl border-4 px-8 py-6 font-display text-2xl tracking-widest active:scale-95"
              style={{ borderColor: color, color }}
              onClick={() => void arm()}
            >
              ⚔️ TAP TO ARM
            </button>
            {armError && <p className="mt-4 text-sm text-p1">{armError}</p>}
          </>
        )}

        {stage.kind === 'fight' && (
          <>
            <div className="font-display text-xl tracking-widest text-neon/90">
              {PHASE_TEXT[phase]}
            </div>
            <div className="mt-6 w-full max-w-sm space-y-2">
              <div className="h-4 overflow-hidden rounded bg-white/10">
                <div
                  className="ctl-bar-fill h-full"
                  style={{
                    background: color,
                    transform: `scaleX(${Math.max(0, hp) / 100})`,
                  }}
                />
              </div>
              <div className="h-2 overflow-hidden rounded bg-white/10">
                <div
                  className="ctl-bar-fill h-full bg-amber-300"
                  style={{ transform: `scaleX(${Math.max(0, stamina) / 100})` }}
                />
              </div>
            </div>
            <div
              className={`mt-6 rounded-lg border px-6 py-2 font-display tracking-widest transition ${
                blocking
                  ? 'border-cyan-300 bg-cyan-400/20 text-cyan-100 opacity-100'
                  : 'border-transparent opacity-30'
              }`}
            >
              🛡 BLOCKING
            </div>
            <div className="mt-8 space-y-2 text-neon/70">
              <p>
                💨 <b>Swing hard</b> to attack
              </p>
              <p>
                🛡 <b>Hold blade flat</b> to block (drains stamina)
              </p>
              {opts.sim && (
                <p className="text-amber-200/80">
                  SIM: Space=swing · hold B=block · C=calibrate · arrows=aim
                </p>
              )}
            </div>
            <button
              type="button"
              className="mt-8 rounded-lg border border-white/20 px-4 py-2 text-sm text-neon/70"
              onClick={calibrate}
            >
              ↻ RECALIBRATE (point at screen)
            </button>
          </>
        )}
      </main>
    </div>
  );
}
