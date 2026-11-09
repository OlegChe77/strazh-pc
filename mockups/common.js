// Общие демо-данные и поведение макетов. Ничего реально не сканируется и не удаляется.
const F=[
{c:'hi',i:'⛏️',t:'Похоже на майнер криптовалют',p:'C:\\Users\\user\\AppData\\Roaming\\svchost32.exe',
 w:'Программа выдаёт себя за системный процесс svchost, но лежит не там, где живёт настоящий. Постоянно грузит процессор на 90% и связывается с пулом майнинга.',
 r:'Компьютер тормозит и греется, растёт счёт за электричество, быстрее изнашиваются процессор и видеокарта. Майнеры часто приходят вместе с другим вредоносным кодом.',
 s:'Остановить процесс и перенести файл в карантин. Файл не удаляется, его можно вернуть.'},
{c:'hi',i:'🐴',t:'Подозрение на троян удалённого доступа',p:'C:\\ProgramData\\Updater\\winupd.dll',
 w:'Библиотека без цифровой подписи. Запускается при входе в Windows и открывает соединение с неизвестным сервером.',
 r:'Посторонний может видеть ваш экран, красть пароли и файлы, включать камеру и микрофон.',
 s:'Отключить из автозагрузки, поместить в карантин и показать, какие данные могли уйти.'},
{c:'mid',i:'📂',t:'Папка открыта для всех в сети',p:'D:\\Общая — доступ «Все: чтение и запись»',
 w:'Любой, кто подключён к вашему Wi-Fi или сети, может открыть эту папку, а при записи — подложить туда вирус.',
 r:'Утечка содержимого папки, подмена файлов, заражение через общую папку.',
 s:'Закрыть общий доступ или оставить только нужным пользователям. Файлы внутри не трогаем.'},
{c:'mid',i:'🔑',t:'Пароли лежат в обычном текстовом файле',p:'C:\\Users\\user\\Documents\\пароли.txt',
 w:'Файл содержит слова «пароль», «логин» и похожие на данные для входа строки. Любая программа, а значит и любой троян, может его прочитать.',
 r:'Кража аккаунтов: почты, банков, соцсетей.',
 s:'Перенести в зашифрованный сейф программы или менеджер паролей. Исходный файл удалим только после вашего «Да».'},
{c:'low',i:'🖥️',t:'Включён удалённый рабочий стол (RDP)',p:'Параметр Windows',
 w:'К компьютеру можно подключиться по сети, если знать пароль.',
 r:'Если пароль слабый, возможен взлом подбором.',
 s:'Если вы этим не пользуетесь, подскажем, как отключить. Сами настройки системы не меняем.'},
{c:'low',i:'🌐',t:'В браузере сохранены пароли и карты',p:'Chrome: 14 паролей, 2 банковские карты',
 w:'Браузер хранит их в профиле. Специальные вирусы-«стилеры» умеют забирать эти данные.',
 r:'Утечка логинов и платёжных данных.',
 s:'Показать список и предложить хранить важное в менеджере паролей.'}];
const SEV={hi:'Высокий риск',mid:'Средний риск',low:'Низкий риск'};
const P=[
{i:'🖼️',n:'Фотографии',c:'1 240 файлов',a:8.4,b:3.1,h:'Пережать в WebP / JPEG 85% — разницы на глаз почти нет'},
{i:'🎞️',n:'Видео',c:'86 файлов',a:42,b:19,h:'Перекодировать в H.265 (HEVC) с тем же качеством'},
{i:'📸',n:'Скриншоты и картинки из мессенджеров',c:'2 310 файлов',a:3.2,b:1.1,h:'Сжать PNG без потерь, мелкие дубли убрать'},
{i:'📄',n:'PDF и документы',c:'540 файлов',a:2.6,b:1.4,h:'Оптимизировать PDF, сжать вложенные сканы'},
{i:'👯',n:'Одинаковые файлы (дубликаты)',c:'312 копий',a:5.7,b:0,h:'Оставить по одному экземпляру, остальные — в корзину по вашему «Да»'},
{i:'📦',n:'Старые установщики и архивы',c:'64 файла',a:11.8,b:0,h:'Установщики программ, которые уже стоят'}];
const X=[
{i:'🚀',t:'Автозагрузка',d:'Что запускается вместе с Windows и тормозит включение.'},
{i:'🌐',t:'Сеть и открытые порты',d:'Кто подключён к вам и какие «двери» открыты наружу.'},
{i:'🧩',t:'Расширения браузера',d:'Лишние и опасные дополнения, следящие за вами.'},
{i:'🩹',t:'Устаревшие программы',d:'Версии с известными дырами и где взять обновление.'},
{i:'📈',t:'Кто грузит компьютер',d:'Процессы, которые едят процессор, память и диск.'},
{i:'🔒',t:'Личный сейф',d:'Зашифрованная папка для паролей и документов.'},
{i:'💾',t:'Резервные копии',d:'Напомнит и поможет сохранить важное на другой диск.'},
{i:'📋',t:'Отчёт о проверке',d:'Понятный итог в PDF, который можно показать мастеру.'}];
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const fm=n=>n.toFixed(1).replace('.',',');
function modal(h,b,btns){let m=$('.modal');if(!m){m=document.createElement('div');m.className='modal';document.body.append(m)}
 m.innerHTML=`<div class="box"><h3>${h}</h3><p>${b}</p><div class="acts"></div></div>`;
 btns.forEach(x=>{const e=document.createElement('button');e.className='btn '+(x.k||'');e.textContent=x.t;e.onclick=()=>{m.classList.remove('on');x.f&&x.f()};$('.acts',m).append(e)});
 m.classList.add('on')}
function toast(t){const e=document.createElement('div');e.className='toast';e.textContent=t;document.body.append(e);setTimeout(()=>e.remove(),2800)}
function go(id){$$('.page').forEach(p=>p.classList.toggle('on',p.id===id));$$('.nv').forEach(b=>b.classList.toggle('on',b.dataset.go===id));scrollTo(0,0)}
function total(){let a=0,b=0;$$('.pack input').forEach((c,i)=>{if(c.checked){a+=P[i].a;b+=P[i].b}});
 $$('[data-render=total]').forEach(e=>e.innerHTML=`Освободится примерно <b>${fm(a-b)} ГБ</b> из ${fm(a)} ГБ`)}
function render(){
 $$('[data-render=findings]').forEach(e=>e.innerHTML=F.map(f=>`<div class="f ${f.c}"><div class="top"><span class="ico">${f.i}</span><div class="tt"><b>${f.t}</b><small>${f.p}</small></div><span class="sev">${SEV[f.c]}</span></div><div class="more"><h4>Что это за файл</h4><p>${f.w}</p><h4>Чем это грозит</h4><p>${f.r}</p><h4>Что предлагаем</h4><p>${f.s}</p><div class="acts"><button class="btn" data-a="keep">Оставить, это моё</button><button class="btn pri" data-a="quar">В карантин</button><button class="btn bad" data-a="del">Удалить…</button></div></div></div>`).join(''));
 $$('[data-render=packs]').forEach(e=>e.innerHTML=P.map(p=>`<label class="pack"><input type="checkbox" checked><span class="ico">${p.i}</span><div class="tt"><b>${p.n}</b> <span class="muted">· ${p.c}</span><div class="bar"><i style="width:${p.a?Math.round(p.b/p.a*100):0}%"></i></div><small class="muted">${p.h}</small></div><div class="sz">${fm(p.a)} → ${fm(p.b)} ГБ<br><b>−${fm(p.a-p.b)} ГБ</b></div></label>`).join(''));
 $$('[data-render=extras]').forEach(e=>e.innerHTML=X.map(x=>`<div class="card x"><div class="ico">${x.i}</div><b>${x.t}</b><p class="muted">${x.d}</p><button class="btn">Открыть</button></div>`).join(''));
 $$('[data-render=guard]').forEach(e=>e.innerHTML='<div class="guard">🛡️ <span>Системные папки (Windows, Program Files и т.п.) при уборке и сжатии <b>не открываются вообще</b>. Ничего не удаляется без вашего «Да».</span></div>');
 $$('[data-render=mode]').forEach(e=>e.innerHTML='<div class="seg"><button class="on" data-m="ask">Спрашивать каждый раз</button><button data-m="auto">Готовить по расписанию</button></div><p class="muted modehint">Покажу, что именно сожму, и жду вашего «Да».</p>');
 total()}
document.addEventListener('click',ev=>{const t=ev.target;
 let e=t.closest('[data-go]');if(e)return go(e.dataset.go);
 e=t.closest('.f .top');if(e)return e.parentElement.classList.toggle('open');
 e=t.closest('[data-a]');if(e){const f=e.closest('.f'),n=$('b',f).textContent,a=e.dataset.a;
  if(a==='keep')return toast('Добавлено в исключения — больше не покажу');
  if(a==='quar')return modal('Перенести в карантин?',`«${n}» будет изолирован: запустить его станет нельзя, но файл останется целым, и его можно вернуть.`,[{t:'Отмена'},{t:'Да, в карантин',k:'pri',f:()=>toast('Демо: ничего не изменено')}]);
  return modal('Удалить насовсем?',`Вы просили удалить: «${n}». Программа сама ничего не удаляет — это ваше решение. Файл отправится в корзину, если он не системный.`,[{t:'Не удалять'},{t:'Да, удалить',k:'bad',f:()=>toast('Демо: ничего не изменено')}])}
 e=t.closest('[data-m]');if(e){$$('[data-m]').forEach(b=>b.classList.toggle('on',b===e));$$('.modehint').forEach(h=>h.textContent=e.dataset.m==='ask'?'Покажу, что именно сожму, и жду вашего «Да».':'Раз в неделю сам найду, что сжать, и подготовлю сжатые копии. Оригиналы не трогаю — их удаление только по вашему подтверждению.');return}
 e=t.closest('[data-compress]');if(e)return modal('Сжать выбранное?','Сначала создам сжатые копии рядом с оригиналами и покажу результат. Оригиналы останутся на месте, пока вы сами не подтвердите их удаление.',[{t:'Отмена'},{t:'Начать',k:'pri',f:()=>toast('Демо: ничего не изменено')}]);
 e=t.closest('[data-scan]');if(e){const w=e.closest('.scanwrap')||document,i=$('.scanbar i',w),x=$('.scantxt',w);if(!i||e.dataset.busy)return;
  const st=['Проверяю автозагрузку…','Ищу майнеры и трояны…','Смотрю открытые папки…','Ищу пароли в открытом виде…','Готово: найдено 6 пунктов, разберём по одному'];let n=0;e.dataset.busy=1;
  const tm=setInterval(()=>{n+=2;i.style.width=n+'%';x.textContent=st[Math.min(4,Math.floor(n/22))];if(n>=100){clearInterval(tm);delete e.dataset.busy}},60)}});
document.addEventListener('change',ev=>{if(ev.target.closest('.pack'))total()});
render();go((location.hash||'#ov').slice(1)||'ov');
