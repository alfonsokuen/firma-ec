/**
 * Bundle the verify API for Node.
 *
 * The one non-obvious piece: `@firma-ec/tsa-trust` and `@firma-ec/tsl-ec` embed
 * their trust anchors as Vite `?raw` imports (`./roots/uanataca-root-2016.pem?raw`).
 * Node and plain esbuild both choke on that query suffix, so the anchors — the
 * very thing that makes a verdict trustworthy — would silently fail to resolve.
 * This plugin is the Node-side counterpart of the `rawAssetPlugin` already used
 * by `packages/signer/vitest.config.ts`; keep the two in sync.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

// La version viaja al bundle desde el manifiesto. Mantenerla a mano en el spec
// OpenAPI ya fallo una vez: la imagen `0.2.0` sirve `info.version: "0.1.0"`.
const { version: pkgVersion } = JSON.parse(
  await readFile(resolve(here, 'package.json'), 'utf8'),
);
if (typeof pkgVersion !== 'string' || pkgVersion === '') {
  throw new Error('apps/verify-api/package.json no declara una version usable');
}

/** @type {import('esbuild').Plugin} */
const rawAssetPlugin = {
  name: 'raw-asset',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.slice(0, -'?raw'.length)),
      namespace: 'raw-asset',
    }));
    build.onLoad({ filter: /.*/, namespace: 'raw-asset' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    index: resolve(here, 'src/index.ts'),
    'mint-key': resolve(here, 'src/cli/mintKey.ts'),
    // The verification worker is its own entry: WorkerRunner resolves it as a
    // sibling of the bundle at runtime.
    'verify-worker': resolve(here, 'src/worker/verifyWorker.ts'),
  },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: resolve(here, 'dist'),
  plugins: [rawAssetPlugin],
  define: { __API_VERSION__: JSON.stringify(pkgVersion) },
  // pino ships worker threads it resolves at runtime; bundling them breaks
  // transport resolution, and they are plain deps in the image anyway.
  external: [],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('verify-api: watching…');
} else {
  await esbuild.build(options);
}
