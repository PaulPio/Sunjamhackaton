// Reads real phone sensors and turns them into game inputs.
// - deviceorientation -> device quaternion, streamed ~30 Hz (visuals only)
// - devicemotion -> swing detection ON the phone (single low-latency event)
// - orientation posture (blade horizontal) + low motion -> block stance

import type { Quat, SwingDir } from '../shared/protocol';

export interface SensorEvents {
  onOrient(q: Quat): void;
  onSwing(dir: SwingDir, intensity: number): void;
  onBlock(on: boolean): void;
}

/** iOS 13+ gates motion sensors behind a permission prompt from a user tap. */
export async function requestMotionPermission(): Promise<boolean> {
  const DME = DeviceMotionEvent as any;
  const DOE = DeviceOrientationEvent as any;
  try {
    if (typeof DME?.requestPermission === 'function') {
      if ((await DME.requestPermission()) !== 'granted') return false;
    }
    if (typeof DOE?.requestPermission === 'function') {
      if ((await DOE.requestPermission()) !== 'granted') return false;
    }
    return true;
  } catch {
    return false;
  }
}

const HALF_DEG = Math.PI / 360;

/**
 * Device orientation (alpha, beta, gamma — intrinsic Tait-Bryan ZXY) to a
 * quaternion mapping device-body axes into the device world frame
 * (X east, Y north, Z up). Standard W3C formula.
 */
function eulerToQuat(alpha: number, beta: number, gamma: number): Quat {
  const z = alpha * HALF_DEG;
  const x = beta * HALF_DEG;
  const y = gamma * HALF_DEG;
  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z);
  const sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  return [
    sX * cY * cZ - cX * sY * sZ,
    cX * sY * cZ + sX * cY * sZ,
    cX * cY * sZ + sX * sY * cZ,
    cX * cY * cZ - sX * sY * sZ,
  ];
}

/** Rotate the device's +Y axis (the blade direction) by q; return world Z component (1 = blade straight up, 0 = horizontal). */
function bladeUpness(q: Quat): number {
  const [x, y, z, w] = q;
  return 2 * (y * z + w * x);
}

const ORIENT_INTERVAL_MS = 33; // ~30 Hz
const SWING_THRESHOLD = 13; // m/s^2, gravity-free
const SWING_COOLDOWN_MS = 400;
const BLOCK_ENTER = 0.35; // |upness| below this = blade horizontal
const BLOCK_EXIT = 0.5;
const BLOCK_CALM_ACCEL = 4; // must be moving gently to count as a stance

export interface SensorHandle {
  stop(): void;
  /** True once real orientation events have been observed. */
  sawOrientation(): boolean;
}

export function startSensors(ev: SensorEvents): SensorHandle {
  let lastOrientSent = 0;
  let lastSwingAt = 0;
  let blocking = false;
  let horizontalSince = 0;
  let accelEma = 0;
  let gravityX = 0, gravityY = 0, gravityZ = 9.8; // low-pass fallback estimate
  let sawOrient = false;

  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha == null && e.beta == null && e.gamma == null) return;
    sawOrient = true;
    const q = eulerToQuat(e.alpha ?? 0, e.beta ?? 0, e.gamma ?? 0);
    const now = performance.now();
    if (now - lastOrientSent >= ORIENT_INTERVAL_MS) {
      lastOrientSent = now;
      ev.onOrient(q);
    }
    // Block stance: blade held horizontal while the phone is calm.
    const upness = Math.abs(bladeUpness(q));
    if (!blocking) {
      if (upness < BLOCK_ENTER && accelEma < BLOCK_CALM_ACCEL) {
        if (horizontalSince === 0) horizontalSince = now;
        if (now - horizontalSince > 150) {
          blocking = true;
          ev.onBlock(true);
        }
      } else {
        horizontalSince = 0;
      }
    } else if (upness > BLOCK_EXIT) {
      blocking = false;
      horizontalSince = 0;
      ev.onBlock(false);
    }
  };

  const onMotion = (e: DeviceMotionEvent) => {
    let ax: number, ay: number, az: number;
    const a = e.acceleration;
    if (a && (a.x != null || a.y != null || a.z != null)) {
      ax = a.x ?? 0; ay = a.y ?? 0; az = a.z ?? 0;
    } else {
      // No gravity-free channel: high-pass accelerationIncludingGravity.
      const g = e.accelerationIncludingGravity;
      if (!g) return;
      const k = 0.9;
      gravityX = k * gravityX + (1 - k) * (g.x ?? 0);
      gravityY = k * gravityY + (1 - k) * (g.y ?? 0);
      gravityZ = k * gravityZ + (1 - k) * (g.z ?? 0);
      ax = (g.x ?? 0) - gravityX; ay = (g.y ?? 0) - gravityY; az = (g.z ?? 0) - gravityZ;
    }
    const mag = Math.hypot(ax, ay, az);
    accelEma = 0.7 * accelEma + 0.3 * mag;
    const now = performance.now();
    if (mag > SWING_THRESHOLD && now - lastSwingAt > SWING_COOLDOWN_MS && !blocking) {
      lastSwingAt = now;
      const absX = Math.abs(ax), absY = Math.abs(ay), absZ = Math.abs(az);
      const dir: SwingDir = absY >= absX && absY >= absZ ? 'thrust' : absX >= absZ ? 'horizontal' : 'vertical';
      const intensity = Math.min(1, (mag - SWING_THRESHOLD) / 20);
      ev.onSwing(dir, intensity);
    }
  };

  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('devicemotion', onMotion);
  return {
    stop() {
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('devicemotion', onMotion);
    },
    sawOrientation: () => sawOrient,
  };
}
