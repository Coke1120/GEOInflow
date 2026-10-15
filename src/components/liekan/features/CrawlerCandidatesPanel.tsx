'use client';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/liekan/upstream/client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import type { CrawlerCandidatesResponse } from '@/lib/liekan/contracts/crawler-maintenance';
import { Button, Notice, Table } from './ui';

export function CrawlerCandidatesPanel({ websiteId }: { websiteId: string }) {
  const api = useApi(),
    i18n = useLiekanI18n();
  const [result, setResult] = useState<{
    websiteId: string;
    requester: typeof api.get;
    data: CrawlerCandidatesResponse;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult(null);
    setError(false);
    setBusy(false);
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [websiteId, api.get]);
  const data = result?.websiteId === websiteId && result.requester === api.get ? result.data : null;
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'short', timeStyle: 'short' }).format(
          new Date(value),
        )
      : '—';
  async function check() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError(false);
    setResult(null);
    try {
      const data = await api.get(
        `/liekan/websites/${websiteId}/crawler-candidates`,
        {},
        {},
        current.signal,
      );
      if (!current.signal.aborted) setResult({ websiteId, requester: api.get, data });
    } catch {
      if (!current.signal.aborted) setError(true);
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }
  return (
    <section aria-label={i18n.text('未知名称候选')}>
      <h3>{i18n.text('未知名称候选')}</h3>
      <p className="field-help">
        {i18n.text(
          '检查最近七天的未知请求，最多扫描 100000 条，显示 100 个名称候选。候选需人工核对，不会自动加入识别规则。',
        )}
      </p>
      <Button disabled={busy || !websiteId} onClick={check}>
        {busy ? i18n.text('正在检查候选') : i18n.text('查看未知名称候选')}
      </Button>
      {error || data?.state === 'unavailable' ? (
        <Notice tone="amber">{i18n.text('本次候选查询未完成，请稍后重试。')}</Notice>
      ) : (
        data && (
          <>
            <p className="field-help">
              {i18n.text('已扫描 {v0} 条；实际时间：{v1} 至 {v2}', [
                data.scannedRows,
                date(data.scannedStart),
                date(data.scannedEnd),
              ])}
            </p>
            {data.partial && (
              <Notice tone="amber">
                {i18n.text('部分样本：已达到查询预算，结果仅代表已扫描范围。')}
              </Notice>
            )}
            <Table
              mobile
              columns={['名称候选', '请求次数', '首次出现', '最后出现'].map(text =>
                i18n.system(text),
              )}
              rows={data.items.map(item => [
                item.token,
                item.count,
                date(item.firstSeen),
                date(item.lastSeen),
              ])}
              rowKeys={data.items.map(item => item.token)}
              numeric={[1]}
              empty={i18n.text('已扫描样本中没有可展示的名称候选')}
            />
          </>
        )
      )}
    </section>
  );
}
