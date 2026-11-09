// Файловые операции. Ничего не удаляется навсегда: «удаление» = Корзина Windows.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { runPS, withData } = require('./ps');

async function trash(p) {
  let sh = null;
  try { const el = require('electron'); if (el && el.shell && el.shell.trashItem) sh = el.shell; } catch { /* вне Electron */ }
  if (sh) return sh.trashItem(p);
  // запасной путь (тесты вне Electron): Корзина через Microsoft.VisualBasic
  const out = await runPS(withData({ p }, `Add-Type -AssemblyName Microsoft.VisualBasic;
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($data.p,'OnlyErrorDialogs','SendToRecycleBin');'ok'`), { quiet: false });
  if (!/ok/.test(out)) throw new Error('Не удалось отправить в Корзину');
}

// Перенос файла (в т.ч. между дисками) без потерь: копия → проверка размера → удаление исходного.
async function moveFile(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try { await fsp.rename(src, dest); return; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  await fsp.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
  const [a, b] = await Promise.all([fsp.stat(src), fsp.stat(dest)]);
  if (a.size !== b.size) { await fsp.rm(dest, { force: true }); throw new Error('Копия получилась неполной'); }
  await fsp.unlink(src);
}

function sha256(p, limitBytes = Infinity) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p, limitBytes === Infinity ? {} : { start: 0, end: limitBytes - 1 });
    s.on('data', d => h.update(d)); s.on('error', reject); s.on('end', () => resolve(h.digest('hex')));
  });
}

// Свободное имя: «файл (2).ext»
async function freeName(dest) {
  const { dir, name, ext } = path.parse(dest);
  let cand = dest, i = 1;
  for (;;) {
    try { await fsp.access(cand); } catch { return cand; }
    cand = path.join(dir, `${name} (${++i})${ext}`);
  }
}

module.exports = { trash, moveFile, sha256, freeName };
