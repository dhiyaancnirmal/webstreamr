import { createTestContext } from '../test';
import { FetcherMock, TmdbId } from '../utils';
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
        title: 'Fight Club',
        original_title: 'Fight Club',
        release_date: '1999-10-15',
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://cdn.example.com/fight-club/master.m3u8?token=test',
      });

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([{
      url: new URL('https://cdn.example.com/fight-club/master.m3u8?token=test'),
      meta: {
        countryCodes: ['multi'],
        title: 'Fight Club (1999)',
      },
    }]);
    expect(json.mock.calls[1]?.[1].href).toBe('http://127.0.0.1:17860/api/test/550?source=vidapi');
  });

  test('fall back to the next provider and pass TV coordinates', async () => {
    const json = jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        name: 'Rick and Morty',
        original_name: 'Rick and Morty',
        first_air_date: '2013-12-02',
      })
      .mockRejectedValueOnce(new Error('vidapi unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://cdn.example.com/rick-and-morty/master.m3u8',
      });

    await expect(source.handleInternal(ctx, 'series', new TmdbId(60625, 5, 3))).resolves.toEqual([{
      url: new URL('https://cdn.example.com/rick-and-morty/master.m3u8'),
      meta: {
        countryCodes: ['multi'],
        title: 'Rick and Morty S05E03',
      },
    }]);
    expect(json.mock.calls[2]?.[1].searchParams.get('source')).toBe('vidrift');
    expect(json.mock.calls[2]?.[1].searchParams.get('season')).toBe('5');
    expect(json.mock.calls[2]?.[1].searchParams.get('episode')).toBe('3');
  });

  test('skip failed and unsupported responses', async () => {
    jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        title: 'Fight Club',
        original_title: 'Fight Club',
        release_date: '1999-10-15',
      })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, url: 'invalid' })
      .mockResolvedValueOnce({ ok: true, url: 'http://example.com/video.m3u8' });

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });
});
