"""Headless end-to-end check: one TV page + two phone pages, plays into the first season.
Serves CDN files from node_modules so it runs offline. Usage: python3 test/browser.py [outdir]"""
import sys, os, time, re
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8787'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = {
    'three.module.js': os.path.join(ROOT, 'node_modules/three/build/three.module.js'),
    'qrcode.js': os.path.join(ROOT, 'node_modules/qrcode-generator/qrcode.js'),
}

def route_cdn(ctx):
    def handle(route):
        url = route.request.url
        for name, path in LOCAL.items():
            if url.endswith(name):
                return route.fulfill(path=path, content_type='application/javascript')
        return route.abort()
    ctx.route(re.compile(r'https://(cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com)/.*'), handle)

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    tvc = b.new_context(viewport={'width': 1280, 'height': 720})
    route_cdn(tvc)
    tv = tvc.new_page()
    tv.on('console', lambda m: m.type == 'error' and errors.append('TV: ' + m.text))
    tv.on('pageerror', lambda e: errors.append('TV pageerror: ' + str(e)))
    tv.goto(BASE + '/')
    tv.click('[data-phones="2"]')
    tv.wait_for_function("location.search.includes('room=')")
    room = tv.evaluate("new URLSearchParams(location.search).get('room')")
    time.sleep(1)
    tv.screenshot(path=f'{OUT}/01-lobby.png')

    phones = []
    for name in ['Alice', 'Bob']:
        c = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        route_cdn(c)
        ph = c.new_page()
        ph.on('pageerror', lambda e, n=name: errors.append(f'{n} pageerror: {e}'))
        ph.goto(f'{BASE}/play?room={room}')
        ph.fill('#nameIn', name)
        ph.click('#joinBtn')
        phones.append(ph)
    for ph in phones:
        ph.wait_for_selector('#readyBtn')
    phones[0].screenshot(path=f'{OUT}/02-phone-lobby.png')
    for ph in phones:
        ph.click('#readyBtn')
    phones[0].wait_for_selector('#doneBtn')
    time.sleep(1.5)
    tv.screenshot(path=f'{OUT}/03-map.png')
    phones[0].click('[data-buy="soldier"]'); time.sleep(0.3)
    phones[0].screenshot(path=f'{OUT}/04-phone-recruit.png')
    for ph in phones:
        ph.click('#doneBtn')
    for ph in phones:
        ph.wait_for_selector('#marchBtn')
    phones[0].screenshot(path=f'{OUT}/05-phone-move.png')

    # Alice: York -> Lancaster (unclaimed). Bob: Sussex -> Essex (unclaimed). Then season 2: head-on to force a joust.
    def march(ph, frm, to):
        ph.click(f'[data-from="{frm}"]'); ph.click(f'[data-to="{to}"]'); ph.click('#marchBtn')

    st = tv.evaluate('window.dotc.state')
    a_slot = [p['name'] for p in st['players']].index('Alice')
    alice, bob = (phones[0], phones[1]) if a_slot == 0 else (phones[1], phones[0])
    a_home = 'york' if a_slot == 0 else 'sussex'
    a_to = 'lancaster' if a_slot == 0 else 'essex'
    b_home = 'sussex' if a_slot == 0 else 'york'
    b_to = 'essex' if a_slot == 0 else 'lancaster'
    march(alice, a_home, a_to)
    march(bob, b_home, b_to)
    time.sleep(2)
    tv.screenshot(path=f'{OUT}/06-after-season1.png')
    print('season', tv.evaluate('window.dotc.state.season'), 'log', tv.evaluate('window.dotc.state.log.slice(-4)'))
    print('ERRORS:', errors or 'none')
    b.close()
