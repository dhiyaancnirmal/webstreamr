import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { Source, SourceResult } from './Source';

interface ApiSource {
  file?: unknown;
  type?: unknown;
}

interface ApiResponse {
  sources?: unknown;
}

export class Vidsuper extends Source {
  public readonly id = 'vidsuper';

  public readonly label = 'Vidsuper';

  public override readonly ttl = 600000; // 10m

  public override readonly useOnlyWithMaxUrlsFound = 0;

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.multi];

  public readonly baseUrl = 'https://vidsuper.net';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();

    this.fetcher = fetcher;
  }

  public async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);
    const apiUrl = new URL('/api/sources', this.baseUrl);
    apiUrl.searchParams.set('id', `${tmdbId.id}`);
    apiUrl.searchParams.set('server', 'castle');
    if (tmdbId.season && tmdbId.episode) {
      apiUrl.searchParams.set('season', `${tmdbId.season}`);
      apiUrl.searchParams.set('episode', `${tmdbId.episode}`);
    }

    const response = await this.fetcher.json(ctx, apiUrl, {
      headers: {
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}/`,
      },
      noProxyHeaders: true,
    }) as ApiResponse;
    if (!Array.isArray(response.sources)) {
      return [];
    }

    for (const source of response.sources as ApiSource[]) {
      if (!source || typeof source !== 'object' || source.type !== 'hls' || typeof source.file !== 'string') {
        continue;
      }

      let url: URL;
      try {
        url = new URL(source.file);
      } catch {
        continue;
      }
      if (url.protocol !== 'https:' || !url.pathname.toLowerCase().endsWith('.m3u8')) {
        continue;
      }

      const title = tmdbId.season
        ? `${name} ${tmdbId.formatSeasonAndEpisode()}`
        : `${name} (${year})`;

      return [{
        url,
        meta: {
          countryCodes: [CountryCode.multi],
          title,
        },
      }];
    }

    return [];
  }
}
