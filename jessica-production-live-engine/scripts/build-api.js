import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(__dirname, '../server/server.ts');
const outLocal = path.resolve(__dirname, '../api/index.js');
const outRoot = path.resolve(__dirname, '../../api/index.js');

async function run() {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: outLocal,
  });
  console.log('[build-api] Successfully bundled engine api/index.js');

  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      outfile: outRoot,
    });
    console.log('[build-api] Successfully bundled root api/index.js');
  } catch (e) {
    console.warn('[build-api] Root api bundle note:', e.message);
  }
}

run().catch(err => {
  console.error('[build-api] Error bundling server:', err);
  process.exit(1);
});
