// Контекст проверки: копит находки и склеивает находки об одном и том же файле.
const path = require('path');
const T = require('./texts');
const { minerName, mimicsSystem, MINER_CMD } = require('./assess');

const ORDER = { bad: 0, warn: 1, ok: 2 };

function createCtx() {
  const byKey = new Map();
  const stats = { startup: 0, processes: 0, connections: 0, shares: 0, files: 0, cloud: 0, cloudFiles: 0, ports: 0 };

  function add(f) {
    const key = (f.target && f.target.file ? 'file:' + f.target.file.toLowerCase() : f.kind + ':' + (f.target && (f.target.share || f.target.name) || f.path || f.title)).toLowerCase();
    f.key = key;
    const old = byKey.get(key);
    if (!old) { byKey.set(key, f); return f; }
    // склейка: оставляем более серьёзный уровень и собираем причины и действия
    if (ORDER[f.level] < ORDER[old.level]) { old.level = f.level; old.title = f.title; old.what = f.what; old.risk = f.risk; old.advice = f.advice; old.kind = f.kind; }
    old.reasons = [...new Set([...(old.reasons || []), ...(f.reasons || [])])];
    old.target = { ...old.target, ...f.target, startup: [...(old.target.startup || []), ...(f.target.startup || [])] };
    old.actions = [...new Set([...(old.actions || []), ...(f.actions || [])])];
    return old;
  }

  function findings() {
    return [...byKey.values()].sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.title.localeCompare(b.title, 'ru'));
  }
  return { add, findings, stats, has: file => byKey.has('file:' + String(file).toLowerCase()) };
}

// Находка про программу (запуск, процесс, подключение).
function programFinding({ exe, cmd = '', assessment, cpu = 0, running = false, target = {}, extraReasons = [] }) {
  const name = path.basename(exe);
  let t;
  if (minerName(exe) || MINER_CMD.test(cmd)) t = T.miner;
  else if (mimicsSystem(exe) && assessment.level === 'bad') t = T.trojan;
  else if (cpu >= 25) t = T.loaded;
  else t = T.unsigned;
  return {
    kind: 'program', level: assessment.level, title: `${t.title}: ${name}`,
    what: t.what, risk: t.risk, advice: t.advice, path: exe,
    reasons: [...assessment.reasons, ...extraReasons],
    target: { file: exe, ...target },
    actions: assessment.level === 'ok' ? ['reveal'] : ['neutralize', 'reveal']
  };
}

module.exports = { createCtx, programFinding };
