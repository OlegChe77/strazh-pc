// Скриншоты для README на вымышленных данных (scripts/demo.js): node scripts/shots.js [папка, по умолчанию docs]
// Ваши файлы и находки в картинки не попадают: личные папки подменяются на .testdata/demo.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const electron = require('electron');
const demo = require('./demo');

const root = path.join(__dirname, '..');
const dir = path.join(root, '.testdata', 'demo');
const out = path.resolve(process.argv[2] || path.join(root, 'docs'));
(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await demo.prepare(dir);
  const env = { ...process.env, STRAZH_TEST_DIR: dir, STRAZH_DEMO: '1', STRAZH_SHOTS: out, STRAZH_SHOT_W: '1100', STRAZH_SHOT_H: '1250' };
  delete env.ELECTRON_RUN_AS_NODE;
  const p = spawn(electron, ['.'], { cwd: root, env, stdio: 'inherit' });
  p.on('exit', c => { console.log('готово, код', c, '→', out); process.exit(c || 0); });
})();
