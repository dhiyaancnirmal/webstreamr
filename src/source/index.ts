import { envGet, Fetcher } from '../utils';
import { CineHDPlus } from './CineHDPlus';
import { Cuevana } from './Cuevana';
import { Einschalten } from './Einschalten';
import { Eurostreaming } from './Eurostreaming';
import { FourKHDHub } from './FourKHDHub';
import { Frembed } from './Frembed';
import { FrenchCloud } from './FrenchCloud';
import { HDHub4u } from './HDHub4u';
import { HomeCine } from './HomeCine';
import { KinoGer } from './KinoGer';
import { Kokoshka } from './Kokoshka';
import { MegaKino } from './MegaKino';
import { MeineCloud } from './MeineCloud';
import { MostraGuarda } from './MostraGuarda';
import { Movix } from './Movix';
import { RgShows } from './RgShows';
import { Source } from './Source';
import { StreamKiste } from './StreamKiste';
import { VerHdLink } from './VerHdLink';
import { VidKing } from './VidKing';
import { VidSrc } from './VidSrc';
import { Vidsuper } from './Vidsuper';
import { VixSrc } from './VixSrc';
import { Vyla } from './Vyla';

export * from './Source';

export const createSources = (fetcher: Fetcher): Source[] => {
  const disabledSources = envGet('DISABLED_SOURCES')?.split(',') ?? [];
  const vylaBaseUrl = envGet('VYLA_BASE_URL');

  return [
    // multi
    new FourKHDHub(fetcher),
    new HDHub4u(fetcher),
    new VidKing(fetcher),
    ...(vylaBaseUrl ? [new Vyla(fetcher, vylaBaseUrl)] : [new Vidsuper(fetcher)]),
    new VixSrc(fetcher),
    new VidSrc(),
    new RgShows(fetcher),
    // AL
    new Kokoshka(fetcher),
    // ES / MX
    new CineHDPlus(fetcher),
    new Cuevana(fetcher),
    new HomeCine(fetcher),
    new VerHdLink(fetcher),
    // DE
    new Einschalten(fetcher),
    new KinoGer(fetcher),
    new MegaKino(fetcher),
    new MeineCloud(fetcher),
    new StreamKiste(fetcher),
    // FR
    new Frembed(fetcher),
    new FrenchCloud(fetcher),
    new Movix(fetcher),
    // IT
    new Eurostreaming(fetcher),
    new MostraGuarda(fetcher),
  ].filter(source => !disabledSources.includes(source.id));
};
