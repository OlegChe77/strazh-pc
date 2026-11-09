// Страж ПК — главный процесс. Все опасные действия выполняются здесь и только по номерам (id) из последней проверки:
// окно программы не может передать произвольный путь для удаления или переноса.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, Notification } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const names = require('./names');
const migrate = require('./migrate');
app.setName(names.APP);
app.setAppUserModelId('ru.olegche.strazhpc');
// Только при разработке: STRAZH_TEST_DIR подменяет личные папки и данные программы тестовыми (для scripts/e2e.js).
const TEST_DIR = !app.isPackaged && process.env.STRAZH_TEST_DIR;
if (TEST_DIR) {
  app.setPath('userData', path.join(TEST_DIR, 'data'));
  for (const n of ['pictures', 'videos', 'documents', 'desktop', 'downloads', 'music']) app.setPath(n, path.join(TEST_DIR, n));
} else app.setPath('userData', path.join(app.getPath('appData'), names.DATA_DIR));

const HELP_URL = 'https://dalink.to/olegche';
const paths = require('./lib/paths');
const storeLib = require('./lib/store');
const quarantineLib = require('./quarantine');
const threats = require('./threats');
const actions = require('./threats/actions');
const spaceScan = require('./space/scan');
const compress = require('./space/compress');
const { trash, freeName } = require('./lib/fsops');
const vaultLib = require('./vault');
const extensions = require('./threats/extensions');
const organize = require('./space/organize');
const weekly = require('./space/weekly');
const updaterLib = require('./updater');

// Запуск по расписанию без окна: программа только готовит сжатые копии.
const headless = process.argv.includes('--weekly');

let win = null, store = null, quarantine = null, vault = null, ledger = null, orgLog = null, taskMigration = Promise.resolve();
const own = { exe: process.execPath, dir: path.dirname(process.execPath) };
const outRoot = TEST_DIR ? path.join(TEST_DIR, 'out') : path.join(os.homedir(), names.COPIES_DIR);
const legacyOutRoot = TEST_DIR ? null : path.join(os.homedir(), names.LEGACY.COPIES_DIR);
const outSkip = [outRoot, legacyOutRoot].filter(Boolean);   // обе папки копий не сканируем (старая могла остаться при неполном переносе)

const state = {
  findings: new Map(),      // id → находка
  lastThreats: null,
  space: null,              // результат поиска места
  spaceItems: new Map(),    // id → файл из поиска (для уборки/сжатия)
  ext: new Map(),           // id → дополнение браузера
  vaultPending: [],         // файлы, только что положенные в сейф (оригиналы ждут решения)
  orgItems: new Map(),      // id → файл из плана «разложить по папкам»
  busy: null, cancel: false, killer: null
};
let seq = 0;
const nid = p => p + (++seq);

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const roots = () => {
  const extra = (store.get('extraRoots') || []).filter(paths.isAllowedUserFolder);
  const all = [...paths.defaultRoots(n => app.getPath(n)), ...extra];
  const seen = new Set();
  return all.filter(r => { const k = paths.norm(r); if (seen.has(k)) return false; seen.add(k); return true; })
    // вложенная папка уже входит в родительскую
    .filter((r, i, a) => !a.some((o, j) => j !== i && paths.isInside(r, o) && paths.norm(r) !== paths.norm(o)));
};
const installerRoots = () => [app.getPath('downloads'), app.getPath('desktop')];

const publicFinding = f => ({ id: f.id, level: f.level, kind: f.kind, title: f.title, what: f.what, risk: f.risk, advice: f.advice, path: f.path, reasons: f.reasons || [], actions: f.actions || [] });
const toErr = e => ({ ok: false, error: (e && e.message) || String(e) });

// ---------- проверка ----------
async function runThreats(onProgress) {
  if (TEST_DIR && process.env.STRAZH_DEMO) { // вымышленные находки для скриншотов (scripts/demo.js), только при разработке
    const demo = require('../../scripts/demo');
    state.findings.clear();
    const fs2 = demo.findings.map(f => ({ ...f, id: nid('t'), key: 'demo:' + f.title }));
    for (const f of fs2) state.findings.set(f.id, f);
    return { findings: fs2.map(publicFinding), stats: demo.stats, errors: [], ignoredCount: 0, at: new Date().toISOString() };
  }
  const secretRoots = [app.getPath('documents'), app.getPath('desktop')].filter(fs.existsSync);
  const r = await threats.scan({ secretRoots, own, ignored: store.get('ignored') || [], onProgress, isCancelled: () => state.cancel });
  state.findings.clear();
  for (const f of r.findings) { f.id = nid('t'); state.findings.set(f.id, f); }
  state.lastThreats = { at: new Date().toISOString(), stats: r.stats, errors: r.errors, ignoredCount: r.ignoredCount };
  return { findings: r.findings.map(publicFinding), stats: r.stats, errors: r.errors, ignoredCount: r.ignoredCount, at: state.lastThreats.at };
}

function indexSpace(r) {
  state.spaceItems.clear();
  const reg = (it, kind) => { it.id = nid('s'); it.kind = kind; state.spaceItems.set(it.id, it); return it; };
  for (const k of ['jpg', 'png', 'video']) r.files[k].forEach(it => reg(it, k));
  r.files.installer.forEach(it => reg(it, 'installer'));
  r.dupGroups.forEach(g => { reg(g.keep, 'dup-keep'); g.extras.forEach(it => reg(it, 'dup')); });
}

async function runSpace(onProgress) {
  const r = await spaceScan.scan({ roots: roots(), outRoot: outSkip, quarantineDir: quarantine.dir, installerRoots: installerRoots(), onProgress, isCancelled: () => state.cancel });
  indexSpace(r);
  state.space = r;
  return spacePublic();
}

const lite = it => ({ id: it.id, name: path.basename(it.path), dir: path.dirname(it.path), size: it.size, mtime: it.mtime });
function spacePublic() {
  const r = state.space; if (!r) return null;
  return { visited: r.visited, summary: r.summary, roots: roots(), extra: store.get('extraRoots') || [], outRoot };
}

function guarded(name, fn) {
  ipcMain.handle(name, async (_e, ...a) => { try { return await fn(...a); } catch (e) { return toErr(e); } });
}
function exclusive(kind, fn) {
  return async (...a) => {
    if (state.busy) return { ok: false, error: 'Я ещё занят другой работой — подождите немного.' };
    state.busy = kind; state.cancel = false;
    try { return await fn(...a); } finally { state.busy = null; state.killer = null; }
  };
}

function registerIpc() {
  guarded('app:info', () => ({ version: app.getVersion(), lastScan: store.get('lastScan'), weeklyRunning: state.busy === 'weekly', pending: pendingInfo(), ignored: (store.get('ignored') || []).length, roots: roots(), outRoot, helpUrl: HELP_URL }));

  guarded('scan:all', exclusive('scan', async () => {
    const t = await runThreats(p => send('progress', { pct: Math.round(p.pct * 0.8), text: p.text }));
    send('progress', { pct: 82, text: 'Считаю, сколько места можно освободить…' });
    let sp = null;
    try { sp = await runSpace(p => send('progress', { pct: 90, text: 'Считаю, сколько места можно освободить… ' + (p.text || '') })); }
    catch (e) { t.errors.push('Поиск места: ' + e.message); }
    store.set('lastScan', new Date().toISOString());
    send('progress', { pct: 100, text: 'Готово!' });
    return { ok: true, threats: t, space: sp, cancelled: state.cancel };
  }));
  guarded('scan:cancel', () => { state.cancel = true; if (state.killer) state.killer(); return { ok: true }; });

  guarded('finding:act', async (id, action) => {
    const f = state.findings.get(id);
    if (!f) return { ok: false, error: 'Эта находка уже устарела — проверьте компьютер ещё раз.' };
    if (action === 'ignore') {
      const ig = new Set(store.get('ignored') || []); ig.add(f.key); store.set('ignored', [...ig]);
      state.findings.delete(id); return { ok: true, log: ['Больше не буду показывать эту находку.'], problems: [] };
    }
    if (!(f.actions || []).includes(action)) return { ok: false, error: 'Это действие здесь недоступно.' };
    if (action === 'reveal') {
      const p = f.target.file || f.target.folder;
      if (p && fs.existsSync(p)) shell.showItemInFolder(p); else return { ok: false, error: 'Файл уже не лежит на прежнем месте.' };
      return { ok: true, keep: true };
    }
    let r;
    if (action === 'neutralize') r = await actions.neutralize(f, quarantine, own);
    else if (action === 'quarantine') r = await actions.quarantineOnly(f, quarantine);
    else if (action === 'closeshare') r = await actions.closeShare(f, store);
    else if (action === 'closeport') r = await actions.closePort(f, store);
    else return { ok: false, error: 'Неизвестное действие.' };
    state.findings.delete(id);
    return { ok: true, ...r };
  });
  guarded('ignored:reset', () => { store.set('ignored', []); return { ok: true }; });

  guarded('quarantine:list', () => quarantine.list().map(e => ({ id: e.id, name: e.name || '(только запись автозапуска)', original: e.original, size: e.size, date: e.date, reason: e.reason, hasFile: !!e.original })));
  guarded('quarantine:restore', async id => { const r = await quarantine.restore(id); return { ok: true, restoredTo: r.restoredTo }; });
  guarded('quarantine:purge', async id => { await quarantine.purge(id); return { ok: true }; });

  // ----- место на диске -----
  guarded('space:scan', exclusive('space', async () => {
    const r = await runSpace(p => send('progress', { pct: 50, text: p.text }));
    return { ok: true, space: r };
  }));
  guarded('space:review', category => {
    const r = state.space; if (!r) return { ok: false, error: 'Сначала нажмите «Найти».' };
    if (category === 'dup') return { ok: true, groups: r.dupGroups.map(g => ({ keep: lite(g.keep), extras: g.extras.map(lite) })) };
    if (category === 'installer') return { ok: true, files: r.files.installer.map(lite) };
    return { ok: false, error: 'Неизвестный список.' };
  });
  // В Корзину — только то, что было показано в списке и подтверждено; оригинал в группе дубликатов остаётся всегда.
  guarded('space:trash', exclusive('trash', async ids => {
    const keepIds = new Set(state.space ? state.space.dupGroups.map(g => g.keep.id) : []);
    let n = 0, bytes = 0; const problems = [];
    for (const id of ids || []) {
      const it = state.spaceItems.get(id);
      if (!it || !['dup', 'installer'].includes(it.kind) || keepIds.has(id)) { problems.push('Пропущен неизвестный файл'); continue; }
      if (!paths.isCleanable(it.path, roots())) { problems.push(`${path.basename(it.path)}: лежит в защищённой папке`); continue; }
      try {
        const st = fs.statSync(it.path);
        if (st.size !== it.size) throw new Error('файл изменился после поиска');
        if (it.kind === 'dup') { // последняя проверка: оригинал на месте, иначе удалять копию нельзя
          const g = state.space.dupGroups.find(x => x.extras.includes(it));
          if (!g || !fs.existsSync(g.keep.path)) throw new Error('исходный файл не найден');
        }
        await trash(it.path); n++; bytes += it.size; state.spaceItems.delete(id);
      } catch (e) { problems.push(`${path.basename(it.path)}: ${e.message}`); }
    }
    return { ok: true, count: n, bytes, problems };
  }));

  guarded('space:compress', exclusive('compress', async kinds => {
    const want = new Set((kinds || []).filter(k => ['jpg', 'png', 'video'].includes(k)));
    if (!want.size || !state.space) return { ok: false, error: 'Отметьте хотя бы один пункт.' };
    const items = [];
    for (const k of want) for (const it of state.space.files[k]) if (paths.isCleanable(it.path, roots())) items.push(it);
    // самые тяжёлые — первыми
    items.sort((a, b) => b.size - a.size);
    const results = await compress.compressAll({
      items, roots: roots(), outRoot,
      onFile: p => send('space:progress', p),
      onResult: r => recordCompressed(r, state.spaceItems.get(r.id)),
      isCancelled: () => state.cancel, setKill: k => { state.killer = k; }
    });
    ledger.flushSeen();
    return { ok: true, ...summarize(results), cancelled: state.cancel };
  }));

  // Замена оригиналов копиями: оригинал уходит в Корзину, только после «Да» пользователя. Работает со всеми готовыми копиями
  // (и сделанными только что, и подготовленными по расписанию).
  guarded('space:pending', () => ({ ok: true, ...pendingInfo() }));
  guarded('space:replace', exclusive('replace', async () => {
    let n = 0, saved = 0; const problems = [];
    for (const r of ledger.pending()) {
      if (!paths.isCleanable(r.original, roots())) { problems.push(path.basename(r.original) + ': защищённая папка'); continue; }
      try {
        const target = await compress.replaceOriginal(r);
        ledger.removePending(r.original); n++; saved += r.before - r.after;
        try { const st = fs.statSync(target); ledger.markSeen({ path: target, size: st.size, mtime: st.mtimeMs }); } catch { /* не критично */ }
      } catch (e) {
        problems.push(`${path.basename(r.original)}: ${e.message}`);
        if (/изменился|не найден/.test(e.message)) ledger.removePending(r.original); // копия устарела
      }
    }
    ledger.flushSeen();
    return { ok: true, count: n, saved, problems };
  }));
  guarded('space:openOutput', async () => { fs.mkdirSync(outRoot, { recursive: true }); await shell.openPath(outRoot); return { ok: true }; });
  guarded('space:addFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Какую папку тоже посмотреть?', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: true, added: false };
    const p = r.filePaths[0];
    if (!paths.isAllowedUserFolder(p)) return { ok: false, error: 'В эту папку я не захожу: это системная папка Windows, данные программ или корень диска.' };
    const ex = store.get('extraRoots') || [];
    if (!ex.some(x => paths.norm(x) === paths.norm(p))) { ex.push(p); store.set('extraRoots', ex); }
    return { ok: true, added: true, roots: roots() };
  });
  guarded('space:removeFolder', p => { store.set('extraRoots', (store.get('extraRoots') || []).filter(x => paths.norm(x) !== paths.norm(p))); return { ok: true, roots: roots() }; });

  // ----- сейф -----
  const VAULT_IDLE = 10 * 60 * 1000; let vaultTimer = null;
  const vtouch = () => { clearTimeout(vaultTimer); vaultTimer = setTimeout(() => { vault.lock(); state.vaultPending = []; }, VAULT_IDLE); };
  guarded('vault:status', () => ({ ok: true, ...vault.status(), minPass: vaultLib.MIN_PASS }));
  guarded('vault:create', async pw => { await vault.setup(pw); vtouch(); return { ok: true }; });
  guarded('vault:unlock', async pw => { await vault.unlock(pw); vtouch(); return { ok: true }; });
  guarded('vault:lock', () => { vault.lock(); state.vaultPending = []; clearTimeout(vaultTimer); return { ok: true }; });
  guarded('vault:list', () => { const l = vault.list(); vtouch(); return { ok: true, ...l, pending: state.vaultPending.length }; });
  guarded('vault:addNote', async n => { const id = await vault.addNote(n || {}); vtouch(); return { ok: true, id }; });
  guarded('vault:getNote', id => { const n = vault.getNote(id); vtouch(); return { ok: true, note: n }; });
  guarded('vault:deleteNote', async id => { await vault.deleteNote(id); vtouch(); return { ok: true }; });
  guarded('vault:copy', (id, field) => {
    if (!['password', 'login'].includes(field)) return { ok: false, error: 'Нечего копировать.' };
    const v = vault.getNote(id)[field] || ''; if (!v) return { ok: false, error: 'Поле пустое.' };
    clipboard.writeText(v); vtouch();
    setTimeout(() => { try { if (clipboard.readText() === v) clipboard.clear(); } catch { /* окно закрыто */ } }, 30000);
    return { ok: true };
  });
  // Файлы копируются в сейф зашифрованными и проверяются; оригиналы остаются, пока пользователь не скажет «в Корзину».
  guarded('vault:addFiles', exclusive('vault', async () => {
    vault.list(); // бросит ошибку, если сейф закрыт
    const r = await dialog.showOpenDialog(win, { title: 'Какие файлы положить в сейф?', properties: ['openFile', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return { ok: true, added: [], failed: [], pending: state.vaultPending.length };
    const added = [], failed = [];
    for (const f of r.filePaths) {
      const name = path.basename(f);
      try {
        if (paths.isSystemPath(f) || paths.isAppData(f) || paths.isInside(f, vault.dir)) throw new Error('этот файл брать нельзя (системный или служебный)');
        const st = fs.statSync(f); if (!st.isFile()) throw new Error('это не файл');
        const e = await vault.addFile(f);
        added.push({ name: e.name, size: e.size }); state.vaultPending.push({ path: f, size: st.size, mtime: st.mtimeMs });
      } catch (e) { failed.push(`${name}: ${e.message}`); }
    }
    vtouch();
    return { ok: true, added, failed, pending: state.vaultPending.length };
  }));
  guarded('vault:trashOriginals', exclusive('vaulttrash', async () => {
    let n = 0; const problems = [];
    for (const p of state.vaultPending) {
      try {
        const st = fs.statSync(p.path);
        if (st.size !== p.size || st.mtimeMs !== p.mtime) throw new Error('файл изменился после копирования в сейф — оставил на месте');
        await trash(p.path); n++;
      } catch (e) { problems.push(`${path.basename(p.path)}: ${e.message}`); }
    }
    state.vaultPending = []; vtouch();
    return { ok: true, count: n, problems };
  }));
  guarded('vault:keepOriginals', () => { state.vaultPending = []; return { ok: true }; });
  guarded('vault:export', async id => {
    const r = await dialog.showOpenDialog(win, { title: 'Куда положить файл из сейфа?', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: true, saved: false };
    const dest = await vault.exportFile(id, r.filePaths[0], freeName); vtouch();
    shell.showItemInFolder(dest);
    return { ok: true, saved: true, path: dest };
  });
  guarded('vault:removeFile', async id => { await vault.removeFile(id); vtouch(); return { ok: true }; });

  // ----- дополнения браузера -----
  guarded('ext:scan', exclusive('ext', async () => {
    const r = extensions.scan();
    state.ext.clear();
    const items = r.items.map(it => { it.uid = nid('e'); state.ext.set(it.uid, it); return {
      id: it.uid, browser: it.browser, browserName: it.browserName, profiles: it.profiles, name: it.name, version: it.version, level: it.level,
      what: it.what, risk: it.risk, advice: it.advice, reasons: it.reasons, origin: it.origin, disabled: it.disabled, canOpen: !!extensions.findBrowserExe(it.browser) }; });
    return { ok: true, browsers: r.browsers, errors: r.errors, items };
  }));
  guarded('ext:act', async (id, action) => {
    const it = state.ext.get(id); if (!it) return { ok: false, error: 'Эта запись устарела — проверьте браузеры ещё раз.' };
    if (action === 'reveal') {
      if (!it.dir || !fs.existsSync(it.dir)) return { ok: false, error: 'Папка дополнения не найдена.' };
      if (fs.statSync(it.dir).isDirectory()) await shell.openPath(it.dir); else shell.showItemInFolder(it.dir);
      return { ok: true };
    }
    if (action === 'openlist') {
      const b = extensions.findBrowserExe(it.browser); if (!b) return { ok: false, error: 'Не нашёл, где установлен браузер. Откройте его сами: Меню → Расширения.' };
      const url = b.url.endsWith('=') ? b.url + it.id : b.url;
      const prof = it.profiles[0], args = [];
      if (it.browser !== 'firefox' && /^(Default|Profile \d+)$/.test(prof)) args.push('--profile-directory=' + prof);
      args.push(url);
      spawn(b.exe, args, { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    return { ok: false, error: 'Неизвестное действие.' };
  });

  // ----- разложить фото и видео по папкам год/месяц -----
  const orgRoots = () => organize.eligibleRoots(roots(), store.get('extraRoots') || [], app.getPath('pictures'), app.getPath('videos'));
  guarded('organize:state', () => ({ ok: true, roots: orgRoots(), undo: organize.undoInfo(orgLog) }));
  guarded('organize:plan', exclusive('organize', async () => {
    const er = orgRoots();
    if (!er.length) return { ok: false, error: 'Не нашёл папок «Изображения» и «Видео». Добавьте нужную папку кнопкой «+ Добавить папку».' };
    const p = await organize.plan({ roots: er, outRoot: outSkip,quarantineDir: quarantine.dir, isCancelled: () => state.cancel, onProgress: x => send('progress', { pct: 50, text: x.text }) });
    state.orgItems.clear();
    p.items.forEach(it => { it.id = nid('o'); state.orgItems.set(it.id, it); });
    const src = { exif: 0, name: 0, mtime: 0 }; p.items.forEach(it => src[it.source]++);
    return { ok: true, roots: er, total: p.items.length, groups: p.groups, src, undo: organize.undoInfo(orgLog) };
  }));
  guarded('organize:apply', exclusive('organizeapply', async keys => {
    const want = new Set((keys || []).map(String));
    const items = [...state.orgItems.values()].filter(it => want.has(it.key));
    if (!items.length) return { ok: false, error: 'Ничего не выбрано.' };
    const r = await organize.apply({ items, logFile: orgLog, isCancelled: () => state.cancel, onProgress: p => send('space:progress', p) });
    state.orgItems.clear(); state.space = null; // содержимое папок изменилось — поиск места надо повторить
    return { ok: true, ...r, undo: organize.undoInfo(orgLog) };
  }));
  guarded('organize:undo', exclusive('organizeundo', async () => {
    const r = await organize.undo({ logFile: orgLog }); state.space = null;
    return { ok: true, ...r, undo: organize.undoInfo(orgLog) };
  }));

  // ----- копии раз в неделю -----
  guarded('weekly:get', async () => ({ ok: true, ...(await weeklyState()) }));
  guarded('weekly:set', async c => {
    c = c || {};
    const cur = weeklyCfg();
    const next = { ...cur,
      enabled: !!c.enabled,
      day: Number.isInteger(c.day) && c.day >= 0 && c.day <= 6 ? c.day : cur.day,
      hour: Number.isInteger(c.hour) && c.hour >= 0 && c.hour <= 23 ? c.hour : cur.hour,
      kinds: (c.kinds || cur.kinds).filter(k => ['jpg', 'png', 'video'].includes(k)) };
    if (next.enabled && !next.kinds.length) return { ok: false, error: 'Отметьте, что готовить: фото, картинки или видео.' };
    if (next.enabled) await weekly.schedule({ ...weeklyCommand(), day: next.day, hour: next.hour });
    else await weekly.unschedule();
    store.set('weekly', next);
    return { ok: true, ...(await weeklyState()) };
  });

  guarded('report:save', async text => {
    const r = await dialog.showSaveDialog(win, { title: 'Сохранить отчёт', defaultPath: path.join(app.getPath('documents'), 'StrazhPC report.txt'), filters: [{ name: 'Текст', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return { ok: true, saved: false };
    fs.writeFileSync(r.filePath, String(text).slice(0, 2e6), 'utf8');
    return { ok: true, saved: true, path: r.filePath };
  });
  guarded('update:get', () => updater.get());
  guarded('update:check', async () => ({ ...(await updater.check()), auto: autoUpdateOn() }));
  guarded('update:install', () => updater.install());
  guarded('update:setAuto', on => { store.set('autoUpdate', !!on); return { ok: true, auto: autoUpdateOn() }; });
  guarded('help:open', () => { shell.openExternal(HELP_URL); return { ok: true }; });
}

// ---------- копии по расписанию ----------
const weeklyCfg = () => ({ enabled: false, day: 0, hour: 12, kinds: ['jpg', 'png', 'video'], lastRun: null, lastSummary: null, ...(store.get('weekly') || {}) });
function weeklyCommand() {
  // у portable-версии настоящий путь к файлу лежит в переменной, а не в process.execPath (там временная папка)
  if (app.isPackaged) return { exe: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: '--weekly' };
  return { exe: process.execPath, args: `"${app.getAppPath()}" --weekly` };
}
function pendingInfo() {
  const p = ledger.pending();
  return { count: p.length, saved: p.reduce((s, r) => s + r.before - r.after, 0), before: p.reduce((s, r) => s + r.before, 0) };
}
async function weeklyState() {
  const cfg = weeklyCfg();
  await taskMigration;   // старое задание переезжает на новое имя до того, как мы решим, что «расписания нет»
  let task = null; try { task = await weekly.scheduleInfo(); } catch { /* планировщик недоступен */ }
  // Если пользователь удалил задание сам — честно показываем, что расписания нет.
  if (cfg.enabled && task && !task.exists) { cfg.enabled = false; store.set('weekly', cfg); }
  return { cfg, task, pending: pendingInfo(), running: state.busy === 'weekly', outRoot, packaged: app.isPackaged };
}
// Результат сжатия одного файла: запоминаем, что файл обработан, и что копия ждёт решения «заменить оригинал?».
function recordCompressed(r, it) {
  if (it && (r.status === 'done' || r.status === 'skipped')) ledger.markSeen(it);
  if (r.status === 'done') ledger.addPending(r);
}
async function runWeeklyJob() {
  const cfg = weeklyCfg();
  if (!cfg.enabled) return;
  state.busy = 'weekly'; state.cancel = false;
  const sum = { done: 0, skipped: 0, failed: 0, before: 0, after: 0 };
  try {
    try { os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* не критично */ }
    const rs = roots();
    const sc = await spaceScan.scan({ roots: rs, outRoot: outSkip, quarantineDir: quarantine.dir, installerRoots: [], skipDup: true, isCancelled: () => state.cancel });
    const items = [];
    for (const k of cfg.kinds) for (const it of sc.files[k] || []) {
      if (!paths.isCleanable(it.path, rs) || ledger.isSeen(it)) continue;
      it.id = nid('w'); it.kind = k; items.push(it);
    }
    items.sort((a, b) => b.size - a.size);
    const byId = new Map(items.map(i => [i.id, i]));
    await compress.compressAll({
      items, roots: rs, outRoot,
      onFile: p => send('space:progress', p),
      onResult: r => { recordCompressed(r, byId.get(r.id)); if (r.status === 'done') { sum.done++; sum.before += r.before; sum.after += r.after; } else if (r.status === 'skipped') sum.skipped++; else sum.failed++; },
      isCancelled: () => state.cancel, setKill: k => { state.killer = k; }
    });
    ledger.flushSeen();
  } catch (e) { sum.error = e.message; }
  finally { state.busy = null; state.killer = null; }
  store.set('weekly', { ...cfg, lastRun: new Date().toISOString(), lastSummary: sum });
  if (sum.done && Notification.isSupported()) new Notification({ title: 'Страж ПК', body: `Подготовил сжатые копии: ${sum.done} шт. Откройте программу — решите, заменять ли оригиналы.` }).show();
}

function summarize(results) {
  const done = results.filter(r => r.status === 'done');
  return {
    total: results.length, done: done.length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'error').map(r => ({ name: path.basename(r.original), note: r.note })),
    before: done.reduce((s, r) => s + r.before, 0), after: done.reduce((s, r) => s + r.after, 0)
  };
}

const autoUpdateOn = () => store.get('autoUpdate') !== false;
let updater = null;
function setupUpdater() {
  updater = updaterLib.create({
    isAuto: autoUpdateOn,
    send: (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); },
    canInstall: () => state.busy ? 'Я ещё занят другой работой — подождите, пока закончу, и нажмите «Обновить» снова.' : null
  });
  // раз в запуск, не сразу: окно должно успеть открыться. Выключается в «Ещё → Обновления».
  if (app.isPackaged && !headless && !TEST_DIR && autoUpdateOn()) setTimeout(() => updater.check().catch(() => {}), 8000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 780, minWidth: 720, minHeight: 560, backgroundColor: '#050805', title: 'Страж ПК', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (url === HELP_URL) shell.openExternal(HELP_URL); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (!win || win.isDestroyed()) createWindow(); else { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Данные и копии из папок с русскими именами (прошлые версии) переезжают в новые; до открытия хранилищ.
    if (!TEST_DIR) {
      try { migrate.migrateAll({ oldData: path.join(app.getPath('appData'), names.LEGACY.DATA_DIR), newData: app.getPath('userData'), oldCopies: legacyOutRoot, newCopies: outRoot }); }
      catch (e) { console.error('Перенос старых данных:', e.message); }
    }
    store = storeLib.create(app.getPath('userData'));
    quarantine = quarantineLib.create(path.join(app.getPath('userData'), 'quarantine'));
    vault = vaultLib.create(path.join(app.getPath('userData'), 'vault'));
    ledger = weekly.createLedger(app.getPath('userData'));
    orgLog = path.join(app.getPath('userData'), 'organize-log.json');
    // Старое задание Планировщика («Страж ПК — копии раз в неделю») пересоздаём под новым именем. Только в установленной программе
    // и не в фоновом запуске (иначе удалили бы задание, из которого мы сейчас запущены).
    if (app.isPackaged && !headless) {
      const cfg = weeklyCfg();
      taskMigration = weekly.migrateTask({ ...weeklyCommand(), fallback: { day: cfg.day, hour: cfg.hour } })
        .then(r => { if (r.status === 'migrated') store.set('weekly', { ...weeklyCfg(), enabled: true, day: r.day, hour: r.hour }); })
        .catch(e => console.error('Перенос задания Планировщика:', e.message));
    }
    setupUpdater();
    registerIpc();
    if (headless) runWeeklyJob().finally(() => { if (!win || win.isDestroyed()) setTimeout(() => app.quit(), 5000); });
    else createWindow();
    if (!headless && !app.isPackaged && process.env.STRAZH_SHOTS) require('../../scripts/ui-smoke')({ win, app });
  });
  app.on('window-all-closed', () => { if (headless && state.busy === 'weekly') return; app.quit(); });
}
