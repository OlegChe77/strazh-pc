// Запуск PowerShell: скрипт передаётся в Base64 (без проблем с кавычками и кириллицей).
const { execFile } = require('child_process');

const PRE = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference='SilentlyContinue';";

function runPS(script, { timeout = 60000, quiet = true } = {}) {
  const full = PRE + (quiet ? "$ErrorActionPreference='SilentlyContinue';" : "$ErrorActionPreference='Stop';") + script;
  const enc = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { windowsHide: true, timeout, maxBuffer: 128 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error((stderr || err.message || '').toString().trim()));
        resolve(stdout.toString());
      });
  });
}

// Данные в скрипт — только через Base64-JSON: в скрипте доступен готовый объект $data.
function withData(data, script) {
  const b64 = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
  return `$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))|ConvertFrom-Json;` + script;
}

async function psJson(script, opts) {
  const out = (await runPS(script, opts)).trim();
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}

const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

module.exports = { runPS, psJson, withData, asArray };
