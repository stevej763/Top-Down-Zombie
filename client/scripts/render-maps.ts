// Renders every maps/*.json to docs/maps/<id>.png with the game's own map pre-render.
// Run with `npm run render-maps` (needs vite-node, fetched by npx, because the client uses import.meta.env).
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'docs/maps');

// The yard speckle uses Math.random; seed it so the PNGs only change when a map does.
let seed = 42;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
(globalThis as { document?: unknown }).document = { createElement: () => createCanvas(1, 1) };

const { parseMap } = await import('../src/game/MapData');
const { renderMap } = await import('../src/render/draw');

mkdirSync(out, { recursive: true });
for (const file of readdirSync(join(root, 'maps')).filter((f) => f.endsWith('.json')).sort()) {
  seed = 42;
  const doc = JSON.parse(readFileSync(join(root, 'maps', file), 'utf8'));
  const canvas = renderMap(parseMap(doc)) as unknown as ReturnType<typeof createCanvas>;
  writeFileSync(join(out, `${doc.id}.png`), canvas.toBuffer('image/png'));
  console.log(`docs/maps/${doc.id}.png  ${canvas.width}x${canvas.height}`);
}
