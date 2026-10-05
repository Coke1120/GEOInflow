import ipaddr from 'ipaddr.js';

export type AiProtocol = 'openai-chat' | 'anthropic-messages';
export type AiProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'minimax'
  | 'custom';
export type AiCapabilityValues = {
  text: boolean | null;
  stream: boolean | null;
  structuredOutput: boolean | null;
  tools: boolean | null;
  usage: boolean | null;
};
export type AiTemplate = {
  id: AiProvider;
  name: string;
  provider: AiProvider;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  contextWindow: number;
  region?: string | null;
  contextWindowSource?: 'application_limit' | 'provider_documented';
  documented: AiCapabilityValues;
  documentationUrls: readonly string[];
  notes: readonly string[];
  requestPolicy?: {
    apiVersion?: '2023-06-01';
    reasoningEffort?: 'low';
    thinking?: { type: 'disabled' };
    jsonOutput?: true;
    outputTokenField?: 'max_completion_tokens';
  };
};
const standard = (): AiCapabilityValues => ({
  text: true,
  stream: true,
  structuredOutput: null,
  tools: null,
  usage: true,
});
export const AI_TEMPLATES: readonly AiTemplate[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    provider: 'openai',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    contextWindow: 16384,
    documented: standard(),
    documentationUrls: [
      'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
      'https://developers.openai.com/api/reference/resources/chat',
    ],
    notes: ['按当前模型与账号权限执行连接测试。'],
  },
  {
    id: 'anthropic',
    name: 'Claude',
    provider: 'anthropic',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
    contextWindow: 16384,
    documented: standard(),
    documentationUrls: [
      'https://platform.claude.com/docs/en/api/overview',
      'https://platform.claude.com/docs/en/models/overview',
    ],
    notes: ['普通 Key 可直接使用；多空间 Key 需要填写工作空间标识。'],
    requestPolicy: { apiVersion: '2023-06-01' },
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    provider: 'gemini',
    protocol: 'openai-chat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    contextWindow: 16384,
    documented: standard(),
    documentationUrls: ['https://ai.google.dev/gemini-api/docs/openai'],
    notes: ['使用官方 OpenAI 兼容接口。'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'deepseek',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    contextWindow: 16384,
    documented: standard(),
    documentationUrls: ['https://api-docs.deepseek.com/'],
    requestPolicy: { thinking: { type: 'disabled' }, jsonOutput: true },
    notes: ['统计分析使用非思考模式，将输出预算用于有依据的回答。'],
  },
  {
    id: 'qwen',
    region: '北京',
    name: '阿里云百炼',
    provider: 'qwen',
    protocol: 'openai-chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    contextWindow: 16384,
    documented: standard(),
    documentationUrls: [
      'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
    ],
    notes: ['默认北京地域，Key 必须来自同一地域。'],
  },
  {
    id: 'kimi',
    region: '中国站',
    name: 'Kimi',
    provider: 'kimi',
    protocol: 'openai-chat',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3',
    contextWindow: 1000000,
    documented: { ...standard(), structuredOutput: true, tools: true },
    documentationUrls: ['https://platform.kimi.com/docs/guide/kimi-k3-quickstart'],
    notes: ['使用中国站 Key；思考模式始终启用。'],
    requestPolicy: { reasoningEffort: 'low' },
  },
  {
    id: 'minimax',
    region: '国际站',
    name: 'MiniMax',
    provider: 'minimax',
    protocol: 'openai-chat',
    baseUrl: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    contextWindow: 1000000,
    documented: { ...standard(), tools: true },
    documentationUrls: ['https://platform.minimax.io/docs/api-reference/text-openai-api'],
    notes: ['使用国际站按量付费 Key；输出上限使用 max_completion_tokens，额度由操作预算给出。'],
    requestPolicy: { thinking: { type: 'disabled' }, outputTokenField: 'max_completion_tokens' },
  },
  {
    id: 'custom',
    name: '自定义兼容接口',
    provider: 'custom',
    protocol: 'openai-chat',
    baseUrl: '',
    model: '',
    contextWindow: 16384,
    documented: { text: true, stream: null, structuredOutput: null, tools: null, usage: null },
    documentationUrls: [],
    notes: ['仅支持公共 HTTPS 443 端口上的兼容文本接口。'],
  },
];

export function getAiTemplate(id: string): AiTemplate | undefined {
  return AI_TEMPLATES.find(template => template.id === id);
}

export function isPublicAiAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address.replace(/^\[|\]$/g, ''));
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress())
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

/** Validate the untouched URL before WHATWG can normalize its path or authority. */
function parseSafeAiUrl(value: string, maxLength = 2048): URL {
  const fail = () => {
    throw new Error('AI 接口地址必须使用公共 HTTPS 443 服务。');
  };
  if (
    typeof value !== 'string' ||
    value.length > maxLength ||
    value !== value.trim() ||
    /[?#]/.test(value) ||
    /[\\\s\p{Cc}]/u.test(value)
  )
    fail();
  const raw = /^https:\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(value);
  if (!raw || raw[1].includes('@')) fail();
  const rawPath = raw[2] ?? '';
  // Encoded percent signs can hide a second decoding of separators or dot segments.
  if (
    rawPath.includes('//') ||
    /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath) ||
    /%(?:25|2e|2f|5c|00)/i.test(rawPath) ||
    /%(?![a-f0-9]{2})/i.test(rawPath)
  )
    fail();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail();
  }
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    fail();
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !hostname ||
    hostname.endsWith('.') ||
    hostname === 'localhost' ||
    /\.(?:localhost|local|internal|home|lan)$/.test(hostname) ||
    hostname.endsWith('.home.arpa')
  )
    fail();
  if (ipaddr.isValid(hostname)) {
    if (!isPublicAiAddress(hostname)) fail();
  } else if (!hostname.includes('.') || !/^[a-z0-9.-]+$/.test(hostname)) fail();
  return url;
}

/** Static URL validation is followed by an all-record DNS check and pinned TLS dialing. */
export function validateAiEndpoint(baseUrl: string): URL {
  const url = parseSafeAiUrl(baseUrl);
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url;
}

/** Request paths retain their exact canonical form, including a trailing slash. */
export function validateAiRequestUrl(requestUrl: string): URL {
  return parseSafeAiUrl(requestUrl, 2080);
}

export const AI_WORKSPACE_ID_PATTERN = /^wrkspc_[A-Za-z0-9_-]+$/;
export function isValidAiWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && AI_WORKSPACE_ID_PATTERN.test(value);
}
export type AiConnectionConfig = {
  templateId?: string;
  provider: string;
  protocol: string;
  baseUrl: string;
  model: string;
  workspaceId?: string | null;
};
export function validateAiConnectionConfig(config: AiConnectionConfig): void {
  validateAiEndpoint(config.baseUrl);
  if (!config.model || config.model.length > 200 || /[\s\p{Cc}]/u.test(config.model))
    throw new Error('请填写有效的模型标识。');
  const template = getAiTemplate(config.templateId ?? config.provider);
  if (!template || template.provider !== config.provider || template.protocol !== config.protocol)
    throw new Error('模型模板与协议配置不匹配。');
  if (
    config.workspaceId != null &&
    (config.provider !== 'anthropic' || !isValidAiWorkspaceId(config.workspaceId))
  )
    throw new Error('请填写有效的 Anthropic 工作空间标识。');
}

export type ResolvedAiTemplateConfig = {
  verifiedPreset: boolean;
  documented: AiCapabilityValues;
  contextWindow: number;
  region: string | null;
  contextWindowSource: 'application_limit' | 'provider_documented';
  requestPolicy?: AiTemplate['requestPolicy'];
};
/** Preset facts and special options apply only to the verified endpoint and model pair. */
export function resolveAiTemplateConfig(config: AiConnectionConfig): ResolvedAiTemplateConfig {
  validateAiConnectionConfig(config);
  const template = getAiTemplate(config.templateId ?? config.provider);
  const verifiedPreset =
    template.id !== 'custom' &&
    validateAiEndpoint(config.baseUrl).href === validateAiEndpoint(template.baseUrl).href &&
    config.model === template.model;
  if (!verifiedPreset)
    return {
      verifiedPreset: false,
      documented: { text: null, stream: null, structuredOutput: null, tools: null, usage: null },
      contextWindow: 16384,
      region: null,
      contextWindowSource: 'application_limit',
    };
  return {
    verifiedPreset: true,
    documented: { ...template.documented },
    contextWindow: template.contextWindow,
    region: template.region ?? null,
    contextWindowSource:
      template.contextWindow === 16384 ? 'application_limit' : 'provider_documented',
    ...(template.requestPolicy
      ? {
          requestPolicy: {
            ...template.requestPolicy,
            ...(template.requestPolicy.thinking
              ? { thinking: { ...template.requestPolicy.thinking } }
              : {}),
          },
        }
      : {}),
  };
}
