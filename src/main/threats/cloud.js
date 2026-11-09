// Облачные папки (OneDrive, Яндекс.Диск, Google Диск, Dropbox, Облако Mail.ru): что синхронизируется
// и нет ли в этих папках файлов с паролями и ключами. Только чтение; файлы «только в облаке» не открываем.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { psJson, asArray } = require('../lib/ps');
const { isInside, norm } = require('../lib/paths');
const { findSecretFiles } = require('./secrets');
const { makeOfflineFilter } = require('./cloudfiles');
const T = require('./texts');

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const subdirs = p => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };

const REG_SCRIPT = `
$o=[ordered]@{}
$o.od=@(Get-ChildItem 'HKCU:\\Software\\Microsoft\\OneDrive\\Accounts' | % { [string](Get-ItemProperty $_.PSPath).UserFolder } | ? { $_ })
$o.gd=[string](Get-ItemProperty 'HKCU:\\Software\\Google\\DriveFS\\Share').MountPoint
$u=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'
$x={ param($v) if($v){[Environment]::ExpandEnvironmentVariables([string]$v)}else{''} }
$o.known=[ordered]@{desktop=(& $x $u.Desktop);documents=(& $x $u.Personal);pictures=(& $x $u.'My Pictures')}
ConvertTo-Json -Compress -Depth 4 -InputObject $o`;

async function queryReg() {
  const r = await psJson(REG_SCRIPT, { timeout: 20000 }).catch(() => null);
  return r ? { od: asArray(r.od), gd: r.gd || '', known: r.known || {} } : {};
}

// Где на компьютере лежат облачные папки. Ничего не открывает, только проверяет, что папка есть.
function findCloudRoots({ home = os.homedir(), env = process.env, reg = {} } = {}) {
  const out = [];
  const add = (id, name, folder, extra = {}) => {
    if (!folder) return;
    folder = path.resolve(folder);
    if (!isDir(folder) || out.some(o => norm(o.folder) === norm(folder))) return;
    out.push({ id, name, folder, ...extra });
  };
  const homeDirs = subdirs(home).filter(e => e.isDirectory()).map(e => e.name);

  [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial, ...asArray(reg.od)].forEach(p => add('onedrive', 'OneDrive', p));
  homeDirs.filter(n => /^OneDrive(\s|$|-)/i.test(n)).forEach(n => add('onedrive', 'OneDrive', path.join(home, n)));

  for (const base of [env.APPDATA, env.LOCALAPPDATA].filter(Boolean)) {
    for (const d of ['YandexDisk2', 'YandexDisk']) {
      let cfg = ''; try { cfg = fs.readFileSync(path.join(base, 'Yandex', d, 'config.cfg'), 'utf8'); } catch { /* нет */ }
      const m = /^\s*dir\s*=\s*"?(.+?)"?\s*$/m.exec(cfg);
      if (m) add('yandex', 'Яндекс.Диск', m[1]);
    }
  }
  homeDirs.filter(n => /^(yandex\s?disk|yandex\.disk|яндекс[.\s]?диск)$/i.test(n)).forEach(n => add('yandex', 'Яндекс.Диск', path.join(home, n)));

  homeDirs.filter(n => /^(google\s?drive|google\s?диск|мой диск)$/i.test(n)).forEach(n => add('gdrive', 'Google Диск', path.join(home, n)));
  if (/^[A-Za-z]$/.test(String(reg.gd || '').trim())) add('gdrive', 'Google Диск', reg.gd.trim() + ':\\', { virtual: true });

  for (const base of [env.LOCALAPPDATA, env.APPDATA].filter(Boolean)) {
    const info = readJson(path.join(base, 'Dropbox', 'info.json'));
    if (info && typeof info === 'object') for (const v of Object.values(info)) if (v && v.path) add('dropbox', 'Dropbox', v.path);
  }
  homeDirs.filter(n => /^dropbox(\s\(.+\))?$/i.test(n)).forEach(n => add('dropbox', 'Dropbox', path.join(home, n)));

  homeDirs.filter(n => /^(cloud\s?mail\.?ru|облако(\s*@?\s*mail\.?ru)?|mail\.?ru\s?cloud)$/i.test(n)).forEach(n => add('mailru', 'Облако Mail.ru', path.join(home, n)));
  return out;
}

const KNOWN_NAMES = { desktop: 'Рабочий стол', documents: 'Документы', pictures: 'Изображения' };

// Что внутри: какие системные папки пользователя уехали в облако и самые верхние папки.
function describeRoot(root, known = {}) {
  const lines = [];
  const synced = Object.keys(KNOWN_NAMES).filter(k => known[k] && isInside(known[k], root.folder)).map(k => KNOWN_NAMES[k]);
  if (synced.length) lines.push(`Прямо сейчас в облако копируются ваши папки: ${synced.join(', ')}.`);
  const top = subdirs(root.folder).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).slice(0, 8);
  if (top.length) lines.push(`Папки внутри: ${top.join(', ')}.`);
  if (root.virtual) lines.push('Это «виртуальный» диск: многие файлы хранятся только в интернете, я их не открывал.');
  return { synced, lines };
}

// Проверяет одну облачную папку. Возвращает находки о файлах с паролями; ничего не меняет.
async function scanRoot(root, { offlineFilter, limit = 60000 } = {}) {
  const filter = root.virtual ? async files => new Set(files.map(f => f.toLowerCase())) : offlineFilter;
  const { found, scanned, skippedOffline } = await findSecretFiles([root.folder], { depth: 6, limit, offlineFilter: filter });
  return { found, scanned, skippedOffline };
}

async function check(ctx, progress, opts = {}) {
  const reg = opts.cloudRoots ? (opts.cloudReg || {}) : await queryReg();
  const roots = opts.cloudRoots || findCloudRoots({ reg });
  ctx.stats.cloud = roots.length;
  const offlineFilter = opts.offlineFilter || makeOfflineFilter({ strict: true });
  let filesTotal = 0;

  for (const root of roots) {
    const { found, scanned, skippedOffline } = await scanRoot(root, { offlineFilter });
    filesTotal += scanned;
    const desc = describeRoot(root, reg.known);
    const reasons = [`Сервис: ${root.name}.`, `Папка на компьютере: ${root.folder}.`, ...desc.lines];
    if (scanned) reasons.push(`Просмотрено файлов: ${scanned}.`);
    if (skippedOffline) reasons.push(`Файлов, которые лежат только в облаке и не скачаны: ${skippedOffline} — их содержимое я не открывал.`);
    if (found.length) reasons.push(`Файлов, похожих на пароли или ключи: ${found.length} (ниже они показаны отдельно).`);
    ctx.add({
      kind: 'cloud', level: found.length ? 'warn' : 'ok',
      title: `${T.cloud.title}: ${root.name}`,
      what: desc.synced.length ? `${T.cloud.what} Среди них — ${desc.synced.join(', ')}.` : T.cloud.what,
      risk: T.cloud.risk, advice: found.length ? T.cloud.adviceSecrets : T.cloud.advice,
      path: root.folder, reasons, target: { name: 'cloud:' + root.folder, folder: root.folder }, actions: ['reveal']
    });

    for (const f of found.slice(0, 15)) {
      const key = f.why === 'key', t = key ? T.cloudKey : T.cloudSecret;
      const sure = f.why === 'content' || key; // нашли пароли/ключ внутри, а не только по названию
      const why = f.why === 'content' ? [`В файле нашлось строк, похожих на «пароль: значение»: ${f.count}.`]
        : key ? ['Внутри файла — закрытый (секретный) ключ.']
          : [f.offline ? 'По названию похоже на файл с паролями; файл лежит только в облаке, внутрь я не заглядывал.' : 'По названию похоже на файл с паролями.'];
      ctx.add({
        kind: key ? 'cloud-key' : 'cloud-secret', level: sure ? 'bad' : 'warn',
        title: `${t.title}: ${path.basename(f.file)}`, what: t.what.replace('{service}', root.name), risk: t.risk, advice: t.advice,
        path: f.file, reasons: [...why, `Файл лежит в папке, которая синхронизируется с «${root.name}».`],
        target: { file: f.file, user: true, cloud: root.id }, actions: root.virtual ? ['reveal'] : ['quarantine', 'reveal']
      });
    }
  }
  ctx.stats.cloudFiles = filesTotal;
}

module.exports = { check, queryReg, findCloudRoots, describeRoot, scanRoot };
