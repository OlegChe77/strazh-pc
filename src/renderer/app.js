'use strict';
// Интерфейс «Страж ПК». Всё, что приходит из проверки (имена файлов и т.п.), вставляется через esc() — как текст, не как код.
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const call = (ch, ...a) => window.api.call(ch, ...a);
const num = (n, d = 1) => n.toFixed(d).replace('.', ',');
function fmtBytes(b) {
  if (b >= 1024 ** 3) return num(b / 1024 ** 3) + ' ГБ';
  if (b >= 1024 ** 2) return num(b / 1024 ** 2, b >= 100 * 1024 ** 2 ? 0 : 1) + ' МБ';
  return Math.max(1, Math.round(b / 1024)) + ' КБ';
}
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c; };
const LBL = { bad: 'ОПАСНО', warn: 'СТОИТ ПОСМОТРЕТЬ', ok: 'НЕ СТРАШНО' };

const S = { info: null, threats: null, space: null, scanning: false, busy: false, phase: 'idle', checks: { jpg: true, png: true, video: true }, result: null, replaced: null, q: null };

// ---------- подсказка внизу ----------
const SAY = {
  ov: 'Привет! Нажмите большую зелёную кнопку — я проверю компьютер и расскажу простыми словами, что нашёл.',
  sec: 'Нажмите на любую строчку — объясню, что это и чем грозит. Без вашего согласия я ничего не трогаю.',
  space: 'Найдите, что можно освободить, отметьте галочками и нажмите «Сжать». Оригиналы убираю только с вашего разрешения.',
  more: 'Здесь карантин, сейф для паролей и проверка дополнений в браузере.',
  vault: 'Сейф открывается только вашим паролем. Забудете пароль — вернуть данные не сможет никто.',
  ext: 'Проверю дополнения в браузерах. Сам ничего не удаляю — только подскажу, что убрать.'
};
const NAVMAP = { vault: 'more', ext: 'more' };
let ti;
function say(t) { clearInterval(ti); let i = 0; const e = $('#say'); e.textContent = ''; ti = setInterval(() => { e.textContent = t.slice(0, ++i); if (i >= t.length) clearInterval(ti); }, 14); }

function toast(t) { const e = document.createElement('div'); e.className = 'toast'; e.textContent = t; document.body.append(e); setTimeout(() => e.remove(), 3200); }

// ---------- окна ----------
function modal({ title, html, buttons, wide }) {
  const m = $('#modal');
  m.className = 'modal on' + (wide ? ' wide' : '');
  m.innerHTML = `<div class="card"><h3>${esc(title)}</h3><div class="mb">${html}</div><div class="acts"></div></div>`;
  buttons.forEach(b => {
    const e = document.createElement('button');
    e.className = b.k || 'btn'; e.textContent = b.t; e.type = 'button';
    e.onclick = async () => { if (b.keep) { await b.f(e); return; } m.classList.remove('on'); if (b.f) b.f(); };
    m.querySelector('.acts').append(e);
  });
  return m;
}
const closeModal = () => $('#modal').classList.remove('on');
const info = (title, html) => modal({ title, html, buttons: [{ t: 'Понятно', k: 'btn pri' }] });
const confirmBox = (title, html, yes, onYes, kind) => modal({ title, html, buttons: [{ t: 'Отмена' }, { t: yes, k: kind || 'btn pri', f: onYes }] });

// ---------- навигация ----------
function go(id) {
  if (!SAY[id]) id = 'ov';
  $$('.page').forEach(p => p.classList.toggle('on', p.id === id));
  $$('.nv').forEach(b => b.classList.toggle('on', b.dataset.go === (NAVMAP[id] || id)));
  scrollTo(0, 0); say(SAY[id]);
  if (id === 'more') renderMore();
  if (id === 'vault') renderVault();
  if (id === 'ext') renderExt();
  if (id === 'space') refreshSpaceExtras();
}

// ---------- главная ----------
function renderOverview() {
  const res = $('#res');
  const t = S.threats;
  if (!t) {
    const last = S.info && S.info.lastScan ? 'Последняя проверка: ' + new Date(S.info.lastScan).toLocaleString('ru-RU') : 'Проверка ещё не запускалась.';
    if (!S.scanning) $('#step').textContent = last;
    res.innerHTML = '';
    return;
  }
  const bad = t.findings.filter(f => f.level === 'bad').length, warn = t.findings.filter(f => f.level === 'warn').length;
  const rows = [];
  rows.push(bad
    ? `<div class="card row c-bad"><span class="dot"></span><div class="tx"><b>${bad} ${plural(bad, 'опасная находка', 'опасные находки', 'опасных находок')}</b><span>Лучше разобраться сразу</span></div><button class="btn pri" data-go="sec">Разобраться</button></div>`
    : `<div class="card row c-ok"><span class="dot"></span><div class="tx"><b>Опасного не найдено</b><span>Вредных программ и майнеров я не увидел</span></div></div>`);
  rows.push(warn
    ? `<div class="card row c-warn"><span class="dot"></span><div class="tx"><b>${warn} ${plural(warn, 'место, которое', 'места, которые', 'мест, которые')} стоит посмотреть</b><span>Пароли на виду, открытые папки и порты, облако, незнакомые программы</span></div><button class="btn" data-go="sec">Посмотреть</button></div>`
    : `<div class="card row c-ok"><span class="dot"></span><div class="tx"><b>Утечек данных не заметил</b><span>Открытых папок, портов и файлов с паролями нет</span></div></div>`);
  const sp = S.space;
  if (sp) {
    const total = sp.summary.jpg.saveBytes + sp.summary.png.saveBytes + sp.summary.video.saveBytes + sp.summary.dup.saveBytes + sp.summary.installer.saveBytes;
    rows.push(`<div class="card row c-ok"><span class="dot"></span><div class="tx"><b>${total > 50 * 1024 * 1024 ? 'Можно освободить около ' + fmtBytes(total) : 'Лишнего места почти нет'}</b><span>Фото и видео станут легче, а выглядеть будут так же</span></div><button class="btn" data-go="space">Освободить</button></div>`);
  }
  res.innerHTML = rows.join('');
  $$('#res .row').forEach(r => { r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash'); });
}

async function startScan() {
  if (S.scanning || S.busy) return;
  S.scanning = true;
  const h = $('#hero'); h.classList.add('scanning'); $('.prog').classList.add('on'); $('#scanStop').classList.remove('hide'); $('#scan').disabled = true;
  say('Проверяю… Это займёт около минуты. Компьютером можно пользоваться.');
  const r = await call('scan:all');
  S.scanning = false; h.classList.remove('scanning'); $('.prog').classList.remove('on'); $('#scanStop').classList.add('hide'); $('#scan').disabled = false;
  if (!r.ok) { $('#step').textContent = r.error; return; }
  S.threats = r.threats; S.space = r.space; S.phase = r.space ? 'ready' : 'idle'; S.result = null; S.replaced = null;
  S.info = await call('app:info');
  $('#step').textContent = r.cancelled ? 'Проверка остановлена.' : 'Готово! Проверено только что.';
  renderOverview(); renderSecurity(); renderSpace();
  const hasBad = r.threats.findings.some(f => f.level === 'bad');
  say(hasBad ? 'Готово! Самое важное — красная строчка. Нажмите «Разобраться», и я всё объясню.' : 'Готово! Всё спокойно. Загляните в «Защиту» и «Место на диске».');
}

// ---------- защита ----------
function whyText(f) { return f.reasons && f.reasons.length ? `<div class="q"><span>&gt; ПОЧЕМУ Я ТАК РЕШИЛ</span><ul class="why">${f.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''; }

function renderSecurity() {
  const t = S.threats, head = $('#secHead'), list = $('#list');
  if (!t) { head.innerHTML = ''; list.innerHTML = `<div class="card empty"><b>Проверка ещё не запускалась</b>Нажмите «Проверить компьютер» на главной.<div class="acts" style="justify-content:center"><button class="btn pri" data-go="ov">К проверке</button></div></div>`; return; }
  const s = t.stats;
  head.innerHTML = `<p class="note" style="margin:0 0 14px">Проверено: автозапуск — ${s.startup}, работающих программ — ${s.processes}, подключений к интернету — ${s.connections}, общих папок — ${s.shares}, открытых портов — ${s.ports || 0}, облачных папок — ${s.cloud || 0}, файлов в «Документах» и на «Рабочем столе» — ${s.files}.` +
    (t.ignoredCount ? ` Скрыто вами: ${t.ignoredCount}. <button class="link n" id="unhide" type="button">Показать снова</button>` : '') + '</p>' +
    (t.errors.length ? `<div class="note err">Не всё удалось проверить: ${t.errors.map(esc).join(' · ')}</div>` : '');
  if (!t.findings.length) { list.innerHTML = `<div class="card empty"><b>Ничего подозрительного не найдено</b>Это хорошая новость. Проверяйте компьютер время от времени.</div>`; return; }
  list.innerHTML = t.findings.map((f, i) => {
    const btns = [];
    if (f.actions.includes('neutralize')) btns.push(`<button class="btn pri" data-a="neutralize">Обезвредить</button>`);
    if (f.actions.includes('closeshare')) btns.push(`<button class="btn pri" data-a="closeshare">Закрыть доступ</button>`);
    if (f.actions.includes('closeport')) btns.push(`<button class="btn pri" data-a="closeport">Закрыть порт</button>`);
    if (f.actions.includes('quarantine')) btns.push(`<button class="btn pri" data-a="quarantine">Убрать в защищённую папку</button>`);
    btns.push(`<button class="btn" data-a="ignore">Это моё, не трогать</button>`);
    return `<div class="card f c-${f.level}${i ? '' : ' open'}" data-id="${esc(f.id)}"><div class="top"><span class="dot"></span><div class="tx"><span class="lbl">${LBL[f.level]}</span><b>${esc(f.title)}</b></div><span class="arr">Подробнее ▾</span></div>
<div class="more"><div class="q"><span>&gt; ЧТО ЭТО</span><p>${esc(f.what)}</p></div><div class="q"><span>&gt; ЧЕМ ОПАСНО</span><p>${esc(f.risk)}</p></div><div class="q"><span>&gt; Я СОВЕТУЮ</span><p>${esc(f.advice)}</p></div>
<div class="acts">${btns.join('')}</div>
<details><summary>Для знающих: подробности</summary>${f.path ? `<code>${esc(f.path)}</code>` : ''}${whyText(f)}${f.actions.includes('reveal') ? `<button class="link n" data-a="reveal" type="button">Показать в папке</button>` : ''}</details></div></div>`;
  }).join('');
}

function actWords(f, a) {
  if (a === 'neutralize') return {
    title: 'Обезвредить эту программу?',
    html: `<p>${esc(f.advice)}</p><p class="note">Что именно произойдёт: программа будет остановлена, её запуск при включении Windows отключён, а сам файл переедет в карантин. <b>Ничего не удаляется</b>, вернуть можно в «Ещё → Карантин».</p>`,
    yes: 'Да, обезвредить'
  };
  if (a === 'quarantine') return {
    title: 'Убрать файл в защищённую папку?',
    html: `<p>Файл «${esc(f.path.split('\\').pop())}» переедет из вашей папки в карантин программы. Он <b>не удаляется</b> — вернуть его можно в «Ещё → Карантин».</p>`,
    yes: 'Да, убрать'
  };
  if (a === 'closeport') return {
    title: 'Закрыть этот порт?',
    html: `<p>${esc(f.advice)}</p><p class="note">Что именно произойдёт: в Брандмауэре Windows появится правило «блокировать входящие подключения» на этот порт. Программа не удаляется и не останавливается, но извне до неё больше не достучаться. Windows покажет окно «Разрешить этому приложению вносить изменения?» — нужно ответить «Да». Вернуть можно, удалив правило «StrazhPC: port … blocked» в Брандмауэре Windows.</p>`,
    yes: 'Да, закрыть порт'
  };
  return {
    title: 'Закрыть общий доступ?',
    html: `<p>${esc(f.advice)}</p><p class="note">Windows покажет окно «Разрешить этому приложению вносить изменения?» — нужно ответить «Да». Файлы в папке не удаляются.</p>`,
    yes: 'Да, закрыть доступ'
  };
}

async function doAct(card, f, a) {
  const r = await call('finding:act', f.id, a);
  if (!r.ok) return info('Не получилось', `<p class="err">${esc(r.error)}</p>`);
  if (r.keep) return;
  card.classList.add('done'); card.classList.remove('open');
  card.querySelector('.arr').textContent = a === 'ignore' ? '✓ Оставлено' : '✓ Готово';
  S.threats.findings = S.threats.findings.filter(x => x.id !== f.id); renderOverview();
  if (a !== 'ignore') info('Готово', `<div class="logbox">${(r.log || []).map(esc).join('\n')}</div>` + (r.problems && r.problems.length ? `<p class="err">Не всё получилось:</p><div class="logbox">${r.problems.map(esc).join('\n')}</div>` : ''));
  else toast('Больше не буду показывать эту находку');
}

document.addEventListener('click', async ev => {
  const t = ev.target;
  let e = t.closest('[data-go]'); if (e) return go(e.dataset.go);
  e = t.closest('.f .top'); if (e) { const f = e.parentElement; if (!f.classList.contains('done')) f.classList.toggle('open'); return; }
  e = t.closest('#unhide'); if (e) { await call('ignored:reset'); toast('Скрытые находки вернутся при следующей проверке'); S.info = await call('app:info'); return; }
  e = t.closest('.f [data-a]');
  if (e) {
    const card = e.closest('.f'), f = S.threats.findings.find(x => x.id === card.dataset.id), a = e.dataset.a;
    if (!f) return;
    if (a === 'reveal') return void (await call('finding:act', f.id, 'reveal').then(r => { if (!r.ok) toast(r.error); }));
    if (a === 'ignore') return confirmBox('Оставить как есть?', '<p>Я больше не буду показывать эту находку. Вернуть её можно кнопкой «Показать снова» на вкладке «Защита».</p>', 'Да, это моё', () => doAct(card, f, a));
    const w = actWords(f, a); return confirmBox(w.title, w.html, w.yes, () => doAct(card, f, a));
  }
});

// ---------- место на диске ----------
function sumSave(sp) { return ['jpg', 'png', 'video'].filter(k => S.checks[k] && sp.summary[k].count).reduce((s, k) => s + sp.summary[k].saveBytes, 0); }

function tileCheck(k, icon, name, hint) {
  const s = S.space.summary[k], off = !s.count;
  return `<label class="card tile${off ? ' off' : ''}"><input type="checkbox" data-k="${k}"${S.checks[k] && !off ? ' checked' : ''}${off ? ' disabled' : ''}><span class="box"></span><span class="e">${icon}</span><span><b>${name}</b><small>${off ? 'Подходящих файлов не нашёл' : s.count + ' шт. · сейчас ' + fmtBytes(s.bytes) + ' · ' + hint}</small>${off ? '' : `<div class="sz">примерно <em>−${fmtBytes(s.saveBytes)}</em></div>`}</span></label>`;
}

function renderSpace() {
  const b = $('#spaceBody'), sp = S.space;
  if (S.phase === 'compressing') return;
  if (S.phase === 'done' && S.result) return renderSpaceDone(b);
  const roots = sp ? sp.roots : (S.info ? S.info.roots : []);
  const extra = new Set((sp && sp.extra) || []);
  const chips = `<div class="chips">${roots.map(r => `<span class="chip">📁 ${esc(r)}${extra.has(r) ? ` <button data-rmf="${esc(r)}" title="Убрать" type="button">✕</button>` : ''}</span>`).join('')}</div>
   <button class="btn" id="addFolder" type="button">+ Добавить папку…</button>`;
  if (!sp) {
    b.innerHTML = `<div class="stepnum">ГДЕ Я БУДУ СМОТРЕТЬ</div>${chips}
    <div class="final"><button class="btn pri go" id="spFind" type="button" style="margin:0">🔎 НАЙТИ, ЧТО МОЖНО ОСВОБОДИТЬ</button></div><div class="step" id="spStep"></div>`;
    return;
  }
  const d = sp.summary;
  b.innerHTML = `<div class="stepnum">ШАГ 1 — Что сделать легче? (делаю копии, оригиналы пока остаются)</div>
   <div class="tiles">${tileCheck('jpg', '🖼️', 'Фотографии', 'на вид останутся такими же')}${tileCheck('png', '📸', 'Картинки и скриншоты', 'почти без разницы на глаз')}${tileCheck('video', '🎞️', 'Видео (от 30 МБ)', 'качество почти не изменится')}</div>
   <div class="stepnum">ШАГ 2 — Убрать лишнее? (по желанию, всё уйдёт в Корзину после вашего «Да»)</div>
   <div class="tiles">
    <div class="card tile rev"><span class="e">👯</span><span><b>Одинаковые файлы</b><small>${d.dup.count ? d.dup.count + ' лишних копий в ' + d.dup.groups + ' ' + plural(d.dup.groups, 'группе', 'группах', 'группах') + ' · оставлю по одному' : 'Одинаковых файлов не нашёл'}</small>${d.dup.count ? `<div class="sz">можно освободить <em>${fmtBytes(d.dup.saveBytes)}</em></div><button class="btn" data-rev="dup" type="button">Посмотреть и выбрать</button>` : ''}</span></div>
    <div class="card tile rev"><span class="e">📦</span><span><b>Старые установщики программ</b><small>${d.installer.count ? d.installer.count + ' шт. в «Загрузках» и на «Рабочем столе», старше месяца' : 'Старых установщиков не нашёл'}</small>${d.installer.count ? `<div class="sz">можно освободить <em>${fmtBytes(d.installer.saveBytes)}</em></div><button class="btn" data-rev="installer" type="button">Посмотреть и выбрать</button>` : ''}</span></div>
   </div>
   <div class="stepnum">ГДЕ Я СМОТРЕЛ (просмотрено файлов: ${sp.visited})</div>${chips}
   <div class="final"><button class="btn pri go" id="squeeze" type="button" style="margin:0">▶ СЖАТЬ</button><span class="mono" id="tot"></span><button class="btn" id="spFind" type="button">Найти заново</button></div>`;
  updateTotal();
}
function updateTotal() { const t = $('#tot'); if (!t || !S.space) return; const s = sumSave(S.space); t.innerHTML = s ? `освободится примерно <span class="glow">${fmtBytes(s)}</span>` : ''; const q = $('#squeeze'); if (q) q.disabled = !s; }

async function spaceFind() {
  if (S.busy || S.scanning) return;
  S.busy = true; S.result = null; S.phase = 'idle';
  $('#spaceBody').innerHTML = `<div class="card work"><b>Ищу, что можно освободить…</b><div class="step" id="spStep">Начинаю…</div><div class="prog on"><i style="width:50%"></i></div></div>`;
  const r = await call('space:scan'); S.busy = false;
  if (!r.ok) { S.space = null; renderSpace(); return info('Не получилось', `<p class="err">${esc(r.error)}</p>`); }
  S.space = r.space; S.phase = 'ready'; renderSpace(); renderOverview();
}

async function review(cat) {
  const r = await call('space:review', cat);
  if (!r.ok) return info('Не получилось', `<p class="err">${esc(r.error)}</p>`);
  const sizes = new Map();
  let html;
  if (cat === 'dup') {
    html = r.groups.map(g => { sizes.set(g.keep.id, 0); g.extras.forEach(x => sizes.set(x.id, x.size));
      return `<div class="rev-g"><div class="h">ОДИНАКОВЫЕ ФАЙЛЫ · ${fmtBytes(g.keep.size)}</div><div class="rv keep">✓ <span>Оставлю: ${esc(g.keep.dir + '\\' + g.keep.name)}</span></div>${g.extras.map(x => `<label class="rv"><input type="checkbox" data-id="${esc(x.id)}" checked><span>${esc(x.name)}<small>${esc(x.dir)}</small></span></label>`).join('')}</div>`; }).join('');
  } else {
    html = r.files.map(x => { sizes.set(x.id, x.size); return `<label class="rv"><input type="checkbox" data-id="${esc(x.id)}" checked><span>${esc(x.name)} · ${fmtBytes(x.size)}<small>${esc(x.dir)} · скачан ${new Date(x.mtime).toLocaleDateString('ru-RU')}</small></span></label>`; }).join('');
  }
  const m = modal({
    wide: true, title: cat === 'dup' ? 'Одинаковые файлы' : 'Старые установщики',
    html: `<p>${cat === 'dup' ? 'Из каждой группы один файл остаётся на месте, лишние можно отправить в Корзину.' : 'Это установочные файлы, скачанные больше месяца назад. Если какой-то ещё нужен — снимите галочку.'} Снимите галочки с того, что хотите сохранить.</p><div class="rev-list">${html}</div><p class="note" id="revSum"></p>`,
    buttons: [{ t: 'Отмена' }, { t: 'Отправить в Корзину', k: 'btn red', keep: true, f: async btn => {
      const ids = $$('#modal .rev-list input:checked').map(i => i.dataset.id);
      if (!ids.length) return;
      btn.disabled = true; btn.textContent = 'Работаю…';
      const res = await call('space:trash', ids);
      closeModal();
      if (!res.ok) return info('Не получилось', `<p class="err">${esc(res.error)}</p>`);
      info('Готово', `<p>В Корзину отправлено: ${res.count} шт., освободилось ${fmtBytes(res.bytes)}.</p><p class="note">Передумали — откройте Корзину Windows и нажмите «Восстановить».</p>` + (res.problems.length ? `<p class="err">Не всё получилось:</p><div class="logbox">${res.problems.map(esc).join('\n')}</div>` : ''));
      S.space = null; S.phase = 'idle'; spaceFind();
    } }]
  });
  const upd = () => { const ch = $$('#modal .rev-list input:checked'); const b = ch.reduce((s, i) => s + (sizes.get(i.dataset.id) || 0), 0); $('#revSum').textContent = `Выбрано: ${ch.length} шт. · освободится ${fmtBytes(b)}`; };
  m.addEventListener('change', upd); upd();
}

async function squeeze() {
  const kinds = ['jpg', 'png', 'video'].filter(k => S.checks[k] && S.space.summary[k].count);
  if (!kinds.length) return toast('Отметьте хотя бы один пункт');
  confirmBox('Сжать выбранное?', `<p>Сделаю <b>сжатые копии</b> в папке <code>${esc(S.space.outRoot)}</code>. Оригиналы <b>не трогаю</b>. Когда закончу, покажу результат и спрошу, можно ли заменить оригиналы копиями.</p><p class="note">Видео сжимается дольше всего: это может занять от нескольких минут до часа — компьютером можно пользоваться, но он будет заметно загружен.</p>`, 'Начать', async () => {
    S.busy = true; S.phase = 'compressing';
    $('#spaceBody').innerHTML = `<div class="card work"><b id="cwTitle">Сжимаю…</b><div class="nm" id="cwName"></div><div class="prog on"><i id="cwBar" style="width:0"></i></div><div class="step" id="cwStep"></div><div class="acts"><button class="btn" id="cwStop" type="button">Остановить</button></div></div>`;
    const r = await call('space:compress', kinds); S.busy = false;
    if (!r.ok) { S.phase = 'ready'; renderSpace(); return info('Не получилось', `<p class="err">${esc(r.error)}</p>`); }
    S.result = r; S.phase = 'done'; renderSpaceDone($('#spaceBody'));
  });
}

function renderSpaceDone(b) {
  const r = S.result, saved = r.before - r.after;
  b.innerHTML = `<div class="card work"><b class="glow" style="font-size:20px">${r.cancelled ? 'Остановлено' : 'Готово!'}</b>
   <p>${r.done ? `Сжато файлов: <b>${r.done}</b>. Копии легче оригиналов на <b class="glow">${fmtBytes(saved)}</b> (было ${fmtBytes(r.before)}, стало ${fmtBytes(r.after)}).` : 'Подходящих для сжатия файлов не нашлось.'}${r.skipped ? ` Ещё ${r.skipped} уже хорошо сжаты — их оставил как есть.` : ''}</p>
   ${S.replaced ? `<p>Оригиналов заменено копиями: <b>${S.replaced.count}</b>, освободилось <b class="glow">${fmtBytes(S.replaced.saved)}</b>. Старые файлы лежат в Корзине.</p>` : ''}
   ${r.failed.length ? `<details><summary>Не получилось: ${r.failed.length}</summary><div class="logbox">${r.failed.map(f => esc(f.name + ' — ' + f.note)).join('\n')}</div></details>` : ''}
   <div class="acts">${r.done && !S.replaced ? `<button class="btn pri" id="doReplace" type="button">Заменить оригиналы копиями</button>` : ''}<button class="btn" id="openOut" type="button">Открыть папку с копиями</button><button class="btn" id="spAgain" type="button">Готово</button></div>
   ${r.done && !S.replaced ? `<p class="note">Пока вы не нажали «Заменить», оригиналы лежат на своих местах. После замены оригиналы уйдут в Корзину Windows — оттуда их можно вернуть.</p>` : ''}</div>`;
}

document.addEventListener('change', ev => {
  const c = ev.target.closest('input[data-k]'); if (c) { S.checks[c.dataset.k] = c.checked; updateTotal(); }
});
document.addEventListener('click', async ev => {
  const t = ev.target; let e;
  if ((e = t.closest('#spFind'))) return spaceFind();
  if ((e = t.closest('#squeeze'))) return squeeze();
  if ((e = t.closest('[data-rev]'))) return review(e.dataset.rev);
  if ((e = t.closest('#addFolder'))) { const r = await call('space:addFolder'); if (!r.ok) return info('Сюда нельзя', `<p>${esc(r.error)}</p>`); if (r.added) { toast('Папка добавлена'); S.info = await call('app:info'); if (S.space) { S.space.roots = r.roots; spaceFind(); } else renderSpace(); } return; }
  if ((e = t.closest('[data-rmf]'))) { await call('space:removeFolder', e.dataset.rmf); toast('Папка убрана'); S.space = null; S.phase = 'idle'; S.info = await call('app:info'); return renderSpace(); }
  if ((e = t.closest('#cwStop'))) { e.disabled = true; e.textContent = 'Останавливаю…'; return void call('scan:cancel'); }
  if ((e = t.closest('#openOut'))) return void call('space:openOutput');
  if ((e = t.closest('#spAgain'))) { S.result = null; S.replaced = null; S.phase = 'idle'; S.space = null; return renderSpace(); }
  if ((e = t.closest('#doReplace'))) return askReplace();
  if ((e = t.closest('#help'))) return void call('help:open');
  if ((e = t.closest('#scan'))) return startScan();
  if ((e = t.closest('#scanStop'))) { e.disabled = true; return void call('scan:cancel'); }
});

// ---------- «Ещё» ----------
const SOON = [['🩹', 'Старые программы с «дырами»', 'Подскажу, что обновить, чтобы через них не залез вирус.'], ['💾', 'Копия важных файлов', 'Помогу сохранить фото и документы на флешку или другой диск.']];

async function renderMore() {
  const q = await call('quarantine:list'); S.q = q;
  const qrows = Array.isArray(q) && q.length ? q.map(e => `<div class="card q-row"><div class="tx"><b>${esc(e.name)}</b><span>${e.original ? esc(e.original) : 'Отключён запуск при включении Windows'} · ${new Date(e.date).toLocaleDateString('ru-RU')}${e.size ? ' · ' + fmtBytes(e.size) : ''}</span><span>Причина: ${esc(e.reason || '')}</span></div>
     <button class="btn" data-qr="${esc(e.id)}" type="button">Вернуть на место</button>${e.hasFile ? `<button class="link" data-qp="${esc(e.id)}" type="button">Выбросить в Корзину…</button>` : `<button class="link" data-qp="${esc(e.id)}" type="button">Убрать запись</button>`}</div>`).join('')
    : `<div class="card empty"><b>Карантин пуст</b>Сюда попадает всё, что вы разрешили убрать. Ничего не удаляется навсегда.</div>`;
  $('#moreBody').innerHTML = `<div class="stepnum">КАРАНТИН</div>${qrows}
   <div class="stepnum">ИНСТРУМЕНТЫ</div><div class="xs">
    <div class="card x"><span class="e">🔐</span><b>Сейф для паролей</b><p>Запертое хранилище для паролей и важных файлов. Открывается только вашим паролем.</p><button class="btn pri" data-go="vault" type="button">Открыть сейф</button></div>
    <div class="card x"><span class="e">🧩</span><b>Опасные дополнения в браузере</b><p>Найду дополнения, которые следят за вами или показывают лишнюю рекламу.</p><button class="btn pri" data-go="ext" type="button">Проверить</button></div></div>
   <div class="stepnum">ОБНОВЛЕНИЯ</div><div id="updCard"></div>
   <div class="stepnum">ОТЧЁТ ДЛЯ МАСТЕРА</div>
   <div class="card x"><span class="e">📋</span><b>Понятный итог проверки</b><p>Сохраню текстовый файл с находками, который можно распечатать или отправить мастеру.</p><button class="btn" id="saveReport" type="button"${S.threats ? '' : ' disabled'}>Сохранить отчёт</button></div>
   <div class="stepnum">СКОРО</div><div class="xs">${SOON.map(s => `<div class="card x soon"><span class="e">${s[0]}</span><b>${esc(s[1])}</b><p>${esc(s[2])}</p></div>`).join('')}</div>`;
  if (window.updCard) window.updCard();
}

document.addEventListener('click', async ev => {
  const t = ev.target; let e;
  if ((e = t.closest('[data-qr]'))) {
    const r = await call('quarantine:restore', e.dataset.qr);
    if (!r.ok) return info('Не получилось', `<p class="err">${esc(r.error)}</p>`);
    toast(r.restoredTo ? 'Вернул: ' + r.restoredTo : 'Запуск при включении возвращён'); return renderMore();
  }
  if ((e = t.closest('[data-qp]'))) {
    const id = e.dataset.qp;
    return confirmBox('Выбросить из карантина?', '<p>Файл отправится в <b>Корзину Windows</b> — оттуда его ещё можно достать. Из карантина он исчезнет и вернуть его кнопкой уже не получится.</p>', 'Да, в Корзину', async () => {
      const r = await call('quarantine:purge', id); if (!r.ok) return info('Не получилось', `<p class="err">${esc(r.error)}</p>`); renderMore();
    }, 'btn red');
  }
  if ((e = t.closest('#saveReport'))) {
    const r = await call('report:save', buildReport());
    if (r.ok && r.saved) toast('Отчёт сохранён'); else if (!r.ok) info('Не получилось', `<p class="err">${esc(r.error)}</p>`);
  }
});

function buildReport() {
  const t = S.threats, L = [];
  L.push('СТРАЖ ПК — отчёт о проверке', 'Дата: ' + new Date().toLocaleString('ru-RU'), '');
  L.push(`Проверено: автозапуск ${t.stats.startup}, программ ${t.stats.processes}, подключений ${t.stats.connections}, общих папок ${t.stats.shares}, файлов ${t.stats.files}.`, '');
  if (!t.findings.length) L.push('Ничего подозрительного не найдено.');
  t.findings.forEach((f, i) => {
    L.push(`${i + 1}. [${LBL[f.level]}] ${f.title}`, `   Что это: ${f.what}`, `   Чем опасно: ${f.risk}`, `   Совет: ${f.advice}`);
    if (f.path) L.push(`   Где: ${f.path}`);
    (f.reasons || []).forEach(r => L.push(`   - ${r}`)); L.push('');
  });
  return L.join('\n');
}

// ---------- прогресс ----------
window.api.on('progress', p => { $('.prog i').style.width = p.pct + '%'; $('#step').textContent = p.text; const sp = $('#spStep'); if (sp) sp.textContent = p.text; });
window.api.on('space:progress', p => {
  const n = $('#cwName'); if (!n) return;
  $('#cwTitle').textContent = `Сжимаю: файл ${p.index + 1} из ${p.total}`;
  n.textContent = p.name;
  $('#cwBar').style.width = ((p.index + p.percent / 100) / p.total * 100) + '%';
  $('#cwStep').textContent = p.percent ? `Текущий файл: ${Math.round(p.percent)}%` : '';
});

// ---------- старт ----------
(async function init() {
  S.info = await call('app:info');
  document.title = 'Страж ПК ' + S.info.version;
  renderOverview(); renderSecurity(); renderSpace(); refreshSpaceExtras();
  go(location.hash.slice(1) || 'ov');
})();
