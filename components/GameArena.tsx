import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { PlayerIndex, Quat, SwingDir } from '@/lib/protocol';

export const P1_COLOR = '#ff2d75';
export const P2_COLOR = '#00e5ff';
export const DUMMY_COLOR = '#9b7dff';

export interface ArenaHudState {
  hp0: number;
  st0: number;
  hp1: number;
  st1: number;
  round: number;
  wins0: number;
  wins1: number;
  blocking0: boolean;
  blocking1: boolean;
  connected0: boolean;
  connected1: boolean;
  dummyMode: boolean;
}

export interface GameArenaHandle {
  setSwordQuat(i: PlayerIndex, q: Quat): void;
  calibrate(i: PlayerIndex): void;
  playSwing(i: PlayerIndex, dir: SwingDir, intensity: number): void;
  hitFx(target: PlayerIndex, dmg: number): void;
  clashFx(color: string, big: boolean): void;
  setConnected(i: PlayerIndex, on: boolean): void;
  setDummyMode(on: boolean): void;
  syncFighters(blocking0: boolean, blocking1: boolean, stunned0: boolean, stunned1: boolean): void;
}

interface FighterDraw {
  x: number;
  baseX: number;
  facing: 1 | -1;
  color: string;
  connected: boolean;
  blocking: boolean;
  stunned: boolean;
  swordAngle: number; // radians, 0 = upright
  swingT: number;
  swingDir: SwingDir;
  swingIntensity: number;
  hitFlash: number;
  knock: number;
  calibYaw: number;
}

function quatToSwordAngle(q: Quat, facing: 1 | -1, calibYaw: number): number {
  // Approximate blade lean from quaternion: tip direction in device frame.
  const [x, y, z, w] = q;
  const tipX = 2 * (x * y - w * z);
  const tipZ = 1 - 2 * (x * x + y * y);
  const yaw = Math.atan2(tipX, tipZ) - calibYaw;
  const lean = Math.atan2(tipX * facing, Math.max(0.15, tipZ));
  return lean * 0.85 + yaw * 0.15 * facing;
}

export const GameArena = forwardRef<GameArenaHandle, { className?: string }>(
  function GameArena({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fightersRef = useRef<[FighterDraw, FighterDraw]>([
      {
        x: 0,
        baseX: 0,
        facing: 1,
        color: P1_COLOR,
        connected: false,
        blocking: false,
        stunned: false,
        swordAngle: 0,
        swingT: 0,
        swingDir: 'horizontal',
        swingIntensity: 0,
        hitFlash: 0,
        knock: 0,
        calibYaw: 0,
      },
      {
        x: 0,
        baseX: 0,
        facing: -1,
        color: P2_COLOR,
        connected: false,
        blocking: false,
        stunned: false,
        swordAngle: 0,
        swingT: 0,
        swingDir: 'horizontal',
        swingIntensity: 0,
        hitFlash: 0,
        knock: 0,
        calibYaw: 0,
      },
    ]);
    const fxRef = useRef<{ t: number; color: string; big: boolean }[]>([]);
    const dummyModeRef = useRef(false);
    const timeRef = useRef(0);

    useImperativeHandle(ref, () => ({
      setSwordQuat(i, q) {
        const f = fightersRef.current[i];
        f.swordAngle = quatToSwordAngle(q, f.facing, f.calibYaw);
      },
      calibrate(i) {
        const f = fightersRef.current[i];
        f.calibYaw = f.swordAngle;
        f.swordAngle = 0;
      },
      playSwing(i, dir, intensity) {
        const f = fightersRef.current[i];
        f.swingT = 1;
        f.swingDir = dir;
        f.swingIntensity = intensity;
      },
      hitFx(target, dmg) {
        const f = fightersRef.current[target];
        f.hitFlash = 1;
        f.knock = (dmg / 17) * 28 * -f.facing;
      },
      clashFx(color, big) {
        fxRef.current.push({ t: 1, color, big });
      },
      setConnected(i, on) {
        fightersRef.current[i].connected = on;
      },
      setDummyMode(on) {
        dummyModeRef.current = on;
        fightersRef.current[1].color = on ? DUMMY_COLOR : P2_COLOR;
      },
      syncFighters(b0, b1, s0, s1) {
        fightersRef.current[0].blocking = b0;
        fightersRef.current[1].blocking = b1;
        fightersRef.current[0].stunned = s0;
        fightersRef.current[1].stunned = s1;
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let raf = 0;
      let last = performance.now();

      const resize = () => {
        const parent = canvas.parentElement;
        const w = parent?.clientWidth ?? window.innerWidth;
        const h = parent?.clientHeight ?? window.innerHeight;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const groundY = h * 0.78;
        const span = Math.min(w * 0.28, 220);
        fightersRef.current[0].baseX = w * 0.5 - span;
        fightersRef.current[1].baseX = w * 0.5 + span;
        fightersRef.current[0].x = fightersRef.current[0].baseX;
        fightersRef.current[1].x = fightersRef.current[1].baseX;
        void groundY;
      };
      resize();
      window.addEventListener('resize', resize);

      const drawBackground = (w: number, h: number, t: number) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#0a0520');
        g.addColorStop(0.55, '#12082e');
        g.addColorStop(1, '#05010d');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        // perspective grid floor
        const horizon = h * 0.55;
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 14; i++) {
          const y = horizon + ((h - horizon) * i) / 13;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        for (let i = -10; i <= 10; i++) {
          ctx.beginPath();
          ctx.moveTo(w / 2 + i * 40, horizon);
          ctx.lineTo(w / 2 + i * 140, h);
          ctx.stroke();
        }

        // neon floor glow
        const glow = ctx.createRadialGradient(w / 2, h * 0.82, 10, w / 2, h * 0.82, w * 0.45);
        glow.addColorStop(0, 'rgba(255, 45, 117, 0.12)');
        glow.addColorStop(0.5, 'rgba(0, 229, 255, 0.08)');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(0, horizon, w, h - horizon);

        // scanlines
        ctx.fillStyle = `rgba(0,0,0,${0.08 + Math.sin(t * 2) * 0.02})`;
        for (let y = 0; y < h; y += 4) {
          ctx.fillRect(0, y, w, 1);
        }
      };

      const drawCharacter = (f: FighterDraw, groundY: number, scale: number) => {
        const bodyH = 110 * scale;
        const bodyW = 36 * scale;
        const cx = f.x;
        const cy = groundY - bodyH * 0.15;

        ctx.save();
        ctx.translate(cx, cy);

        if (f.hitFlash > 0) {
          ctx.globalAlpha = 0.5 + f.hitFlash * 0.5;
        }
        if (f.stunned) {
          ctx.globalAlpha = 0.65;
        }

        // legs
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 5 * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-10 * scale, 20 * scale);
        ctx.lineTo(-14 * scale, 70 * scale);
        ctx.moveTo(10 * scale, 20 * scale);
        ctx.lineTo(16 * scale, 70 * scale);
        ctx.stroke();

        // torso
        const torsoGrad = ctx.createLinearGradient(0, -bodyH * 0.5, 0, 30 * scale);
        torsoGrad.addColorStop(0, f.color);
        torsoGrad.addColorStop(1, '#1a0a28');
        ctx.fillStyle = torsoGrad;
        ctx.shadowColor = f.color;
        ctx.shadowBlur = f.connected ? 18 : 4;
        roundRect(ctx, -bodyW / 2, -bodyH * 0.45, bodyW, bodyH * 0.55, 8 * scale);
        ctx.fill();

        // head
        ctx.beginPath();
        ctx.arc(0, -bodyH * 0.55, 16 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#e8f7ff';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // visor
        ctx.fillStyle = f.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(-10 * scale, -bodyH * 0.58, 20 * scale, 5 * scale);
        ctx.globalAlpha = 1;

        // sword
        let angle = f.swordAngle;
        if (f.blocking) {
          angle = f.facing * 0.15;
        }
        if (f.swingT > 0) {
          const arc =
            f.swingDir === 'thrust'
              ? 0
              : f.swingDir === 'vertical'
                ? Math.sin((1 - f.swingT) * Math.PI) * 1.2 * f.facing
                : Math.sin((1 - f.swingT) * Math.PI) * 1.6 * f.facing;
          angle += arc * (0.6 + f.swingIntensity * 0.4);
        }

        const handX = 18 * scale * f.facing;
        const handY = -10 * scale;
        ctx.save();
        ctx.translate(handX, handY);
        ctx.rotate(angle - (Math.PI / 2) * f.facing + (f.facing === 1 ? 0 : Math.PI));

        const bladeLen = 95 * scale * (f.blocking ? 0.85 : 1);
        const bladeGrad = ctx.createLinearGradient(0, 0, 0, -bladeLen);
        bladeGrad.addColorStop(0, '#ffffff');
        bladeGrad.addColorStop(0.2, f.color);
        bladeGrad.addColorStop(1, 'rgba(255,255,255,0.1)');
        ctx.strokeStyle = bladeGrad;
        ctx.lineWidth = 4 * scale;
        ctx.shadowColor = f.color;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.moveTo(0, 8 * scale);
        ctx.lineTo(0, -bladeLen);
        ctx.stroke();
        // tip glow
        ctx.beginPath();
        ctx.arc(0, -bladeLen, 4 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        // hilt
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#2a2038';
        ctx.fillRect(-5 * scale, 4 * scale, 10 * scale, 16 * scale);
        ctx.restore();

        // block shield arc
        if (f.blocking) {
          ctx.strokeStyle = f.color;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(10 * f.facing * scale, -20 * scale, 42 * scale, -1.2, 1.2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // disconnected ghost
        if (!f.connected && !dummyModeRef.current) {
          ctx.fillStyle = 'rgba(10,5,20,0.45)';
          ctx.fillRect(-40 * scale, -bodyH * 0.7, 80 * scale, bodyH + 40 * scale);
        }

        ctx.restore();
      };

      const frame = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        timeRef.current += dt;

        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const groundY = h * 0.78;
        const scale = Math.min(1.15, Math.max(0.75, w / 1100));

        for (const f of fightersRef.current) {
          f.x += (f.baseX + f.knock - f.x) * Math.min(1, dt * 8);
          f.knock *= Math.max(0, 1 - dt * 5);
          f.hitFlash = Math.max(0, f.hitFlash - dt * 3);
          f.swingT = Math.max(0, f.swingT - dt * 3.2);
        }
        fxRef.current = fxRef.current
          .map((fx) => ({ ...fx, t: fx.t - dt * 2.2 }))
          .filter((fx) => fx.t > 0);

        drawBackground(w, h, timeRef.current);

        // platform
        ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
        ctx.fillRect(w * 0.12, groundY + 8, w * 0.76, 10);
        ctx.strokeStyle = 'rgba(255, 45, 117, 0.35)';
        ctx.strokeRect(w * 0.12, groundY + 8, w * 0.76, 10);

        for (const f of fightersRef.current) {
          drawCharacter(f, groundY, scale);
        }

        // clash FX
        for (const fx of fxRef.current) {
          const midX = (fightersRef.current[0].x + fightersRef.current[1].x) / 2;
          const midY = groundY - 80 * scale;
          ctx.save();
          ctx.globalAlpha = fx.t;
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = fx.big ? 4 : 2;
          ctx.shadowColor = fx.color;
          ctx.shadowBlur = 24;
          const r = (1 - fx.t) * (fx.big ? 90 : 50);
          ctx.beginPath();
          ctx.arc(midX, midY, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        className={className ?? 'absolute inset-0 h-full w-full'}
        aria-label="DUEL LINK arena"
      />
    );
  },
);

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
