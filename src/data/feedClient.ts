import { parseFeedPayload } from '../types/feed';
import type { PiyologFeedV1 } from '../types/feed';

export type FeedErrorKind =
  | 'invalid-url'
  | 'unavailable'
  | 'too-large'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'invalid-response'
  | 'unsupported-schema';

export class FeedRequestError extends Error {
  constructor(
    readonly kind: FeedErrorKind,
    readonly schemaVersion?: unknown,
  ) {
    super(kind);
    this.name = 'FeedRequestError';
  }
}

export function isValidFeedUrl(rawUrl: string): boolean {
  if (rawUrl.length === 0 || rawUrl.trim() !== rawUrl) return false;

  try {
    const parsed = new URL(rawUrl);
    const pathParts = parsed.pathname.split('/');
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'feed.piyolog.com' &&
      parsed.port === '' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      pathParts.length === 6 &&
      pathParts[0] === '' &&
      pathParts[1] === 'v1' &&
      pathParts[2] === 'feed' &&
      pathParts[3] === '24h' &&
      pathParts[4] !== '' &&
      pathParts[5] !== ''
    );
  } catch {
    return false;
  }
}

function responseErrorCode(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
    return undefined;
  }
  const error = payload.error;
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return error.code;
}

export async function fetchFeed(rawUrl: string): Promise<PiyologFeedV1> {
  if (!isValidFeedUrl(rawUrl)) {
    throw new FeedRequestError('invalid-url');
  }

  let response: Response;
  try {
    response = await fetch(rawUrl, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new FeedRequestError('network');
  }

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }

    const code = responseErrorCode(payload);
    if (response.status === 404 || code === 'feed_unavailable') {
      throw new FeedRequestError('unavailable');
    }
    if (response.status === 413 || code === 'feed_response_too_large') {
      throw new FeedRequestError('too-large');
    }
    if (response.status === 429 || code === 'rate_limit_exceeded') {
      throw new FeedRequestError('rate-limit');
    }
    if (response.status >= 500 && response.status <= 599) {
      throw new FeedRequestError('server');
    }
    throw new FeedRequestError('invalid-response');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FeedRequestError('invalid-response');
  }

  const parsed = parseFeedPayload(payload);
  if (parsed.status === 'unsupported') {
    throw new FeedRequestError('unsupported-schema', parsed.version);
  }
  if (parsed.status === 'invalid') {
    throw new FeedRequestError('invalid-response');
  }
  return parsed.feed;
}
