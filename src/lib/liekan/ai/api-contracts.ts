import { z } from 'zod';
import { defineOperation, apiErrorSchema } from '../upstream/feature-api-contracts';
import { aiConnectionPublicSchema, aiRunSchema, aiSpaceSchema } from './contracts';
import { aiFactsContextSchema } from './facts-contracts';
export const aiConversationPublicSchema = z.strictObject({
  protocolVersion: z.literal(1).optional(),
  id: z.uuid(),
  websiteId: z.uuid(),
  title: z.string().max(100),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export const aiCatalogSchema = z.object({
  protocolVersion: z.literal(1),
  module: z.object({ enabled: z.boolean(), reason: z.string().optional() }),
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      provider: z.string(),
      protocol: z.string(),
      baseUrl: z.string(),
      model: z.string(),
      contextWindow: z.number(),
      region: z.string().nullable().optional(),
      contextWindowSource: z.enum(['application_limit', 'provider_documented']).optional(),
      documented: z.record(z.string(), z.boolean().nullable()),
      documentationUrls: z.array(z.string()),
      notes: z.array(z.string()),
      requestPolicy: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  spaces: z.array(
    z.object({
      kind: z.enum(['personal', 'team']),
      id: z.uuid(),
      name: z.string(),
      canManage: z.boolean(),
      canUse: z.boolean(),
    }),
  ),
  websites: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      domain: z.string().nullable(),
      ownerUserId: z.uuid().nullable(),
      teamId: z.uuid().nullable(),
      space: aiSpaceSchema,
    }),
  ),
  websiteLimit: z.number(),
  limits: z.object({
    connectionsPerSpace: z.number(),
    maxDays: z.number(),
    maxQuestionCharacters: z.number(),
    dailyRequests: z.number(),
    quotaTimezone: z.literal('UTC'),
  }),
});
export const aiConnectionListSchema = z.object({
  protocolVersion: z.literal(1),
  items: z.array(
    aiConnectionPublicSchema.extend({
      lastCall: z
        .object({
          state: z.string(),
          operation: z.enum(['test', 'analysis']),
          createdAt: z.string(),
          completedAt: z.string().nullable(),
          errorCode: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
  canManage: z.boolean(),
  canUse: z.boolean(),
  role: z.string(),
  teamRole: z.string().nullable(),
});
export const aiSavedContextSchema = aiFactsContextSchema.extend({
  modelConfiguration: z
    .object({
      connectionId: z.uuid(),
      configVersion: z.number().int().positive(),
      provider: z.string().max(100),
      region: z.string().max(100).nullable().optional(),
      contextWindow: z.number().int().positive().optional(),
      contextWindowSource: z.enum(['application_limit', 'provider_documented']).optional(),
      model: z.string().max(200),
    })
    .optional(),
  inputBudget: z
    .object({
      bytes: z.number().int().nonnegative().max(32768),
      tokenUpperBound: z.number().int().nonnegative(),
      trimmed: z.object({
        historyTurns: z.number().int().nonnegative(),
        logSamples: z.number().int().nonnegative(),
        topRows: z.number().int().nonnegative(),
      }),
    })
    .optional(),
});
export const aiRunResponseSchema = aiRunSchema.extend({ stage: z.string() });
export const aiListSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    protocolVersion: z.literal(1),
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
export function aiOperation(p: {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: `/${string}`;
  id: string;
  summary: string;
  response: z.ZodType;
  body?: z.ZodType;
  params?: z.ZodObject;
  query?: z.ZodObject;
  stream?: boolean;
}) {
  const content = p.stream
    ? { 'text/event-stream': { schema: z.string() }, 'application/json': { schema: p.response } }
    : { 'application/json': { schema: p.response } };
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 429, 503].map(status => [
      status,
      {
        description: '需要完整登录、当前资源权限及有效参数；限额和暂不可用返回明确错误。',
        content: { 'application/json': { schema: apiErrorSchema } },
      },
    ]),
  );
  return defineOperation({
    method: p.method,
    path: p.path,
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: p.id,
      summary: p.summary,
      tags: ['Liekan AI'],
      description:
        'AI 契约 version 1，仅完整会话身份可使用；账户 API Key、公共分享及 2FA 中间身份拒绝。私有响应不缓存。',
      ...(p.params || p.query
        ? {
            requestParams: {
              ...(p.params ? { path: p.params } : {}),
              ...(p.query ? { query: p.query } : {}),
            },
          }
        : {}),
      ...(p.body
        ? { requestBody: { required: true, content: { 'application/json': { schema: p.body } } } }
        : {}),
      responses: {
        200: {
          description: p.stream ? '新任务事件流；同 UUID 已完成任务返回保存结果' : '成功',
          content,
        },
        ...(p.stream
          ? {
              202: {
                description: '同 UUID 任务仍在执行，返回原状态及查询位置',
                content: { 'application/json': { schema: p.response } },
              },
            }
          : {}),
        ...errors,
      },
    },
  });
}
