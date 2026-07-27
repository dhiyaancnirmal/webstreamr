import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { Source, SourceResult } from './Source';

interface VylaTestResponse {
  ok?: unknown;
  url?: unknown;
}

const PROVIDERS = ['vidapi', 'vidrift', 'vidup'] as const;

export class Vyla extends Source {
  public readonly id = 'vyla';

  public readonly label = 'Vyla';

  public override readonly ttl = 600000; // 10m

  public override readonly useOnlyWithMaxUrlsFound = 0;

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.multi];

  public readonly baseUrl: string;

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher, baseUrl: string) {
    super();

    this.fetcher = fetcher;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public async handleInternal(ctx: Context, _type: ContentType, id: Id): Promise<SourceResult[]> {
    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);

    for (const provider of PROVIDERS) {
      const apiUrl = new URL(`/api/test/${tmdbId.id}`, `${this.baseUrl}/`);
      apiUrl.searchParams.set('source', provider);
      if (tmdbId.season && tmdbId.episode) {
        apiUrl.searchParams.set('season', `${tmdbId.season}`);
        apiUrl.searchParams.set('episode', `${tmdbId.episode}`);
      }

      let response: VylaTestResponse;
      try {
        response = await this.fetcher.json(ctx, apiUrl, {
          noProxyHeaders: true,
          timeout: 12000,
        }) as VylaTestResponse;
      } catch {
        continue;
      }
      if (response.ok !== true || typeof response.url !== 'string') {
        continue;
      }

      let url: URL;
      try {
        url = new URL(response.url);
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
