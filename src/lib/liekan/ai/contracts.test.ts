import { describe, expect, it } from 'vitest';
import {
  aiConversationPostSchema,
  createAiConnectionSchema,
  toAiConnectionPublic,
  updateAiConnectionSchema,
} from './contracts';
import {
  AI_TEMPLATES,
  getAiTemplate,
  resolveAiTemplateConfig,
  validateAiEndpoint,
} from './templates';

const uuid = '09cfb153-5a7b-4dce-b607-c61a0d0794c7';
const config = {
  name: '我的模型',
  templateId: 'openai',
  provider: 'openai',
  protocol: 'openai-chat',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5.4-mini',
  apiKey: 'secret',
  space: { kind: 'personal', id: uuid },
};
describe('AI configuration contract public seam', () => {
  it('accepts the approved configuration and refuses hidden options and incompatible presets', () => {
    expect(createAiConnectionSchema.parse(config).model).toBe('gpt-5.4-mini');
    for (const extra of [{ headers: { Authorization: 'x' } }, { options: { arbitrary: true } }])
      expect(createAiConnectionSchema.safeParse({ ...config, ...extra }).success).toBe(false);
    expect(
      createAiConnectionSchema.safeParse({ ...config, protocol: 'anthropic-messages' }).success,
    ).toBe(false);
    expect(
      createAiConnectionSchema.safeParse({ ...config, baseUrl: 'https://other.example/v1' })
        .success,
    ).toBe(true);
  });
});
describe('safe DTOs and conversation validation', () => {
  const unknown = { text: null, stream: null, structuredOutput: null, tools: null, usage: null };
  it('excludes every stored credential field from a public connection', () => {
    const dto = toAiConnectionPublic({
      ...config,
      id: uuid,
      ownerUserId: uuid,
      teamId: null,
      enabled: true,
      isDefault: false,
      rowVersion: 1,
      configVersion: 1,
      hasKey: true,
      testState: 'untested',
      testedAt: null,
      capabilities: {
        documented: { ...unknown, text: true },
        protocolTested: unknown,
        keyVerified: unknown,
      },
      apiKey: 'secret',
      keyCipher: 'encrypted',
      keySuffix: 'cret',
    });
    expect(dto).toMatchObject({
      protocolVersion: 1,
      hasKey: true,
      capabilities: { keyVerified: { text: null } },
    });
    for (const field of ['apiKey', 'keyCipher', 'keySuffix'])
      expect(Object.keys(dto)).not.toContain(field);
    expect(JSON.stringify(dto)).not.toContain('secret');
  });
  it('requires a versioned complete update and enforces credential and name bounds', () => {
    const { space, ...update } = config;
    expect(updateAiConnectionSchema.safeParse(update).success).toBe(false);
    expect(updateAiConnectionSchema.safeParse({ ...update, rowVersion: 1 }).success).toBe(true);
    expect(createAiConnectionSchema.safeParse({ ...config, name: 'x'.repeat(101) }).success).toBe(
      false,
    );
    expect(
      createAiConnectionSchema.safeParse({ ...config, apiKey: '密'.repeat(1366) }).success,
    ).toBe(false);
    expect(
      createAiConnectionSchema.safeParse({ ...config, apiKey: 'secret\r\nAuthorization: injected' })
        .success,
    ).toBe(false);
  });
  it('binds questions to an explicit time range and accepts 2000 Unicode codepoints', () => {
    const question = {
      clientRequestId: uuid,
      expectedConfigVersion: 1,
      question: '😀'.repeat(2000),
      startAt: '2026-10-01T00:00:00+08:00',
      endAt: '2026-10-02T00:00:00+08:00',
      timezone: 'Asia/Shanghai',
    };
    expect(aiConversationPostSchema.safeParse(question).success).toBe(true);
    for (const bad of [
      { question: '😀'.repeat(2001) },
      { timezone: '+08:00' },
      { timezone: 'Nowhere/Nope' },
      { websiteId: uuid },
      { filters: { country: 'CN' } },
      { startAt: '2026-10-03T00:00:00+08:00' },
    ])
      expect(aiConversationPostSchema.safeParse({ ...question, ...bad }).success).toBe(false);
  });
  it('keeps verified key capabilities independent from documented presets', () => {
    expect(AI_TEMPLATES.map(template => template.id)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'deepseek',
      'qwen',
      'kimi',
      'minimax',
      'custom',
    ]);
    expect(getAiTemplate('kimi').requestPolicy).toEqual({ reasoningEffort: 'low' });
    expect(getAiTemplate('minimax').requestPolicy).toEqual({
      thinking: { type: 'disabled' },
      outputTokenField: 'max_completion_tokens',
    });
    expect(getAiTemplate('custom').documented).toEqual({
      text: true,
      stream: null,
      structuredOutput: null,
      tools: null,
      usage: null,
    });
  });
  it('rejects URL ambiguities before a custom connection is saved', () => {
    for (const url of [
      'https://[fc00::1]/v1',
      'https://api.example/v1#fragment',
      'https://api.example/v1/%2fadmin',
      'https://api.example/v1/../admin',
      'https://metadata.internal/v1',
      'https://@api.example/v1',
      'https://api.example/v1?',
      'https://api.example/v1#',
    ])
      expect(() => validateAiEndpoint(url)).toThrow();
    expect(validateAiEndpoint('https://api.example:443/v1/').href).toBe('https://api.example/v1');
  });
});

describe('advanced configuration and fixed provider workspace fields', () => {
  const unknown = { text: null, stream: null, structuredOutput: null, tools: null, usage: null };
  it('accepts advanced endpoint/model edits and isolates verified preset claims', () => {
    const kimi = {
      ...config,
      provider: 'kimi',
      templateId: 'kimi',
      baseUrl: 'https://API.MOONSHOT.CN:443/v1/',
      model: 'kimi-k3',
    };
    expect(createAiConnectionSchema.safeParse(kimi).success).toBe(true);
    expect(resolveAiTemplateConfig(kimi)).toMatchObject({
      verifiedPreset: true,
      contextWindow: 1000000,
      requestPolicy: { reasoningEffort: 'low' },
    });
    for (const changed of [
      { ...kimi, model: 'another-compatible-model' },
      { ...kimi, baseUrl: 'https://gateway.example/v1' },
      {
        ...config,
        provider: 'qwen',
        templateId: 'qwen',
        baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus',
      },
    ]) {
      expect(createAiConnectionSchema.safeParse(changed).success).toBe(true);
      expect(resolveAiTemplateConfig(changed)).toEqual({
        verifiedPreset: false,
        documented: unknown,
        contextWindow: 16384,
        region: null,
        contextWindowSource: 'application_limit',
      });
    }
    expect(
      createAiConnectionSchema.safeParse({ ...config, protocol: 'anthropic-messages' }).success,
    ).toBe(false);
  });
  it('accepts a bounded Anthropic workspace identifier and exposes its safe nullable field', () => {
    const claude = {
      ...config,
      provider: 'anthropic',
      templateId: 'anthropic',
      protocol: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5-5',
      workspaceId: 'wrkspc_A1-b2',
    };
    expect(createAiConnectionSchema.parse(claude).workspaceId).toBe('wrkspc_A1-b2');
    for (const workspaceId of [
      'invalid',
      'wrkspc_空',
      'wrkspc_abc\r\ninjected',
      `wrkspc_${'x'.repeat(94)}`,
    ])
      expect(createAiConnectionSchema.safeParse({ ...claude, workspaceId }).success).toBe(false);
    expect(
      createAiConnectionSchema.safeParse({ ...config, workspaceId: 'wrkspc_A1-b2' }).success,
    ).toBe(false);
    expect(createAiConnectionSchema.safeParse({ ...claude, workspaceId: null }).success).toBe(true);
    const dto = toAiConnectionPublic({
      ...claude,
      id: uuid,
      ownerUserId: uuid,
      teamId: null,
      enabled: true,
      isDefault: false,
      rowVersion: 1,
      configVersion: 1,
      hasKey: true,
      testState: 'untested',
      testedAt: null,
      capabilities: { documented: unknown, protocolTested: unknown, keyVerified: unknown },
    });
    expect(dto.workspaceId).toBe('wrkspc_A1-b2');
  });
  it.each([
    '/v1/%2e%2e/admin',
    '/v1/.%2E/admin',
    '/v1/%252e%252e/admin',
    '/v1/%25252e/admin',
    '/v1/%252fadmin',
    '/v1//admin',
    '/v1/../admin',
    '/v1/%5cadmin',
  ])('rejects raw ambiguous path %s before URL normalization', pathname => {
    expect(() => validateAiEndpoint(`https://api.example${pathname}`)).toThrow();
  });
  it('rejects extra authority slashes', () => {
    expect(() => validateAiEndpoint('https:////api.example/v1')).toThrow();
  });
});

it('accepts an explicit local analysis and refuses an ambiguous paid connection', () => {
  const input = {
    clientRequestId: uuid,
    expectedConfigVersion: 1,
    localOnly: true,
    question: '查看统计接入',
    startAt: '2026-10-01T00:00:00.000Z',
    endAt: '2026-10-02T00:00:00.000Z',
    timezone: 'Asia/Shanghai',
  };
  expect(aiConversationPostSchema.parse(input).localOnly).toBe(true);
  expect(aiConversationPostSchema.safeParse({ ...input, connectionId: uuid }).success).toBe(false);
});

it('identifies only verified preset regions and labels conservative application windows', () => {
  const qwen = resolveAiTemplateConfig({
    provider: 'qwen',
    protocol: 'openai-chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  });
  expect(qwen).toMatchObject({ region: '北京', contextWindowSource: 'application_limit' });
  const custom = resolveAiTemplateConfig({
    provider: 'custom',
    protocol: 'openai-chat',
    baseUrl: 'https://models.example/v1',
    model: 'fixture',
  });
  expect(custom).toMatchObject({
    region: null,
    contextWindow: 16384,
    contextWindowSource: 'application_limit',
  });
});

it.each([' secret', 'secret ', '   '])(
  'rejects surrounding whitespace in new credentials',
  apiKey => {
    expect(createAiConnectionSchema.safeParse({ ...config, apiKey }).success).toBe(false);
  },
);
