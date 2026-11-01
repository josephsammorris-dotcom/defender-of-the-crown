// Game rules engine — pure state + rules, no networking.
// Used by the Durable Object (phones mode) and directly in the browser (play-on-this-device mode).
import {
  TERRITORIES, PLAYERS, ADJACENCY, territoryById, COSTS, INCOME, MAX_SEASONS, WALL_MAX, duelHp, armySize,
} from './map.js';
import { aiRecruit, aiMove } from './ai.js';

const emptyArmy = () => ({ soldiers: 0, knights: 0, catapults: 0 });
export const AI_NAME = 'Baron Reginald';
export const DIFFICULTIES = ['easy', 'normal', 'hard'];

export function freshState(prev) {
  const config = { humans: 2, difficulty: 'normal', ...(prev?.config || {}) };
  return {
    config,
    phase: 'lobby',
    season: 0,
    players: PLAYERS.map((p, i) => {
      const ai = config.humans === 1 && i === 1;
      return {
        slot: i,
        ai,
        name: ai ? AI_NAME : (prev?.players?.[i]?.ai ? null : prev?.players?.[i]?.name || null),
        token: ai ? 'ai' : (prev?.players?.[i]?.ai ? null : prev?.players?.[i]?.token || null),
        ready: ai,
        gold: 0,
        done: false,
        move: null,
      };
    }),
    territories: {},
    mini: null,
    miniCounter: 0,
    queue: [],
    revealed: null,
    log: [],
    winner: null,
    winReason: null,
  };
}

export class Engine {
  constructor(state) {
    this.state = state || freshState();
  }

  log(line) {
    this.state.log.push(line);
    if (this.state.log.length > 14) this.state.log.shift();
  }

  // ---------- views ----------
  // slot = the viewing player (null for the TV). connected = set of slots with a live controller.
  view(slot, connected) {
    const s = this.state;
    return {
      config: s.config,
      phase: s.phase,
      season: s.season,
      maxSeasons: MAX_SEASONS,
      players: s.players.map((p) => ({
        slot: p.slot,
        ai: p.ai,
        name: p.name,
        joined: !!p.token,
        connected: p.ai || !connected || connected.has(p.slot),
        ready: p.ready,
        gold: p.gold,
        done: p.done,
        locked: p.move !== null,
        // Orders stay secret until both are sealed, except to their owner.
        move: slot === p.slot ? p.move : null,
      })),
      territories: s.territories,
      mini: s.mini,
      revealed: s.revealed,
      log: s.log,
      winner: s.winner,
      winReason: s.winReason,
      you: slot,
    };
  }

  // ---------- setup ----------
  configure({ humans, difficulty }) {
    const s = this.state;
    if (s.phase !== 'lobby' && s.phase !== 'over') throw new Error('Cannot change mode mid-campaign.');
    const config = {
      humans: humans === 1 ? 1 : 2,
      difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : s.config.difficulty,
    };
    this.state = freshState({ ...s, config });
    this.state.log = s.log;
    if (config.humans !== s.config.humans) {
      this.log(config.humans === 1 ? `${AI_NAME} takes up the Stag banner.` : 'The Stag banner awaits a second lord.');
    }
  }

  // Phones mode: returns the slot this controller takes, or null if the realm is full.
  join(token, name) {
    const s = this.state;
    let p = s.players.find((pl) => !pl.ai && pl.token && pl.token === token);
    if (!p) p = s.players.find((pl) => !pl.ai && !pl.token);
    if (!p) return null;
    p.token = token;
    if (name) p.name = String(name).slice(0, 16);
    if (!p.name) p.name = PLAYERS[p.slot].short;
    if (s.phase === 'lobby' || s.phase === 'over') this.log(`${p.name} joins as ${PLAYERS[p.slot].house}.`);
    return p.slot;
  }

  // Play-on-this-device: name the lords and begin immediately.
  startLocal({ humans, difficulty, names }) {
    this.state = freshState({ config: { humans, difficulty } });
    this.state.players.forEach((p, i) => {
      if (p.ai) return;
      p.token = 'local';
      p.name = (names?.[i] || '').trim().slice(0, 16) || PLAYERS[i].short;
    });
    this.startGame();
  }

  newGame() {
    this.state = freshState(this.state);
    this.log('A new campaign is declared. Ready your lords.');
  }

  // ---------- player intents ----------
  act(slot, msg) {
    const s = this.state;
    const p = s.players[slot];
    if (!p || p.ai) return;

    if (msg.type === 'rename') { p.name = String(msg.name || '').slice(0, 16) || p.name; return; }

    if (msg.type === 'ready' && (s.phase === 'lobby' || s.phase === 'over')) {
      if (s.phase === 'over') { this.newGame(); return this.act(slot, msg); }
      p.ready = !p.ready;
      if (s.players.every((pl) => pl.token && pl.ready)) this.startGame();
      return;
    }

    if (s.phase === 'recruit') {
      if (msg.type === 'buy') return this.buy(slot, msg.unit, msg.territory);
      if (msg.type === 'recruitDone') {
        p.done = !p.done;
        if (s.players.every((pl) => pl.done)) this.startMovePhase();
      }
      return;
    }

    if (s.phase === 'move') {
      if (msg.type === 'move') p.move = this.validateMove(slot, msg);
      else if (msg.type === 'hold') p.move = 'hold';
      else if (msg.type === 'cancelMove') p.move = null;
      else return;
      if (s.players.every((pl) => pl.move !== null)) this.startResolve();
    }
  }

  miniResult(miniId, result) {
    const s = this.state;
    if (!s.mini || miniId !== s.mini.id) return false;
    const mini = s.mini;
    s.mini = null;
    this.applyMiniResult(mini, result || {});
    this.processQueue();
    return true;
  }

  // ---------- game flow ----------
  startGame() {
    const s = this.state;
    s.territories = {};
    for (const t of TERRITORIES) {
      s.territories[t.id] = {
        owner: null,
        type: t.type,
        army: emptyArmy(),
        walls: t.type === 'open' ? null : Array(4).fill(WALL_MAX[t.type]),
      };
    }
    for (const pl of PLAYERS) {
      const [keep, second] = pl.start;
      s.territories[keep].owner = pl.slot;
      s.territories[keep].army = { soldiers: 6, knights: 2, catapults: 1 };
      s.territories[second].owner = pl.slot;
      s.territories[second].army = { soldiers: 3, knights: 0, catapults: 0 };
    }
    s.players.forEach((p) => { p.gold = 30; p.ready = p.ai; });
    s.season = 0;
    s.winner = null;
    s.winReason = null;
    this.log('The king is dead. England is without a crown!');
    this.startSeason();
  }

  startSeason() {
    const s = this.state;
    s.season += 1;
    s.revealed = null;
    for (const p of s.players) {
      const owned = Object.values(s.territories).filter((t) => t.owner === p.slot);
      const castles = owned.filter((t) => t.type !== 'open').length;
      const income = INCOME.base + INCOME.perTerritory * owned.length + INCOME.castleBonus * castles;
      if (s.season > 1) p.gold += income;
      p.done = false;
      p.move = null;
    }
    // Walls slowly repair between seasons.
    for (const t of Object.values(s.territories)) {
      if (t.walls) t.walls = t.walls.map((w) => Math.min(WALL_MAX[t.type], w + 15));
    }
    s.phase = 'recruit';
    this.log(`Season ${s.season}: muster your forces.`);
    // Computer lords muster straight away.
    for (const p of s.players) {
      if (!p.ai) continue;
      for (const order of aiRecruit(s, p.slot, s.config.difficulty)) {
        try { this.buy(p.slot, order.unit, order.territory); } catch { /* skip unaffordable */ }
      }
      p.done = true;
    }
  }

  buy(slot, unit, territoryId) {
    const s = this.state;
    const p = s.players[slot];
    if (p.done) return;
    const t = s.territories[territoryId];
    if (!t || t.owner !== slot) throw new Error('You must own that territory.');
    const cost = COSTS[unit];
    if (!cost) throw new Error('Unknown purchase.');
    if (p.gold < cost) throw new Error('Not enough gold.');
    if (unit === 'castle') {
      if (t.type !== 'open') throw new Error('Already fortified.');
      t.type = 'castle';
      t.walls = Array(4).fill(Math.round(WALL_MAX.castle * 0.6)); // new walls start part-built
    } else {
      t.army[unit + 's'] += 1;
    }
    p.gold -= cost;
  }

  startMovePhase() {
    const s = this.state;
    s.phase = 'move';
    s.players.forEach((p) => { p.move = null; });
    this.log('Choose your campaign: one army marches this season.');
    for (const p of s.players) {
      if (!p.ai) continue;
      const mv = aiMove(s, p.slot, s.config.difficulty);
      try { p.move = mv ? this.validateMove(p.slot, mv) : 'hold'; } catch { p.move = 'hold'; }
    }
  }

  validateMove(slot, msg) {
    const s = this.state;
    const from = s.territories[msg.from];
    if (!from || from.owner !== slot) throw new Error('You must march from your own land.');
    if (!ADJACENCY[msg.from].includes(msg.to)) throw new Error('That land is not adjacent.');
    const army = {
      soldiers: Math.max(0, Math.min(from.army.soldiers, msg.army?.soldiers | 0)),
      knights: Math.max(0, Math.min(from.army.knights, msg.army?.knights | 0)),
      catapults: Math.max(0, Math.min(from.army.catapults, msg.army?.catapults | 0)),
    };
    if (armySize(army) === 0) throw new Error('Send at least one unit.');
    return { from: msg.from, to: msg.to, army };
  }

  startResolve() {
    const s = this.state;
    s.phase = 'resolve';
    const [a, b] = s.players.map((p) => (p.move === 'hold' ? null : p.move));
    s.revealed = s.players.map((p) => p.move);
    s.players.forEach((p) => {
      const m = p.move;
      if (m === 'hold') this.log(`${p.name} holds position.`);
      else this.log(`${p.name} marches ${territoryById[m.from].name} → ${territoryById[m.to].name}.`);
    });
    s.queue = [];
    const conflict = a && b && (a.to === b.to || (a.to === b.from && b.to === a.from));
    if (conflict) {
      s.queue.push({ type: 'joust' });
    } else {
      const order = s.season % 2 === 1 ? [0, 1] : [1, 0];
      for (const slot of order) {
        const m = slot === 0 ? a : b;
        if (m) s.queue.push({ type: 'move', slot, move: m });
      }
    }
    this.processQueue();
  }

  processQueue() {
    const s = this.state;
    while (!s.mini && s.phase === 'resolve' && s.queue.length) {
      const action = s.queue.shift();
      if (action.type === 'joust') {
        this.log('Rival armies meet on the road — a joust decides who strikes first!');
        this.startMini('joust', { players: [0, 1], territory: s.revealed[0].to });
      } else if (action.type === 'move') {
        this.executeMove(action.slot, action.move);
      }
    }
    if (!s.mini && s.phase === 'resolve' && !s.queue.length) this.endSeason();
  }

  startMini(kind, data) {
    const s = this.state;
    s.miniCounter += 1;
    s.mini = { ...data, id: s.miniCounter, kind };
  }

  executeMove(slot, mv) {
    const s = this.state;
    const p = s.players[slot];
    const from = s.territories[mv.from];
    const to = s.territories[mv.to];
    if (from.owner !== slot) { this.log(`${p.name}'s army finds its home lost and scatters.`); return; }
    const army = {
      soldiers: Math.min(mv.army.soldiers, from.army.soldiers),
      knights: Math.min(mv.army.knights, from.army.knights),
      catapults: Math.min(mv.army.catapults, from.army.catapults),
    };
    if (armySize(army) === 0) return;
    for (const k of Object.keys(army)) from.army[k] -= army[k];
    const name = territoryById[mv.to].name;

    if (to.owner === slot) {
      for (const k of Object.keys(army)) to.army[k] += army[k];
      this.log(`${p.name} reinforces ${name}.`);
      return;
    }
    if (to.owner === null) {
      to.owner = slot;
      to.army = army;
      this.log(`${p.name} claims ${name}.`);
      return;
    }
    const defender = to.owner;
    const ctx = { attacker: slot, defender, territory: mv.to, from: mv.from, army };
    if (to.type === 'open') {
      if (armySize(to.army) === 0) {
        to.owner = slot; to.army = army;
        this.log(`${p.name} seizes undefended ${name}.`);
        return;
      }
      this.startDuel(ctx);
    } else {
      const finale = to.type === 'keep';
      this.log(finale
        ? `${p.name} lays siege to the keep of ${s.players[defender].name}!`
        : `${p.name} besieges the castle at ${name}.`);
      this.startMini('siege', {
        ...ctx,
        players: [slot, defender],
        finale,
        walls: to.walls.slice(),
        wallMax: WALL_MAX[to.type],
        shots: 4 + 2 * army.catapults,
      });
    }
  }

  startDuel(ctx, finale = false) {
    const s = this.state;
    const to = s.territories[ctx.territory];
    const defHp = Math.round(duelHp(to.army) * (finale ? 1.5 : 1));
    this.log(finale
      ? `The gates fall! ${s.players[ctx.attacker].name} duels ${s.players[ctx.defender].name} in the throne room.`
      : `Swords are drawn at ${territoryById[ctx.territory].name}.`);
    const { attacker, defender, territory, from, army } = ctx;
    this.startMini('duel', {
      attacker, defender, territory, from, army,
      players: [attacker, defender],
      finale,
      hp: [duelHp(army), Math.max(finale ? 80 : 30, defHp)],
    });
  }

  applyMiniResult(mini, result) {
    const s = this.state;
    if (mini.kind === 'joust') {
      const winner = result.winner === 1 ? 1 : 0;
      const loser = 1 - winner;
      this.log(`${s.players[winner].name} wins the joust and strikes first! ${s.players[loser].name}'s march is halted.`);
      const m = s.revealed[winner];
      if (m && m !== 'hold') s.queue.unshift({ type: 'move', slot: winner, move: m });
      return;
    }

    const att = s.players[mini.attacker];
    const to = s.territories[mini.territory];
    const name = territoryById[mini.territory].name;

    if (mini.kind === 'siege') {
      if (Array.isArray(result.walls)) to.walls = result.walls.map((w) => Math.max(0, Math.min(mini.wallMax, w | 0)));
      if (result.breached) {
        this.log(`The walls of ${name} are breached!`);
        if (armySize(to.army) === 0 && !mini.finale) {
          to.owner = mini.attacker; to.army = mini.army;
          this.log(`${att.name} storms the empty castle at ${name}.`);
          return;
        }
        this.startDuel(mini, mini.finale);
      } else {
        const army = { ...mini.army, soldiers: Math.floor(mini.army.soldiers * 0.75) };
        const home = s.territories[mini.from];
        if (home.owner === mini.attacker) {
          for (const k of Object.keys(army)) home.army[k] += army[k];
          this.log(`The siege of ${name} fails. ${att.name} retreats, weakened.`);
        } else {
          this.log(`The siege of ${name} fails and ${att.name}'s army has nowhere to retreat.`);
        }
      }
      return;
    }

    if (mini.kind === 'duel') {
      const winner = result.winner === mini.defender ? mini.defender : mini.attacker;
      const frac = Array.isArray(result.hpFrac) ? result.hpFrac : [0.5, 0.5];
      const scale = (army, f) => {
        const k = Math.max(0.3, Math.min(1, f));
        return {
          soldiers: Math.floor(army.soldiers * k),
          knights: Math.floor(army.knights * k),
          catapults: army.catapults,
        };
      };
      if (winner === mini.attacker) {
        const survivors = scale(mini.army, frac[0]);
        if (armySize(survivors) === 0) survivors.soldiers = 1;
        to.owner = mini.attacker;
        to.army = survivors;
        this.log(`${att.name} is victorious and takes ${name}!`);
        if (mini.finale) {
          s.winner = mini.attacker;
          s.winReason = `${att.name} captured the keep of ${s.players[mini.defender].name} and claims the crown!`;
          s.phase = 'over';
          s.queue = [];
          this.log(s.winReason);
        }
      } else {
        to.army = scale(to.army, frac[1]);
        this.log(`${s.players[mini.defender].name} holds ${name}! The attackers are routed.`);
      }
    }
  }

  endSeason() {
    const s = this.state;
    if (s.phase === 'over') return;
    const counts = [0, 1].map((slot) => Object.values(s.territories).filter((t) => t.owner === slot).length);
    for (const slot of [0, 1]) {
      if (counts[1 - slot] === 0) return this.finish(slot, `${s.players[slot].name} has destroyed every rival banner!`);
      if (counts[slot] === TERRITORIES.length) return this.finish(slot, `${s.players[slot].name} rules all of England!`);
    }
    if (s.season >= MAX_SEASONS) {
      const w = counts[0] === counts[1] ? (s.players[0].gold >= s.players[1].gold ? 0 : 1) : (counts[0] > counts[1] ? 0 : 1);
      return this.finish(w, `After ${MAX_SEASONS} seasons, ${s.players[w].name} holds the most land and is crowned.`);
    }
    this.startSeason();
  }

  finish(slot, reason) {
    const s = this.state;
    s.winner = slot;
    s.winReason = reason;
    s.phase = 'over';
    this.log(reason);
  }
}
