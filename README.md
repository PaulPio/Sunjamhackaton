# ⚔️ DUEL LINK

**Your phone is the sword.** A 2-player motion-controlled sword duel: one desktop
browser is the neon arena, and each player's phone becomes their energy blade.
Swing your phone to attack, hold it flat to block, first to 2 rounds wins.

Built for the Sunjam 12-hour hackathon. Ships to itch.io as a static HTML5 game —
no backend at all: phones connect straight to the desktop browser over WebRTC
(PeerJS public cloud for signaling only).

## How to play

1. Open the game on a **desktop/TV browser** → *PLAY ON THIS SCREEN*.
2. Each player **scans the QR** with their phone (or opens the same page and
   types the 4-letter code).
3. Tap **⚔️ TAP TO ARM** while holding the phone upright like a sword hilt,
   screen facing the big screen (this calibrates you and grants iOS motion access).
4. Fight:
   - 💨 **Swing hard** = attack. Harder swings do more damage (8–17).
   - 🛡 **Hold the phone flat** (blade horizontal) = block. A block raised at the
     last instant is a **parry** that stuns the attacker.
   - ⚡ Swings cost **stamina** (thin yellow bar). Flailing wildly leaves you
     swinging feebly — pace your strikes.
   - ❤️ 100 HP, best-of-3 rounds. After the match, swing to rematch.
5. Only one phone? Swing in the lobby to fight a **training dummy** — a second
   phone can jump in anytime ("A CHALLENGER APPEARS!").

**Desktop keys:** `M` music on/off · `F` fullscreen · `R` rematch.

## Develop

```bash
npm install
npm run dev        # HTTPS dev server on your LAN (needed for phone sensors)
```

Open `https://<your-lan-ip>:5173/?role=screen` on the desktop and the QR/code
flow from your phone (accept the self-signed cert warning once per phone).

No phones handy? Simulated controllers in extra tabs of the same browser:

```
/?role=screen&code=DEVX
/?role=controller&sim=1&local=1&room=DEVX     (open twice for 2 players)
```

Sim keys: `Space` swing · hold `B` block · `C` calibrate · arrows aim.

## Test

```bash
npm run build && npm run test:e2e
```

Headless Playwright plays a full best-of-3 (pairing, block, parry, damage,
rounds, rematch) plus the solo dummy path, and asserts the game state.

## Ship to itch.io

```bash
npm run zip        # builds and produces duel-link-itch.zip
```

1. itch.io → *Upload new project* → Kind of project: **HTML**.
2. Upload `duel-link-itch.zip`, check **"This file will be played in the browser"**.
3. Embed options: 1280×720 (or *Click to launch in fullscreen*), and enable
   **Mobile friendly** — phones must be able to open the page as controllers.
4. Test from the live itch page with a real phone: scan the QR from the desktop
   arena — the QR encodes the game's own embedded URL, so controllers land in
   the right place even inside itch's iframe.

## Notes & troubleshooting

- **No server:** rooms pair through the free public PeerJS cloud
  (`0.peerjs.com`) and then all traffic is direct phone↔desktop WebRTC. If that
  cloud is unreachable, the lobby says so — same-browser tab controllers
  (`&local=1&sim=1`) still work for a demo.
- **iOS:** motion sensors require the one-tap permission prompt (that's what
  ARM is for) and HTTPS — itch.io and the dev server are both HTTPS.
- **Sword drifts sideways?** Point the phone at the screen and tap
  **RECALIBRATE** (compass yaw drifts; pitch/roll never do).
- **Sensors dead inside itch's iframe on some Android browsers?** Open the
  itch "app" URL directly via the QR — the QR already points there.

## Architecture (for the curious)

```
src/shared/protocol.ts   typed controller<->screen messages + room codes
src/shared/link.ts       transports: PeerJS (real phones) + BroadcastChannel (sim/tests)
src/shared/sfx.ts        synthesized whoosh/clash/hit/parry (no audio assets)
src/controller/          pairing, sensors (quat + on-phone swing/block detection), phone UI
src/screen/              authoritative Game state machine, Three.js neon arena with
                         bloom, HUD/lobby/QR, procedural synthwave soundtrack
```

Swing/block detection runs **on the phone**, so combat inputs are single tiny
events (no streaming latency); orientation streams at ~30 Hz purely to drive
the 3D blades. The desktop resolves all rules.
