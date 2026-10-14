'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import { useState } from 'react';
import { botRuleTypes, type EditableBotRule } from '@/lib/liekan/contracts/management';
import { Button, Notice } from './ui';

export function BotRulesEditor({
  content,
  onChange,
  disabled,
}: {
  content: string;
  onChange: (content: string) => void;
  disabled: boolean;
}) {
  const i18n = useLiekanI18n();
  const [raw, setRaw] = useState(false);
  let rules: EditableBotRule[] | null = null;
  try {
    const parsed = JSON.parse(content);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        rule =>
          rule &&
          typeof rule === 'object' &&
          !Array.isArray(rule) &&
          ['name', 'vendor', 'type', 'pattern'].every(key => typeof rule[key] === 'string'),
      )
    )
      rules = parsed;
  } catch {
    /* Invalid drafts stay available in the JSON editor. */
  }
  const write = (next: EditableBotRule[]) => onChange(JSON.stringify(next, null, 2));
  const update = (index: number, key: string, value: string) =>
    write(rules.map((rule, i) => (i === index ? { ...rule, [key]: value } : rule)));
  return (
    <section className="bot-rules-editor" aria-label={i18n.text('蜘蛛识别规则编辑器')}>
      <div className="row between">
        <div>
          <h3>{i18n.text('蜘蛛识别规则')}</h3>
          <p className="muted">{i18n.text('按顺序匹配 User-Agent 中的文本，忽略大小写。')}</p>
        </div>
        <Button disabled={disabled || !rules} onClick={() => setRaw(!raw)}>
          {raw ? i18n.text('条目编辑') : i18n.text('高级 JSON 编辑')}
        </Button>
      </div>
      {raw || !rules ? (
        <label className="field">
          <span>{i18n.text('规则 JSON')}</span>
          <textarea
            value={content}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            spellCheck={false}
            rows={14}
          />
          {!rules && content && (
            <Notice tone="red">{i18n.text('规则格式无效，请在 JSON 编辑区修正。')}</Notice>
          )}
        </label>
      ) : (
        <>
          <div className="table-wrap">
            <table className="bot-rules-table">
              <thead>
                <tr>
                  <th>{i18n.text('蜘蛛名称')}</th>
                  <th>{i18n.text('厂商')}</th>
                  <th>{i18n.text('类型')}</th>
                  <th>{i18n.text('UA 匹配词')}</th>
                  <th>{i18n.text('顺序与操作')}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, i) => (
                  <tr key={i}>
                    {['name', 'vendor'].map(key => (
                      <td key={key}>
                        <input
                          aria-label={i18n.text('第 {v0} 条{v1}', [
                            i + 1,
                            key === 'name' ? i18n.text('蜘蛛名称') : i18n.text('厂商'),
                          ])}
                          value={String(rule[key] ?? '')}
                          maxLength={80}
                          disabled={disabled}
                          onChange={e => update(i, key, e.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      <select
                        aria-label={i18n.text('第 {v0} 条类型', [i + 1])}
                        value={String(rule.type ?? '')}
                        disabled={disabled}
                        onChange={e => update(i, 'type', e.target.value)}
                      >
                        {!botRuleTypes.some(type => type === rule.type) && (
                          <option value={rule.type}>
                            {rule.type || i18n.text('请选择')}
                          </option>
                        )}
                        {botRuleTypes.map(type => (
                          <option key={type} value={type}>
                            {i18n.system(type)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={i18n.text('第 {v0} 条 UA 匹配词', [i + 1])}
                        value={String(rule.pattern ?? '')}
                        maxLength={80}
                        disabled={disabled}
                        onChange={e => update(i, 'pattern', e.target.value)}
                      />
                    </td>
                    <td>
                      <div className="row">
                        <Button
                          aria-label={i18n.text('上移第 {v0} 条规则', [i + 1])}
                          disabled={disabled || i === 0}
                          onClick={() => {
                            const next = [...rules];
                            [next[i - 1], next[i]] = [next[i], next[i - 1]];
                            write(next);
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          aria-label={i18n.text('下移第 {v0} 条规则', [i + 1])}
                          disabled={disabled || i === rules.length - 1}
                          onClick={() => {
                            const next = [...rules];
                            [next[i + 1], next[i]] = [next[i], next[i + 1]];
                            write(next);
                          }}
                        >
                          ↓
                        </Button>
                        <Button
                          aria-label={i18n.text('移除第 {v0} 条规则', [i + 1])}
                          disabled={disabled}
                          onClick={() => write(rules.filter((_, index) => index !== i))}
                        >
                          {i18n.text('移除')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rules.length && (
            <Notice>{i18n.text('尚未配置识别规则，可添加条目或导入 JSON。')}</Notice>
          )}
          <Button
            disabled={disabled || rules.length >= 100}
            onClick={() => write([...rules, { name: '', vendor: '', type: '其他', pattern: '' }])}
          >
            {i18n.text('添加识别规则')}
          </Button>
        </>
      )}
      <p className="field-help">
        {i18n.text('最多 100 条，每个字段最多 80 个字符。原有扩展字段和条目顺序随配置保存。')}
      </p>
    </section>
  );
}
