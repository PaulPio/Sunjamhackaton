# DUEL LINK

**Your phone is the sword.** A 2-player motion-controlled sword duel: one desktop browser is the cyber arena, and each player's phone becomes their energy blade.

Remake for the Sunjam hackathon — Next.js + Canvas 2D + PeerJS (WebRTC), hosted on **Vercel** (no custom Socket.io server).

## How to play

1. Open the site on a **desktop** browser (the arena).
2. Each player scans the **QR** (or opens `/controller` and types the 4-letter code).
3. Tap **TAP TO ARM** while holding the phone upright like a sword hilt, screen facing the big screen.
4. Fight:
   - **Swing hard** = attack (costs stamina; harder swings do more damage).
   - **Hold the phone flat** = block (drains stamina while held; absorbing a hit costs extra stamina; guard drops at 0).
   - Raise a block at the last instant for a **parry** (stuns the attacker).
   - **100 HP**, best-of-3 rounds (first to 2 round wins).
5. One phone? Swing in the lobby to fight a **training dummy** — a second phone can still join.

**Desktop:** `F` fullscreen · `R` rematch after a match.

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) on the desktop.

Phone sensors need HTTPS (or localhost). For LAN phones, deploy to Vercel or use a tunnel. Without phones, use sim controllers:

```
/# open arena, note the code (or ?code=DEVX)
/controller?room=DEVX&sim=1&local=1   # open twice for two players
```

Sim keys: `Space` swing · hold `B` block · `C` calibrate · arrows aim.

## Deploy on Vercel

1. Push this repo and import it in [Vercel](https://vercel.com).
2. Framework preset: **Next.js**. Build: `next build`, Output: default.
3. Optional env: `NEXT_PUBLIC_APP_URL=https://your-app.vercel.app` (QR uses `window.location.origin` when opened on the live site, so this is usually unnecessary).
4. After deploy, open the Vercel URL on the big screen and scan the QR from phones.

PeerJS public cloud handles signaling; fight traffic is phone↔desktop WebRTC (TURN fallback included for cellular/NAT).

## itch.io (optional)

itch.io HTML5 zip cannot run this stack. Create a project that **embeds or links** your Vercel URL (Kind: HTML / external web), enable mobile-friendly so phones can open controller links.

## Stack

| Piece | Tech |
|-------|------|
| Desktop + controller pages | Next.js 14 (Pages Router), Tailwind |
| Arena | HTML5 Canvas 2D (characters + neon swords) |
| Networking | PeerJS + BroadcastChannel (same-tab sim) |
| Hosting | Vercel |
