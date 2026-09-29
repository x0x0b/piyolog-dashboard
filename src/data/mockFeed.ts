import type { FeedRecord, PiyologFeedV1 } from '../types/feed';

function hoursBefore(anchor: Date, hours: number): string {
  return new Date(anchor.getTime() - hours * 60 * 60 * 1000).toISOString();
}

export function createMockFeed(generatedAt = new Date()): PiyologFeedV1 {
  const records: FeedRecord[] = [
    {
      event_id: 'demo-formula-1',
      datetime: hoursBefore(generatedAt, 20),
      type: 'Formula',
      value: { value: 100, unit: 'ml' },
    },
    {
      event_id: 'demo-sleep-1',
      datetime: hoursBefore(generatedAt, 8),
      type: 'Sleep',
    },
    {
      event_id: 'demo-expressed-1',
      datetime: hoursBefore(generatedAt, 5.5),
      type: 'ExpressedBreastMilk',
      value: { value: 60, unit: 'ml' },
    },
    {
      event_id: 'demo-formula-2',
      datetime: hoursBefore(generatedAt, 4.25),
      type: 'Formula',
      value: { value: 90, unit: 'ml' },
    },
    {
      event_id: 'demo-poop-1',
      datetime: hoursBefore(generatedAt, 3.25),
      type: 'Poop',
      details: { amount: 'normal', hardness: 'soft', color: 'yellow' },
    },
    {
      event_id: 'demo-pee-1',
      datetime: hoursBefore(generatedAt, 3),
      type: 'Pee',
    },
    {
      event_id: 'demo-wakeup-1',
      datetime: hoursBefore(generatedAt, 2),
      type: 'WakeUp',
    },
    {
      event_id: 'demo-breastfeeding-1',
      datetime: hoursBefore(generatedAt, 1.75),
      type: 'BreastFeeding',
      last: 'left',
      leftTime: 360,
      rightTime: 240,
      value: { value: 70, unit: 'ml' },
    },
    {
      event_id: 'demo-formula-3',
      datetime: hoursBefore(generatedAt, 1.25),
      type: 'Formula',
      value: { value: 120, unit: 'ml' },
    },
    {
      event_id: 'demo-pee-2',
      datetime: hoursBefore(generatedAt, 0.9),
      type: 'Pee',
    },
    {
      event_id: 'demo-poop-2',
      datetime: hoursBefore(generatedAt, 0.7),
      type: 'Poop',
    },
    {
      event_id: 'demo-formula-4',
      datetime: hoursBefore(generatedAt, 0.5),
      type: 'Formula',
      value: { value: 80, unit: 'ml' },
      memo: 'Demo memo: plain text only.',
    },
    {
      event_id: 'demo-breastfeeding-2',
      datetime: hoursBefore(generatedAt, 0.4),
      type: 'BreastFeeding',
    },
    {
      event_id: 'demo-temperature-1',
      datetime: hoursBefore(generatedAt, 0.3),
      type: 'Temperature',
      value: { value: 36.7, unit: 'celsius' },
    },
    {
      event_id: 'demo-formula-optional',
      datetime: hoursBefore(generatedAt, 0.2),
      type: 'Formula',
    },
    {
      event_id: 'demo-sleep-current',
      datetime: hoursBefore(generatedAt, 0.15),
      type: 'Sleep',
    },
    {
      event_id: 'demo-future-type',
      datetime: hoursBefore(generatedAt, 0.1),
      type: 'FutureRecordType',
      futureField: 'ignored',
    },
  ];

  records.sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
  return {
    schema_version: 1,
    generated_at: generatedAt.toISOString(),
    range: {
      from: hoursBefore(generatedAt, 24),
      to: generatedAt.toISOString(),
    },
    records,
  };
}
