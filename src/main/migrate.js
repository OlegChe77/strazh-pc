// Перенос данных из папок прошлых версий (с русскими именами) в новые (латиницей).
// Ничего не удаляется, кроме кэша браузерного движка (Cache, GPUCache…) в старой папке; файлы пользователя только переезжают.
const fs = require('fs');
const path = require('path');

// Служебные папки/файлы Electron: переносить не нужно, в старой папке их можно убрать.
const JUNK = new Set(['cache', 'code cache', 'gpucache', 'dawncache', 'dawngraphitecache', 'dawnwebgpucache', 'local storage', 'session storage',
  'network', 'blob_storage', 'crashpad', 'shared dictionary', 'partitions', 'preferences', 'local state', 'singletonlock', 'singletoncookie',
  'singletonsocket', 'lockfile', 'cookies', 'cookies-journal', 'transportsecurity', 'dictionaries', 'logs', 'trust tokens', 'sharedstorage',
  'webstorage', 'videodecodestats', 'service worker', 'indexeddb', 'component_crx_cache', 'extensions', 'dips', 'dips-wal', 'dips-shm', 'extension state', 'grshadercache', 'gpupersistentcache', 'shadercache',
  'declarative_performance_observer.db', 'declarative_performance_observer.db-journal', 'safe browsing', 'shared_proto_db', 'sessions', 'platform notifications', 'first party sets', 'network persistent state']);

const lc = s => String(s).toLowerCase();
const same = (a, b) => lc(path.resolve(a)) === lc(path.resolve(b));

function sameFile(a, b) {
  try {
    const sa = fs.statSync(a), sb = fs.statSync(b);
    return sa.isFile() && sb.isFile() && sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch { return false; }
}

// Переносит содержимое папки from в to. Что уже есть в to — не трогает (конфликт). Возвращает отчёт.
function moveEntries(from, to, { junk = false } = {}) {
  const rep = { moved: [], conflicts: [], copied: [], dropped: [] };
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name), dst = path.join(to, name);
    const isJunk = junk && JUNK.has(lc(name));
    if (fs.existsSync(dst)) {
      // служебное или байт-в-байт такое же, как уже перенесённое (осталось после неполного переноса) — старый экземпляр убираем
      if (isJunk || sameFile(src, dst)) { try { fs.rmSync(src, { recursive: true, force: true }); rep.dropped.push(name); } catch { rep.conflicts.push(name); } } else rep.conflicts.push(name);
      continue;
    }
    if (isJunk) { try { fs.rmSync(src, { recursive: true, force: true }); rep.dropped.push(name); } catch { rep.conflicts.push(name); } continue; }
    try { fs.renameSync(src, dst); rep.moved.push(name); } catch {
      // другой диск или файл занят: копируем, оригинал оставляем на месте (старая папка тогда не удаляется)
      try {
        fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false }); rep.copied.push(name);
        try { fs.rmSync(src, { recursive: true, force: true }); } catch { /* останется — при следующем запуске одинаковое уберём */ }
      } catch { rep.conflicts.push(name); }
    }
  }
  try { if (!fs.readdirSync(from).length) fs.rmdirSync(from); } catch { /* осталась — не страшно */ }
  rep.left = fs.existsSync(from);
  return rep;
}

// Папка с копиями: если новой ещё нет — просто переименовываем, иначе переносим содержимое.
function moveFolder(oldDir, newDir, opts) {
  if (!oldDir || !fs.existsSync(oldDir) || same(oldDir, newDir)) return { status: 'none' };
  if (!fs.existsSync(newDir)) {
    try { fs.mkdirSync(path.dirname(newDir), { recursive: true }); fs.renameSync(oldDir, newDir); return { status: 'renamed' }; } catch { /* ниже — по частям */ }
  }
  const rep = moveEntries(oldDir, newDir, opts);
  return { status: rep.left ? 'partial' : 'moved', ...rep };
}

// Пути готовых копий в pending-copies.json вели в старую папку копий — переписываем на новую (только если файл там реально есть).
function rewritePending(file, oldCopies, newCopies) {
  let list; try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 0; }
  if (!Array.isArray(list)) return 0;
  const prefix = lc(path.resolve(oldCopies)) + path.sep; let n = 0;
  for (const x of list) {
    if (!x || typeof x.copy !== 'string') continue;
    const abs = path.resolve(x.copy);
    if (!lc(abs).startsWith(prefix)) continue;
    const cand = path.join(newCopies, abs.slice(prefix.length));
    if (fs.existsSync(cand)) { x.copy = cand; n++; }
  }
  if (n) { fs.writeFileSync(file + '.tmp', JSON.stringify(list)); fs.renameSync(file + '.tmp', file); }
  return n;
}

// Главная функция: данные программы (карантин, сейф, журналы, настройки) и папка сжатых копий.
function migrateAll({ oldData, newData, oldCopies, newCopies }) {
  const res = { data: { status: 'none' }, copies: { status: 'none' }, pendingFixed: 0 };
  res.data = moveFolder(oldData, newData, { junk: true });
  res.copies = moveFolder(oldCopies, newCopies);
  if (res.copies.status !== 'none') res.pendingFixed = rewritePending(path.join(newData, 'pending-copies.json'), oldCopies, newCopies);
  return res;
}

module.exports = { migrateAll, moveFolder, moveEntries, rewritePending, JUNK };
