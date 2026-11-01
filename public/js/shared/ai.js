// Strategic brain for the computer lord: what to buy and where to march each season.
import { ADJACENCY, PLAYERS, COSTS, duelHp, armySize } from './map.js';

const SKILL = { easy: 0.25, normal: 0.55, hard: 0.85 };
const owned = (s, slot) => Object.entries(s.territories).filter(([, t]) => t.owner === slot);
const strength = (a) => duelHp(a);

function enemyNear(s, id, slot) {
  return ADJACENCY[id].some((n) => s.territories[n].owner !== null && s.territories[n].owner !== slot);
}
function frontier(s, id, slot) {
  return ADJACENCY[id].some((n) => s.territories[n].owner !== slot);
}

export function aiRecruit(s, slot, difficulty = 'normal') {
  const skill = SKILL[difficulty] ?? 0.55;
  let gold = s.players[slot].gold;
  // Easy lords hoard a little; hard lords spend everything.
  const reserve = Math.round((1 - skill) * 12);
  const orders = [];
  const mine = owned(s, slot);
  if (!mine.length) return orders;
  const keep = PLAYERS[slot].keep;

  // Where to muster: the keep if threatened, otherwise the strongest frontier land.
  let stage;
  const keepT = s.territories[keep];
  const threat = keepT?.owner === slot && ADJACENCY[keep].some((n) => {
    const t = s.territories[n];
    return t.owner !== null && t.owner !== slot && strength(t.army) > strength(keepT.army) * 0.8;
  });
  if (threat) stage = keep;
  else {
    const fronts = mine.filter(([id]) => frontier(s, id, slot));
    const pool = fronts.length ? fronts : mine;
    pool.sort((a, b) => strength(b[1].army) - strength(a[1].army));
    stage = pool[0][0];
  }

  // A castle on an exposed open frontier now and then.
  const exposed = mine.find(([id, t]) => t.type === 'open' && enemyNear(s, id, slot));
  if (exposed && gold - reserve >= COSTS.castle + 20 && Math.random() < 0.25 + skill * 0.2) {
    orders.push({ unit: 'castle', territory: exposed[0] });
    gold -= COSTS.castle;
  }

  const army = { ...s.territories[stage].army };
  const enemyCastleNear = ADJACENCY[stage].some((n) => {
    const t = s.territories[n];
    return t.owner !== null && t.owner !== slot && t.type !== 'open';
  });
  while (gold - reserve >= COSTS.soldier) {
    let unit = 'soldier';
    if (enemyCastleNear && army.catapults < 2 && gold - reserve >= COSTS.catapult) unit = 'catapult';
    else if (gold - reserve >= COSTS.knight && Math.random() < 0.35) unit = 'knight';
    orders.push({ unit, territory: stage });
    army[unit + 's'] += 1;
    gold -= COSTS[unit];
  }
  return orders;
}

export function aiMove(s, slot, difficulty = 'normal') {
  const skill = SKILL[difficulty] ?? 0.55;
  const keep = PLAYERS[slot].keep;
  const candidates = [];

  for (const [from, t] of owned(s, slot)) {
    if (armySize(t.army) === 0 || t.army.soldiers + t.army.knights === 0) continue;
    // Leave a guard behind on the keep and on threatened land.
    const guard = from === keep || enemyNear(s, from, slot) ? 1 : 0;
    const send = { soldiers: Math.max(0, t.army.soldiers - guard), knights: t.army.knights, catapults: t.army.catapults };
    if (send.soldiers + send.knights === 0) continue;
    const mine = strength(send);

    for (const to of ADJACENCY[from]) {
      const d = s.territories[to];
      let score = 0;
      if (d.owner === null) score = 12 + (d.type !== 'open' ? 6 : 0);
      else if (d.owner === slot) {
        // Shuffle troops from safe interior lands toward the front.
        if (!frontier(s, from, slot) && frontier(s, to, slot)) score = 6;
      } else {
        const theirs = strength(d.army);
        const ratio = mine / Math.max(1, theirs);
        if (d.type === 'open') score = ratio > 1.1 ? 15 + 10 * Math.min(ratio, 3) : 0;
        else {
          const shots = 4 + 2 * send.catapults;
          const needShots = d.type === 'keep' ? 7 : 5;
          if (shots >= needShots && ratio > (d.type === 'keep' ? 1.0 : 0.9)) score = 20 + 10 * Math.min(ratio, 3) + (d.type === 'keep' ? 30 : 0);
        }
      }
      if (score <= 0) continue;
      // Easier lords make sillier choices.
      score += (Math.random() - 0.5) * 30 * (1 - skill);
      candidates.push({ score, from, to, army: send });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}
