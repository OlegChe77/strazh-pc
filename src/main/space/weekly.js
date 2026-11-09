// Копии «раз в неделю»: задание в Планировщике Windows запускает программу с ключом --weekly.
// Фоновая работа только СОЗДАЁТ сжатые копии. Оригиналы не трогаются — о замене программа спросит, когда вы её откроете.
const fs = require('fs');
const path = require('path');
const { runPS, psJson, withData } = require('../lib/ps');

const names = require('../names');

const TASK_NAME = names.TASK_NAME;
const LEGACY_TASK_NAME = names.LEGACY.TASK_NAME;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const seenKey = it => `${String(it.path).toLowerCase()}|${it.size}|${Math.round(it.mtime)}`;

// ---------- расписание Windows ----------
async function schedule({ exe, args, day, hour, name = TASK_NAME }) {
  const d = DAYS[day]; if (!d) throw new Error('Неизвестный день недели');
  const h = Math.max(0, Math.min(23, hour | 0));
  const out = await runPS(withData({ exe, args, day: d, time: `${String(h).padStart(2, '0')}:00`, name, desc: 'StrazhPC: once a week prepares compressed copies of photos and videos. Originals are not touched.' }, `
    $a=New-ScheduledTaskAction -Execute $data.exe -Argument $data.args
    $t=New-ScheduledTaskTrigger -Weekly -DaysOfWeek $data.day -At ([datetime]$data.time)
    $s=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 10) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $data.name -Action $a -Trigger $t -Settings $s -Description $data.desc -Force | Out-Null
    'ok'`), { quiet: false, timeout: 60000 });
  if (!/ok/.test(out)) throw new Error('Windows не принял расписание');
}

async function unschedule(name = TASK_NAME) {
  await runPS(withData({ name }, `if(Get-ScheduledTask -TaskName $data.name -ErrorAction SilentlyContinue){Unregister-ScheduledTask -TaskName $data.name -Confirm:$false};'ok'`), { quiet: false, timeout: 60000 });
}

async function scheduleInfo(name = TASK_NAME) {
  const r = await psJson(withData({ name }, `
    $t=Get-ScheduledTask -TaskName $data.name -ErrorAction SilentlyContinue
    if(-not $t){ '{"exists":false}' } else {
      $i=Get-ScheduledTaskInfo -TaskName $data.name -ErrorAction SilentlyContinue
      $n=$null; if($i -and $i.NextRunTime -and $i.NextRunTime.Year -gt 2000){ $n=$i.NextRunTime.ToString('o') }
      ConvertTo-Json -Compress -InputObject @{exists=$true;next=$n;state=[string]$t.State} }`), { timeout: 30000 });
  return r || { exists: false };
}

// ---------- перенос задания со старого (русского) имени ----------
// DaysOfWeek в Планировщике — битовая маска: воскресенье=1, понедельник=2, вторник=4 … суббота=64.
function parseLegacyTrigger({ days, start } = {}, fallback = {}) {
  const mask = Number(days) | 0;
  let day = fallback.day, hour = fallback.hour;
  for (let i = 0; i < 7; i++) if (mask & (1 << i)) { day = i; break; }
  const m = /T(\d{2}):/.exec(String(start || ''));
  if (m && +m[1] <= 23) hour = +m[1];
  return { day: Number.isInteger(day) ? day : 0, hour: Number.isInteger(hour) ? hour : 12 };
}

async function legacyTaskInfo(name = LEGACY_TASK_NAME) {
  const r = await psJson(withData({ name }, `
    $t=Get-ScheduledTask -TaskName $data.name -ErrorAction SilentlyContinue
    if(-not $t){ '{"exists":false}' } else {
      $tr=@($t.Triggers)[0]
      ConvertTo-Json -Compress -InputObject @{exists=$true;days=[int]$tr.DaysOfWeek;start=[string]$tr.StartBoundary} }`), { timeout: 30000 });
  return r || { exists: false };
}

// Есть старое задание → создаём такое же под новым именем (на текущую программу) и удаляем старое.
async function migrateTask({ exe, args, fallback = {}, oldName = LEGACY_TASK_NAME, newName = TASK_NAME }) {
  const old = await legacyTaskInfo(oldName);
  if (!old.exists) return { status: 'none' };
  const { day, hour } = parseLegacyTrigger(old, fallback);
  await schedule({ exe, args, day, hour, name: newName });
  if (!(await scheduleInfo(newName)).exists) throw new Error('Новое задание не создалось — старое оставляю');
  await unschedule(oldName);
  return { status: 'migrated', day, hour };
}

// ---------- что уже обработано и что ждёт решения ----------
function createLedger(dir) {
  const seenFile = path.join(dir, 'weekly-seen.json'), pendFile = path.join(dir, 'pending-copies.json');
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const write = (f, v) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };
  let seen = read(seenFile, {}), pend = read(pendFile, []);
  return {
    isSeen: it => !!seen[seenKey(it)],
    markSeen(it) { seen[seenKey(it)] = 1; },
    flushSeen() { write(seenFile, seen); },
    // копии, которые ждут решения «заменить оригинал?»
    addPending(r) { pend = pend.filter(x => x.original !== r.original); pend.push({ original: r.original, copy: r.copy, before: r.before, after: r.after, at: new Date().toISOString() }); write(pendFile, pend); },
    removePending(original) { pend = pend.filter(x => x.original !== original); write(pendFile, pend); },
    // только те, у кого и оригинал, и копия ещё на месте
    pending() {
      const live = pend.filter(x => fs.existsSync(x.copy) && fs.existsSync(x.original));
      if (live.length !== pend.length) { pend = live; write(pendFile, pend); }
      return pend.map(x => ({ ...x }));
    }
  };
}

module.exports = { schedule, unschedule, scheduleInfo, createLedger, seenKey, migrateTask, legacyTaskInfo, parseLegacyTrigger, TASK_NAME, LEGACY_TASK_NAME, DAYS };
