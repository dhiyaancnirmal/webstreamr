import { createTestContext } from '../test';
import { FetcherMock, ImdbId, TmdbId } from '../utils';
import { Zeroth } from './Zeroth';

const ctx = createTestContext();

const master1080 = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720/index.m3u8
`;

const master2160 = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=14000000,RESOLUTION=3840x2160
2160/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5500000,RESOLUTION=1920x1080
1080/index.m3u8
`;

const stableVod = `#EXTM3U
#EXTINF:6,
segment.ts
#EXT-X-ENDLIST
`;

describe('Zeroth', () => {
  let fetcher: FetcherMock;
  let adaptiveProvider: { handleInternal: jest.Mock };
  let source: Zeroth;

  beforeEach(() => {
    fetcher = new FetcherMock(`${__dirname}/__fixtures__/Zeroth`);
    adaptiveProvider = { handleInternal: jest.fn().mockResolvedValue([]) };
    source = new Zeroth(fetcher, 'http://127.0.0.1:17860', adaptiveProvider);
  });

  test('construct with the native adaptive provider by default', () => {
    expect(new Zeroth(fetcher, 'http://127.0.0.1:17860')).toBeInstanceOf(Zeroth);
  });

  test('rank the best adaptive master first and expose provider variants under aliases', async () => {
    const json = jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        meta: {
          moviedb_id: 550,
          name: 'Fight Club',
          releaseInfo: '1999',
        },
      })
      .mockResolvedValueOnce({
        'provider-a': {},
        'provider-b': {},
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://a.example.com/master.m3u8',
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://b.example.com/master.m3u8',
      });
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url) => {
      if (url.pathname === '/master.m3u8') {
        return url.hostname === 'a.example.com' ? master1080 : master2160;
      }

      return stableVod;
    });

    const results = await source.handleInternal(ctx, 'movie', new ImdbId('tt0137523', undefined, undefined));

    expect(results).toEqual([
      {
        url: new URL('https://b.example.com/master.m3u8'),
        meta: {
          adaptive: true,
          countryCodes: ['multi'],
          displayLabel: 'Zeroth',
          format: 'hls',
          height: 2160,
          priority: 10000,
          title: 'Fight Club (1999)',
        },
      },
      {
        url: new URL('https://b.example.com/2160/index.m3u8'),
        meta: {
          countryCodes: ['multi'],
          displayLabel: 'Alpha',
          format: 'hls',
          height: 2160,
          priority: 1000,
          title: 'Fight Club (1999)',
        },
      },
      {
        url: new URL('https://b.example.com/1080/index.m3u8'),
        meta: {
          countryCodes: ['multi'],
          displayLabel: 'Alpha',
          format: 'hls',
          height: 1080,
          priority: 1000,
          title: 'Fight Club (1999)',
        },
      },
      {
        url: new URL('https://a.example.com/1080/index.m3u8'),
        meta: {
          countryCodes: ['multi'],
          displayLabel: 'Bravo',
          format: 'hls',
          height: 1080,
          priority: 999,
          title: 'Fight Club (1999)',
        },
      },
      {
        url: new URL('https://a.example.com/720/index.m3u8'),
        meta: {
          countryCodes: ['multi'],
          displayLabel: 'Bravo',
          format: 'hls',
          height: 720,
          priority: 999,
          title: 'Fight Club (1999)',
        },
      },
    ]);
    expect(json.mock.calls[0]?.[1].href).toBe('https://v3-cinemeta.strem.io/meta/movie/tt0137523.json');
    expect(json.mock.calls[1]?.[1].href).toBe('http://127.0.0.1:17860/api/test');
  });

  test('include a fixed VOD provider and pass TV coordinates', async () => {
    const json = jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        meta: {
          moviedb_id: 60625,
          name: 'Rick and Morty',
          releaseInfo: '2013–',
        },
      })
      .mockResolvedValueOnce({
        'bad provider': {},
        'provider': {},
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://media.example.com/video/720/index.m3u8',
      });
    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(stableVod);

    await expect(source.handleInternal(ctx, 'series', new ImdbId('tt2861424', 5, 3))).resolves.toEqual([
      {
        url: new URL('https://media.example.com/video/720/index.m3u8'),
        meta: {
          countryCodes: ['multi'],
          displayLabel: 'Alpha',
          format: 'hls',
          height: 720,
          priority: 1000,
          title: 'Rick and Morty S05E03',
        },
      },
    ]);
    expect(json.mock.calls[0]?.[1].href).toBe('https://v3-cinemeta.strem.io/meta/series/tt2861424.json');
    expect(json.mock.calls[2]?.[1].searchParams.get('season')).toBe('5');
    expect(json.mock.calls[2]?.[1].searchParams.get('episode')).toBe('3');
  });

  test('skip failed and malformed provider responses', async () => {
    jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        first: {},
        fourth: {},
        second: {},
        third: {},
      })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, url: 'invalid' })
      .mockResolvedValueOnce({ ok: true, url: 'http://example.com/video.m3u8' });

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });

  test('skip unreachable and non-HLS provider media', async () => {
    jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        first: {},
        second: {},
      })
      .mockResolvedValueOnce({ ok: true, url: 'https://first.example.com/video.m3u8' })
      .mockResolvedValueOnce({ ok: true, url: 'https://second.example.com/video.mp4' });
    jest.spyOn(fetcher, 'text')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('not a playlist');

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });

  test('return verified candidates without waiting for a stalled provider', async () => {
    jest.useFakeTimers();
    try {
      let resolveStalled!: (value: { ok: boolean }) => void;
      const stalled = new Promise<{ ok: boolean }>((resolve) => {
        resolveStalled = resolve;
      });
      const json = jest.spyOn(fetcher, 'json')
        .mockResolvedValueOnce({
          fast: {},
          stalled: {},
          trailing: {},
        })
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://media.example.com/video/720/index.m3u8',
        })
        .mockImplementationOnce(async () => await stalled);
      jest.spyOn(fetcher, 'text').mockResolvedValueOnce(stableVod);

      const resultPromise = source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined));
      await jest.advanceTimersByTimeAsync(4000);

      await expect(resultPromise).resolves.toEqual([
        {
          url: new URL('https://media.example.com/video/720/index.m3u8'),
          meta: {
            countryCodes: ['multi'],
            displayLabel: 'Alpha',
            format: 'hls',
            height: 720,
            priority: 1000,
            title: 'TMDB 550',
          },
        },
      ]);
      resolveStalled({ ok: false });
      await Promise.resolve();
      await Promise.resolve();
      expect(json).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  test('do not overload fallback providers when the preferred lane succeeds', async () => {
    const json = jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        '1embed': {},
        'meowtv': {},
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://media.example.com/video/720/index.m3u8',
      });
    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(stableVod);

    const results = await source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined));

    expect(results).toHaveLength(1);
    expect(results[0]?.meta.displayLabel).toBe('Alpha');
    expect(json).toHaveBeenCalledTimes(2);
    expect(json.mock.calls[1]?.[1].searchParams.get('source')).toBe('meowtv');
  });

  test('deduplicate same-height variants by bandwidth and ignore malformed entries', async () => {
    jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({ provider: {} })
      .mockResolvedValueOnce({ ok: true, url: 'https://media.example.com/master.m3u8' });
    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1
missing-resolution.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x1080
# no variant
#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=1920x1080
http://[
#EXT-X-STREAM-INF:RESOLUTION=1920x1080
low.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=5000000,RESOLUTION=1920x1080
high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1920x1080
lower.m3u8
`).mockResolvedValue(stableVod);

    const results = await source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined));

    expect(results.map(result => result.url.href)).toEqual([
      'https://media.example.com/master.m3u8',
      'https://media.example.com/high.m3u8',
    ]);
  });

  test('rank ties by variant count and then provider alias', () => {
    interface TestCandidate {
      adaptiveSafe: boolean;
      provider: string;
      url: URL;
      variants: { bandwidth: number; height: number; url: URL }[];
    }
    const compareCandidates = (source as unknown as {
      compareCandidates: (left: TestCandidate, right: TestCandidate) => number;
    }).compareCandidates.bind(source);
    const variant = {
      bandwidth: 1,
      height: 1080,
      url: new URL('https://media.example.com/1080.m3u8'),
    };
    const alpha = {
      adaptiveSafe: false,
      provider: 'alpha',
      url: new URL('https://alpha.example.com/master.m3u8'),
      variants: [variant],
    };
    const bravo = {
      adaptiveSafe: false,
      provider: 'bravo',
      url: new URL('https://bravo.example.com/master.m3u8'),
      variants: [variant, { ...variant, height: 720 }],
    };

    expect(compareCandidates(alpha, bravo)).toBeGreaterThan(0);
    expect(compareCandidates(alpha, { ...alpha, provider: 'charlie' })).toBeLessThan(0);
    expect(compareCandidates(alpha, { ...alpha, adaptiveSafe: true })).toBeGreaterThan(0);
  });

  test('ignore a master entry without a following variant URL', () => {
    const parseVariants = (source as unknown as {
      parseVariants: (playlist: string, baseUrl: URL) => unknown[];
    }).parseVariants.bind(source);

    expect(parseVariants(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x1080',
      new URL('https://media.example.com/master.m3u8'),
    )).toEqual([]);
  });

  test('assign fallback aliases after the NATO alphabet', async () => {
    const providers = Object.fromEntries(
      Array.from({ length: 27 }, (_, index) => [`provider-${String(index).padStart(2, '0')}`, {}]),
    );
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url) => {
      if (url.pathname === '/api/test') {
        return providers;
      }

      const provider = url.searchParams.get('source') as string;
      const index = parseInt(provider.slice(-2));
      const path = index === 0 ? '/9999/index.m3u8' : '/video/index.m3u8';

      return {
        ok: true,
        url: `https://media-${index}.example.com${path}`,
      };
    });
    jest.spyOn(fetcher, 'text').mockResolvedValue(stableVod);

    const results = await source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined));

    expect(results).toHaveLength(27);
    expect(results[0]?.meta.displayLabel).toBe('Alpha');
    expect(results[0]?.meta.height).toBeUndefined();
    expect(results[26]?.meta.displayLabel).toBe('Source 27');
  });

  test('include the native adaptive provider through Zeroth with required request headers', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValueOnce({});
    adaptiveProvider.handleInternal.mockResolvedValueOnce([
      {
        url: new URL('https://native.example.com/master.m3u8'),
        meta: {
          countryCodes: ['multi'],
          referer: 'https://player.example.com/',
        },
      },
    ]);
    jest.spyOn(fetcher, 'text')
      .mockResolvedValueOnce(master1080)
      .mockResolvedValue(stableVod);

    const results = await source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined));

    expect(results[0]).toEqual({
      url: new URL('https://native.example.com/master.m3u8'),
      meta: {
        adaptive: true,
        countryCodes: ['multi'],
        displayLabel: 'Zeroth',
        format: 'hls',
        height: 1080,
        priority: 10000,
        referer: 'https://player.example.com/',
        title: 'TMDB 550',
      },
    });
    expect(results.slice(1).every(result => result.meta.referer === 'https://player.example.com/')).toBe(true);
  });

  test('exclude unstable renditions and do not advertise an unsafe Auto master', async () => {
    jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({ provider: {} })
      .mockResolvedValueOnce({ ok: true, url: 'https://media.example.com/master.m3u8' });
    jest.spyOn(fetcher, 'text')
      .mockResolvedValueOnce(master1080)
      .mockResolvedValueOnce(stableVod)
      .mockResolvedValueOnce(`#EXTM3U
#EXT-X-MEDIA-SEQUENCE:12
#EXTINF:6,
segment.ts
`);

    const results = await source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined));

    expect(results).toHaveLength(1);
    expect(results[0]?.meta.adaptive).toBeUndefined();
    expect(results[0]?.meta.height).toBe(1080);
  });

  test('reject live fixed playlists and masters without any reachable VOD rendition', async () => {
    jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({ first: {}, second: {} })
      .mockResolvedValueOnce({ ok: true, url: 'https://first.example.com/live.m3u8' })
      .mockResolvedValueOnce({ ok: true, url: 'https://second.example.com/master.m3u8' });
    jest.spyOn(fetcher, 'text')
      .mockResolvedValueOnce(`#EXTM3U
#EXT-X-MEDIA-SEQUENCE:12
#EXTINF:6,
segment.ts
`)
      .mockResolvedValueOnce(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080/index.m3u8
`)
      .mockRejectedValueOnce(new Error('variant unavailable'));

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });

  test('retain request headers for a fixed native-provider VOD', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValueOnce({});
    adaptiveProvider.handleInternal.mockResolvedValueOnce([
      {
        url: new URL('https://native.example.com/720/index.m3u8'),
        meta: {
          countryCodes: ['multi'],
          referer: 'https://player.example.com/',
        },
      },
    ]);
    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(stableVod);

    const results = await source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined));

    expect(results[0]?.meta.referer).toBe('https://player.example.com/');
  });

  test('continue without the native provider or resolver index when either fails', async () => {
    jest.spyOn(fetcher, 'json').mockRejectedValueOnce(new Error('resolver offline'));
    adaptiveProvider.handleInternal.mockRejectedValueOnce(new Error('native provider offline'));

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });

  test('return no streams for a malformed provider list', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValueOnce([]);

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });

  test('reject malformed Cinemeta metadata', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValueOnce({
      meta: {
        moviedb_id: '550',
        name: 'Fight Club',
      },
    });

    await expect(source.handleInternal(ctx, 'movie', new ImdbId('tt0137523', undefined, undefined)))
      .rejects.toThrow('Could not get Cinemeta metadata for IMDb ID "tt0137523"');
  });
});
