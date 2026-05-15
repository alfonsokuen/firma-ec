/**
 * Skeleton placeholder. Real tests for parseDss / appendDss /
 * findDocumentTimestamps / appendDocumentTimestamp ship in F7 Batch III
 * (T11-T15) per docs/superpowers/plans/2026-05-10-firma-ec-F7-LTV.md.
 *
 * This file just asserts the public API surface is importable so CI green-lights
 * the bootstrap commit.
 */

import { describe, expect, it } from 'vitest';
import { appendDocumentTimestamp, appendDss, findDocumentTimestamps, parseDss } from '../src/index';

describe('@firma-ec/dss-pdf skeleton', () => {
  it('exports the four public stubs', () => {
    expect(typeof appendDss).toBe('function');
    expect(typeof appendDocumentTimestamp).toBe('function');
    expect(typeof parseDss).toBe('function');
    expect(typeof findDocumentTimestamps).toBe('function');
  });

  it('parseDss + findDocumentTimestamps handle empty input gracefully (F7 Batch II)', () => {
    expect(parseDss(new Uint8Array(0))).toBeNull();
    expect(findDocumentTimestamps(new Uint8Array(0))).toEqual([]);
  });
});
