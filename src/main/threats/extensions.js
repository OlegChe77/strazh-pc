// Дополнения браузеров: только чтение. Смотрим, какие права они просят и откуда взялись.
// Chrome, Edge, Brave, Vivaldi, Яндекс, Opera — по папкам профиля; Firefox — по extensions.json.
const fs = require('fs');
const path = require('path');

const BROWSERS = [
  { key: 'chrome', name: 'Google Chrome', env: 'LOCALAPPDATA', rel: 'Google\\Chrome\\User Data', url: 'chrome://extensions/?id=', exe: ['ProgramFiles\\Google\\Chrome\\Application\\chrome.exe', 'ProgramFiles(x86)\\Google\\Chrome\\Application\\chrome.exe', 'LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe'], store: /clients2\.google\.com\/service\/update2\/crx|chrome\.google\.com/i },
  { key: 'edge', name: 'Microsoft Edge', env: 'LOCALAPPDATA', rel: 'Microsoft\\Edge\\User Data', url: 'edge://extensions/?id=', exe: ['ProgramFiles(x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe'], store: /edge\.microsoft\.com|clients2\.google\.com\/service\/update2\/crx/i },
  { key: 'brave', name: 'Brave', env: 'LOCALAPPDATA', rel: 'BraveSoftware\\Brave-Browser\\User Data', url: 'brave://extensions/?id=', exe: ['ProgramFiles\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'LOCALAPPDATA\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'], store: /clients2\.google\.com\/service\/update2\/crx/i },
  { key: 'vivaldi', name: 'Vivaldi', env: 'LOCALAPPDATA', rel: 'Vivaldi\\User Data', url: 'vivaldi://extensions/?id=', exe: ['LOCALAPPDATA\\Vivaldi\\Application\\vivaldi.exe', 'ProgramFiles\\Vivaldi\\Application\\vivaldi.exe'], store: /clients2\.google\.com\/service\/update2\/crx/i },
  { key: 'yandex', name: 'Яндекс Браузер', env: 'LOCALAPPDATA', rel: 'Yandex\\YandexBrowser\\User Data', url: 'browser://extensions/?id=', exe: ['LOCALAPPDATA\\Yandex\\YandexBrowser\\Application\\browser.exe'], store: null },
  { key: 'opera', name: 'Opera', env: 'APPDATA', rel: 'Opera Software\\Opera Stable', single: true, url: 'opera://extensions', exe: ['LOCALAPPDATA\\Programs\\Opera\\opera.exe', 'ProgramFiles\\Opera\\opera.exe'], store: null },
  { key: 'operagx', name: 'Opera GX', env: 'APPDATA', rel: 'Opera Software\\Opera GX Stable', single: true, url: 'opera://extensions', exe: ['LOCALAPPDATA\\Programs\\Opera GX\\opera.exe'], store: null }
];
const FIREFOX = { key: 'firefox', name: 'Firefox', url: 'about:addons', exe: ['ProgramFiles\\Mozilla Firefox\\firefox.exe', 'ProgramFiles(x86)\\Mozilla Firefox\\firefox.exe'] };

// Права, которые стоит объяснить человеку. w — «вес» (насколько это серьёзно).
const PERMS = {
  webRequest: ['видеть всё, что браузер отправляет и получает', 1],
  webRequestBlocking: ['менять запросы браузера «на лету»', 1],
  cookies: ['читать «куки» — на них держится вход в ваши аккаунты', 1],
  history: ['читать историю посещённых сайтов', 1],
  tabs: ['видеть адреса всех открытых вкладок', 1],
  webNavigation: ['следить за каждым вашим переходом по сайтам', 1],
  clipboardRead: ['читать то, что вы скопировали', 1],
  tabCapture: ['снимать картинку вкладок', 1],
  pageCapture: ['сохранять содержимое страниц', 1],
  desktopCapture: ['снимать ваш экран', 2],
  nativeMessaging: ['общаться с программами на вашем компьютере', 2],
  proxy: ['менять путь, по которому идёт ваш интернет', 2],
  debugger: ['управлять страницами как отладчик (очень мощное право)', 2],
  management: ['управлять другими дополнениями', 2]
};
const BROAD = /^(<all_urls>|\*:\/\/\*\/\*?|https?:\/\/\*\/\*?|\*:\/\/\*\.\*\/\*|file:\/\/\/\*)$/i;

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const envPath = spec => { const i = spec.indexOf('\\'); const v = process.env[spec.slice(0, i)]; return v ? path.join(v, spec.slice(i + 1)) : null; };
const listDirs = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } };

function cmpVer(a, b) { const x = a.split(/[._-]/).map(n => parseInt(n, 10) || 0), y = b.split(/[._-]/).map(n => parseInt(n, 10) || 0); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; }

function localized(dir, manifest, raw) {
  if (typeof raw !== 'string' || !raw.startsWith('__MSG_')) return raw;
  const key = raw.slice(6, -2).toLowerCase();
  for (const loc of [manifest.default_locale, 'ru', 'en', 'en_US'].filter(Boolean)) {
    const m = readJson(path.join(dir, '_locales', loc, 'messages.json'));
    if (m) for (const k of Object.keys(m)) if (k.toLowerCase() === key && m[k] && m[k].message) return m[k].message;
  }
  return null;
}

// Оценка: баллы за права + баллы за происхождение.
function judge({ perms, hosts, origin }) {
  const sensitive = perms.filter(p => PERMS[p]);
  const broad = hosts.some(h => BROAD.test(h));
  let score = (broad ? 2 : 0) + sensitive.reduce((s, p) => s + PERMS[p][1], 0);
  const reasons = [];
  if (broad) reasons.push('Может читать и менять содержимое всех сайтов, которые вы открываете.');
  sensitive.forEach(p => reasons.push('Может ' + PERMS[p][0] + '.'));
  const risky = origin === 'unpacked' || origin === 'external';
  if (origin === 'unpacked') { score += 3; reasons.push('Подключено вручную из папки, а не из магазина дополнений — магазин такое не проверял.'); }
  else if (origin === 'external') { score += 2; reasons.push('Появилось не из магазина, а было поставлено другой программой или политикой.'); }
  else if (origin === 'nonstore') { score += 2; reasons.push('Обновляется не из магазина дополнений браузера.'); }
  else if (origin === 'unsigned') { score += 3; reasons.push('У дополнения нет подписи Mozilla — оно не проходило проверку.'); }
  let level = score >= 8 || (risky && broad && sensitive.length >= 2) ? 'bad' : score >= 5 || (risky && broad) ? 'warn' : 'ok';
  // из официального магазина с проверкой — красным не пугаем, только «стоит посмотреть»
  if (origin === 'store' && level === 'bad') level = 'warn';
  return { level, reasons, broad, sensitive };
}

function texts(level, name, reasons, origin) {
  if (level === 'bad') return {
    what: `Дополнение «${name}» — маленькая программа внутри браузера. У него очень широкие права, и оно появилось не обычным путём.`,
    risk: 'Такое дополнение может подсматривать за тем, что вы делаете в интернете: читать пароли и переписку на страницах, подменять рекламу, красть вход в аккаунты. Так обычно действуют вредные «расширения».',
    advice: origin === 'unpacked' || origin === 'external' || origin === 'unsigned'
      ? 'Если вы сами это не ставили и не знаете, что это, — удалите. Откройте список дополнений кнопкой ниже, найдите «' + name + '» и нажмите «Удалить». Потом смените пароли от важных сайтов.'
      : 'Если вы этим не пользуетесь или не помните, откуда оно, — удалите его в списке дополнений (кнопка ниже).'
  };
  if (level === 'warn') return {
    what: `Дополнение «${name}» — маленькая программа внутри браузера. Ему разрешено больше, чем нужно большинству.`,
    risk: 'Само по себе это не значит, что дополнение плохое: блокировщикам рекламы, переводчикам и помощникам для почты такие права нужны. Но если оно вам незнакомо, оно может следить за вашими действиями на сайтах.',
    advice: 'Если вы им пользуетесь и знаете, откуда оно, — оставьте. Если не помните его — удалите: откройте список дополнений кнопкой ниже и найдите «' + name + '».'
  };
  return { what: `Дополнение «${name}».`, risk: 'Особых прав не просит.', advice: 'Если не пользуетесь, можно отключить — меньше лишнего в браузере.' };
}

function chromiumItems(b, userData, errors) {
  const out = [];
  const profiles = b.single ? [''] : listDirs(userData).filter(n => n === 'Default' || /^Profile \d+$/.test(n));
  for (const prof of profiles) {
    const pdir = path.join(userData, prof);
    const sets = {};
    for (const f of ['Preferences', 'Secure Preferences']) {
      const j = readJson(path.join(pdir, f));
      const s = j && j.extensions && j.extensions.settings;
      if (s) for (const id of Object.keys(s)) sets[id] = { ...(sets[id] || {}), ...s[id] };
    }
    const extRoot = path.join(pdir, 'Extensions');
    for (const id of listDirs(extRoot)) {
      if (!/^[a-p]{32}$/.test(id)) continue;
      const vers = listDirs(path.join(extRoot, id)).sort(cmpVer);
      const ver = vers[vers.length - 1]; if (!ver) continue;
      const edir = path.join(extRoot, id, ver);
      const m = readJson(path.join(edir, 'manifest.json')); if (!m) continue;
      if (m.theme) continue; // темы оформления безвредны
      const st = sets[id] || {};
      const loc = st.location;
      if (loc === 5 || loc === 10) continue; // встроенные в браузер
      const disabled = st.state === 0 || (Array.isArray(st.disable_reasons) ? st.disable_reasons.length > 0 : !!st.disable_reasons);
      const name = localized(edir, m, m.name) || id;
      const perms = (m.permissions || []).filter(p => typeof p === 'string');
      const hosts = [...(m.host_permissions || []), ...(m.permissions || []).filter(p => typeof p === 'string' && /[:*]/.test(p)),
        ...((m.content_scripts || []).flatMap(c => c.matches || []))].filter(h => typeof h === 'string');
      let origin = 'store';
      if (loc === 4 || loc === 8) origin = 'unpacked';
      else if ([2, 3, 6, 7, 9].includes(loc)) origin = 'external';
      else if (b.store && m.update_url && !b.store.test(m.update_url)) origin = 'nonstore';
      else if (b.key === 'chrome' || b.key === 'edge') { if (st.from_webstore === false && loc !== 1) origin = 'nonstore'; }
      out.push({ browser: b.key, browserName: b.name, profile: prof || '—', id, name, version: ver, disabled, origin, perms, hosts, dir: edir });
    }
  }
  return out;
}

function firefoxItems(errors) {
  const out = [];
  const root = process.env.APPDATA && path.join(process.env.APPDATA, 'Mozilla', 'Firefox', 'Profiles');
  if (!root) return out;
  for (const prof of listDirs(root)) {
    const j = readJson(path.join(root, prof, 'extensions.json'));
    if (!j || !Array.isArray(j.addons)) continue;
    for (const a of j.addons) {
      if (a.type !== 'extension' || a.hidden || a.location === 'app-builtin' || a.location === 'app-system-defaults' || /^(app-system-addons|app-builtin)/.test(a.location || '')) continue;
      const up = a.userPermissions || {};
      const origin = a.location === 'app-profile' ? ((a.signedState || 0) > 0 ? 'store' : 'unsigned') : (a.location === 'winreg-app-global' || a.location === 'app-system-share' || a.location === 'app-system-local' || a.location === 'app-global' ? 'external' : 'store');
      out.push({ browser: 'firefox', browserName: FIREFOX.name, profile: prof, id: a.id, name: (a.defaultLocale && a.defaultLocale.name) || a.id, version: a.version || '',
        disabled: !!a.userDisabled || a.active === false, origin, perms: (up.permissions || []).filter(p => typeof p === 'string'), hosts: (up.origins || []).filter(p => typeof p === 'string'),
        dir: a.path || path.join(root, prof, 'extensions') });
    }
  }
  return out;
}

// Возвращает { items: [...], browsers: [...], errors }. Одинаковое дополнение из разных профилей показывается один раз.
function scan() {
  const errors = [], raw = [], found = [];
  for (const b of BROWSERS) {
    const base = process.env[b.env]; if (!base) continue;
    const ud = path.join(base, b.rel);
    if (!fs.existsSync(ud)) continue;
    found.push(b.name);
    try { raw.push(...chromiumItems(b, ud, errors)); } catch (e) { errors.push(`${b.name}: ${e.message}`); }
  }
  try { const f = firefoxItems(errors); if (f.length || fs.existsSync(path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox', 'Profiles'))) found.push(FIREFOX.name); raw.push(...f); } catch (e) { errors.push('Firefox: ' + e.message); }

  const merged = new Map();
  for (const r of raw) {
    const k = r.browser + '|' + r.id;
    const j = judge(r);
    const cur = merged.get(k);
    if (cur) { cur.profiles.push(r.profile); if (!r.disabled) cur.disabled = false; continue; }
    const t = texts(j.level, r.name, j.reasons, r.origin);
    merged.set(k, { ...r, profiles: [r.profile], level: j.level, reasons: j.reasons, ...t });
  }
  const order = { bad: 0, warn: 1, ok: 2 };
  const items = [...merged.values()].map(i => i.disabled && i.level !== 'ok'
    ? { ...i, level: 'ok', what: `Дополнение «${i.name}» сейчас выключено.`, risk: 'Пока оно выключено, оно ничего не делает.', advice: 'Если оно вам не нужно — лучше удалить совсем: откройте список дополнений кнопкой ниже.', reasons: ['Выключено в браузере.', ...i.reasons] }
    : i)
    .sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name, 'ru'));
  return { items, browsers: found, errors };
}

// Где лежит браузер (для кнопки «Открыть список дополнений»).
function findBrowserExe(key) {
  const b = key === 'firefox' ? FIREFOX : BROWSERS.find(x => x.key === key);
  if (!b) return null;
  for (const spec of b.exe) { const p = envPath(spec); if (p && fs.existsSync(p)) return { exe: p, url: b.url, name: b.name }; }
  return null;
}

module.exports = { scan, findBrowserExe, judge, BROWSERS };
