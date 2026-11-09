// Сжатие в КОПИИ: фото и картинки — sharp, видео — встроенный ffmpeg. Оригиналы не трогаются.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { moveFile, trash, freeName } = require('../lib/fsops');

sharp.cache(false);
sharp.concurrency(2);

function ffmpegPath() {
  let p = require('ffmpeg-static');
  if (p && p.includes('app.asar' + path.sep)) p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  return p;
}

const toSec = s => { const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s || ''); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0; };

// Куда класть копию: <outRoot>\<папка-корень>\<путь внутри корня>. Ничего не затирается.
function copyTarget(item, roots, outRoot, ext) {
  const root = roots[item.rootIdx];
  const rel = path.relative(root, item.path);
  const parsed = path.parse(rel);
  return path.join(outRoot, path.basename(root), parsed.dir, parsed.name + ext);
}

async function compressImage(item, dest, kind) {
  const tmp = dest + '.part';
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  let img = sharp(item.path, { failOn: 'none' }).rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true });
  img = kind === 'jpg' ? img.jpeg({ quality: 80, mozjpeg: true }).withMetadata() : img.png({ compressionLevel: 9, palette: true, quality: 85, effort: 8 });
  await img.toFile(tmp);
  return tmp;
}

function compressVideo(item, dest, { onPercent, setKill }) {
  const tmp = dest + '.part';
  return new Promise(async (resolve, reject) => {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const args = ['-hide_banner', '-nostdin', '-y', '-i', item.path, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '27',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', tmp];
    const ff = spawn(ffmpegPath(), args, { windowsHide: true });
    let dur = 0, last = 0, tail = '';
    setKill(() => ff.kill());
    ff.stderr.on('data', d => {
      const s = d.toString(); tail = (tail + s).slice(-2000);
      if (!dur) { const m = /Duration:\s*([\d:.]+)/.exec(s); if (m) dur = toSec(m[1]); }
      const t = [...s.matchAll(/time=([\d:.]+)/g)].pop();
      if (t) { last = toSec(t[1]); if (dur) onPercent(Math.min(99, last / dur * 100)); }
    });
    ff.on('error', reject);
    ff.on('close', code => {
      if (code !== 0) return reject(new Error('Видео не удалось сжать (' + (/Invalid data|moov atom|Error/i.exec(tail) ? 'файл повреждён или необычный' : 'код ' + code) + ')'));
      // проверка: длина результата совпадает с исходной
      if (dur && Math.abs(last - dur) > Math.max(2, dur * 0.02)) return reject(new Error('Получившееся видео короче исходного — копию не сохраняю'));
      resolve(tmp);
    });
  });
}

// Сжимает список {path,size,mtime,rootIdx,kind}. События: onFile({index,total,name,percent}), onDone(result).
async function compressAll({ items, roots, outRoot, onFile = () => {}, onResult = () => {}, isCancelled = () => false, setKill = () => {} }) {
  const results = [];
  for (let i = 0; i < items.length; i++) {
    if (isCancelled()) break;
    const it = items[i];
    const name = path.basename(it.path);
    onFile({ index: i, total: items.length, name, percent: 0 });
    const r = { id: it.id, original: it.path, before: it.size, after: 0, copy: null, status: 'error', note: '' };
    try {
      const st = await fsp.stat(it.path);
      if (st.size !== it.size || st.mtimeMs !== it.mtime) throw new Error('Файл изменился после поиска — пропускаю');
      const ext = it.kind === 'video' ? '.mp4' : path.extname(it.path).toLowerCase();
      const dest = await freeName(copyTarget(it, roots, outRoot, ext));
      const tmp = it.kind === 'video'
        ? await compressVideo(it, dest, { onPercent: p => onFile({ index: i, total: items.length, name, percent: p }), setKill })
        : await compressImage(it, dest, it.kind);
      const out = await fsp.stat(tmp);
      if (isCancelled()) { await fsp.rm(tmp, { force: true }); break; }
      if (out.size <= 0 || out.size > it.size * 0.92) {
        await fsp.rm(tmp, { force: true }); // наша недоделанная копия — не нужна
        r.status = 'skipped'; r.note = 'Файл уже хорошо сжат — выигрыша почти нет, копию не делаю';
      } else {
        await fsp.rename(tmp, dest);
        try { await fsp.utimes(dest, new Date(), new Date(it.mtime)); } catch { /* не критично */ }
        r.status = 'done'; r.copy = dest; r.after = out.size;
      }
    } catch (e) {
      r.note = e.message;
      // убираем только собственные недоделанные файлы
      try { const dest = copyTarget(it, roots, outRoot, it.kind === 'video' ? '.mp4' : path.extname(it.path).toLowerCase()); await fsp.rm(dest + '.part', { force: true }); } catch { /* ничего */ }
    }
    results.push(r); onResult(r);
  }
  return results;
}

// Заменить оригинал копией: оригинал → Корзина Windows (только после подтверждения пользователя), копия встаёт на его место.
async function replaceOriginal(r) {
  const st = await fsp.stat(r.original).catch(() => null);
  const cp = await fsp.stat(r.copy).catch(() => null);
  if (!cp || cp.size !== r.after) throw new Error('Сжатая копия не найдена или изменилась — оригинал оставляю');
  if (st) {
    if (st.size !== r.before) throw new Error('Оригинал изменился после сжатия — оставляю как есть');
    await trash(r.original);
  }
  const ext = path.extname(r.copy);
  const target = await freeName(path.join(path.dirname(r.original), path.parse(r.original).name + ext));
  await moveFile(r.copy, target);
  return target;
}

module.exports = { compressAll, replaceOriginal, ffmpegPath };
