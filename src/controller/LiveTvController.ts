import { NextFunction, Request, Response, Router } from 'express';
import winston from 'winston';
import { StreamSports99 } from '../live-tv';
import { contextFromRequestAndResponse } from '../utils';

const CATALOG_ID = 'streamsports99';
const PAGE_SIZE = 100;

export class LiveTvController {
  public readonly router: Router;

  private readonly logger: winston.Logger;
  private readonly streamSports99: StreamSports99;

  public constructor(logger: winston.Logger, streamSports99: StreamSports99) {
    this.router = Router();
    this.logger = logger;
    this.streamSports99 = streamSports99;

    this.router.get('/catalog/tv/:catalogId.json', this.getCatalog.bind(this));
    this.router.get('/catalog/tv/:catalogId/:extra.json', this.getCatalog.bind(this));
    this.router.get('/:config/catalog/tv/:catalogId.json', this.getCatalog.bind(this));
    this.router.get('/:config/catalog/tv/:catalogId/:extra.json', this.getCatalog.bind(this));
    this.router.get('/meta/tv/:id.json', this.getMeta.bind(this));
    this.router.get('/:config/meta/tv/:id.json', this.getMeta.bind(this));
    this.router.get('/stream/tv/:id.json', this.getStream.bind(this));
    this.router.get('/:config/stream/tv/:id.json', this.getStream.bind(this));
  }

  private async getCatalog(req: Request, res: Response, next: NextFunction) {
    if (req.params['catalogId'] !== CATALOG_ID) {
      next();
      return;
    }

    try {
      const ctx = contextFromRequestAndResponse(req, res);
      const extraParam = req.params['extra'];
      const extra = new URLSearchParams(typeof extraParam === 'string' ? extraParam : '');
      const search = (extra.get('search') ?? '').trim().toLocaleLowerCase();
      const parsedSkip = Number.parseInt(extra.get('skip') ?? '0', 10);
      const skip = Number.isFinite(parsedSkip) && parsedSkip > 0 ? parsedSkip : 0;
      const channels = (await this.streamSports99.getChannels(ctx))
        .filter(channel => !search || `${channel.name} ${channel.code}`.toLocaleLowerCase().includes(search))
        .slice(skip, skip + PAGE_SIZE);

      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({ metas: channels.map(channel => this.streamSports99.toMetaPreview(channel)) });
    } catch (error) {
      next(error);
    }
  }

  private async getMeta(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = contextFromRequestAndResponse(req, res);
      const meta = await this.streamSports99.getMeta(ctx, req.params['id'] as string);

      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({ meta });
    } catch (error) {
      next(error);
    }
  }

  private async getStream(req: Request, res: Response, next: NextFunction) {
    const id = req.params['id'] as string;
    if (!id.startsWith('ss99:')) {
      next();
      return;
    }

    try {
      const ctx = contextFromRequestAndResponse(req, res);
      const identity = this.streamSports99.decodeId(id);
      const url = await this.streamSports99.getStreamUrl(ctx, id);

      this.logger.info(`Got StreamSports99 live stream for "${identity.name}" (${identity.code})`, ctx);
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.json({
        streams: [{
          name: 'WebStreamr Live',
          title: `${identity.name}${identity.code ? ` · ${identity.code.toUpperCase()}` : ''}\n🔗 StreamSports99`,
          url: url.href,
          behaviorHints: {
            bingeGroup: `webstreamr-live-${id}`,
            notWebReady: true,
            proxyHeaders: {
              request: {
                Origin: 'https://cdnlivetv.is',
                Referer: 'https://cdnlivetv.is/',
              },
            },
          },
        }],
      });
    } catch (error) {
      next(error);
    }
  }
}
