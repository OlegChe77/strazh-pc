// Открытые порты: какие программы ждут подключений из сети (не только с этого компьютера).
// Только чтение. Закрыть порт можно отдельным действием `closeport` — после подтверждения (см. actions.js).
const path = require('path');
const { psJson, asArray } = require('../lib/ps');
const { assess, getSignatures, userWritable } = require('./assess');
const { isSystemPath, isInside } = require('../lib/paths');
const T = require('./texts');

const SCRIPT = `
$pm=@{}; Get-Process | % { $pm[[int]$_.Id]=$_ }
$l=@(Get-NetTCPConnection -State Listen | ? { $_.LocalAddress -notin @('127.0.0.1','::1') -and $_.LocalAddress -notmatch '^fe80' } | % {
  $p=$pm[[int]$_.OwningProcess]
  [pscustomobject]@{addr=[string]$_.LocalAddress;port=[int]$_.LocalPort;pid=[int]$_.OwningProcess;name=$(if($p){[string]$p.ProcessName}else{''});exe=$(if($p){[string]$p.Path}else{''})} })
$cat=@(Get-NetConnectionProfile | % { [string]$_.NetworkCategory })
$fw=@(Get-NetFirewallProfile | % { [pscustomobject]@{name=[string]$_.Name;on=([string]$_.Enabled -eq 'True')} })
$nla=(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp').UserAuthentication
$deny=(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server').fDenyTSConnections
ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{l=$l;cat=$cat;fw=$fw;nla=$nla;deny=$deny})`;

// Известные службы по номеру порта. base — исходный уровень; signedOk — подписанная программа вне папок пользователя безопаснее.
const SERVICES = [
  { id: 'rdp', ports: [3389], base: 'warn' },
  { id: 'vnc', ports: [5900, 5901, 5902, 5903, 5800], base: 'warn' },
  { id: 'remote', ports: [22, 4899, 5985, 5986, 7070, 5938, 6129, 5650], base: 'warn', signedOk: true },
  { id: 'telnet', ports: [23], base: 'bad' },
  { id: 'ftp', ports: [21, 990], base: 'warn', signedOk: true },
  { id: 'web', ports: [80, 81, 443, 3000, 5000, 5173, 8000, 8008, 8080, 8081, 8088, 8443, 8888, 9000], base: 'warn', signedOk: true },
  { id: 'db', ports: [1433, 3306, 5432, 6379, 9200, 11211, 27017, 5984, 8086], base: 'warn' },
  { id: 'docker', ports: [2375], base: 'bad' }
];
const RANK = { rdp: 8, docker: 7, telnet: 6, vnc: 5, db: 4, ftp: 3, remote: 3, web: 2 };
const LEVEL_ORD = { bad: 0, warn: 1, ok: 2 };
const worse = (a, b) => (LEVEL_ORD[a] <= LEVEL_ORD[b] ? a : b);

// Служебные процессы и порты Windows — их не показываем, пока порт не из списка выше.
const SYSTEM_PROCS = new Set(['system', 'svchost', 'lsass', 'wininit', 'services', 'spoolsv', 'dashost', 'wmpnetwk', 'searchindexer', 'smss', 'csrss']);
// у служб Windows «веб-портами» считаем только настоящие 80/443/8080/8443 (на 5000 и т. п. сидят служебные UPnP-службы)
const WEB_SYS = new Set([80, 443, 8080, 8443]);

// Папка самой Windows (Program Files сюда не входит: установленные программы оцениваем как обычные).
const inWindows = p => !!p && isInside(p, process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows');

const serviceOf = port => SERVICES.find(s => s.ports.includes(port)) || null;

// Активные профили брандмауэра (Domain/Private/Public) и выключен ли какой-то из них.
function firewallState(fw = [], cat = []) {
  const map = c => (/domain/i.test(c) ? 'Domain' : /private/i.test(c) ? 'Private' : /public/i.test(c) ? 'Public' : '');
  const active = new Set(asArray(cat).map(map).filter(Boolean));
  const profiles = asArray(fw);
  const off = profiles.filter(p => !p.on && (!active.size || active.has(p.name))).map(p => p.name);
  return { off };
}

const isAllIfaces = a => a === '0.0.0.0' || a === '::';

// Чистая функция: список слушающих портов + сведения о системе → группы «программа → порты» с уровнем и причинами.
// sigs — Map(путь в нижнем регистре → { signed, status, signer }).
function evaluate(listeners, { fw = [], cat = [], nla = null, deny = null, sigs = new Map() } = {}) {
  const fwState = firewallState(fw, cat);
  const groups = new Map();
  for (const l of asArray(listeners)) {
    if (!l || !l.port) continue;
    const exe = l.exe ? path.normalize(l.exe) : '';
    const name = (l.name || '').toLowerCase();
    const svc = serviceOf(l.port);
    const sysProc = SYSTEM_PROCS.has(name) || inWindows(exe);
    if (sysProc && (!svc || (svc.id === 'web' && !WEB_SYS.has(l.port)))) continue; // обычные порты Windows
    const key = exe ? 'exe:' + exe.toLowerCase() : 'proc:' + (name || 'pid' + l.pid);
    const g = groups.get(key) || { key, exe, name: l.name || '', pids: new Set(), ports: new Map(), system: !!sysProc };
    g.pids.add(l.pid);
    g.ports.set(l.port, (g.ports.get(l.port) || []).concat(l.addr));
    groups.set(key, g);
  }

  const out = [];
  for (const g of groups.values()) {
    const ports = [...g.ports.keys()].sort((a, b) => a - b);
    const svcs = ports.map(serviceOf).filter(Boolean);
    const sig = g.exe ? sigs.get(g.exe.toLowerCase()) : null;
    const signedClean = !!(sig && sig.signed) && !userWritable(g.exe);
    const reasons = [];
    const portText = ports.map(p => {
      const addrs = [...new Set(g.ports.get(p))];
      return `${p} (${addrs.some(isAllIfaces) ? 'для всех сетей' : 'на адресе ' + addrs.join(', ')})`;
    }).join(', ');
    reasons.push(`Ждёт подключений из сети на портах: ${portText}.`);
    reasons.push('Это значит, что к компьютеру можно попытаться подключиться. Попадут ли туда чужие из интернета — зависит от роутера и брандмауэра: если роутер порт «пробрасывает» наружу, то да.');

    let level, kind, noteLevel = null;
    if (svcs.length) {
      const top = svcs.sort((a, b) => (RANK[b.id] || 0) - (RANK[a.id] || 0))[0];
      kind = top.id; level = top.base;
      if (top.signedOk && signedClean) { level = 'ok'; kind = 'known'; reasons.push(`Программа подписана (${sig.signer || 'издатель известен'}) и лежит не в папке пользователя.`); }
      if (top.id === 'rdp') {
        if (nla === 0) { level = 'bad'; reasons.push('Вход по удалённому рабочему столу разрешён без проверки на стороне вашего компьютера (NLA выключен) — это ослабляет защиту.'); }
        if (deny === 1) { reasons.push('В параметрах Windows удалённый доступ выключен, но порт сейчас всё равно слушает.'); }
      }
      if (fwState.off.length && ['rdp', 'vnc', 'db', 'ftp', 'remote', 'web'].includes(top.id) && level !== 'ok') {
        level = 'bad'; noteLevel = 'fw';
        reasons.push(`Брандмауэр Windows выключен (${fwState.off.join(', ')}) — порт ничем не прикрыт.`);
      }
      if (g.system) reasons.push('Порт держит служба Windows.');
    } else if (g.exe) {
      // незнакомый порт у пользовательской программы: оцениваем программу по подписи и месту
      const a = assess({ exe: g.exe, cmd: '', sig, cpu: 0 });
      if (!a || a.level === 'ok') continue; // Steam, мессенджеры, торренты — обычное дело
      level = a.level; kind = 'unknown'; reasons.push(...a.reasons);
    } else {
      continue; // нет пути (нет доступа) и порт не известный — не гадаем
    }
    if (fwState.off.length && noteLevel !== 'fw' && level !== 'ok') reasons.push(`Брандмауэр Windows выключен (${fwState.off.join(', ')}).`);
    out.push({ key: g.key, exe: g.exe, name: g.name, pids: [...g.pids], ports, kind, level, reasons, system: g.system });
  }
  out.sort((a, b) => LEVEL_ORD[a.level] - LEVEL_ORD[b.level] || a.ports[0] - b.ports[0]);
  return out;
}

function toFinding(r) {
  const t = T.ports[r.kind];
  const prog = r.exe ? path.basename(r.exe) : (r.name || 'служба Windows');
  const portTitle = r.ports.slice(0, 3).join(', ') + (r.ports.length > 3 ? '…' : '');
  const title = r.exe && !r.system ? `${t.title}: ${prog} (порт ${portTitle})` : `${t.title} (порт ${portTitle})`;
  const canNeutralize = !!r.exe && !r.system && !isSystemPath(r.exe) && r.level !== 'ok' && (r.kind === 'unknown' || r.level === 'bad' || userWritable(r.exe));
  const f = {
    kind: 'port', level: r.level, title, what: t.what, risk: t.risk, advice: t.advice,
    path: r.exe || '', reasons: r.reasons,
    target: r.exe && !r.system ? { file: r.exe, pids: r.pids, ports: r.ports } : { name: 'port:' + r.ports.join(','), ports: r.ports },
    actions: [...(r.level === 'ok' ? [] : ['closeport']), ...(canNeutralize ? ['neutralize'] : []), ...(r.exe && !r.system ? ['reveal'] : [])]
  };
  if (r.level === 'ok') f.actions = f.actions.filter(a => a !== 'neutralize');
  return f;
}

// Читает с компьютера: кто слушает порты, какие сети активны, включён ли брандмауэр, как настроен RDP.
const read = async () => (await psJson(SCRIPT, { timeout: 30000 })) || {};

async function check(ctx, progress, opts = {}) {
  let data = opts.portsData;
  if (!data) data = await read();
  const listeners = asArray(data.l).filter(l => l && l.port);
  // одна и та же служба слушает порт на нескольких адресах — считаем порт один раз
  ctx.stats.ports = new Set(listeners.map(l => l.port)).size;
  if (!listeners.length) return;
  const exes = [...new Set(listeners.map(l => l.exe).filter(e => e && !inWindows(e)))];
  const sigs = opts.portsData ? (opts.sigs || new Map()) : await getSignatures(exes);
  for (const r of evaluate(listeners, { fw: data.fw, cat: data.cat, nla: data.nla, deny: data.deny, sigs })) ctx.add(toFinding(r));
}

module.exports = { check, read, evaluate, toFinding, serviceOf, firewallState, SERVICES };
