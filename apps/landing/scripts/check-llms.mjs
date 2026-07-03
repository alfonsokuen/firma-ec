// Post-build guard: every Spanish page in the generated sitemap must be
// listed in public/llms.txt, so the LLM-facing index never drifts when new
// pages ship (it went stale for 46 days after /compatibilidad/ was created).
// English pages are curated by hand (only key ones are listed) and are not
// enforced. Add a URL to EXCEPTIONS only with a reason.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXCEPTIONS = new Set([
  'https://firmar.ec/', // home is the file itself; no self-entry needed
]);

const sitemap = readFileSync(join(ROOT, 'dist/sitemap-0.xml'), 'utf8');
const llms = readFileSync(join(ROOT, 'public/llms.txt'), 'utf8');

const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const esUrls = urls.filter((u) => !u.startsWith('https://firmar.ec/en/'));

const missing = esUrls.filter((u) => !EXCEPTIONS.has(u) && !llms.includes(u));

if (missing.length > 0) {
  console.error('ERROR: pages in sitemap but missing from public/llms.txt:');
  for (const u of missing) console.error(`  - ${u}`);
  console.error('Add them to public/llms.txt (or to EXCEPTIONS with a reason).');
  process.exit(1);
}
console.log(`check-llms OK: ${esUrls.length} ES sitemap URLs covered by llms.txt`);
