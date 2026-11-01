// Computer opponents for the real-time battles. Each bot reads the scene directly and feeds it
// inputs exactly as a phone or keyboard would, via scene.onInput(slot, data).
import { CHARGE_MS } from './scenes/joust.js';
import { G, CAT_Z, WALL_H, SECTION_W, REPAIR_COOLDOWN, REPAIR_AMOUNT } from './scenes/siege.js';
import { MOVES } from './scenes/duel.js';

const SKILL = { easy: 0.25, normal: 0.55, hard: 0.85 };
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export function makeBot(scene, slot, difficulty = 'normal') {
  const skill = SKILL[difficulty] ?? 0.55;
  const kind = scene.mini.kind;
  if (kind === 'joust') return joustBot(scene, slot, skill);
  if (kind === 'siege') return scene.mini.attacker === slot ? siegeAttackBot(scene, slot, skill) : siegeDefendBot(scene, slot, skill);
  if (kind === 'duel') return duelBot(scene, slot, skill);
  return { update() {} };
}

function joustBot(scene, slot, skill) {
  let plannedPass = 0, releaseAt = null, sent = false;
  return {
    update() {
      if (scene.phase !== 'charge' && scene.phase !== 'grace') return;
      if (plannedPass !== scene.pass) {
        plannedPass = scene.pass; sent = false;
        const early = 130 + gauss() * (60 + 380 * (1 - skill));
        releaseAt = CHARGE_MS - early;
      }
      if (!sent && scene.timer >= releaseAt) {
        sent = true;
        scene.onInput(slot, { pass: scene.pass, release: scene.timer });
      }
    },
  };
}

function siegeAttackBot(scene, slot, skill) {
  let wait = 1.2, aimed = false, aim = 0, power = 50;
  const plan = () => {
    // Aim for the weakest standing section (ties: the gatehouse).
    let best = 1;
    scene.walls.forEach((w, i) => { if (w > 0 && (w < scene.walls[best] || scene.walls[best] <= 0)) best = i; });
    // Less skilful lords don't focus their fire on one section.
    if (Math.random() > skill) best = Math.floor(Math.random() * 4);
    const x = -20 + SECTION_W * (best + 0.5) + gauss() * (0.5 + 8 * (1 - skill));
    const run = CAT_Z - 2;
    const ang = Math.atan2(x, run);
    const d = run / Math.cos(ang);
    const yTarget = WALL_H * 0.4;
    const v = Math.sqrt((G * d * d) / Math.max(1, 3.5 + d - yTarget));
    aim = Math.max(-40, Math.min(40, (ang * 180) / Math.PI));
    power = Math.max(0, Math.min(100, (v - 12) / 0.1 + gauss() * (1 + 18 * (1 - skill))));
  };
  return {
    update(dt) {
      if (scene.phase !== 'live' || scene.flying || scene.shots <= 0) return;
      wait -= dt;
      if (!aimed && wait <= 0.8) { plan(); aimed = true; scene.onInput(slot, { aim, power }); }
      if (aimed && wait <= 0) {
        scene.onInput(slot, { aim, power, fire: true });
        aimed = false;
        wait = 1.6 + Math.random() * 1.6;
      }
    },
  };
}

function siegeDefendBot(scene, slot, skill) {
  let delay = 0;
  return {
    update(dt) {
      if (scene.phase !== 'live') return;
      if (scene.elapsed - scene.lastRepair < REPAIR_COOLDOWN) { delay = 0.3 + (1 - skill) * 2.5 * Math.random(); return; }
      delay -= dt;
      if (delay > 0) return;
      let worst = -1;
      scene.walls.forEach((w, i) => {
        if (w > 0 && w <= scene.max - REPAIR_AMOUNT / 2 && (worst < 0 || w < scene.walls[worst])) worst = i;
      });
      // Weaker defenders sometimes patch the wrong wall.
      if (worst >= 0 && Math.random() > skill) {
        const standing = scene.walls.map((w, i) => (w > 0 && w < scene.max ? i : -1)).filter((i) => i >= 0);
        if (standing.length) worst = standing[Math.floor(Math.random() * standing.length)];
      }
      if (worst >= 0) scene.onInput(slot, { repair: worst });
      delay = 0.5;
    },
  };
}

function duelBot(scene, slot, skill) {
  const react = 0.65 - skill * 0.5; // seconds
  const pDefend = 0.2 + skill * 0.7;
  let pending = null, seenWindup = false, attackIn = 1.5;
  return {
    update(dt) {
      if (scene.phase !== 'live') return;
      const me = scene.fighters[slot], op = scene.fighters[1 - slot];

      // Spot the opponent winding up and decide (after a human-ish delay) how to answer.
      if (op.state === 'windup' && !seenWindup) {
        seenWindup = true;
        pending = { at: react * (0.7 + Math.random() * 0.6), move: op.move, ok: Math.random() < pDefend };
      }
      if (op.state !== 'windup') seenWindup = false;
      if (pending) {
        pending.at -= dt;
        if (pending.at <= 0) {
          if (pending.ok && op.state === 'windup') {
            if (pending.move === 'thrust') {
              const left = (MOVES.thrust.windup * op.speed - op.t) / 1000;
              if (me.state === 'idle' && left > (MOVES.high.windup * me.speed) / 1000) scene.onInput(slot, { act: Math.random() < 0.5 ? 'high' : 'low' });
            } else {
              scene.onInput(slot, { act: pending.move === 'high' ? 'guardHigh' : 'guardLow' });
            }
          }
          pending = null;
        }
      }

      attackIn -= dt;
      if (attackIn <= 0 && me.state === 'idle' && !pending) {
        let act;
        const r = Math.random();
        if (r < 0.2) act = 'thrust';
        else if (Math.random() < skill) act = op.guard === 'high' ? 'low' : 'high'; // read their guard
        else act = Math.random() < 0.5 ? 'high' : 'low';
        scene.onInput(slot, { act });
        attackIn = 0.5 + Math.random() * (1.6 - skill * 0.8);
      }
    },
  };
}
