// Маленькое хранилище настроек в JSON (в папке данных программы).
const fs = require('fs');
const path = require('path');

function create(dir) {
  const file = path.join(dir, 'settings.json');
  let data = { ignored: [], lastScan: null, closedShares: [], extraRoots: [] };
  try { data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* первый запуск */ }
  const save = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(file + '.tmp', file);
  };
  return { get: k => data[k], set: (k, v) => { data[k] = v; save(); } };
}
module.exports = { create };
