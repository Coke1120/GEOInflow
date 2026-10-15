import { describe, expect, it } from 'vitest';
import {
  csvText,
  formatCellValue,
  isLiekanRoute,
  isWebsiteLanding,
  selectRows,
  tableCsv,
} from './data';
import { translateText } from '@/lib/liekan/i18n/text';

describe('Liekan route boundary', () => {
  it('recognizes all geo paths and team-scoped variants', () => {
    expect(isLiekanRoute('/websites/abc/geo')).toBe(true);
    expect(isLiekanRoute('/teams/team/websites/abc/geo/ai/bots')).toBe(true);
    expect(isLiekanRoute('/websites/abc')).toBe(false);
    expect(isLiekanRoute('/websites/abc/geography')).toBe(false);
  });
});
it('redirects only the exact website landing and preserves the settings route', () => {
  const id = '67a8e084-de35-5f1c-a2b0-8f2732f830bf';
  expect(isWebsiteLanding(`/websites/${id}`)).toBe(true);
  expect(isWebsiteLanding(`/teams/${id}/websites/${id}`)).toBe(true);
  expect(isWebsiteLanding(`/settings/websites/${id}`)).toBe(false);
  expect(isWebsiteLanding(`/websites/${id}/geo`)).toBe(false);
});
describe('report selection and CSV export', () => {
  it.each(['topBody', 'apBody'])(
    'retains the main crawler identity in %s display and CSV',
    table => {
      const display = (value: string) => translateText(value, 'en-US');
      const rows = [
        { path: '/official', bot: 'GPTBot', botId: 'gptbot' },
        { path: '/custom', bot: 'GPTBot', botId: null },
      ];
      expect(formatCellValue(rows[0], 'bot', table, 'en-US', display)).toBe(
        'GPTBot / Official identity',
      );
      expect(formatCellValue(rows[1], 'bot', table, 'en-US', display)).toBe(
        'GPTBot / Custom / historical unmapped',
      );
      expect(formatCellValue({ bot: 'GPTBot' }, 'bot', table, 'en-US', display)).toBe('GPTBot');
      const csv = tableCsv(
        table,
        rows,
        '全部',
        { label: '', direction: 1 },
        '',
        undefined,
        'en-US',
        display,
      );
      expect(csv).toContain('GPTBot / Official identity');
      expect(csv).toContain('GPTBot / Custom / historical unmapped');
    },
  );
  it.each(['zh-CN', 'en-US'] as const)(
    'distinguishes same-name official and custom identities in %s CSV',
    locale => {
      const row = { name: 'GPTBot', vendor: 'OpenAI', type: '训练', requests: 9 };
      const rows = [
        { ...row, botId: 'gptbot' },
        { ...row, botId: null },
      ];
      const original = JSON.stringify(rows);
      const display = (value: string) => translateText(value, locale);
      const csv = tableCsv(
        'botBody',
        rows,
        '全部',
        { label: '', direction: 1 },
        '',
        undefined,
        locale,
        display,
      );
      const lines = csv.split('\r\n');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain('GPTBot / OpenAI');
      expect(lines[2]).toContain('GPTBot / OpenAI');
      expect(lines[1]).toContain(display('官方身份'));
      expect(lines[2]).toContain(display('自定义／历史未映射'));
      expect(lines[1]).not.toBe(lines[2]);
      expect(formatCellValue(row, 'name', 'botBody', locale, display)).toBe('GPTBot / OpenAI');
      expect(JSON.stringify(rows)).toBe(original);
    },
  );
  it('formats only provenance-marked source labels and keeps the marker outside CSV columns', () => {
    const owned = { source: '直接访问', sourceLabel: 'direct', sessions: 3 };
    const supplied = { source: '直接访问', referrer: '直接访问', sessions: 7 };
    const display = (source: string) => translateText(source, 'en-US');
    expect(formatCellValue(owned, 'source', 'srcBody', 'en-US', display)).toBe('Direct traffic');
    expect(formatCellValue(supplied, 'source', 'srcBody', 'en-US', display)).toBe('直接访问');
    const csv = tableCsv(
      'srcBody',
      [owned, supplied],
      '全部',
      { label: '', direction: 1 },
      '',
      undefined,
      'en-US',
      display,
    );
    expect(csv).toContain('Direct traffic');
    expect(csv).toContain('直接访问');
    expect(csv).not.toContain('sourceLabel');
    expect(tableCsv('srcBody', [owned], '全部', { label: '', direction: 1 })).toContain('直接访问');
  });
  it('exports English headers and durations while preserving raw names, selection and legacy output', () => {
    const rows = [
      { city: '未审核城镇', sessions: 1, duration: 75 },
      { city: '另一城市', sessions: 5, duration: 120 },
    ];
    const sort = { label: '会话', direction: -1 };
    const original = JSON.stringify(rows);
    const english = tableCsv('cityBody', rows, '全部', sort, '未审核', undefined, 'en-US', source =>
      translateText(source, 'en-US'),
    );
    expect(english).toContain('"City"');
    expect(english).toContain('"未审核城镇"');
    expect(english).toContain('"1m 15s"');
    expect(english).not.toContain('另一城市');
    const legacy = tableCsv('cityBody', rows, '全部', sort, '未审核');
    expect(legacy).toContain('"城市"');
    expect(legacy).toContain('"1分15秒"');
    expect(JSON.stringify(rows)).toBe(original);
  });
  it('filters classifications and sorts numeric values without mutating data', () => {
    const rows = [
      { name: 'GPTBot', type: 'AI 训练', requests: 3 },
      { name: 'ClaudeBot', type: 'AI 训练', requests: 12 },
      { name: 'Googlebot', type: '传统搜索', requests: 5 },
    ];
    expect(
      selectRows(rows, 'AI 训练', { label: '所选期间抓取', direction: -1 }, 'botBody').map(
        row => row.name,
      ),
    ).toEqual(['ClaudeBot', 'GPTBot']);
    expect(rows[0].name).toBe('GPTBot');
  });
  it('retains missing values and escapes spreadsheet formula cells, quotes, and Chinese content', () => {
    const text = csvText([{ path: '=HYPERLINK("x")', count: null, name: '猎看统计' }]);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('"\'=HYPERLINK(""x"")"');
    expect(text).toContain('"猎看统计"');
    expect(text).toContain(',"",');
  });
  it('filters imported logs by query and abnormal status', () => {
    const rows = [
      { path: '/missing', status: 404, classification: 'human' },
      { path: '/product', status: 200, classification: 'AI 训练' },
    ];
    expect(selectRows(rows, '仅异常', { label: '', direction: -1 }, 'logBody', 'missing')).toEqual([
      rows[0],
    ]);
  });
  it('keeps user-triggered AI logs by structured bot type regardless of display names', () => {
    const rows = [
      { classification: 'GPTBot · 身份未核验', botType: '训练' },
      { classification: 'OAI-SearchBot · 身份未核验', botType: '搜索' },
      { classification: 'ChatGPT-User · 官方 IP 范围匹配', botType: '用户触发' },
      { classification: 'Claude-User · 身份未核验', botType: '用户触发' },
      { classification: 'Perplexity-User · 官方范围未匹配', botType: '用户触发' },
      { classification: 'Googlebot · 身份未核验', botType: '传统搜索' },
      { classification: '未知/其他', botType: '其他' },
      { classification: 'AI spider display text', botType: '其他' },
    ];
    expect(selectRows(rows, '仅 AI 蜘蛛', { label: '', direction: -1 }, 'logBody')).toEqual(
      rows.slice(0, 5),
    );
    const csv = tableCsv('logBody', rows, '仅 AI 蜘蛛', { label: '', direction: -1 });
    expect(csv).toContain('ChatGPT-User');
    expect(csv).toContain('Claude-User');
    expect(csv).toContain('Perplexity-User');
    expect(csv).not.toContain('Googlebot');
    expect(csv).not.toContain('AI spider display text');
  });
  it('matches backend bot types to the original training and AI search controls', () => {
    const rows = [
      { name: 'GPTBot', type: '训练' },
      { name: 'OAI-SearchBot', type: '搜索' },
      { name: 'Googlebot', type: '传统搜索' },
    ];
    expect(selectRows(rows, 'AI 训练', { label: '', direction: -1 }, 'botBody')).toEqual([rows[0]]);
    expect(selectRows(rows, 'AI 搜索', { label: '', direction: -1 }, 'botBody')).toEqual([rows[1]]);
  });
  it('exports only Chinese screen columns with the displayed units and ordering', () => {
    const rows = [
      {
        source: 'a',
        channel: 'AI 搜索引荐',
        sessions: 10,
        share: 25,
        bounceRate: 20,
        conversionRate: 2.5,
        trend: 10,
        secret: 'hidden',
      },
      { source: 'b', sessions: 20, duration: 60 },
    ];
    const csv = tableCsv('srcBody', rows, '', { label: '会话', direction: -1 });
    expect(csv.split('\r\n')[0]).toBe(
      '\uFEFF"来源","渠道归类","会话","占比","跳出率","转化率","环比"',
    );
    expect(csv.split('\r\n')[1]).toContain('"b"');
    expect(csv).toContain('"25%","20%","2.5%","\'+10%"');
    expect(csv).not.toContain('secret');
    expect(csv).not.toContain('hidden');
    expect(
      tableCsv('cityBody', [{ city: '上海', sessions: 1, duration: 75 }], '', {
        label: '',
        direction: -1,
      }),
    ).toContain('"1分15秒"');
  });
  it('keeps Chinese headers when no records match and never substitutes metrics', () => {
    const csv = tableCsv('botBody', [{ name: 'GPTBot', type: '训练' }], '传统搜索', {
      label: '',
      direction: -1,
    });
    expect(csv.split('\r\n')).toHaveLength(1);
    expect(csv).toContain('蜘蛛 / 厂商');
    expect(csv).not.toContain('GPTBot');
  });
});
it('keeps explicit AI eligibility separate from display type and known-other identity', () => {
  const rows = [
    { bot: 'GPTBot', botType: '其他', aiEligible: true, recognitionState: 'recognized' },
    {
      bot: 'Google-InspectionTool',
      botType: '用户触发',
      aiEligible: false,
      recognitionState: 'recognized',
    },
    { bot: '其他', botType: '其他', aiEligible: false, recognitionState: 'recognized' },
    { bot: '其他', botType: '其他', aiEligible: false, recognitionState: 'unknown' },
    { bot: '其他', botType: '其他', aiEligible: false, recognitionState: 'ambiguous' },
  ];
  expect(selectRows(rows, '仅 AI 蜘蛛', { label: '', direction: 1 }, 'logBody')).toEqual([rows[0]]);
  expect(selectRows(rows, '未知／未分类', { label: '', direction: 1 }, 'logBody')).toEqual(
    rows.slice(3),
  );
});
it('filters other-known and user-triggered rows consistently in CSV with period-specific headings', () => {
  const rows = [
    { name: 'CCBot', type: '其他', requests: 8 },
    { name: 'Claude-User', type: '用户触发', requests: 3 },
  ];
  expect(selectRows(rows, '其他已知', { label: '所选期间抓取', direction: -1 }, 'botBody')).toEqual(
    [rows[0]],
  );
  const csv = tableCsv('botBody', rows, '用户触发', { label: '所选期间抓取', direction: -1 });
  expect(csv).toContain('所选期间抓取');
  expect(csv).toContain('Claude-User');
  expect(csv).not.toContain('CCBot');
});
