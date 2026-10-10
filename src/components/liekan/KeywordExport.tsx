'use client';
import { useEffect, useRef, useState } from 'react';
import { EXPORT_MAX_BYTES, type ExportFrame } from '@/lib/liekan/contracts/exports';
import type { KeywordConditions } from '@/lib/liekan/contracts/keywords';
import { streamFeatureExport } from '@/lib/liekan/upstream/features-client';
import { useFeatureAppState } from '@/lib/liekan/upstream/client';
import type { LiekanReport } from './types';

export function KeywordExport({
  report,
  conditions,
  disabled,
}: {
  report?: LiekanReport;
  conditions: KeywordConditions;
  disabled: boolean;
}) {
  const userId = useFeatureAppState(state => state.user?.id);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController>(null);
  const identity = JSON.stringify([userId, report?.website.id, report?.range, conditions]);
  const current = useRef(identity);
  current.current = identity;
  useEffect(() => {
    setWorking(false);
    setMessage('');
    return () => controller.current?.abort();
  }, [identity]);
  async function download() {
    if (!report || working) return;
    const owner = identity;
    const run = new AbortController();
    controller.current = run;
    setWorking(true);
    setMessage('正在查询全部筛选结果');
    const chunks: Uint8Array[] = [];
    let file: Extract<ExportFrame, { type: 'file' }> | undefined;
    let bytes = 0;
    try {
      await streamFeatureExport(
        report.website.id,
        { kind: 'source-keywords', format: 'csv', ...report.range, ...conditions },
        run.signal,
        frame => {
          if (owner !== current.current || run.signal.aborted) return;
          if (frame.type === 'progress') setMessage(frame.stage);
          if (frame.type === 'file') {
            if (frame.size > EXPORT_MAX_BYTES) throw new Error('下载文件超过 50 MiB');
            file = frame;
          }
          if (frame.type === 'chunk') {
            const part = Uint8Array.from(atob(frame.data), char => char.charCodeAt(0));
            bytes += part.length;
            if (bytes > EXPORT_MAX_BYTES) throw new Error('下载文件超过 50 MiB');
            chunks.push(part);
          }
        },
      );
      if (owner !== current.current || run.signal.aborted) return;
      if (!file || file.size !== bytes) throw new Error('文件传输未完成，请重新生成');
      const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: file.mime }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('已导出全部筛选结果，文件包含统计读取时间');
    } catch (error) {
      if (owner === current.current)
        setMessage(
          run.signal.aborted ? '导出已取消' : error instanceof Error ? error.message : '导出失败',
        );
    } finally {
      if (owner === current.current) setWorking(false);
    }
  }
  return (
    <div className="flex items-center gap-3 keyword-export">
      <button
        type="button"
        className="chip text-brand active:scale-[.98] focus-visible:outline-2 focus-visible:outline-brand"
        disabled={disabled || working}
        onClick={download}
      >
        {working ? '正在导出' : '导出全部筛选结果'}
      </button>
      {working && (
        <button type="button" className="text-brand" onClick={() => controller.current?.abort()}>
          取消导出
        </button>
      )}
      {message && (
        <span role="status" className="text-[11.5px] text-sub">
          {message}
        </span>
      )}
    </div>
  );
}
