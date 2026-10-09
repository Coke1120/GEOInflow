import { z } from 'zod';
import { crawlerPolicyInputSchema } from '../contracts/crawlers';
import { crawlerRobotsPolicySchema, mergeRobotsPolicy } from '../crawlers/robots';
import { exportNginxPolicy } from '../crawlers/templates';
import { hostname } from '../log-ingestion/protocol';
import {
  authorizeCrawler,
  crawlerTransaction,
  type CrawlerActor,
} from '../upstream/crawler-access';

export const crawlerExportInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('robots'),
    policy: crawlerRobotsPolicySchema,
    existing: z.string().max(262144).optional(),
  }),
  z.strictObject({
    kind: z.literal('nginx'),
    policy: crawlerPolicyInputSchema,
    rateLimit: z
      .strictObject({
        requestsPerSecond: z.number().int().min(1).max(1000),
        burst: z.number().int().min(1).max(1000),
        dryRun: z.boolean(),
      })
      .optional(),
  }),
]);
export async function crawlerExport(
  actor: CrawlerActor,
  websiteId: string,
  input: z.infer<typeof crawlerExportInputSchema>,
) {
  return crawlerTransaction(async tx => {
    const website = await authorizeCrawler(tx, actor, websiteId);
    if (input.kind === 'nginx')
      return {
        ...exportNginxPolicy(hostname(website.domain), input.policy, {
          rateLimit: input.rateLimit,
        }),
        kind: 'nginx',
      };
    const [settings] = await tx.query(
      'SELECT robots FROM liekan_setting WHERE website_id=$1::uuid',
      websiteId,
    );
    const existing = input.existing ?? settings?.robots ?? '';
    return { kind: 'robots', original: existing, ...mergeRobotsPolicy(existing, input.policy) };
  });
}
