// End-to-end test: serves the built dist/, opens the arena + two simulated
// controllers (BroadcastChannel transport) in one headless browser, and plays
// a full best-of-3 — asserting pairing, blocking, parry, damage, rounds,
// match end, rematch, and the solo training-dummy path.
//
// Run: npm run build && npm run test:e2e

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = new URL('../dist', import.meta.url).pathname;
const PORT = 4599;
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

let failures = 0;
const ok = (cond, name) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const st = statSync(c);
      if (st.isFile()) return c;
      if (st.isDirectory()) {
        const inner = join(c, 'chrome-linux', 'chrome');
        if (existsSync(inner)) return inner;
      }
    } catch { /* try next */ }
  }
  return undefined; // let playwright-core resolve via PLAYWRIGHT_BROWSERS_PATH
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].split('#')[0];
  const file = join(DIST, path === '/' ? 'index.html' : path);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const base = `http://localhost:${PORT}/`;
const wireLogs = (page, tag) =>
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [${tag} console.error] ${m.text()}`);
  });

async function openController(room, tag) {
  const page = await ctx.newPage();
  wireLogs(page, tag);
  await page.goto(`${base}?role=controller&sim=1&local=1&room=${room}`);
  await page.waitForSelector('#armBtn', { timeout: 8000 });
  await page.click('#armBtn');
  await page.waitForFunction(() => !!window.__ctl, { timeout: 5000 });
  return page;
}

const gamePhase = (screen) => screen.evaluate(() => window.__game.phase);
const fighter = (screen, i) =>
  screen.evaluate((idx) => {
    const f = window.__game.fighters[idx];
    return { hp: f.hp, stamina: f.stamina, blocking: f.blocking, stunnedUntil: f.stunnedUntil };
  }, i);
const waitPhase = (screen, phase, timeout = 15000) =>
  screen.waitForFunction((p) => window.__game.phase === p, phase, { timeout });

try {
  // ---------------------------------------------------------- 2-player duel
  console.log('▶ two-player duel');
  const screen = await ctx.newPage();
  wireLogs(screen, 'screen');
  await screen.goto(`${base}?role=screen&code=TEST`);
  await screen.waitForFunction(() => window.__screenReady === true, { timeout: 8000 });
  ok(true, 'arena boots');
  ok((await screen.textContent('#hudCode')).trim() === 'TEST', 'room code shown in lobby');

  const p1 = await openController('TEST', 'p1');
  ok(true, 'P1 sim controller pairs over BroadcastChannel and arms');
  const p2 = await openController('TEST', 'p2');
  ok(true, 'P2 pairs — duel should auto-start');

  await waitPhase(screen, 'fight');
  ok(true, 'countdown finished, phase = fight');

  // Block: P2 raises guard well in advance (past the parry window), P1 swings.
  await p2.evaluate(() => window.__ctl.block(true));
  await sleep(400);
  await p1.evaluate(() => window.__ctl.swing(0.9));
  await sleep(300);
  let f2 = await fighter(screen, 1);
  ok(f2.hp === 100, `late block negates damage (P2 hp ${f2.hp})`);

  // Parry: guard raised immediately before the swing lands -> attacker stunned.
  await p2.evaluate(() => window.__ctl.block(false));
  await sleep(700); // let P1's swing cooldown expire
  await p2.evaluate(() => window.__ctl.block(true));
  await p1.evaluate(() => window.__ctl.swing(0.9));
  await sleep(200);
  const f1 = await fighter(screen, 0);
  ok(f1.stunnedUntil > 0 && (await screen.evaluate(() => performance.now())) < f1.stunnedUntil,
    'perfect block parries: attacker is stunned');
  await p2.evaluate(() => window.__ctl.block(false));
  await sleep(1000); // stun wears off

  // Damage: P1 lands a clean hit.
  await p1.evaluate(() => window.__ctl.swing(1));
  await sleep(300);
  f2 = await fighter(screen, 1);
  ok(f2.hp < 100, `clean swing deals damage (P2 hp ${f2.hp})`);
  const hudScale = await p2.evaluate(() => document.getElementById('ctlHp').style.transform);
  ok(hudScale.includes('scaleX') && !hudScale.includes('scaleX(1)'),
    `phone HUD mirrors its hp (${hudScale})`);

  // Grind out round 1 (stamina forces a sane pace; weak hits still land).
  for (let i = 0; i < 40 && (await fighter(screen, 1)).hp > 0; i++) {
    await p1.evaluate(() => window.__ctl.swing(1));
    await sleep(620);
  }
  await waitPhase(screen, 'roundEnd', 5000);
  let wins = await screen.evaluate(() => window.__game.roundWins);
  ok(wins[0] === 1 && wins[1] === 0, `P1 takes round 1 (wins ${wins})`);

  // Round 2 spins up automatically; win it to take the match.
  await waitPhase(screen, 'fight');
  const f2r2 = await fighter(screen, 1);
  ok(f2r2.hp === 100, 'round 2 resets hp');
  for (let i = 0; i < 40 && (await fighter(screen, 1)).hp > 0; i++) {
    await p1.evaluate(() => window.__ctl.swing(1));
    await sleep(620);
  }
  await waitPhase(screen, 'matchEnd', 8000);
  wins = await screen.evaluate(() => window.__game.roundWins);
  ok(wins[0] === 2, `P1 wins the match 2-0 (wins ${wins})`);
  const banner = await screen.textContent('#hudBanner');
  ok(banner.includes('PLAYER 1 WINS'), `winner banner shown ("${banner.trim().slice(0, 40)}…")`);

  // Rematch by swinging.
  await sleep(1400);
  await p2.evaluate(() => window.__ctl.swing(0.8));
  await waitPhase(screen, 'countdown', 4000);
  wins = await screen.evaluate(() => window.__game.roundWins);
  ok(wins[0] === 0 && wins[1] === 0, 'swing after match end starts a rematch with fresh score');

  await p1.close();
  await p2.close();
  await screen.close();

  // ------------------------------------------------------ solo training mode
  console.log('▶ solo training dummy');
  const screen2 = await ctx.newPage();
  wireLogs(screen2, 'screen2');
  await screen2.goto(`${base}?role=screen&code=TRNG`);
  await screen2.waitForFunction(() => window.__screenReady === true, { timeout: 8000 });
  const solo = await openController('TRNG', 'solo');
  await sleep(300);
  ok((await gamePhase(screen2)) === 'lobby', 'one controller alone stays in lobby');
  await solo.evaluate(() => window.__ctl.swing(0.8)); // swing in lobby = start training
  await waitPhase(screen2, 'fight');
  ok(await screen2.evaluate(() => window.__game.solo), 'training mode vs dummy started');
  for (let i = 0; i < 8; i++) {
    await solo.evaluate(() => window.__ctl.swing(1));
    await sleep(620);
  }
  const dummy = await fighter(screen2, 1);
  ok(dummy.hp < 100, `dummy takes damage (hp ${dummy.hp})`);
  await solo.close();
  await screen2.close();
} catch (err) {
  failures++;
  console.error('✗ UNEXPECTED ERROR:', err);
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
