'use client';
import { useEffect, useState } from 'react';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { BOT_RULES, BOT_TYPES } from '@/lib/liekan/rules/bots';
import type { CrawlerRuleConfiguration } from '@/lib/liekan/rules/configuration';
import { parseRuleEditorDraft, previewOfficialConversion } from '@/lib/liekan/rules/editor';
import { BotRulesEditor } from './BotRulesEditor';
import { Button, Notice } from './ui';

export function CrawlerRulesEditor({
  content,
  disabled,
  onChange,
  onConversionConfirmed,
}: {
  content: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onConversionConfirmed: () => void;
}) {
  const i18n = useLiekanI18n();
  const [preview, setPreview] = useState<ReturnType<typeof previewOfficialConversion> | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [previewError, setPreviewError] = useState('');
  useEffect(() => {
    setPreview(null);
    setAcknowledged(false);
    setPreviewError('');
  }, [content]);
  let configuration: CrawlerRuleConfiguration;
  let legacyContent: string;
  try {
    configuration = JSON.parse(content);
  } catch {
    if (content.startsWith('{"mode":"legacy","rules":')) {
      configuration = { mode: 'legacy', rules: [] };
      legacyContent = content.slice('{"mode":"legacy","rules":'.length, -1);
    } else configuration = null;
  }
  const write = (value: CrawlerRuleConfiguration) => onChange(JSON.stringify(value, null, 2));
  if (!configuration?.mode) return <Notice>{i18n.text('正在读取设置')}</Notice>;
  if (configuration.mode !== 'official')
    return (
      <section className="bot-rules-editor">
        <p className="notice">
          {i18n.text(
            configuration.mode === 'legacy'
              ? '旧版顺序规则继续生效，转换后采用官方词元识别。'
              : '当前网站已停用蜘蛛识别规则。',
          )}
        </p>
        {configuration.mode === 'legacy' && (
          <BotRulesEditor
            content={legacyContent ?? JSON.stringify(configuration.rules, null, 2)}
            disabled={disabled || !!preview}
            onChange={value => {
              try {
                write({ mode: 'legacy', rules: JSON.parse(value) });
              } catch {
                onChange(`{"mode":"legacy","rules":${value}}`);
              }
            }}
          />
        )}
        <Button
          disabled={disabled || legacyContent !== undefined}
          onClick={() => {
            try {
              setPreview(previewOfficialConversion(parseRuleEditorDraft(content)));
              setAcknowledged(false);
              setPreviewError('');
            } catch (error) {
              setPreviewError(error instanceof Error ? error.message : '操作失败，请重试');
            }
          }}
        >
          {i18n.text('预览转换为官方目录')}
        </Button>
        {previewError && <Notice tone="red">{i18n.system(previewError)}</Notice>}
        {preview && (
          <section className="card" aria-label={i18n.text('规则转换预览')}>
            <h3>{i18n.text('规则转换预览')}</h3>
            <Notice tone="amber">
              {i18n.text(
                '官方规则使用词元边界匹配。旧版顺序、包含匹配及多规则冲突的结果可能变化。自定义规则保留原匹配方式，未配置的官方条目保持停用。',
              )}
            </Notice>
            <p>
              {i18n.text('新增规则：{v0}；移除规则：{v1}', [
                preview.additions.length,
                preview.removals.length,
              ])}
            </p>
            <p>{i18n.text('停用官方条目：{v0}', [preview.disabled.join(', ') || '0'])}</p>
            <p>
              {i18n.text('类型覆盖：{v0}', [
                preview.overrides.map(row => `${row.name}: ${i18n.system(row.type)}`).join(', ') ||
                  '0',
              ])}
            </p>
            <ul>
              {preview.mappings.map((mapping, index) => (
                <li key={index}>
                  {mapping.name} → {i18n.text(mapping.crawlerId ? '官方身份' : '自定义规则')} (
                  {i18n.text(mapping.matchMode === 'token' ? '词元匹配' : '文本包含')})
                </li>
              ))}
            </ul>
            <label className="check">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={disabled}
                onChange={event => setAcknowledged(event.target.checked)}
              />
              {i18n.text('已核对转换差异与匹配行为变化')}
            </label>
            <div className="row">
              <Button
                disabled={disabled || !acknowledged}
                onClick={() => {
                  write(preview.configuration);
                  onConversionConfirmed();
                  setPreview(null);
                }}
              >
                {i18n.text('确认转换草稿')}
              </Button>
              <Button onClick={() => setPreview(null)}>{i18n.text('取消')}</Button>
            </div>
          </section>
        )}
      </section>
    );
  const updateCustom = (index: number, key: string, value: string) =>
    write({
      ...configuration,
      customRules: configuration.customRules.map((rule, i) =>
        i === index ? { ...rule, [key]: value } : rule,
      ),
    } as CrawlerRuleConfiguration);
  return (
    <section className="bot-rules-editor" aria-label={i18n.text('蜘蛛识别规则编辑器')}>
      <h3>{i18n.text('官方目录与自定义规则')}</h3>
      <p className="muted">
        {i18n.text(
          '官方身份与匹配词随版本维护，可调整启用状态和类型。自定义规则默认使用词元匹配。',
        )}
      </p>
      <div className="table-wrap">
        <table className="bot-rules-table">
          <thead>
            <tr>
              {['启用', '蜘蛛名称', '厂商', '类型', 'UA 匹配词'].map(label => (
                <th key={label}>{i18n.system(label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BOT_RULES.map(rule => (
              <tr key={rule.crawlerId}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={i18n.text('启用 {v0}', [rule.name])}
                    disabled={disabled}
                    checked={!configuration.disabledIds.includes(rule.crawlerId)}
                    onChange={event =>
                      write({
                        ...configuration,
                        disabledIds: event.target.checked
                          ? configuration.disabledIds.filter(id => id !== rule.crawlerId)
                          : [...configuration.disabledIds, rule.crawlerId],
                      })
                    }
                  />
                </td>
                <td>{rule.name}</td>
                <td>{rule.vendor}</td>
                <td>
                  <select
                    aria-label={i18n.text('{v0} 类型', [rule.name])}
                    disabled={disabled}
                    value={configuration.overrides[rule.crawlerId]?.type || rule.type}
                    onChange={event => {
                      const overrides = { ...configuration.overrides };
                      if (event.target.value === rule.type) delete overrides[rule.crawlerId];
                      else
                        overrides[rule.crawlerId] = {
                          type: event.target.value as (typeof BOT_TYPES)[number],
                        };
                      write({ ...configuration, overrides });
                    }}
                  >
                    {BOT_TYPES.map(type => (
                      <option value={type} key={type}>
                        {i18n.system(type)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <code>{rule.pattern}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>{i18n.text('自定义规则')}</h3>
      <div className="table-wrap">
        <table className="bot-rules-table">
          <thead>
            <tr>
              {['蜘蛛名称', '厂商', '类型', 'UA 匹配词', '匹配方式', '操作'].map(label => (
                <th key={label}>{i18n.system(label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {configuration.customRules.map((rule, index) => (
              <tr key={index}>
                {['name', 'vendor'].map(key => (
                  <td key={key}>
                    <input
                      aria-label={i18n.text('自定义第 {v0} 条{v1}', [
                        index + 1,
                        i18n.system(key === 'name' ? '蜘蛛名称' : '厂商'),
                      ])}
                      value={rule[key]}
                      maxLength={80}
                      disabled={disabled}
                      onChange={event => updateCustom(index, key, event.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <select
                    aria-label={i18n.text('自定义第 {v0} 条类型', [index + 1])}
                    value={rule.type}
                    disabled={disabled}
                    onChange={event => updateCustom(index, 'type', event.target.value)}
                  >
                    {BOT_TYPES.map(type => (
                      <option value={type} key={type}>
                        {i18n.system(type)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={i18n.text('自定义第 {v0} 条 UA 匹配词', [index + 1])}
                    value={rule.pattern}
                    maxLength={80}
                    disabled={disabled}
                    onChange={event => updateCustom(index, 'pattern', event.target.value)}
                  />
                </td>
                <td>
                  <select
                    aria-label={i18n.text('自定义第 {v0} 条匹配方式', [index + 1])}
                    value={rule.matchMode}
                    disabled={disabled}
                    onChange={event => updateCustom(index, 'matchMode', event.target.value)}
                  >
                    <option value="token">{i18n.text('词元匹配')}</option>
                    <option value="literal">{i18n.text('文本包含')}</option>
                  </select>
                </td>
                <td>
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      write({
                        ...configuration,
                        customRules: configuration.customRules.filter((_, i) => i !== index),
                      })
                    }
                  >
                    {i18n.text('移除')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        disabled={disabled || configuration.customRules.length >= 100}
        onClick={() =>
          write({
            ...configuration,
            customRules: [
              ...configuration.customRules,
              { name: '', vendor: '', type: '其他', pattern: '', matchMode: 'token' },
            ],
          })
        }
      >
        {i18n.text('添加识别规则')}
      </Button>
    </section>
  );
}
