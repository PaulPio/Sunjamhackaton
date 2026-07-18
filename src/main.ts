// Entry: one build serves both roles.
//   ?role=screen [&code=ABCD]      desktop arena
//   #room=ABCD (or ?role=controller [&sim=1] [&local=1])   phone controller
//   otherwise                      landing page with a role choice

import './style.css';
import { normalizeRoomCode, CODE_LENGTH } from './shared/protocol';

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const room = hashParams.get('room') ?? params.get('room');
const sim = params.get('sim') === '1';
const local = params.get('local') === '1';
const role = params.get('role') ?? (room ? 'controller' : null);

async function toScreen() {
  const { startScreen } = await import('./screen/index');
  const forced = params.get('code');
  startScreen(app, forced ? normalizeRoomCode(forced).slice(0, CODE_LENGTH) : undefined);
}

async function toController() {
  const { startController } = await import('./controller/index');
  startController(app, room, { sim, local });
}

function landing() {
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  app.innerHTML = `
    <div class="landing">
      <h1 class="hud-title">DUEL LINK</h1>
      <p class="hud-tagline">A 2-player sword duel. Your phones are the swords,<br>one big screen is the arena.</p>
      <div class="landing-buttons">
        <button id="btnScreen" class="landing-btn ${isMobile ? '' : 'suggested'}">
          🖥️ PLAY ON THIS SCREEN<small>open the arena (desktop)</small>
        </button>
        <button id="btnController" class="landing-btn ${isMobile ? 'suggested' : ''}">
          📱 USE PHONE AS SWORD<small>join with the arena's code</small>
        </button>
      </div>
      <p class="landing-foot">2 players · scan the arena's QR with your phones · swing to fight, hold flat to block</p>
    </div>`;
  document.getElementById('btnScreen')!.addEventListener('click', toScreen);
  document.getElementById('btnController')!.addEventListener('click', toController);
}

if (role === 'screen') toScreen();
else if (role === 'controller') toController();
else landing();
