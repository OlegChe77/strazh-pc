// Обновление программы через GitHub Releases. Само ничего не ставит: сначала сообщает о новой версии,
// скачивает и ставит только после нажатия «Обновить». Установленная версия обновляется на месте (NSIS),
// portable-версия просто открывает страницу загрузки.
const { app, shell, net } = require('electron');

const REPO = { owner: 'OlegChe77', repo: 'strazh-pc' };
const RELEASES_URL = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest`;
const API_URL = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`;

// Сравнение «1.2.3» с «1.10.0» (приставки -beta и т.п. отбрасываем).
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

function create({ isAuto, send, canInstall }) {
  const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
  const st = { state: process.env.STRAZH_DEMO ? 'none' : 'idle', version: app.getVersion(), latest: null, portable, progress: 0, error: null, supported: app.isPackaged || !!process.env.STRAZH_DEMO };
  let au = null;
  const push = () => { try { send('update', { ...st }); } catch { /* окно закрыто */ } };
  const set = patch => { Object.assign(st, patch); push(); };

  function auto() {
    if (au) return au;
    au = require('electron-updater').autoUpdater;
    au.autoDownload = false;
    au.autoInstallOnAppQuit = false;
    au.logger = null;
    au.on('update-available', i => set({ state: 'available', latest: i.version, error: null }));
    au.on('update-not-available', () => set({ state: 'none', latest: null, error: null }));
    au.on('download-progress', p => set({ state: 'downloading', progress: Math.round(p.percent || 0) }));
    au.on('update-downloaded', () => {
      set({ state: 'ready', progress: 100 });
      // тихая установка: окно установщика не показываем, после установки программа запускается снова
      setTimeout(() => { try { au.quitAndInstall(true, true); } catch (e) { set({ state: 'error', error: e.message }); } }, 800);
    });
    au.on('error', e => set({ state: 'error', error: String(e && e.message || e).split('\n')[0].slice(0, 200) }));
    return au;
  }

  async function checkPortable() {
    const r = await net.fetch(API_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StrazhPC' } });
    if (!r.ok) throw new Error('GitHub ответил: ' + r.status);
    const j = await r.json(); const v = String(j.tag_name || '').replace(/^v/i, '');
    if (v && cmpVer(v, app.getVersion()) > 0) set({ state: 'available', latest: v, error: null });
    else set({ state: 'none', latest: null, error: null });
  }

  async function check() {
    if (!app.isPackaged) { set({ state: 'dev' }); return { ...st }; }
    if (['checking', 'downloading', 'ready'].includes(st.state)) return { ...st };
    set({ state: 'checking', error: null });
    try { if (portable) await checkPortable(); else await auto().checkForUpdates(); }
    catch (e) { set({ state: 'error', error: String(e && e.message || e).split('\n')[0].slice(0, 200) }); }
    return { ...st };
  }

  async function install() {
    if (st.state !== 'available') return { ok: false, error: 'Новой версии нет.' };
    if (portable) { shell.openExternal(RELEASES_URL); return { ok: true }; }
    const busy = canInstall && canInstall(); if (busy) return { ok: false, error: busy };
    set({ state: 'downloading', progress: 0 });
    try { await auto().downloadUpdate(); } catch (e) { set({ state: 'error', error: String(e && e.message || e).split('\n')[0].slice(0, 200) }); return { ok: false, error: st.error }; }
    return { ok: true };
  }

  return { get: () => ({ ...st, auto: isAuto() }), check, install, releasesUrl: RELEASES_URL };
}

module.exports = { create, cmpVer, RELEASES_URL, REPO };
