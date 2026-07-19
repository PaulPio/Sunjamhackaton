import type { Quat, SwingDir } from './protocol';
import type { SensorEvents, SensorHandle } from './sensors';

declare global {
  interface Window {
    __ctl?: {
      swing(intensity?: number, dir?: SwingDir): void;
      block(on: boolean): void;
      calibrate(): void;
    };
  }
}

function euler(alphaDeg: number, betaDeg: number, gammaDeg: number): Quat {
  const h = Math.PI / 360;
  const z = alphaDeg * h,
    x = betaDeg * h,
    y = gammaDeg * h;
  const cX = Math.cos(x),
    cY = Math.cos(y),
    cZ = Math.cos(z);
  const sX = Math.sin(x),
    sY = Math.sin(y),
    sZ = Math.sin(z);
  return [
    sX * cY * cZ - cX * sY * sZ,
    cX * sY * cZ + sX * cY * sZ,
    cX * cY * sZ + sX * sY * cZ,
    cX * cY * cZ - sX * sY * sZ,
  ];
}

export function startSimSensors(ev: SensorEvents, onCalibrate: () => void): SensorHandle {
  let blocking = false;
  let beta = 80;
  let alpha = 0;

  const sway = setInterval(() => {
    const t = performance.now() / 1000;
    const b = blocking ? 5 : beta + Math.sin(t * 1.3) * 6;
    const a = alpha + Math.sin(t * 0.7) * 8;
    ev.onOrient(euler(a, b, Math.sin(t * 0.9) * 4));
  }, 50);

  const swing = (intensity = 0.8, dir: SwingDir = 'horizontal') => {
    ev.onSwing(dir, Math.max(0, Math.min(1, intensity)));
  };
  const setBlock = (on: boolean) => {
    if (blocking === on) return;
    blocking = on;
    ev.onBlock(on);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'Space') swing(0.8);
    else if (e.code === 'KeyV') swing(0.8, 'vertical');
    else if (e.code === 'KeyT') swing(0.8, 'thrust');
    else if (e.code === 'KeyB') setBlock(true);
    else if (e.code === 'KeyC') onCalibrate();
    else if (e.code === 'ArrowLeft') alpha += 15;
    else if (e.code === 'ArrowRight') alpha -= 15;
    else if (e.code === 'ArrowUp') beta = Math.min(170, beta + 15);
    else if (e.code === 'ArrowDown') beta = Math.max(-10, beta - 15);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyB') setBlock(false);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  window.__ctl = { swing, block: setBlock, calibrate: onCalibrate };

  return {
    stop() {
      clearInterval(sway);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      delete window.__ctl;
    },
    sawOrientation: () => true,
  };
}
