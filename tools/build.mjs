// Bundle src/main.js into a classic (non-module) script so dist/index.html
// opens straight from the file system, no server needed.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--debug');

mkdirSync(join(root, 'dist'), { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  loader: { '.json': 'json' },
  write: false,
  logLevel: 'info',
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(join(root, 'src/index.html'), 'utf8');
const fontsPath = join(root, 'src/fonts.css');
const css = (existsSync(fontsPath) ? readFileSync(fontsPath, 'utf8') : '') + readFileSync(join(root, 'src/style.css'), 'utf8');

const out = html
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

writeFileSync(join(root, 'dist/index.html'), out);
console.log('dist/index.html', (out.length / 1024).toFixed(0) + ' KB');
