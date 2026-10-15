import { crawlerCatalog } from '../crawlers/catalog';
import type { Crawler } from './types';

export const helpCrawlers: Crawler[] = crawlerCatalog.map(entry => entry.metadata);
