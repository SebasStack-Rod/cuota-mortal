# dev/browser/ejemplo_prueba_blackjack.py: prueba de la vista del Blackjack con Playwright (shim de GSAP; cartas de relleno).
import time, subprocess, json
from playwright.sync_api import sync_playwright
SITE = '/home/claude/work/site'; SHOTS = '/home/claude/work/shots'
srv = subprocess.Popen(['python3', '-m', 'http.server', '8766', '--directory', SITE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
errors = []
def page(b, seed):
    pg = b.new_page(viewport={'width': 1300, 'height': 1000})
    pg.on('pageerror', lambda e: errors.append('PAGEERROR: ' + str(e)))
    pg.on('console', lambda m: errors.append('CONSOLE: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
    pg.route('**/gsap.min.js', lambda r: r.fulfill(path=SITE + '/dev/browser/gsap-shim.js', content_type='application/javascript'))
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    pg.goto(f'http://localhost:8766/dev/sandbox.html?game=blackjack&seed={seed}'); pg.wait_for_timeout(900)
    return pg
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for size, tag in (('390,844', 'bj390'), ('360,640', 'bj360')):
            pg = page(b, 3); pg.select_option('#sb-size', size); pg.wait_for_timeout(500)
            st = lambda: json.loads(pg.evaluate('JSON.stringify(__sandbox.getGame("x").getPublicState())'))
            sc = lambda n: pg.locator('#sb-phone').screenshot(path=f'{SHOTS}/{tag}_{n}.png')
            pg.fill('#sb-fv', '10Spades,8Clubs,AceSpades,10Diamonds,9Hearts,8Diamonds,KingHearts,6Clubs,3Hearts,5Spades'); pg.click('#sb-fb')
            for i in (0, 1, 2):
                pg.evaluate(f'__sandbox.setActive({i})'); pg.wait_for_timeout(150); pg.click('.bj-go'); pg.wait_for_timeout(150)
            pg.evaluate('__sandbox.setActive(0)'); pg.wait_for_timeout(200)
            print(tag, 'apuestas:', st()['bets']); sc('1_apuestas')
            pg.evaluate('__sandbox.setOffset(15500)'); pg.wait_for_timeout(750); print(tag, 'fase:', st()['phase']); sc('2_repartiendo')
            pg.wait_for_timeout(1500); s = st(); print(tag, 'fase:', s['phase'], '| banca:', s['dealer']['cards'], s['dealer']['total'], '| a:', s['hands']['p_ana']['cards'], s['hands']['p_ana']['total']); sc('3_jugando')
            print(tag, 'botones jugar visibles:', not pg.is_hidden('.bj-row--play'), '| doblar:', not pg.is_disabled('.bj-double'))
            pg.click('.bj-stand'); pg.wait_for_timeout(300)
            pg.evaluate('__sandbox.setActive(1)'); pg.wait_for_timeout(300); pg.click('.bj-hit'); pg.wait_for_timeout(500); pg.click('.bj-stand'); pg.wait_for_timeout(300)
            s = st(); print(tag, 'b tras pedir:', s['hands']['p_beto']['cards'], s['hands']['p_beto']['status'])
            pg.evaluate('__sandbox.setActive(0)'); pg.wait_for_timeout(1300); s = st(); print(tag, 'fase:', s['phase'], '| banca:', s['dealer']['cards']); sc('4_banca')
            pg.wait_for_timeout(2600); s = st(); print(tag, 'fase:', s['phase'], '| resultados:', s['results']); sc('5_resultado')
            print(tag, 'banner:', pg.inner_text('.bj-banner'), '| estado:', pg.inner_text('.bj-status'))
            pg.close()
        # doblar y quedar sin turno
        pg = page(b, 5); st = lambda: json.loads(pg.evaluate('JSON.stringify(__sandbox.getGame("x").getPublicState())'))
        pg.fill('#sb-fv', '5Spades,10Clubs,6Hearts,7Hearts,10Diamonds'); pg.click('#sb-fb'); pg.click('.bj-go'); pg.wait_for_timeout(200)
        pg.click('.bj-cancel'); pg.wait_for_timeout(200); print('doble: tras cancelar, botón apostar visible:', not pg.is_hidden('.bj-go')); pg.click('.bj-go'); pg.wait_for_timeout(200)
        pg.evaluate('__sandbox.setOffset(15500)'); pg.wait_for_timeout(2300)
        pg.click('.bj-double'); pg.wait_for_timeout(600); s = st(); print('doble:', s['hands']['p_ana']['cards'], s['hands']['p_ana']['bet'], s['hands']['p_ana']['status'])
        pg.wait_for_timeout(3500); s = st(); print('doble: fase', s['phase'], s['results'])
        pg.locator('#sb-phone').screenshot(path=SHOTS + '/bj_doble.png'); print('banner:', pg.inner_text('.bj-banner'))
        pg.click('#sb-remount'); pg.wait_for_timeout(600); print('remontar ok:', st()['phase'])
        b.close()
finally:
    srv.terminate()
print(errors or 'sin errores')
