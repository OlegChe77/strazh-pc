// Вымышленные данные для скриншотов в README (только при разработке: STRAZH_DEMO=1 и STRAZH_TEST_DIR).
// Настоящие находки, пути и файлы вашего ПК в публичные картинки не попадают.
const fs = require('fs');
const path = require('path');

const findings = [
  { level: 'bad', kind: 'process', title: 'Программа «sysupdate-helper» грузит процессор на 94% и ходит на адрес майнинга',
    what: 'Это маленькая программа, которая запустилась сама и целыми днями считает чужие криптомонеты на вашем компьютере. Лежит во временной папке, подписи разработчика у неё нет.',
    risk: 'Компьютер тормозит и греется, быстрее изнашивается, растёт счёт за электричество. Деньги от «добычи» получает чужой человек.',
    advice: 'Обезвредить: остановлю программу, отключу её запуск при включении Windows и уберу файл в карантин. Ничего не удаляется, вернуть можно в любой момент.',
    path: 'C:\Users\Anna\AppData\Local\Temp\svc_cache\sysupdate-helper.exe',
    reasons: ['Лежит во временной папке, а не в «Program Files»', 'Нет цифровой подписи разработчика', 'Соединение с адресом пула майнинга (порт 3333)', 'Процессор занят на 94% уже 40 минут'],
    actions: ['neutralize', 'reveal'] },
  { level: 'warn', kind: 'share', title: 'Папка «Семейные фото» открыта для всех в вашей сети',
    what: 'Эту папку по сети может открыть любой компьютер или телефон, подключённый к вашему Wi-Fi: пароль для входа не нужен.',
    risk: 'Если к сети подключится гость, сосед или заражённая техника, они смогут посмотреть и скопировать ваши фото.',
    advice: 'Если вы сами не открывали эту папку для семьи, закройте общий доступ. Сами фото останутся на месте.',
    path: 'D:\Семейные фото',
    reasons: ['Общий доступ включён для группы «Все»', 'Пароль для входа не требуется'],
    actions: ['closeshare', 'reveal'] },
  { level: 'warn', kind: 'secret', title: 'На рабочем столе лежит файл с паролями',
    what: 'В текстовом файле «пароли.txt» найдены строки вида «логин: … пароль: …» для почты и банка.',
    risk: 'Любая вредная программа или человек, севший за ваш компьютер, прочитает его за секунду.',
    advice: 'Перенесите пароли в защищённое место: «Ещё → Сейф для паролей». Могу убрать файл в защищённую папку, ничего не удаляется.',
    path: 'C:\Users\Anna\Desktop\пароли.txt',
    reasons: ['В имени файла слово «пароли»', 'Внутри 6 строк с логинами и паролями'],
    actions: ['quarantine', 'reveal'] },
  { level: 'ok', kind: 'cloud', title: 'Облачная папка Яндекс.Диска: паролей внутри не нашёл',
    what: 'Это папка, которая сама копируется в интернет. Я посмотрел её содержимое: личных данных и паролей на виду нет.',
    risk: 'Пока в папке нет ничего секретного, опасаться нечего. Следите, чтобы туда не попадали сканы документов без пароля.',
    advice: 'Ничего делать не нужно.',
    path: 'C:\Users\Anna\Yandex.Disk',
    reasons: ['Проверено файлов: 214', 'Паролей и ключей не найдено'],
    actions: ['reveal'] }
];
const stats = { startup: 18, processes: 142, connections: 37, shares: 2, ports: 3, files: 1842 };

function prepare(dir) {
  const sharp = require('sharp');
  for (const d of ['pictures', 'videos', 'documents', 'desktop', 'downloads', 'music', 'data']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const mk = async (rel, w, h, q, seed, mtime) => {
    const raw = Buffer.alloc(w * h * 3); for (let i = 0; i < raw.length; i++) raw[i] = ((i * 7 + seed * 31 + (i >> 5) * 13) & 255) ^ (((i * 2654435761) >>> 24) & 31);
    const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true });
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: q }).toFile(f);
    if (mtime) fs.utimesSync(f, mtime, mtime);
  };
  return (async () => {
    const d = y => new Date(y, 6, 14);
    await mk('pictures/Отпуск/IMG_20230714_102301.jpg', 3000, 2000, 95, 1, d(2023));
    await mk('pictures/Отпуск/IMG_20230714_102355.jpg', 3000, 2000, 95, 2, d(2023));
    await mk('pictures/Отпуск/IMG_20230715_181200.jpg', 3000, 2000, 95, 3, d(2023));
    await mk('pictures/День рождения/IMG_20240302_193011.jpg', 2800, 1900, 96, 4, d(2024));
    await mk('pictures/Дача/IMG_20220521_120000.jpg', 2600, 1700, 94, 5, d(2022));
    fs.copyFileSync(path.join(dir, 'pictures/Отпуск/IMG_20230714_102301.jpg'), path.join(dir, 'downloads', 'IMG_20230714_102301 (1).jpg'));
    const inst = path.join(dir, 'downloads', 'Setup_VideoPlayer_4.2.exe'); fs.writeFileSync(inst, Buffer.alloc(48 * 1024 * 1024, 7));
    const old = new Date(Date.now() - 200 * 864e5); fs.utimesSync(inst, old, old);
  })();
}
module.exports = { findings, stats, prepare };
