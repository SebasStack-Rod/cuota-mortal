import time, subprocess, json
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(['python3','-m','http.server','8765','--directory','/home/claude/work/site'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
errors=[]
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width':1200,'height':1000})
    pg.on('console', lambda m: errors.append(m.text) if m.type=='error' and 'ERR_FAILED' not in m.text else None)
    pg.on('pageerror', lambda e: errors.append('PAGEERROR: '+str(e)))
    pg.route('**/gsap.min.js', lambda r: r.fulfill(path='/home/claude/work/gsap-shim.js', content_type='application/javascript'))
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    pg.goto('http://localhost:8765/dev/sandbox.html?game=slots&seed=2'); pg.wait_for_timeout(1500)
    st = lambda: json.loads(pg.evaluate('JSON.stringify(__sandbox.getGame("p_ana").getPublicState())'))
    pg.screenshot(path='/home/claude/work/sl1_idle.png')
    pg.fill('#sb-fv','13,13,13'); pg.click('#sb-fb')
    pg.click('.slt-go', force=True); pg.wait_for_timeout(1000)
    pg.screenshot(path='/home/claude/work/sl2_spinning.png')
    pg.wait_for_timeout(1500)
    s=st(); print('fase', s['phase'], s['reels'], s['prev'])
    pg.screenshot(path='/home/claude/work/sl3_stopping.png')
    pg.wait_for_timeout(900)
    s=st(); print('fase', s['phase'], 'lastWin', s['lastWin'], s['lastMult'])
    pg.screenshot(path='/home/claude/work/sl4_jackpot.png')
    pg.wait_for_timeout(2500)
    pg.click('.slt-info', force=True); pg.wait_for_timeout(200); pg.screenshot(path='/home/claude/work/sl5_pay.png'); pg.click('.slt-pay', force=True)
    print('sonidos:', pg.inner_text('#sb-sounds').replace('\n',' | '))
    # monto libre y límite
    pg.click('.amt-btn', force=True); pg.fill('.amt-input','500'); pg.press('.amt-input','Tab'); pg.click('.amt-chip', force=True)
    pg.click('.amt-btn', force=True); pg.fill('.amt-input','999'); pg.press('.amt-input','Tab'); print('boton monto', pg.inner_text('.amt-btn')); pg.click('.amt-chip', force=True)
    # pantalla chica + calidad baja + entrar a mitad
    pg.select_option('#sb-size','360,640'); pg.select_option('#sb-quality','baja'); pg.wait_for_timeout(600)
    pg.fill('#sb-fv','0,0,0'); pg.click('#sb-fb'); pg.click('.slt-go', force=True); pg.wait_for_timeout(1700)
    pg.click('#sb-remount'); pg.wait_for_timeout(500); pg.screenshot(path='/home/claude/work/sl6_late_small.png')
    pg.wait_for_timeout(2500); s=st(); print('cerezas:', s['phase'], s['lastWin'], s['lastMult'])
    # levantarse girando
    pg.fill('#sb-fv','5,5,5'); pg.click('#sb-fb'); pg.click('.slt-go', force=True); pg.wait_for_timeout(300)
    pg.click('text=Se levanta Ana'); pg.wait_for_timeout(300); print('log:', pg.inner_text('#sb-log').split('\n')[:3])
    b.close()
finally: srv.terminate()
print('\n'.join(errors) if errors else 'sin errores')
