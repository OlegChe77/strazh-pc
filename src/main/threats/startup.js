// Автозагрузка: ключи Run в реестре, папки «Автозагрузка», задания планировщика (не Microsoft).
const { psJson, asArray } = require('../lib/ps');
const { assess, getSignatures, extractExe } = require('./assess');
const { programFinding } = require('./ctx');
const fs = require('fs');
const names = require('../names');

const SCRIPT = `
$o=@()
$keys=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce','HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')
foreach($k in $keys){ if(Test-Path $k){ $p=Get-ItemProperty $k; foreach($n in $p.PSObject.Properties){ if($n.Name -notmatch '^PS(Path|ParentPath|ChildName|Drive|Provider)$'){ $o+=[pscustomobject]@{src='registry';key=$k;name=$n.Name;value=[string]$n.Value} } } } }
$sh=New-Object -ComObject WScript.Shell
foreach($d in @([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('CommonStartup'))){ if($d -and (Test-Path $d)){ Get-ChildItem -LiteralPath $d -File -Force | ? {$_.Name -ne 'desktop.ini'} | % {
  $v=$_.FullName; if($_.Extension -eq '.lnk'){ $l=$sh.CreateShortcut($_.FullName); $v=('"'+$l.TargetPath+'" '+$l.Arguments) }
  $o+=[pscustomobject]@{src='folder';key=$_.FullName;name=$_.Name;value=$v} } } }
Get-ScheduledTask | ? { $_.TaskPath -notlike '\\Microsoft\\*' -and $_.State -ne 'Disabled' } | % {
  foreach($a in $_.Actions){ if($a.Execute){ $o+=[pscustomobject]@{src='task';key=($_.TaskPath+$_.TaskName);name=$_.TaskName;value=(('"'+$a.Execute+'" '+$a.Arguments))} } } }
ConvertTo-Json -Compress -InputObject @($o)`;

// своё задание «копии раз в неделю» не считаем подозрительным
function isOwnTask(r, own) {
  if (r.src !== 'task' || !names.OWN_TASK_RE.test(r.name || '')) return false;
  const mine = [own && own.exe, process.env.PORTABLE_EXECUTABLE_FILE].filter(Boolean).map(x => x.toLowerCase());
  const dir = own && own.dir ? own.dir.toLowerCase() : null;
  const e = (r.exe || '').toLowerCase();
  return mine.includes(e) || (dir && e.startsWith(dir + '\\'));
}

async function check(ctx, progress, own) {
  const rows = asArray(await psJson(SCRIPT, { timeout: 90000 }));
  ctx.stats.startup = rows.length;
  const items = rows.map(r => {
    const exe = extractExe(r.value);
    return { ...r, exe, args: r.value };
  }).filter(r => !isOwnTask(r, own)).filter(r => r.exe && /\.(exe|bat|cmd|vbs|vbe|js|jse|wsf|ps1|dll|scr|com|msi)$/i.test(r.exe) && fs.existsSync(r.exe));
  // скрипт-оболочки (powershell, cmd, wscript…) проверяем по командной строке
  const sigs = await getSignatures(items.map(i => i.exe));
  for (const it of items) {
    const sig = sigs.get(it.exe.toLowerCase());
    const a = assess({ exe: it.exe, cmd: it.args, sig });
    if (!a) continue;
    ctx.add(programFinding({
      exe: it.exe, cmd: it.args, assessment: a,
      target: { startup: [{ src: it.src, key: it.key, name: it.name, value: it.args }] },
      extraReasons: [`Запускается сама: ${it.src === 'registry' ? 'запись автозагрузки «' + it.name + '»' : it.src === 'folder' ? 'ярлык в папке «Автозагрузка»' : 'задание планировщика «' + it.name + '»'}.`]
    }));
  }
}
module.exports = { check, isOwnTask };
