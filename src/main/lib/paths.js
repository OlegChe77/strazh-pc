// Защита путей: что можно трогать при уборке/сжатии, а что — никогда.
const path = require('path');
const os = require('os');
const fs = require('fs');

const norm = p => path.resolve(String(p)).toLowerCase().replace(/[\\/]+$/, '');

function isInside(child, parent) {
  const c = norm(child), p = norm(parent);
  return c === p || c.startsWith(p + '\\');
}

function systemRoots() {
  const e = process.env;
  const drive = (e.SystemDrive || 'C:') + '\\';
  return [e.WINDIR, e.SystemRoot, e.ProgramFiles, e['ProgramFiles(x86)'], e.ProgramW6432, e.ProgramData,
    drive + '$Recycle.Bin', drive + 'System Volume Information', drive + 'Recovery', drive + 'PerfLogs',
    drive + 'Windows', drive + 'Program Files', drive + 'Program Files (x86)'].filter(Boolean);
}

// Системные папки Windows и программ: в них нельзя чистить, сжимать и забирать файлы.
const isSystemPath = p => systemRoots().some(r => isInside(p, r));

// Данные программ внутри профиля пользователя (AppData) — для уборки закрыты.
const isAppData = p => isInside(p, path.join(os.homedir(), 'AppData'));

function isDriveRoot(p) {
  const r = path.resolve(p);
  return path.parse(r).root.toLowerCase().replace(/\\$/, '') === r.toLowerCase().replace(/\\$/, '');
}

// Можно ли уборке/сжатию работать с этим файлом (он должен лежать внутри разрешённой папки).
function isCleanable(p, allowedRoots) {
  if (!p || isSystemPath(p) || isAppData(p) || isDriveRoot(p)) return false;
  return allowedRoots.some(r => isInside(p, r) && norm(p) !== norm(r));
}

// Можно ли пользователю добавить эту папку для уборки.
function isAllowedUserFolder(p) {
  if (!p) return false;
  const r = path.resolve(p);
  if (isSystemPath(r) || isAppData(r) || isDriveRoot(r)) return false;
  try { return fs.statSync(r).isDirectory(); } catch { return false; }
}

// Папки пользователя, где разрешена уборка по умолчанию.
function defaultRoots(getPath) {
  const seen = new Set(), out = [];
  for (const k of ['pictures', 'videos', 'documents', 'desktop', 'downloads', 'music']) {
    let p; try { p = getPath(k); } catch { continue; }
    if (!p || seen.has(norm(p)) || !isAllowedUserFolder(p)) continue;
    seen.add(norm(p)); out.push(p);
  }
  return out;
}

module.exports = { norm, isInside, isSystemPath, isAppData, isDriveRoot, isCleanable, isAllowedUserFolder, defaultRoots };
