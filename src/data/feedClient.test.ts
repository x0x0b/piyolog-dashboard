import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedRequestError, fetchFeed, isValidFeedUrl } from './feedClient';

const fakeUrl = 'https://feed.piyolog.com/v1/feed/24h/demo-feed/demo-secret';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Piyolog Feed URL and client', () => {
  it('accepts only a complete HTTPS 24h Feed URL on the official host', () => {
    expect(isValidFeedUrl(fakeUrl)).toBe(true);
    expect(isValidFeedUrl('http://feed.piyolog.com/v1/feed/24h/a/b')).toBe(false);
    expect(isValidFeedUrl('https://example.com/v1/feed/24h/a/b')).toBe(false);
    expect(isValidFeedUrl('https://feed.piyolog.com/v1/feed/7d/a/b')).toBe(false);
    expect(isValidFeedUrl(fakeUrl + '?token=extra')).toBe(false);
    expect(isValidFeedUrl(fakeUrl + '/')).toBe(false);
    expect(isValidFeedUrl(' ' + fakeUrl)).toBe(false);
  });

  it('GETs the exact URL without cookies, cache, referrer or authorization headers', async () => {
    const payload = {
      schema_version: 1,
      generated_at: '2026-01-01T12:00:00.000Z',
      range: {
        from: '2026-01-01T11:00:00.000Z',
        to: '2026-01-01T12:00:00.000Z',
      },
      records: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const feed = await fetchFeed(fakeUrl);
    expect(feed.records).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      fakeUrl,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Accept: 'application/json' });
  });

  it('does not make a request for an invalid URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchFeed(fakeUrl + '?secret=elsewhere')).rejects.toMatchObject({
      kind: 'invalid-url',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the official unavailable response without exposing response text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'feed_unavailable', message: 'private server response' },
          }),
          { status: 404 },
        ),
      ),
    );
    const request = fetchFeed(fakeUrl);
    await expect(request).rejects.toBeInstanceOf(FeedRequestError);
    await expect(request).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('recognizes unsupported schema versions', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ schema_version: 2 }), { status: 200 })),
    );
    await expect(fetchFeed(fakeUrl)).rejects.toMatchObject({
      kind: 'unsupported-schema',
      schemaVersion: 2,
    });
  });
});
