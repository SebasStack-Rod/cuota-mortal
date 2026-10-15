import time, subprocess, json
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(['python3','-m','http.server','8765','--directory','/home/claude/work/site'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
errors=[]
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width':1200,'height':1000})
    pg.on('console', lambda m: errors.append(m.text) if m.type=='error' and 'ERR_FAILED' not in m.text else None)
    pg.on('response', lambda r: errors.append('404 '+r.url) if r.status==404 else None); pg.on('pageerror', lambda e: errors.append('PAGEERROR: '+str(e)))
    pg.route('**/gsap.min.js', lambda r: r.fulfill(path='/home/claude/work/gsap-shim.js', content_type='application/javascript'))
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    pg.goto('http://localhost:8765/dev/sandbox.html?game=scratch&seed=3'); pg.wait_for_timeout(1500)
    st = lambda: json.loads(pg.evaluate('JSON.stringify(__sandbox.getGame("p_ana").getPublicState())'))
    pg.screenshot(path='/home/claude/work/sc1_idle.png')
    pg.fill('#sb-fv','4'); pg.click('#sb-fb')
    pg.click('.scr-t-plata', force=True); pg.click('.scr-buy', force=True); pg.wait_for_timeout(400)
    s=st(); print('fase', s['phase'], s['tier'], 'cells', s['cells'])
    # rascar con el mouse la celda 0 y 1 (fila de arriba)
    box = pg.locator('.scr-cv').bounding_box(); S=box['width']; g=S*0.03; c=(S-2*g)/3
    def cx(i): return box['x']+(i%3)*(c+g)+c/2, box['y']+(i//3)*(c+g)+c/2
    x,y = cx(0); pg.mouse.move(x-c*.4,y-c*.4); pg.mouse.down()
    for k in range(10):
        pg.mouse.move(x-c*.4, y-c*.4+k*c*.09, steps=3); pg.mouse.move(x+c*.4, y-c*.4+k*c*.09, steps=3)
    pg.wait_for_timeout(120); pg.screenshot(path='/home/claude/work/sc2_scratching.png'); pg.mouse.up(); pg.wait_for_timeout(500)
    s=st(); print('tras rascar celda 0: abiertas', s['revealed'], 'visibles', [i for i,v in enumerate(s['cells']) if v is not None])
    pg.screenshot(path='/home/claude/work/sc3_cell0.png')
    pg.click('.scr-all', force=True); pg.wait_for_timeout(1800)
    s=st(); print('tras rascar todo:', s['phase'], s['prize'], s['mult'], s['winCells'])
    pg.screenshot(path='/home/claude/work/sc4_win.png')
    print('mensaje:', pg.inner_text('.scr-msg'), '| sonidos:', pg.inner_text('#sb-sounds').replace('\n',' | '))
    # perdedor en pantalla chica, calidad baja
    pg.select_option('#sb-size','360,640'); pg.select_option('#sb-quality','baja'); pg.wait_for_timeout(600)
    pg.fill('#sb-fv','lose'); pg.click('#sb-fb'); pg.click('.scr-t-oro', force=True); pg.click('.scr-buy', force=True); pg.wait_for_timeout(300)
    pg.click('#sb-remount'); pg.wait_for_timeout(500); pg.screenshot(path='/home/claude/work/sc5_small_scratching.png')
    print('entrar a mitad:', st()['phase'])
    pg.click('.scr-all', force=True); pg.wait_for_timeout(1600); pg.screenshot(path='/home/claude/work/sc6_lose.png')
    print('mensaje:', pg.inner_text('.scr-msg'))
    # remontar ya terminado, sin fondos y levantarse
    pg.click('#sb-remount'); pg.wait_for_timeout(500); pg.screenshot(path='/home/claude/work/sc7_late_done.png')
    pg.evaluate('__sandbox.setBank(1000)'); pg.click('.scr-buy', force=True); pg.wait_for_timeout(600); print('aviso:', pg.inner_text('.scr-notice'))
    pg.evaluate('__sandbox.setBank(200000)'); pg.fill('#sb-fv','5'); pg.click('#sb-fb'); pg.click('.scr-buy', force=True); pg.wait_for_timeout(300)
    pg.click('text=Se levanta Ana'); pg.wait_for_timeout(600); print('levantarse:', st()['phase'], st()['prize'], '|', pg.inner_text('#sb-log').split('\n')[:2])
    b.close()
finally: srv.terminate()
print('\n'.join(errors) if errors else 'sin errores')
