// Desktop arena entry: hosts the room (PeerJS for phones + BroadcastChannel
// for same-browser sim controllers), owns the Game, and fans events out to
// the 3D scene, the HUD, the speakers, and back to the phones.

import {
  joinUrlForRoom,
  randomRoomCode,
  type ControllerMsg,
  type PlayerIndex,
  type ScreenMsg,
} from '../shared/protocol';
import { startLocalHost, startPeerHost, type Link } from '../shared/link';
import { Game, type GameEvent } from './game';
import { ArenaScene, P1_COLOR, P2_COLOR, DUMMY_COLOR } from './scene';
import { Hud } from './ui';
import { ScreenAudio } from './audio';

declare global {
  interface Window {
    __game?: Game;
    __screenReady?: boolean;
  }
}

const HUD_SEND_INTERVAL_MS = 100;

export function startScreen(root: HTMLElement, forcedCode?: string) {
  root.innerHTML = `<div class="arena" id="arena"></div>`;
  const arenaEl = document.getElementById('arena')!;

  const code = forcedCode ?? randomRoomCode();
  const scene = new ArenaScene(arenaEl);
  const hud = new Hud(arenaEl);
  const audio = new ScreenAudio();
  const game = new Game();
  const links: [Link | null, Link | null] = [null, null];
  let lastHudSend = 0;

  window.__game = game;

  hud.showLobby(code, joinUrlForRoom(code));
  hud.setRound(1);
  hud.setLobbyHint('One phone joined? Swing to train against a dummy. Two phones auto-start the duel.');

  // ------------------------------------------------------------------ audio
  // Browsers only allow sound after a gesture on THIS page; arm on first one.
  const unlockAudio = () => audio.ensure();
  window.addEventListener('pointerdown', unlockAudio, { once: false });
  window.addEventListener('keydown', unlockAudio, { once: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && audio.sfx) {
      const on = audio.toggleMusic();
      hud.banner(on ? '♪ MUSIC ON' : 'MUSIC OFF', { ms: 900 });
    } else if (e.code === 'KeyF') {
      document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.();
    } else if (e.code === 'KeyR' && game.phase === 'matchEnd') {
      game.startMatch(game.solo, performance.now());
    }
  });

  // ---------------------------------------------------------------- hosting

  function sendTo(i: PlayerIndex, msg: ScreenMsg) {
    links[i]?.send(msg);
  }

  function presentCount(): number {
    return links.filter(Boolean).length;
  }

  function onControllerLink(link: Link) {
    const slot = links.findIndex((l) => l === null) as PlayerIndex | -1;
    if (slot === -1) {
      link.send({ t: 'full' } satisfies ScreenMsg);
      setTimeout(() => link.close(), 200);
      return;
    }
    links[slot] = link;
    link.send({ t: 'assign', player: slot } satisfies ScreenMsg);
    scene.setConnected(slot, true);
    hud.setSlot(slot, true);
    link.onMessage((msg: ControllerMsg) => onControllerMsg(slot, msg));
    link.onClose(() => onControllerLost(slot));

    const now = performance.now();
    if (presentCount() === 2) {
      scene.setDummyMode(false);
      hud.setPlayerName(1, 'P2');
      hud.hideLobby();
      if (game.phase === 'paused') {
        hud.banner('BACK IN THE FIGHT', { ms: 1200 });
        game.resumeRound(now + 600); // round restarts, match score survives
      } else if (game.phase === 'lobby') {
        hud.banner('DUEL STARTING', { ms: 1200 });
        game.startMatch(false, now + 600);
      } else {
        // P2 walked in mid-training: restart as a real duel.
        hud.banner('A CHALLENGER APPEARS!', { ms: 1800 });
        game.startMatch(false, now + 900);
      }
    }
  }

  function onControllerLost(slot: PlayerIndex) {
    links[slot] = null;
    scene.setConnected(slot, false);
    hud.setSlot(slot, false);
    if (presentCount() === 0) {
      game.toLobby();
      scene.setDummyMode(false);
      hud.setPlayerName(1, 'P2');
      hud.setPips(0, 0);
      hud.hideBanner();
      hud.showLobby(code, joinUrlForRoom(code));
    } else if (!game.solo && game.phase !== 'lobby' && game.phase !== 'matchEnd') {
      game.pause();
      hud.banner(`P${slot + 1} DISCONNECTED`, { sub: `rejoin with code ${code}`, ms: 0 });
    }
  }

  function onControllerMsg(i: PlayerIndex, msg: ControllerMsg) {
    const now = performance.now();
    switch (msg.t) {
      case 'orient':
        scene.setSwordQuat(i, msg.q);
        break;
      case 'calibrate':
        scene.calibrate(i);
        break;
      case 'block':
        game.setBlock(i, msg.on, now);
        break;
      case 'swing':
        if (game.phase === 'lobby' && presentCount() === 1 && i === 0) {
          // Solo player swings in the lobby -> training mode vs the dummy.
          hud.hideLobby();
          hud.banner('TRAINING MODE', { sub: 'a challenger can still join!', ms: 1600 });
          scene.setDummyMode(true);
          hud.setPlayerName(1, 'DUMMY');
          game.startMatch(true, now + 400);
        } else {
          game.swing(i, msg.dir, msg.intensity, now);
        }
        break;
      case 'join':
        break; // slot was already assigned on connect
    }
  }

  startLocalHost(code, onControllerLink);
  startPeerHost(code, onControllerLink, (s) => {
    hud.setNetStatus(
      s.kind === 'online'
        ? '✓ online — phones can join from anywhere'
        : s.kind === 'connecting'
          ? 'connecting to pairing service…'
          : `⚠ pairing service unreachable (${s.reason}) — same-device tabs still work`,
    );
  });

  // ------------------------------------------------------------ game events

  game.onEvent((ev: GameEvent) => {
    const dummyColor = game.solo ? DUMMY_COLOR : P2_COLOR;
    switch (ev.e) {
      case 'phase':
        if (ev.phase === 'fight') hud.banner('FIGHT!', { cls: 'big', ms: 900 });
        break;
      case 'countdown':
        if (ev.n > 0) {
          hud.banner(String(ev.n), { cls: 'big', ms: 700 });
          hud.setRound(game.round);
          hud.setPips(game.roundWins[0], game.roundWins[1]);
          audio.sfx?.countBeep(false);
        } else {
          audio.sfx?.countBeep(true);
        }
        break;
      case 'swing':
        audio.sfx?.whoosh(ev.intensity);
        break;
      case 'hit': {
        const target = (1 - ev.attacker) as PlayerIndex;
        scene.hitFx(target, ev.dmg);
        audio.sfx?.hit();
        sendTo(ev.attacker, { t: 'fx', kind: 'landedHit' });
        sendTo(target, { t: 'fx', kind: 'tookHit' });
        break;
      }
      case 'blocked': {
        scene.clashFx(ev.attacker === 0 ? P2_COLOR : P1_COLOR, false);
        audio.sfx?.clash();
        sendTo(ev.attacker, { t: 'fx', kind: 'wasBlocked' });
        sendTo((1 - ev.attacker) as PlayerIndex, { t: 'fx', kind: 'didBlock' });
        break;
      }
      case 'parried': {
        scene.clashFx(0xffd75a, true);
        audio.sfx?.parry();
        hud.banner('PARRY!', { ms: 800 });
        sendTo(ev.attacker, { t: 'fx', kind: 'gotParried' });
        sendTo((1 - ev.attacker) as PlayerIndex, { t: 'fx', kind: 'didParry' });
        break;
      }
      case 'roundEnd': {
        const name = ev.winner === 0 ? 'P1' : game.solo ? 'DUMMY' : 'P2';
        hud.banner(`${name} TAKES ROUND ${game.round}`, { ms: 2200 });
        hud.setPips(game.roundWins[0], game.roundWins[1]);
        scene.clashFx(ev.winner === 0 ? P1_COLOR : dummyColor, true);
        break;
      }
      case 'matchEnd': {
        const name = ev.winner === 0 ? 'PLAYER 1' : game.solo ? 'THE DUMMY' : 'PLAYER 2';
        hud.banner(`${name} WINS THE MATCH`, { sub: 'swing to rematch · R to restart', ms: 0, cls: 'big' });
        break;
      }
    }
  });

  // -------------------------------------------------------------- main loop

  function frame() {
    const now = performance.now();
    game.update(now);
    scene.setDummyBlocking(game.solo && game.fighters[1].blocking);
    hud.setBars(
      game.fighters[0].hp,
      game.fighters[0].stamina,
      game.fighters[1].hp,
      game.fighters[1].stamina,
    );
    if (now - lastHudSend > HUD_SEND_INTERVAL_MS) {
      lastHudSend = now;
      for (const i of [0, 1] as const) {
        sendTo(i, { t: 'hud', hp: game.fighters[i].hp, stamina: game.fighters[i].stamina, phase: game.phase });
      }
    }
    scene.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__screenReady = true;
}
