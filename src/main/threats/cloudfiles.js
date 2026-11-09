// Какие файлы «лежат только в облаке» (OneDrive/Яндекс.Диск «файлы по запросу»): их нельзя открывать —
// чтение заставило бы облако скачать файл. Признаки Windows: Offline, RecallOnOpen, RecallOnDataAccess.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runPS, withData, asArray } = require('../lib/ps');

const OFFLINE_MASK = 0x1000 | 0x40000 | 0x400000;

const SCRIPT = `
$list=Get-Content -LiteralPath $data.f -Raw -Encoding UTF8|ConvertFrom-Json
$m=[int]$data.m
$r=foreach($p in @($list)){ try{ $a=[int][IO.File]::GetAttributes($p); if($a -band $m){$p} }catch{} }
ConvertTo-Json -Compress -InputObject @($r)`;

// strict: если узнать не удалось — считаем все файлы облачными (лучше не открыть, чем запустить скачивание).
function makeOfflineFilter({ strict = false } = {}) {
  return async function offlineSet(files) {
    const all = files.map(f => f.toLowerCase());
    if (!files.length) return new Set();
    const tmp = path.join(os.tmpdir(), 'strazh-' + crypto.randomBytes(6).toString('hex') + '.json');
    try {
      fs.writeFileSync(tmp, JSON.stringify(files), 'utf8');
      const out = (await runPS(withData({ f: tmp, m: OFFLINE_MASK }, SCRIPT), { timeout: 120000 })).trim();
      return new Set(asArray(JSON.parse(out || '[]')).map(p => String(p).toLowerCase()));
    } catch {
      return strict ? new Set(all) : new Set();
    } finally { try { fs.rmSync(tmp, { force: true }); } catch { /* не страшно */ } }
  };
}

module.exports = { makeOfflineFilter, offlineSet: makeOfflineFilter(), OFFLINE_MASK };
