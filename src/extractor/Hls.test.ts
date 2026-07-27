import winston from 'winston';
import { createTestContext } from '../test';
import { Format } from '../types';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { Hls } from './Hls';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const extractorRegistry = new ExtractorRegistry(logger, [new Hls(new FetcherMock(`${__dirname}/__fixtures__/Hls`))]);

const ctx = createTestContext();

describe('Hls', () => {
  test('direct playlist', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://media.example.com/movie/master.m3u8'))).toMatchSnapshot();
  });

  test('source-declared playlist without a file extension', async () => {
    expect(await extractorRegistry.handle(
      ctx,
      new URL('https://media.example.com/api/proxy/hls'),
      {
        adaptive: true,
        displayLabel: 'Alpha',
        format: Format.hls,
        referer: 'https://source.example.com/',
      },
    )).toMatchSnapshot();
  });
});
