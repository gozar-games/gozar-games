import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'android-app/www');
const required = [
  'index.html',
  'snake.html',
  'crossy.html',
  'games/battle-arena/index.html',
  'games/battle-arena/gozar-battle-arena-assets.zip'
];

for (const file of required) {
  if (!existsSync(join(root, file))) {
    throw new Error('Required game asset is missing: ' + file);
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of ['index.html', 'snake.html', 'crossy.html']) {
  await cp(join(root, file), join(out, file));
}
await mkdir(join(out, 'games/battle-arena'), { recursive: true });
await cp(
  join(root, 'games/battle-arena/index.html'),
  join(out, 'games/battle-arena/index.html')
);
await cp(
  join(root, 'games/battle-arena/gozar-battle-arena-assets.zip'),
  join(out, 'games/battle-arena/gozar-battle-arena-assets.zip')
);

const threeSource = join(root, 'node_modules/three/build/three.module.js');
if (!existsSync(threeSource)) {
  throw new Error('Three.js is not installed. Run npm install first.');
}
await mkdir(join(out, 'assets'), { recursive: true });
await cp(threeSource, join(out, 'assets/three.module.js'));
await cp(
  join(root, 'android-app/native-bridge.js'),
  join(out, 'native-bridge.js')
);

for (const file of ['index.html', 'snake.html', 'crossy.html', 'games/battle-arena/index.html']) {
  const target = join(out, file);
  let html = await readFile(target, 'utf8');
  if (!html.includes('</head>')) {
    throw new Error('HTML head not found in ' + file);
  }
  if (!html.includes('native-bridge.js')) {
    html = html.replace('</head>', '  <script src="/native-bridge.js"></script>\n</head>');
  }
  if (file === 'crossy.html') {
    const cdnImport = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
    if (!html.includes(cdnImport)) {
      throw new Error('Expected pinned Three.js import was not found in crossy.html');
    }
    html = html.replace(cdnImport, './assets/three.module.js');
  }
  await writeFile(target, html, 'utf8');
}

console.log('Android web bundle created at android-app/www');
