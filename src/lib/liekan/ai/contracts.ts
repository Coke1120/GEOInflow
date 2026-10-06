import { z } from 'zod';
import { isValidAiWorkspaceId, validateAiConnectionConfig, validateAiEndpoint } from './templates';

export const aiProtocolVersion = 1 as const;
export const aiUuidSchema = z.uuid();
export const aiSpaceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('personal'), id: aiUuidSchema }),
  z.strictObject({ kind: z.literal('team'), id: aiUuidSchema }),
]);
export type AiSpace = z.infer<typeof aiSpaceSchema>;
export const aiProviderSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'qwen',
  'kimi',
  'minimax',
  'custom',
]);
export const aiProtocolSchema = z.enum(['openai-chat', 'anthropic-messages']);
const endpoint = z
  .string()
  .max(2048)
  .refine(value => {
    try {
      validateAiEndpoint(value);
      return true;
    } catch {
      return false;
    }
  }, '请使用公共 HTTPS 443 接口。');
const apiKey = z
  .string()
  .min(1)
  .refine(
    value =>
      value === value.trim() &&
      new TextEncoder().encode(value).byteLength <= 4096 &&
      !/\p{Cc}/u.test(value),
    'API Key 格式或长度无效。',
  );
export const aiWorkspaceIdSchema = z
  .string()
  .max(100)
  .refine(isValidAiWorkspaceId, '请填写有效的 Anthropic 工作空间标识。');
const fields = {
  name: z.string().trim().min(1).max(100),
  templateId: aiProviderSchema.optional(),
  provider: aiProviderSchema,
  protocol: aiProtocolSchema,
  baseUrl: endpoint,
  model: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^\s\p{Cc}]+$/u),
  workspaceId: aiWorkspaceIdSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
};
const configCheck = (
  value: {
    provider: string;
    protocol: string;
    baseUrl: string;
    model: string;
    templateId?: string;
    workspaceId?: string | null;
  },
  ctx: z.RefinementCtx,
) => {
  try {
    validateAiConnectionConfig(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: '模型模板与接口配置不匹配。', path: ['templateId'] });
  }
};
export const createAiConnectionSchema = z
  .strictObject({ ...fields, space: aiSpaceSchema, apiKey })
  .superRefine(configCheck);
export type CreateAiConnection = z.infer<typeof createAiConnectionSchema>;
// Updates carry the complete configuration, with the key optional to retain an existing credential.
export const updateAiConnectionSchema = z
  .strictObject({ ...fields, apiKey: apiKey.optional(), rowVersion: z.number().int().positive() })
  .superRefine(configCheck);
export type UpdateAiConnection = z.infer<typeof updateAiConnectionSchema>;

const values = z.strictObject({
  text: z.boolean().nullable(),
  stream: z.boolean().nullable(),
  structuredOutput: z.boolean().nullable(),
  tools: z.boolean().nullable(),
  usage: z.boolean().nullable(),
});
// null means unknown. Protocol checks and verification with the current key remain independent from documentation.
export const aiCapabilitiesSchema = z.strictObject({
  documented: values,
  protocolTested: values,
  keyVerified: values,
});
export type AiCapabilities = z.infer<typeof aiCapabilitiesSchema>;
const timestamp = z.iso.datetime({ offset: true });
export const aiConnectionPublicSchema = z
  .strictObject({
    protocolVersion: z.literal(aiProtocolVersion),
    id: aiUuidSchema,
    name: z.string().max(100),
    ownerUserId: aiUuidSchema.nullable(),
    teamId: aiUuidSchema.nullable(),
    provider: aiProviderSchema,
    protocol: aiProtocolSchema,
    baseUrl: endpoint,
    model: z.string().max(200),
    workspaceId: aiWorkspaceIdSchema.nullable(),
    region: z.string().max(100).nullable().optional(),
    contextWindow: z.number().int().positive().optional(),
    contextWindowSource: z.enum(['application_limit', 'provider_documented']).optional(),
    enabled: z.boolean(),
    isDefault: z.boolean(),
    rowVersion: z.number().int().positive(),
    configVersion: z.number().int().positive(),
    hasKey: z.boolean(),
    testState: z.enum(['untested', 'testing', 'connected', 'failed']),
    testedAt: timestamp.nullable(),
    capabilities: aiCapabilitiesSchema,
  })
  .refine(
    value => Boolean(value.ownerUserId) !== Boolean(value.teamId),
    '连接必须属于一个个人或团队空间。',
  )
  .refine(
    value => value.workspaceId === null || value.provider === 'anthropic',
    '工作空间标识仅用于 Anthropic。',
  );
export type AiConnectionPublic = z.infer<typeof aiConnectionPublicSchema>;
export function toAiConnectionPublic(record: Record<string, unknown>): AiConnectionPublic {
  return aiConnectionPublicSchema.parse({
    protocolVersion: aiProtocolVersion,
    id: record.id,
    name: record.name,
    ownerUserId: record.ownerUserId,
    teamId: record.teamId,
    provider: record.provider,
    protocol: record.protocol,
    baseUrl: record.baseUrl,
    model: record.model,
    workspaceId: record.workspaceId ?? null,
    region: record.region ?? null,
    contextWindow: record.contextWindow ?? 16384,
    contextWindowSource: record.contextWindowSource ?? 'application_limit',
    enabled: record.enabled,
    isDefault: record.isDefault,
    rowVersion: record.rowVersion,
    configVersion: record.configVersion,
    hasKey: record.hasKey,
    testState: record.testState,
    testedAt: record.testedAt,
    capabilities: record.capabilities,
  });
}

export const aiProviderResponseSchema = z.strictObject({
  status: z.number().int().min(100).max(599),
  requestId: z
    .string()
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
    .nullable(),
});
export type AiProviderResponse = z.infer<typeof aiProviderResponseSchema>;

export const aiRunStateSchema = z.enum([
  'accepted',
  'preparing',
  'calling',
  'validating',
  'cancel_requested',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'invalidated',
]);
export type AiRunState = z.infer<typeof aiRunStateSchema>;
export const AI_SAFE_ERROR_MESSAGES = {
  facts_timeout: '读取统计事实超时，请缩小日期范围后重试。',
  facts_unavailable: '统计数据暂时不可读取，请稍后重试。',
  credentials: 'AI 凭证或模型权限无效，请检查后重试。',
  model: '模型或接口暂不可用，请检查配置。',
  busy: 'AI 服务繁忙或额度不足，请稍后重试。',
  upstream: 'AI 服务暂不可用，请稍后重试。',
  timeout: 'AI 请求超时，请稍后重试。',
  network: '无法连接 AI 服务，请稍后重试。',
  cancelled: 'AI 请求已取消。',
  protocol: 'AI 服务响应格式不受支持。',
  empty_output: '收到响应，模型未返回可用文本。请检查生成预算和模型配置。',
  truncated_output: '模型文本被截断，本次结果未保存。请缩短问题或调整模型。',
  refused_output: '模型拒绝了本次请求，本次结果未保存。请调整问题后重试。',
  test_incomplete: '收到响应，文本测试未完成。请检查模型输出后重新测试。',
  oversize: 'AI 请求或响应超过允许大小。',
  input_budget: '问题与统计依据超过模型输入预算，请缩短问题或缩小日期范围后重试。',
  unsafe_endpoint: 'AI 接口地址不符合公共 HTTPS 安全要求。',
  invalid_request: 'AI 请求参数无效。',
  conflict: 'AI 配置已更新，请刷新后重试。',
  invalidated: 'AI 配置已变更，本次结果已失效。',
  interrupted: 'AI 任务已中断，请重新发起。',
} as const;
export const aiErrorCodeSchema = z.enum(
  Object.keys(AI_SAFE_ERROR_MESSAGES) as [
    keyof typeof AI_SAFE_ERROR_MESSAGES,
    ...Array<keyof typeof AI_SAFE_ERROR_MESSAGES>,
  ],
);
export const aiErrorSchema = z
  .strictObject({ code: aiErrorCodeSchema, message: z.string().max(300) })
  .refine(value => value.message === AI_SAFE_ERROR_MESSAGES[value.code], '仅允许安全错误信息。');
export type AiSafeError = z.infer<typeof aiErrorSchema>;
export function safeAiError(code: keyof typeof AI_SAFE_ERROR_MESSAGES): AiSafeError {
  return { code, message: AI_SAFE_ERROR_MESSAGES[code] };
}
export const aiUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;
export const aiRunSchema = z.strictObject({
  protocolVersion: z.literal(aiProtocolVersion),
  id: aiUuidSchema,
  clientRequestId: aiUuidSchema,
  operation: z.enum(['test', 'analysis']),
  state: aiRunStateSchema,
  connectionId: aiUuidSchema.nullable().optional(),
  configVersion: z.number().int().positive(),
  startedAt: timestamp,
  completedAt: timestamp.nullable().optional(),
  error: aiErrorSchema.nullable(),
  ttftMs: z.number().nonnegative().nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  callAttempted: z.boolean(),
  usage: aiUsageSchema.nullable(),
  result: z.unknown().optional(),
});
export type AiRun = z.infer<typeof aiRunSchema>;
export const aiConversationPostSchema = z
  .strictObject({
    clientRequestId: aiUuidSchema,
    connectionId: aiUuidSchema.optional(),
    localOnly: z.boolean().optional(),
    expectedConfigVersion: z.number().int().positive(),
    question: z
      .string()
      .trim()
      .min(1)
      .refine(value => Array.from(value).length <= 2000, '问题最多 2000 个字符。'),
    startAt: timestamp,
    endAt: timestamp,
    timezone: z
      .string()
      .max(100)
      .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/)
      .refine(value => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, '请填写有效的 IANA 时区。'),
  })
  .refine(value => !value.localOnly || !value.connectionId, '本地指引不能同时选择收费模型。')
  .refine(value => Date.parse(value.startAt) <= Date.parse(value.endAt), '时间范围无效。');
export type AiConversationPost = z.infer<typeof aiConversationPostSchema>;
