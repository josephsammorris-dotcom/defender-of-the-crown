"""Headless checks of the menu, on-device 1P/2P and phones 1P modes.
Usage: python3 test/modes.py [outdir]   (needs `wrangler dev` running on :8787)"""
import sys, os, time, re
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8787'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = {'three.module.js': 'node_modules/three/build/three.module.js', 'qrcode.js': 'node_modules/qrcode-generator/qrcode.js'}

def route_cdn(ctx):
    def handle(route):
        for name, path in LOCAL.items():
            if route.request.url.endswith(name):
                return route.fulfill(path=os.path.join(ROOT, path), content_type='application/javascript')
        return route.abort()
    ctx.route(re.compile(r'https://(cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com)/.*'), handle)

errors = []
def page(b, w=1280, h=720, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile)
    route_cdn(c)
    p = c.new_page()
    p.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    p.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))
    return p

def shot(p, name): p.screenshot(path=f'{OUT}/{name}.png', timeout=60000)
def st(p, expr): return p.evaluate(f'window.dotc.state && window.dotc.state.{expr}')

def wait_mini_done(p, timeout=120):
    t = time.time()
    while time.time() - t < timeout:
        if not p.evaluate('!!window.dotc.mini'): return True
        time.sleep(0.5)
    return False

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

    # ---------- on-device, 1 player ----------
    tv = page(b)
    tv.goto(BASE + '/')
    time.sleep(1); shot(tv, 'm1-menu')
    tv.click('[data-local="1"]'); time.sleep(0.3)
    tv.fill('#name0', 'Joe')
    tv.click('[data-diff="hard"]')
    shot(tv, 'm2-setup-1p')
    tv.click('#beginBtn')
    tv.wait_for_selector('#doneBtn')
    time.sleep(1); shot(tv, 'm3-local-recruit')
    print('1P players:', tv.evaluate("dotc.state.players.map(p => p.name + (p.ai ? ' (AI)' : '') + ' done=' + p.done)"))
    tv.click('[data-buy="knight"]')
    # Hand the human a land next to the computer so a battle starts this season.
    tv.evaluate("""(() => { const s = dotc.host.engine.state; s.territories.essex.owner = 0; s.territories.essex.army = { soldiers: 6, knights: 2, catapults: 1 }; dotc.host.emit(); })()""")
    time.sleep(0.5)
    tv.click('#doneBtn')
    tv.wait_for_selector('#marchBtn')
    tv.click('[data-from="essex"]'); tv.click('[data-to="sussex"]')
    shot(tv, 'm4-local-move')
    tv.click('#marchBtn')
    time.sleep(1.5)
    kind = tv.evaluate('dotc.mini && dotc.mini.mini.kind')
    print('1P battle:', kind, '| log:', st(tv, 'log.slice(-3)'))
    if kind:
        time.sleep(3.5); shot(tv, 'm5-local-battle')
        # Human mashes keys a bit; the computer plays itself.
        for k in ['KeyE', 'KeyQ', 'KeyD', 'KeyW', 'KeyE', 'ArrowRight', 'Space']:
            tv.keyboard.press(k); time.sleep(0.4)
        shot(tv, 'm6-local-battle2')
        print('1P battle finished:', wait_mini_done(tv), '| log:', st(tv, 'log.slice(-3)'))
    time.sleep(1); shot(tv, 'm7-after')
    print('resume available after reload:', end=' ')
    tv.reload(); time.sleep(1.5)
    print(tv.evaluate("!document.getElementById('continueBtn').classList.contains('hidden')"))
    tv.context.close()

    # ---------- on-device, 2 players ----------
    tv = page(b)
    tv.goto(BASE + '/')
    tv.click('[data-local="2"]'); time.sleep(0.3)
    tv.fill('#name0', 'Alice'); tv.fill('#name1', 'Bob')
    shot(tv, 'm8-setup-2p')
    tv.click('#beginBtn')
    tv.wait_for_selector('#doneBtn')
    print('2P panel for:', tv.inner_text('#panelName'))
    tv.click('#doneBtn'); time.sleep(0.5)
    print('pass screen shown:', tv.is_visible('#pass'), tv.inner_text('#passName'))
    shot(tv, 'm9-pass')
    tv.click('#passBtn'); time.sleep(0.3)
    print('panel now for:', tv.inner_text('#panelName'))
    # Force a head-on clash to get a joust between two humans on one screen.
    tv.evaluate("""(() => { const s = dotc.host.engine.state; s.territories.mercia.owner = 0; s.territories.mercia.army = { soldiers: 4, knights: 1, catapults: 0 };
       s.territories.essex.owner = 1; s.territories.essex.army = { soldiers: 4, knights: 1, catapults: 0 }; dotc.host.emit(); })()""")
    time.sleep(0.3)
    tv.click('#doneBtn'); time.sleep(0.5)
    print('move phase panel for:', tv.inner_text('#panelName'), '| pass shown:', tv.is_visible('#pass'))
    who = tv.evaluate('dotc.host.engine.state.players.findIndex(p => p.move === null)')
    def march(frm, to):
        tv.click(f'[data-from="{frm}"]'); tv.click(f'[data-to="{to}"]'); tv.click('#marchBtn'); time.sleep(0.4)
    first = tv.inner_text('#panelName')
    march('essex' if 'Bob' in first else 'mercia', 'mercia' if 'Bob' in first else 'essex')
    if tv.is_visible('#pass'): tv.click('#passBtn'); time.sleep(0.3)
    second = tv.inner_text('#panelName')
    march('essex' if 'Bob' in second else 'mercia', 'mercia' if 'Bob' in second else 'essex')
    time.sleep(4.5)
    print('2P battle:', tv.evaluate('dotc.mini && dotc.mini.mini.kind'))
    time.sleep(2)
    tv.keyboard.down('KeyE'); tv.keyboard.down('KeyU')
    shot(tv, 'm10-joust-2p')
    t0 = time.time()
    while tv.evaluate("dotc.mini && dotc.mini.phase") not in ('charge', None) and time.time() - t0 < 20: time.sleep(0.1)
    time.sleep(2.7); tv.keyboard.up('KeyE')
    time.sleep(0.15); tv.keyboard.up('KeyU')
    time.sleep(1.5)
    print('joust after pass 1:', tv.evaluate('dotc.mini && dotc.mini.wins'), 'releases (scene ms):', tv.evaluate('dotc.mini && dotc.mini.releases'), tv.inner_text('#miniHud .mini-sub'))
    tv.context.close()

    # ---------- phones, 1 player ----------
    tv = page(b)
    tv.goto(BASE + '/')
    tv.click('[data-phones="1"]')
    tv.wait_for_selector('#roomCode')
    time.sleep(1.5)
    room = tv.inner_text('#roomCode')
    ph = page(b, 390, 844, True)
    ph.goto(f'{BASE}/play?room={room}')
    ph.fill('#nameIn', 'Joe'); ph.click('#joinBtn')
    ph.wait_for_selector('#readyBtn')
    time.sleep(0.5); shot(tv, 'm11-phones-lobby-1p'); shot(ph, 'm12-phone-lobby-1p')
    ph.click('#readyBtn')
    ph.wait_for_selector('#doneBtn')
    print('phones 1P started, players:', tv.evaluate("dotc.state.players.map(p => p.name + (p.ai ? ' (AI)' : ''))"))
    b.close()

print('ERRORS:', errors or 'none')
