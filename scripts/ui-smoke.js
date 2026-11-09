// Дымовая проверка окна (только в разработке): STRAZH_SHOTS=<папка> electron .
const fs = require('fs');
const path = require('path');
module.exports = async ({ win, app }) => {
  const dir = process.env.STRAZH_SHOTS; fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const run = js => win.webContents.executeJavaScript(js);
  win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) console.log('[renderer]', msg); });
  if (process.env.STRAZH_SHOT_H) win.setContentSize(1100, +process.env.STRAZH_SHOT_H);
  // вымышленный путь вместо тестовой папки (только для README)
  const fake = process.env.STRAZH_TEST_DIR ? JSON.stringify(process.env.STRAZH_TEST_DIR) : null;
  const scrub = () => fake ? run(`(() => { const d = ${fake}, r = ${JSON.stringify('C:\\Users\\Anna')}, w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.nodeValue.includes(d)) n.nodeValue = n.nodeValue.split(d).join(r); })()`) : null;
  const shot = async n => { await wait(500); await scrub(); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(dir, n + '.png'), (process.env.STRAZH_SHOT_W ? img.resize({ width: +process.env.STRAZH_SHOT_W }) : img.resize({ width: 900 })).toPNG()); };
  await wait(1500);
  await shot('0-start');
  await run("document.querySelector('#scan').click()");
  for (let i = 0; i < 300; i++) { await wait(1000); if (await run("!document.querySelector('#scan').disabled")) break; }
  await shot('1-home');
  for (const id of ['sec', 'space', 'more']) { await run(`document.querySelector('[data-go=${id}]').click()`); await wait(900); await shot('2-' + id); }
  console.log('[smoke] текст «Место»:', (await run("document.querySelector('#spaceBody').innerText")).slice(0, 700));
  console.log('[smoke] текст «Защита»:', (await run("document.querySelector('#secHead').innerText + ' | ' + document.querySelectorAll('#list .f').length")));
  app.quit();
};
