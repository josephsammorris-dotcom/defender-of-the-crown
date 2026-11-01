"""Renders each mini-game scene in isolation with a fake context and scripted inputs, saving screenshots.
Usage: python3 test/scenes.py [outdir]  (needs `wrangler dev` running)"""
import sys, os, time, re, json
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8787'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HARNESS = """<!doctype html><html><head><link rel="stylesheet" href="/css/tv.css">
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" } }</script></head>
<body><canvas id="view"></canvas><div id="miniHud"></div>
<script type="module">
import * as THREE from 'three';
import { JoustScene } from '/js/scenes/joust.js';
import { SiegeScene } from '/js/scenes/siege.js';
import { DuelScene } from '/js/scenes/duel.js';
const SCENES = { joust: JoustScene, siege: SiegeScene, duel: DuelScene };
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('view'), antialias: true });
renderer.setSize(1280, 720, false); renderer.shadowMap.enabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace;
const noop = () => {};
const audio = new Proxy({}, { get: () => noop });
window.cues = []; window.results = [];
const state = { players: [{ name: 'Alice' }, { name: 'Bob' }] };
window.startScene = (mini) => {
  window.scene?.dispose();
  window.scene = new SCENES[mini.kind](mini, { state, hud: document.getElementById('miniHud'), audio,
    cue: (d) => window.cues.push(d), finish: (r) => window.results.push(r) });
  window.scene.resize(1280, 720);
};
// Deterministic stepping so the test controls time.
window.step = async (secs) => { const n = Math.round(secs * 60); for (let i = 0; i < n; i++) window.scene.update(1 / 60); renderer.render(window.scene.scene, window.scene.camera); await new Promise((r) => requestAnimationFrame(() => r())); };
window.ready = true;
</script></body></html>"""

def route(ctx):
    def handle(r):
        if r.request.url.endswith('three.module.js'):
            return r.fulfill(path=os.path.join(ROOT, 'node_modules/three/build/three.module.js'), content_type='application/javascript')
        return r.abort()
    ctx.route(re.compile(r'https://(cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com)/.*'), handle)
    ctx.route(BASE + '/__harness', lambda r: r.fulfill(body=HARNESS, content_type='text/html'))

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    route(ctx)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.goto(BASE + '/__harness')
    pg.wait_for_function('window.ready')
    shot = lambda name: pg.screenshot(path=f'{OUT}/{name}.png')

    # --- Joust: Alice releases perfectly, Bob too early ---
    pg.evaluate("startScene({ id: 1, kind: 'joust', players: [0, 1] })")
    pg.evaluate('step(3.6)')            # intro -> countdown
    pg.evaluate('step(2.3)')            # countdown -> charge
    pg.evaluate("scene.onInput(0, { pass: 1, release: 2850 }); scene.onInput(1, { pass: 1, release: 1500 })")
    pg.evaluate('step(1.6)'); shot('j1-charge')
    pg.evaluate('step(2.0)'); shot('j2-impact')
    for passno in (2, 3):
        pg.evaluate("(async () => { let n = 0; while (scene.phase !== 'charge' && n++ < 300) await step(4/60); })()")
        if pg.evaluate('scene.phase') != 'charge': break
        pg.evaluate(f"scene.onInput(0, {{ pass: {passno}, release: 2900 }}); scene.onInput(1, {{ pass: {passno}, release: 2300 }})")
        pg.evaluate('step(3.6)')
    pg.evaluate('step(7)')
    print('joust wins', pg.evaluate('scene.wins'), 'pass', pg.evaluate('scene.pass'))
    print('joust result', pg.evaluate('results'))

    # --- Siege: aim at gatehouse until breach ---
    pg.goto(BASE + '/__harness'); pg.wait_for_function('window.ready')  # fresh page per scene keeps headless GL happy
    pg.evaluate("results.length = 0; startScene({ id: 2, kind: 'siege', attacker: 0, defender: 1, finale: false, walls: [60,60,60,60], wallMax: 60, shots: 6 })")
    pg.evaluate('step(3.2)'); shot('s1-start')
    pg.evaluate("scene.onInput(0, { aim: -6, power: 48 }); scene.onInput(0, { fire: true })")
    pg.evaluate('step(1.0)'); shot('s2-flight')
    pg.evaluate('step(3)')
    pg.evaluate("scene.onInput(1, { repair: 1 })")
    for _ in range(4):
        pg.evaluate("scene.onInput(0, { aim: -6, power: 48, fire: true })"); pg.evaluate('step(4)')
    shot('s3-damage')
    pg.evaluate('step(4)')
    print('siege result', pg.evaluate('results'), 'last cue', json.dumps(pg.evaluate('cues.at(-1)')))

    # --- Duel on the field, then throne room ---
    for finale in (False, True):
        pg.goto(BASE + '/__harness'); pg.wait_for_function('window.ready')
        pg.evaluate(f"results.length = 0; startScene({{ id: 3, kind: 'duel', attacker: 0, defender: 1, players: [0,1], finale: {str(finale).lower()}, hp: [80, 100] }})")
        pg.evaluate('step(3.2)')
        pg.evaluate("scene.onInput(1, { act: 'guardLow' }); scene.onInput(0, { act: 'high' })")
        pg.evaluate('step(0.25)'); shot(f'd1-windup-{finale}')
        pg.evaluate('step(0.3)')
        for _ in range(14):
            pg.evaluate("scene.onInput(0, { act: 'thrust' })"); pg.evaluate('step(1.5)')
        shot(f'd2-end-{finale}')
        pg.evaluate('step(4)')
        print('duel', finale, 'result', pg.evaluate('results'))
    print('ERRORS:', errors or 'none')
    b.close()
