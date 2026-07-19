// Phone controller entry: pair with the screen, arm the sword (one tap that
// grants iOS motion permission AND unlocks audio), then stream inputs and
// react to feedback (flashes, vibration, sounds).

import {
  normalizeRoomCode,
  CODE_LENGTH,
  type ControllerMsg,
  type ScreenMsg,
  type GamePhase,
} from '../shared/protocol';
import { connectLocalController, connectPeerController, type Link } from '../shared/link';
import { createSfx, type Sfx } from '../shared/sfx';
import { requestMotionPermission, startSensors, type SensorHandle } from './sensors';
import { startSimSensors } from './sim';

export interface ControllerOptions {
  sim: boolean;
  local: boolean; // force same-browser BroadcastChannel transport
}

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

export function startController(root: HTMLElement, roomFromUrl: string | null, opts: ControllerOptions) {
  root.innerHTML = `
    <div class="ctl">
      <div class="ctl-flash" id="ctlFlash"></div>
      <header class="ctl-header">
        <span id="ctlPlayer" class="ctl-player">SWORD</span>
        <span id="ctlRoomLabel" class="ctl-room"></span>
        ${opts.sim ? '<span class="ctl-sim-badge">SIM</span>' : ''}
      </header>
      <p id="ctlBraveNotice" class="ctl-warn hidden">
        ⚠️ Brave's Shields block phone↔screen connections. Tap the Shields (lion) icon in the
        address bar and turn Shields off for this site, or open this link in Chrome/Safari instead.
      </p>
      <main id="ctlStage" class="ctl-stage"></main>
    </div>`;
  const stage = document.getElementById('ctlStage')!;
  const flashEl = document.getElementById('ctlFlash')!;
  const playerEl = document.getElementById('ctlPlayer')!;
  const roomEl = document.getElementById('ctlRoomLabel')!;

  // Brave's Shields restrict WebRTC by default (blocks non-proxied UDP ICE
  // candidates to prevent IP-address fingerprinting), which silently breaks
  // the phone<->screen connection with no error the site can detect after
  // the fact. navigator.brave is the only reliable way to catch this before
  // the player wastes time on a doomed connection attempt.
  (navigator as any).brave?.isBrave?.()
    .then((isBrave: boolean) => {
      if (isBrave) document.getElementById('ctlBraveNotice')?.classList.remove('hidden');
    })
    .catch(() => {});

  let link: Link | null = null;
  let sensors: SensorHandle | null = null;
  let sfx: Sfx | null = null;
  let hum: { osc: OscillatorNode; gain: GainNode } | null = null;
  let player = -1;
  let room = roomFromUrl ? normalizeRoomCode(roomFromUrl) : '';

  // ---------------------------------------------------------------- pairing

  function showCodeEntry(error = '') {
    stage.innerHTML = `
      <h2>JOIN A DUEL</h2>
      <p class="ctl-hint">Enter the ${CODE_LENGTH}-letter code shown on the big screen</p>
      <input id="codeInput" class="ctl-code-input" maxlength="${CODE_LENGTH}"
             autocomplete="off" autocapitalize="characters" placeholder="ABCD" />
      <button id="joinBtn" class="ctl-big-btn">JOIN</button>
      <p class="ctl-error">${error}</p>`;
    const input = document.getElementById('codeInput') as HTMLInputElement;
    input.focus();
    const join = () => {
      const code = normalizeRoomCode(input.value);
      if (code.length === CODE_LENGTH) connect(code);
    };
    document.getElementById('joinBtn')!.addEventListener('click', join);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && join());
  }

  function showMessage(html: string, retry = false) {
    stage.innerHTML = `<div class="ctl-message">${html}</div>` +
      (retry ? '<button id="retryBtn" class="ctl-big-btn">TRY AGAIN</button>' : '');
    if (retry) document.getElementById('retryBtn')!.addEventListener('click', () => {
      room ? connect(room) : showCodeEntry();
    });
  }

  async function connect(code: string) {
    room = code;
    roomEl.textContent = code;
    showMessage('Connecting…');
    try {
      // Sim/local controllers live in the same browser as the screen ->
      // BroadcastChannel. Real phones go through PeerJS (WebRTC).
      link = opts.local || opts.sim
        ? await connectLocalController(code)
        : await connectPeerController(code);
    } catch (err) {
      showMessage(
        `Couldn't reach the screen for code <b>${code}</b>.<br>` +
          `<small>${err instanceof Error ? err.message : err}</small><br>` +
          `<small>Make sure the arena is open on the desktop and you're online.</small><br>` +
          `<small>Using Brave, Firefox strict privacy mode, or an ad-blocker? Try disabling ` +
          `shields/privacy protection for this site, or switch browsers.</small>`,
        true,
      );
      return;
    }
    link.onMessage(onScreenMsg);
    link.onClose(() => {
      stopFighting();
      showMessage('Disconnected from the screen.', true);
    });
    send({ t: 'join' });
    showMessage('Waiting for a sword slot…');
  }

  function send(msg: ControllerMsg) {
    link?.send(msg);
  }

  // ------------------------------------------------------------------- arm

  function showArm() {
    stage.innerHTML = `
      <h2 style="color:${PLAYER_COLORS[player]}">YOU ARE ${PLAYER_NAMES[player]}</h2>
      <ol class="ctl-instructions">
        <li>Grip your phone like a sword handle</li>
        <li>Hold it upright, screen facing the big screen</li>
        <li>Tap ARM to calibrate</li>
      </ol>
      <button id="armBtn" class="ctl-big-btn ctl-arm-btn" style="border-color:${PLAYER_COLORS[player]}">⚔️ TAP TO ARM</button>
      <p class="ctl-error" id="armError"></p>`;
    document.getElementById('armBtn')!.addEventListener('click', arm);
  }

  async function arm() {
    // One tap does everything the mobile platform gates behind a gesture.
    if (!sfx) {
      try {
        const ctx = new AudioContext();
        await ctx.resume();
        sfx = createSfx(ctx, 0.5);
        startHum();
      } catch { /* audio is a nice-to-have */ }
    }
    if (!opts.sim) {
      const granted = await requestMotionPermission();
      if (!granted) {
        document.getElementById('armError')!.textContent =
          'Motion access denied — allow motion & orientation for this site and retry.';
        return;
      }
    }
    startFighting();
  }

  function startHum() {
    if (!sfx || hum) return;
    const { ctx, master } = sfx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const gain = ctx.createGain();
    gain.gain.value = 0.03;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(gain.gain);
    osc.connect(gain).connect(master);
    osc.start();
    lfo.start();
    hum = { osc, gain };
  }

  // ----------------------------------------------------------------- fight

  function startFighting() {
    stage.innerHTML = `
      <div class="ctl-status" id="ctlStatus">${PHASE_TEXT.lobby}</div>
      <div class="ctl-bars">
        <div class="ctl-bar hp"><div id="ctlHp" class="ctl-bar-fill" style="background:${PLAYER_COLORS[player]}"></div></div>
        <div class="ctl-bar stamina"><div id="ctlStamina" class="ctl-bar-fill"></div></div>
      </div>
      <div class="ctl-block-indicator" id="ctlBlock">🛡 BLOCKING</div>
      <div class="ctl-hints">
        <p>💨 <b>Swing hard</b> to attack</p>
        <p>🛡 <b>Hold blade flat</b> (phone horizontal) to block</p>
        ${opts.sim ? '<p class="ctl-sim-help">SIM: Space=swing · hold B=block · C=calibrate · arrows=aim</p>' : ''}
      </div>
      <button id="calibrateBtn" class="ctl-small-btn">↻ RECALIBRATE (point at screen)</button>`;
    document.getElementById('calibrateBtn')!.addEventListener('click', calibrate);

    const events = {
      onOrient: (q: [number, number, number, number]) => send({ t: 'orient', q }),
      onSwing: (dir: 'horizontal' | 'vertical' | 'thrust', intensity: number) => {
        send({ t: 'swing', dir, intensity });
        sfx?.whoosh(intensity);
      },
      onBlock: (on: boolean) => {
        send({ t: 'block', on });
        document.getElementById('ctlBlock')?.classList.toggle('active', on);
        if (on && navigator.vibrate) navigator.vibrate(15);
      },
    };
    sensors = opts.sim ? startSimSensors(events, calibrate) : startSensors(events);
    // The ARM pose (upright, facing the screen) doubles as the calibration pose.
    setTimeout(calibrate, 400);
    if (!opts.sim) {
      setTimeout(() => {
        if (sensors && !sensors.sawOrientation()) {
          document.getElementById('ctlStatus')!.textContent =
            '⚠️ No motion sensors found — is this a phone? (Use ?sim=1 on desktop)';
        }
      }, 3000);
    }
  }

  function calibrate() {
    send({ t: 'calibrate' });
    flash('white');
    if (navigator.vibrate) navigator.vibrate(20);
  }

  function stopFighting() {
    sensors?.stop();
    sensors = null;
  }

  // -------------------------------------------------------------- feedback

  function flash(kind: 'red' | 'white' | 'gold') {
    flashEl.className = 'ctl-flash';
    void (flashEl as HTMLElement).offsetWidth; // restart the CSS animation
    flashEl.classList.add(`flash-${kind}`);
  }

  function onScreenMsg(msg: ScreenMsg) {
    switch (msg.t) {
      case 'assign':
        player = msg.player;
        playerEl.textContent = PLAYER_NAMES[player];
        playerEl.style.color = PLAYER_COLORS[player];
        document.body.style.setProperty('--player-color', PLAYER_COLORS[player]);
        showArm();
        break;
      case 'full':
        showMessage('This duel already has two swords.<br><small>Wait for the next match!</small>');
        break;
      case 'fx':
        switch (msg.kind) {
          case 'tookHit':
            flash('red');
            navigator.vibrate?.([60, 40, 90]);
            sfx?.hit();
            break;
          case 'landedHit':
            navigator.vibrate?.(40);
            sfx?.clash();
            break;
          case 'didBlock':
            flash('white');
            navigator.vibrate?.(30);
            sfx?.clash();
            break;
          case 'wasBlocked':
            navigator.vibrate?.(25);
            sfx?.clash();
            break;
          case 'didParry':
            flash('gold');
            navigator.vibrate?.([30, 30, 60]);
            sfx?.parry();
            break;
          case 'gotParried':
            flash('red');
            navigator.vibrate?.([30, 30, 30, 30, 120]);
            sfx?.parry();
            break;
        }
        break;
      case 'hud': {
        const hp = document.getElementById('ctlHp');
        const st = document.getElementById('ctlStamina');
        const status = document.getElementById('ctlStatus');
        if (hp) hp.style.transform = `scaleX(${Math.max(0, msg.hp) / 100})`;
        if (st) st.style.transform = `scaleX(${Math.max(0, msg.stamina) / 100})`;
        if (status) status.textContent = PHASE_TEXT[msg.phase];
        break;
      }
    }
  }

  // ------------------------------------------------------------------ boot

  if (room.length === CODE_LENGTH) connect(room);
  else showCodeEntry();
}
