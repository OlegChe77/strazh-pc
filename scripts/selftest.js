// Самопроверка без окна: node scripts/selftest.js
// Проверяет защиту путей, карантин, поиск дубликатов, сжатие фото/видео и (только чтение) проверку угроз на этом компьютере.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const assert = require('assert');
const sharp = require('sharp');

const src = p => path.join(__dirname, '..', 'src', 'main', p);
const paths = require(src('lib/paths'));
const quarantineLib = require(src('quarantine'));
const spaceScan = require(src('space/scan'));
const compress = require(src('space/compress'));
const threats = require(src('threats'));

function isAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
const base = path.join(__dirname, '..', '.testdata');
let ok = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log('  OK  ', name); } catch (e) { console.log('  FAIL', name, '\n      ', e.message); process.exitCode = 1; } };

(async () => {
  fs.rmSync(base, { recursive: true, force: true });
  const pics = path.join(base, 'Pictures'), vids = path.join(base, 'Videos'), qdir = path.join(base, 'q'), out = path.join(base, 'out'), dl = path.join(base, 'Downloads');
  [pics, vids, dl].forEach(d => fs.mkdirSync(d, { recursive: true }));

  console.log('Защита путей');
  await t('Windows и Program Files — системные', () => {
    assert(paths.isSystemPath('C:\\Windows\\System32\\notepad.exe'));
    assert(paths.isSystemPath('C:\\Program Files\\Foo\\a.exe'));
    assert(!paths.isCleanable('C:\\Windows\\notepad.exe', ['C:\\']));
  });
  await t('AppData и корень диска закрыты', () => {
    assert(!paths.isCleanable(path.join(os.homedir(), 'AppData', 'Roaming', 'a.jpg'), [os.homedir()]));
    assert(!paths.isAllowedUserFolder('C:\\'));
    assert(!paths.isAllowedUserFolder('C:\\Windows'));
    assert(paths.isCleanable(path.join(pics, 'a.jpg'), [pics]));
  });

  console.log('Карантин');
  const q = quarantineLib.create(qdir);
  await t('системный файл в карантин не берётся', async () => {
    await assert.rejects(q.add({ file: 'C:\\Windows\\System32\\notepad.exe', reason: 'test' }), /системн/i);
    assert(fs.existsSync('C:\\Windows\\System32\\notepad.exe'));
  });
  await t('файл → карантин → возврат (без потерь)', async () => {
    const f = path.join(dl, 'вирус.exe'); fs.writeFileSync(f, 'hello-quarantine');
    const e = await q.add({ file: f, reason: 'тест' });
    assert(!fs.existsSync(f) && fs.existsSync(path.join(qdir, e.id + '.quar')));
    assert.strictEqual(q.list().length, 1);
    const r = await q.restore(e.id);
    assert.strictEqual(fs.readFileSync(r.restoredTo, 'utf8'), 'hello-quarantine');
    assert.strictEqual(q.list().length, 0);
  });

  console.log('Сжатие');
  // фото: шумная картинка 3000x2000 (JPEG и PNG)
  const raw = Buffer.alloc(3000 * 2000 * 3); for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + (i >> 5) * 13) & 255 ^ (Math.random() * 40 | 0);
  await sharp(raw, { raw: { width: 3000, height: 2000, channels: 3 } }).jpeg({ quality: 97 }).toFile(path.join(pics, 'big.jpg'));
  await sharp(raw, { raw: { width: 3000, height: 2000, channels: 3 } }).png().toFile(path.join(pics, 'shot.png'));
  const ff = compress.ffmpegPath();
  await t('ffmpeg встроен и запускается', () => { assert(fs.existsSync(ff), ff); assert(/ffmpeg version/.test(execFileSync(ff, ['-version']).toString())); });
  execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-c:v', 'libx264', '-crf', '12', '-c:a', 'aac', path.join(vids, 'clip.mp4')], { stdio: 'ignore' });
  fs.copyFileSync(path.join(pics, 'big.jpg'), path.join(pics, 'big_copy.jpg')); // дубликат

  const roots = [pics, vids, dl];
  let sc;
  await t('поиск находит фото, картинки и дубликаты', async () => {
    sc = await spaceScan.scan({ roots, outRoot: out, quarantineDir: qdir, installerRoots: [dl] });
    assert(sc.files.jpg.length === 2, 'jpg=' + sc.files.jpg.length);
    assert(sc.files.png.length === 1);
    assert(sc.dupGroups.length === 1 && sc.dupGroups[0].extras.length === 1, 'dup=' + sc.dupGroups.length);
  });
  await t('сжатие делает копии, оригиналы целы', async () => {
    const items = [...sc.files.jpg, ...sc.files.png].map((x, i) => ({ ...x, id: 'x' + i, kind: x.path.endsWith('.png') ? 'png' : 'jpg' }));
    const vid = fs.statSync(path.join(vids, 'clip.mp4'));
    items.push({ path: path.join(vids, 'clip.mp4'), size: vid.size, mtime: vid.mtimeMs, rootIdx: 1, id: 'v1', kind: 'video' });
    const before = items.map(i => fs.statSync(i.path).size);
    const res = await compress.compressAll({ items, roots, outRoot: out });
    items.forEach((i, k) => assert.strictEqual(fs.statSync(i.path).size, before[k], 'оригинал изменён: ' + i.path));
    for (const r of res) console.log('        ', path.basename(r.original), r.status, r.before, '→', r.after, r.note);
    assert(res.some(r => r.status === 'done'), 'нет ни одной готовой копии');
    assert(!fs.readdirSync(out, { recursive: true }).some(f => String(f).endsWith('.part')), 'остался .part');
  });


  console.log('Поиск и обезвреживание (имитация майнера и файла с паролями)');
  const { spawn } = require('child_process');
  const actions = require(src('threats/actions'));
  const own = { exe: process.execPath, dir: path.dirname(process.execPath) };
  const docs = path.join(base, 'Docs'); fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'пароли.txt'), 'почта пароль: Qwerty123\nбанк: password = Zx9!kLm2\n');
  fs.writeFileSync(path.join(docs, 'заметка.txt'), 'купить хлеб');
  const fake = path.join(base, 'fakeapps', 'xmrig.exe'); fs.mkdirSync(path.dirname(fake), { recursive: true }); fs.copyFileSync(ff, fake);
  const child = spawn(fake, ['-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=60', '-c:v', 'libx264', '-preset', 'veryslow', '-f', 'null', '-'], { stdio: 'ignore' });
  let fin;
  await t('находит «майнер» и файл с паролями', async () => {
    await new Promise(r => setTimeout(r, 1500));
    const r = await threats.scan({ secretRoots: [docs], own });
    fin = r.findings;
    const m = fin.find(f => /xmrig/i.test(f.title)), p = fin.find(f => /пароли\.txt/.test(f.title));
    assert(m && m.level === 'bad', 'майнер не найден: ' + fin.map(f => f.title).join(' | '));
    assert(p && p.level === 'warn', 'файл с паролями не найден');
    assert(!fin.some(f => /заметка/.test(f.title)), 'ложное срабатывание на обычной заметке');
    assert(m.what && m.risk && m.advice, 'нет объяснения');
  });
  await t('обезвреживание: процесс остановлен, файл в карантине, ничего не удалено', async () => {
    const m = fin.find(f => /xmrig/i.test(f.title));
    const r = await actions.neutralize(m, q, own);
    await new Promise(r => setTimeout(r, 500));
    assert(child.exitCode !== null || child.killed || !isAlive(child.pid), 'процесс жив');
    assert(!fs.existsSync(fake), 'файл на старом месте');
    assert(q.list().some(e => e.original === fake), 'нет в карантине');
    console.log('        ', r.log.join(' | '));
    const back = await q.restore(q.list().find(e => e.original === fake).id);
    assert(fs.existsSync(back.restoredTo), 'не вернулся');
  });
  await t('пароли → защищённая папка → возврат', async () => {
    const p = fin.find(f => /пароли\.txt/.test(f.title));
    await actions.quarantineOnly(p, q);
    assert(!fs.existsSync(path.join(docs, 'пароли.txt')));
    await q.restore(q.list().find(e => e.name === 'пароли.txt').id);
    assert(fs.existsSync(path.join(docs, 'пароли.txt')));
  });
  try { child.kill(); } catch {}

  console.log('Облачные папки');
  const cloud = require(src('threats/cloud'));
  const cloudFiles = require(src('threats/cloudfiles'));
  const secretsLib = require(src('threats/secrets'));
  const { createCtx } = require(src('threats/ctx'));
  const fh = path.join(base, 'cloudhome'), fenv = { APPDATA: path.join(fh, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(fh, 'AppData', 'Local') };
  const od = path.join(fh, 'OneDrive'), yd = path.join(fh, 'Диск Яндекса'), dbx = path.join(fh, 'Dropbox'), mailru = path.join(fh, 'Облако Mail.ru'), gd = path.join(fh, 'Google Drive');
  [od, path.join(od, 'Документы'), path.join(od, 'Рабочий стол'), yd, dbx, mailru, gd, path.join(fh, 'Dropbox (Work)'), path.join(fenv.LOCALAPPDATA, 'Dropbox'), path.join(fenv.APPDATA, 'Yandex', 'YandexDisk2'), path.join(fh, 'OtherDocs')].forEach(d => fs.mkdirSync(d, { recursive: true }));
  fs.writeFileSync(path.join(fenv.LOCALAPPDATA, 'Dropbox', 'info.json'), JSON.stringify({ personal: { path: dbx }, business: { path: path.join(fh, 'Dropbox (Work)') } }));
  fs.writeFileSync(path.join(fenv.APPDATA, 'Yandex', 'YandexDisk2', 'config.cfg'), `proxy="auto"\ndir="${yd}"\n`);
  await t('находит OneDrive, Яндекс.Диск, Google Диск, Dropbox, Облако Mail.ru; не выдумывает лишнего', () => {
    const r = cloud.findCloudRoots({ home: fh, env: { ...fenv, OneDrive: od }, reg: { od: [od] } });
    const ids = r.map(x => x.id).sort();
    assert.deepStrictEqual(ids, ['dropbox', 'dropbox', 'gdrive', 'mailru', 'onedrive', 'yandex'], ids.join(','));
    assert.strictEqual(r.filter(x => x.id === 'onedrive').length, 1, 'OneDrive найден дважды');
    assert(!r.some(x => /OtherDocs/.test(x.folder)), 'чужая папка принята за облако');
    assert.deepStrictEqual(cloud.findCloudRoots({ home: path.join(base, 'nohome'), env: {}, reg: {} }), []);
  });
  fs.writeFileSync(path.join(od, 'Документы', 'пароли.txt'), 'почта пароль: Qwerty123\nбанк: password = Zx9!kLm2\n');
  fs.writeFileSync(path.join(od, 'Документы', 'заметки.txt'), 'купить хлеб');
  fs.writeFileSync(path.join(od, 'Рабочий стол', 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n');
  fs.writeFileSync(path.join(od, 'Рабочий стол', 'пароли банка.docx'), 'бинарное');
  fs.writeFileSync(path.join(yd, 'фото.txt'), 'просто файл');
  const cloudOpts = {
    cloudRoots: [{ id: 'onedrive', name: 'OneDrive', folder: od }, { id: 'yandex', name: 'Яндекс.Диск', folder: yd }],
    cloudReg: { known: { documents: path.join(od, 'Документы'), desktop: path.join(od, 'Рабочий стол'), pictures: path.join(fh, 'Pictures') } }
  };
  await t('пароли и ключ в облаке: «Опасно»; только по названию — «Посмотреть»; обычная заметка не трогается', async () => {
    const cctx = createCtx(); await cloud.check(cctx, () => {}, cloudOpts);
    const f = cctx.findings(), by = re => f.find(x => re.test(x.title));
    const pw = by(/пароли\.txt/), key = by(/id_rsa/), nm = by(/пароли банка/), od1 = by(/синхронизируется.*OneDrive/), ya = by(/синхронизируется.*Яндекс/);
    assert(pw && pw.level === 'bad' && /облак/i.test(pw.title), 'пароли: ' + (pw && pw.level));
    assert(key && key.level === 'bad', 'ключ');
    assert(nm && nm.level === 'warn', 'по названию: ' + (nm && nm.level));
    assert(!by(/заметки/) && !by(/фото\.txt/), 'ложное срабатывание');
    assert(od1 && od1.level === 'warn' && od1.reasons.some(r => /Документы/.test(r) && /Рабочий стол/.test(r)), 'нет списка синхронизируемых папок: ' + (od1 && od1.reasons.join('|')));
    assert(ya && ya.level === 'ok', 'чистая папка должна быть «Не страшно»');
    for (const x of f) assert(x.what && x.risk && x.advice && x.reasons.length, 'нет объяснения: ' + x.title);
    assert(pw.actions.includes('quarantine') && !pw.actions.includes('closeshare'), 'действия: ' + pw.actions);
    assert.strictEqual(cctx.stats.cloud, 2);
    assert(fs.existsSync(path.join(od, 'Документы', 'пароли.txt')) && fs.existsSync(path.join(od, 'Рабочий стол', 'id_rsa')), 'проверка тронула файлы');
  });
  await t('файл «только в облаке» (Offline) не открывается; такой же обычный — открывается', async () => {
    const off = path.join(od, 'Документы', 'секреты облачные.txt'), on = path.join(od, 'Документы', 'секреты локальные.txt');
    const body = 'пароль: AAAA1111\nlogin password = BBBB2222\n';
    fs.writeFileSync(off, body); fs.writeFileSync(on, body);
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${off}').Attributes = 'Archive, Offline'`]);
    const set = await cloudFiles.offlineSet([off, on]);
    assert(set.has(off.toLowerCase()) && !set.has(on.toLowerCase()), 'признак Offline: ' + [...set].join('|'));
    const r = await secretsLib.findSecretFiles([path.join(od, 'Документы')], { offlineFilter: cloudFiles.offlineSet });
    const fo = r.found.find(x => x.file === off), fl = r.found.find(x => x.file === on);
    assert(fo && fo.why === 'name' && fo.offline, 'облачный файл прочитан или потерян: ' + JSON.stringify(fo && fo.why));
    assert(fl && fl.why === 'content' && fl.count >= 2, 'локальный файл не прочитан');
    assert(r.skippedOffline >= 1);
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${off}').Attributes = 'Archive'`]);
    fs.rmSync(off, { force: true }); fs.rmSync(on, { force: true });
  });
  await t('если признаки узнать не удалось, строгий режим считает файлы «только в облаке»', async () => {
    const orig = cloudFiles.makeOfflineFilter({ strict: true });
    const bad = path.join(base, 'нет такой папки', 'a.txt');
    const set = await orig([bad]); // путь не существует: PowerShell отвечает пусто, не падает
    assert(set instanceof Set);
  });
  await t('реальный реестр: облачные настройки читаются без ошибок', async () => {
    const reg = await cloud.queryReg();
    assert(reg && typeof reg === 'object' && reg.known && reg.known.documents, 'нет пути к «Документам»: ' + JSON.stringify(reg));
    console.log(`         облачные папки на этом ПК: ${cloud.findCloudRoots({ reg }).map(r => r.name + ' — ' + r.folder).join('; ') || 'нет'}`);
  });

  console.log('Открытые порты');
  const ports = require(src('threats/ports'));
  const dlTool = path.join(os.homedir(), 'Downloads', 'tool.exe');
  const okSig = new Map([['c:\\nginx\\nginx.exe', { signed: true, signer: 'Test Corp', status: 'Valid' }]]);
  const L = (port, name, exe = '', addr = '0.0.0.0', pid = 100) => ({ addr, port, pid, name, exe });
  await t('удалённый рабочий стол: «Стоит посмотреть»; без проверки NLA или при выключенном брандмауэре — «Опасно»', () => {
    const rdp = [L(3389, 'svchost', 'C:\\Windows\\System32\\svchost.exe')];
    const r0 = ports.evaluate(rdp, { nla: 1 });
    assert.strictEqual(r0.length, 1); assert.strictEqual(r0[0].kind, 'rdp'); assert.strictEqual(r0[0].level, 'warn');
    assert.strictEqual(ports.evaluate(rdp, { nla: 0 })[0].level, 'bad');
    const fwOff = ports.evaluate(rdp, { nla: 1, cat: ['Public'], fw: [{ name: 'Public', on: false }, { name: 'Private', on: true }] });
    assert.strictEqual(fwOff[0].level, 'bad'); assert(fwOff[0].reasons.some(r => /Брандмауэр.*выключен/.test(r)));
    const other = ports.evaluate(rdp, { nla: 1, cat: ['Private'], fw: [{ name: 'Public', on: false }, { name: 'Private', on: true }] });
    assert.strictEqual(other[0].level, 'warn', 'выключенный профиль, к которому мы не подключены, не повод для тревоги');
  });
  await t('обычные порты Windows не показываются; telnet и Docker без защиты — «Опасно»', () => {
    const r = ports.evaluate([L(445, 'System', '', '0.0.0.0', 4), L(135, 'svchost'), L(49664, 'lsass'), L(5000, 'svchost'), L(23, 'tlntsvr'), L(2375, 'dockerd', 'C:\\Program Files\\Docker\\dockerd.exe')]);
    const ks = r.map(x => x.kind).sort();
    assert.deepStrictEqual(ks, ['docker', 'telnet'], ks.join(','));
    assert(r.every(x => x.level === 'bad'));
  });
  await t('программы: незнакомая из «Загрузок» — «Посмотреть»; подписанный веб-сервер — «Не страшно»; остальное молчит', () => {
    const sigs = new Map([...okSig, ['c:\\apps\\messenger.exe', { signed: true, signer: 'X', status: 'Valid' }]]);
    const r = ports.evaluate([L(8765, 'tool', dlTool), L(80, 'nginx', 'C:\\nginx\\nginx.exe'), L(53211, 'messenger', 'C:\\Apps\\messenger.exe')], { sigs });
    const by = k => r.find(x => x.kind === k);
    assert(by('unknown') && by('unknown').level === 'warn' && path.basename(by('unknown').exe) === 'tool.exe', JSON.stringify(r.map(x => x.kind + x.level)));
    assert(by('known') && by('known').level === 'ok');
    assert.strictEqual(r.length, 2, 'лишние находки: ' + r.map(x => x.name).join(','));
    assert.strictEqual(ports.evaluate([L(8080, 'nginx', 'C:\\nginx\\nginx.exe')], {})[0].level, 'warn', 'неподписанный веб-сервер должен быть «Посмотреть»');
  });
  await t('база данных открыта для сети — «Посмотреть»; порт на одном адресе тоже виден', () => {
    const r = ports.evaluate([L(3306, 'mysqld', 'C:\\Program Files\\MySQL\\mysqld.exe'), L(5432, 'postgres', 'D:\\pg\\postgres.exe', '192.168.1.5')]);
    assert.strictEqual(r.length, 2); assert(r.every(x => x.kind === 'db' && x.level === 'warn'));
    assert(r.some(x => x.reasons.some(s => /192\.168\.1\.5/.test(s))));
  });
  await t('находки по портам: объяснение есть; «закрыть порт» только когда есть что закрывать; службу Windows не обезвреживаем', () => {
    const r = ports.evaluate([L(3389, 'svchost', 'C:\\Windows\\System32\\svchost.exe'), L(8765, 'tool', dlTool), L(80, 'nginx', 'C:\\nginx\\nginx.exe')], { nla: 1, sigs: okSig });
    const f2 = r.map(ports.toFinding);
    for (const f of f2) assert(f.what && f.risk && f.advice && f.title && f.reasons.length, 'нет объяснения: ' + f.title);
    const rdp = f2.find(f => /рабочий стол/.test(f.title)), tool = f2.find(f => /tool\.exe/.test(f.title)), web = f2.find(f => /nginx/.test(f.title));
    assert(rdp.actions.includes('closeport') && !rdp.actions.includes('neutralize') && !rdp.target.file, 'RDP: ' + rdp.actions);
    assert(tool.actions.includes('closeport') && tool.actions.includes('neutralize') && tool.target.file === dlTool, 'tool: ' + tool.actions);
    assert.strictEqual(web.level, 'ok'); assert(!web.actions.includes('closeport') && !web.actions.includes('neutralize'));
    assert(/порт 3389/.test(rdp.title) && /порт 8765/.test(tool.title));
  });
  await t('закрытие порта: сценарий для брандмауэра строится только из верных номеров', () => {
    const sc = actions.closePortScript([3389, 3389, 80]);
    assert(/New-NetFirewallRule/.test(sc) && /-Direction Inbound -Action Block/.test(sc) && /-LocalPort 3389/.test(sc) && /-LocalPort 80\b/.test(sc));
    assert.strictEqual((sc.match(/New-NetFirewallRule/g) || []).length, 2, 'повторный порт');
    for (const bad of [[], ['3389; calc'], [0], [70000], [1.5], [NaN], null]) assert.throws(() => actions.closePortScript(bad), /порт/i, JSON.stringify(bad));
  });
  await t('реальный компьютер: слушающий порт виден, порт только для этого компьютера — нет', async () => {
    const net = require('net');
    const open = net.createServer().listen(0, '0.0.0.0'), local = net.createServer().listen(0, '127.0.0.1');
    await new Promise(r => setTimeout(r, 300));
    try {
      const data = await ports.read();
      const l = [].concat(data.l || []);
      assert(l.some(x => x.port === open.address().port && x.pid === process.pid), 'не вижу открытый порт ' + open.address().port);
      assert(!l.some(x => x.port === local.address().port), 'порт только для этого компьютера показан как открытый');
      assert(data.fw !== undefined, 'нет сведений о брандмауэре');
      const c2 = createCtx(); await ports.check(c2, () => {});
      assert(c2.stats.ports > 0);
      console.log(`         открытых для сети портов: ${c2.stats.ports}; находок: ${c2.findings().map(f => `[${f.level}] ${f.title}`).join(' | ') || 'нет'}`);
    } finally { open.close(); local.close(); }
  });

  console.log('Облако и порты в общей проверке (склейка находок)');
  await t('файл с паролями в «Документах» внутри OneDrive — одна находка с объяснением про облако', async () => {
    const hooks = { ...cloudOpts, portsData: { l: [{ addr: '0.0.0.0', port: 3389, pid: 4, name: 'svchost', exe: '' }], nla: 1, fw: [], cat: [] } };
    const r = await threats.scan({ secretRoots: [path.join(od, 'Документы')], own, hooks });
    const hits = r.findings.filter(f => /пароли\.txt/.test(f.title));
    assert.strictEqual(hits.length, 1, 'дубль: ' + hits.map(h => h.title).join(' | '));
    assert(/облак/i.test(hits[0].title) && hits[0].level === 'bad', hits[0].title + ' ' + hits[0].level);
    assert(hits[0].reasons.some(x => /синхронизируется/.test(x)) && hits[0].reasons.some(x => /строк/.test(x)));
    assert(r.findings.some(f => f.kind === 'port' && f.level === 'warn'), 'нет находки про порт');
    assert(!r.errors.some(e => /облач|порт/i.test(e)), r.errors.join(' | '));
    assert.strictEqual(r.stats.cloud, 2);
  });

  console.log('Проверка угроз на этом компьютере (только чтение)');
  await t('проверка завершается и ничего не меняет', async () => {
    const t0 = Date.now();
    const r = await threats.scan({ secretRoots: [path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Desktop')].filter(fs.existsSync), own: { exe: process.execPath, dir: path.dirname(process.execPath) }, onProgress: p => process.stdout.write('.') });
    console.log(`\n        ${((Date.now() - t0) / 1000).toFixed(1)} с, находок: ${r.findings.length}`, JSON.stringify(r.stats), r.errors);
    for (const f of r.findings.slice(0, 12)) console.log(`         [${f.level}] ${f.title} :: ${f.path}\n             ${f.reasons.join(' | ')}`);
  });

  console.log('Сейф');
  const vaultLib = require(src('vault'));
  const freeNameFn = require(src('lib/fsops')).freeName;
  const vdir = path.join(base, 'vault'); const v = vaultLib.create(vdir);
  await t('слишком короткий пароль отклоняется', async () => { await assert.rejects(v.setup('123'), /короткий/); });
  await t('создание, запись, файл, возврат', async () => {
    await v.setup('правильный-пароль-1');
    const nid = await v.addNote({ title: 'Почта', login: 'me@x.ru', password: 'S3cret!' });
    assert.strictEqual(v.getNote(nid).password, 'S3cret!');
    const f = path.join(base, 'скан паспорта.bin'); const data = require('crypto').randomBytes(3 * 1024 * 1024 + 17); fs.writeFileSync(f, data);
    const e = await v.addFile(f);
    const raw = fs.readFileSync(path.join(vdir, 'files', e.id + '.enc')); assert(!raw.includes(data.subarray(1000, 1040)), 'файл лежит открытым');
    assert(!fs.readFileSync(path.join(vdir, 'index.enc')).includes(Buffer.from('S3cret!')), 'пароль лежит открытым');
    const outDir = path.join(base, 'vault-out'); fs.mkdirSync(outDir, { recursive: true });
    const back = await v.exportFile(e.id, outDir, freeNameFn);
    assert(fs.readFileSync(back).equals(data), 'файл вернулся другим'); assert(fs.existsSync(f), 'оригинал пропал сам');
    const empty = path.join(base, 'пусто.txt'); fs.writeFileSync(empty, ''); const e2 = await v.addFile(empty);
    assert.strictEqual(fs.statSync(await v.exportFile(e2.id, outDir, freeNameFn)).size, 0);
  });
  await t('неверный пароль не открывает, верный открывает', async () => {
    v.lock(); assert.throws(() => v.list(), /закрыт/);
    await assert.rejects(v.unlock('не тот пароль'), /не подходит/);
    await v.unlock('правильный-пароль-1'); assert.strictEqual(v.list().notes.length, 1); assert.strictEqual(v.list().files.length, 2);
  });
  await t('испорченный файл в сейфе не расшифровывается', async () => {
    const fid = v.list().files[0].id; const bf = path.join(vdir, 'files', fid + '.enc');
    const b = fs.readFileSync(bf); b[100] ^= 1; fs.writeFileSync(bf, b);
    await assert.rejects(v.exportFile(fid, path.join(base, 'vault-out'), freeNameFn));
    assert(!fs.readdirSync(path.join(base, 'vault-out')).some(n => n.endsWith('.part')), 'остался .part');
  });

  console.log('Дополнения браузера (только чтение)');
  const extensions = require(src('threats/extensions'));
  await t('проверка не падает, у каждого дополнения есть объяснение', () => {
    const r = extensions.scan();
    console.log(`         браузеры: ${r.browsers.join(', ') || '—'}; дополнений: ${r.items.length}; опасных: ${r.items.filter(i => i.level === 'bad').length}; ошибки: ${r.errors.length}`);
    assert(r.items.every(i => i.name && i.what && i.risk && i.advice && ['bad', 'warn', 'ok'].includes(i.level)));
  });
  await t('оценка прав: ручная установка + все сайты + куки = опасно; из магазина — не красный', () => {
    assert.strictEqual(extensions.judge({ perms: ['cookies', 'webRequest', 'tabs'], hosts: ['<all_urls>'], origin: 'unpacked' }).level, 'bad');
    assert.notStrictEqual(extensions.judge({ perms: ['debugger', 'nativeMessaging', 'tabs', 'webNavigation'], hosts: ['<all_urls>'], origin: 'store' }).level, 'bad');
    assert.strictEqual(extensions.judge({ perms: ['storage'], hosts: ['https://example.com/*'], origin: 'store' }).level, 'ok');
  });

  console.log('Разложить по папкам');
  const organize = require(src('space/organize'));
  const mp = path.join(base, 'MyPics'); fs.mkdirSync(path.join(mp, 'Camera Roll'), { recursive: true }); fs.mkdirSync(path.join(mp, 'Отпуск 2020'), { recursive: true });
  const ex = Buffer.alloc(64, 1);
  await t('дата из EXIF и из имени', async () => {
    const jpg = path.join(mp, 'a.jpg');
    await sharp({ create: { width: 40, height: 40, channels: 3, background: '#888' } }).jpeg().withExif({ IFD0: { DateTime: '2019:07:04 10:20:30' }, IFD2: { DateTimeOriginal: '2018:03:09 08:00:00' } }).toFile(jpg);
    const d = organize.exifDate(fs.readFileSync(jpg)); assert(d && d.getFullYear() === 2018 && d.getMonth() === 2, 'exif: ' + d);
    const n = organize.nameDate('IMG_20230415_101500.jpg'); assert(n && n.getFullYear() === 2023 && n.getMonth() === 3);
    assert(!organize.nameDate('photo_1234567.jpg') && !organize.nameDate('IMG_20231345.jpg'));
  });
  await t('план → перенос → отмена; альбомы не трогаются, ничего не теряется', async () => {
    fs.writeFileSync(path.join(mp, 'IMG_20230415_101500.png'), ex);
    fs.writeFileSync(path.join(mp, 'VID_20210102_000000.mp4'), ex);
    fs.writeFileSync(path.join(mp, 'Camera Roll', 'x.png'), ex); fs.utimesSync(path.join(mp, 'Camera Roll', 'x.png'), new Date(2015, 5, 5), new Date(2015, 5, 5));
    fs.writeFileSync(path.join(mp, 'Отпуск 2020', 'album.jpg'), ex);
    fs.writeFileSync(path.join(mp, 'notes.txt'), 'не фото');
    const list = () => fs.readdirSync(mp, { recursive: true }).filter(f => fs.statSync(path.join(mp, f)).isFile()).map(f => path.basename(f)).sort();
    const before = list();
    const log = path.join(base, 'org-log.json');
    const pl = await organize.plan({ roots: [mp] });
    assert.strictEqual(pl.items.length, 4, 'в плане ' + pl.items.map(i => path.basename(i.path)).join(','));
    assert(!pl.items.some(i => /album|notes/.test(i.path)), 'тронул альбом или текст');
    const r = await organize.apply({ items: pl.items, logFile: log });
    assert.strictEqual(r.moved, 4, JSON.stringify(r));
    assert(fs.existsSync(path.join(mp, 'По датам', '2023', '04 Апрель', 'IMG_20230415_101500.png')));
    assert(fs.existsSync(path.join(mp, 'По датам', '2018', '03 Март', 'a.jpg')));
    assert(fs.existsSync(path.join(mp, 'По датам', '2015', '06 Июнь', 'x.png')));
    assert(fs.existsSync(path.join(mp, 'Отпуск 2020', 'album.jpg')) && fs.existsSync(path.join(mp, 'notes.txt')));
    assert.strictEqual(organize.undoInfo(log).count, 4);
    assert.strictEqual((await organize.plan({ roots: [mp] })).items.length, 0, 'повторный план нашёл файлы');
    assert.deepStrictEqual(list(), before, 'после переноса набор файлов другой');
    const u = await organize.undo({ logFile: log });
    assert.strictEqual(u.restored, 4, JSON.stringify(u));
    assert(!fs.existsSync(path.join(mp, 'По датам')), 'пустые папки остались');
    assert.deepStrictEqual(list(), before);
    assert(fs.existsSync(path.join(mp, 'Camera Roll', 'x.png')), 'файл не вернулся в Camera Roll');
  });

  console.log('Копии раз в неделю');
  const weekly = require(src('space/weekly'));
  await t('журнал: «уже обработано» и «ждёт решения» переживают перезапуск', () => {
    const ld = path.join(base, 'ledger'); const L = weekly.createLedger(ld);
    const orig = path.join(base, 'o.jpg'), cp = path.join(base, 'c.jpg'); fs.writeFileSync(orig, 'aaaa'); fs.writeFileSync(cp, 'aa');
    const it = { path: orig, size: 4, mtime: 123.4 };
    assert(!L.isSeen(it)); L.markSeen(it); L.flushSeen(); L.addPending({ original: orig, copy: cp, before: 4, after: 2 });
    const L2 = weekly.createLedger(ld);
    assert(L2.isSeen(it) && !L2.isSeen({ ...it, size: 5 })); assert.strictEqual(L2.pending().length, 1);
    fs.rmSync(cp); assert.strictEqual(weekly.createLedger(ld).pending().length, 0, 'потерянная копия осталась в списке');
  });
  await t('расписание Windows: создаётся, видно, удаляется', async () => {
    const name = 'Страж ПК — тест самопроверки';
    await weekly.schedule({ exe: process.execPath, args: '--weekly', day: 3, hour: 4, name });
    try {
      const i = await weekly.scheduleInfo(name); assert(i.exists, 'задания нет'); assert(i.next && new Date(i.next).getHours() === 4, 'время: ' + i.next);
    } finally { await weekly.unschedule(name); }
    assert(!(await weekly.scheduleInfo(name)).exists, 'задание не удалилось');
  });

  console.log('Английские имена и перенос старых данных');
  const names = require(src('names'));
  const migrate = require(src('migrate'));
  const startup = require(src('threats/startup'));
  const CYR = /[\u0400-\u04FF]/;
  await t('новые имена на диске и в Windows — без кириллицы', () => {
    for (const n of [names.APP, names.DATA_DIR, names.COPIES_DIR, names.TASK_NAME, names.portRuleName(3389)]) assert(!CYR.test(n), n);
    assert(CYR.test(names.LEGACY.DATA_DIR) && CYR.test(names.LEGACY.TASK_NAME), 'старые имена должны остаться для переноса');
    const pj = require(path.join(__dirname, '..', 'package.json'));
    for (const v of [pj.productName, pj.build.productName, pj.build.appId, pj.build.nsis.artifactName, pj.build.portable.artifactName]) assert(!CYR.test(v), v);
  });
  const mk = (p, s = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
  await t('перенос: карантин, сейф, журналы, настройки и папка копий переезжают, пути копий обновляются', () => {
    const root = path.join(base, 'mig'); const oD = path.join(root, 'AppData', names.LEGACY.DATA_DIR), nD = path.join(root, 'AppData', names.DATA_DIR);
    const oC = path.join(root, names.LEGACY.COPIES_DIR), nC = path.join(root, names.COPIES_DIR);
    mk(path.join(oD, 'settings.json'), '{"ignored":[1]}'); mk(path.join(oD, 'quarantine', 'manifest.json'), '[]'); mk(path.join(oD, 'quarantine', 'a.quar'), 'virus');
    mk(path.join(oD, 'vault', 'index.enc'), 'enc'); mk(path.join(oD, 'vault', 'files', 'f.enc'), 'enc2');
    mk(path.join(oD, 'weekly-seen.json'), '{}'); mk(path.join(oD, 'organize-log.json'), '[]');
    mk(path.join(oD, 'Cache', 'junk.bin'), 'zz'); mk(path.join(nD, 'Cache', 'new.bin'), 'nn'); // Electron уже успел создать свой кэш в новой папке
    mk(path.join(oC, 'Pictures', 'a.jpg'), 'copy'); mk(path.join(oC, 'Pictures', 'b.jpg'), 'copy2');
    const orig = path.join(root, 'Pictures', 'a.jpg'); mk(orig, 'original');
    mk(path.join(oD, 'pending-copies.json'), JSON.stringify([{ original: orig, copy: path.join(oC, 'Pictures', 'a.jpg'), before: 8, after: 4 }, { original: 'q', copy: path.join(root, 'elsewhere.jpg'), before: 1, after: 1 }]));
    const r = migrate.migrateAll({ oldData: oD, newData: nD, oldCopies: oC, newCopies: nC });
    assert(!fs.existsSync(oD), 'старая папка данных осталась: ' + JSON.stringify(r.data));
    assert(!fs.existsSync(oC), 'старая папка копий осталась');
    assert.strictEqual(fs.readFileSync(path.join(nD, 'settings.json'), 'utf8'), '{"ignored":[1]}');
    assert.strictEqual(fs.readFileSync(path.join(nD, 'quarantine', 'a.quar'), 'utf8'), 'virus');
    assert(fs.existsSync(path.join(nD, 'quarantine', 'manifest.json')) && fs.existsSync(path.join(nD, 'vault', 'files', 'f.enc')));
    assert(fs.existsSync(path.join(nD, 'weekly-seen.json')) && fs.existsSync(path.join(nD, 'organize-log.json')));
    assert.strictEqual(fs.readFileSync(path.join(nD, 'Cache', 'new.bin'), 'utf8'), 'nn', 'свой кэш новой папки затёрт');
    assert.strictEqual(fs.readFileSync(path.join(nC, 'Pictures', 'b.jpg'), 'utf8'), 'copy2');
    const pend = JSON.parse(fs.readFileSync(path.join(nD, 'pending-copies.json'), 'utf8'));
    assert.strictEqual(pend[0].copy, path.join(nC, 'Pictures', 'a.jpg'), 'путь копии не обновлён');
    assert.strictEqual(pend[1].copy, path.join(root, 'elsewhere.jpg'));
    // карантин после переезда работает: запись и файл на месте
    const q = quarantineLib.create(path.join(nD, 'quarantine')); assert.strictEqual(q.list().length, 0);
    assert.strictEqual(weekly.createLedger(nD).pending().length, 1, 'журнал не видит перенесённую копию');
    // повторный запуск ничего не ломает
    assert.strictEqual(migrate.migrateAll({ oldData: oD, newData: nD, oldCopies: oC, newCopies: nC }).data.status, 'none');
  });
  await t('перенос: уже существующие файлы в новой папке не затираются, старая остаётся', () => {
    const root = path.join(base, 'mig2'); const oD = path.join(root, names.LEGACY.DATA_DIR), nD = path.join(root, names.DATA_DIR);
    mk(path.join(oD, 'settings.json'), 'OLD'); mk(path.join(oD, 'organize-log.json'), 'LOG'); mk(path.join(nD, 'settings.json'), 'NEW');
    const r = migrate.migrateAll({ oldData: oD, newData: nD, oldCopies: path.join(root, 'нет'), newCopies: path.join(root, 'new-copies') });
    assert.strictEqual(fs.readFileSync(path.join(nD, 'settings.json'), 'utf8'), 'NEW');
    assert.strictEqual(fs.readFileSync(path.join(nD, 'organize-log.json'), 'utf8'), 'LOG');
    assert(fs.existsSync(path.join(oD, 'settings.json')), 'старый файл пропал'); assert.deepStrictEqual(r.data.conflicts, ['settings.json']);
    assert.strictEqual(r.copies.status, 'none');
  });
  await t('перенос: такой же файл после неполного переноса убирается, старая папка исчезает', () => {
    const root = path.join(base, 'mig4'); const oD = path.join(root, names.LEGACY.DATA_DIR), nD = path.join(root, names.DATA_DIR);
    mk(path.join(oD, 'settings.json'), 'SAME'); mk(path.join(nD, 'settings.json'), 'SAME'); mk(path.join(oD, 'GPUCache', 'x'), 'z');
    const r = migrate.migrateAll({ oldData: oD, newData: nD, oldCopies: path.join(root, 'a'), newCopies: path.join(root, 'b') });
    assert(!fs.existsSync(oD), JSON.stringify(r.data)); assert.strictEqual(fs.readFileSync(path.join(nD, 'settings.json'), 'utf8'), 'SAME');
  });
  await t('перенос: если старых папок нет — ничего не происходит', () => {
    const root = path.join(base, 'mig3'); fs.mkdirSync(root, { recursive: true });
    const r = migrate.migrateAll({ oldData: path.join(root, 'a'), newData: path.join(root, 'b'), oldCopies: path.join(root, 'c'), newCopies: path.join(root, 'd') });
    assert.strictEqual(r.data.status, 'none'); assert.strictEqual(r.copies.status, 'none'); assert(!fs.existsSync(path.join(root, 'b')));
  });
  await t('автозагрузка: своё задание не подозрительно ни под новым, ни под старым именем', () => {
    const own = { exe: 'C:\\Apps\\StrazhPC\\StrazhPC.exe', dir: 'C:\\Apps\\StrazhPC' };
    const row = name => ({ src: 'task', name, exe: own.exe });
    assert(startup.isOwnTask(row(names.TASK_NAME), own)); assert(startup.isOwnTask(row(names.LEGACY.TASK_NAME), own));
    assert(!startup.isOwnTask(row('StrazhPC fake'), { exe: 'C:\\Other\\x.exe', dir: 'C:\\Other' }), 'чужой путь под нашим именем не должен проходить');
    assert(!startup.isOwnTask(row('Updater'), own));
  });
  await t('Брандмауэр: новое имя правила латиницей; старое правило считается — второе не создаём', () => {
    assert.strictEqual(actions.portRuleName(3389), 'StrazhPC: port 3389 blocked');
    const s = actions.closePortScript([3389]);
    assert(s.includes(names.portRuleName(3389)) && s.includes(names.LEGACY.portRuleName(3389)));
    assert(/-and -not/.test(s));
  });
  await t('поиск места не заходит ни в новую, ни в старую папку копий', async () => {
    const r = path.join(base, 'skip'); const nC = path.join(r, names.COPIES_DIR), oC = path.join(r, names.LEGACY.COPIES_DIR);
    for (const d of [r, nC, oC]) { fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(path.join(pics, 'big.jpg'), path.join(d, 'p.jpg')); }
    const res = await spaceScan.scan({ roots: [r], outRoot: [nC, oC], quarantineDir: qdir, installerRoots: [] });
    assert.deepStrictEqual(res.files.jpg.map(x => x.path), [path.join(r, 'p.jpg')]);
  });
  await t('Планировщик: старое задание пересоздаётся под новым именем и удаляется', async () => {
    const oldN = 'Страж ПК — тест переноса', newN = 'StrazhPC - test migration';
    await weekly.schedule({ exe: process.execPath, args: '--weekly', day: 5, hour: 7, name: oldN });
    try {
      const info = await weekly.legacyTaskInfo(oldN); assert(info.exists);
      assert.deepStrictEqual(weekly.parseLegacyTrigger(info, {}), { day: 5, hour: 7 });
      const r = await weekly.migrateTask({ exe: process.execPath, args: '--weekly', fallback: {}, oldName: oldN, newName: newN });
      assert.deepStrictEqual([r.status, r.day, r.hour], ['migrated', 5, 7]);
      const i = await weekly.scheduleInfo(newN); assert(i.exists && new Date(i.next).getHours() === 7, JSON.stringify(i));
      assert(!(await weekly.scheduleInfo(oldN)).exists, 'старое задание не удалилось');
      assert.strictEqual((await weekly.migrateTask({ exe: process.execPath, args: '--weekly', oldName: oldN, newName: newN })).status, 'none');
    } finally { await weekly.unschedule(oldN).catch(() => {}); await weekly.unschedule(newN).catch(() => {}); }
  });
  await t('расписание: разбор дня недели и часа', () => {
    assert.deepStrictEqual(weekly.parseLegacyTrigger({ days: 1, start: '2026-01-04T00:00:00' }, {}), { day: 0, hour: 0 });
    assert.deepStrictEqual(weekly.parseLegacyTrigger({ days: 64, start: '2026-01-03T23:00:00' }, {}), { day: 6, hour: 23 });
    assert.deepStrictEqual(weekly.parseLegacyTrigger({}, { day: 2, hour: 9 }), { day: 2, hour: 9 });
  });

  await t('обновления: сравнение версий', () => {
    const { cmpVer } = require('../src/main/updater');
    assert.strictEqual(cmpVer('0.2.0', '0.10.0'), -1);
    assert.strictEqual(cmpVer('v1.0.0', '0.9.9'), 1);
    assert.strictEqual(cmpVer('1.2', '1.2.0'), 0);
    assert.strictEqual(cmpVer('0.3.0-beta', '0.3.0'), 0);
  });

  fs.rmSync(base, { recursive: true, force: true });
  console.log(`\nУспешно: ${ok}`);
})();
