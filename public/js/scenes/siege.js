import * as THREE from 'three';
import { PLAYERS } from '../shared/map.js';
import { addLights, box, cyl, cone, makeTower, makeBanner, disposeTree, mat } from './common.js';

// Physics (world units): catapult at z = 30, wall plane at z = 0, wall height 8, four 10-wide sections.
export const G = 9.8, WALL_H = 8, CAT_Z = 30, SECTION_W = 10;
export const SIEGE_MS = 75000, REPAIR_COOLDOWN = 5000;
export const REPAIR_AMOUNT = 12; const DIRECT = 25, SPLASH = 10;
export const SECTION_NAMES = ['West wall', 'Gatehouse', 'Great hall wall', 'East wall'];

export class SiegeScene {
  constructor(mini, ctx) {
    this.mini = mini; this.ctx = ctx;
    this.att = mini.attacker; this.def = mini.defender;
    this.walls = mini.walls.slice();
    this.max = mini.wallMax;
    this.shots = mini.shots;
    this.aim = 0; this.power = 50;
    this.flying = null;
    this.lastRepair = -REPAIR_COOLDOWN;
    this.elapsed = 0;
    this.phase = 'intro';
    this.timer = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(mini.finale ? 0x8a6d8f : 0x9fb9cf);
    this.scene.fog = new THREE.Fog(this.scene.background, 50, 120);
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 200);
    this.camera.position.set(0, 9, 44);
    this.camera.lookAt(0, 4, 0);
    addLights(this.scene, { shadowSize: 40, sun: mini.finale ? 0xffc89a : 0xfff1d6 });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x77924f }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    const moat = new THREE.Mesh(new THREE.PlaneGeometry(60, 3.5), new THREE.MeshLambertMaterial({ color: 0x3a6a8a }));
    moat.rotation.x = -Math.PI / 2; moat.position.set(0, 0.02, 3); this.scene.add(moat);

    // Wall sections
    const defColor = PLAYERS[this.def].color;
    this.sectionMeshes = this.walls.map((_, i) => {
      const g = new THREE.Group();
      const x = -15 + i * SECTION_W;
      g.position.set(x, 0, 0);
      const body = box(SECTION_W - 1.2, WALL_H, 2.4, 0xa9a090);
      body.position.y = WALL_H / 2; g.add(body);
      for (let c = -4; c <= 4; c += 1.6) {
        const cren = box(0.8, 0.8, 2.4, 0xa9a090); cren.position.set(c, WALL_H + 0.4, 0); body.add(cren); cren.position.y -= WALL_H / 2;
      }
      if (i === 1) {
        const gate = box(3, 4.5, 0.4, 0x5a3d22); gate.position.set(0, 2.25, 1.3); g.add(gate); this.gate = gate;
      }
      this.scene.add(g);
      return { group: g, body };
    });
    for (let i = 0; i <= 4; i++) {
      const tw = makeTower(1.6, WALL_H + 3.5, 0xb3ab9c, new THREE.Color(defColor).getHex());
      tw.position.set(-20 + i * SECTION_W, 0, 0); this.scene.add(tw);
    }
    const keep = makeTower(4, 18, 0x9c9486, new THREE.Color(defColor).getHex()); keep.position.set(0, 0, -12); this.scene.add(keep);
    const flag = makeBanner(defColor, 5); flag.scale.set(4, 4, 4); flag.position.set(0, 26, -12); this.scene.add(flag);
    this.rubble = new THREE.Group(); this.scene.add(this.rubble);

    // Catapult
    this.catapult = new THREE.Group();
    const base = box(3, 0.6, 4.5, 0x6b4a2f); base.position.y = 0.8; this.catapult.add(base);
    for (const x of [-1.3, 1.3]) for (const z of [-1.6, 1.6]) { const w = cyl(0.7, 0.7, 0.3, 0x4a3322, 8); w.rotation.z = Math.PI / 2; w.position.set(x * 1.15, 0.7, z); this.catapult.add(w); }
    for (const x of [-1, 1]) { const up = box(0.3, 2.4, 0.3, 0x6b4a2f); up.position.set(x, 2.1, 0); this.catapult.add(up); }
    this.arm = new THREE.Group(); this.arm.position.set(0, 2.9, 0);
    const beam = box(0.35, 0.35, 5, 0x8a6b45); beam.position.z = 1.2; this.arm.add(beam);
    const bucket = box(0.9, 0.4, 0.9, 0x4a3322); bucket.position.set(0, 0.2, 3.5); this.arm.add(bucket);
    this.arm.rotation.x = -0.35;
    this.catapult.add(this.arm);
    const attFlag = makeBanner(PLAYERS[this.att].color, 3); attFlag.position.set(1.6, 0.8, 2); this.catapult.add(attFlag);
    this.catapult.position.set(0, 0, CAT_Z);
    this.scene.add(this.catapult);

    this.rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7), mat(0x777066));
    this.rock.castShadow = true; this.rock.visible = false; this.scene.add(this.rock);
    this.dust = [];

    this.applyWallVisuals();
    this.renderHud(mini.finale ? 'Siege of the Keep!' : 'Siege!', 'Attacker: aim and fire. Defender: repair the walls.');
    this.ctx.audio.fanfare();
    this.sendCue();
  }

  sendCue(extra = {}) {
    this.ctx.cue({ walls: this.walls, max: this.max, shots: this.shots, timeLeft: Math.max(0, Math.round((SIEGE_MS - this.elapsed) / 1000)), names: SECTION_NAMES, ...extra });
  }

  renderHud(msg, sub = '') {
    const names = [this.att, this.def].map((s) => this.ctx.state.players[s].name);
    const bars = this.walls.map((w, i) => `<div class="wall-bar"><div class="fill" style="width:${(100 * w) / this.max}%"></div><span>${SECTION_NAMES[i]}</span></div>`).join('');
    this.hud.innerHTML = `
      <div class="mini-title">${this.mini.finale ? 'Siege of the Keep' : 'Catapult Siege'}</div>
      <div class="score-row"><span style="color:${PLAYERS[this.att].color}">${names[0]} attacks · ${this.shots} shots</span>
      <span class="pass">${Math.max(0, Math.ceil((SIEGE_MS - this.elapsed) / 1000))}s</span>
      <span style="color:${PLAYERS[this.def].color}">${names[1]} defends</span></div>
      <div class="wall-bars">${bars}</div>
      <div class="mini-msg">${msg}</div><div class="mini-sub">${sub}</div>`;
    this.lastMsg = [msg, sub];
  }
  get hud() { return this.ctx.hud; }

  onInput(slot, data) {
    if (this.phase !== 'live') return;
    if (slot === this.att) {
      if (typeof data.aim === 'number') this.aim = Math.max(-40, Math.min(40, data.aim));
      if (typeof data.power === 'number') this.power = Math.max(0, Math.min(100, data.power));
      if (data.fire) this.fire();
    } else if (slot === this.def && typeof data.repair === 'number') {
      const i = data.repair | 0;
      if (this.elapsed - this.lastRepair < REPAIR_COOLDOWN || !(i >= 0 && i < 4)) return;
      if (this.walls[i] <= 0) return; // a breach cannot be patched
      this.lastRepair = this.elapsed;
      this.walls[i] = Math.min(this.max, this.walls[i] + REPAIR_AMOUNT);
      this.applyWallVisuals();
      this.ctx.audio.hammer();
      this.renderHud(`${SECTION_NAMES[i]} reinforced!`);
      this.sendCue({ repaired: i, cooldown: REPAIR_COOLDOWN });
    }
  }

  fire() {
    if (this.flying || this.shots <= 0) return;
    this.shots -= 1;
    const wobble = (Math.random() - 0.5) * 3; // a little unpredictability per shot
    const v = 12 + (this.power + wobble) * 0.1;
    const ang = (this.aim * Math.PI) / 180;
    const vh = v * Math.cos(Math.PI / 4);
    this.flying = {
      pos: new THREE.Vector3(0, 3.5, CAT_Z - 2),
      vel: new THREE.Vector3(Math.sin(ang) * vh, v * Math.sin(Math.PI / 4), -Math.cos(ang) * vh),
      t: 0,
    };
    this.armSwing = 0;
    this.rock.visible = true;
    this.ctx.audio.whoosh();
    this.sendCue();
  }

  impact(p) {
    let msg = '', sub = '';
    if (p.z <= 0.5 && p.y > 0 && p.y <= WALL_H + 0.5 && Math.abs(p.x) < 20) {
      const i = Math.min(3, Math.max(0, Math.floor((p.x + 20) / SECTION_W)));
      this.walls[i] = Math.max(0, this.walls[i] - DIRECT);
      if (i > 0) this.walls[i - 1] = Math.max(0, this.walls[i - 1] - SPLASH);
      if (i < 3) this.walls[i + 1] = Math.max(0, this.walls[i + 1] - SPLASH);
      msg = `Direct hit on the ${SECTION_NAMES[i].toLowerCase()}!`;
      this.ctx.audio.boom();
      this.spawnDust(p, 0x9a9488);
    } else if (p.z > 0) {
      msg = 'Short!'; sub = 'More power.';
      this.ctx.audio.thud();
      this.spawnDust(p, 0x6b5b3b);
    } else if (Math.abs(p.x) >= 20) {
      msg = 'Wide!'; sub = 'Adjust your aim.';
      this.ctx.audio.thud();
    } else {
      msg = 'Over the walls!'; sub = 'Less power.';
      this.ctx.audio.thud();
    }
    this.applyWallVisuals();
    this.renderHud(msg, sub);
    this.sendCue({ hit: msg });
  }

  spawnDust(p, color) {
    for (let k = 0; k < 10; k++) {
      const d = box(0.6, 0.6, 0.6, color);
      d.position.copy(p);
      d.userData.v = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 7, (Math.random() - 0.2) * 6);
      d.userData.life = 1.2;
      this.scene.add(d); this.dust.push(d);
    }
  }

  applyWallVisuals() {
    this.walls.forEach((w, i) => {
      const s = this.sectionMeshes[i];
      const f = w / this.max;
      const h = w <= 0 ? 0.12 : 0.35 + 0.65 * f;
      s.body.scale.y = h;
      s.body.position.y = (WALL_H * h) / 2;
      s.body.material.color.setHex(f > 0.6 ? 0xa9a090 : f > 0.3 ? 0x8f8676 : 0x6f675a);
      if (w <= 0 && !s.collapsed) {
        s.collapsed = true;
        if (i === 1 && this.gate) this.gate.visible = false;
        for (let k = 0; k < 14; k++) {
          const r = box(1 + Math.random(), 0.8, 1 + Math.random(), 0x8f8676);
          r.position.set(s.group.position.x + (Math.random() - 0.5) * 8, 0.4, (Math.random() - 0.3) * 4);
          r.rotation.y = Math.random() * 3;
          this.rubble.add(r);
        }
      }
    });
  }

  update(dt) {
    this.timer += dt * 1000;
    if (this.phase === 'intro' && this.timer > 3000) { this.phase = 'live'; this.renderHud('Fire when ready!'); this.sendCue({ live: true }); }
    if (this.phase === 'live') {
      this.elapsed += dt * 1000;
      if (Math.floor(this.elapsed / 1000) !== Math.floor((this.elapsed - dt * 1000) / 1000)) { this.renderHud(...this.lastMsg); this.sendCue(); }
    }

    // Aim the catapult
    this.catapult.rotation.y = (-this.aim * Math.PI) / 180;
    if (this.armSwing !== undefined && this.armSwing < 1) {
      this.armSwing = Math.min(1, this.armSwing + dt * 5);
      this.arm.rotation.x = -0.35 + Math.sin(this.armSwing * Math.PI) * 1.6;
    }

    if (this.flying) {
      const f = this.flying;
      const steps = 4;
      for (let s = 0; s < steps && this.flying; s++) {
        const h = dt / steps;
        f.vel.y -= G * h;
        const prev = f.pos.clone();
        f.pos.addScaledVector(f.vel, h);
        f.t += h;
        if (prev.z > 0 && f.pos.z <= 0) {
          // Crossing the wall plane: interpolate the crossing point.
          const k = prev.z / (prev.z - f.pos.z);
          const cross = prev.clone().lerp(f.pos, k);
          if (cross.y > 0 && cross.y <= WALL_H + 0.5 && Math.abs(cross.x) < 20) { this.impact(cross); this.flying = null; break; }
        }
        if (f.pos.y <= 0) { this.impact(f.pos.clone().setY(0.3)); this.flying = null; break; }
      }
      if (this.flying) { this.rock.position.copy(f.pos); this.rock.rotation.x += dt * 6; } else this.rock.visible = false;
    }

    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.userData.v.y -= G * dt;
      d.position.addScaledVector(d.userData.v, dt);
      d.userData.life -= dt;
      if (d.position.y < 0.3) { d.position.y = 0.3; d.userData.v.multiplyScalar(0.5); }
      if (d.userData.life <= 0) { this.scene.remove(d); disposeTree(d); this.dust.splice(i, 1); }
    }

    // Camera: follow the rock in flight, otherwise sit behind the catapult
    const target = this.flying ? new THREE.Vector3(this.flying.pos.x * 0.5, 9 + this.flying.pos.y * 0.3, this.flying.pos.z + 20) : new THREE.Vector3(0, 9, 44);
    this.camera.position.lerp(target, Math.min(1, dt * 2.5));
    this.camera.lookAt(0, 4, 0);

    // End conditions
    if (this.phase === 'live' && !this.flying) {
      const breached = this.walls.some((w) => w <= 0);
      const outOfShots = this.shots <= 0;
      const outOfTime = this.elapsed >= SIEGE_MS;
      if (breached || outOfShots || outOfTime) {
        this.phase = 'done'; this.timer = 0; this.breached = breached;
        const attName = this.ctx.state.players[this.att].name, defName = this.ctx.state.players[this.def].name;
        this.renderHud(breached ? 'The walls are breached!' : `${defName}'s walls hold!`,
          breached ? `${attName}'s army storms the gap…` : `${attName} withdraws.`);
        this.sendCue({ done: true, breached });
        if (breached) this.ctx.audio.fanfare();
      }
    }
    if (this.phase === 'done' && this.timer > 3200 && !this.sent) {
      this.sent = true;
      this.ctx.finish({ breached: this.breached, walls: this.walls });
    }
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose() { disposeTree(this.scene); }
}
