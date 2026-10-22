import { browserPopulationSchema } from './browser-population';
import { z } from 'zod';
import { crawlerPolicyInputSchema } from './crawlers';

const id = z.uuid(),
  date = z.string(),
  nullableDate = date.nullable();
const json = z.record(z.string(), z.unknown());
const quality = z.object({
  state: z.enum(['complete', 'partial', 'unknown', 'missing', 'unsupported']),
  basis: z.enum(['event_time', 'ingestion_time', 'unknown']),
  classificationVersion: z.string(),
  sourceVersion: z.string(),
  timezone: z.string(),
});
const counts = z.object({
  requests: z.number(),
  status1xx: z.number(),
  status2xx: z.number(),
  status3xx: z.number(),
  status304: z.number(),
  status4xx: z.number(),
  status5xx: z.number(),
  denied403429: z.number(),
  head: z.number(),
  successfulGets: z.number(),
});
const botId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
  .nullable();
const bot = counts.extend({
  botId,
  name: z.string(),
  bytes: z.number(),
  verifiedRange: z.number(),
  verifiedDns: z.number().optional(),
  verifiedEdge: z.number().optional(),
  rangeMismatch: z.number(),
  unverified: z.number(),
  successfulCatalogPages: z.number(),
  lastVisit: date,
  legacyRecords: z.number(),
});
const page = counts.extend({
  botId,
  name: z.string().optional(),
  path: z.string(),
  humanPath: z.string(),
  mergedPaths: z.array(z.string()),
  bytes: z.number(),
  ownedTerminatingBlocks: z.number(),
  ownedMatches: z.number(),
});
const platform = z.object({
  platformId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  state: z.enum(['available', 'missing', 'unsupported', 'unknown']),
  visits: z.number().nullable(),
  conversions: z.number().nullable(),
  goalEvents: z.number().nullable(),
  landingPagesTruncated: z.boolean(),
  landingPages: z.array(
    z.object({
      path: z.string(),
      visits: z.number().nullable(),
      conversions: z.number().nullable(),
      goalEvents: z.number().nullable(),
    }),
  ),
});
const range = z.object({ startAt: z.number(), endAt: z.number(), timezone: z.string() });
const permissions = z.object({
  canDraft: z.boolean(),
  canControl: z.boolean(),
  isAdmin: z.boolean().optional(),
});
const policy = crawlerPolicyInputSchema.extend({
  id,
  websiteId: id,
  version: z.number(),
  state: z.enum(['draft', 'enabled', 'stopped']),
  appliedVersion: z.number().nullable(),
  connectionId: id.nullable(),
  ref: z.string(),
  remoteRuleId: z.string().nullable(),
  remoteRulesetId: z.string().nullable(),
  remoteHash: z.string().nullable(),
  createdAt: date,
  updatedAt: date,
  contextCurrent: z.boolean().optional(),
});
const connection = z.object({
  id,
  websiteId: id,
  zoneId: z.string(),
  domain: z.string(),
  state: z.enum(['active', 'frozen', 'disconnected', 'cleanup']),
  capabilities: z.record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.null()])),
  testedAt: nullableDate,
  createdAt: date,
  updatedAt: date,
  tokenMask: z.string().nullable(),
  cleanupUntil: nullableDate,
});
const deployment = z.object({
  mode: z.enum(['apply', 'adopt']),
  id,
  websiteId: id,
  policyId: id,
  policyVersion: z.number(),
  operation: z.enum(['deploy', 'stop', 'rollback', 'cleanup']),
  state: z.enum(['queued', 'running', 'confirmed', 'unknown', 'failed', 'conflict', 'cleanup']),
  ref: z.string(),
  ruleId: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: date,
  updatedAt: date,
  completedAt: nullableDate,
  result: z.unknown(),
  instructions: z.string().nullable(),
});
const list = z.object({
  policies: z.array(policy),
  connections: z.array(connection),
  deployments: z.array(deployment),
  permissions,
  controlPaused: z.boolean(),
});
const domain = z.object({
  hostname: z.string(),
  name: z.string(),
  expiresAt: nullableDate,
  verifiedAt: nullableDate,
  value: z.string().optional(),
});
const check = z.object({
  id,
  state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  result: z.unknown(),
  errorCode: z.string().nullable(),
  createdAt: date,
  completedAt: nullableDate,
});
export const crawlerAnalysisResponseSchema = z.object({
  population: browserPopulationSchema.optional(),
  range,
  quality,
  directory: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      name: z.string(),
      platformId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      type: z.enum(['training', 'search', 'user', 'traditional_search', 'other']),
      kind: z.enum(['http_crawler', 'robots_purpose', 'signed_agent']),
      uaSelector: z.string().nullable(),
      robotsToken: z.string().nullable(),
      robotsApplicability: z.enum(['applicable', 'user_triggered_caveat']),
      documentationUrl: z.string(),
      impact: z.string(),
      identityEvidence: z.string(),
      family: z.string(),
      aiEligible: z.boolean(),
      status: z.enum(['active', 'pending', 'inactive']),
      evidence: z.enum(['operator', 'observed', 'pending', 'inactive']),
      reviewedAt: z.string(),
      sources: z.array(z.object({ label: z.string(), url: z.string() })),
      control: z.object({ remote: z.boolean(), nginx: z.boolean() }),
    }),
  ),
  bots: z.array(bot),
  pagesTruncated: z.boolean(),
  pages: z.array(page),
  platforms: z.array(platform),
  previous: z.object({
    population: browserPopulationSchema.optional(),
    range,
    quality,
    bots: z.array(counts.extend({ botId, name: z.string().optional(), bytes: z.number() })),
    platforms: z.array(platform),
  }),
  findings: z.array(
    z.object({
      key: z.string(),
      botId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      type: z.enum([
        'access',
        'origin',
        'surge',
        'coverage',
        'expected_access',
        'identity',
        'sensitive_path',
        'observation',
        'execution',
      ]),
      pathGroup: z.string(),
      grade: z.enum(['high', 'medium', 'info']),
      confidence: z.enum(['confirmed', 'possible', 'insufficient']),
      state: z.enum(['active', 'ignored', 'resolved']),
      facts: json,
      firstSeenAt: date,
      lastSeenAt: date,
      windowEnd: date,
      occurrenceWindows: z.number(),
      workflow: z
        .object({ state: z.enum(['pending', 'viewed', 'snoozed']), snoozedUntil: nullableDate })
        .nullable()
        .optional(),
    }),
  ),
  criticalPaths: z.array(z.string()),
  analysis: z
    .object({ computedAt: date, windowEnd: date, errorCode: z.string().nullable() })
    .nullable(),
  generatedAt: date,
  permissions,
});

export function crawlerResponseSchema(operationId: string): z.ZodType {
  switch (operationId) {
    case 'getLiekanCrawlerAnalysis':
      return crawlerAnalysisResponseSchema;
    case 'patchLiekanCrawlerAnalysis':
      return z.object({ paths: z.array(z.string()) });
    case 'getLiekanCrawlerChecks':
      return z.array(check);
    case 'postLiekanCrawlerChecks':
      return z.object({ id, state: z.literal('queued') });
    case 'getLiekanCrawlerDomainVerification':
    case 'postLiekanCrawlerDomainVerification':
      return domain;
    case 'getLiekanCrawlerPolicies':
      return list;
    case 'getLiekanCrawlerConnections':
      return z.object({
        connections: z.array(connection),
        permissions,
        controlPaused: z.boolean(),
      });
    case 'getLiekanCrawlerPolicy':
      return z.object({
        policy,
        versions: z.array(
          z.object({ version: z.number(), body: crawlerPolicyInputSchema, createdAt: date }),
        ),
        deployments: z.array(deployment),
        permissions,
        controlPaused: z.boolean(),
        contextCurrent: z.boolean(),
      });
    case 'postLiekanCrawlerPolicies':
    case 'patchLiekanCrawlerPolicy':
      return policy;
    case 'postLiekanCrawlerConnection':
      return connection;
    case 'patchLiekanCrawlerControl':
      return z.object({ controlPaused: z.boolean(), reconciledConnections: z.number() });
    case 'deleteLiekanCrawlerConnection':
      return z.object({
        connection,
        remoteTokenRevoked: z.literal(false),
        rulesRetained: z.literal(true),
        cleanup: z.array(deployment).optional(),
      });
    case 'postLiekanCrawlerAdoptPreview':
    case 'postLiekanCrawlerPreview':
      return z.object({
        mode: z.enum(['apply', 'adopt']),
        transfer: z
          .object({
            previous: z.object({
              connectionId: id,
              generation: z.number(),
              ownerUserId: id.nullable(),
              teamId: id.nullable(),
            }),
            next: z.object({
              connectionId: id,
              generation: z.number(),
              ownerUserId: id.nullable(),
              teamId: id.nullable(),
            }),
          })
          .nullable(),
        id,
        expiresAt: date,
        operation: z.enum(['deploy', 'stop', 'rollback', 'cleanup']),
        policyId: id,
        policyVersion: z.number(),
        targetVersion: z.number(),
        hostname: z.string(),
        paths: crawlerPolicyInputSchema.shape.paths,
        expression: z.string().nullable(),
        before: json,
        after: json,
        impact: z.object({
          searchBots: z.array(z.string()),
          fullSite: z.boolean(),
          historicalRequests7d: z.object({
            requests: z.number().nullable(),
            unclassified: z.number(),
            observedRequests: z.number(),
            state: z.enum(['missing', 'partial', 'available']),
            basis: z.literal('historical_estimate'),
            windowDays: z.literal(7),
          }),
          otherRules: z.string(),
          otherRulesSummary: z.object({ readable: z.boolean(), count: z.number().nullable() }),
          acknowledgement: z.string(),
        }),
        capabilities: json,
        limitations: z.array(z.string()),
        localOnly: z.boolean(),
      });
    case 'postLiekanCrawlerHandoffReconcile':
    case 'postLiekanCrawlerAdopt':
    case 'getLiekanCrawlerDeployment':
    case 'postLiekanCrawlerDeploy':
    case 'postLiekanCrawlerStop':
    case 'postLiekanCrawlerRollback':
    case 'postLiekanCrawlerCleanup':
    case 'postLiekanCrawlerDeploymentReconcile':
      return deployment;
    case 'getLiekanCrawlerHandoffs':
      return z.object({
        handoffs: z.array(
          z.object({
            recoveryConnections: z.array(
              z.object({
                websiteId: id,
                connectionId: id,
                websiteName: z.string(),
                domain: z.string(),
                zoneId: z.string(),
              }),
            ),
            connection,
            policies: z.array(policy),
            deployments: z.array(deployment),
            instruction: z.string(),
          }),
        ),
      });
    case 'postLiekanCrawlerExport':
      return z.union([
        z.looseObject({
          kind: z.literal('robots'),
          original: z.string(),
          safe: z.boolean(),
          content: z.string().nullable().optional(),
          fragment: z.string(),
          reasons: z.array(z.string()),
        }),
        z.looseObject({
          kind: z.literal('nginx'),
          httpContext: z.string(),
          serverContext: z.string(),
          limitations: z.array(z.string()),
          rateLimit: z
            .object({ httpContext: z.string(), serverContext: z.string(), dryRun: z.boolean() })
            .nullable(),
        }),
      ]);
    default:
      throw new Error(`Crawler response schema is missing: ${operationId}`);
  }
}
