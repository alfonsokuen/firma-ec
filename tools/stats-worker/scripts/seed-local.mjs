/**
 * seed-local.mjs — dev-only: fill the LOCAL (miniflare) KV with realistic
 * usage buckets so the stats page has something to chart in `astro dev`.
 *
 * Mirrors the key algorithm in ../src/series.ts (UTC−5 Ecuador buckets). Writes
 * a bulk JSON next to this script; the caller pipes it into
 * `wrangler kv bulk put`. Never touches production — local store only.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EC_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY = 86_400_000;
const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const ecCivil = (ms) => {
  const d = new Date(ms - EC_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};
const civilToUtc = (c) => Date.UTC(c.y, c.m - 1, c.d);
const fromUtc = (ms) => {
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};
const dayStr = (c) => `${c.y}-${pad2(c.m)}-${pad2(c.d)}`;
const monthStr = (c) => `${c.y}-${pad2(c.m)}`;
const weekStart = (ms) => {
  const base = civilToUtc(ecCivil(ms));
  const back = (new Date(base).getUTCDay() + 6) % 7;
  return dayStr(fromUtc(base - back * DAY));
};

const now = Date.now();

function recentDays(n) {
  const base = civilToUtc(ecCivil(now));
  return Array.from({ length: n }, (_, k) => dayStr(fromUtc(base - (n - 1 - k) * DAY)));
}
function recentWeeks(n) {
  const base = civilToUtc({ ...fromUtc(0), ...splitDay(weekStart(now)) });
  return Array.from({ length: n }, (_, k) => dayStr(fromUtc(base - (n - 1 - k) * 7 * DAY)));
}
function splitDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
function recentMonths(n) {
  let { y, m } = ecCivil(now);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${pad2(m)}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out.reverse();
}
function recentYears(n) {
  const { y } = ecCivil(now);
  return Array.from({ length: n }, (_, k) => String(y - (n - 1 - k)));
}
const ecShift = (ms) => new Date(ms - EC_OFFSET_MS);
const minuteKey = (ms) => {
  const d = ecShift(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
};
const hourKey = (ms) => {
  const d = ecShift(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}`;
};
function recentMinutes(n) {
  return Array.from({ length: n }, (_, k) => minuteKey(now - (n - 1 - k) * 60_000));
}
function recentHours(n) {
  return Array.from({ length: n }, (_, k) => hourKey(now - (n - 1 - k) * 3_600_000));
}

// Organic-ish counts: a gentle baseline with a recent spike (the "flujo
// repentino" this whole feature was born to make visible).
const wave = (i, base, amp) => Math.round(base + amp * (0.5 + 0.5 * Math.sin(i / 2.3)) + (i % 3));

const minutes = recentMinutes(30);
const hours = recentHours(24);
const days = recentDays(30);
const weeks = recentWeeks(12);
const months = recentMonths(12);
const years = recentYears(5);

const entries = [];
const push = (key, value) => entries.push({ key, value: String(value) });
// Combined per-period bucket (matches series.ts: b:<g>:<period> = {s,v,c}).
const bucket = (g, period, sign, verify, cert) =>
  push(`b:${g}:${period}`, JSON.stringify({ s: sign, v: verify, c: cert }));

let totalSign = 0;
let totalVerify = 0;
let totalCert = 0;

minutes.forEach((mk, i) => {
  let sign = wave(i, 1, 4);
  if (i >= 25) sign += 24 + i; // recent burst, visible in the live minute view
  const verify = Math.round(sign * 0.5);
  bucket('i', mk, sign, verify, Math.round(verify * 0.3));
});
hours.forEach((hk, i) => {
  const sign = wave(i, 6, 18) + (i >= 21 ? 45 : 0);
  const verify = Math.round(sign * 0.5);
  bucket('h', hk, sign, verify, Math.round(verify * 0.3));
});
days.forEach((d, i) => {
  let sign = wave(i, 9, 14);
  if (i >= 26 && i <= 28) sign += 90 + i * 3; // 3-day spike near the end
  const verify = Math.round(sign * (0.45 + 0.2 * ((i % 4) / 4)));
  const cert = Math.round(verify * (0.25 + 0.15 * ((i % 3) / 3)));
  bucket('d', d, sign, verify, cert);
});
weeks.forEach((w, i) => {
  bucket('w', w, wave(i, 70, 60) + (i === 11 ? 120 : 0), wave(i, 35, 28), wave(i, 10, 14));
});
months.forEach((mo, i) => {
  const sign = wave(i, 230, 180) + i * 17;
  const verify = wave(i, 120, 90) + i * 8;
  const cert = wave(i, 30, 40) + i * 3;
  totalSign += sign;
  totalVerify += verify;
  totalCert += cert;
  bucket('m', mo, sign, verify, cert);
});
years.forEach((yr, i) => {
  bucket(
    'y',
    yr,
    [180, 640, 1480, 3120, 4870][i] ?? 100,
    [90, 360, 820, 1610, 2540][i] ?? 50,
    [20, 120, 300, 640, 1080][i] ?? 30,
  );
});

// Running totals (cumulative; bigger than the visible series window) + since.
push('count:sign', totalSign + 4200);
push('count:verify', totalVerify + 2100);
push('count:cert', totalCert + 900);
push('meta:since', `${months[0]}-01`);

const outPath = fileURLToPath(new URL('../.seed-local.json', import.meta.url));
writeFileSync(outPath, JSON.stringify(entries, null, 2));
console.log(`seeded ${entries.length} keys → ${outPath}`);
console.log(`spike days: ${days.slice(26, 29).join(', ')}`);
