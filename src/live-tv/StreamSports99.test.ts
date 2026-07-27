import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { StreamSports99 } from './StreamSports99';

const ctx = createTestContext();

describe('StreamSports99', () => {
  let fetcher: FetcherMock;
  let service: StreamSports99;

  beforeEach(() => {
    fetcher = new FetcherMock(`${__dirname}/__fixtures__/StreamSports99`);
    service = new StreamSports99(fetcher);
  });

  test('list live channels and resolve a player stream', async () => {
    const channels = await service.getChannels(ctx);
    const channel = channels[0] as (typeof channels)[number];
    const id = service.encodeId(channel);

    expect(channels.length).toBeGreaterThan(100);
    expect(channels).toEqual([...channels].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code)));
    expect(service.decodeId(id)).toEqual({ name: channel.name, code: channel.code });
    expect(service.toMetaPreview(channel)).toMatchSnapshot();
    await expect(service.getMeta(ctx, id)).resolves.toEqual(service.toMetaPreview(channel));
    await expect(service.getStreamUrl(ctx, id)).resolves.toMatchObject({
      protocol: 'https:',
      hostname: expect.stringMatching(/cdnlivetv\.is$/),
      pathname: expect.stringMatching(/\/playlist\.m3u8$/),
    });
  });

  test('filter malformed and offline channels and sort duplicate names by code', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({
      channels: [
        { name: 'Same', code: 'z', image: '', status: 'online' },
        { name: 'Same', code: 'a', status: 'online' },
        { name: 'Offline', code: 'off', status: 'offline' },
        { name: '', code: 'empty', status: 'online' },
        { name: 1, code: 'bad', status: 'online' },
        { name: 'Bad code', code: 1, status: 'online' },
      ],
    });

    await expect(service.getChannels(ctx)).resolves.toEqual([
      { name: 'Same', code: 'a' },
      { name: 'Same', code: 'z' },
    ]);
  });

  test('return no channels for a malformed response', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({});

    await expect(service.getChannels(ctx)).resolves.toEqual([]);
  });

  test('include images and omit an empty code suffix', () => {
    expect(service.toMetaPreview({ name: 'Channel', code: '', image: 'https://example.com/poster.png' })).toEqual({
      id: service.encodeId({ name: 'Channel', code: '' }),
      type: 'tv',
      name: 'Channel',
      poster: 'https://example.com/poster.png',
      posterShape: 'square',
      description: 'Live television from StreamSports99',
    });
  });

  test.each([
    'wrong-prefix',
    'ss99:not-json',
    `ss99:${Buffer.from('null').toString('base64url')}`,
    `ss99:${Buffer.from('{}').toString('base64url')}`,
    `ss99:${Buffer.from('{"name":"","code":""}').toString('base64url')}`,
    `ss99:${Buffer.from('{"name":"Channel","code":1}').toString('base64url')}`,
  ])('reject invalid channel ID %s', (id) => {
    expect(() => service.decodeId(id)).toThrow('Invalid StreamSports99 channel ID.');
  });

  test('reject a channel that is no longer listed', async () => {
    jest.spyOn(fetcher, 'json').mockResolvedValue({ channels: [] });
    const id = service.encodeId({ name: 'Missing', code: 'missing' });

    await expect(service.getMeta(ctx, id)).rejects.toThrow('Unknown StreamSports99 channel');
  });

  test.each([
    ['', 'did not contain an HLS source'],
    [`source: { src: stream, format: 'hls' }`, 'HLS source was incomplete'],
    [`var stream = plain; source: { src: stream, format: 'hls' }`, 'HLS source had no URL fragments'],
    [`var stream = decode(fragment); source: { src: stream, format: 'hls' }`, 'invalid URL fragment'],
  ])('reject malformed player HTML', async (html, message) => {
    jest.spyOn(fetcher, 'text').mockResolvedValue(html);
    const id = service.encodeId({ name: 'Channel', code: 'channel' });

    await expect(service.getStreamUrl(ctx, id)).rejects.toThrow(message);
  });

  test.each([
    'http://cdnlivetv.is/channel/playlist.m3u8',
    'https://example.com/channel/playlist.m3u8',
    'https://cdnlivetv.is/channel/video.m3u8',
  ])('reject unsupported stream URL %s', async (url) => {
    const encoded = Buffer.from(url).toString('base64url');
    jest.spyOn(fetcher, 'text').mockResolvedValue(
      `var fragment = '${encoded}'; var stream = decode(fragment); source: { src: stream, format: 'hls' }`,
    );
    const id = service.encodeId({ name: 'Channel', code: 'channel' });

    await expect(service.getStreamUrl(ctx, id)).rejects.toThrow('unsupported HLS URL');
  });
});
