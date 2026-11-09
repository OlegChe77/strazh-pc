// Подключения к майнинг-пулам: по именам известных пулов, по «майнерским» портам и обратному имени узла.
const dns = require('dns').promises;
const path = require('path');
const { psJson, asArray } = require('../lib/ps');
const { assess, getSignatures, userWritable } = require('./assess');
const { programFinding } = require('./ctx');
const T = require('./texts');

const POOLS = ['pool.supportxmr.com', 'pool.minexmr.com', 'xmr.nanopool.org', 'eth.nanopool.org', 'xmr-eu1.nanopool.org', 'xmr-us-east1.nanopool.org',
  'xmr.2miners.com', 'eth.2miners.com', 'rvn.2miners.com', 'etc.2miners.com', 'pool.hashvault.pro', 'gulf.moneroocean.stream', 'mine.c3pool.com',
  'xmrpool.eu', 'monerohash.com', 'pool.xmr.pt', 'xmr.f2pool.com', 'rx.unmineable.com', 'eu.stratum.slushpool.com', 'stratum.braiins.com',
  'btc.viabtc.com', 'eu1.ethermine.org', 'us1.ethermine.org', 'etc.ethermine.org', 'asia1.ethermine.org', 'xmr.pool.minergate.com', 'pool.minergate.com',
  'ethash.unmineable.com', 'randomxmonero.auto.nicehash.com', 'cryptonight.auto.nicehash.com', 'xmr-eu.dwarfpool.com', 'pool.gntl.co.uk', 'fastpool.xyz'];
const POOL_WORDS = /(pool|xmr|monero|nanopool|2miners|f2pool|ethermine|hashvault|supportxmr|minergate|nicehash|unmineable|c3pool|moneroocean|miningpoolhub|slushpool|stratum)/i;
const MINER_PORTS = new Set([3333, 4444, 5555, 7777, 9999, 14444, 14433, 45560, 45700, 10128, 3357, 6666, 1800]);

const isPrivate = ip => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fe80|fc|fd)/i.test(ip);

const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

async function poolIps() {
  const map = new Map();
  await Promise.all(POOLS.map(async h => {
    const ips = await withTimeout(dns.resolve4(h).catch(() => []), 2500);
    for (const ip of ips || []) map.set(ip, h);
  }));
  return map;
}

async function check(ctx, progress) {
  const conns = asArray(await psJson(`Get-NetTCPConnection -State Established | % { [pscustomobject]@{pid=[int]$_.OwningProcess;ip=[string]$_.RemoteAddress;port=[int]$_.RemotePort} } | ConvertTo-Json -Compress`, { timeout: 30000 }))
    .filter(c => c.ip && !isPrivate(c.ip));
  ctx.stats.connections = conns.length;
  if (!conns.length) return;

  const procs = new Map((ctx.processes || []).map(p => [p.id, p]));
  const pools = await poolIps();
  const hits = new Map(); // pid → { strong: [..], weak: [..] }

  for (const c of conns) {
    const p = procs.get(c.pid);
    if (!p || !p.exe) continue;
    const knownHost = pools.get(c.ip);
    if (knownHost) { (hits.get(c.pid) || hits.set(c.pid, { strong: [], weak: [] }).get(c.pid)).strong.push(`${knownHost}:${c.port}`); continue; }
    if (MINER_PORTS.has(c.port)) {
      const host = (await withTimeout(dns.reverse(c.ip).catch(() => []), 1500) || [])[0] || '';
      const h = hits.get(c.pid) || hits.set(c.pid, { strong: [], weak: [] }).get(c.pid);
      if (POOL_WORDS.test(host)) h.strong.push(`${host}:${c.port}`);
      else h.weak.push(`${host || c.ip}:${c.port}`);
    }
  }

  const exes = [...hits.keys()].map(pid => procs.get(pid).exe);
  const sigs = await getSignatures(exes);
  for (const [pid, h] of hits) {
    const p = procs.get(pid);
    const sig = sigs.get(p.exe.toLowerCase());
    const sus = !(sig && sig.signed) || userWritable(p.exe) || p.cpu >= 25;
    let level = null, reasons = [];
    if (h.strong.length) { level = 'bad'; reasons.push(`Соединена с сервером майнинг-пула: ${[...new Set(h.strong)].slice(0, 3).join(', ')}.`); }
    else if (h.weak.length && sus) { level = 'warn'; reasons.push(`Подключена к узлу на порту, который любят майнеры: ${[...new Set(h.weak)].slice(0, 3).join(', ')}.`); }
    if (!level) continue;
    const a = assess({ exe: p.exe, cmd: p.cmd || '', sig, cpu: p.cpu }) || { level, reasons: [] };
    a.level = level === 'bad' ? 'bad' : (a.level === 'bad' ? 'bad' : level);
    const f = programFinding({ exe: p.exe, cmd: p.cmd || '', assessment: { level: a.level, reasons: [...reasons, ...a.reasons] }, cpu: p.cpu, running: true, target: { pids: [pid] } });
    if (level === 'bad') { f.title = `${T.pool.title}: ${path.basename(p.exe)}`; f.what = T.pool.what; f.risk = T.pool.risk; f.advice = T.pool.advice; f.kind = 'pool'; }
    ctx.add(f);
  }
}
module.exports = { check };
