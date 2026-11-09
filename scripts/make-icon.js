// Рисует значок программы (щит на чёрном фоне) → build/icon.png и build/icon.ico
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<rect width="256" height="256" rx="48" fill="#050805"/>
<rect x="6" y="6" width="244" height="244" rx="44" fill="none" stroke="#1f4a29" stroke-width="4"/>
<path d="M128 36 L206 64 V124 C206 172 172 204 128 222 C84 204 50 172 50 124 V64 Z" fill="#0b130c" stroke="#39ff7a" stroke-width="10" stroke-linejoin="round"/>
<path d="M90 128 L119 157 L172 98" fill="none" stroke="#39ff7a" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
(async () => {
  const dir = path.join(__dirname, '..', 'build'); fs.mkdirSync(dir, { recursive: true });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync(path.join(dir, 'icon.png'), png);
  // ICO со вложенным PNG 256×256
  const h = Buffer.alloc(22);
  h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
  h[6] = 0; h[7] = 0; h[8] = 0; h[9] = 0; h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12);
  h.writeUInt32LE(png.length, 14); h.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([h, png]));
  console.log('icon ok', png.length);
})();
