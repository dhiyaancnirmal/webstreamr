import { createTestContext } from '../test';
import { FetcherMock, ImdbId, TmdbId } from '../utils';
import { Vyla } from './Vyla';

const ctx = createTestContext();

describe('Vyla', () => {
  let fetcher: FetcherMock;
  let source: Vyla;

  beforeEach(() => {
    fetcher = new FetcherMock(`${__dirname}/__fixtures__/Vyla`);
    source = new Vyla(fetcher, 'http://127.0.0.1:17860');
  });

  test('return the first verified adaptive movie stream', async () => {
    const json = jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        meta: {
          moviedb_id: 550,
          name: 'Fight Club',
          releaseInfo: '1999',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://cdn.example.com/fight-club/master.m3u8?token=test',
      });

    await expect(source.handleInternal(ctx, 'movie', new ImdbId('tt0137523', undefined, undefined))).resolves.toEqual([{
      url: new URL('https://cdn.example.com/fight-club/master.m3u8?token=test'),
      meta: {
        adaptive: true,
        countryCodes: ['multi'],
        format: 'hls',
        title: 'Fight Club (1999)',
      },
    }]);
    expect(json.mock.calls[0]?.[1].href).toBe('https://v3-cinemeta.strem.io/meta/movie/tt0137523.json');
    expect(json.mock.calls[1]?.[1].href).toBe('http://127.0.0.1:17860/api/test/550?source=vidapi');
  });

  test('fall back to the next provider and pass TV coordinates', async () => {
    const json = jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        meta: {
          moviedb_id: 60625,
          name: 'Rick and Morty',
          releaseInfo: '2013–',
        },
      })
      .mockRejectedValueOnce(new Error('vidapi unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://embed.vidrift.in/api/proxy/hls?token=test',
      });

    await expect(source.handleInternal(ctx, 'series', new ImdbId('tt2861424', 5, 3))).resolves.toEqual([{
      url: new URL('https://embed.vidrift.in/api/proxy/hls?token=test'),
      meta: {
        adaptive: true,
        countryCodes: ['multi'],
        format: 'hls',
        title: 'Rick and Morty S05E03',
      },
    }]);
    expect(json.mock.calls[0]?.[1].href).toBe('https://v3-cinemeta.strem.io/meta/series/tt2861424.json');
    expect(json.mock.calls[2]?.[1].searchParams.get('source')).toBe('vidrift');
    expect(json.mock.calls[2]?.[1].searchParams.get('season')).toBe('5');
    expect(json.mock.calls[2]?.[1].searchParams.get('episode')).toBe('3');
  });

  test('skip failed and unsupported responses', async () => {
    jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, url: 'invalid' })
      .mockResolvedValueOnce({ ok: true, url: 'http://example.com/video.m3u8' });

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });

  test('accept a direct TMDB ID without external metadata', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValueOnce({
      ok: true,
      url: 'https://cdn.example.com/direct/master.m3u8',
    });

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([{
      url: new URL('https://cdn.example.com/direct/master.m3u8'),
      meta: {
        adaptive: true,
        countryCodes: ['multi'],
        format: 'hls',
        title: 'TMDB 550',
      },
    }]);
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
