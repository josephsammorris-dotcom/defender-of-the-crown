import * as THREE from 'three';

export const mat = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });

export function box(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function cyl(rt, rb, h, color, seg = 6) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function cone(r, h, color, seg = 6) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color));
  m.castShadow = true;
  return m;
}

export function addLights(scene, { sky = 0xbfd8ff, ground = 0x445533, sun = 0xfff1d6, shadowSize = 30 } = {}) {
  scene.add(new THREE.HemisphereLight(sky, ground, 1.1));
  const dir = new THREE.DirectionalLight(sun, 1.6);
  dir.position.set(10, 20, 8);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  const c = dir.shadow.camera;
  c.left = -shadowSize; c.right = shadowSize; c.top = shadowSize; c.bottom = -shadowSize; c.far = 80;
  scene.add(dir);
  return dir;
}

// Canvas-texture sprite used for map labels and floating text.
export function textSprite(lines, { scale = 1, bg = 'rgba(20,14,8,0.78)', color = '#f4e6c4', border = null, font = 'Cinzel' } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const px = 44;
  ctx.font = `700 ${px}px ${font}, Georgia, serif`;
  const widths = lines.map((l) => ctx.measureText(l.text ?? l).width);
  const w = Math.ceil(Math.max(...widths) + 40), h = Math.ceil(lines.length * px * 1.2 + 24);
  canvas.width = w; canvas.height = h;
  ctx.font = `700 ${px}px ${font}, Georgia, serif`;
  if (bg) {
    ctx.fillStyle = bg;
    roundRect(ctx, 2, 2, w - 4, h - 4, 16); ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 5; ctx.stroke(); }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.fillStyle = l.color || color;
    ctx.fillText(l.text ?? l, w / 2, 12 + px * 0.6 + i * px * 1.2);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.renderOrder = 10;
  sprite.scale.set((w / h) * scale, scale, 1);
  return sprite;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => { mm.map?.dispose(); mm.dispose(); });
  });
}

// Low-poly knight. Returns { group, rider, swordArm, lance, horse, legs } for animation.
export function makeKnight(color, { mounted = false, lance = false } = {}) {
  const group = new THREE.Group();
  const steel = 0xb8bcc4, dark = 0x3a3a40;
  const rider = new THREE.Group();
  let horse = null; const legs = [];

  if (mounted) {
    horse = new THREE.Group();
    const body = box(2.4, 1.0, 0.9, 0x6b4a2f); body.position.y = 1.6; horse.add(body);
    const cloth = box(2.5, 0.7, 1.0, color); cloth.position.y = 1.35; horse.add(cloth);
    const neck = box(0.5, 1.0, 0.5, 0x6b4a2f); neck.position.set(1.25, 2.2, 0); neck.rotation.z = -0.5; horse.add(neck);
    const head = box(0.9, 0.45, 0.45, 0x6b4a2f); head.position.set(1.7, 2.6, 0); horse.add(head);
    for (const [x, z] of [[0.9, 0.3], [0.9, -0.3], [-0.9, 0.3], [-0.9, -0.3]]) {
      const leg = new THREE.Group();
      const l = box(0.22, 1.2, 0.22, 0x4a3322); l.position.y = -0.6; leg.add(l);
      leg.position.set(x, 1.2, z); horse.add(leg); legs.push(leg);
    }
    group.add(horse);
    rider.position.set(-0.1, 2.1, 0);
  }

  const torso = box(0.7, 0.9, 0.5, color); torso.position.y = 0.95; rider.add(torso);
  const chain = box(0.72, 0.3, 0.52, steel); chain.position.y = 0.45; rider.add(chain);
  const helm = cyl(0.26, 0.3, 0.5, steel, 8); helm.position.y = 1.65; rider.add(helm);
  const visor = box(0.05, 0.08, 0.36, dark); visor.position.set(0.28, 1.68, 0); rider.add(visor);
  const plume = cone(0.1, 0.4, color); plume.position.y = 2.05; rider.add(plume);
  if (!mounted) {
    for (const z of [0.14, -0.14]) { const l = box(0.22, 0.8, 0.22, steel); l.position.set(0, 0.0, z); rider.add(l); }
    rider.position.y = 0.4;
  }
  const shield = box(0.1, 0.7, 0.55, color); shield.position.set(0.15, 1.0, -0.42); rider.add(shield);
  const boss = box(0.12, 0.25, 0.25, 0xd4af37); boss.position.set(0.17, 1.0, -0.42); rider.add(boss);

  // Sword arm pivots at the shoulder.
  const swordArm = new THREE.Group(); swordArm.position.set(0, 1.25, 0.38);
  const arm = box(0.2, 0.6, 0.2, steel); arm.position.y = -0.25; swordArm.add(arm);
  let lanceMesh = null;
  if (lance) {
    lanceMesh = new THREE.Group();
    const shaft = cyl(0.06, 0.12, 5, 0xe8dcc0, 6); shaft.rotation.z = Math.PI / 2; shaft.position.x = 2.2; lanceMesh.add(shaft);
    const stripe = cyl(0.13, 0.13, 0.5, color, 6); stripe.rotation.z = Math.PI / 2; stripe.position.x = 0.4; lanceMesh.add(stripe);
    lanceMesh.position.y = -0.5;
    swordArm.add(lanceMesh);
  } else {
    const blade = box(0.08, 1.3, 0.14, 0xdfe4ea); blade.position.y = -1.15; swordArm.add(blade);
    const guard = box(0.1, 0.08, 0.4, 0xd4af37); guard.position.y = -0.5; swordArm.add(guard);
  }
  rider.add(swordArm);
  group.add(rider);
  return { group, rider, swordArm, lance: lanceMesh, horse, legs, torso };
}

export function makeBanner(color, h = 1.2) {
  const g = new THREE.Group();
  const pole = cyl(0.03, 0.03, h, 0x5a4630, 5); pole.position.y = h / 2; g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
  flag.position.set(0.26, h - 0.18, 0); g.add(flag);
  g.userData.flag = flag;
  return g;
}

export function makeTower(r, h, stone = 0xa59f92, roof = 0x7a3b2e) {
  const g = new THREE.Group();
  const t = cyl(r, r * 1.08, h, stone, 8); t.position.y = h / 2; g.add(t);
  const top = cyl(r * 1.18, r * 1.18, h * 0.12, stone, 8); top.position.y = h; g.add(top);
  const c = cone(r * 1.25, h * 0.55, roof, 8); c.position.y = h + h * 0.33; g.add(c);
  return g;
}
