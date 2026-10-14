'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import { useEffect, useRef, useState } from 'react';
import { useManualRefresh } from '@/lib/liekan/contracts/manual-refresh';
import { DialogActions, LiekanDialog } from './features/LiekanDialog';

export function ManualRefreshControl({
  showTime = true,
  beforeRefresh,
}: {
  showTime?: boolean;
  beforeRefresh?: () => Promise<unknown>;
}) {
  const i18n = useLiekanI18n();
  const reading = useManualRefresh();
  const [draftNotice, setDraftNotice] = useState(false);
  const [preparing, setPreparing] = useState<number | null>(null);
  const [prepareError, setPrepareError] = useState('');
  const activePage = useRef(reading?.page.token);
  activePage.current = reading?.page.token;
  const requestPage = useRef<number | null>(null);
  useEffect(() => {
    setDraftNotice(false);
    setPrepareError('');
  }, [reading?.page.token]);
  if (!reading) return null;
  const refreshing = reading.busy || preparing === reading.page.token;
  return (
    <div
      data-manual-reading
      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      {showTime && reading.readAt > 0 && (
        <span style={{ fontSize: 11, color: '#737373' }}>
          {i18n.fragment('本次读取：', false, true)}
          {new Date(reading.readAt).toLocaleString(i18n.locale, { hour12: false })}
        </span>
      )}
      <button
        type="button"
        className="btn chip"
        data-manual-refresh
        disabled={refreshing}
        onClick={() => {
          if (document.querySelector('[data-unsaved="true"]')) {
            setDraftNotice(true);
            return;
          }
          const pageToken = reading.page.token;
          if (requestPage.current === pageToken) return;
          requestPage.current = pageToken;
          setPreparing(pageToken);
          setPrepareError('');
          void Promise.resolve()
            .then(() => beforeRefresh?.())
            .then(() => {
              if (activePage.current !== pageToken) return;
              if (document.querySelector('[data-unsaved="true"]')) {
                setDraftNotice(true);
                return;
              }
              return reading.refresh(pageToken);
            })
            .catch(() => {
              if (activePage.current === pageToken) setPrepareError('本次读取未完成，请重试。');
            })
            .finally(() => {
              if (requestPage.current === pageToken) requestPage.current = null;
              setPreparing(value => (value === pageToken ? null : value));
            });
        }}
      >
        {refreshing ? i18n.text('正在读取') : i18n.text('刷新')}
      </button>
      {(reading.error || prepareError) && (
        <span role="status" style={{ fontSize: 11 }}>
          {i18n.system(reading.error || prepareError)}
        </span>
      )}
      {draftNotice && (
        <LiekanDialog
          title={i18n.text('当前有未保存的输入')}
          onClose={() => setDraftNotice(false)}
          protectUnsaved={false}
        >
          <p>{i18n.text('请先保存输入或关闭编辑区域，再重新读取。当前草稿继续保留。')}</p>
          <DialogActions>
            <button type="button" className="btn primary" onClick={() => setDraftNotice(false)}>
              {i18n.text('继续编辑')}
            </button>
          </DialogActions>
        </LiekanDialog>
      )}
    </div>
  );
}
