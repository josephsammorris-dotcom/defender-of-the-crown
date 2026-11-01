# Defender of the Crown

A low-poly 3D homage to Cinemaware's *Defender of the Crown* (Atari ST, 1987), made for personal use.
Play alone against a computer lord or against a friend, either on one device or with phones as controllers.

## Ways to play

| | On this device | With phones |
| --- | --- | --- |
| **1 player** | You vs Baron Reginald (computer) with keyboard, mouse or touch | The screen is the board; your phone is the controller |
| **2 players** | Share one screen. Orders are given in turn behind a "pass the device" screen; battles are played side by side | The TV shows the board and battles; each lord uses their own phone |

Pick a mode from the title screen. Baron Reginald fights like a **squire**, **knight** or **champion** (easy/normal/hard).
On-device campaigns are saved in the browser, so **Continue campaign** picks up where you left off.

### Phones mode

1. Open the game on a laptop connected to the TV and choose *Play with phones*.
2. Each player scans the QR code (or visits `/play` and types the room code) and picks a name.
3. Every human lord presses **Ready**. You can switch between 1 and 2 players in the lobby.

Each season:

- **Muster** — spend gold on men-at-arms, knights, catapults, or a new castle. Income comes from land and castles.
- **Campaign** — secretly choose one army to march to a neighbouring land (or hold). Orders are revealed together.
- **Battle** — marching into enemy land starts a **swordfight**; enemy castles and keeps need a **catapult siege** first.
  If both lords march at each other (same target, or swapping lands) a **joust** decides who strikes first.

Win by capturing your rival's **keep** (a siege, then a duel against their lord in the throne room), by owning all of England,
or by holding the most land after 20 seasons.

### Battle controls

| Battle | Phone / on-screen pad | Keys (Wolf · Stag) |
| --- | --- | --- |
| Joust | Hold the lance button, release just before impact (watch the timing bar) | Hold `E` · `U` |
| Siege, attacker | Aim and power sliders, FIRE | `A`/`D` aim, `W`/`S` power, `E` fire · `J`/`L`, `I`/`K`, `U` |
| Siege, defender | Tap a wall section to send masons (every 5 s) | `A`/`D` choose, `E` repair · `J`/`L`, `U` |
| Swordfight | Guard high/low, slash high/low, thrust | `W`/`S` guard, `E` slash high, `Q` slash low, `D` thrust · `I`/`K`, `U`, `O`, `J` |

In 1-player on-device games the arrow keys, `Space` and `Shift` work too. Guarding the right height blocks a slash; a thrust is slow and ignores guard, but is cancelled if you're hit while winding up.
`M` toggles music, `Esc` returns to the menu.

## Tech

- three.js (from jsDelivr) for all 3D, no build step.
- `public/js/shared/engine.js` holds all the rules, and `shared/ai.js` is the computer lord's strategy (what to buy, where to march).
  The same engine runs in the browser for on-device games and in a Cloudflare **Durable Object** for phones games.
- Phones mode: the Worker serves `public/` and routes `/ws?room=CODE` to the Durable Object (`src/match.js`), one per room.
  Phones send intents; the TV runs each battle in real time and reports the result.
- Battles: `public/js/scenes/` draws them, `bots.js` plays them for the computer, `pads.js` gives on-device players keyboard/touch controls.

```
src/worker.js          routing + room codes
src/match.js           Durable Object: sockets, joining, persistence (rules come from the engine)
public/index.html      title menu, board, battles      public/js/tv.js
public/play.html       phone controller                public/js/phone.js
public/js/controller.js  muster/march/battle controls (phones and the on-device side panel)
public/js/local.js     on-device host + saved campaign
public/js/shared/      map, engine, ai
test/sim.js            whole matches over websockets (add --one for vs computer)
test/browser.py        headless TV + 2 phones
test/modes.py          menu, on-device 1P/2P, phones 1P
test/scenes.py         each battle with scripted inputs
```

## Run locally

```
npm install
npx wrangler dev          # http://localhost:8787
npm test                  # in another terminal: simulated full match
```

On-device mode works fully on `localhost`. Phones on the same Wi-Fi can't reach `localhost`, so for real phone testing deploy to Cloudflare (below).

## Deploy (Cloudflare Workers)

Connect this repo in the Cloudflare dashboard (Workers & Pages → Create → Import a repository), keep the default
build settings (`npx wrangler deploy`), and it will auto-deploy on every push to `main`. The Durable Object
uses the SQLite backend, which works on the free plan.
