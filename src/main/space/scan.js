// Поиск того, что можно освободить: только в папках пользователя. Системные папки и AppData не открываются.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { sha256 } = require('../lib/fsops');
const { isCleanable, isSystemPath, isAppData, isInside } = require('../lib/paths');

const EXT = {
  jpg: new Set(['.jpg', '.jpeg']),
  png: new Set(['.png']),
  video: new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm', '.mpg', '.mpeg', '.flv', '.3gp']),
  installer: new Set(['.exe', '.msi', '.msix', '.appx'])
};
// для поиска одинаковых файлов — только личные файлы, не программы
const DUP_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.tif', '.tiff', '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v',
  '.mp3', '.flac', '.wav', '.m4a', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.7z', '.iso', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)']);

const MIN = { jpg: 300 * 1024, png: 200 * 1024, video: 30 * 1024 * 1024, dup: 100 * 1024 };
const OLD_DAYS = 30;
// осторожная оценка выигрыша (до реального сжатия)
const EST = { jpg: 0.35, png: 0.3, video: 0.45 };

async function scan({ roots, outRoot, quarantineDir, installerRoots, skipDup = false, onProgress = () => {}, isCancelled = () => false }) {
  const res = { jpg: [], png: [], video: [], installer: [], dupCand: [] };
  let visited = 0;
  // outRoot — папка (или список папок: новая и старая) с копиями программы; их не сканируем
  const skip = p => [].concat(outRoot || []).some(o => isInside(p, o)) || (quarantineDir && isInside(p, quarantineDir));
  const now = Date.now();

  async function walk(dir, rootIdx, depth) {
    if (isCancelled() || depth > 14 || visited > 400000) return;
    if (isSystemPath(dir) || isAppData(dir) || skip(dir)) return;
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (isCancelled()) return;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) await walk(p, rootIdx, depth + 1); continue; }
      if (!e.isFile()) continue;
      visited++;
      if (visited % 500 === 0) onProgress({ text: `Просмотрено файлов: ${visited}…` });
      const ext = path.extname(e.name).toLowerCase();
      let st; try { st = await fsp.stat(p); } catch { continue; }
      const it = { path: p, size: st.size, mtime: st.mtimeMs, rootIdx };
      if (EXT.jpg.has(ext) && st.size >= MIN.jpg) res.jpg.push(it);
      else if (EXT.png.has(ext) && st.size >= MIN.png) res.png.push(it);
      else if (EXT.video.has(ext) && st.size >= MIN.video) res.video.push(it);
      else if (EXT.installer.has(ext) && (installerRoots || []).some(r => isInside(p, r)) && (now - st.mtimeMs) > OLD_DAYS * 864e5 && st.size >= 1024 * 1024) res.installer.push(it);
      if (!skipDup && DUP_EXT.has(ext) && st.size >= MIN.dup) res.dupCand.push(it);
    }
  }
  for (let i = 0; i < roots.length; i++) await walk(roots[i], i, 0);

  // одинаковые файлы: по размеру → по началу файла → по всему содержимому
  onProgress({ text: 'Ищу одинаковые файлы…' });
  const bySize = new Map();
  for (const f of res.dupCand) { if (!(bySize.get(f.size) || bySize.set(f.size, []).get(f.size)).some(x => x.path === f.path)) bySize.get(f.size).push(f); }
  const groups = [];
  for (const list of bySize.values()) {
    if (list.length < 2 || isCancelled()) continue;
    const byHead = new Map();
    for (const f of list) {
      try { const h = await sha256(f.path, 65536); (byHead.get(h) || byHead.set(h, []).get(h)).push(f); } catch { /* занят или пропал */ }
    }
    for (const hl of byHead.values()) {
      if (hl.length < 2) continue;
      const byFull = new Map();
      for (const f of hl) { try { const h = await sha256(f.path); (byFull.get(h) || byFull.set(h, []).get(h)).push(f); } catch { /* пропал */ } }
      for (const fl of byFull.values()) if (fl.length > 1) groups.push(fl);
    }
  }
  // «оригинал» — самый старый файл (и с самым коротким путём); остальные — лишние копии
  const dupGroups = groups.map(g => {
    g.sort((a, b) => a.mtime - b.mtime || a.path.length - b.path.length);
    return { keep: g[0], extras: g.slice(1) };
  }).sort((a, b) => b.keep.size * b.extras.length - a.keep.size * a.extras.length);

  const sum = l => l.reduce((s, f) => s + f.size, 0);
  const dupBytes = dupGroups.reduce((s, g) => s + g.keep.size * g.extras.length, 0);
  return {
    visited,
    files: { jpg: res.jpg, png: res.png, video: res.video, installer: res.installer },
    dupGroups,
    summary: {
      jpg: { count: res.jpg.length, bytes: sum(res.jpg), saveBytes: Math.round(sum(res.jpg) * EST.jpg) },
      png: { count: res.png.length, bytes: sum(res.png), saveBytes: Math.round(sum(res.png) * EST.png) },
      video: { count: res.video.length, bytes: sum(res.video), saveBytes: Math.round(sum(res.video) * EST.video) },
      dup: { count: dupGroups.reduce((s, g) => s + g.extras.length, 0), groups: dupGroups.length, saveBytes: dupBytes },
      installer: { count: res.installer.length, saveBytes: sum(res.installer) }
    }
  };
}
module.exports = { scan, EST, isCleanable };
