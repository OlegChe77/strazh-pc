// Общая оценка «подозрительности» программы: подпись, место, имя, командная строка.
const path = require('path');
const os = require('os');
const { runPS, withData, asArray } = require('../lib/ps');
const { isInside, isSystemPath } = require('../lib/paths');

const SYSTEM_NAMES = ['svchost', 'csrss', 'lsass', 'winlogon', 'services', 'explorer', 'smss', 'wininit', 'taskhost', 'taskhostw',
  'dwm', 'conhost', 'spoolsv', 'runtimebroker', 'searchindexer', 'wuauclt', 'winupd', 'windowsupdate', 'systemupdate', 'sihost', 'ctfmon'];
const MINER_NAMES = ['xmrig', 'xmr-stak', 'minerd', 'cpuminer', 'nbminer', 't-rex', 'trex', 'phoenixminer', 'ethminer', 'lolminer',
  'gminer', 'nicehash', 'claymore', 'bminer', 'teamredminer', 'srbminer', 'cgminer', 'bfgminer', 'wildrig', 'kawpowminer', 'nanominer', 'xmr'];

function userWritable(p) {
  if (!p) return false;
  const e = process.env, home = os.homedir();
  return [e.TEMP, e.TMP, e.ProgramData, e.PUBLIC, path.join(home, 'AppData'), path.join(home, 'Downloads'), path.join(home, 'Desktop'),
    path.join(home, 'Documents'), 'C:\\Users\\Public', 'C:\\Temp', 'C:\\Windows\\Temp'].filter(Boolean).some(r => isInside(p, r));
}

const base = p => path.basename(p || '').toLowerCase().replace(/\.[a-z0-9]+$/, '');

function mimicsSystem(p) {
  const b = base(p);
  if (!b || isSystemPath(p)) return false;
  const stripped = b.replace(/[\d_\-\s]+$/g, '');
  return SYSTEM_NAMES.includes(b) || SYSTEM_NAMES.includes(stripped) ||
    /^(svchost|lsass|csrss|winlogon)/.test(b);
}

function minerName(p) {
  const b = base(p);
  return MINER_NAMES.some(m => b === m || (m.length > 4 && b.includes(m)));
}

function randomName(p) {
  const b = base(p);
  return /^[a-z0-9]{10,}$/.test(b) && (b.match(/\d/g) || []).length >= 3;
}

const BAD_CMD = /(-enc(odedcommand)?\s|-w(indowstyle)?\s+hidden|downloadstring|invoke-expression|\biex\b|frombase64string|mshta\s+https?:|regsvr32.*\/i:https?:|certutil.*-urlcache|bitsadmin.*\/transfer)/i;
const MINER_CMD = /(stratum\+?(tcp|ssl)?:\/\/|--donate-level|--coin[=\s]|\s-o\s+\S*pool|--algo[=\s]|cryptonight|randomx)/i;

// Подписи файлов: Valid = подписан и подпись цела.
async function getSignatures(paths) {
  const uniq = [...new Set(paths.filter(Boolean))];
  const map = new Map();
  if (!uniq.length) return map;
  const out = await runPS(withData(uniq, `$r=foreach($p in @($data)){ if(Test-Path -LiteralPath $p -PathType Leaf){ $s=Get-AuthenticodeSignature -LiteralPath $p; [pscustomobject]@{p=$p;st=[string]$s.Status;sn=$(if($s.SignerCertificate){$s.SignerCertificate.Subject}else{''})} } }; if($r){ConvertTo-Json -Compress -InputObject @($r)}`), { timeout: 180000 });
  let arr = []; try { arr = asArray(JSON.parse(out.trim() || '[]')); } catch { /* пусто */ }
  for (const r of arr) {
    const cn = (/CN="?([^,"]+)/.exec(r.sn || '') || [])[1] || '';
    map.set(r.p.toLowerCase(), { status: r.st, signer: cn, signed: r.st === 'Valid' });
  }
  return map;
}

const microsoft = s => /microsoft|windows/i.test(s || '');

// Возвращает { level, reasons[] } или null, если всё нормально.
function assess({ exe, cmd = '', sig, cpu = 0 }) {
  const reasons = [];
  let level = null;
  const up = (l, why) => { reasons.push(why); if (l === 'bad' || (l === 'warn' && level !== 'bad') || (l === 'ok' && !level)) level = l; };

  if (minerName(exe)) up('bad', 'Название файла совпадает с известной программой для добычи криптовалюты.');
  if (MINER_CMD.test(cmd)) up('bad', 'Запущена с параметрами, которые используют майнеры (подключение к «пулу» добычи).');
  if (BAD_CMD.test(cmd)) up('warn', 'Запускается скрытой командой — так обычно прячут вредный код.');

  const signed = sig && sig.signed;
  const status = sig ? sig.status : 'NotSigned';
  const user = userWritable(exe);
  const mimic = mimicsSystem(exe);

  if (status === 'HashMismatch') up('bad', 'Файл изменили после подписи — подпись больше недействительна.');
  if (mimic && !signed) up('bad', 'Называется как служебный файл Windows, но лежит не там, где положено, и без цифровой подписи.');
  else if (mimic && signed && !microsoft(sig.signer)) up('warn', 'Называется как служебный файл Windows, но подписан не Microsoft и лежит не в папке Windows.');

  if (!signed) {
    if (user) {
      if (cpu >= 25) up('bad', `Без цифровой подписи, лежит в папке пользователя и сильно нагружает компьютер (${Math.round(cpu)}%).`);
      else if (randomName(exe)) up('bad', 'Без цифровой подписи, лежит в папке пользователя и имеет «случайное» имя из букв и цифр.');
      else up('warn', 'Без цифровой подписи и лежит в папке пользователя — оттуда обычно запускаются и вредные программы.');
    } else if (cpu >= 25) up('warn', `Без цифровой подписи и сильно нагружает компьютер (${Math.round(cpu)}%).`);
    else if (!isSystemPath(exe)) up('ok', 'Без цифровой подписи. Это бывает у небольших, но честных программ.');
  } else if (cpu >= 60) up('ok', `Сильно нагружает компьютер (${Math.round(cpu)}%), но это подписанная программа.`);

  return level ? { level, reasons } : null;
}

// Разбор команды автозапуска → путь к файлу
function extractExe(cmd) {
  if (!cmd) return '';
  let s = String(cmd).trim().replace(/%([^%]+)%/g, (m, n) => process.env[n] || m);
  let m = /^"([^"]+)"/.exec(s);
  if (m) return m[1];
  m = /^(.*?\.(exe|bat|cmd|vbs|vbe|js|jse|wsf|ps1|dll|scr|com|lnk|msi))(\s|$)/i.exec(s);
  if (m) return m[1];
  return s.split(/\s+/)[0];
}

module.exports = { assess, getSignatures, extractExe, userWritable, minerName, mimicsSystem, MINER_CMD, BAD_CMD };
