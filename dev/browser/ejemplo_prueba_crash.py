import time, subprocess, json
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(['python3','-m','http.server','8765','--directory','/home/claude/work/site'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
errors=[]
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width':1200,'height':1000})
    pg.on('pageerror', lambda e: errors.append('PAGEERROR: '+str(e)))
    pg.route('**/gsap.min.js', lambda r: r.fulfill(path='/home/claude/work/gsap-shim.js', content_type='application/javascript'))
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    pg.goto('http://localhost:8765/dev/sandbox.html?game=crash&seed=3'); pg.wait_for_timeout(1200)
    st = lambda: json.loads(pg.evaluate('JSON.stringify(__sandbox.getGame("x").getPublicState())'))
    pg.fill('#sb-fv','4'); pg.click('#sb-fb')
    pg.fill('.cra-auto','3'); pg.click('.cra-go'); pg.wait_for_timeout(300)           # Ana apuesta con auto 3
    pg.evaluate('__sandbox.setActive(1)'); pg.wait_for_timeout(300)
    pg.fill('.cra-auto','') ; pg.click('.cra-go'); pg.wait_for_timeout(300)          # Beto sin auto
    s=st(); print('betting:', s['phase'], list(s['bets'].keys()), [b['auto'] for b in s['bets'].values()])
    pg.evaluate('__sandbox.setOffset(9000)'); pg.wait_for_timeout(5000)
    s=st(); print('running:', s['phase'], list(s['bets'].keys()))
    s0=st(); print('antes', pg.inner_text('.cra-go'), s0['phase'], s0['startedAt']); print('now-start', pg.evaluate('Date.now()')-s0['startedAt']); pg.click('.cra-go', force=True); pg.wait_for_timeout(400); s1=st(); print('despues', s1['phase'], s1['startedAt'], s1['round'])
    print('LOG:', pg.inner_text('#sb-log')[:400]); print('go text:', pg.inner_text('.cra-go'))
    s=st(); print('tras retirar Beto:', {k:(v['cashedAt'],v['payout']) for k,v in s['bets'].items()})
    pg.evaluate('__sandbox.setOffset(9000+12000)'); pg.wait_for_timeout(1500)
    s=st(); print('fin:', s['phase'], {k:(v['cashedAt'],v['payout']) for k,v in s['bets'].items()}, s['crashedAt'])
    b.close()
finally: srv.terminate()
print(errors or 'sin errores')
