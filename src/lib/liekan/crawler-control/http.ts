import type { z } from 'zod';
import { api, readBody } from '../http';
import { authenticateCrawler, type CrawlerActor } from '../upstream/crawler-access';
import { LiekanError } from '../upstream/errors';

export function crawlerApi(request: Request, work: (actor: CrawlerActor) => Promise<unknown>) {
  return api(async () => work(await authenticateCrawler(request)));
}
export async function crawlerBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes = 32768,
) {
  const result = schema.safeParse(await readBody(request, maxBytes));
  if (!result.success) throw new LiekanError('蜘蛛策略参数无效，请检查路径、版本和选择范围', 400);
  return result.data as z.infer<T>;
}
