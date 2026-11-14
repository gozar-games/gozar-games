import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../www/', import.meta.url);
const files = [
  'index.html',
  'snake.html',
  'crossy.html',
  'games/battle-arena/index.html',
  'games/battle-arena/gozar-battle-arena-assets.zip',
  'assets/three.module.js',
  'native-bridge.js'
];

for (const file of files) {
  const path = new URL(file, root);
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) throw new Error('Missing or empty: ' + file);
}

const home = await readFile(new URL('index.html', root), 'utf8');
const crossy = await readFile(new URL('crossy.html', root), 'utf8');
const arena = await readFile(new URL('games/battle-arena/index.html', root), 'utf8');
if (!home.includes('/snake.html') || !home.includes('/crossy.html') || !home.includes('/games/battle-arena/')) {
  throw new Error('One or more game links are missing from the Android home page.');
}
if (!crossy.includes('./assets/three.module.js') || crossy.includes('cdn.jsdelivr.net/npm/three@0.160.0')) {
  throw new Error('Crossy Road is not using the bundled Three.js module.');
}
if (!arena.includes('gozar-battle-arena-assets.zip')) {
  throw new Error('Battle Arena asset archive reference is missing.');
}
for (const file of ['index.html', 'snake.html', 'crossy.html', 'games/battle-arena/index.html']) {
  const html = await readFile(new URL(file, root), 'utf8');
  if (!html.includes('/native-bridge.js')) throw new Error('Native bridge not injected into ' + file);
}
console.log('Android web bundle smoke checks passed.');
