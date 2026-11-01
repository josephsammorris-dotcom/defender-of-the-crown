// Simulated match: one fake TV + two fake phones play random legal turns over real websockets.
// Usage: start `npx wrangler dev`, then `node test/sim.js [baseUrl]`.
import WebSocket from 'ws';
import { ADJACENCY, COSTS } from '../public/js/shared/map.js';

const args = process.argv.slice(2);
const HUMANS = args.includes('--one') ? 1 : 2;
const BASE = args.find((a) => a.startsWith('http')) || 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
const { room } = await (await fetch(`${BASE}/api/new`)).json();
console.log('room', room, 'humans', HUMANS);

function client(hello) {
  const ws = new WebSocket(`${WS}/ws?room=${room}`);
  const c = { ws, state: null, handlers: [] };
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', ...hello })));
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.type === 'state') c.state = m.state;
    if (m.type === 'error') console.log('  server error to', hello.role, hello.name || '', m.message);
    c.handlers.forEach((h) => h(m));
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  return c;
}

const tv = client({ role: 'tv' });
tv.ws.on('open', () => setTimeout(() => tv.send({ type: 'config', humans: HUMANS, difficulty: 'hard' }), 50));
await new Promise((r) => setTimeout(r, 300));
const phones = [client({ role: 'phone', token: 'tokA', name: 'Alice' })];
if (HUMANS === 2) phones.push(client({ role: 'phone', token: 'tokB', name: 'Bob' }));
const rnd = (n) => Math.floor(Math.random() * n);
let lastMini = 0, lastActed = {};
const minis = {};

tv.handlers.push((m) => {
  if (m.type !== 'state') return;
  const st = m.state;
  if (st.mini && st.mini.id !== lastMini) {
    lastMini = st.mini.id;
    minis[st.mini.kind] = (minis[st.mini.kind] || 0) + 1;
    const mini = st.mini;
    let result;
    if (mini.kind === 'joust') result = { winner: rnd(2) };
    if (mini.kind === 'siege') {
      const breached = Math.random() < 0.6;
      result = { breached, walls: mini.walls.map((w, i) => (breached && i === 1 ? 0 : Math.max(5, w - 20))) };
    }
    if (mini.kind === 'duel') result = { winner: mini.players[rnd(2)], hpFrac: [Math.random(), Math.random()] };
    setTimeout(() => tv.send({ type: 'miniResult', miniId: mini.id, result }), 20);
  }
});

function act(idx) {
  const p = phones[idx];
  let i;
  const st = p.state;
  if (!st || st.you === null) return;
  const me = st.players[st.you];
  i = st.you;
  const key = `${st.phase}-${st.season}`;
  if (lastActed[idx] === key) return;
  if (st.phase === 'lobby' && !me.ready && st.players.every((x) => x.joined)) { lastActed[idx] = key; p.send({ type: 'ready' }); }
  if (st.phase === 'recruit' && !me.done) {
    lastActed[idx] = key;
    const mine = Object.entries(st.territories).filter(([, t]) => t.owner === i).map(([id]) => id);
    let gold = me.gold;
    while (gold >= COSTS.soldier) {
      const unit = ['soldier', 'soldier', 'knight', 'catapult'][rnd(4)];
      if (gold < COSTS[unit]) break;
      p.send({ type: 'buy', unit, territory: mine[rnd(mine.length)] });
      gold -= COSTS[unit];
    }
    p.send({ type: 'recruitDone' });
  }
  if (st.phase === 'move' && !me.locked) {
    lastActed[idx] = key;
    const sources = Object.entries(st.territories).filter(([, t]) => t.owner === i && t.army.soldiers + t.army.knights > 0);
    if (!sources.length) return p.send({ type: 'hold' });
    const attacks = sources.flatMap(([f, tt]) => ADJACENCY[f].filter((d) => st.territories[d].owner === 1 - i).map((d) => [f, tt, d]));
    let from, t, to;
    if (attacks.length && Math.random() < 0.7) [from, t, to] = attacks[rnd(attacks.length)];
    else { [from, t] = sources[rnd(sources.length)]; to = ADJACENCY[from][rnd(ADJACENCY[from].length)]; }
    p.send({ type: 'move', from, to, army: { soldiers: Math.max(1, t.army.soldiers - 1), knights: t.army.knights, catapults: t.army.catapults } });
  }
}
phones.forEach((p, i) => p.handlers.push(() => setTimeout(() => act(i), 10)));

const deadline = Date.now() + 60000;
const timer = setInterval(() => {
  const st = tv.state;
  if (st?.phase === 'over' || Date.now() > deadline) {
    clearInterval(timer);
    console.log('players', st?.players.map((p) => `${p.name}${p.ai ? ' (AI)' : ''}`).join(' vs '));
    console.log('phase', st?.phase, 'season', st?.season, 'winner', st?.winner, '-', st?.winReason);
    console.log('minigames played', minis);
    console.log('mini', JSON.stringify(st?.mini), 'queue?');console.log('last log:\n  ' + st?.log.slice(-6).join('\n  '));
    const ok = st?.phase === 'over' || st?.season >= 3;
    process.exit(ok ? 0 : 1);
  }
}, 200);
