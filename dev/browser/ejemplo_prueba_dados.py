# dev/browser/ejemplo_prueba_dados.py: prueba de la vista de los Dados con Playwright (usa el shim de GSAP, no el real).
# Hace falta una carpeta `site/` con enlaces a js/ y dev/ y una carpeta assets/ (ver sección 5.3 de INSTRUCCIONES_PARA_OTRA_IA.md).
import time, subprocess, json, sys
from playwright.sync_api import sync_playwright
SITE = '/home/claude/work/site'; SHOTS = '/home/claude/work/shots'
srv = subprocess.Popen(['python3', '-m', 'http.server', '8765', '--directory', SITE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
errors = []
def run(size, tag):
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1300, 'height': 1000})
        pg.on('pageerror', lambda e: errors.append(tag + ' PAGEERROR: ' + str(e)))
        pg.on('console', lambda m: errors.append(tag + ' CONSOLE: ' + m.text) if m.type == 'error' and 'ERR_' not in m.text and 'Failed to load resource' not in m.text else None)
        pg.route('**/gsap.min.js', lambda r: r.fulfill(path=SITE + '/dev/browser/gsap-shim.js', content_type='application/javascript'))
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        pg.goto('http://localhost:8765/dev/sandbox.html?game=dice&seed=3'); pg.wait_for_timeout(800)
        pg.select_option('#sb-size', size); pg.wait_for_timeout(500)
        st = lambda: json.loads(pg.evaluate('JSON.stringify(__sandbox.getGame("x").getPublicState())'))
        sc = lambda n: pg.locator('#sb-phone').screenshot(path=f'{SHOTS}/{tag}_{n}.png')
        pg.fill('#sb-fv', '3,4'); pg.click('#sb-fb')
        pg.click('.dic-zone--seven'); pg.wait_for_timeout(200)
        pg.evaluate('__sandbox.setActive(1)'); pg.wait_for_timeout(200); pg.click('.dic-zone--under'); pg.click('.dic-zone--under'); pg.wait_for_timeout(200)
        pg.evaluate('__sandbox.setActive(2)'); pg.wait_for_timeout(200); pg.click('.dic-zone--over'); pg.wait_for_timeout(200)
        pg.evaluate('__sandbox.setActive(0)'); pg.wait_for_timeout(300)
        s = st(); print(tag, 'betting:', s['phase'], s['bets'])
        sc('1_apuestas')
        pg.click('.dic-zone--seven'); pg.wait_for_timeout(200)
        print(tag, 'undo habilitado:', not pg.is_disabled('.dic-undo')); pg.click('.dic-undo'); pg.wait_for_timeout(200)
        print(tag, 'tras undo:', st()['bets'].get('p_ana'))
        pg.evaluate('__sandbox.setOffset(12500)'); pg.wait_for_timeout(1000)
        s = st(); print(tag, 'rolling:', s['phase'], s['dice']); sc('2_rodando_1s')
        pg.wait_for_timeout(900); sc('3_rodando_2s')
        pg.wait_for_timeout(1500); s = st(); print(tag, 'result:', s['phase'], s['payouts']); sc('4_resultado')
        print(tag, 'centro:', pg.inner_text('.dic-big'), '|', pg.inner_text('.dic-sub'), '|', pg.inner_text('.dic-me'))
        print(tag, 'filas:', pg.inner_text('.dic-players').replace('\n', ' / '))
        print(tag, 'zona ganadora:', pg.eval_on_selector_all('.dic-zone.is-win', 'els=>els.map(e=>e.dataset.spot)'))
        b.close()
try:
    run('390,844', 'm390'); run('360,640', 'm360')
    # reroll
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1300, 'height': 1000})
        pg.on('pageerror', lambda e: errors.append('reroll PAGEERROR: ' + str(e)))
        pg.route('**/gsap.min.js', lambda r: r.fulfill(path=SITE + '/dev/browser/gsap-shim.js', content_type='application/javascript'))
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        pg.goto('http://localhost:8765/dev/sandbox.html?game=dice&seed=11'); pg.wait_for_timeout(800)
        st = lambda: json.loads(pg.evaluate('JSON.stringify(__sandbox.getGame("x").getPublicState())'))
        pg.fill('#sb-fv', '1,1'); pg.click('#sb-fb'); pg.click('.dic-zone--over'); pg.wait_for_timeout(200)
        pg.evaluate('__sandbox.setActive(1)'); pg.wait_for_timeout(200); pg.click('.dic-zone--under'); pg.evaluate('__sandbox.setActive(0)')
        pg.evaluate('__sandbox.setOffset(12500)'); pg.wait_for_timeout(3600)
        print('reroll: fase', st()['phase'], '| botón oculto sin dados cargados?', pg.is_hidden('.dic-reroll') is False)
        pg.click('.dic-reroll'); pg.wait_for_timeout(300); print('reroll: aviso:', pg.inner_text('.dic-notice'))
        pg.check('#sb-rerolls'); pg.wait_for_timeout(300); pg.click('.dic-reroll'); pg.wait_for_timeout(500)
        s = st(); print('reroll: estado', s['rerolls'], '| botón visible:', not pg.is_hidden('.dic-reroll'), '| dados cargados restantes:', pg.is_checked('#sb-rerolls'))
        pg.locator('#sb-phone').screenshot(path=SHOTS + '/reroll_1.png'); pg.wait_for_timeout(1700); pg.locator('#sb-phone').screenshot(path=SHOTS + '/reroll_2.png')
        print('reroll: centro', pg.inner_text('.dic-big'), pg.inner_text('.dic-me'), '| mine:', pg.inner_text('.dic-mine-sum'))
        pg.evaluate('__sandbox.setOffset(12500+3000+5200)'); pg.wait_for_timeout(500)
        print('reroll: log', pg.inner_text('#sb-log')[:300].replace('\n', ' // '))
        pg.click('#sb-remount') ; pg.wait_for_timeout(500); print('remontar ok:', st()['phase'])
        b.close()
finally:
    srv.terminate()
print(errors or 'sin errores')
