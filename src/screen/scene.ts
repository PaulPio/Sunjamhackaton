// Neon synthwave arena. Two energy blades held by ghost hands, driven 1:1 by
// the phones' orientation quaternions. Side view: P1 left, P2 right.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { PlayerIndex, Quat } from '../shared/protocol';

export const P1_COLOR = 0xff2d75;
export const P2_COLOR = 0x00e5ff;
export const DUMMY_COLOR = 0x7dff5a;

// Device world frame (X east, Y north, Z up) -> three world (Y up, Z toward camera).
const DEVICE_TO_THREE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
// After calibration "phone facing the TV" = +Z; bias turns that toward the opponent.
const YAW_BIAS = [
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
];

const GRIP_POS = [new THREE.Vector3(-1.15, 1.02, 0), new THREE.Vector3(1.15, 1.02, 0)];
const CLASH_POS = new THREE.Vector3(0, 1.45, 0);

const MAX_PARTICLES = 160;

function makeSword(color: number): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 1.05, 0.024),
    new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: color, emissiveIntensity: 2.4 }),
  );
  blade.position.y = 0.72;
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.16, 4),
    new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: color, emissiveIntensity: 2.4 }),
  );
  tip.position.y = 1.32;
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.024, 1.0, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  core.position.y = 0.72;
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.045, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x181826, emissive: color, emissiveIntensity: 0.35, metalness: 0.8, roughness: 0.3 }),
  );
  guard.position.y = 0.18;
  const hilt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.038, 0.26, 10),
    new THREE.MeshStandardMaterial({ color: 0x11111c, metalness: 0.7, roughness: 0.45 }),
  );
  hilt.position.y = 0.02;
  const hand = new THREE.Mesh(
    new THREE.SphereGeometry(0.095, 16, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  hand.scale.set(1, 0.8, 1);
  hand.position.y = 0.0;
  g.add(blade, tip, core, guard, hilt, hand);
  return g;
}

interface SwordState {
  group: THREE.Group;
  target: THREE.Quaternion;
  calib: THREE.Quaternion;
  lastRawWorld: THREE.Quaternion;
  lastOrientAt: number;
  connected: boolean;
}

export class ArenaScene {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private swords: [SwordState, SwordState];
  private dummyMode = false;
  private dummyBlocking = false;
  private shake = 0;
  private clashLight: THREE.PointLight;
  private particles: THREE.Points;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pIndex = 0;
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private clock = new THREE.Clock();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x05010d);
    this.scene.fog = new THREE.Fog(0x05010d, 6, 18);

    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 60);
    this.camera.position.set(0, 1.75, 4.7);
    this.camera.lookAt(0, 1.1, 0);

    // Floor: dark plane + neon grid, plus a faint horizon sun for the vibe.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x070313, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(60, 90, 0xff2d75, 0x2a1b6e);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = 0.01;
    this.scene.add(grid);
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(4.5, 48),
      new THREE.MeshBasicMaterial({ color: 0xff2d75, transparent: true, opacity: 0.16 }),
    );
    sun.position.set(0, 2.2, -14);
    this.scene.add(sun);

    this.scene.add(new THREE.AmbientLight(0x334, 1.2));
    const key = new THREE.DirectionalLight(0x8899ff, 1.1);
    key.position.set(2, 5, 4);
    this.scene.add(key);
    this.clashLight = new THREE.PointLight(0xffffff, 0, 8);
    this.clashLight.position.copy(CLASH_POS);
    this.scene.add(this.clashLight);

    const mkState = (i: PlayerIndex): SwordState => {
      const group = makeSword(i === 0 ? P1_COLOR : P2_COLOR);
      group.position.copy(GRIP_POS[i]);
      this.scene.add(group);
      return {
        group,
        target: new THREE.Quaternion(),
        calib: new THREE.Quaternion(),
        lastRawWorld: new THREE.Quaternion(),
        lastOrientAt: 0,
        connected: false,
      };
    };
    this.swords = [mkState(0), mkState(1)];

    // Particle pool for clash sparks.
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_PARTICLES * 3).fill(-100);
    const col = new Float32Array(MAX_PARTICLES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.particles = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.055,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(this.particles);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 1.15, 0.55, 0.18),
    );

    new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
    }).observe(container);
  }

  setConnected(i: PlayerIndex, on: boolean) {
    this.swords[i].connected = on;
  }

  /** Raw device-frame quaternion from a phone. */
  setSwordQuat(i: PlayerIndex, q: Quat) {
    const s = this.swords[i];
    this.tmpQ.set(q[0], q[1], q[2], q[3]);
    s.lastRawWorld.copy(DEVICE_TO_THREE).multiply(this.tmpQ);
    s.target.copy(YAW_BIAS[i]).multiply(s.calib).multiply(s.lastRawWorld);
    s.lastOrientAt = performance.now();
  }

  /** Player is holding the ARM pose (upright, facing the TV): zero out their yaw. */
  calibrate(i: PlayerIndex) {
    const s = this.swords[i];
    const n = this.tmpV.set(0, 0, 1).applyQuaternion(s.lastRawWorld);
    const yaw = Math.atan2(n.x, n.z);
    s.calib.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    s.target.copy(YAW_BIAS[i]).multiply(s.calib).multiply(s.lastRawWorld);
  }

  setDummyMode(on: boolean) {
    this.dummyMode = on;
    const blade = this.swords[1].group.children as THREE.Mesh[];
    for (const mesh of blade) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (m.emissive) m.emissive.setHex(on ? DUMMY_COLOR : P2_COLOR);
      if ((m as any).isMeshBasicMaterial && m.transparent) m.color.setHex(on ? DUMMY_COLOR : P2_COLOR);
    }
  }

  setDummyBlocking(on: boolean) {
    this.dummyBlocking = on;
  }

  clashFx(color: number, big = false) {
    this.spawnSparks(CLASH_POS, color, big ? 40 : 22);
    this.clashLight.color.setHex(color);
    this.clashLight.intensity = big ? 30 : 16;
    this.shake = Math.min(0.09, this.shake + (big ? 0.055 : 0.03));
  }

  hitFx(target: PlayerIndex, dmg: number) {
    const pos = GRIP_POS[target].clone().add(new THREE.Vector3(0, 0.35, 0));
    this.spawnSparks(pos, target === 0 ? P1_COLOR : this.dummyMode ? DUMMY_COLOR : P2_COLOR, 18 + dmg);
    this.shake = Math.min(0.12, this.shake + 0.02 + dmg * 0.003);
  }

  private spawnSparks(at: THREE.Vector3, color: number, count: number) {
    const c = new THREE.Color(color);
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.particles.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let n = 0; n < count; n++) {
      const i = this.pIndex = (this.pIndex + 1) % MAX_PARTICLES;
      pos.setXYZ(i, at.x, at.y, at.z);
      col.setXYZ(i, c.r, c.g, c.b);
      const theta = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.4;
      this.pVel[i * 3] = Math.cos(theta) * speed;
      this.pVel[i * 3 + 1] = Math.random() * 2.2;
      this.pVel[i * 3 + 2] = Math.sin(theta) * speed * 0.5;
      this.pLife[i] = 0.5 + Math.random() * 0.3;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  update() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const now = performance.now();
    const t = now / 1000;

    for (let i = 0 as PlayerIndex; i < 2; i = (i + 1) as PlayerIndex) {
      const s = this.swords[i];
      const stale = now - s.lastOrientAt > 1500;
      const isDummy = i === 1 && this.dummyMode;
      if (isDummy || !s.connected || stale) {
        // Procedural idle: gentle sway; dummy snaps flat when it blocks.
        const lean = i === 0 ? 0.22 : -0.22;
        const e = new THREE.Euler(
          Math.sin(t * 1.1 + i * 2) * 0.06,
          0,
          lean + Math.sin(t * 0.8 + i) * 0.05,
        );
        if (isDummy && this.dummyBlocking) e.set(0, 0, i === 1 ? 1.45 : -1.45);
        this.tmpQ.setFromEuler(e);
        s.group.quaternion.slerp(this.tmpQ, 1 - Math.exp(-dt * (isDummy ? 10 : 4)));
      } else {
        s.group.quaternion.slerp(s.target, 1 - Math.exp(-dt * 16));
      }
    }

    // Sparks
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      any = true;
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= 6 * dt;
      pos.setXYZ(
        i,
        pos.getX(i) + this.pVel[i * 3] * dt,
        pos.getY(i) + this.pVel[i * 3 + 1] * dt,
        pos.getZ(i) + this.pVel[i * 3 + 2] * dt,
      );
      if (this.pLife[i] <= 0) pos.setXYZ(i, -100, -100, -100);
    }
    if (any) pos.needsUpdate = true;

    this.clashLight.intensity = Math.max(0, this.clashLight.intensity - 90 * dt);
    this.shake = Math.max(0, this.shake - 0.25 * dt);
    this.camera.position.set(
      (Math.random() - 0.5) * this.shake,
      1.75 + (Math.random() - 0.5) * this.shake,
      4.7,
    );

    this.composer.render();
  }
}
