/**
 * Skeleton placeholder. Real tests for parseDss / appendDss /
 * findDocumentTimestamps / appendDocumentTimestamp ship in F7 Batch III
 * (T11-T15) per docs/superpowers/plans/2026-05-10-firma-ec-F7-LTV.md.
 *
 * This file just asserts the public API surface is importable so CI green-lights
 * the bootstrap commit.
 */

import { describe, it, expect } from 'vitest';
import {
  appendDss,
  appendDocumentTimestamp,
  parseDss,
  findDocumentTimestamps,
} from '../src/index';

describe('@firma-ec/dss-pdf skeleton', () => {
  it('exports the four public stubs', () => {
    expect(typeof appendDss).toBe('function');
    expect(typeof appendDocumentTimestamp).toBe('function');
    expect(typeof parseDss).toBe('function');
    expect(typeof findDocumentTimestamps).toBe('function');
  });

  it('stubs throw "not implemented" until F7 Batch III lands', () => {
    expect(() => parseDss(new Uint8Array(0))).toThrow(/not implemented/);
    expect(() => findDocumentTimestamps(new Uint8Array(0))).toThrow(/not implemented/);
  });
});
