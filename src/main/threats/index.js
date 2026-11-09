// Проверка на угрозы: по очереди запускает проверки, ошибки одной не ломают остальные.
const { createCtx } = require('./ctx');
const startup = require('./startup');
const processes = require('./processes');
const network = require('./network');
const shares = require('./shares');
const cloud = require('./cloud');
const ports = require('./ports');
const secrets = require('./secrets');

// Облачные папки — до «паролей на виду»: тогда находка про облако получает своё, более точное объяснение.
const STEPS = [
  { text: 'Смотрю, что запускается при включении…', fn: startup.check, w: 15 },
  { text: 'Ищу скрытые и шпионские программы…', fn: processes.check, w: 20 },
  { text: 'Проверяю подключения к интернету…', fn: network.check, w: 15 },
  { text: 'Проверяю, какие папки видны другим…', fn: shares.check, w: 5 },
  { text: 'Смотрю, какие порты открыты для сети…', fn: ports.check, w: 10 },
  { text: 'Смотрю облачные папки (OneDrive, Яндекс.Диск…)…', fn: cloud.check, w: 15 },
  { text: 'Ищу пароли и личные данные на виду…', fn: secrets.check, w: 20 }
];

// hooks — подмена данных для самопроверки (облачные папки, список портов); в программе не используется.
async function scan({ secretRoots, own, ignored = [], onProgress = () => {}, isCancelled = () => false, hooks = {} }) {
  const ctx = createCtx();
  const errors = [];
  let done = 0;
  for (const s of STEPS) {
    if (isCancelled()) break;
    onProgress({ pct: done, text: s.text });
    try { await s.fn(ctx, onProgress, { roots: secretRoots, ...own, ...hooks }); }
    catch (e) { errors.push(`${s.text} — не получилось: ${e.message}`); }
    done += s.w;
  }
  const ign = new Set(ignored);
  const all = ctx.findings();
  const findings = all.filter(f => !ign.has(f.key));
  return { findings, ignoredCount: all.length - findings.length, stats: ctx.stats, errors };
}
module.exports = { scan };
