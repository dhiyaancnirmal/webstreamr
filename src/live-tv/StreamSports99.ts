import { MetaDetail, MetaPreview } from 'stremio-addon-sdk';
import { NotFoundError } from '../error';
import { Context } from '../types';
import { Fetcher } from '../utils';

const CHANNELS_URL = new URL('https://api.cdnlivetv.is/api/v1/channels/?user=cdnlivetv&plan=free');
const PLAYER_URL = 'https://cdnlivetv.is/api/v1/channels/player/';
const PLAYER_ORIGIN = 'https://streamsports99.ru';
const ID_PREFIX = 'ss99:';

interface ApiChannel {
  name?: unknown;
  code?: unknown;
  image?: unknown;
  status?: unknown;
}

interface ChannelsResponse {
  channels?: unknown;
}

export interface LiveTvChannel {
  name: string;
  code: string;
  image?: string;
}

export class StreamSports99 {
  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  public async getChannels(ctx: Context): Promise<LiveTvChannel[]> {
    const response = await this.fetcher.json(ctx, CHANNELS_URL, { noProxyHeaders: true }) as ChannelsResponse;
    if (!Array.isArray(response.channels)) {
      return [];
    }

    return (response.channels as ApiChannel[])
      .filter(channel => channel.status === 'online' && typeof channel.name === 'string' && channel.name.length > 0 && typeof channel.code === 'string')
      .map(channel => ({
        name: channel.name as string,
        code: channel.code as string,
        ...(typeof channel.image === 'string' && channel.image.length > 0 && { image: channel.image }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  }

  public async getMeta(ctx: Context, id: string): Promise<MetaDetail> {
    const identity = this.decodeId(id);
    const channel = (await this.getChannels(ctx))
      .find(candidate => candidate.name === identity.name && candidate.code === identity.code);
    if (!channel) {
      throw new NotFoundError(`Unknown StreamSports99 channel "${identity.name}" (${identity.code}).`);
    }

    return this.toMetaPreview(channel);
  }

  public async getStreamUrl(ctx: Context, id: string): Promise<URL> {
    const identity = this.decodeId(id);
    const playerUrl = new URL(PLAYER_URL);
    playerUrl.searchParams.set('name', identity.name);
    playerUrl.searchParams.set('code', identity.code);
    playerUrl.searchParams.set('user', 'cdnlivetv');
    playerUrl.searchParams.set('plan', 'free');

    const html = await this.fetcher.text(ctx, playerUrl, {
      headers: {
        Origin: PLAYER_ORIGIN,
        Referer: `${PLAYER_ORIGIN}/`,
      },
      noProxyHeaders: true,
    });

    return this.extractStreamUrl(html);
  }

  public toMetaPreview(channel: LiveTvChannel): MetaPreview {
    return {
      id: this.encodeId(channel),
      type: 'tv',
      name: `${channel.name}${channel.code ? ` (${channel.code.toUpperCase()})` : ''}`,
      ...(channel.image && { poster: channel.image }),
      posterShape: 'square',
      description: `Live television from StreamSports99${channel.code ? ` · ${channel.code.toUpperCase()}` : ''}`,
    };
  }

  public encodeId(channel: Pick<LiveTvChannel, 'name' | 'code'>): string {
    return ID_PREFIX + Buffer.from(JSON.stringify({ name: channel.name, code: channel.code })).toString('base64url');
  }

  public decodeId(id: string): Pick<LiveTvChannel, 'name' | 'code'> {
    if (!id.startsWith(ID_PREFIX)) {
      throw new Error('Invalid StreamSports99 channel ID.');
    }

    let identity: unknown;
    try {
      identity = JSON.parse(Buffer.from(id.slice(ID_PREFIX.length), 'base64url').toString('utf8'));
    } catch {
      throw new Error('Invalid StreamSports99 channel ID.');
    }

    if (
      !identity
      || typeof identity !== 'object'
      || typeof (identity as Partial<LiveTvChannel>).name !== 'string'
      || !(identity as Partial<LiveTvChannel>).name
      || typeof (identity as Partial<LiveTvChannel>).code !== 'string'
    ) {
      throw new Error('Invalid StreamSports99 channel ID.');
    }

    return {
      name: (identity as LiveTvChannel).name,
      code: (identity as LiveTvChannel).code,
    };
  }

  private extractStreamUrl(html: string): URL {
    const sourceVariable = html.match(/source:\s*\{\s*src:\s*([A-Za-z_$][\w$]*),\s*format:\s*['"]hls['"]/)?.[1];
    if (!sourceVariable) {
      throw new Error('StreamSports99 player did not contain an HLS source.');
    }

    const assignments = new Map(
      [...html.matchAll(/var\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g)]
        .map(match => [match[1] as string, match[2] as string]),
    );
    const sourceExpression = assignments.get(sourceVariable);
    if (!sourceExpression) {
      throw new Error('StreamSports99 HLS source was incomplete.');
    }

    const fragmentNames = [...sourceExpression.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\)/g)]
      .map(match => match[1] as string);
    if (!fragmentNames.length) {
      throw new Error('StreamSports99 HLS source had no URL fragments.');
    }

    const streamUrl = fragmentNames.map((fragmentName) => {
      const encoded = assignments.get(fragmentName)?.match(/^['"]([^'"]+)['"]$/)?.[1];
      if (!encoded) {
        throw new Error('StreamSports99 HLS source had an invalid URL fragment.');
      }

      return Buffer.from(encoded, 'base64url').toString('utf8');
    }).join('');
    const url = new URL(streamUrl);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('cdnlivetv.is') || !url.pathname.endsWith('/playlist.m3u8')) {
      throw new Error('StreamSports99 returned an unsupported HLS URL.');
    }

    return url;
  }
}
