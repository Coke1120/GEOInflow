import { expect, it } from 'vitest';
import { aiRegionDisplayName, aiTemplateDisplayName } from './ai-display';
import { translateSystemText } from '../i18n/text';
const display = (source: string) => translateSystemText(source, 'en-US');
const template = {
  id: 'qwen',
  provider: 'qwen',
  protocol: 'openai-chat',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus',
  region: '北京',
};
it('only localizes a region backed by a matching official endpoint, model and protocol', () => {
  expect(aiRegionDisplayName([template], template, display)).toBe('Beijing');
  for (const patch of [
    { model: 'custom' },
    { protocol: 'custom' },
    { baseUrl: 'https://custom.example.com' },
    { provider: 'custom' },
    { region: '网站管理' },
  ])
    expect(aiRegionDisplayName([template], { ...template, ...patch }, display)).toBe(
      patch.region || '北京',
    );
  expect(aiRegionDisplayName([{ ...template, id: 'custom' }], template, display)).toBe('北京');
  expect(aiRegionDisplayName([template], { ...template, region: null }, display)).toBe('Unknown');
});
it('uses the canonical custom template ID and preserves supplier names', () => {
  expect(aiTemplateDisplayName({ id: 'custom', name: '自定义兼容接口' }, display)).toBe(
    'Custom compatible API',
  );
  expect(aiTemplateDisplayName({ id: 'qwen', name: '阿里云百炼' }, display)).toBe('阿里云百炼');
});
