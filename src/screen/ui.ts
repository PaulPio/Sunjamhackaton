// HTML overlay on top of the 3D arena: lobby (code + QR + slots), health and
// stamina bars, round pips, center banners.

import QRCode from 'qrcode';
import { WINS_NEEDED } from './game';
import type { PlayerIndex } from '../shared/protocol';

export class Hud {
  private root: HTMLElement;
  private bannerTimer: number | undefined;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-side p1">
          <div class="hud-name" id="hudName0">P1</div>
          <div class="hud-bar hp"><div class="hud-bar-fill" id="hudHp0"></div></div>
          <div class="hud-bar stamina"><div class="hud-bar-fill" id="hudSt0"></div></div>
          <div class="hud-pips" id="hudPips0"></div>
        </div>
        <div class="hud-round" id="hudRound"></div>
        <div class="hud-side p2">
          <div class="hud-name" id="hudName1">P2</div>
          <div class="hud-bar hp"><div class="hud-bar-fill" id="hudHp1"></div></div>
          <div class="hud-bar stamina"><div class="hud-bar-fill" id="hudSt1"></div></div>
          <div class="hud-pips" id="hudPips1"></div>
        </div>
      </div>
      <div class="hud-banner" id="hudBanner"></div>
      <div class="hud-lobby" id="hudLobby">
        <h1 class="hud-title">DUEL LINK</h1>
        <p class="hud-tagline">Your phone is the sword.</p>
        <div class="hud-lobby-row">
          <div class="hud-qr-box">
            <canvas id="hudQr"></canvas>
            <p>Scan with your phone</p>
          </div>
          <div class="hud-code-box">
            <p>or open this page on your phone<br>and enter the code</p>
            <div class="hud-code" id="hudCode">----</div>
            <div class="hud-slots">
              <div class="hud-slot" id="hudSlot0">P1 · waiting…</div>
              <div class="hud-slot" id="hudSlot1">P2 · waiting…</div>
            </div>
            <p class="hud-net" id="hudNet"></p>
          </div>
        </div>
        <p class="hud-lobby-hint" id="hudLobbyHint"></p>
      </div>
      <div class="hud-bottom" id="hudBottom">M sound · F fullscreen</div>`;
    parent.appendChild(this.root);
    this.setPips(0, 0);
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.root.querySelector(`#${id}`) as T;
  }

  showLobby(code: string, joinUrl: string) {
    this.el('hudCode').textContent = code;
    this.el('hudLobby').classList.remove('hidden');
    QRCode.toCanvas(this.el<HTMLCanvasElement>('hudQr'), joinUrl, {
      width: 210,
      margin: 1,
      color: { dark: '#0b0617', light: '#d9f1ff' },
    }).catch(() => {
      this.el('hudQr').replaceWith(Object.assign(document.createElement('div'), { textContent: joinUrl }));
    });
  }

  hideLobby() {
    this.el('hudLobby').classList.add('hidden');
  }

  setNetStatus(text: string) {
    this.el('hudNet').textContent = text;
  }

  setLobbyHint(text: string) {
    this.el('hudLobbyHint').textContent = text;
  }

  setSlot(i: PlayerIndex, joined: boolean, label?: string) {
    const slot = this.el(`hudSlot${i}`);
    slot.textContent = label ?? (joined ? `P${i + 1} · ⚔️ armed` : `P${i + 1} · waiting…`);
    slot.classList.toggle('joined', joined);
  }

  setPlayerName(i: PlayerIndex, name: string) {
    this.el(`hudName${i}`).textContent = name;
  }

  setBars(hp0: number, st0: number, hp1: number, st1: number) {
    this.el(`hudHp0`).style.transform = `scaleX(${Math.max(0, hp0) / 100})`;
    this.el(`hudSt0`).style.transform = `scaleX(${Math.max(0, st0) / 100})`;
    this.el(`hudHp1`).style.transform = `scaleX(${Math.max(0, hp1) / 100})`;
    this.el(`hudSt1`).style.transform = `scaleX(${Math.max(0, st1) / 100})`;
  }

  setRound(n: number) {
    this.el('hudRound').textContent = `ROUND ${n}`;
  }

  setPips(w0: number, w1: number) {
    for (const [i, wins] of [w0, w1].entries()) {
      this.el(`hudPips${i}`).innerHTML = Array.from(
        { length: WINS_NEEDED },
        (_, k) => `<span class="pip ${k < wins ? 'won' : ''}"></span>`,
      ).join('');
    }
  }

  banner(text: string, opts: { sub?: string; ms?: number; cls?: string } = {}) {
    const b = this.el('hudBanner');
    clearTimeout(this.bannerTimer);
    b.innerHTML = `<div class="banner-main ${opts.cls ?? ''}">${text}</div>` +
      (opts.sub ? `<div class="banner-sub">${opts.sub}</div>` : '');
    b.classList.remove('hidden', 'pop');
    void b.offsetWidth; // restart animation
    b.classList.add('pop');
    if (opts.ms !== 0) {
      this.bannerTimer = window.setTimeout(() => b.classList.add('hidden'), opts.ms ?? 1400);
    }
  }

  hideBanner() {
    clearTimeout(this.bannerTimer);
    this.el('hudBanner').classList.add('hidden');
  }
}
