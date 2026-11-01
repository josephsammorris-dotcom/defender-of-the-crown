import * as THREE from 'three';
import { buildHexes, TERRITORIES, PLAYERS, HEX_R, territoryById } from '../shared/map.js';
import { addLights, makeTower, makeBanner, textSprite, cone, cyl, box, disposeTree, mat } from './common.js';

const toWorld = (x, y) => new THREE.Vector3(x - 5.2, 0, -(y - 7.2));
const LAND = [new THREE.Color(0x6f9a4a), new THREE.Color(0x7fa857), new THREE.Color(0x8a9f55)];

export class MapScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d3a52);
    this.scene.fog = new THREE.Fog(0x1d3a52, 22, 40);
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    this.camera.position.set(-1.3, 17.2, 9.2);
    this.camera.lookAt(-1.3, 0, -0.6);
    addLights(this.scene, { shadowSize: 12 });

    // Sea
    const seaGeo = new THREE.PlaneGeometry(60, 60, 40, 40);
    seaGeo.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(seaGeo, new THREE.MeshLambertMaterial({ color: 0x2b5f86, flatShading: true }));
    this.sea.position.y = -0.05;
    this.sea.receiveShadow = true;
    this.scene.add(this.sea);
    this.seaBase = seaGeo.attributes.position.array.slice();

    // Hex land
    const { hexes } = buildHexes();
    this.hexes = hexes;
    const geo = new THREE.CylinderGeometry(HEX_R * 0.985, HEX_R * 0.985, 1, 6);
    geo.translate(0, 0.5, 0);
    this.hexMesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), hexes.length);
    this.hexMesh.receiveShadow = true; this.hexMesh.castShadow = true;
    const m4 = new THREE.Matrix4();
    hexes.forEach((h, i) => {
      const p = toWorld(h.x, h.y);
      m4.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, h.h, 1));
      this.hexMesh.setMatrixAt(i, m4);
      h.base = LAND[(h.i * 7 + h.j * 3) % 3];
    });
    this.scene.add(this.hexMesh);

    // Trees on a deterministic subset of hexes away from territory centres
    const trees = new THREE.Group();
    hexes.forEach((h) => {
      const t = territoryById[h.t];
      if ((h.i * 13 + h.j * 7) % 5 !== 0 || Math.hypot(t.x - h.x, t.y - h.y) < 0.7) return;
      const p = toWorld(h.x, h.y);
      const tree = cone(0.12, 0.38, 0x2f5d2a, 5);
      tree.position.set(p.x + 0.06, h.h + 0.19, p.z - 0.05);
      trees.add(tree);
    });
    this.scene.add(trees);

    // Per-territory markers
    this.markers = {};
    for (const t of TERRITORIES) {
      const g = new THREE.Group();
      const p = toWorld(t.x, t.y);
      g.position.copy(p);
      g.position.y = 0.27;
      this.scene.add(g);
      this.markers[t.id] = { group: g, type: null, owner: undefined, label: null };
    }
    this.arrows = new THREE.Group();
    this.scene.add(this.arrows);
    this.state = null;
    this.time = 0;
  }

  buildFort(type, owner) {
    const g = new THREE.Group();
    const stone = 0xb3ab9c;
    const roof = owner === null || owner === undefined ? 0x6b5b4b : new THREE.Color(PLAYERS[owner].color).getHex();
    if (type === 'keep') {
      const k = box(0.42, 0.5, 0.42, stone); k.position.y = 0.25; g.add(k);
      for (const [x, z] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]]) {
        const tw = makeTower(0.1, 0.55, stone, roof); tw.position.set(x, 0, z); g.add(tw);
      }
      const tw = makeTower(0.14, 0.8, stone, roof); g.add(tw);
    } else if (type === 'castle') {
      const w = box(0.5, 0.25, 0.5, stone); w.position.y = 0.125; g.add(w);
      for (const [x, z] of [[-0.24, -0.24], [0.24, 0.24]]) {
        const tw = makeTower(0.09, 0.45, stone, roof); tw.position.set(x, 0, z); g.add(tw);
      }
    } else {
      // Village: a couple of huts
      for (const [x, z] of [[-0.12, 0.05], [0.14, -0.06]]) {
        const hut = box(0.16, 0.12, 0.14, 0xcdb48a); hut.position.set(x, 0.06, z); g.add(hut);
        const r = cone(0.14, 0.12, 0x8a5a33, 4); r.rotation.y = Math.PI / 4; r.position.set(x, 0.18, z); g.add(r);
      }
    }
    if (owner !== null && owner !== undefined) {
      const b = makeBanner(PLAYERS[owner].color, type === 'keep' ? 1.3 : 0.9);
      b.position.set(type === 'open' ? 0 : 0.3, 0, type === 'open' ? 0.25 : 0);
      g.add(b);
      g.userData.flag = b.userData.flag;
    }
    return g;
  }

  setState(state) {
    this.state = state;
    const terrs = state.territories || {};
    // Recolour hexes by owner
    const col = new THREE.Color();
    this.hexes.forEach((h, i) => {
      const owner = terrs[h.t]?.owner;
      col.copy(h.base);
      if (owner !== null && owner !== undefined) col.lerp(new THREE.Color(PLAYERS[owner].color), 0.5);
      this.hexMesh.setColorAt(i, col);
    });
    this.hexMesh.instanceColor.needsUpdate = true;

    for (const t of TERRITORIES) {
      const info = terrs[t.id] || { owner: null, type: t.type, army: { soldiers: 0, knights: 0, catapults: 0 } };
      const mk = this.markers[t.id];
      if (mk.type !== info.type || mk.owner !== info.owner) {
        if (mk.fort) { mk.group.remove(mk.fort); disposeTree(mk.fort); }
        mk.fort = this.buildFort(info.type, info.owner);
        mk.group.add(mk.fort);
        mk.type = info.type; mk.owner = info.owner;
      }
      const a = info.army;
      const armyLine = (a.soldiers + a.knights + a.catapults) > 0 ? `⚔${a.soldiers}  ♞${a.knights}  ⛭${a.catapults}` : '';
      const key = `${t.name}|${armyLine}|${info.owner}`;
      if (mk.labelKey !== key) {
        if (mk.label) { mk.group.remove(mk.label); disposeTree(mk.label); }
        const lines = [{ text: t.name.toUpperCase() }];
        if (armyLine) lines.push({ text: armyLine, color: info.owner === null ? '#ddd' : '#fff' });
        mk.label = textSprite(lines, {
          scale: armyLine ? 0.62 : 0.34,
          border: info.owner === null || info.owner === undefined ? null : PLAYERS[info.owner].color,
        });
        mk.label.position.set(0, armyLine ? 1.15 : 0.95, 0.15);
        mk.group.add(mk.label);
        mk.labelKey = key;
      }
    }
    this.drawArrows(state);
  }

  drawArrows(state) {
    while (this.arrows.children.length) { const c = this.arrows.children.pop(); disposeTree(c); }
    if (!state.revealed || state.phase !== 'resolve') return;
    state.revealed.forEach((m, slot) => {
      if (!m || m === 'hold') return;
      const a = toWorld(territoryById[m.from].x, territoryById[m.from].y);
      const b = toWorld(territoryById[m.to].x, territoryById[m.to].y);
      const mid = a.clone().lerp(b, 0.5); mid.y = 1.2;
      a.y = 0.5; b.y = 0.5;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.06, 6), mat(PLAYERS[slot].color, { emissive: PLAYERS[slot].color, emissiveIntensity: 0.4 }));
      this.arrows.add(tube);
      const head = cone(0.16, 0.36, PLAYERS[slot].color, 8);
      const end = curve.getPoint(1), before = curve.getPoint(0.92);
      head.position.copy(end);
      head.lookAt(end.clone().add(end.clone().sub(before)));
      head.rotateX(Math.PI / 2);
      this.arrows.add(head);
    });
  }

  update(dt) {
    this.time += dt;
    const pos = this.sea.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = this.seaBase[i * 3], z = this.seaBase[i * 3 + 2];
      pos.array[i * 3 + 1] = Math.sin(x * 0.7 + this.time) * 0.06 + Math.cos(z * 0.6 + this.time * 0.8) * 0.06;
    }
    pos.needsUpdate = true;
    for (const mk of Object.values(this.markers)) {
      const flag = mk.fort?.userData.flag;
      if (flag) flag.rotation.y = Math.sin(this.time * 3 + mk.group.position.x) * 0.3;
    }
    this.arrows.children.forEach((c) => { if (c.material?.emissiveIntensity !== undefined) c.material.emissiveIntensity = 0.3 + Math.sin(this.time * 5) * 0.2; });
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose() { disposeTree(this.scene); }
}
