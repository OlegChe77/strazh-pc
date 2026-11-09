// Карантин: файлы не удаляются, а переезжают в закрытую папку программы и могут быть возвращены.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { moveFile, sha256, trash, freeName } = require('./lib/fsops');
const { isSystemPath } = require('./lib/paths');
const { runPS, withData } = require('./lib/ps');

function create(dir) {
  const manifestFile = path.join(dir, 'manifest.json');
  let items = [];
  try { items = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* пусто */ }
  const save = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(manifestFile + '.tmp', JSON.stringify(items, null, 2));
    fs.renameSync(manifestFile + '.tmp', manifestFile);
  };

  // file может быть null — тогда запись нужна только чтобы вернуть автозапуск.
  async function add({ file, reason, registry = [], tasks = [], folderItems = [] }) {
    const id = crypto.randomUUID();
    const entry = { id, original: null, name: file ? path.basename(file) : null, size: 0, sha256: null, date: new Date().toISOString(), reason, registry, tasks };
    if (file) {
      if (isSystemPath(file)) throw new Error('Это системная папка Windows — карантин сюда не заходит.');
      const st = await fsp.stat(file);
      if (!st.isFile()) throw new Error('Это не файл.');
      entry.size = st.size;
      if (st.size <= 300 * 1024 * 1024) entry.sha256 = await sha256(file);
      entry.original = file;
      await fsp.mkdir(dir, { recursive: true });
      await moveFile(file, path.join(dir, id + '.quar'));
    }
    items.push(entry); save();
    return entry;
  }

  const list = () => items.map(i => ({ ...i }));

  async function restore(id) {
    const e = items.find(i => i.id === id);
    if (!e) throw new Error('Такой записи нет.');
    let restoredTo = null;
    if (e.original) {
      const src = path.join(dir, id + '.quar');
      let dest = e.original;
      dest = await freeName(dest); // если на старом месте уже что-то лежит, не затираем
      await moveFile(src, dest);
      restoredTo = dest;
    }
    for (const r of e.registry || []) {
      await runPS(withData(r, `if(-not (Test-Path $data.key)){New-Item -Path $data.key -Force|Out-Null}; Set-ItemProperty -Path $data.key -Name $data.name -Value $data.value;'ok'`), { quiet: false });
    }
    for (const t of e.tasks || []) {
      await runPS(withData(t, `Enable-ScheduledTask -TaskPath $data.path -TaskName $data.name|Out-Null;'ok'`), { quiet: false });
    }
    items = items.filter(i => i.id !== id); save();
    return { restoredTo };
  }

  // Окончательная очистка карантина — только в Корзину (можно достать), и только после подтверждения в окне.
  async function purge(id) {
    const e = items.find(i => i.id === id);
    if (!e) throw new Error('Такой записи нет.');
    const f = path.join(dir, id + '.quar');
    if (fs.existsSync(f)) {
      const named = path.join(dir, `${e.name || id}.quar`);
      const target = await freeName(named);
      await fsp.rename(f, target);
      await trash(target);
    }
    items = items.filter(i => i.id !== id); save();
  }

  return { add, list, restore, purge, dir };
}
module.exports = { create };
