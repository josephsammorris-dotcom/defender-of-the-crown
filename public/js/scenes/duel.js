import * as THREE from 'three';
import { PLAYERS } from '../shared/map.js';
import { addLights, makeKnight, box, cyl, cone, makeBanner, disposeTree } from './common.js';

const DUEL_MS = 60000;
export const MOVES = {
  high: { windup: 350, recover: 300, dmg: 10, height: 'high' },
  low: { windup: 350, recover: 300, dmg: 10, height: 'low' },
  thrust: { windup: 800, recover: 600, dmg: 25, height: 'mid' },
};
export const STAGGER = 450;

export class DuelScene {
  constructor(mini, ctx) {
    this.mini = mini; this.ctx = ctx;
    this.finale = !!mini.finale;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
    this.camera.position.set(0, 2.6, 9.5);
    this.camera.lookAt(0, 1.6, 0);
    if (this.finale) this.buildThroneRoom(); else this.buildField();

    const avg = (mini.hp[0] + mini.hp[1]) / 2;
    this.dmgScale = avg / 100;
    // Fighters are indexed by slot: Wolf (slot 0) always stands on the left, Stag on the right.
    this.fighters = [0, 1].map((slot) => {
      const i = mini.players.indexOf(slot);
      const k = makeKnight(PLAYERS[slot].color);
      const dir = slot === 0 ? 1 : -1;
      k.group.position.set(-2 * dir, 0, 0);
      k.group.rotation.y = slot === 0 ? 0 : Math.PI;
      this.scene.add(k.group);
      return {
        slot, k, dir,
        hp: mini.hp[i], max: mini.hp[i],
        guard: 'high', state: 'idle', move: null, t: 0, flash: 0, knock: 0,
        speed: this.finale && slot === mini.defender ? 0.85 : 1, // the lord of the keep strikes faster
      };
    });
    this.elapsed = 0;
    this.phase = 'intro';
    this.timer = 0;
    this.renderHud(this.finale ? 'Defend the crown!' : 'En garde!', 'Guard high/low blocks slashes. Thrusts break guard but can be interrupted.');
    this.ctx.audio.fanfare();
    this.sendCue();
  }
  get hud() { return this.ctx.hud; }

  buildField() {
    this.scene.background = new THREE.Color(0xa9c8e0);
    this.scene.fog = new THREE.Fog(0xa9c8e0, 25, 70);
    addLights(this.scene, { shadowSize: 15 });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 24), new THREE.MeshLambertMaterial({ color: 0x6f9a4a, flatShading: true }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.5, 6, 24), new THREE.MeshLambertMaterial({ color: 0xb59a6a }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; this.scene.add(ring);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
      if (Math.sin(a) > 0.35) continue; // keep the camera side open
      const post = box(0.2, 1, 0.2, 0x6b4a2f); post.position.set(Math.cos(a) * 6.5, 0.5, Math.sin(a) * 6.5); this.scene.add(post);
    }
    for (let i = -3; i <= 3; i++) {
      const tent = cone(1.6, 2.6, i % 2 ? 0xc0392b : 0xe8dcc0, 6); tent.position.set(i * 5, 1.3, -14); this.scene.add(tent);
      const b = makeBanner(i % 2 ? PLAYERS[0].color : PLAYERS[1].color, 1.4); b.position.set(i * 5, 2.4, -14); this.scene.add(b);
    }
    for (let i = 0; i < 24; i++) { const t = cone(1.1, 3.4, 0x2f5d2a, 6); t.position.set(-40 + i * 3.5, 1.7, -22 - (i % 3) * 3); this.scene.add(t); }
  }

  buildThroneRoom() {
    this.scene.background = new THREE.Color(0x1a1410);
    this.scene.fog = new THREE.Fog(0x1a1410, 14, 30);
    this.scene.add(new THREE.HemisphereLight(0xffd9a0, 0x221a10, 0.7));
    const floor = box(30, 0.2, 16, 0x6e675e); floor.position.set(0, -0.1, -2); this.scene.add(floor);
    const carpet = box(4, 0.05, 16, 0x8b1d1d); carpet.rotation.y = Math.PI / 2; carpet.position.set(0, 0.03, -1); this.scene.add(carpet);
    const back = box(30, 10, 0.6, 0x5a544b); back.position.set(0, 5, -8); this.scene.add(back);
    for (let x = -10; x <= 10; x += 4) {
      const pillar = cyl(0.5, 0.6, 9, 0x7a7266, 8); pillar.position.set(x, 4.5, -6); this.scene.add(pillar);
      const torch = new THREE.PointLight(0xff9a40, 5, 9, 1.6); torch.position.set(x, 4, -5.3); this.scene.add(torch);
      const flame = cone(0.15, 0.4, 0xffa640, 5); flame.material.emissive = new THREE.Color(0xff7a20); flame.position.set(x, 4, -5.4); this.scene.add(flame);
      const tapestry = box(1.8, 3.6, 0.1, x % 8 === 0 ? PLAYERS[this.mini.defender].color : 0xd4af37); tapestry.position.set(x + 2, 5.5, -7.6); this.scene.add(tapestry);
    }
    const dais = box(5, 0.6, 3, 0x6e675e); dais.position.set(0, 0.3, -6); this.scene.add(dais);
    const throne = box(1.4, 2.6, 1, 0xd4af37); throne.position.set(0, 1.9, -6.6); this.scene.add(throne);
    const seat = box(1.4, 0.4, 1.2, 0x8b1d1d); seat.position.set(0, 1.2, -6.2); this.scene.add(seat);
    const key = new THREE.DirectionalLight(0xffe2b0, 1.2); key.position.set(3, 8, 6); key.castShadow = true; this.scene.add(key);
  }

  sendCue(extra = {}) {
    this.ctx.cue({
      hp: this.fighters.map((f) => Math.max(0, Math.round(f.hp))),
      max: this.fighters.map((f) => f.max),
      guard: this.fighters.map((f) => f.guard),
      timeLeft: Math.max(0, Math.round((DUEL_MS - this.elapsed) / 1000)),
      ...extra,
    });
  }

  renderHud(msg, sub = '') {
    const f = this.fighters;
    const name = (i) => this.ctx.state.players[f[i].slot].name;
    const bar = (i) => `<div class="hp"><div class="fill" style="width:${(100 * Math.max(0, f[i].hp)) / f[i].max}%;background:${PLAYERS[f[i].slot].color}"></div></div>`;
    this.hud.innerHTML = `
      <div class="mini-title">${this.finale ? 'Duel in the Throne Room' : 'Swordfight'}</div>
      <div class="score-row duel-row">
        <div class="duellist"><span>${name(0)}</span>${bar(0)}</div>
        <span class="pass">${Math.max(0, Math.ceil((DUEL_MS - this.elapsed) / 1000))}s</span>
        <div class="duellist right"><span>${name(1)}</span>${bar(1)}</div>
      </div>
      <div class="mini-msg">${msg}</div><div class="mini-sub">${sub}</div>`;
    this.lastMsg = [msg, sub];
  }

  onInput(slot, data) {
    if (this.phase !== 'live') return;
    const f = this.fighters.find((x) => x.slot === slot);
    if (!f || !data.act) return;
    if (data.act === 'guardHigh' || data.act === 'guardLow') {
      f.guard = data.act === 'guardHigh' ? 'high' : 'low';
      this.sendCue();
      return;
    }
    if (f.state !== 'idle' || !MOVES[data.act]) return;
    f.state = 'windup'; f.move = data.act; f.t = 0;
  }

  strike(att, def) {
    const m = MOVES[att.move];
    const blocked = m.height !== 'mid' && def.state === 'idle' && def.guard === m.height;
    if (blocked) {
      this.ctx.audio.clang();
      this.spark(def);
      this.renderHud('Parried!');
      this.sendCue({ event: 'block', by: def.slot });
      return;
    }
    def.hp -= m.dmg * this.dmgScale;
    def.flash = 0.25; def.knock = 0.35;
    if (def.state === 'windup') { def.state = 'stagger'; def.t = 0; def.move = null; }
    this.ctx.audio.hit(att.move === 'thrust');
    this.renderHud(att.move === 'thrust' ? 'A crushing thrust!' : 'A hit!');
    this.sendCue({ event: 'hit', on: def.slot });
  }

  spark(f) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
    s.position.set(f.k.group.position.x + f.dir * 0.8, f.guard === 'high' ? 2.2 : 1.2, 0.3);
    s.userData.life = 0.25;
    this.scene.add(s);
    (this.sparks ||= []).push(s);
  }

  update(dt) {
    const ms = dt * 1000;
    this.timer += ms;
    if (this.phase === 'intro' && this.timer > 3000) { this.phase = 'live'; this.renderHud('Fight!'); this.sendCue({ live: true }); }
    if (this.phase === 'live') {
      this.elapsed += ms;
      if (Math.floor(this.elapsed / 1000) !== Math.floor((this.elapsed - ms) / 1000)) { this.renderHud(...this.lastMsg); this.sendCue(); }
      for (let i = 0; i < 2; i++) {
        const f = this.fighters[i], o = this.fighters[1 - i];
        f.t += ms;
        if (f.state === 'windup' && f.t >= MOVES[f.move].windup * f.speed) {
          this.strike(f, o);
          f.state = 'recover'; f.t = 0;
        } else if (f.state === 'recover' && f.t >= MOVES[f.move].recover * f.speed) { f.state = 'idle'; f.move = null; }
        else if (f.state === 'stagger' && f.t >= STAGGER) { f.state = 'idle'; }
      }
      const dead = this.fighters.findIndex((f) => f.hp <= 0);
      if (dead >= 0 || this.elapsed >= DUEL_MS) this.endDuel(dead);
    }

    // Animate fighters
    for (const f of this.fighters) {
      const arm = f.k.swordArm;
      let target = f.guard === 'high' ? 2.3 : 0.9; // rotation.z of arm: sword up or low
      let reach = 0;
      if (f.state === 'windup') {
        const p = f.t / (MOVES[f.move].windup * f.speed);
        if (f.move === 'high') target = 3.0 - p * 0.2;
        else if (f.move === 'low') target = 0.15;
        else { target = 1.57; reach = -0.4 * p; }
      } else if (f.state === 'recover') {
        if (f.move === 'high') target = 0.9;
        else if (f.move === 'low') target = 1.9;
        else { target = 1.57; reach = 0.6 * Math.max(0, 1 - f.t / 200); }
      } else if (f.state === 'stagger') target = 0.4;
      arm.rotation.z += (target - arm.rotation.z) * Math.min(1, dt * 18);
      f.k.rider.position.x = reach;
      f.knock = Math.max(0, f.knock - dt);
      const baseX = -2 * f.dir;
      f.k.group.position.x = baseX - f.dir * f.knock * 1.2;
      f.k.rider.rotation.z = f.state === 'stagger' ? 0.25 : 0;
      f.flash = Math.max(0, f.flash - dt);
      f.k.torso.material.emissive?.setHex(f.flash > 0 ? 0x880000 : 0x000000);
      if (this.phase === 'done' && f.hp <= 0) { f.k.group.rotation.z = Math.min(Math.PI / 2, f.k.group.rotation.z + dt * 2); }
    }
    if (this.sparks) for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]; s.userData.life -= dt; s.scale.multiplyScalar(1 + dt * 4);
      if (s.userData.life <= 0) { this.scene.remove(s); disposeTree(s); this.sparks.splice(i, 1); }
    }
    if (this.phase === 'done' && this.timer > 3500 && !this.sent) {
      this.sent = true;
      this.ctx.finish({ winner: this.winnerSlot, hpFrac: this.mini.players.map((slot) => Math.max(0, this.fighters[slot].hp) / this.fighters[slot].max) });
    }
  }

  endDuel(deadIdx) {
    let w;
    if (deadIdx >= 0) w = 1 - deadIdx;
    else {
      const fr = this.fighters.map((f) => f.hp / f.max);
      w = fr[0] > fr[1] ? 0 : 1; // ties go to the defender
    }
    this.winnerSlot = this.fighters[w].slot;
    const name = this.ctx.state.players[this.winnerSlot].name;
    this.phase = 'done'; this.timer = 0;
    this.renderHud(`${name} is victorious!`, deadIdx >= 0 ? '' : 'Time! Judged on wounds taken.');
    this.sendCue({ done: true, winner: this.winnerSlot });
    this.ctx.audio.fanfare();
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose() { disposeTree(this.scene); }
}
