// Shared map definition — imported by both the Worker (server rules) and the TV client (rendering).
// Coordinates: x = east, y = north, roughly 0..10 by 0..14.

export const OUTLINE = [
  [6.2, 14.0], [7.0, 12.6], [7.6, 11.2], [8.2, 9.8], [8.6, 8.8], [9.6, 8.0], [10.0, 7.2],
  [9.8, 6.4], [9.0, 6.0], [9.6, 5.2], [10.0, 4.6], [9.6, 4.0], [8.0, 3.6], [6.5, 3.4],
  [5.0, 3.0], [4.0, 2.8], [3.0, 2.2], [1.2, 1.0], [1.6, 2.0], [3.0, 3.4], [4.2, 4.2],
  [3.0, 4.6], [1.6, 4.8], [2.2, 5.6], [2.6, 6.6], [1.6, 7.6], [2.4, 8.0], [3.6, 8.0],
  [4.0, 8.6], [3.8, 9.6], [3.4, 10.6], [3.6, 11.6], [4.6, 12.4], [5.4, 13.4],
];

// type: open | castle | keep. Keeps are the two lords' homes.
export const TERRITORIES = [
  { id: 'northumbria', name: 'Northumbria', x: 6.0, y: 12.6, type: 'keep' },
  { id: 'cumbria', name: 'Cumbria', x: 4.4, y: 11.4, type: 'open' },
  { id: 'york', name: 'York', x: 6.6, y: 10.2, type: 'open' },
  { id: 'lancaster', name: 'Lancaster', x: 4.6, y: 9.6, type: 'open' },
  { id: 'lincoln', name: 'Lincoln', x: 8.0, y: 8.6, type: 'castle' },
  { id: 'chester', name: 'Chester', x: 4.4, y: 8.2, type: 'castle' },
  { id: 'gwynedd', name: 'Gwynedd', x: 2.4, y: 7.0, type: 'open' },
  { id: 'mercia', name: 'Mercia', x: 5.8, y: 7.4, type: 'open' },
  { id: 'norfolk', name: 'Norfolk', x: 9.0, y: 7.4, type: 'open' },
  { id: 'gloucester', name: 'Gloucester', x: 4.6, y: 5.6, type: 'castle' },
  { id: 'dyfed', name: 'Dyfed', x: 2.4, y: 5.2, type: 'open' },
  { id: 'essex', name: 'Essex', x: 8.4, y: 5.8, type: 'open' },
  { id: 'wessex', name: 'Wessex', x: 5.2, y: 4.0, type: 'castle' },
  { id: 'kent', name: 'Kent', x: 9.0, y: 4.6, type: 'keep' },
  { id: 'sussex', name: 'Sussex', x: 7.2, y: 4.0, type: 'open' },
  { id: 'cornwall', name: 'Cornwall', x: 2.4, y: 2.2, type: 'open' },
];

export const PLAYERS = [
  { slot: 0, house: 'House of Wolf', short: 'Wolf', color: '#c0392b', keep: 'northumbria', start: ['northumbria', 'york'] },
  { slot: 1, house: 'House of Stag', short: 'Stag', color: '#2e6fb5', keep: 'kent', start: ['kent', 'sussex'] },
];

export const HEX_R = 0.3;

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Deterministic hash noise so borders look organic but identical on server and client.
function noise(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Builds the hex grid and assigns each land hex to its nearest territory.
export function buildHexes() {
  const w = Math.sqrt(3) * HEX_R, vs = 1.5 * HEX_R;
  const hexes = [];
  const index = new Map();
  for (let j = 0; j * vs <= 14.4; j++) {
    for (let i = 0; i * w <= 10.4; i++) {
      const x = i * w + (j % 2) * (w / 2), y = j * vs;
      if (!inPoly(x, y, OUTLINE)) continue;
      let best = null, bd = Infinity;
      for (const t of TERRITORIES) {
        const d = Math.hypot(t.x - x, t.y - y) + noise(i, j) * 0.35;
        if (d < bd) { bd = d; best = t.id; }
      }
      const hex = { i, j, x, y, t: best, h: 0.15 + noise(j, i) * 0.12 };
      index.set(`${i},${j}`, hex);
      hexes.push(hex);
    }
  }
  return { hexes, index };
}

function hexNeighbours(i, j) {
  const odd = j % 2 === 1;
  return odd
    ? [[i + 1, j], [i - 1, j], [i, j - 1], [i + 1, j - 1], [i, j + 1], [i + 1, j + 1]]
    : [[i + 1, j], [i - 1, j], [i - 1, j - 1], [i, j - 1], [i - 1, j + 1], [i, j + 1]];
}

export function buildAdjacency() {
  const { hexes, index } = buildHexes();
  const adj = Object.fromEntries(TERRITORIES.map((t) => [t.id, new Set()]));
  for (const h of hexes) {
    for (const [a, b] of hexNeighbours(h.i, h.j)) {
      const n = index.get(`${a},${b}`);
      if (n && n.t !== h.t) { adj[h.t].add(n.t); adj[n.t].add(h.t); }
    }
  }
  return Object.fromEntries(Object.entries(adj).map(([k, v]) => [k, [...v].sort()]));
}

export const ADJACENCY = buildAdjacency();
export const territoryById = Object.fromEntries(TERRITORIES.map((t) => [t.id, t]));

// --- Rules constants shared by server and phone UI ---
export const COSTS = { soldier: 5, knight: 15, catapult: 20, castle: 30 };
export const INCOME = { base: 20, perTerritory: 8, castleBonus: 4 };
export const MAX_SEASONS = 20;
export const WALL_MAX = { castle: 60, keep: 80 };

export function duelHp(army) {
  return Math.min(220, 40 + 4 * (army.soldiers || 0) + 12 * (army.knights || 0));
}
export function armySize(a) {
  return (a.soldiers || 0) + (a.knights || 0) + (a.catapults || 0);
}
