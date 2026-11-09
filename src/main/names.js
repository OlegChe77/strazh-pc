// Все имена программы на диске и в Windows — латиницей (на разных ПК русские пути ломают сторонние программы и скрипты).
// LEGACY — имена прошлых версий: по ним переносим данные, пересоздаём задание и узнаём «своё» в проверках.
const APP = 'StrazhPC';

module.exports = {
  APP,
  DATA_DIR: APP,                                 // %APPDATA%\StrazhPC
  COPIES_DIR: 'StrazhPC Compressed Copies',      // в папке пользователя
  TASK_NAME: 'StrazhPC - weekly copies',         // задание Планировщика
  portRuleName: port => `StrazhPC: port ${port} blocked`,  // правило Брандмауэра
  OWN_TASK_RE: /^(StrazhPC|Страж ПК)/,           // «своё» задание в проверке автозагрузки (новое и старое имя)
  LEGACY: {
    DATA_DIR: 'Страж ПК',
    COPIES_DIR: 'Сжатые копии (Страж ПК)',
    TASK_NAME: 'Страж ПК — копии раз в неделю',
    portRuleName: port => `Страж ПК: закрыт порт ${port}`
  }
};
