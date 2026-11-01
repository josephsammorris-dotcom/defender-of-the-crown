import * as THREE from 'three';
import { PLAYERS } from '../shared/map.js';
import { addLights, makeKnight, box, cyl, cone, makeBanner, disposeTree } from './common.js';

const CHARGE_MS = 3000;
const COUNTDOWN_MS = 2200;
const HIT_WINDOW = 260, GLANCE_WINDOW = 600;

function grade(release) {
  if (release === null || release === undefined) return { pts: 0, word: 'never lowered' };
  const early = CHARGE_MS - release;
  if (early < 0) return { pts: 0, word: 'too late' };
  if (early <= HIT_WINDOW) return { pts: 2, word: 'clean hit' };
  if (early <= GLANCE_WINDOW) return { pts: 1, word: 'glancing blow' };
  return { pts: 0, word: 'too early' };
}

export class JoustScene {
  constructor(mini, ctx) {
    this.mini = mini; this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9cc7e8);
    this.scene.fog = new THREE.Fog(0x9cc7e8, 40, 90);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    addLights(this.scene, { shadowSize: 40 });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 80), new THREE.MeshLambertMaterial({ color: 0x6f9a4a }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(80, 8), new THREE.MeshLambertMaterial({ color: 0xb59a6a }));
    lane.rotation.x = -Math.PI / 2; lane.position.y = 0.01; lane.receiveShadow = true; this.scene.add(lane);
    // Tilt barrier
    for (let x = -36; x <= 36; x += 4) {
      const post = box(0.2, 1.4, 0.2, 0x6b4a2f); post.position.set(x, 0.7, 0); this.scene.add(post);
    }
    const rail = box(74, 0.25, 0.25, 0xe8e0d0); rail.position.set(0, 1.3, 0); this.scene.add(rail);
    const rail2 = box(74, 0.25, 0.25, 0xa03030); rail2.position.set(0, 0.8, 0); this.scene.add(rail2);
    // Stands with pennants behind
    for (let x = -30; x <= 30; x += 10) {
      const stand = box(9, 2.5, 3, 0x8a6b45); stand.position.set(x, 1.25, -9); this.scene.add(stand);
      const canopy = box(9.4, 0.3, 3.4, x % 20 === 0 ? 0xc0392b : 0x2e6fb5); canopy.position.set(x, 4.5, -9); this.scene.add(canopy);
      for (const dx of [-4.4, 4.4]) { const p = cyl(0.1, 0.1, 2, 0x5a4630); p.position.set(x + dx, 3.4, -7.5); this.scene.add(p); }
      for (let c = -3; c <= 3; c += 1.5) {
        const head = cone(0.3, 0.6, [0xd9b38c, 0xa67b5b, 0xf1c9a5][Math.abs(c * 2) % 3], 5);
        head.position.set(x + c, 2.9, -8.6); this.scene.add(head);
      }
      const b = makeBanner(x % 20 === 0 ? PLAYERS[0].color : PLAYERS[1].color, 3); b.position.set(x, 4.6, -9); this.scene.add(b);
    }
    for (let i = 0; i < 30; i++) {
      const t = cone(1.2, 3.5, 0x2f5d2a, 6); t.position.set(-90 + i * 6.2, 1.75, -24 - (i % 3) * 4); this.scene.add(t);
    }

    // Knights: player 0 rides from the left (+x heading), player 1 from the right.
    this.knights = mini.players.map((slot, i) => {
      const k = makeKnight(PLAYERS[slot].color, { mounted: true, lance: true });
      k.group.position.set(i === 0 ? -30 : 30, 0, i === 0 ? 1.4 : -1.4);
      k.group.rotation.y = i === 0 ? 0 : Math.PI;
      k.swordArm.rotation.z = 1.25; // lance raised
      k.swordArm.position.z = -0.42; // lance on the barrier side
      k.swordArm.rotation.y = 0.14; // angled across the tilt
      k.slot = slot;
      this.scene.add(k.group);
      return k;
    });

    this.wins = [0, 0];
    this.pass = 0;
    this.releases = [null, null];
    this.phase = 'intro';
    this.timer = 0;
    this.fallen = [false, false];
    this.cameraX = 0;
    this.hud = ctx.hud;
    this.renderHud('The joust! Hold your button — release just before the lances meet.');
    this.ctx.audio.fanfare();
  }

  renderHud(message, sub = '') {
    const p = this.mini.players.map((s) => this.ctx.state.players[s]);
    this.hud.innerHTML = `
      <div class="mini-title">Tournament Joust</div>
      <div class="score-row">
        <span style="color:${PLAYERS[this.mini.players[0]].color}">${p[0].name} ${'◆'.repeat(this.wins[0])}${'◇'.repeat(2 - this.wins[0])}</span>
        <span class="pass">Pass ${Math.max(1, this.pass)}</span>
        <span style="color:${PLAYERS[this.mini.players[1]].color}">${'◇'.repeat(2 - this.wins[1])}${'◆'.repeat(this.wins[1])} ${p[1].name}</span>
      </div>
      <div class="mini-msg">${message}</div>
      <div class="mini-sub">${sub}</div>`;
  }

  onInput(slot, data) {
    const i = this.mini.players.indexOf(slot);
    if (i < 0 || data.pass !== this.pass) return;
    if (this.phase !== 'charge' && this.phase !== 'grace') return;
    if (this.releases[i] === null && typeof data.release === 'number') {
      this.releases[i] = data.release;
      this.lowerAt = this.lowerAt || [];
    }
  }

  startPass() {
    this.pass += 1;
    this.releases = [null, null];
    this.fallen = [false, false];
    this.knights.forEach((k, i) => {
      k.group.position.set(i === 0 ? -30 : 30, 0, i === 0 ? 1.4 : -1.4);
      k.rider.rotation.set(0, 0, 0); k.rider.position.set(-0.1, 2.1, 0);
      k.swordArm.rotation.z = 1.25;
    });
    this.phase = 'countdown';
    this.timer = 0;
    this.ctx.cue({ phase: 'countdown', pass: this.pass, wins: this.wins });
    this.renderHud('Ready your lances…', 'Press and HOLD your button now');
  }

  update(dt) {
    this.timer += dt * 1000;
    const t = this.timer;
    if (this.phase === 'intro' && t > 3500) this.startPass();
    else if (this.phase === 'countdown') {
      const n = Math.ceil((COUNTDOWN_MS - t) / 700);
      if (n >= 1) this.renderHud(`${n}`, 'Hold your button…');
      if (t >= COUNTDOWN_MS) {
        this.phase = 'charge'; this.timer = 0;
        this.ctx.cue({ phase: 'charge', pass: this.pass, duration: CHARGE_MS });
        this.renderHud('CHARGE!', 'Release just before impact');
        this.ctx.audio.hooves(CHARGE_MS / 1000);
      }
    } else if (this.phase === 'charge' || this.phase === 'grace') {
      const f = Math.min(1, t / CHARGE_MS);
      this.knights.forEach((k, i) => {
        const dir = i === 0 ? 1 : -1;
        k.group.position.x = dir * (-30 + 29 * f);
        k.legs.forEach((leg, j) => { leg.rotation.z = Math.sin(t / 70 + j * 1.7) * 0.6; });
        const rel = this.releases[i];
        const target = rel !== null && rel <= t ? 0.05 : 1.25;
        k.swordArm.rotation.z += (target - k.swordArm.rotation.z) * Math.min(1, dt * 14);
      });
      if (this.phase === 'charge' && t >= CHARGE_MS) { this.phase = 'grace'; this.timer = CHARGE_MS; }
      if (this.phase === 'grace' && t >= CHARGE_MS + 450) this.resolvePass();
    } else if (this.phase === 'impact') {
      this.knights.forEach((k, i) => {
        const dir = i === 0 ? 1 : -1;
        k.group.position.x += dir * dt * 6 * Math.max(0, 1 - (t / 1500));
        if (this.fallen[i]) {
          k.rider.rotation.z = Math.min(1.6, k.rider.rotation.z + dt * 3);
          k.rider.position.y = Math.max(0.3, k.rider.position.y - dt * 2.5);
          k.rider.position.x = Math.max(-1.8, k.rider.position.x - dt * 1.5);
        }
        const rel = this.releases[i];
        if (rel !== null && rel <= CHARGE_MS + 450) k.swordArm.rotation.z += (0.05 - k.swordArm.rotation.z) * Math.min(1, dt * 14);
        if (this.fallen[i]) {
          /* already handled above */
        } else if (this.reel?.[i]) {
          k.rider.rotation.z = Math.sin(Math.min(t / 600, 1) * Math.PI) * 0.45;
        }
      });
      if (t > 2800) {
        if (this.wins[0] >= 2 || this.wins[1] >= 2 || this.pass >= 5) this.finishJoust();
        else this.startPass();
      }
    } else if (this.phase === 'done' && t > 3000 && !this.sent) {
      this.sent = true;
      this.ctx.finish({ winner: this.winnerSlot });
    }

    // Camera tracks the pair of knights
    const cx = (this.knights[0].group.position.x + this.knights[1].group.position.x) / 2;
    const spread = Math.abs(this.knights[0].group.position.x - this.knights[1].group.position.x);
    this.cameraX += (cx - this.cameraX) * Math.min(1, dt * 4);
    const dist = 14 + spread * 0.32;
    this.camera.position.set(this.cameraX, 3.2 + spread * 0.06, dist + 2);
    this.camera.lookAt(this.cameraX, 2.0, 0);
  }

  resolvePass() {
    const g = this.releases.map(grade);
    const names = this.mini.players.map((s) => this.ctx.state.players[s].name);
    let msg;
    this.reel = [false, false];
    if (g[0].pts > g[1].pts) { this.wins[0] += 1; msg = `${names[0]} wins the pass!`; }
    else if (g[1].pts > g[0].pts) { this.wins[1] += 1; msg = `${names[1]} wins the pass!`; }
    else msg = 'Even pass — ride again!';
    for (const i of [0, 1]) {
      const other = 1 - i;
      if (g[other].pts === 2 && g[i].pts === 0) this.fallen[i] = true;
      else if (g[other].pts > g[i].pts) this.reel[i] = true;
    }
    if (g[0].pts || g[1].pts) this.ctx.audio.clang(); else this.ctx.audio.whoosh();
    if (this.fallen.some(Boolean)) setTimeout(() => this.ctx.audio.thud(), 500);
    this.renderHud(msg, `${names[0]}: ${g[0].word} · ${names[1]}: ${g[1].word}`);
    this.ctx.cue({ phase: 'result', pass: this.pass, wins: this.wins, grades: g.map((x) => x.word) });
    this.phase = 'impact'; this.timer = 0;
  }

  finishJoust() {
    let w;
    if (this.wins[0] !== this.wins[1]) w = this.wins[0] > this.wins[1] ? 0 : 1;
    else w = Math.random() < 0.5 ? 0 : 1; // dead even after five passes: the crowd decides
    this.winnerSlot = this.mini.players[w];
    const name = this.ctx.state.players[this.winnerSlot].name;
    this.renderHud(`${name} wins the tournament!`, 'Their army strikes first this season.');
    this.ctx.cue({ phase: 'done', winner: this.winnerSlot });
    this.ctx.audio.fanfare();
    this.phase = 'done'; this.timer = 0;
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose() { disposeTree(this.scene); }
}
