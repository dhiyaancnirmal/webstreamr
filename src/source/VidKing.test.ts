import { NotFoundError } from '../error';
import { createTestContext } from '../test';
import { FetcherMock, ImdbId, TmdbId } from '../utils';
import { decryptVidKingPayload, VidKing } from './VidKing';

const ctx = createTestContext();
const now = 1785141418704;

describe('VidKing', () => {
  let fetcher: FetcherMock;
  let source: VidKing;

  beforeEach(() => {
    fetcher = new FetcherMock(`${__dirname}/__fixtures__/VidKing`);
    source = new VidKing(fetcher, () => now);
  });

  test('handle imdb movie', async () => {
    const streams = await source.handleInternal(ctx, 'movie', new ImdbId('tt0137523', undefined, undefined));
    expect(streams).toMatchSnapshot();
  });

  test('handle imdb series', async () => {
    const streams = await source.handleInternal(ctx, 'series', new ImdbId('tt2085059', 4, 2));
    expect(streams).toMatchSnapshot();
  });

  test('reject invalid encrypted payload', () => {
    expect(() => decryptVidKingPayload('invalid', 'seed', 550)).toThrow('Could not decrypt VidKing source response.');
  });

  test('handle metadata without a title', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({});

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });

  test('handle missing IMDb match', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({ movie_results: [], tv_results: [] });

    await expect(source.handleInternal(ctx, 'movie', new ImdbId('tt0000000', undefined, undefined)))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  test('fall back to the next server and omit an unknown quality', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({ title: 'No Date' });
    const fetchSources = jest.fn()
      .mockRejectedValueOnce(new Error('Yoru failed'))
      .mockResolvedValueOnce({
        sources: [
          {},
          { url: 'https://media.example.com/video.m3u8' },
          { quality: '1080', url: 'https://media.example.com/video.mp4' },
        ],
      });
    (source as unknown as { fetchSources: typeof fetchSources }).fetchSources = fetchSources;

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([
      {
        url: new URL('https://media.example.com/video.m3u8'),
        meta: {
          countryCodes: ['multi'],
          referer: 'https://www.vidking.net/',
          title: 'No Date · Breach',
        },
      },
    ]);
  });

  test('keep multiple streams when VidKing does not expose a native adaptive playlist', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({ title: 'Unknown layout' });
    const fetchSources = jest.fn().mockResolvedValue({
      sources: [
        { quality: '1080', url: 'https://media.example.com/first.m3u8' },
        { quality: '720', url: 'https://media.example.com/second.m3u8' },
      ],
    });
    (source as unknown as { fetchSources: typeof fetchSources }).fetchSources = fetchSources;

    const streams = await source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined));

    expect(streams.map(stream => stream.url.href)).toEqual([
      'https://media.example.com/first.m3u8',
      'https://media.example.com/second.m3u8',
    ]);
  });

  test('keep renditions when they do not share one native adaptive playlist', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({ title: 'Different masters' });
    const fetchSources = jest.fn().mockResolvedValue({
      sources: [
        { quality: '1080', url: 'https://media.example.com/first/index-s1080p-v1-a1.m3u8' },
        { quality: '720', url: 'https://media.example.com/second/index-s720p-v1-a1.m3u8' },
      ],
    });
    (source as unknown as { fetchSources: typeof fetchSources }).fetchSources = fetchSources;

    const streams = await source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined));

    expect(streams).toHaveLength(2);
    expect(streams.every(stream => !stream.meta.adaptive)).toBe(true);
  });

  test('throw after all servers fail', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({ title: 'Failure' });
    const error = new Error('All servers failed');
    const fetchSources = jest.fn().mockRejectedValue(error);
    (source as unknown as { fetchSources: typeof fetchSources }).fetchSources = fetchSources;

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).rejects.toBe(error);
  });

  test('return no streams when every server has no HLS source', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({ title: 'Empty' });
    const fetchSources = jest.fn().mockResolvedValue({});
    (source as unknown as { fetchSources: typeof fetchSources }).fetchSources = fetchSources;

    await expect(source.handleInternal(ctx, 'movie', new TmdbId(550, undefined, undefined))).resolves.toEqual([]);
  });

  test('send an empty IMDb ID when metadata does not include one', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({ seed: 'seed' });
    const text = jest.spyOn(fetcher, 'text').mockResolvedValue('invalid');
    type FetchSources = (
      context: typeof ctx,
      server: { endpoint: string; name: string },
      tmdbId: TmdbId,
      mediaType: 'movie' | 'tv',
      title: string,
      year: number | '',
      imdbId?: string,
    ) => Promise<unknown>;
    const fetchSources = (source as unknown as { fetchSources: FetchSources }).fetchSources.bind(source);

    await expect(fetchSources(
      ctx,
      { endpoint: 'cdn/sources-with-title', name: 'Yoru' },
      new TmdbId(550, undefined, undefined),
      'movie',
      'Fight Club',
      1999,
    )).rejects.toThrow('Could not decrypt VidKing source response.');
    expect(text.mock.calls[0]?.[1].searchParams.get('imdbId')).toBe('');
  });
});
