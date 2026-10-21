'use client';
import { useEffect, useState } from 'react';
import type { HistoryRepairList } from '@/lib/liekan/contracts/history-repair';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { useNavigation } from '@/lib/liekan/upstream/client';
import { featureApi } from '@/lib/liekan/upstream/features-client';
import Link from '@/components/liekan/Link';
import { Button, DialogActions, LiekanDialog, Notice } from './ui';

export function HistoryRepairNotice({ userId }: { userId: string }) {
  const i18n = useLiekanI18n();
  const { pathname } = useNavigation();
  const [notice, setNotice] = useState<{ owner: string; data: HistoryRepairList }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    setNotice(undefined);
    setError('');
    let fetching = false;
    const refresh = async () => {
      if (!userId || document.hidden || fetching || abort.signal.aborted) return;
      fetching = true;
      try {
        const data = await featureApi.get<HistoryRepairList>(
          '/liekan/history-repair',
          undefined,
          abort.signal,
        );
        if (
          !abort.signal.aborted &&
          data.supported &&
          (data.unreadCompletion || (!data.dismissed && data.hasEligibleData))
        )
          setNotice({ owner: userId, data });
      } catch {
        /* Optional upgrade guidance never blocks ordinary reports. */
      } finally {
        fetching = false;
      }
    };
    void refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      abort.abort();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [userId, pathname]);
  if (!notice || notice.owner !== userId) return null;
  const completed = notice.data.unreadCompletion;
  async function acknowledge() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await featureApi.put('/liekan/history-repair', {
        campaignId: notice.data.campaignId,
        action: completed ? 'read' : 'dismiss',
      });
      setNotice(undefined);
    } catch (e: any) {
      setError(e.message || i18n.text('操作失败'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <LiekanDialog
      title={i18n.text(completed ? '历史数据修复已完成' : '升级后可检查历史数据')}
      protectUnsaved={false}
      onClose={() => {
        void acknowledge();
      }}
    >
      <Notice>
        {i18n.text(
          completed
            ? '后台修复已完成，可以查看每日结果、证据覆盖和操作记录。已有报表请手动刷新以读取最新统计。'
            : '本次升级更新了爬虫识别与访客过滤规则。你可以选择网站，扫描旧数据并预览影响，再确认是否生效。',
        )}
      </Notice>
      <p>{i18n.text('可从网站管理或网站设置中的“历史数据修复”入口随时查看。')}</p>
      {error && <Notice tone="red">{i18n.system(error)}</Notice>}
      <DialogActions>
        <Button disabled={busy} onClick={acknowledge}>
          {i18n.text(completed ? '知道了' : '稍后处理')}
        </Button>
        <Link
          prefetch={false}
          className="btn primary"
          href={`/settings/data-repair${completed ? '?tab=history' : ''}`}
          onClick={() => {
            void acknowledge();
          }}
        >
          {i18n.text(completed ? '查看修复记录' : '查看历史数据修复')}
        </Link>
      </DialogActions>
    </LiekanDialog>
  );
}
