import { describe, expect, it } from 'vitest';
import { parseEditableAllowlist, parseEditableRules } from './management';

const rule = { name: 'ExampleBot', vendor: 'Example', type: '搜索', pattern: 'ExampleBot' };
describe('editable website settings', () => {
  it('preserves rule order and extension fields', () => {
    const rules = [
      { ...rule, extension: { confidence: 'verified' } },
      { ...rule, name: 'Second' },
    ];
    expect(parseEditableRules(JSON.stringify(rules))).toEqual(rules);
  });
  it.each([
    ['{', 'JSON 格式无效'],
    ['{}', 'JSON 数组'],
    [JSON.stringify([{ ...rule, pattern: '' }]), '第 1 条规则的UA 匹配词'],
    [JSON.stringify([{ ...rule, name: 'a'.repeat(81) }]), '第 1 条规则的蜘蛛名称'],
    [JSON.stringify([{ ...rule, type: 'unsupported' }]), '第 1 条规则类型无效'],
    [JSON.stringify(Array(101).fill(rule)), '最多 100 条'],
  ])('rejects invalid rules without changing the draft', (input, message) => {
    expect(() => parseEditableRules(input)).toThrow(message);
  });
  it('locates invalid CIDR by original input line and preserves valid IPv4 and IPv6 entries', () => {
    expect(parseEditableAllowlist(' 192.0.2.0/24\n\n2001:db8::/32 ')).toEqual([
      '192.0.2.0/24',
      '2001:db8::/32',
    ]);
    expect(() => parseEditableAllowlist('192.0.2.0/24\n\ninvalid')).toThrow('第 3 行 CIDR 无效');
    expect(() => parseEditableAllowlist(Array(101).fill('192.0.2.0/24').join('\n'))).toThrow(
      '最多 100 条',
    );
  });
});
