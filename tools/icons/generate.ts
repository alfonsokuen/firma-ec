import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile('apps/landing/public/icons/favicon.svg');

for (const size of [180, 192, 512] as const) {
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0x0b, g: 0x1a, b: 0x3a, alpha: 1 } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(`apps/landing/public/icons/${name}`);
  console.log(`generated ${name}`);
}
