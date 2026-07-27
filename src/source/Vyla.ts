import { ContentType } from 'stremio-addon-sdk';
import { NotFoundError } from '../error';
import { Context, CountryCode } from '../types';
import { Fetcher, Id, TmdbId } from '../utils';
import { Source, SourceResult } from './Source';

interface CinemetaResponse {
  meta?: {
    moviedb_id?: unknown;
    name?: unknown;
    releaseInfo?: unknown;
  };
}

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
    const [tmdbId, name, year] = await this.getMetadata(ctx, id);

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
        : year ? `${name} (${year})` : name;

      return [{
        url,
        meta: {
          adaptive: true,
          countryCodes: [CountryCode.multi],
          title,
        },
      }];
    }

    return [];
  }

  private async getMetadata(ctx: Context, id: Id): Promise<[TmdbId, string, number | undefined]> {
    if (id instanceof TmdbId) {
      return [id, `TMDB ${id.id}`, undefined];
    }

    const type = id.season ? 'series' : 'movie';
    const metadataUrl = new URL(`/meta/${type}/${id.id}.json`, 'https://v3-cinemeta.strem.io');
    const response = await this.fetcher.json(ctx, metadataUrl, {
      noProxyHeaders: true,
      timeout: 8000,
    }) as CinemetaResponse;
    if (
      typeof response.meta?.moviedb_id !== 'number'
      || typeof response.meta.name !== 'string'
      || typeof response.meta.releaseInfo !== 'string'
    ) {
      throw new NotFoundError(`Could not get Cinemeta metadata for IMDb ID "${id.id}"`);
    }

    return [
      new TmdbId(response.meta.moviedb_id, id.season, id.episode),
      response.meta.name,
      parseInt(response.meta.releaseInfo.slice(0, 4)),
    ];
  }
}
