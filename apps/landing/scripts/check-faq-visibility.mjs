// Post-build guard: every answer declared in a `FAQPage` JSON-LD block must be
// visible in the rendered body of that same page.
//
// WHY
// ---
// Two pages shipped a FAQPage whose entries were NOT on the page — including a
// USB-token answer about PKCS#11/WebUSB that appeared nowhere in the body. That
// violates Google's structured-data policy (the answer must be visible to the
// user) and can make the whole rich result ineligible. The JSON-LD is authored
// by hand in the `.astro` file while the body comes from a `.md`, so the two
// drift silently: only a check against the BUILT html can catch it.
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Normalise for comparison. Markdown rendering applies smart punctuation and
 * wraps inline code in tags, so a verbatim copy is not byte-identical: fold the
 * typographic variants that carry no meaning, and nothing else.
 */
function normalise(s) {
  return decodeEntities(s)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical form used for the comparison, applied to BOTH sides.
 *
 * The needle comes from hand-written or Markdown-derived JSON-LD and the
 * haystack from rendered HTML, so the two differ in ways a reader never sees:
 * stripping tags injects a space where inline markup sat
 * (`<code>.p12</code>;` → `.p12 ;`), some JSON-LD is built from raw Markdown and
 * still carries `[text](/url/)` link syntax and emphasis markers, and `#` is
 * dropped on the way into a few of those blocks (`PKCS#11` → `PKCS11`).
 * Folding those away keeps the guard focused on the thing it exists to catch —
 * an answer whose CONTENT is simply not on the page — instead of drowning it in
 * punctuation noise.
 */
const canonical = (s) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](/url/) -> text
    .replace(/[`*_#]/g, '')
    .replace(/\s+/g, '');

/** Strip <script>/<style> and all tags, leaving the text a reader sees. */
function visibleText(html) {
  const body = html.slice(html.indexOf('<body'));
  return normalise(
    body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function faqBlocks(html) {
  const out = [];
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let parsed;
    try {
      parsed = JSON.parse(decodeEntities(m[1]));
    } catch {
      // A JSON-LD block that does not parse is a separate bug; not this guard's
      // job, but it must not pass silently either.
      out.push({ malformed: true });
      continue;
    }
    if (parsed && parsed['@type'] === 'FAQPage' && Array.isArray(parsed.mainEntity)) {
      out.push({ entries: parsed.mainEntity });
    }
  }
  return out;
}

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith('.html')) yield full;
  }
}

const problems = [];
let checkedPages = 0;
let checkedAnswers = 0;

for await (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  const blocks = faqBlocks(html);
  if (blocks.length === 0) continue;
  const text = canonical(visibleText(html));
  checkedPages += 1;
  for (const block of blocks) {
    if (block.malformed) {
      problems.push({ file: relative(ROOT, file), reason: 'malformed JSON-LD block' });
      continue;
    }
    for (const q of block.entries) {
      const answer = normalise(String(q?.acceptedAnswer?.text ?? ''));
      const question = String(q?.name ?? '(unnamed)');
      checkedAnswers += 1;
      if (answer.length === 0) {
        problems.push({ file: relative(ROOT, file), question, reason: 'empty answer' });
        continue;
      }
      if (!text.includes(canonical(answer))) {
        problems.push({
          file: relative(ROOT, file),
          question,
          reason: 'answer text is not visible in the rendered page',
        });
      }
    }
  }
}

if (problems.length > 0) {
  console.error('ERROR: FAQPage JSON-LD declares answers the page does not show:');
  for (const p of problems) {
    console.error(`  - ${p.file}`);
    if (p.question) console.error(`      Q: ${p.question}`);
    console.error(`      ${p.reason}`);
  }
  console.error(
    "\nGoogle requires the answer to be visible on the page. Either render the text in the body, " +
      'or drop the entry from the JSON-LD — never ship a question the page does not answer.',
  );
  process.exit(1);
}

console.log(
  `check-faq-visibility OK: ${checkedAnswers} answers across ${checkedPages} pages are visible in the built html`,
);
