import type { FeedRecord, PiyologFeedV1 } from '../types/feed';

const MILLIS_PER_HOUR = 60 * 60 * 1000;

export interface CountSummary {
  today: number;
  last24Hours: number;
  lastAt: string | null;
}

export interface AmountSummary extends CountSummary {
  todayTotal: number | null;
  last24HoursTotal: number | null;
  average: number | null;
  averageIntervalMillis: number | null;
}

export interface SleepInterval {
  startAt: string;
  endAt: string | null;
}

export interface SleepSummary {
  intervals: SleepInterval[];
  confirmedMillis: number;
  currentSleepStart: string | null;
}

export interface FeedAnalytics {
  formula: AmountSummary;
  expressedBreastMilk: AmountSummary;
  breastFeeding: CountSummary & {
    totalMillis: number | null;
    measuredAmount: number | null;
  };
  pee: CountSummary;
  poop: CountSummary;
  sleep: SleepSummary;
}

function timestamp(record: FeedRecord): number {
  return Date.parse(record.datetime);
}

function withinFeedRange(record: FeedRecord, feed: PiyologFeedV1): boolean {
  const time = timestamp(record);
  return time >= Date.parse(feed.range.from) && time < Date.parse(feed.range.to);
}

function sortedOfType(feed: PiyologFeedV1, type: string): FeedRecord[] {
  return feed.records
    .filter((record) => record.type === type && withinFeedRange(record, feed))
    .sort((a, b) => timestamp(a) - timestamp(b));
}

export function recordMilkAmount(record: FeedRecord): number | null {
  const value = record.value;
  return value?.unit === 'ml' &&
    typeof value.value === 'number' &&
    Number.isFinite(value.value) &&
    value.value >= 0
    ? value.value
    : null;
}

function sumKnownAmounts(records: FeedRecord[]): number | null {
  const values = records.map(recordMilkAmount).filter((value): value is number => value !== null);
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

function localDayStart(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function isToday(record: FeedRecord, startOfToday: number): boolean {
  return timestamp(record) >= startOfToday;
}

function averageInterval(records: FeedRecord[]): number | null {
  if (records.length < 2) return null;
  const span = timestamp(records[records.length - 1]!) - timestamp(records[0]!);
  return span / (records.length - 1);
}

function amountSummary(records: FeedRecord[], now: Date): AmountSummary {
  const todayRecords = records.filter((record) => isToday(record, localDayStart(now)));
  const values = records.map(recordMilkAmount).filter((value): value is number => value !== null);
  return {
    today: todayRecords.length,
    last24Hours: records.length,
    lastAt: records.at(-1)?.datetime ?? null,
    todayTotal: sumKnownAmounts(todayRecords),
    last24HoursTotal: sumKnownAmounts(records),
    average: values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length,
    averageIntervalMillis: averageInterval(records),
  };
}

function countSummary(records: FeedRecord[], now: Date): CountSummary {
  return {
    today: records.filter((record) => isToday(record, localDayStart(now))).length,
    last24Hours: records.length,
    lastAt: records.at(-1)?.datetime ?? null,
  };
}

export function getSleepSummary(records: FeedRecord[]): SleepSummary {
  const sleepEvents = records
    .filter((record) => record.type === 'Sleep' || record.type === 'WakeUp')
    .slice()
    .sort((a, b) => timestamp(a) - timestamp(b));

  const intervals: SleepInterval[] = [];
  let activeStart: FeedRecord | null = null;
  for (const record of sleepEvents) {
    if (record.type === 'Sleep') {
      if (activeStart !== null) {
        intervals.push({ startAt: activeStart.datetime, endAt: null });
      }
      activeStart = record;
    } else if (activeStart !== null) {
      intervals.push({ startAt: activeStart.datetime, endAt: record.datetime });
      activeStart = null;
    }
  }

  if (activeStart !== null) intervals.push({ startAt: activeStart.datetime, endAt: null });

  const confirmedMillis = intervals.reduce((total, interval) => {
    if (interval.endAt === null) return total;
    return total + Date.parse(interval.endAt) - Date.parse(interval.startAt);
  }, 0);
  const openInterval = intervals.at(-1);
  return {
    intervals,
    confirmedMillis,
    currentSleepStart: openInterval?.endAt === null ? openInterval.startAt : null,
  };
}

export function getFeedAnalytics(feed: PiyologFeedV1, now: Date = new Date()): FeedAnalytics {
  const formulas = sortedOfType(feed, 'Formula');
  const expressed = sortedOfType(feed, 'ExpressedBreastMilk');
  const breastFeeding = sortedOfType(feed, 'BreastFeeding');
  const pee = sortedOfType(feed, 'Pee');
  const poop = sortedOfType(feed, 'Poop');
  const sleepRecords = feed.records.filter((record) => withinFeedRange(record, feed));
  const breastTimes = breastFeeding.flatMap((record) =>
    [record.leftTime, record.rightTime].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    ),
  );

  return {
    formula: amountSummary(formulas, now),
    expressedBreastMilk: amountSummary(expressed, now),
    breastFeeding: {
      ...countSummary(breastFeeding, now),
      totalMillis:
        breastTimes.length === 0
          ? null
          : breastTimes.reduce((total, value) => total + value, 0) * 1000,
      measuredAmount: sumKnownAmounts(breastFeeding),
    },
    pee: countSummary(pee, now),
    poop: countSummary(poop, now),
    sleep: getSleepSummary(
      sleepRecords.filter((record) => record.type === 'Sleep' || record.type === 'WakeUp'),
    ),
  };
}

export function nextFeedingEstimate(
  lastFormulaAt: string | null,
  intervalHours: number,
): Date | null {
  if (lastFormulaAt === null || !Number.isFinite(Date.parse(lastFormulaAt))) return null;
  return new Date(Date.parse(lastFormulaAt) + intervalHours * MILLIS_PER_HOUR);
}

export function formatLocalDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

export function formatLocalTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

export function durationLabel(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return String(minutes) + '分';
  if (minutes === 0) return String(hours) + '時間';
  return String(hours) + '時間' + String(minutes) + '分';
}
