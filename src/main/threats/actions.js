// Действия над находками. Ничего не удаляется: файлы уходят в карантин, автозапуск отключается обратимо.
const fs = require('fs');
const path = require('path');
const { runPS, withData, psJson } = require('../lib/ps');
const { isSystemPath, isInside } = require('../lib/paths');
const names = require('../names');

async function stopProcesses(file, pids) {
  // останавливаем только процессы, чей файл совпадает с найденным (номер мог достаться другой программе)
  const out = await runPS(withData({ file, pids }, `$n=0; Get-Process | ? { $_.Path -and $_.Path -ieq $data.file } | % { Stop-Process -Id $_.Id -Force; $n++ }; $n`), { timeout: 30000 });
  return parseInt(out.trim(), 10) || 0;
}

// Обезвредить: остановить, отключить автозапуск, файл — в карантин.
async function neutralize(finding, q, own) {
  const t = finding.target || {}, file = t.file;
  const log = [], problems = [];
  if (file && own.dir && isInside(file, own.dir)) throw new Error('Это сама программа «Страж ПК» — её я не трогаю.');

  if (file) {
    try { const n = await stopProcesses(file, t.pids || []); if (n) log.push(`Остановлено запущенных копий: ${n}.`); }
    catch (e) { problems.push('Не удалось остановить программу: ' + e.message); }
  }

  const registry = [], tasks = [];
  for (const s of t.startup || []) {
    try {
      if (s.src === 'registry') {
        const out = await runPS(withData(s, `Remove-ItemProperty -Path $data.key -Name $data.name -ErrorAction Stop; 'ok'`), { quiet: false });
        if (/ok/.test(out)) { registry.push({ key: s.key, name: s.name, value: s.value }); log.push(`Убрана запись автозапуска «${s.name}».`); }
      } else if (s.src === 'task') {
        const tp = s.key.slice(0, s.key.length - s.name.length);
        const out = await runPS(withData({ path: tp, name: s.name }, `Disable-ScheduledTask -TaskPath $data.path -TaskName $data.name -ErrorAction Stop|Out-Null; 'ok'`), { quiet: false });
        if (/ok/.test(out)) { tasks.push({ path: tp, name: s.name }); log.push(`Отключено задание планировщика «${s.name}».`); }
      } else if (s.src === 'folder' && fs.existsSync(s.key)) {
        const e = await q.add({ file: s.key, reason: `Ярлык автозапуска: ${finding.title}` });
        log.push(`Ярлык автозапуска «${s.name}» убран в карантин.`); void e;
      }
    } catch (e) {
      const msg = /denied|отказано|администратор/i.test(e.message) ? 'нужны права администратора (запустите программу от имени администратора)' : e.message;
      problems.push(`Автозапуск «${s.name}»: ${msg}`);
    }
  }

  let quarantined = false;
  if (file && fs.existsSync(file)) {
    if (isSystemPath(file)) {
      log.push('Сам файл лежит в системной папке Windows — его я не трогаю, только отключил запуск.');
    } else {
      try {
        await q.add({ file, reason: finding.title, registry, tasks });
        quarantined = true; registry.length = 0; tasks.length = 0;
        log.push('Файл убран в карантин. Его можно вернуть в разделе «Ещё → Карантин».');
      } catch (e) { problems.push('Файл не удалось переместить: ' + e.message); }
    }
  }
  if ((registry.length || tasks.length) && !quarantined) {
    await q.add({ file: null, reason: finding.title, registry, tasks });
  }
  if (!log.length && problems.length) throw new Error(problems.join(' '));
  return { log, problems };
}

// Убрать файл в карантин (пароли, ключи).
async function quarantineOnly(finding, q) {
  const file = finding.target.file;
  if (!file || !fs.existsSync(file)) throw new Error('Файл уже не лежит на прежнем месте.');
  await q.add({ file, reason: finding.title });
  return { log: ['Файл убран в защищённую папку программы. Вернуть можно в разделе «Ещё → Карантин».'], problems: [] };
}

// Закрыть общий доступ: нужны права администратора, Windows сам покажет запрос (UAC). Файлы остаются на месте.
async function closeShare(finding, store) {
  const name = finding.target.share;
  if (!/^[\w .()\-а-яёА-ЯЁ]+$/.test(name)) throw new Error('Необычное имя папки — закройте доступ вручную в свойствах папки.');
  const inner = `Remove-SmbShare -Name '${name.replace(/'/g, "''")}' -Force`;
  const enc = Buffer.from(inner, 'utf16le').toString('base64');
  await runPS(`Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${enc}'`, { timeout: 120000, quiet: false })
    .catch(e => { throw new Error(/отмен|cancel|canceled/i.test(e.message) ? 'Вы отказали в разрешении администратора — доступ остался открытым.' : e.message); });
  const left = await psJson(`@(Get-SmbShare | ? { $_.Name -eq '${name.replace(/'/g, "''")}' }).Count|ConvertTo-Json`, { timeout: 20000 });
  if (left) throw new Error('Доступ не закрылся. Возможно, вы отклонили запрос администратора.');
  const closed = store.get('closedShares') || [];
  closed.push({ name, path: finding.target.folder, date: new Date().toISOString() });
  store.set('closedShares', closed);
  return { log: [`Доступ к «${name}» закрыт. Сами файлы остались на месте (${finding.target.folder}).`], problems: [] };
}

// Закрыть порт: правило Брандмауэра Windows «блокировать входящие» на этот порт. Нужны права администратора
// (Windows покажет запрос UAC). Программа не удаляется и не останавливается; правило можно удалить в Брандмауэре.
const portRuleName = names.portRuleName;
// Правила, созданные прошлыми версиями, продолжают блокировать порт — второе такое же не создаём.
const ruleNamesFor = port => [portRuleName(port), names.LEGACY.portRuleName(port)];

function checkPorts(ports) {
  const list = [...new Set((ports || []).map(Number))];
  if (!list.length || list.length > 20 || list.some(p => !Number.isInteger(p) || p < 1 || p > 65535)) throw new Error('Не удалось понять, какой порт закрывать.');
  return list;
}

function closePortScript(ports) {
  return checkPorts(ports).map(p => {
    const n = portRuleName(p), old = names.LEGACY.portRuleName(p);
    return `if(-not (Get-NetFirewallRule -DisplayName '${n}' -ErrorAction SilentlyContinue) -and -not (Get-NetFirewallRule -DisplayName '${old}' -ErrorAction SilentlyContinue)){ New-NetFirewallRule -DisplayName '${n}' -Description 'Created by StrazhPC at your confirmation. To restore access, delete this rule.' -Direction Inbound -Action Block -Protocol TCP -LocalPort ${p} -Profile Any | Out-Null }`;
  }).join(';');
}

async function closePort(finding, store) {
  const ports = checkPorts(finding.target && finding.target.ports);
  const enc = Buffer.from(closePortScript(ports), 'utf16le').toString('base64');
  await runPS(`Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${enc}'`, { timeout: 120000, quiet: false })
    .catch(e => { throw new Error(/отмен|cancel|canceled/i.test(e.message) ? 'Вы отказали в разрешении администратора — порт остался открытым.' : e.message); });
  const all = ports.flatMap(ruleNamesFor);
  const have = await psJson(withData(all, `@(Get-NetFirewallRule | ? { $data -contains $_.DisplayName } | % { [string]$_.DisplayName })|ConvertTo-Json -Compress`), { timeout: 30000 });
  const got = new Set(Array.isArray(have) ? have : have ? [have] : []);
  const ruleOf = p => ruleNamesFor(p).find(n => got.has(n));
  const missing = ports.filter(p => !ruleOf(p));
  if (missing.length === ports.length) throw new Error('Порт не закрылся. Возможно, вы отклонили запрос администратора.');
  const closed = store.get('closedPorts') || [];
  for (const p of ports) if (ruleOf(p)) closed.push({ port: p, rule: ruleOf(p), date: new Date().toISOString() });
  store.set('closedPorts', closed);
  return {
    log: [`Порт закрыт для входящих подключений: ${ports.filter(ruleOf).join(', ')}. Сама программа не тронута.`,
      `Чтобы открыть обратно: Брандмауэр Windows → Дополнительные параметры → Правила для входящих подключений → удалить правило «${ruleOf(ports.find(ruleOf))}».`],
    problems: missing.map(p => `Порт ${p} закрыть не удалось.`)
  };
}

module.exports = { neutralize, quarantineOnly, closeShare, closePort, closePortScript, portRuleName };
