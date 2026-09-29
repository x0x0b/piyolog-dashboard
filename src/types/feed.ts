export interface FeedRange {
  from: string;
  to: string;
}

export interface NumericValue {
  value: number;
  unit: string;
}

export interface PoopDetails {
  amount?: string;
  hardness?: string;
  color?: string;
}

export interface FeedRecord {
  event_id: string;
  datetime: string;
  type: string;
  memo?: string;
  value?: NumericValue;
  last?: string;
  leftTime?: number;
  rightTime?: number;
  details?: PoopDetails;
  [field: string]: unknown;
}

export interface PiyologFeedV1 {
  schema_version: 1;
  generated_at: string;
  range: FeedRange;
  records: FeedRecord[];
}

export type FeedPayloadResult =
  | { status: 'ok'; feed: PiyologFeedV1 }
  | { status: 'unsupported'; version: unknown }
  | { status: 'invalid' };

const utcIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function isUtcIsoDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' && utcIsoPattern.test(value) && Number.isFinite(Date.parse(value))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseFeedPayload(value: unknown): FeedPayloadResult {
  if (!isObject(value) || !Object.hasOwn(value, 'schema_version')) {
    return { status: 'invalid' };
  }

  if (value.schema_version !== 1) {
    return { status: 'unsupported', version: value.schema_version };
  }

  if (
    !isUtcIsoDateTime(value.generated_at) ||
    !isObject(value.range) ||
    !isUtcIsoDateTime(value.range.from) ||
    !isUtcIsoDateTime(value.range.to) ||
    value.range.to !== value.generated_at ||
    Date.parse(value.range.from) >= Date.parse(value.range.to) ||
    !Array.isArray(value.records)
  ) {
    return { status: 'invalid' };
  }

  const records: FeedRecord[] = [];
  for (const candidate of value.records) {
    if (
      !isObject(candidate) ||
      typeof candidate.event_id !== 'string' ||
      typeof candidate.type !== 'string' ||
      !isUtcIsoDateTime(candidate.datetime)
    ) {
      return { status: 'invalid' };
    }
    records.push(candidate as unknown as FeedRecord);
  }

  return {
    status: 'ok',
    feed: {
      schema_version: 1,
      generated_at: value.generated_at,
      range: { from: value.range.from, to: value.range.to },
      records,
    },
  };
}
