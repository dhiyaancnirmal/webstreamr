import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Extractor } from './Extractor';

export class Hls extends Extractor {
  public readonly id = 'hls';

  public readonly label = 'HLS';

  public override readonly ttl = 600000; // 10m

  public supports(_ctx: Context, url: URL): boolean {
    return url.pathname.toLowerCase().endsWith('.m3u8');
  };

  protected async extractInternal(_ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    return [{
      url,
      format: Format.hls,
      label: url.host,
      meta,
    }];
  };
}
