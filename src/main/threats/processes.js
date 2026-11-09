// Работающие программы: нагрузка на процессор (замер ~2,5 секунды), подпись, место, командная строка.
const { psJson, asArray } = require('../lib/ps');
const { assess, getSignatures } = require('./assess');
const { programFinding } = require('./ctx');
const { isSystemPath } = require('../lib/paths');
const path = require('path');

const SCRIPT = `
$n=[Environment]::ProcessorCount
$a=@{}; Get-Process | % { if($_.CPU -ne $null){ $a[$_.Id]=$_.CPU } }
Start-Sleep -Milliseconds 2500
$b=Get-Process
$cmd=@{}; Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | % { $cmd[[int]$_.ProcessId]=[string]$_.CommandLine }
$rows=foreach($p in $b){ $d=0; if($p.CPU -ne $null -and $a.ContainsKey($p.Id)){ $d=[math]::Round((($p.CPU-$a[$p.Id])/2.5/$n)*100,1) }; [pscustomobject]@{id=[int]$p.Id;name=$p.ProcessName;exe=$p.Path;cmd=$cmd[[int]$p.Id];cpu=$d} }
ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)`;

async function check(ctx, progress, own = {}) {
  const r = await psJson(SCRIPT, { timeout: 90000 });
  if (!r) return;
  // Get-Process отдаёт путь только для процессов, к которым есть доступ; остальные (системные) пропускаем
  const procs = asArray(r).filter(p => p.exe).map(p => ({ ...p, exe: path.normalize(p.exe), cpu: p.cpu || 0 }));
  ctx.stats.processes = procs.length;
  ctx.processes = procs;

  const mine = (own.exe || '').toLowerCase();
  const cand = ctx.processes.filter(p => !(isSystemPath(p.exe)) && p.exe.toLowerCase() !== mine && !p.exe.toLowerCase().startsWith((own.dir || '\u0000').toLowerCase()));
  const sigs = await getSignatures(cand.map(p => p.exe));

  // один и тот же файл может быть запущен несколько раз: берём максимальную нагрузку и собираем номера процессов
  const byExe = new Map();
  for (const p of cand) {
    const k = p.exe.toLowerCase();
    const e = byExe.get(k) || { exe: p.exe, cmd: p.cmd || '', cpu: 0, pids: [] };
    e.cpu += p.cpu; e.pids.push(p.id); byExe.set(k, e);
  }
  for (const e of byExe.values()) {
    const sig = sigs.get(e.exe.toLowerCase());
    const a = assess({ exe: e.exe, cmd: e.cmd, sig, cpu: e.cpu });
    if (!a) continue;
    // скромная ошибка замера не повод для тревоги
    ctx.add(programFinding({
      exe: e.exe, cmd: e.cmd, assessment: a, cpu: e.cpu, running: true,
      target: { pids: e.pids },
      extraReasons: [`Сейчас работает (${path.basename(e.exe)}, нагрузка ${Math.round(e.cpu)}%).`]
    }));
  }
}
module.exports = { check };
