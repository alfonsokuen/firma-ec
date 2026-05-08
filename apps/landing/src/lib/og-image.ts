import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface OgInput {
  title: string;
  eyebrow?: string;
  badge?: string;
}

let _fontCache: ArrayBuffer | null = null;
let _displayCache: ArrayBuffer | null = null;

async function loadFonts(rootDir: string): Promise<{ sans: ArrayBuffer; display: ArrayBuffer }> {
  if (!_fontCache) {
    _fontCache = (await readFile(join(rootDir, 'public/fonts/Geist-Sans-600.ttf'))).buffer as ArrayBuffer;
  }
  if (!_displayCache) {
    _displayCache = (await readFile(join(rootDir, 'public/fonts/Geist-Display-700.ttf'))).buffer as ArrayBuffer;
  }
  return { sans: _fontCache, display: _displayCache };
}

export async function renderOgPng({ title, eyebrow = 'firmar.ec', badge }: OgInput, rootDir: string): Promise<Uint8Array> {
  const { sans, display } = await loadFonts(rootDir);

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: 'linear-gradient(135deg, #0B1A3A 0%, #14254F 100%)',
          color: 'white',
          fontFamily: 'Geist Sans',
        },
        children: [
          { type: 'div', props: { style: { fontSize: 28, opacity: 0.7, fontFamily: 'Geist Sans' }, children: eyebrow } },
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', gap: 24 },
              children: [
                { type: 'div', props: { style: { fontSize: 84, fontWeight: 700, lineHeight: 1.05, fontFamily: 'Geist Display', maxWidth: 1040 }, children: title } },
                ...(badge ? [{ type: 'div', props: { style: { fontSize: 24, padding: '12px 20px', borderRadius: 9999, background: 'rgba(255,255,255,0.12)', alignSelf: 'flex-start', fontFamily: 'Geist Sans' }, children: badge } }] : []),
              ],
            },
          },
          { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between', fontSize: 22, opacity: 0.6 }, children: [
            { type: 'span', props: { children: 'firmar.ec' } },
            { type: 'span', props: { children: 'open source · LOPDP nativa' } },
          ] } },
        ],
      },
    } as any,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Geist Sans', data: sans, weight: 600, style: 'normal' },
        { name: 'Geist Display', data: display, weight: 700, style: 'normal' },
      ],
    },
  );

  const resvg = new Resvg(svg, { background: '#0B1A3A', fitTo: { mode: 'width', value: 1200 } });
  return resvg.render().asPng();
}
