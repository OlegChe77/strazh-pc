'use strict';
// Интерфейс: сейф, дополнения браузера, «разложить по папкам», копии раз в неделю.
// Использует общие функции из app.js (esc, call, modal, info, confirmBox, toast, fmtBytes, S, go).
const errBox = r => `<p class="err">${esc(r.error)}</p>`;
const fmtDate = d => new Date(d).toLocaleDateString('ru-RU');

// ======================= СЕЙФ =======================
function genPass(n = 16) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_!?';
  const a = new Uint32Array(n); crypto.getRandomValues(a);
  return [...a].map(x => abc[x % abc.length]).join('');
}

async function renderVault() {
  const box = $('#vaultBody'); if (!box) return;
  const st = await call('vault:status');
  if (!st.ok) { box.innerHTML = errBox(st); return; }
  if (!st.exists) return vaultCreateView(box, st.minPass);
  if (!st.open) return vaultLockedView(box);
  return vaultOpenView(box);
}

function vaultCreateView(box, min) {
  box.innerHTML = `<div class="card"><b style="font-size:18px">Создайте сейф</b>
   <p>Сейф — это запертое хранилище внутри программы. Всё, что вы туда положите (пароли, сканы документов, любые файлы), шифруется и открывается только вашим паролем.</p>
   <label class="fld">Придумайте пароль для сейфа (от ${min} символов)<input class="inp" id="vp1" type="password" autocomplete="new-password"></label>
   <label class="fld">Повторите пароль<input class="inp" id="vp2" type="password" autocomplete="new-password"></label>
   <div class="warnbox">⚠ <b>Пароль нельзя восстановить.</b> Я его нигде не храню. Если забудете — содержимое сейфа не откроет никто, даже я. Запишите пароль на бумажку и спрячьте дома.</div>
   <label class="rv"><input type="checkbox" id="vOk"><span>Я понимаю: если забуду пароль, данные из сейфа не вернуть</span></label>
   <div class="acts"><button class="btn" id="vGen" type="button">Придумать надёжный пароль</button><button class="btn pri" id="vCreate" type="button">Создать сейф</button></div><div id="vMsg"></div></div>`;
}
function vaultLockedView(box) {
  box.innerHTML = `<div class="card"><b style="font-size:18px">🔒 Сейф закрыт</b>
   <label class="fld">Пароль от сейфа<input class="inp" id="vpw" type="password" autocomplete="current-password"></label>
   <div class="acts"><button class="btn pri" id="vOpen" type="button">Открыть</button></div><div id="vMsg"></div></div>`;
  const f = $('#vpw'); if (f) f.focus();
}

async function vaultOpenView(box) {
  const r = await call('vault:list');
  if (!r.ok) { if (/закрыт/.test(r.error)) return renderVault(); box.innerHTML = errBox(r); return; }
  const notes = r.notes.length ? r.notes.map(n => `<div class="card q-row" data-nid="${esc(n.id)}"><div class="tx"><b>${esc(n.title)}</b><span>${esc([n.site, n.login].filter(Boolean).join(' · ') || 'без подробностей')}</span><code class="pw hide"></code></div>
     <button class="btn" data-v="show" type="button">Показать пароль</button><button class="btn" data-v="copypw" type="button">Копировать пароль</button>${n.login ? '<button class="btn" data-v="copylogin" type="button">Копировать логин</button>' : ''}<button class="link" data-v="delnote" type="button">Удалить…</button></div>`).join('')
    : `<div class="card empty"><b>Записей пока нет</b>Добавьте логин и пароль от почты, банка, госуслуг — всё будет под одним замком.</div>`;
  const files = r.files.length ? r.files.map(f => `<div class="card q-row" data-fid="${esc(f.id)}"><div class="tx"><b>${esc(f.name)}</b><span>${fmtBytes(f.size)} · добавлен ${fmtDate(f.added)}</span></div>
     <button class="btn" data-v="export" type="button">Достать наружу…</button><button class="link" data-v="delfile" type="button">Убрать из сейфа…</button></div>`).join('')
    : `<div class="card empty"><b>Файлов пока нет</b>Сюда можно положить сканы паспорта, договоры, фото документов.</div>`;
  box.innerHTML = `<div class="final" style="margin-top:0"><span class="glow mono">🔓 Сейф открыт</span><button class="btn" id="vLock" type="button">Закрыть сейф</button></div>
   <p class="note" style="margin-top:4px">Сам закроется через 10 минут без дела.</p>
   <div class="stepnum">ПАРОЛИ И ЗАПИСИ</div>${notes}<div class="acts"><button class="btn pri" id="vAddNote" type="button">+ Добавить запись</button></div>
   <div class="stepnum">ФАЙЛЫ</div>${files}<div class="acts"><button class="btn pri" id="vAddFiles" type="button">+ Положить файлы в сейф…</button></div>
   <p class="note">Файлы шифруются и лежат в папке программы. Достать файл наружу можно в любой момент — в сейфе он при этом остаётся.</p>`;
}

function noteForm() {
  return `<label class="fld">Название<input class="inp" id="nTitle" placeholder="Например: Почта" maxlength="120"></label>
   <label class="fld">Сайт (по желанию)<input class="inp" id="nSite" maxlength="200"></label>
   <label class="fld">Логин<input class="inp" id="nLogin" maxlength="200" autocomplete="off"></label>
   <label class="fld">Пароль<input class="inp" id="nPass" type="text" maxlength="500" autocomplete="off"></label>
   <button class="link n" id="nGen" type="button">Придумать надёжный пароль</button>
   <label class="fld">Заметка (по желанию)<input class="inp" id="nNote" maxlength="2000"></label><div id="nMsg"></div>`;
}

async function vaultAddNote() {
  modal({ title: 'Новая запись', html: noteForm(), buttons: [{ t: 'Отмена' }, { t: 'Сохранить в сейф', k: 'btn pri', keep: true, f: async btn => {
    const v = id => $('#' + id).value;
    btn.disabled = true;
    const r = await call('vault:addNote', { title: v('nTitle'), site: v('nSite'), login: v('nLogin'), password: v('nPass'), comment: v('nNote') });
    btn.disabled = false;
    if (!r.ok) { $('#nMsg').innerHTML = errBox(r); if (/закрыт/.test(r.error)) { closeModal(); renderVault(); } return; }
    closeModal(); toast('Запись сохранена в сейф'); renderVault();
  } }] });
}

async function vaultAddFiles() {
  const r = await call('vault:addFiles');
  if (!r.ok) { if (/закрыт/.test(r.error)) return renderVault(); return info('Не получилось', errBox(r)); }
  if (!r.added.length && !r.failed.length) return;
  const failed = r.failed.length ? `<p class="err">Не получилось:</p><div class="logbox">${r.failed.map(esc).join('\n')}</div>` : '';
  renderVault();
  if (!r.added.length) return info('Не получилось', failed);
  modal({ title: 'Файлы в сейфе', html: `<p>Положил в сейф: <b>${r.added.length}</b> шт. Каждый файл я проверил — он открывается обратно без потерь.</p>${failed}
    <p><b>Оригиналы пока лежат на старых местах.</b> Убрать их в Корзину Windows, чтобы они не лежали открыто? Из Корзины их можно вернуть.</p>`,
    buttons: [{ t: 'Оставить оригиналы', f: () => call('vault:keepOriginals') },
      { t: 'Да, убрать оригиналы в Корзину', k: 'btn red', f: async () => {
        const x = await call('vault:trashOriginals');
        if (!x.ok) return info('Не получилось', errBox(x));
        info('Готово', `<p>В Корзину отправлено: ${x.count} шт.</p>` + (x.problems.length ? `<p class="err">Не всё получилось:</p><div class="logbox">${x.problems.map(esc).join('\n')}</div>` : ''));
      } }] });
}

async function vaultClick(e) {
  const t = e.target; let el;
  if ((el = t.closest('#vGen'))) { const p = genPass(); $('#vp1').type = 'text'; $('#vp2').type = 'text'; $('#vp1').value = p; $('#vp2').value = p; $('#vMsg').innerHTML = '<p class="note">Запишите этот пароль на бумагу — он больше нигде не сохранится.</p>'; return true; }
  if ((el = t.closest('#nGen'))) { $('#nPass').value = genPass(); return true; }
  if ((el = t.closest('#vCreate'))) {
    const p1 = $('#vp1').value, p2 = $('#vp2').value, msg = $('#vMsg');
    if (p1 !== p2) { msg.innerHTML = '<p class="err">Пароли не совпадают.</p>'; return true; }
    if (!$('#vOk').checked) { msg.innerHTML = '<p class="err">Отметьте галочку, что вы понимаете про забытый пароль.</p>'; return true; }
    el.disabled = true; msg.innerHTML = '<p class="note">Создаю сейф…</p>';
    const r = await call('vault:create', p1); el.disabled = false;
    if (!r.ok) { msg.innerHTML = errBox(r); return true; }
    toast('Сейф создан'); renderVault(); return true;
  }
  if ((el = t.closest('#vOpen'))) {
    const msg = $('#vMsg'); el.disabled = true; msg.innerHTML = '<p class="note">Открываю…</p>';
    const r = await call('vault:unlock', $('#vpw').value); el.disabled = false;
    if (!r.ok) { msg.innerHTML = errBox(r); return true; }
    renderVault(); return true;
  }
  if (t.closest('#vLock')) { await call('vault:lock'); toast('Сейф закрыт'); renderVault(); return true; }
  if (t.closest('#vAddNote')) { vaultAddNote(); return true; }
  if (t.closest('#vAddFiles')) { vaultAddFiles(); return true; }
  if ((el = t.closest('[data-v]'))) {
    const row = el.closest('[data-nid],[data-fid]'), nid = row.dataset.nid, fid = row.dataset.fid, a = el.dataset.v;
    if (a === 'show') {
      const code = row.querySelector('.pw');
      if (!code.classList.contains('hide')) { code.classList.add('hide'); code.textContent = ''; el.textContent = 'Показать пароль'; return true; }
      const r = await call('vault:getNote', nid); if (!r.ok) { toast(r.error); return true; }
      code.textContent = r.note.password || '(пусто)'; code.classList.remove('hide'); el.textContent = 'Спрятать пароль'; return true;
    }
    if (a === 'copypw' || a === 'copylogin') { const r = await call('vault:copy', nid, a === 'copypw' ? 'password' : 'login'); toast(r.ok ? (a === 'copypw' ? 'Пароль скопирован на 30 секунд' : 'Логин скопирован') : r.error); return true; }
    if (a === 'delnote') { confirmBox('Удалить запись?', '<p>Запись с логином и паролем исчезнет из сейфа <b>насовсем</b>, вернуть её будет нельзя.</p>', 'Да, удалить', async () => { const r = await call('vault:deleteNote', nid); if (!r.ok) return info('Не получилось', errBox(r)); renderVault(); }, 'btn red'); return true; }
    if (a === 'export') { const r = await call('vault:export', fid); if (!r.ok) info('Не получилось', errBox(r)); else if (r.saved) toast('Файл достан: ' + r.path); return true; }
    if (a === 'delfile') { confirmBox('Убрать файл из сейфа?', '<p>Зашифрованная копия исчезнет из сейфа <b>насовсем</b>. Если оригинала у вас больше нет, вернуть файл будет нельзя — сначала достаньте его наружу.</p>', 'Да, убрать из сейфа', async () => { const r = await call('vault:removeFile', fid); if (!r.ok) return info('Не получилось', errBox(r)); renderVault(); }, 'btn red'); return true; }
  }
  return false;
}
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.id === 'vpw') { const b = $('#vOpen'); if (b) b.click(); }
});

// ======================= ДОПОЛНЕНИЯ БРАУЗЕРА =======================
const ES = { data: null };
function renderExt() {
  const box = $('#extBody'); if (!box) return;
  if (!ES.data) {
    box.innerHTML = `<div class="card"><b style="font-size:18px">Проверить дополнения в браузерах</b>
     <p>Дополнения (расширения) — это маленькие программы внутри браузера. Вредные из них подсматривают за вами, подменяют рекламу и крадут входы в аккаунты. Я посмотрю, какие права у ваших дополнений и откуда они взялись.</p>
     <p class="note">Смотрю Chrome, Edge, Яндекс Браузер, Opera, Brave, Vivaldi и Firefox. Ничего не меняю и не удаляю.</p>
     <div class="acts"><button class="btn pri" id="xScan" type="button">🔎 Проверить дополнения</button></div><div class="step" id="xStep"></div></div>`;
    return;
  }
  const d = ES.data, bad = d.items.filter(i => i.level === 'bad'), warn = d.items.filter(i => i.level === 'warn'), ok = d.items.filter(i => i.level === 'ok');
  const card = (i, k) => `<div class="card f c-${i.level}${k ? '' : ' open'}" data-xid="${esc(i.id)}"><div class="top"><span class="dot"></span><div class="tx"><span class="lbl">${LBL[i.level]} · ${esc(i.browserName)}</span><b>${esc(i.name)}</b></div><span class="arr">Подробнее ▾</span></div>
    <div class="more"><div class="q"><span>&gt; ЧТО ЭТО</span><p>${esc(i.what)}</p></div><div class="q"><span>&gt; ЧЕМ ОПАСНО</span><p>${esc(i.risk)}</p></div><div class="q"><span>&gt; Я СОВЕТУЮ</span><p>${esc(i.advice)}</p></div>
    <div class="acts">${i.canOpen ? '<button class="btn pri" data-x="openlist" type="button">Открыть список дополнений</button>' : ''}</div>
    <details><summary>Для знающих: подробности</summary><p>Браузер: ${esc(i.browserName)} · профили: ${esc(i.profiles.join(', '))} · версия ${esc(i.version)}</p><ul class="why">${i.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul><button class="link n" data-x="reveal" type="button">Показать папку дополнения</button></details></div></div>`;
  const cards = [...bad, ...warn].map(card).join('');
  box.innerHTML = `<p class="note" style="margin:0 0 14px">Нашёл браузеры: ${d.browsers.length ? esc(d.browsers.join(', ')) : 'никаких'}. Дополнений: ${d.items.length} — опасных ${bad.length}, стоит посмотреть ${warn.length}, спокойных ${ok.length}.</p>` +
    (d.errors.length ? `<div class="note err">Не всё удалось проверить: ${d.errors.map(esc).join(' · ')}</div>` : '') +
    (cards || `<div class="card empty"><b>Подозрительных дополнений не нашёл</b>Это хорошая новость.</div>`) +
    (ok.length ? `<details class="card"><summary>Остальные дополнения (${ok.length}) — ничего страшного</summary><ul>${ok.map(i => `<li>${esc(i.name)} <span class="note">— ${esc(i.browserName)}${i.disabled ? ', выключено' : ''}</span></li>`).join('')}</ul></details>` : '') +
    `<div class="acts"><button class="btn" id="xScan" type="button">Проверить заново</button></div><p class="note">Удалять дополнения я не умею и не буду: это делаете вы сами в списке дополнений браузера. Кнопка «Открыть список дополнений» откроет его сразу на нужном месте.</p>`;
}
async function extScan() {
  const b = $('#xScan'); if (b) b.disabled = true;
  const st = $('#xStep'); if (st) st.textContent = 'Смотрю браузеры…';
  const r = await call('ext:scan');
  if (!r.ok) { if (b) b.disabled = false; if (st) st.textContent = ''; return info('Не получилось', errBox(r)); }
  ES.data = r; renderExt();
  const bad = r.items.filter(i => i.level === 'bad').length;
  say(bad ? 'Есть дополнения с опасными правами. Откройте красные строчки — я объясню, что делать.' : 'Готово! Откройте жёлтые строчки, если они есть.');
}

// ======================= РАЗЛОЖИТЬ ПО ПАПКАМ =======================
async function orgPlan() {
  const b = $('#orgGo'); if (b) { b.disabled = true; b.textContent = 'Смотрю даты съёмки…'; }
  const r = await call('organize:plan');
  if (b) { b.disabled = false; b.textContent = 'Посмотреть, как я разложу'; }
  if (!r.ok) return info('Не получилось', errBox(r));
  if (!r.total) return info('Раскладывать нечего', '<p>Фото и видео, которые лежат россыпью в «Изображениях» и «Видео», я не нашёл. Либо там уже порядок, либо всё лежит в ваших альбомах — их я не трогаю.</p>');
  const bytes = new Map(r.groups.map(g => [g.key, g]));
  const rows = r.groups.map(g => `<label class="rv"><input type="checkbox" data-gk="${esc(g.key)}" checked><span><b>${esc(g.label)}</b> — ${[g.photos ? g.photos + ' фото' : '', g.videos ? g.videos + ' видео' : ''].filter(Boolean).join(', ')} · ${fmtBytes(g.bytes)}<small>${esc(g.sample.join(', '))}${g.count > g.sample.length ? '…' : ''}</small></span></label>`).join('');
  const m = modal({ wide: true, title: 'Разложить по папкам год/месяц',
    html: `<p>Всего файлов: <b>${r.total}</b>. Они переедут в подпапки <code>По датам\\Год\\Месяц</code> внутри тех же папок, где лежат сейчас. <b>Ничего не удаляется</b>, и всё можно вернуть кнопкой «Вернуть как было».</p>
     <p class="note">Дату беру из самого снимка (${r.src.exif}), из названия файла (${r.src.name}) или из даты изменения файла (${r.src.mtime}). Снимите галочки с месяцев, которые трогать не нужно. Папки-альбомы я не трогаю.</p>
     <div class="rev-list">${rows}</div><p class="note" id="orgSum"></p>`,
    buttons: [{ t: 'Отмена' }, { t: 'Да, разложить выбранное', k: 'btn pri', keep: true, f: async btn => {
      const keys = $$('#modal input[data-gk]:checked').map(i => i.dataset.gk);
      if (!keys.length) return;
      btn.disabled = true; btn.textContent = 'Раскладываю…';
      const x = await call('organize:apply', keys);
      closeModal();
      if (!x.ok) return info('Не получилось', errBox(x));
      S.space = null; S.phase = 'idle'; renderSpace(); refreshSpaceExtras();
      info('Готово', `<p>Разложено файлов: <b>${x.moved}</b>.</p><p class="note">Передумали — на вкладке «Место на диске» есть кнопка «Вернуть как было».</p>` + (x.problems.length ? `<p class="err">Не всё получилось:</p><div class="logbox">${x.problems.map(esc).join('\n')}</div>` : ''));
    } }] });
  const upd = () => { const ch = $$('#modal input[data-gk]:checked'); const n = ch.reduce((s, i) => s + bytes.get(i.dataset.gk).count, 0); $('#orgSum').textContent = `Выбрано месяцев: ${ch.length}, файлов: ${n}`; };
  m.addEventListener('change', upd); upd();
}

// ======================= КОПИИ РАЗ В НЕДЕЛЮ =======================
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_ON = ['по воскресеньям', 'по понедельникам', 'по вторникам', 'по средам', 'по четвергам', 'по пятницам', 'по субботам'];
const DAY_NAME = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const KIND_NAME = { jpg: 'Фотографии', png: 'Картинки и скриншоты', video: 'Видео' };
const WK = { st: null };

async function refreshSpaceExtras() {
  const [w, o] = await Promise.all([call('weekly:get'), call('organize:state')]);
  if (w.ok) WK.st = w;
  renderPending(); renderWeekly(); renderOrg(o.ok ? o : null);
}

function renderPending() {
  const box = $('#pendBox'); if (!box) return;
  const p = WK.st && WK.st.pending;
  box.innerHTML = p && p.count ? `<div class="card work" style="margin-bottom:14px"><b class="glow">Готовые копии ждут вашего решения</b>
    <p>Сжатых копий: <b>${p.count}</b>. Если заменить ими оригиналы, освободится около <b class="glow">${fmtBytes(p.saved)}</b>. Оригиналы уйдут в Корзину Windows — оттуда их можно вернуть.</p>
    <div class="acts"><button class="btn pri" data-act="replace" type="button">Заменить оригиналы копиями…</button><button class="btn" data-act="openout" type="button">Открыть папку с копиями</button></div></div>` : '';
}

function renderOrg(o) {
  const box = $('#orgBox'); if (!box) return;
  box.innerHTML = `<div class="stepnum">НАВЕСТИ ПОРЯДОК</div><div class="card x" style="flex-direction:column"><span class="e">🗂️</span><b>Разложить фото и видео по папкам год/месяц</b>
   <p>Фото и видео, которые свалены в кучу в «Изображениях» и «Видео», я разложу по папкам: <code style="display:inline">По датам\\2023\\04 Апрель</code>. Файлы только переносятся — ничего не удаляется. Сначала покажу, что куда поедет, и спрошу.</p>
   <div class="acts"><button class="btn pri" id="orgGo" type="button">Посмотреть, как я разложу</button>${o && o.undo ? `<button class="btn" id="orgUndo" type="button">Вернуть как было (${o.undo.count} шт.)</button>` : ''}</div></div>`;
}

function whenText(st) {
  if (!st.cfg.enabled) return '';
  const when = `${DAY_ON[st.cfg.day]} в ${String(st.cfg.hour).padStart(2, '0')}:00`;
  const next = st.task && st.task.next ? ` Ближайший запуск: ${new Date(st.task.next).toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.` : '';
  const last = st.cfg.lastRun ? ` В прошлый раз (${new Date(st.cfg.lastRun).toLocaleDateString('ru-RU')}) подготовлено копий: ${st.cfg.lastSummary ? st.cfg.lastSummary.done : 0}.` : '';
  return `<p class="glow">Включено: ${when}.${next}${last}</p>`;
}

function renderWeekly() {
  const box = $('#weeklyBox'); if (!box) return;
  const st = WK.st; if (!st) { box.innerHTML = ''; return; }
  if (st.running) {
    box.innerHTML = `<div class="stepnum">КОПИИ ПО РАСПИСАНИЮ</div><div class="card work"><b id="cwTitle">Готовлю копии по расписанию…</b><div class="nm" id="cwName"></div><div class="prog on"><i id="cwBar" style="width:0"></i></div><div class="step" id="cwStep"></div><div class="acts"><button class="btn" id="cwStop" type="button">Остановить</button></div><p class="note">Оригиналы не трогаю. Можно закрыть это окно — работа продолжится.</p></div>`;
    return;
  }
  const c = st.cfg;
  box.innerHTML = `<div class="stepnum">КОПИИ ПО РАСПИСАНИЮ</div><div class="card x" style="flex-direction:column"><span class="e">📅</span><b>Готовить копии раз в неделю</b>
   <p>Раз в неделю я сам сделаю сжатые копии <b>новых</b> фото и видео в папке <code style="display:inline">${esc(st.outRoot)}</code>. Оригиналы <b>не трогаю и ничего не удаляю</b>. Когда копии будут готовы, при следующем открытии программы я спрошу, заменять ли ими оригиналы.</p>
   ${whenText(st)}
   <label class="rv"><input type="checkbox" id="wkOn"${c.enabled ? ' checked' : ''}><span>Включить еженедельную подготовку копий</span></label>
   <div class="wkrow"><label class="fld">День<select class="inp" id="wkDay">${DAY_ORDER.map(d => `<option value="${d}"${c.day === d ? ' selected' : ''}>${DAY_NAME[d]}</option>`).join('')}</select></label>
   <label class="fld">Время<select class="inp" id="wkHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${c.hour === h ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label></div>
   <div class="wkkinds">${Object.keys(KIND_NAME).map(k => `<label class="rv"><input type="checkbox" data-wk="${k}"${c.kinds.includes(k) ? ' checked' : ''}><span>${KIND_NAME[k]}</span></label>`).join('')}</div>
   <div class="acts"><button class="btn pri" id="wkSave" type="button">Сохранить расписание</button></div>
   <p class="note">Компьютер должен быть включён и подключён к питанию. Если в назначенное время он был выключен, подготовка начнётся при ближайшем включении. Работает тихо, в фоне. ${st.packaged ? '' : '(Сейчас программа запущена из папки разработки.)'}</p></div>`;
}

async function weeklySave() {
  const enabled = $('#wkOn').checked, day = +$('#wkDay').value, hour = +$('#wkHour').value;
  const kinds = $$('input[data-wk]:checked').map(i => i.dataset.wk);
  const go = async () => {
    const r = await call('weekly:set', { enabled, day, hour, kinds });
    if (!r.ok) return info('Не получилось', errBox(r));
    WK.st = r; renderWeekly(); renderPending();
    toast(enabled ? 'Расписание включено' : 'Расписание выключено');
  };
  if (!enabled) return go();
  if (!kinds.length) return info('Что готовить?', '<p>Отметьте хотя бы один пункт: фото, картинки или видео.</p>');
  confirmBox('Включить копии раз в неделю?', `<p>Создам в «Планировщике заданий» Windows задание «StrazhPC - weekly copies»: ${DAY_ON[day]} в ${String(hour).padStart(2, '0')}:00 оно запустит меня в фоне.</p><p class="note">Я только готовлю копии, оригиналы не трогаю. Выключить можно здесь же в любой момент — задание удалится.</p>`, 'Да, включить', go);
}

async function askReplace() {
  const p = await call('space:pending');
  if (!p.ok || !p.count) return info('Нечего заменять', '<p>Готовых копий, которые ждут замены, нет.</p>');
  confirmBox('Заменить оригиналы копиями?', `<p>Оригиналы (${p.count} шт.) отправятся в <b>Корзину Windows</b>, а на их место встанут сжатые копии. Освободится около <b>${fmtBytes(p.saved)}</b>.</p><p class="note">Видео станут файлами .mp4. Если что-то пойдёт не так, оригиналы можно вернуть из Корзины.</p>`, 'Да, заменить', async () => {
    const x = await call('space:replace');
    if (!x.ok) return info('Не получилось', errBox(x));
    S.replaced = x; if (S.phase === 'done' && S.result) renderSpaceDone($('#spaceBody'));
    refreshSpaceExtras();
    info(x.problems.length ? 'Не всё заменено' : 'Готово', `<p>Заменено: <b>${x.count}</b> шт., освободилось <b>${fmtBytes(x.saved)}</b>. Старые файлы лежат в Корзине.</p>` + (x.problems.length ? `<div class="logbox">${x.problems.map(esc).join('\n')}</div><p class="note">Эти оригиналы остались на месте.</p>` : ''));
  }, 'btn red');
}

// ======================= общий обработчик =======================
document.addEventListener('click', async ev => {
  const t = ev.target; let e;
  if (await vaultClick(ev)) return;
  if (t.closest('#xScan')) return extScan();
  if ((e = t.closest('[data-x]'))) {
    const id = e.closest('[data-xid]').dataset.xid, r = await call('ext:act', id, e.dataset.x);
    if (!r.ok) info('Не получилось', errBox(r)); return;
  }
  if (t.closest('#orgGo')) return orgPlan();
  if (t.closest('#orgUndo')) {
    return confirmBox('Вернуть всё как было?', '<p>Все файлы, которые я раскладывал по папкам, вернутся на прежние места. Пустые папки «По датам» уберу.</p>', 'Да, вернуть', async () => {
      const r = await call('organize:undo'); if (!r.ok) return info('Не получилось', errBox(r));
      refreshSpaceExtras(); S.space = null; S.phase = 'idle'; renderSpace();
      info('Готово', `<p>Возвращено файлов: <b>${r.restored}</b>.</p>` + (r.problems.length ? `<p class="err">Не всё получилось:</p><div class="logbox">${r.problems.map(esc).join('\n')}</div>` : ''));
    });
  }
  if (t.closest('#wkSave')) return weeklySave();
  if ((e = t.closest('[data-act]'))) {
    if (e.dataset.act === 'replace') return askReplace();
    if (e.dataset.act === 'openout') return void call('space:openOutput');
  }
});
