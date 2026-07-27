import { ContentType } from 'stremio-addon-sdk';
import { NotFoundError } from '../error';
import { Context, CountryCode, Format } from '../types';
import { Fetcher, Id, TmdbId } from '../utils';
import { Source, SourceResult } from './Source';
import { VidKing } from './VidKing';

interface CinemetaResponse {
  meta?: {
    moviedb_id?: unknown;
    name?: unknown;
    releaseInfo?: unknown;
  };
}

interface ResolverResponse {
  ok?: unknown;
  url?: unknown;
}

interface Variant {
  bandwidth: number;
  height: number;
  url: URL;
}

interface RawCandidate {
  provider: string;
  referer?: string;
  url: URL;
}

interface Candidate extends RawCandidate {
  adaptiveSafe: boolean;
  variants: Variant[];
}

interface AdaptiveProvider {
  handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]>;
}

const PROVIDER_ALIASES = [
  'Alpha',
  'Bravo',
  'Charlie',
  'Delta',
  'Echo',
  'Foxtrot',
  'Golf',
  'Hotel',
  'India',
  'Juliett',
  'Kilo',
  'Lima',
  'Mike',
  'November',
  'Oscar',
  'Papa',
  'Quebec',
  'Romeo',
  'Sierra',
  'Tango',
  'Uniform',
  'Victor',
  'Whiskey',
  'X-ray',
  'Yankee',
  'Zulu',
] as const;

const PREFERRED_PROVIDERS = new Set([
  'meowtv',
  'vidapi',
  'vidcore',
  'vidfast',
  'vidrift',
  'vidup',
  'vixsrc',
]);
const PROVIDER_INDEX_TIMEOUT = 1500;
const PROVIDER_RESOLVE_TIMEOUT = 1500;
const PLAYLIST_TIMEOUT = 2000;
const CANDIDATE_COLLECTION_TIMEOUT = 4000;
const ADAPTIVE_SETTLE_WINDOW = 500;

export class Zeroth extends Source {
  public readonly id = 'zeroth';

  public readonly label = 'Zeroth';

  public override readonly ttl = 600000; // 10m

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.multi];

  public readonly baseUrl: string;

  private readonly fetcher: Fetcher;

  private readonly adaptiveProvider: AdaptiveProvider;

  public constructor(fetcher: Fetcher, baseUrl: string, adaptiveProvider: AdaptiveProvider = new VidKing(fetcher)) {
    super();

    this.fetcher = fetcher;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.adaptiveProvider = adaptiveProvider;
  }

  public async handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]> {
    const [tmdbId, name, year] = await this.getMetadata(ctx, id);
    const title = tmdbId.season
      ? `${name} ${tmdbId.formatSeasonAndEpisode()}`
      : year ? `${name} (${year})` : name;

    let providerList: unknown;
    try {
      providerList = await this.fetcher.json(ctx, new URL('/api/test', `${this.baseUrl}/`), {
        noProxyHeaders: true,
        timeout: PROVIDER_INDEX_TIMEOUT,
      }) as unknown;
    } catch {
      providerList = {};
    }

    const providers = providerList && typeof providerList === 'object' && !Array.isArray(providerList)
      ? Object.keys(providerList)
          .filter(provider => /^[a-z0-9-]+$/.test(provider))
          .sort()
      : [];
    const preferredProviders = providers.filter(provider => PREFERRED_PROVIDERS.has(provider));
    const fallbackProviders = providers.filter(provider => !PREFERRED_PROVIDERS.has(provider));
    const adaptiveProviderTask = (async (): Promise<Candidate[]> => {
      const resolvedCandidates = await this.resolveAdaptiveProvider(ctx, type, id);

      return (await Promise.all(resolvedCandidates.map(candidate => this.inspectCandidate(ctx, candidate))))
        .filter((candidate): candidate is Candidate => candidate !== undefined);
    })();
    let candidates = await this.collectCandidates([
      ...this.createProviderTasks(ctx, tmdbId, preferredProviders),
      adaptiveProviderTask,
    ]);
    if (!candidates.length) {
      candidates = await this.collectCandidates(this.createProviderTasks(ctx, tmdbId, fallbackProviders));
    }
    candidates
      .sort((left, right) => this.compareCandidates(left, right));

    if (!candidates.length) {
      return [];
    }

    const results: SourceResult[] = [];
    const adaptiveCandidate = candidates.find(candidate => candidate.adaptiveSafe);
    if (adaptiveCandidate) {
      results.push({
        url: adaptiveCandidate.url,
        meta: {
          adaptive: true,
          countryCodes: [CountryCode.multi],
          displayLabel: this.label,
          format: Format.hls,
          height: this.getMaxHeight(adaptiveCandidate),
          priority: 10000,
          ...(adaptiveCandidate.referer && { referer: adaptiveCandidate.referer }),
          title,
        },
      });
    }

    candidates.forEach((candidate, candidateIndex) => {
      const displayLabel = PROVIDER_ALIASES[candidateIndex] ?? `Source ${candidateIndex + 1}`;
      const priority = 1000 - candidateIndex;
      const variants = this.dedupeVariantsByHeight(candidate.variants);

      if (!variants.length) {
        results.push({
          url: candidate.url,
          meta: {
            countryCodes: [CountryCode.multi],
            displayLabel,
            format: Format.hls,
            height: this.inferHeight(candidate.url),
            priority,
            ...(candidate.referer && { referer: candidate.referer }),
            title,
          },
        });
        return;
      }

      variants.forEach((variant) => {
        results.push({
          url: variant.url,
          meta: {
            countryCodes: [CountryCode.multi],
            displayLabel,
            format: Format.hls,
            height: variant.height,
            priority,
            ...(candidate.referer && { referer: candidate.referer }),
            title,
          },
        });
      });
    });

    return results;
  }

  private createProviderTasks(
    ctx: Context,
    tmdbId: TmdbId,
    providers: string[],
  ): Promise<Candidate[]>[] {
    return providers.map(async (provider): Promise<Candidate[]> => {
      const resolvedCandidate = await this.resolveProvider(ctx, tmdbId, provider);
      if (!resolvedCandidate) {
        return [];
      }

      const candidate = await this.inspectCandidate(ctx, resolvedCandidate);

      return candidate ? [candidate] : [];
    });
  }

  private async resolveProvider(
    ctx: Context,
    tmdbId: TmdbId,
    provider: string,
  ): Promise<RawCandidate | undefined> {
    const apiUrl = new URL(`/api/test/${tmdbId.id}`, `${this.baseUrl}/`);
    apiUrl.searchParams.set('source', provider);
    if (tmdbId.season && tmdbId.episode) {
      apiUrl.searchParams.set('season', `${tmdbId.season}`);
      apiUrl.searchParams.set('episode', `${tmdbId.episode}`);
    }

    let response: ResolverResponse;
    try {
      response = await this.fetcher.json(ctx, apiUrl, {
        noProxyHeaders: true,
        timeout: PROVIDER_RESOLVE_TIMEOUT,
      }) as ResolverResponse;
    } catch {
      return undefined;
    }
    if (response.ok !== true || typeof response.url !== 'string') {
      return undefined;
    }

    let url: URL;
    try {
      url = new URL(response.url);
    } catch {
      return undefined;
    }
    if (url.protocol !== 'https:') {
      return undefined;
    }

    return { provider, url };
  }

  private async resolveAdaptiveProvider(
    ctx: Context,
    type: ContentType,
    id: Id,
  ): Promise<RawCandidate[]> {
    try {
      return (await this.adaptiveProvider.handleInternal(ctx, type, id)).map((result, index) => ({
        provider: `native-${index}`,
        ...(result.meta.referer && { referer: result.meta.referer }),
        url: result.url,
      }));
    } catch {
      return [];
    }
  }

  private async inspectCandidate(
    ctx: Context,
    candidate: RawCandidate,
  ): Promise<Candidate | undefined> {
    let playlist: string;
    try {
      playlist = await this.fetcher.text(ctx, candidate.url, {
        noProxyHeaders: true,
        timeout: PLAYLIST_TIMEOUT,
      });
    } catch {
      return undefined;
    }
    if (!playlist.trimStart().startsWith('#EXTM3U')) {
      return undefined;
    }

    const variants = this.parseVariants(playlist, candidate.url);
    if (!variants.length) {
      return this.isStableVodPlaylist(playlist)
        ? { ...candidate, adaptiveSafe: false, variants: [] }
        : undefined;
    }

    const verifiedVariants = (await Promise.all(
      variants.map(async variant => await this.isStableVodVariant(ctx, variant, candidate.referer)),
    )).filter((variant): variant is Variant => variant !== undefined);
    if (!verifiedVariants.length) {
      return undefined;
    }

    return {
      ...candidate,
      adaptiveSafe: verifiedVariants.length === variants.length,
      variants: verifiedVariants,
    };
  }

  private async isStableVodVariant(
    ctx: Context,
    variant: Variant,
    referer?: string,
  ): Promise<Variant | undefined> {
    try {
      const playlist = await this.fetcher.text(ctx, variant.url, {
        ...(referer && { headers: { Referer: referer } }),
        noProxyHeaders: true,
        timeout: PLAYLIST_TIMEOUT,
      });

      return this.isStableVodPlaylist(playlist) ? variant : undefined;
    } catch {
      return undefined;
    }
  }

  private isStableVodPlaylist(playlist: string): boolean {
    return playlist.trimStart().startsWith('#EXTM3U')
      && playlist.includes('#EXT-X-ENDLIST');
  }

  private async collectCandidates(tasks: Promise<Candidate[]>[]): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    let timeout!: ReturnType<typeof setTimeout>;
    let resolveAdaptiveCandidate!: () => void;
    const adaptiveCandidate = new Promise<void>((resolve) => {
      resolveAdaptiveCandidate = resolve;
    });
    const settled = Promise.allSettled(tasks.map(async (task) => {
      const taskCandidates = await task;
      candidates.push(...taskCandidates);
      if (taskCandidates.some(candidate => candidate.adaptiveSafe)) {
        resolveAdaptiveCandidate();
      }
    }));
    const deadline = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, CANDIDATE_COLLECTION_TIMEOUT);
    });
    const adaptiveSettleWindow = adaptiveCandidate.then(async () => await new Promise<void>((resolve) => {
      setTimeout(resolve, ADAPTIVE_SETTLE_WINDOW);
    }));

    await Promise.race([settled, deadline, adaptiveSettleWindow]);
    clearTimeout(timeout);

    return [...candidates];
  }

  private parseVariants(playlist: string, baseUrl: URL): Variant[] {
    const lines = playlist.split(/\r?\n/);
    const variants: Variant[] = [];

    for (let index = 0; index < lines.length; index++) {
      const line = (lines[index] as string).trim();
      if (!line.startsWith('#EXT-X-STREAM-INF:')) {
        continue;
      }

      const resolution = /RESOLUTION=\d+x(\d+)/i.exec(line);
      if (!resolution?.[1]) {
        continue;
      }
      const bandwidth = /(?:AVERAGE-)?BANDWIDTH=(\d+)/i.exec(line);

      let variantLine: string | undefined;
      for (let variantIndex = index + 1; variantIndex < lines.length; variantIndex++) {
        const possibleVariant = lines[variantIndex]?.trim();
        if (!possibleVariant || possibleVariant.startsWith('#')) {
          continue;
        }
        variantLine = possibleVariant;
        break;
      }
      if (!variantLine) {
        continue;
      }

      try {
        variants.push({
          bandwidth: bandwidth?.[1] ? parseInt(bandwidth[1]) : 0,
          height: parseInt(resolution[1]),
          url: new URL(variantLine, baseUrl),
        });
      } catch {
        continue;
      }
    }

    return variants;
  }

  private compareCandidates(left: Candidate, right: Candidate): number {
    const adaptiveComparison = Number(right.adaptiveSafe) - Number(left.adaptiveSafe);
    if (adaptiveComparison !== 0) {
      return adaptiveComparison;
    }

    const heightComparison = this.getMaxHeight(right) - this.getMaxHeight(left);
    if (heightComparison !== 0) {
      return heightComparison;
    }

    const variantComparison = right.variants.length - left.variants.length;
    if (variantComparison !== 0) {
      return variantComparison;
    }

    return left.provider.localeCompare(right.provider);
  }

  private getMaxHeight(candidate: Candidate): number {
    return Math.max(0, ...candidate.variants.map(variant => variant.height));
  }

  private dedupeVariantsByHeight(variants: Variant[]): Variant[] {
    const byHeight = new Map<number, Variant>();

    variants.forEach((variant) => {
      const storedVariant = byHeight.get(variant.height);
      if (!storedVariant || variant.bandwidth > storedVariant.bandwidth) {
        byHeight.set(variant.height, variant);
      }
    });

    return [...byHeight.values()].sort((left, right) => right.height - left.height);
  }

  private inferHeight(url: URL): number | undefined {
    const match = /(?:^|[/_.-])(\d{3,4})p?(?:[/_.-]|$)/i.exec(url.pathname);
    const height = match?.[1] ? parseInt(match[1]) : undefined;

    return height && height >= 240 && height <= 4320 ? height : undefined;
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
