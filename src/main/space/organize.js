// «Разложить фото и видео по папкам год/месяц». Файлы только переносятся (никогда не удаляются и не перезаписываются);
// каждый перенос записывается в журнал, так что всё можно вернуть кнопкой «Вернуть как было».
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { moveFile, freeName } = require('../lib/fsops');
const { isCleanable, isInside, norm } = require('../lib/paths');

const IMG = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif', '.tif', '.tiff', '.dng', '.cr2', '.nef', '.arw']);
const VID = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm', '.mpg', '.mpeg', '.flv', '.3gp', '.mts', '.m2ts']);
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const BASE = 'По датам';
// Подпапки, в которых телефоны и Windows складывают снимки россыпью. Остальные папки (альбомы, поездки) не трогаем.
const GENERIC = new Set(['camera roll', 'camera', 'screenshots', 'saved pictures', 'снимки экрана', 'пленка', 'плёнка', 'dcim', 'whatsapp images', 'whatsapp video', 'telegram']);

const yearOk = y => y >= 1990 && y <= new Date().getFullYear() + 1;
const mk = (y, mo, d, h = 12, mi = 0, s = 0) => { const dt = new Date(y, mo - 1, d, h, mi, s); return dt.getMonth() === mo - 1 ? dt : null; };

// ---- дата съёмки из EXIF (JPEG), без сторонних библиотек ----
function parseTiffDate(t) {
  if (t.length < 12) return null;
  const le = t.toString('latin1', 0, 2) === 'II';
  const r16 = o => (le ? t.readUInt16LE(o) : t.readUInt16BE(o)), r32 = o => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const str = (e) => { const cnt = r32(e + 4), off = cnt > 4 ? r32(e + 8) : e + 8; return t.toString('latin1', off, off + cnt).replace(/\0.*$/, ''); };
  const ifd = off => { const m = {}; const n = r16(off); for (let i = 0; i < n && i < 400; i++) { const e = off + 2 + i * 12; m[r16(e)] = e; } return m; };
  const i0 = ifd(r32(4));
  const tags = [];
  if (i0[0x8769] != null) { const ex = ifd(r32(i0[0x8769] + 8)); if (ex[0x9003] != null) tags.push(str(ex[0x9003])); if (ex[0x9004] != null) tags.push(str(ex[0x9004])); }
  if (i0[0x0132] != null) tags.push(str(i0[0x0132]));
  for (const s of tags) {
    const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s);
    if (m && yearOk(+m[1])) { const d = mk(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]); if (d) return d; }
  }
  return null;
}
function exifDate(buf) {
  try {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
    let p = 2;
    while (p + 4 < buf.length) {
      if (buf[p] !== 0xFF) return null;
      const m = buf[p + 1], len = buf.readUInt16BE(p + 2);
      if (m === 0xE1 && buf.toString('latin1', p + 4, p + 10) === 'Exif\0\0') return parseTiffDate(buf.subarray(p + 10, p + 2 + len));
      if (m === 0xDA || m === 0xD9) return null;
      p += 2 + len;
    }
  } catch { /* битый заголовок — не страшно */ }
  return null;
}
async function readHead(file, n = 262144) {
  const fh = await fsp.open(file, 'r');
  try { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, 0); return b.subarray(0, bytesRead); } finally { await fh.close(); }
}

// ---- дата из имени файла: IMG_20230415_…, 2023-04-15 12.30.00, Screenshot_2023-04-15 … ----
function nameDate(name) {
  const m = /(?:^|[^0-9])((?:19|20)\d\d)[-_. ]?(0[1-9]|1[0-2])[-_. ]?(0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/.exec(name);
  if (m && yearOk(+m[1])) return mk(+m[1], +m[2], +m[3]);
  return null;
}

async function dateOf(file, st) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    try { const d = exifDate(await readHead(file)); if (d) return { date: d, source: 'exif' }; } catch { /* нет доступа — берём из имени */ }
  }
  const nd = nameDate(path.basename(file)); if (nd) return { date: nd, source: 'name' };
  return { date: new Date(st.mtimeMs), source: 'mtime' };
}

// Какие корни можно упорядочивать: Изображения, Видео и добавленные пользователем папки (Рабочий стол, Загрузки и т.п. — нет).
function eligibleRoots(roots, extraRoots, pictures, videos) {
  return roots.filter(r => [pictures, videos, ...extraRoots].filter(Boolean).some(a => norm(a) === norm(r)));
}

async function listCandidates(root, skip) {
  const out = [];
  let ents; try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(root, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isFile()) out.push(p);
    else if (e.isDirectory() && GENERIC.has(e.name.toLowerCase()) && !skip(p)) {
      let sub = []; try { sub = await fsp.readdir(p, { withFileTypes: true }); } catch { continue; }
      for (const s of sub) if (s.isFile() && !s.isSymbolicLink()) out.push(path.join(p, s.name));
    }
  }
  return out;
}

// План: ничего не двигает. Возвращает {items, groups}.
async function plan({ roots, outRoot, quarantineDir, isCancelled = () => false, onProgress = () => {} }) {
  const items = [];
  const skip = p => [].concat(outRoot || []).some(o => isInside(p, o)) || (quarantineDir && isInside(p, quarantineDir));
  for (const root of roots) {
    for (const p of await listCandidates(root, skip)) {
      if (isCancelled()) break;
      const ext = path.extname(p).toLowerCase();
      const kind = IMG.has(ext) ? 'photo' : VID.has(ext) ? 'video' : null;
      if (!kind || skip(p) || !isCleanable(p, roots)) continue;
      let st; try { st = await fsp.stat(p); } catch { continue; }
      if (items.length % 200 === 0) onProgress({ text: `Смотрю даты съёмки… найдено ${items.length}` });
      const { date, source } = await dateOf(p, st);
      const y = date.getFullYear(), mo = date.getMonth() + 1;
      const folder = path.join(root, BASE, String(y), `${String(mo).padStart(2, '0')} ${MONTHS[mo - 1]}`);
      items.push({ path: p, size: st.size, mtime: st.mtimeMs, kind, date, source, key: `${y}-${String(mo).padStart(2, '0')}`, folder, dest: path.join(folder, path.basename(p)) });
    }
  }
  const g = new Map();
  for (const it of items) {
    const k = it.key; const cur = g.get(k) || { key: k, year: +k.slice(0, 4), month: +k.slice(5), count: 0, photos: 0, videos: 0, bytes: 0, sample: [] };
    cur.count++; cur[it.kind === 'photo' ? 'photos' : 'videos']++; cur.bytes += it.size; if (cur.sample.length < 3) cur.sample.push(path.basename(it.path)); g.set(k, cur);
  }
  const groups = [...g.values()].sort((a, b) => b.key.localeCompare(a.key)).map(x => ({ ...x, label: `${MONTHS[x.month - 1]} ${x.year}` }));
  return { items, groups };
}

// Переносит выбранные файлы; журнал сохраняется для отмены. Файлы, изменившиеся после плана, пропускаются.
async function apply({ items, logFile, onProgress = () => {}, isCancelled = () => false }) {
  const moves = [], problems = [];
  let i = 0;
  for (const it of items) {
    if (isCancelled()) break;
    onProgress({ index: i++, total: items.length, name: path.basename(it.path) });
    try {
      const st = await fsp.stat(it.path);
      if (st.size !== it.size || Math.round(st.mtimeMs) !== Math.round(it.mtime)) throw new Error('файл изменился после просмотра — оставил на месте');
      if (norm(path.dirname(it.path)) === norm(it.folder)) continue;
      const dest = await freeName(it.dest);
      await moveFile(it.path, dest);
      moves.push({ from: it.path, to: dest });
    } catch (e) { problems.push(`${path.basename(it.path)}: ${e.message}`); }
  }
  if (moves.length) {
    let prev = []; try { prev = JSON.parse(fs.readFileSync(logFile, 'utf8')).moves || []; } catch { /* журнала ещё не было */ }
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), moves: [...prev, ...moves] }));
  }
  return { moved: moves.length, problems };
}

function undoInfo(logFile) { try { const j = JSON.parse(fs.readFileSync(logFile, 'utf8')); return j.moves && j.moves.length ? { count: j.moves.length, at: j.at } : null; } catch { return null; } }

// Вернуть всё на прежние места. Если на старом месте уже что-то лежит или файл пропал — не трогаем и сообщаем.
async function undo({ logFile }) {
  let j; try { j = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch { return { restored: 0, problems: ['Нечего возвращать.'] }; }
  let restored = 0; const problems = [], left = [];
  for (const m of [...j.moves].reverse()) {
    try {
      if (!fs.existsSync(m.to)) throw new Error('файла уже нет там, куда я его положил');
      if (fs.existsSync(m.from)) throw new Error('на старом месте уже лежит другой файл');
      await moveFile(m.to, m.from); restored++;
    } catch (e) { problems.push(`${path.basename(m.to)}: ${e.message}`); left.push(m); }
  }
  // пустые папки «По датам» — убираем (rmdir удаляет только пустые)
  const dirs = new Set(j.moves.map(m => path.dirname(m.to)));
  for (const d of dirs) {
    for (let x = d; ; x = path.dirname(x)) {
      try { fs.rmdirSync(x); } catch { break; }
      if (path.basename(x) === BASE) break;
    }
  }
  if (left.length) fs.writeFileSync(logFile, JSON.stringify({ at: j.at, moves: left.reverse() })); else fs.rmSync(logFile, { force: true });
  return { restored, problems };
}

module.exports = { plan, apply, undo, undoInfo, eligibleRoots, exifDate, nameDate, BASE, MONTHS };
