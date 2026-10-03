'use client';
import { useEffect, useRef, useState } from 'react';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  EXPORT_MAX_BYTES,
  exportSections,
  type ExportFrame,
  type ExportRequest,
} from '@/lib/liekan/contracts/exports';
import { streamFeatureExport } from '@/lib/liekan/upstream/features-client';
import { useFeature } from './context';
import {
  Badge,
  Body,
  Button,
  Check,
  Code,
  Definition,
  Drawer,
  Field,
  Form,
  Icon,
  Notice,
  Panel,
  Select,
} from './ui';

export function Exports() {
  const c = useFeature();
  const [format, setFormat] = useState<ExportRequest['format']>('zip');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ stage: '正在查询所选数据', percent: 0 });
  const [error, setError] = useState('');
  const [file, setFile] = useState<{ url: string; name: string; manifest: any } | null>(null);
  const [manifestOpen, setManifestOpen] = useState(false);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(file.url);
    },
    [file],
  );
  const cancel = () => {
    generation.current++;
    controller.current?.abort();
    setStatus('idle');
    setError('导出已取消，可以重新选择范围。');
  };
  return (
    <div className="wide-narrow">
      <Panel title="创建导出任务" subtitle="选择真实数据范围，文件生成与下载在本次请求内完成。">
        <Body>
          <Form
            busy={status === 'working'}
            error={error}
            submitLabel="生成导出文件"
            onSubmit={async (values: any) => {
              const startAt = +fromZonedTime(`${values.start}T00:00:00.000`, c.range.timezone),
                endAt = +fromZonedTime(`${values.end}T23:59:59.999`, c.range.timezone);
              if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt)
                throw new Error('日期范围无效');
              const sections =
                format === 'zip'
                  ? exportSections.filter(section => values[section] === 'on')
                  : ['summary' as const];
              if (!sections.length) throw new Error('至少选择一项数据范围');
              controller.current?.abort();
              controller.current = new AbortController();
              const run = ++generation.current;
              setFile(null);
              setError('');
              setStatus('working');
              setProgress({ stage: '正在查询并校验数据量', percent: 0 });
              const chunks: Uint8Array[] = [];
              let meta: Extract<ExportFrame, { type: 'file' }> | null = null,
                received = 0,
                complete = false;
              try {
                await streamFeatureExport(
                  values.website,
                  {
                    startAt,
                    endAt,
                    timezone: c.range.timezone,
                    format,
                    sections,
                    filters: c.filters,
                  },
                  controller.current.signal,
                  frame => {
                    if (run !== generation.current) return;
                    if (frame.type === 'progress')
                      setProgress({ stage: frame.stage, percent: frame.percent });
                    if (frame.type === 'file') {
                      if (frame.size > EXPORT_MAX_BYTES) throw new Error('下载文件超过 50 MiB');
                      meta = frame;
                    }
                    if (frame.type === 'chunk') {
                      const bytes = Uint8Array.from(atob(frame.data), char => char.charCodeAt(0));
                      received += bytes.length;
                      if (received > EXPORT_MAX_BYTES) throw new Error('下载文件超过 50 MiB');
                      chunks.push(bytes);
                    }
                    if (frame.type === 'complete') complete = true;
                  },
                );
                if (run !== generation.current) return;
                const result = meta as Extract<ExportFrame, { type: 'file' }> | null;
                if (!complete || !result || result.size !== received)
                  throw new Error('文件传输未完成，请重新生成');
                const blob = new Blob(chunks as BlobPart[], { type: result.mime });
                setFile({
                  url: URL.createObjectURL(blob),
                  name: result.name,
                  manifest: result.manifest,
                });
                setStatus('done');
              } catch (e: any) {
                if (run !== generation.current) return;
                setError(e.name === 'AbortError' ? '导出已取消' : e.message || '导出失败');
                setStatus('idle');
              }
            }}
          >
            <Select
              label="导出网站"
              name="website"
              defaultValue={c.siteId}
              options={c.sites.map(site => [site.id, site.name])}
              required
            />
            <div className="form-grid">
              <Field
                label="开始日期"
                name="start"
                type="date"
                required
                defaultValue={formatInTimeZone(c.range.startAt, c.range.timezone, 'yyyy-MM-dd')}
              />
              <Field
                label="结束日期"
                name="end"
                type="date"
                required
                defaultValue={formatInTimeZone(c.range.endAt, c.range.timezone, 'yyyy-MM-dd')}
              />
            </div>
            <h3>数据范围</h3>
            <div className="two">
              {exportSections.map((section, i) => (
                <Check
                  key={section}
                  name={section}
                  defaultChecked={section !== 'sessions'}
                  disabled={format !== 'zip'}
                >
                  {['汇总指标', '页面与来源', '事件与属性', '访问记录（脱敏）', '已保存配置'][i]}
                </Check>
              ))}
            </div>
            <Select
              label="文件格式"
              name="format"
              value={format}
              onChange={e => setFormat(e.target.value as ExportRequest['format'])}
              options={[
                ['zip', 'ZIP：CSV 与字段清单'],
                ['csv', 'CSV：汇总指标'],
                ['json', 'JSON：汇总与字段清单'],
              ]}
            />
            <Notice tone="amber">
              CSV 与 JSON 使用汇总范围；ZIP 按勾选项导出。明细上限 100,000 行，未压缩内容上限 50
              MiB。超出范围时明确报错。文件不包含原始 IP 或账户凭据。
            </Notice>
          </Form>
        </Body>
      </Panel>
      <Panel title="导出任务" subtitle="显示当前请求的生成与传输状态。">
        <Body>
          {status === 'idle' ? (
            <div className="state-box" style={{ border: 0, padding: '24px 0' }}>
              <h3>还没有导出任务</h3>
              <p>左侧选择范围并生成文件。</p>
            </div>
          ) : status === 'working' ? (
            <div className="stack">
              <div className="row between">
                <strong>{progress.stage}</strong>
                <span className="num">{progress.percent}%</span>
              </div>
              <div className="progress">
                <i style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="muted">校验范围 → 整理字段 → 生成文件 → 传输下载</p>
              <Button onClick={cancel}>取消导出</Button>
            </div>
          ) : (
            file && (
              <div className="stack">
                <Badge tone="green">文件已就绪</Badge>
                <Definition
                  items={[
                    ['网站', file.manifest.website.name],
                    [
                      '范围',
                      `${formatInTimeZone(file.manifest.range.startAt, c.range.timezone, 'yyyy-MM-dd')} 至 ${formatInTimeZone(file.manifest.range.endAt, c.range.timezone, 'yyyy-MM-dd')}`,
                    ],
                    ['格式', file.manifest.format.toUpperCase()],
                    ['敏感字段', '不包含原始 IP 或账户凭据'],
                    ['数据性质', '当前网站的真实统计数据'],
                  ]}
                />
                <a className="btn primary" href={file.url} download={file.name}>
                  <Icon name="download" />
                  下载导出文件
                </a>
                <Button onClick={() => setManifestOpen(true)}>查看字段清单</Button>
              </div>
            )
          )}
        </Body>
      </Panel>
      {manifestOpen && file && (
        <Drawer title="导出字段清单" onClose={() => setManifestOpen(false)}>
          <Code>{JSON.stringify(file.manifest, null, 2)}</Code>
        </Drawer>
      )}
    </div>
  );
}
