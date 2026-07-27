import { createTestContext } from '../test';
import { FetcherMock, TmdbId } from '../utils';
import { Vidsuper } from './Vidsuper';

const ctx = createTestContext();

describe('Vidsuper', () => {
  let fetcher: FetcherMock;
  let source: Vidsuper;

  beforeEach(() => {
    fetcher = new FetcherMock(`${__dirname}/__fixtures__/Vidsuper`);
    source = new Vidsuper(fetcher);
  });

  test('return a movie HLS stream', async () => {
    const json = jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        title: 'Fight Club',
        original_title: 'Fight Club',
        release_date: '1999-10-15',
      })
      .mockResolvedValueOnce({
        sources: [{
          type: 'hls',
          file: 'https://img1.wnowe.com/path/index_308.m3u8',
        }],
      });

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([{
      url: new URL('https://img1.wnowe.com/path/index_308.m3u8'),
      meta: {
        countryCodes: ['multi'],
        title: 'Fight Club (1999)',
      },
    }]);
    expect(json.mock.calls[1]?.[1].href).toBe('https://vidsuper.net/api/sources?id=550&server=castle');
  });

  test('return a TV episode HLS stream', async () => {
    const json = jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        name: 'Rick and Morty',
        original_name: 'Rick and Morty',
        first_air_date: '2013-12-02',
      })
      .mockResolvedValueOnce({
        sources: [{
          type: 'hls',
          file: 'https://img1.bxncw.com/path/index_276.m3u8',
        }],
      });

    await expect(source.handleInternal(ctx, 'series', new TmdbId(60625, 5, 3))).resolves.toEqual([{
      url: new URL('https://img1.bxncw.com/path/index_276.m3u8'),
      meta: {
        countryCodes: ['multi'],
        title: 'Rick and Morty S05E03',
      },
    }]);
    expect(json.mock.calls[1]?.[1].searchParams.get('season')).toBe('5');
    expect(json.mock.calls[1]?.[1].searchParams.get('episode')).toBe('3');
  });

  test('skip malformed and unsupported sources', async () => {
    jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        title: 'Fight Club',
        original_title: 'Fight Club',
        release_date: '1999-10-15',
      })
      .mockResolvedValueOnce({
        sources: [
          null,
          { type: 'hls', file: 1 },
          { type: 'mp4', file: 'https://example.com/video.mp4' },
          { type: 'hls', file: 'invalid' },
          { type: 'hls', file: 'http://example.com/video.m3u8' },
          { type: 'hls', file: 'https://example.com/video' },
        ],
      });

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });

  test('return no stream for a malformed response', async () => {
    jest.spyOn(fetcher, 'json')
      .mockResolvedValueOnce({
        title: 'Fight Club',
        original_title: 'Fight Club',
        release_date: '1999-10-15',
      })
      .mockResolvedValueOnce({});

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });
});
