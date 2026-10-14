import { expect, it } from 'vitest';
import { classifyEntrySource, classifyEntrySourceForDisplay } from './sources';

it('marks generated direct labels from missing entry fields while preserving classifier compatibility', () => {
  for (const entry of [
    {},
    { referrer: null },
    { referrer: '  ', utmSource: '', utmMedium: '\t' },
    { utmCampaign: 'campaign-only' },
  ]) {
    expect(classifyEntrySourceForDisplay(entry)).toEqual({
      source: '直接访问',
      channel: '直接访问',
      sourceLabel: 'direct',
    });
    expect(classifyEntrySource(entry)).toEqual({ source: '直接访问', channel: '直接访问' });
  }
});
it('preserves supplied names that collide with owned labels and keeps medium attribution unmarked', () => {
  for (const name of ['直接访问', '网站管理', '未提供']) {
    expect(classifyEntrySourceForDisplay({ referrer: name }).source).toBe(name);
    expect(classifyEntrySourceForDisplay({ referrer: name })).not.toHaveProperty('sourceLabel');
    expect(classifyEntrySourceForDisplay({ utmSource: name }).source).toBe(name);
    expect(classifyEntrySourceForDisplay({ utmSource: name })).not.toHaveProperty('sourceLabel');
  }
  expect(classifyEntrySourceForDisplay({ utmMedium: 'email' })).toEqual({
    source: 'UTM / email',
    channel: '其他引荐',
  });
});
