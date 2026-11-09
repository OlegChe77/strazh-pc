// Обновление программы: полоска сверху при новой версии и карточка в «Ещё → Обновления».
let UPD = null, updHidden = false;

function updBanner() {
  const b = $('#upd'); if (!b) return;
  const u = UPD;
  if (!u || updHidden || !['available', 'downloading', 'ready'].includes(u.state)) { b.classList.add('hide'); b.classList.remove('err'); return; }
  b.classList.remove('hide', 'err');
  if (u.state === 'available') {
    b.innerHTML = `<span>🆕 Вышла новая версия <b>${esc(u.latest)}</b> (у вас ${esc(u.version)}).</span><span class="sp"></span>
      <button class="btn pri" id="updGo" type="button">${u.portable ? 'Открыть страницу загрузки' : 'Обновить'}</button><button class="link" id="updLater" type="button">Позже</button>`;
  } else if (u.state === 'downloading') {
    b.innerHTML = `<span>Скачиваю обновление… ${u.progress || 0}%</span><span class="bar"><i style="width:${u.progress || 0}%"></i></span>`;
  } else {
    b.innerHTML = '<span>Обновление скачано. Сейчас перезапущусь и поставлю его…</span>';
  }
}

window.updCard = function () {
  const c = $('#updCard'); if (!c || !UPD) return;
  const u = UPD;
  const line = u.supported === false ? 'Проверка обновлений работает в установленной программе.'
    : u.state === 'checking' ? 'Проверяю…'
    : u.state === 'available' ? `Есть новая версия <b>${esc(u.latest)}</b>.`
    : u.state === 'error' ? `Не получилось проверить: ${esc(u.error || 'нет связи с GitHub')}.`
    : u.state === 'none' ? 'У вас последняя версия.' : '';
  c.innerHTML = `<div class="xs"><div class="card x"><span class="e">🔄</span><b>Версия ${esc(u.version)}</b><p>${line} Обновление ставится только после вашего «Обновить». Проверка заходит на GitHub и ничего о вас не передаёт.</p>
    <button class="btn" id="updCheck" type="button"${u.supported === false ? ' disabled' : ''}>Проверить сейчас</button>
    <label class="chk"><input type="checkbox" id="updAuto"${u.auto ? ' checked' : ''}> Проверять при запуске</label></div></div>`;
};

(async () => { try { UPD = await call('update:get'); updBanner(); } catch { /* без обновлений */ } })();
window.api.on('update', u => { UPD = { ...UPD, ...u }; updBanner(); if (window.updCard && $('#updCard')) window.updCard(); });

document.addEventListener('click', async ev => {
  const t = ev.target; let e;
  if ((e = t.closest('#updLater'))) { updHidden = true; return updBanner(); }
  if ((e = t.closest('#updGo'))) { const r = await call('update:install'); if (r && r.ok === false) info('Пока нельзя', `<p>${esc(r.error)}</p>`); return; }
  if ((e = t.closest('#updCheck'))) { const r = await call('update:check'); UPD = { ...UPD, ...r }; updHidden = false; updBanner(); window.updCard(); return; }
  if ((e = t.closest('#updAuto'))) { const r = await call('update:setAuto', e.checked); if (r) UPD.auto = r.auto; }
});
