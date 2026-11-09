// Общие папки (сетевые). Служебные «административные» ($) не показываем.
const { psJson, asArray } = require('../lib/ps');
const T = require('./texts');

const SCRIPT = `
$o=Get-SmbShare | ? { -not $_.Special -and $_.Name -notmatch '\\$$' -and $_.Path } | % {
  $n=$_.Name; $acc=@(Get-SmbShareAccess -Name $n | % { [pscustomobject]@{who=[string]$_.AccountName;right=[string]$_.AccessRight;type=[string]$_.AccessControlType} })
  [pscustomobject]@{name=$n;path=$_.Path;desc=$_.Description;acc=$acc} }
ConvertTo-Json -Compress -Depth 4 -InputObject @($o)`;

const OPEN_TO_ALL = /(everyone|все$|^все|anonymous|аноним|guests|гост|authenticated users|прошедшие проверку)/i;

async function check(ctx) {
  const shares = asArray(await psJson(SCRIPT, { timeout: 30000 }));
  ctx.stats.shares = shares.length;
  for (const s of shares) {
    const acc = asArray(s.acc);
    const open = acc.filter(a => OPEN_TO_ALL.test(a.who || '') && a.type === 'Allow');
    const canWrite = open.some(a => /Full|Change/i.test(a.right));
    const reasons = [`Сетевое имя: «${s.name}».`];
    if (open.length) reasons.push(`Доступ разрешён для: ${open.map(a => a.who).join(', ')}${canWrite ? ' — в том числе можно менять и добавлять файлы.' : ' (только чтение).'}`);
    else if (acc.length) reasons.push(`Доступ разрешён для: ${acc.map(a => a.who).join(', ')}.`);
    ctx.add({
      kind: 'share', level: canWrite ? 'bad' : 'warn',
      title: `${T.share.title}: «${s.name}»`,
      what: `Папку «${s.name}» (${s.path}) могут открыть другие компьютеры вашей сети.`,
      risk: T.share.risk, advice: T.share.advice, path: s.path, reasons,
      target: { share: s.name, folder: s.path }, actions: ['closeshare', 'reveal']
    });
  }
}
module.exports = { check };
