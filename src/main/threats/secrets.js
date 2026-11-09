// Файлы с паролями и ключами на виду: «Документы» и «Рабочий стол» (с вложенными папками).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const T = require('./texts');

const NAME_TOKENS = new Set(['пароль', 'пароли', 'парольи', 'логин', 'логины', 'password', 'passwords', 'passwd', 'pass', 'pwd', 'pwds', 'credentials', 'creds',
  'секрет', 'секреты', 'secret', 'secrets', 'seed', 'mnemonic', 'wallet', 'кошелек', 'кошелёк', 'ключи', 'keys', 'токен', 'token', 'tokens', 'пин', 'pin']);
const TEXT_EXT = new Set(['.txt', '.csv', '.md', '.json', '.ini', '.env', '.cfg', '.conf', '.rtf', '.xml', '.yml', '.yaml', '.log', '.note', '']);
const NAME_EXT = new Set([...TEXT_EXT, '.doc', '.docx', '.xls', '.xlsx', '.odt', '.ods', '.pdf']);
const KEY_EXT = new Set(['.pem', '.key', '.ppk', '.pfx', '.p12', '.ovpn', '.kdbx_']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', 'strazhpc compressed copies', 'сжатые копии (страж пк)']);
const PASS_LINE = /(парол[ьяю]|password|passwd|pwd|\bpass\b)\s*[:=\-–—]\s*(?!\*{2,}|x{3,}|_{2,}|<|\.{3,})\S{3,}/ig;
const KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

const tokens = name => name.toLowerCase().replace(/\.[^.]+$/, '').split(/[^a-zа-яё0-9]+/i).filter(Boolean);

async function* walk(dir, depth, maxDepth) {
  let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (depth < maxDepth && !SKIP_DIRS.has(e.name.toLowerCase())) yield* walk(p, depth + 1, maxDepth); }
    else if (e.isFile()) yield p;
  }
}

// Ищет файлы с паролями и ключами. offlineFilter(files) → Set файлов, которых нет на диске целиком
// (облако «по запросу»): их содержимое НЕ читаем, чтобы не заставлять облако скачивать файл.
async function findSecretFiles(roots, { depth = 4, limit = 40000, offlineFilter = null, seen = new Set() } = {}) {
  let n = 0; const found = [], cand = [];
  outer: for (const root of roots) {
    for await (const file of walk(root, 0, depth)) {
      if (seen.has(file.toLowerCase())) continue; seen.add(file.toLowerCase());
      if (++n > limit) break outer;
      const ext = path.extname(file).toLowerCase(), name = path.basename(file);
      const nameHit = NAME_EXT.has(ext) && tokens(name).some(t => NAME_TOKENS.has(t));
      const isKey = KEY_EXT.has(ext) || /^id_(rsa|ed25519|ecdsa|dsa)$/i.test(name);
      const textLike = TEXT_EXT.has(ext);
      if (!nameHit && !isKey && !textLike) continue;
      let st; try { st = await fsp.stat(file); } catch { continue; }
      if (st.size === 0) continue;
      if (st.size > 512 * 1024) { if (nameHit) found.push({ file, why: 'name', st }); continue; }
      cand.push({ file, nameHit, isKey, textLike, st });
    }
  }
  const readable = cand.filter(c => c.textLike || c.isKey);
  const offline = offlineFilter && readable.length ? await offlineFilter(readable.map(c => c.file)) : new Set();
  let skippedOffline = 0;
  for (const c of cand) {
    const { file, nameHit, isKey, textLike, st } = c;
    let content = '';
    if (textLike || isKey) {
      if (offline.has(file.toLowerCase())) {
        skippedOffline++;
        if (nameHit || isKey) found.push({ file, why: 'name', st, offline: true });
        continue;
      }
      try { content = await fsp.readFile(file, 'utf8'); } catch { /* не читается */ }
    }
    if (content && KEY_BLOCK.test(content)) { found.push({ file, why: 'key', st }); continue; }
    const m = content ? content.match(PASS_LINE) : null;
    if (m && m.length >= 2) found.push({ file, why: 'content', count: m.length, st, nameHit });
    else if (nameHit && textLike && content && /\S/.test(content)) found.push({ file, why: 'name', st });
    else if (nameHit && !textLike) found.push({ file, why: 'name', st });
  }
  found.sort((a, b) => (b.count || 0) - (a.count || 0));
  return { found, scanned: n, skippedOffline };
}

async function check(ctx, progress, { roots = [] } = {}) {
  const { found, scanned } = await findSecretFiles(roots, { offlineFilter: require('./cloudfiles').offlineSet });
  ctx.stats.files = scanned;
  for (const f of found.slice(0, 15)) {
    const key = f.why === 'key';
    const t = key ? T.key : T.secrets;
    const reasons = f.why === 'content' ? [`В файле нашлось строк, похожих на «пароль: значение»: ${f.count}.`]
      : key ? ['Внутри файла — закрытый (секретный) ключ.']
        : ['По названию похоже на файл с паролями. Содержимое программа не читала дальше проверки на пароли.'];
    if (f.offline) reasons.push('Файл лежит в облаке и не скачан на компьютер — я его не открывал, чтобы не запускать скачивание.');
    ctx.add({
      kind: key ? 'key' : 'secrets', level: 'warn',
      title: `${t.title}: ${path.basename(f.file)}`, what: t.what, risk: t.risk, advice: t.advice,
      path: f.file, reasons, target: { file: f.file, user: true }, actions: ['quarantine', 'reveal']
    });
  }
  if (found.length > 15) {
    ctx.add({
      kind: 'secrets-more', level: 'warn', title: `Ещё файлов с паролями: ${found.length - 15}`,
      what: 'Нашлись и другие файлы, похожие на записи с паролями. Показываю самые важные.', risk: T.secrets.risk,
      advice: 'Разберитесь с найденными выше, затем проверьте компьютер ещё раз — покажу следующие.',
      path: '', reasons: [], target: { name: 'more' }, actions: []
    });
  }
}
module.exports = { check, findSecretFiles, tokens, NAME_TOKENS };
