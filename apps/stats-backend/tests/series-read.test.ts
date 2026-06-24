import { describe, expect, test } from 'vitest';
import { readSeries } from '../src/services/series-read.js';

/**
 * series-read.test.ts — readSeries over a hand-rolled prisma mock (no DB).
 *
 * The mock answers three distinct $queryRaw shapes by inspecting the SQL text:
 *   - the windowed `stats_events` range scan → a fixed array of {ts,type}
 *   - the `min(ts)` honesty-note query        → [{ m: Date }]
 *   - the `usage_counters` totals query        → [{ key, count }]
 * Bucketing reuses the worker's pure date helpers, so we assert against the
 * EC-local civil day of the fixed events.
 */

// EC-local 2026-06-22 12:00 → 17:00Z.
const EC_NOON_JUN22 = Date.UTC(2026, 5, 22, 17, 0, 0);
// Three events on the same EC day: 2 sign, 1 verify.
const EVENT_A = new Date(Date.UTC(2026, 5, 22, 17, 0, 0));
const EVENT_B = new Date(Date.UTC(2026, 5, 22, 18, 0, 0));
const EVENT_C = new Date(Date.UTC(2026, 5, 22, 19, 0, 0));

function sqlText(strings: TemplateStringsArray): string {
  return strings.join(' ').toLowerCase();
}

function mockPrisma(opts?: {
  events?: Array<{ ts: Date; type: string }>;
  min?: Date | null;
  totals?: Array<{ key: string; count: bigint }>;
}) {
  const events = opts?.events ?? [
    { ts: EVENT_A, type: 'sign' },
    { ts: EVENT_B, type: 'sign' },
    { ts: EVENT_C, type: 'verify' },
  ];
  const min = opts?.min === undefined ? EVENT_A : opts.min;
  const totals = opts?.totals ?? [
    { key: 'sign', count: 2n },
    { key: 'verify', count: 1n },
  ];
  return {
    // biome-ignore lint/suspicious/noExplicitAny: minimal prisma test double
    $queryRaw: async (strings: TemplateStringsArray, ..._args: unknown[]): Promise<any> => {
      const sql = sqlText(strings);
      if (sql.includes('from "stats_events"') && sql.includes('min(')) {
        return [{ m: min }];
      }
      if (sql.includes('from "stats_events"')) {
        return events;
      }
      if (sql.includes('from "usage_counters"')) {
        return totals;
      }
      return [];
    },
    // biome-ignore lint/suspicious/noExplicitAny: cast to PrismaClient for the call site
  } as any;
}

describe('readSeries — bucketing, zero-fill, since, totals', () => {
  test('day: events land in the correct EC-local bucket; others zero-filled', async () => {
    const res = await readSeries(mockPrisma(), 'day', EC_NOON_JUN22);
    expect(res.granularity).toBe('day');
    expect(res.buckets).toHaveLength(30);

    const today = res.buckets.find((b) => b.period === '2026-06-22');
    expect(today).toEqual({ period: '2026-06-22', sign: 2, verify: 1, cert: 0 });

    // Every other bucket is zero-filled.
    const others = res.buckets.filter((b) => b.period !== '2026-06-22');
    for (const b of others) {
      expect(b.sign + b.verify + b.cert).toBe(0);
    }
  });

  test('totals come from usage_counters (default 0 for missing keys)', async () => {
    const res = await readSeries(mockPrisma(), 'day', EC_NOON_JUN22);
    expect(res.totals).toEqual({ sign: 2, verify: 1, cert: 0 });
  });

  test('since = EC-local civil day of the first event', async () => {
    const res = await readSeries(mockPrisma(), 'day', EC_NOON_JUN22);
    expect(res.since).toBe('2026-06-22');
  });

  test('since falls back to today when the log is empty', async () => {
    const res = await readSeries(
      mockPrisma({ events: [], min: null, totals: [] }),
      'day',
      EC_NOON_JUN22,
    );
    expect(res.since).toBe('2026-06-22');
    const sum = res.buckets.reduce((a, b) => a + b.sign + b.verify + b.cert, 0);
    expect(sum).toBe(0);
  });

  test('unknown event types are ignored (no NaN poisoning)', async () => {
    const res = await readSeries(
      mockPrisma({
        events: [
          { ts: EVENT_A, type: 'sign' },
          { ts: EVENT_B, type: 'bogus' },
        ],
        min: EVENT_A,
        totals: [{ key: 'sign', count: 1n }],
      }),
      'day',
      EC_NOON_JUN22,
    );
    const today = res.buckets.find((b) => b.period === '2026-06-22');
    expect(today).toEqual({ period: '2026-06-22', sign: 1, verify: 0, cert: 0 });
  });
});
