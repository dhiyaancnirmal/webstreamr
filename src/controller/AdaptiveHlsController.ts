import { Request, Response, Router } from 'express';

interface HlsVariant {
  height: number;
  url: string;
}

const MAX_VARIANTS = 10;
const MAX_PAYLOAD_LENGTH = 16384;

const BANDWIDTH_BY_HEIGHT: Record<number, number> = {
  480: 1500000,
  720: 3000000,
  1080: 6000000,
  2160: 15000000,
};

const WIDTH_BY_HEIGHT: Record<number, number> = {
  480: 854,
  720: 1280,
  1080: 1920,
  2160: 3840,
};

export class AdaptiveHlsController {
  public readonly router: Router;

  public constructor() {
    this.router = Router();
    this.router.get('/adaptive-hls/:variants.m3u8', this.getPlaylist.bind(this));
  }

  private getPlaylist(req: Request, res: Response) {
    try {
      const encoded = req.params['variants'];
      if (typeof encoded !== 'string') {
        throw new Error('Invalid payload.');
      }

      const variants = this.decodeVariants(encoded);
      const playlist = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        ...variants.flatMap((variant) => {
          const width = WIDTH_BY_HEIGHT[variant.height] ?? Math.round(variant.height * 16 / 9);
          const bandwidth = BANDWIDTH_BY_HEIGHT[variant.height] ?? Math.round(variant.height * 5500);

          return [
            `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${variant.height}`,
            variant.url,
          ];
        }),
        '',
      ].join('\n');

      res.setHeader('Cache-Control', 'public, max-age=600, immutable');
      res.type('application/vnd.apple.mpegurl').send(playlist);
    } catch {
      res.status(400).send('Invalid adaptive HLS playlist.');
    }
  }

  private decodeVariants(encoded: string): HlsVariant[] {
    if (!encoded || encoded.length > MAX_PAYLOAD_LENGTH) {
      throw new Error('Invalid payload length.');
    }

    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(decoded) || decoded.length < 2 || decoded.length > MAX_VARIANTS) {
      throw new Error('Invalid variant count.');
    }

    return decoded.map((value) => {
      if (!value || typeof value !== 'object') {
        throw new Error('Invalid variant.');
      }

      const variant = value as Partial<HlsVariant>;
      if (!Number.isInteger(variant.height) || (variant.height as number) < 1 || (variant.height as number) > 4320 || typeof variant.url !== 'string') {
        throw new Error('Invalid variant metadata.');
      }

      const url = new URL(variant.url);
      if (url.protocol !== 'https:' || !url.pathname.toLowerCase().endsWith('.m3u8')) {
        throw new Error('Invalid variant URL.');
      }

      return {
        height: variant.height as number,
        url: url.href,
      };
    }).sort((a, b) => a.height - b.height);
  }
}
