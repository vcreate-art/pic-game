// Bundles the server into one file for `npm start`.
//
// @pic-game/shared ships TypeScript source (Vite and tsx read it directly), so
// plain Node can't import it at runtime. It is inlined here; real npm
// dependencies stay external and are loaded from node_modules as usual.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@pic-game/'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external,
  logLevel: 'info',
});
