import { describe, expect, it } from 'vitest';
import {
  formatLocalTime,
  getFeedAnalytics,
  getSleepSummary,
  nextFeedingEstimate,
} from './analytics';
import { parseFeedPayload } from '../types/feed';
import type { FeedRecord, PiyologFeedV1 } from '../types/feed';

const generatedAt = '2026-03-01T03:00:00.000Z';
const baseFeed: PiyologFeedV1 = {
  schema_version: 1,
  generated_at: generatedAt,
  range: { from: '2026-02-28T03:00:00.000Z', to: generatedAt },
  records: [],
};

function record(
  event_id: string,
  datetime: string,
  type: string,
  extra: Partial<FeedRecord> = {},
): FeedRecord {
  return { event_id, datetime, type, ...extra };
}

describe('Feed analytics', () => {
  it('calculates Formula totals, counts, average, last record and intervals', () => {
    const now = new Date(2026, 2, 1, 12, 0, 0);
    const hoursAgo = (hours: number) =>
      new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
    const feed = {
      ...baseFeed,
      generated_at: now.toISOString(),
      range: {
        from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        to: now.toISOString(),
      },
      records: [
        record('f1', hoursAgo(20), 'Formula', {
          value: { value: 100, unit: 'ml' },
        }),
        record('f2', hoursAgo(4), 'Formula', {
          value: { value: 80, unit: 'ml' },
        }),
        record('f3', hoursAgo(1), 'Formula', {
          value: { value: 120, unit: 'ml' },
        }),
      ],
    };

    const result = getFeedAnalytics(feed, now);
    expect(result.formula.last24HoursTotal).toBe(300);
    expect(result.formula.todayTotal).toBe(200);
    expect(result.formula.last24Hours).toBe(3);
    expect(result.formula.today).toBe(2);
    expect(result.formula.average).toBe(100);
    expect(result.formula.lastAt).toBe(hoursAgo(1));
    expect(result.formula.averageIntervalMillis).toBe(9.5 * 60 * 60 * 1000);
    expect(nextFeedingEstimate(result.formula.lastAt, 3)?.toISOString()).toBe(
      new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('counts Pee and Poop independently for today and the feed range', () => {
    const feed = {
      ...baseFeed,
      records: [
        record('pee-old', '2026-02-28T04:00:00.000Z', 'Pee'),
        record('pee-today', '2026-03-01T02:00:00.000Z', 'Pee'),
        record('poop-today', '2026-03-01T02:30:00.000Z', 'Poop'),
      ],
    };
    const result = getFeedAnalytics(feed, new Date(generatedAt));
    expect(result.pee).toMatchObject({ today: 1, last24Hours: 2 });
    expect(result.poop).toMatchObject({ today: 1, last24Hours: 1 });
  });

  it('keeps ExpressedBreastMilk separate and uses only entered BreastFeeding values', () => {
    const feed = {
      ...baseFeed,
      records: [
        record('formula', '2026-03-01T01:00:00.000Z', 'Formula', {
          value: { value: 100, unit: 'ml' },
        }),
        record('expressed', '2026-03-01T01:30:00.000Z', 'ExpressedBreastMilk', {
          value: { value: 60, unit: 'ml' },
        }),
        record('breastfeeding', '2026-03-01T02:00:00.000Z', 'BreastFeeding', {
          leftTime: 60,
          rightTime: 120,
          value: { value: 40, unit: 'ml' },
        }),
        record('breastfeeding-no-value', '2026-03-01T02:30:00.000Z', 'BreastFeeding', {
          leftTime: 90,
        }),
      ],
    };
    const result = getFeedAnalytics(feed, new Date(generatedAt));
    expect(result.formula.last24HoursTotal).toBe(100);
    expect(result.expressedBreastMilk.last24HoursTotal).toBe(60);
    expect(result.breastFeeding.last24Hours).toBe(2);
    expect(result.breastFeeding.totalMillis).toBe(270_000);
    expect(result.breastFeeding.measuredAmount).toBe(40);
  });

  it('pairs Sleep with the following WakeUp and totals confirmed intervals', () => {
    const sleep = getSleepSummary([
      record('s1', '2026-02-28T22:00:00.000Z', 'Sleep'),
      record('w1', '2026-03-01T00:00:00.000Z', 'WakeUp'),
      record('s2', '2026-03-01T02:00:00.000Z', 'Sleep'),
      record('w2', '2026-03-01T02:30:00.000Z', 'WakeUp'),
    ]);
    expect(sleep.intervals).toHaveLength(2);
    expect(sleep.confirmedMillis).toBe(2.5 * 60 * 60 * 1000);
    expect(sleep.currentSleepStart).toBeNull();
  });

  it('leaves a Sleep without a WakeUp incomplete and does not estimate its duration', () => {
    const sleep = getSleepSummary([record('s1', '2026-03-01T02:00:00.000Z', 'Sleep')]);
    expect(sleep.intervals).toEqual([{ startAt: '2026-03-01T02:00:00.000Z', endAt: null }]);
    expect(sleep.confirmedMillis).toBe(0);
    expect(sleep.currentSleepStart).toBe('2026-03-01T02:00:00.000Z');
  });

  it('ignores a WakeUp without a preceding Sleep', () => {
    const sleep = getSleepSummary([record('w1', '2026-03-01T02:00:00.000Z', 'WakeUp')]);
    expect(sleep.intervals).toEqual([]);
    expect(sleep.confirmedMillis).toBe(0);
    expect(sleep.currentSleepStart).toBeNull();
  });

  it('uses the local midnight as the boundary for Today', () => {
    const midnight = new Date(2026, 2, 1, 0, 0, 0);
    const beforeMidnight = new Date(2026, 1, 28, 23, 59, 59);
    const feed = {
      ...baseFeed,
      range: {
        from: new Date(2026, 1, 28, 0, 0, 0).toISOString(),
        to: new Date(2026, 2, 1, 1, 0, 0).toISOString(),
      },
      generated_at: new Date(2026, 2, 1, 1, 0, 0).toISOString(),
      records: [
        record('yesterday', beforeMidnight.toISOString(), 'Formula', {
          value: { value: 90, unit: 'ml' },
        }),
        record('today', new Date(2026, 2, 1, 0, 1, 0).toISOString(), 'Formula', {
          value: { value: 60, unit: 'ml' },
        }),
      ],
    };
    const result = getFeedAnalytics(feed, midnight);
    expect(result.formula.last24HoursTotal).toBe(150);
    expect(result.formula.todayTotal).toBe(60);
    expect(result.formula.today).toBe(1);
  });

  it('formats a UTC instant in the requested local timezone', () => {
    expect(formatLocalTime('2026-03-01T00:30:00.000Z', 'Asia/Tokyo')).toBe('09:30');
  });

  it('keeps missing optional quantities distinct from a measured zero', () => {
    const feed = {
      ...baseFeed,
      records: [
        record('f1', '2026-03-01T01:00:00.000Z', 'Formula'),
        record('bf1', '2026-03-01T01:30:00.000Z', 'BreastFeeding'),
      ],
    };
    const result = getFeedAnalytics(feed, new Date(generatedAt));
    expect(result.formula.last24Hours).toBe(1);
    expect(result.formula.last24HoursTotal).toBeNull();
    expect(result.formula.average).toBeNull();
    expect(result.breastFeeding.totalMillis).toBeNull();
    expect(result.breastFeeding.measuredAmount).toBeNull();
  });

  it('keeps an explicitly supplied zero separate from an omitted amount', () => {
    const feed = {
      ...baseFeed,
      records: [
        record('missing', '2026-03-01T01:00:00.000Z', 'Formula'),
        record('zero', '2026-03-01T01:30:00.000Z', 'Formula', {
          value: { value: 0, unit: 'ml' },
        }),
      ],
    };
    const result = getFeedAnalytics(feed, new Date(generatedAt));
    expect(result.formula.last24Hours).toBe(2);
    expect(result.formula.last24HoursTotal).toBe(0);
    expect(result.formula.average).toBe(0);
  });

  it('handles an empty records array', () => {
    const result = getFeedAnalytics(baseFeed, new Date(generatedAt));
    expect(result.formula.last24Hours).toBe(0);
    expect(result.formula.last24HoursTotal).toBeNull();
    expect(result.pee.lastAt).toBeNull();
    expect(result.sleep.intervals).toEqual([]);
  });

  it('ignores unknown record types without affecting supported summaries', () => {
    const feed = {
      ...baseFeed,
      records: [
        record('new', '2026-03-01T01:00:00.000Z', 'FutureType', {
          arbitrary: { nested: true },
        }),
      ],
    };
    const result = getFeedAnalytics(feed, new Date(generatedAt));
    expect(result.formula.last24Hours).toBe(0);
    expect(result.pee.last24Hours).toBe(0);
  });

  it('reports an unsupported schema version without trying to parse records', () => {
    expect(parseFeedPayload({ schema_version: 2, records: 'not parsed' })).toEqual({
      status: 'unsupported',
      version: 2,
    });
  });

  it('filters records outside the response range and does not use client time as the range end', () => {
    const feed = {
      ...baseFeed,
      records: [
        record('before', '2026-02-28T02:59:59.000Z', 'Formula', {
          value: { value: 300, unit: 'ml' },
        }),
        record('at-from', '2026-02-28T03:00:00.000Z', 'Formula', {
          value: { value: 50, unit: 'ml' },
        }),
        record('at-to', generatedAt, 'Formula', {
          value: { value: 400, unit: 'ml' },
        }),
      ],
    };
    const result = getFeedAnalytics(feed, new Date('2026-03-01T04:00:00.000Z'));
    expect(result.formula.last24Hours).toBe(1);
    expect(result.formula.last24HoursTotal).toBe(50);
  });
});
