// Сейф: зашифрованное хранилище паролей и файлов (AES-256-GCM, ключ из пароля через scrypt).
// Пароль нигде не хранится — забыли пароль, данные не вернуть. Ключ живёт только в памяти этого процесса.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MAGIC = Buffer.from('SPK1');
const KDF = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const MIN_PASS = 8;

const deriveKey = (password, salt) => new Promise((res, rej) => crypto.scrypt(String(password), salt, 32, KDF, (e, k) => (e ? rej(e) : res(k))));

function encryptBuf(key, buf) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
function decryptBuf(key, data) {
  if (data.length < 32 || !data.subarray(0, 4).equals(MAGIC)) throw new Error('Файл сейфа повреждён');
  const d = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(4, 16));
  d.setAuthTag(data.subarray(16, 32));
  return Buffer.concat([d.update(data.subarray(32)), d.final()]);
}

// Файл шифруется потоком: MAGIC | iv(12) | шифртекст | tag(16). Возвращает {size, sha} исходного файла.
async function encryptFile(key, src, dest) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const hash = crypto.createHash('sha256');
  let size = 0;
  const fh = await fsp.open(dest, 'w');
  try {
    await fh.write(Buffer.concat([MAGIC, iv]));
    for await (const chunk of fs.createReadStream(src)) { hash.update(chunk); size += chunk.length; await fh.write(c.update(chunk)); }
    await fh.write(c.final()); await fh.write(c.getAuthTag());
  } finally { await fh.close(); }
  return { size, sha: hash.digest('hex') };
}

// Расшифровка потоком; onChunk получает открытые данные. Если файл тронут — бросает ошибку.
async function decryptFile(key, src, onChunk) {
  const st = await fsp.stat(src);
  if (st.size < 32) throw new Error('Файл сейфа повреждён');
  const fh = await fsp.open(src, 'r');
  try {
    const head = Buffer.alloc(16), tag = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0); await fh.read(tag, 0, 16, st.size - 16);
    if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('Файл сейфа повреждён');
    const d = crypto.createDecipheriv('aes-256-gcm', key, head.subarray(4, 16)); d.setAuthTag(tag);
    let pos = 16; const end = st.size - 16; const buf = Buffer.alloc(1 << 20);
    while (pos < end) {
      const n = Math.min(buf.length, end - pos);
      const { bytesRead } = await fh.read(buf, 0, n, pos); if (!bytesRead) throw new Error('Файл сейфа повреждён');
      pos += bytesRead;
      const out = d.update(buf.subarray(0, bytesRead)); if (out.length) await onChunk(out);
    }
    const last = d.final(); if (last.length) await onChunk(last);
  } finally { await fh.close(); }
}

function create(dir) {
  const metaFile = path.join(dir, 'meta.json'), indexFile = path.join(dir, 'index.enc'), filesDir = path.join(dir, 'files');
  let key = null, index = null, failDelay = 0;

  const exists = () => fs.existsSync(metaFile) && fs.existsSync(indexFile);
  const need = () => { if (!key || !index) throw new Error('Сейф закрыт — сначала введите пароль.'); };
  const writeAtomic = async (file, data) => { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file + '.tmp', data); await fsp.rename(file + '.tmp', file); };
  const saveIndex = () => writeAtomic(indexFile, encryptBuf(key, Buffer.from(JSON.stringify(index), 'utf8')));
  const id = () => crypto.randomBytes(8).toString('hex');
  const blob = fid => path.join(filesDir, fid + '.enc');

  return {
    dir,
    exists, isOpen: () => !!key,
    status: () => ({ exists: exists(), open: !!key }),

    async setup(password) {
      if (exists()) throw new Error('Сейф уже создан.');
      if (String(password || '').length < MIN_PASS) throw new Error(`Пароль слишком короткий: нужно хотя бы ${MIN_PASS} символов.`);
      const salt = crypto.randomBytes(16);
      key = await deriveKey(password, salt);
      index = { v: 1, notes: [], files: [] };
      await fsp.mkdir(filesDir, { recursive: true });
      await writeAtomic(metaFile, JSON.stringify({ v: 1, kdf: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('hex') }));
      await saveIndex();
    },

    async unlock(password) {
      if (!exists()) throw new Error('Сейф ещё не создан.');
      if (failDelay) await new Promise(r => setTimeout(r, failDelay));
      const meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'));
      const k = await deriveKey(password, Buffer.from(meta.salt, 'hex'));
      try { index = JSON.parse(decryptBuf(k, await fsp.readFile(indexFile)).toString('utf8')); }
      catch { failDelay = Math.min(failDelay + 700, 4000); throw new Error('Пароль не подходит.'); }
      failDelay = 0; key = k;
    },

    lock() { key = null; index = null; },

    list() {
      need();
      return {
        notes: index.notes.map(n => ({ id: n.id, title: n.title, site: n.site || '', login: n.login || '', added: n.added })),
        files: index.files.map(f => ({ id: f.id, name: f.name, size: f.size, added: f.added }))
      };
    },

    async addNote({ title, site, login, password, comment }) {
      need();
      const t = String(title || '').trim().slice(0, 120);
      if (!t) throw new Error('Напишите название (например, «Почта»).');
      const n = { id: id(), title: t, site: String(site || '').slice(0, 200), login: String(login || '').slice(0, 200), password: String(password || '').slice(0, 500), comment: String(comment || '').slice(0, 2000), added: new Date().toISOString() };
      index.notes.push(n); await saveIndex(); return n.id;
    },
    getNote(nid) { need(); const n = index.notes.find(x => x.id === nid); if (!n) throw new Error('Запись не найдена.'); return { ...n }; },
    async deleteNote(nid) { need(); const before = index.notes.length; index.notes = index.notes.filter(x => x.id !== nid); if (index.notes.length === before) throw new Error('Запись не найдена.'); await saveIndex(); },

    // Кладёт файл в сейф и проверяет, что он расшифровывается обратно без потерь. Исходный файл не трогает.
    async addFile(src) {
      need();
      const fid = id(), dest = blob(fid);
      await fsp.mkdir(filesDir, { recursive: true });
      let info;
      try {
        info = await encryptFile(key, src, dest);
        const h = crypto.createHash('sha256'); await decryptFile(key, dest, c => h.update(c));
        if (h.digest('hex') !== info.sha) throw new Error('проверка копии в сейфе не прошла');
      } catch (e) { await fsp.rm(dest, { force: true }); throw e; }
      const entry = { id: fid, name: path.basename(src), size: info.size, sha: info.sha, added: new Date().toISOString() };
      index.files.push(entry);
      try { await saveIndex(); } catch (e) { index.files.pop(); await fsp.rm(dest, { force: true }); throw e; }
      return { id: fid, name: entry.name, size: entry.size };
    },

    // Достать файл из сейфа в выбранную папку (в сейфе он остаётся).
    async exportFile(fid, destDir, freeName) {
      need();
      const f = index.files.find(x => x.id === fid); if (!f) throw new Error('Файл не найден в сейфе.');
      const dest = await freeName(path.join(destDir, f.name)), tmp = dest + '.part';
      const out = await fsp.open(tmp, 'w'); const h = crypto.createHash('sha256');
      try { await decryptFile(key, blob(fid), async c => { h.update(c); await out.write(c); }); }
      catch (e) { await out.close(); await fsp.rm(tmp, { force: true }); throw e; }
      await out.close();
      if (h.digest('hex') !== f.sha) { await fsp.rm(tmp, { force: true }); throw new Error('Файл расшифровался неверно — не сохраняю'); }
      await fsp.rename(tmp, dest); return dest;
    },

    // Убрать файл из сейфа насовсем (спрашивать подтверждение — задача вызывающего).
    async removeFile(fid) {
      need();
      const i = index.files.findIndex(x => x.id === fid); if (i < 0) throw new Error('Файл не найден в сейфе.');
      const [f] = index.files.splice(i, 1);
      try { await saveIndex(); } catch (e) { index.files.splice(i, 0, f); throw e; }
      await fsp.rm(blob(fid), { force: true });
    }
  };
}

module.exports = { create, MIN_PASS, encryptBuf, decryptBuf };
