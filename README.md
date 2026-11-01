# Defender of the Crown — Two Lords

A two-player, low-poly 3D homage to Cinemaware's *Defender of the Crown* (Atari ST, 1987), made for personal use.
The TV shows the map of England and every battle; each player uses their phone as a controller.

## How to play

1. Open the game on a laptop connected to the TV and click to raise the banners.
2. Each player scans the QR code (or visits `/play` and types the room code) and picks a name.
3. Both press **Ready**.

Each season:

- **Muster** — spend gold on men-at-arms, knights, catapults, or a new castle. Income comes from land and castles.
- **Campaign** — secretly choose one army to march to a neighbouring land (or hold). Orders are revealed together.
- **Battle** — marching into enemy land starts a **swordfight**; enemy castles and keeps need a **catapult siege** first.
  If both lords march at each other (same target, or swapping lands) a **joust** decides who strikes first.

Win by capturing your rival's **keep** (a siege, then a duel against their lord in the throne room), by owning all of England,
or by holding the most land after 20 seasons.

### Phone controls

| Battle | Controls |
| --- | --- |
| Joust | Hold the lance button during the countdown, release just before impact (watch the bar on your phone) |
| Siege — attacker | Aim slider, power slider, FIRE. Breach any wall section to win |
| Siege — defender | Tap a wall section to repair it (every 5 s) |
| Swordfight | Guard high/low blocks slashes of that height. Slash high/low is quick. Thrust is slow, ignores guard, but is cancelled if you're hit while winding up |

TV keys: **M** toggles music, **N** starts a new campaign.

## Tech

- three.js (from jsDelivr) for all 3D, no build step.
- Cloudflare Worker serves `public/` and routes `/ws?room=CODE` to a **Durable Object** (`src/match.js`) — one per room.
  The Durable Object holds the authoritative game state; phones send intents; the TV runs each mini-game in real time and reports the result.
- `public/js/shared/map.js` is shared by the server and the TV (map, adjacency, rules constants).

```
src/worker.js        routing + room codes
src/match.js         Durable Object: rules, seasons, battle queue
public/index.html    TV view          public/js/tv.js
public/play.html     phone controller public/js/phone.js
public/js/scenes/    map, joust, siege, duel (incl. throne-room finale)
test/sim.js          plays whole matches with fake clients over websockets
test/browser.py      headless TV + 2 phones smoke test
test/scenes.py       renders each battle scene with scripted inputs
```

## Run locally

```
npm install
npx wrangler dev          # http://localhost:8787
npm test                  # in another terminal: simulated full match
```

Phones on the same Wi-Fi can't reach `localhost`; for real phone testing deploy to Cloudflare (below).

## Deploy (Cloudflare Workers)

Connect this repo in the Cloudflare dashboard (Workers & Pages → Create → Import a repository), keep the default
build settings (`npx wrangler deploy`), and it will auto-deploy on every push to `main`. The Durable Object
uses the SQLite backend, which works on the free plan.
