// Сквозная проверка настоящей программы (node scripts/e2e.js). Ваши файлы не трогает:
// всё происходит в папке .testdata/app (STRAZH_TEST_DIR подменяет личные папки и данные программы).
// 1) запуск «по расписанию» (--weekly) без окна; 2) окно: «Место на диске», сейф, дополнения.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const sharp = require('sharp');
const electron = require('electron');

const root = path.join(__dirname, '..');
const dir = path.join(root, '.testdata', 'app');
const shots = process.env.E2E_SHOTS || path.join(root, '.testdata', 'shots');
const env = { ...process.env, STRAZH_TEST_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
const wait = ms => new Promise(r => setTimeout(r, ms));
let okc = 0;
const t = async (name, fn) => { try { await fn(); okc++; console.log('  OK  ', name); } catch (e) { console.log('  FAIL', name, '\n      ', e.message); process.exitCode = 1; } };

async function prepare() {
  fs.rmSync(path.join(root, '.testdata'), { recursive: true, force: true });
  for (const d of ['pictures', 'videos', 'documents', 'desktop', 'downloads', 'music', 'data']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const raw = Buffer.alloc(2400 * 1600 * 3); for (let i = 0; i < raw.length; i++) raw[i] = ((i * 7 + (i >> 5) * 13) & 255) ^ ((Math.random() * 40) | 0);
  await sharp(raw, { raw: { width: 2400, height: 1600, channels: 3 } }).jpeg({ quality: 97 }).toFile(path.join(dir, 'pictures', 'IMG_20230415_101500.jpg'));
  await sharp(raw, { raw: { width: 2400, height: 1600, channels: 3 } }).png().toFile(path.join(dir, 'pictures', 'shot.png'));
  fs.writeFileSync(path.join(dir, 'data', 'settings.json'), JSON.stringify({ weekly: { enabled: true, day: 0, hour: 12, kinds: ['jpg', 'png', 'video'] } }));
}

function runHeadless() {
  return new Promise((resolve, reject) => {
    const p = spawn(electron, ['.', '--weekly'], { cwd: root, env, stdio: 'ignore' });
    const to = setTimeout(() => { p.kill(); reject(new Error('фоновая работа не завершилась за 3 минуты')); }, 180000);
    p.on('exit', code => { clearTimeout(to); resolve(code); });
  });
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.cb = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && this.cb.has(d.id)) { this.cb.get(d.id)(d); this.cb.delete(d.id); } }; }
  send(method, params = {}) { return new Promise(res => { const id = ++this.id; this.cb.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(js) { const r = await this.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception.description || r.result.exceptionDetails)); return r.result.result.value; }
  async shot(name) { fs.mkdirSync(shots, { recursive: true }); const r = await this.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(r.result.data, 'base64')); }
}
async function until(c, js, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await c.ev(js)) return true; } catch { /* страница ещё грузится */ } await wait(300); } throw new Error('не дождался: ' + js); }

(async () => {
  await prepare();
  const jpg = path.join(dir, 'pictures', 'IMG_20230415_101500.jpg'), origSize = fs.statSync(jpg).size;
  console.log('Работа по расписанию (без окна)');
  await t('запуск с --weekly делает копии и сам завершается, оригиналы целы', async () => {
    const code = await runHeadless();
    assert.strictEqual(code, 0, 'код выхода ' + code);
    assert.strictEqual(fs.statSync(jpg).size, origSize, 'оригинал изменён');
    const outFiles = fs.readdirSync(path.join(dir, 'out'), { recursive: true }).filter(f => /\.(jpg|png)$/i.test(f));
    assert(outFiles.length >= 2, 'копий: ' + outFiles.length);
    const pend = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'pending-copies.json'), 'utf8'));
    assert(pend.length >= 2, 'ждут решения: ' + pend.length);
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'settings.json'), 'utf8'));
    assert(st.weekly.lastRun && st.weekly.lastSummary.done >= 2, JSON.stringify(st.weekly));
  });
  await t('второй запуск ничего не дублирует', async () => {
    const before = fs.readdirSync(path.join(dir, 'out'), { recursive: true }).length;
    assert.strictEqual(await runHeadless(), 0);
    assert.strictEqual(fs.readdirSync(path.join(dir, 'out'), { recursive: true }).length, before, 'появились лишние файлы');
  });

  console.log('Окно программы');
  const app = spawn(electron, ['.', '--remote-debugging-port=9444'], { cwd: root, env, stdio: 'ignore' });
  try {
    let list; for (let i = 0; i < 40; i++) { try { list = await (await fetch('http://127.0.0.1:9444/json')).json(); if (list.find(x => x.type === 'page')) break; } catch { /* ждём */ } await wait(500); }
    const page = list.find(x => x.type === 'page'); const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => (ws.onopen = r)); const c = new Cdp(ws);
    await c.send('Page.enable'); await until(c, "document.querySelector('#spaceBody') !== null && typeof refreshSpaceExtras === 'function'");
    await c.ev("document.querySelector('[data-go=space]').click()");
    await until(c, "document.querySelector('#weeklyBox').innerText.includes('раз в неделю')");

    await t('«Место на диске»: баннер с готовыми копиями, порядок по папкам, расписание', async () => {
      await until(c, "document.querySelector('#pendBox').innerText.includes('ждут вашего решения')");
      const txt = await c.ev("document.querySelector('#pendBox').innerText + ' | ' + document.querySelector('#orgBox').innerText + ' | ' + document.querySelector('#weeklyBox').innerText");
      assert(/Заменить оригиналы/.test(txt) && /год\/месяц/.test(txt) && /Сохранить расписание/.test(txt), txt.slice(0, 300));
      await c.shot('space');
    });
    await t('замена оригиналов: сначала вопрос, оригиналы в Корзину только после «Да»', async () => {
      await c.ev("document.querySelector('[data-act=replace]').click()");
      await until(c, "document.querySelector('#modal.on') && document.querySelector('#modal').innerText.includes('Корзину')");
      assert(fs.existsSync(jpg), 'оригинал исчез до подтверждения');
      await c.ev("[...document.querySelectorAll('#modal button')].find(b => b.textContent === 'Отмена').click()");
      assert(fs.existsSync(jpg) && fs.statSync(jpg).size === origSize, 'оригинал тронут после «Отмена»');
    });
    await t('«Разложить по папкам»: показывает план и ничего не двигает без «Да»', async () => {
      await c.ev("document.querySelector('#orgGo').click()");
      await until(c, "document.querySelector('#modal.on') && document.querySelector('#modal').innerText.includes('Апрель 2023')");
      assert(fs.existsSync(jpg), 'файл уехал до подтверждения');
      await c.shot('organize');
      await c.ev("[...document.querySelectorAll('#modal button')].find(b => b.textContent === 'Отмена').click()");
      assert(fs.existsSync(jpg));
    });
    await t('сейф: создать → добавить запись → закрыть → открыть с неверным и верным паролем', async () => {
      await c.ev("document.querySelector('[data-go=more]').click()");
      await c.ev("document.querySelector('[data-go=vault]').click()");
      await until(c, "document.querySelector('#vp1')");
      await c.ev("document.querySelector('#vp1').value='pass-12345';document.querySelector('#vp2').value='pass-12345';document.querySelector('#vOk').checked=true;document.querySelector('#vCreate').click()");
      await until(c, "document.querySelector('#vaultBody').innerText.includes('Сейф открыт')");
      await c.ev("document.querySelector('#vAddNote').click()");
      await until(c, "document.querySelector('#nTitle')");
      await c.ev("document.querySelector('#nTitle').value='Почта';document.querySelector('#nLogin').value='me@x.ru';document.querySelector('#nPass').value='Zz9!secret';[...document.querySelectorAll('#modal button')].find(b => b.textContent.includes('Сохранить')).click()");
      await until(c, "document.querySelector('#vaultBody').innerText.includes('Почта')");
      await c.shot('vault');
      await c.ev("document.querySelector('#vLock').click()");
      await until(c, "document.querySelector('#vpw')");
      await c.ev("document.querySelector('#vpw').value='wrong-pass';document.querySelector('#vOpen').click()");
      await until(c, "document.querySelector('#vMsg').innerText.includes('не подходит')");
      await c.ev("document.querySelector('#vpw').value='pass-12345';document.querySelector('#vOpen').click()");
      await until(c, "document.querySelector('#vaultBody').innerText.includes('Почта')");
      assert(!fs.readFileSync(path.join(dir, 'data', 'vault', 'index.enc')).includes(Buffer.from('Zz9!secret')), 'пароль лежит открытым');
    });
    await t('дополнения браузера: проверка и список', async () => {
      await c.ev("document.querySelector('[data-go=more]').click()");
      await c.ev("document.querySelector('[data-go=ext]').click()");
      await until(c, "document.querySelector('#xScan')");
      await c.ev("document.querySelector('#xScan').click()");
      await until(c, "document.querySelector('#extBody').innerText.includes('Дополнений:')", 30000);
      await c.shot('ext');
    });
    ws.close();
  } finally { app.kill(); }
  console.log(`\nУспешно: ${okc}`);
  await wait(2000);
  try { fs.rmSync(path.join(root, '.testdata', 'app'), { recursive: true, force: true }); } catch { /* ещё закрывается — не страшно */ }
})();
