import { ContentType } from 'stremio-addon-sdk';
import { NotFoundError } from '../error';
import { Context, CountryCode } from '../types';
import { Fetcher, Id, TmdbId } from '../utils';
import { Source, SourceResult } from './Source';

interface FindResponse {
  movie_results: { id: number }[];
  tv_results: { id: number }[];
}

interface MetadataResponse {
  external_ids?: {
    imdb_id?: string;
  };
  first_air_date?: string;
  name?: string;
  release_date?: string;
  title?: string;
}

interface SeedResponse {
  seed: string;
}

interface SourceApiResponse {
  sources?: {
    quality?: string;
    type?: string;
    url?: string;
  }[];
}

interface Server {
  endpoint: string;
  name: string;
}

const SOURCE_API_URL = 'https://api.speedracelight.com';
const METADATA_API_URL = 'https://db.speedracelight.com/3/';

const SERVERS: Server[] = [
  { name: 'Yoru', endpoint: 'cdn/sources-with-title' },
  { name: 'Breach', endpoint: 'm4uhd/sources-with-title' },
  { name: 'Neon', endpoint: 'vsrc/sources-with-title' },
  { name: 'Omen', endpoint: 'lamovie/sources-with-title' },
  { name: 'Raze', endpoint: 'superflix/sources-with-title' },
];

const STATE_SIZE = 61;
const MIX_ROUNDS = 8;
const GOLDEN_RATIO = 2654435769;
const PAYLOAD_PREFIX = Buffer.from('mvm1');

interface CipherState {
  values: number[];
  accumulator: number;
}

const mix32 = (value: number): number => {
  value >>>= 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2246822507) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 3266489909) >>> 0;
  value ^= value >>> 16;

  return value >>> 0;
};

const rotateLeft = (value: number, count: number): number => {
  value >>>= 0;
  count &= 31;

  return count === 0 ? value : (value << count | value >>> (32 - count)) >>> 0;
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  }

  return mix32(hash);
};

const createCipherState = (seed: string, mediaId: number): CipherState => {
  const values = new Array<number>(STATE_SIZE);
  let accumulator = mix32(hashString(seed) ^ mix32((mediaId >>> 0 ^ GOLDEN_RATIO) >>> 0)) >>> 0;

  for (let round = 0; round < MIX_ROUNDS; round++) {
    const index = accumulator % STATE_SIZE;
    accumulator = rotateLeft((accumulator + GOLDEN_RATIO) >>> 0, 7 + (round & 7));
    values[index] = (accumulator ^ mix32(accumulator)) >>> 0;
    accumulator = mix32((accumulator + index) >>> 0);
  }

  return {
    values,
    accumulator: mix32(accumulator ^ 2779096485) >>> 0,
  };
};

const nextCipherWord = (state: CipherState, wordIndex: number): number => {
  const index = state.accumulator % STATE_SIZE;
  const presentMask = 0 - Number(index in state.values);
  const value = (state.values[index] ?? 0) >>> 0;
  const delta = Math.imul(GOLDEN_RATIO, wordIndex + 1) >>> 0;
  let mixed = ((state.accumulator ^ (value ^ delta)) >>> 0 | (state.accumulator & (value ^ delta) & presentMask) >>> 0) >>> 0;

  mixed = (rotateLeft((mixed + state.accumulator) >>> 0, index & 31)
    ^ rotateLeft(state.accumulator, Math.imul(index, 7) & 31)) >>> 0;

  state.accumulator = mix32((mixed + GOLDEN_RATIO) >>> 0);
  state.values[index] = state.accumulator;

  return state.accumulator;
};

const createKeyStream = (seed: string, mediaId: number, length: number): Uint8Array => {
  const state = createCipherState(seed, mediaId);
  const stream = new Uint8Array(length);
  let byteIndex = 0;
  let wordIndex = 0;

  while (byteIndex < length) {
    const word = nextCipherWord(state, wordIndex++);
    stream[byteIndex++] = word & 255;
    if (byteIndex < length) {
      stream[byteIndex++] = word >>> 8 & 255;
    }
    if (byteIndex < length) {
      stream[byteIndex++] = word >>> 16 & 255;
    }
    if (byteIndex < length) {
      stream[byteIndex++] = word >>> 24 & 255;
    }
  }

  return stream;
};

export const decryptVidKingPayload = (payload: string, seed: string, mediaId: number): string => {
  const bytes = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const keyStream = createKeyStream(seed, mediaId, bytes.length);

  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = (bytes[index] as number) ^ (keyStream[index] as number);
  }

  if (!bytes.subarray(0, PAYLOAD_PREFIX.length).equals(PAYLOAD_PREFIX)) {
    throw new Error('Could not decrypt VidKing source response.');
  }

  return bytes.subarray(PAYLOAD_PREFIX.length).toString('utf8');
};

export class VidKing extends Source {
  public readonly id = 'vidking';

  public readonly label = 'VidKing';

  public override readonly ttl = 600000; // 10m

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.multi];

  public readonly baseUrl = 'https://www.vidking.net';

  public override readonly priority = 2;

  private readonly fetcher: Fetcher;

  private readonly now: () => number;

  public constructor(fetcher: Fetcher, now: () => number = Date.now) {
    super();
    this.fetcher = fetcher;
    this.now = now;
  }

  public async handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]> {
    const tmdbId = await this.getTmdbId(ctx, type, id);
    const mediaType = type === 'series' ? 'tv' : 'movie';
    const metadata = await this.fetcher.json(
      ctx,
      new URL(`${mediaType}/${tmdbId.id}?append_to_response=external_ids`, METADATA_API_URL),
      { noProxyHeaders: true },
    ) as MetadataResponse;

    const title = mediaType === 'movie' ? metadata.title : metadata.name;
    const date = mediaType === 'movie' ? metadata.release_date : metadata.first_air_date;
    if (!title) {
      return [];
    }

    const year = date ? new Date(date).getFullYear() : '';
    let lastError: unknown;

    for (const server of SERVERS) {
      try {
        const response = await this.fetchSources(ctx, server, tmdbId, mediaType, title, year, metadata.external_ids?.imdb_id);
        const results = (response.sources ?? [])
          .filter(source => source.url?.toLowerCase().includes('.m3u8'))
          .map((source) => {
            const height = parseInt(source.quality ?? '');

            return {
              url: new URL(source.url as string),
              meta: {
                countryCodes: [CountryCode.multi],
                ...(!isNaN(height) && { height }),
                title: `${title}${tmdbId.season ? ` ${tmdbId.formatSeasonAndEpisode()}` : year ? ` (${year})` : ''} · ${server.name}`,
              },
            };
          });

        if (results.length) {
          return results;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  };

  private async getTmdbId(ctx: Context, type: ContentType, id: Id): Promise<TmdbId> {
    if (id instanceof TmdbId) {
      return id;
    }

    const response = await this.fetcher.json(
      ctx,
      new URL(`find/${id.id}?external_source=imdb_id`, METADATA_API_URL),
      { noProxyHeaders: true },
    ) as FindResponse;
    const result = type === 'series' ? response.tv_results[0] : response.movie_results[0];

    if (!result) {
      throw new NotFoundError(`Could not get TMDB ID of IMDb ID "${id.id}"`);
    }

    return new TmdbId(result.id, id.season, id.episode);
  }

  private async fetchSources(
    ctx: Context,
    server: Server,
    tmdbId: TmdbId,
    mediaType: 'movie' | 'tv',
    title: string,
    year: number | '',
    imdbId?: string,
  ): Promise<SourceApiResponse> {
    const seedResponse = await this.fetcher.json(
      ctx,
      new URL(`/seed?mediaId=${tmdbId.id}`, SOURCE_API_URL),
      {
        headers: {
          Origin: this.baseUrl,
          Referer: `${this.baseUrl}/`,
        },
        noProxyHeaders: true,
      },
    ) as SeedResponse;

    const url = new URL(`/${server.endpoint}`, SOURCE_API_URL);
    url.searchParams.set('title', title);
    url.searchParams.set('mediaType', mediaType);
    url.searchParams.set('year', `${year}`);
    url.searchParams.set('episodeId', `${tmdbId.episode ?? 1}`);
    url.searchParams.set('seasonId', `${tmdbId.season ?? 1}`);
    url.searchParams.set('tmdbId', `${tmdbId.id}`);
    url.searchParams.set('imdbId', imdbId ?? '');
    url.searchParams.set('enc', '2');
    url.searchParams.set('seed', seedResponse.seed);
    url.searchParams.set('_t', `${this.now()}`);

    const encryptedPayload = await this.fetcher.text(ctx, url, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Expires': '0',
        'Origin': this.baseUrl,
        'Pragma': 'no-cache',
        'Referer': `${this.baseUrl}/`,
      },
      noProxyHeaders: true,
    });

    return JSON.parse(decryptVidKingPayload(encryptedPayload, seedResponse.seed, tmdbId.id)) as SourceApiResponse;
  }
}
