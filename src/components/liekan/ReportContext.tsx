'use client';
import type { KeywordConditions } from '@/lib/liekan/contracts/keywords';
import { createContext, useContext } from 'react';
export type ReportActions = {
  keywords?: {
    conditions: KeywordConditions;
    busy: boolean;
    onChange: (next: Partial<KeywordConditions>) => void;
    onPage: (page: number) => void;
  };
  filter: string;
  query: string;
  sort: { label: string; direction: number };
  period: string;
  onFilter: (label: string) => void;
  onSort: (label: string) => void;
  onAction: (label: string) => void;
  onLogsPage?: (page: number) => void;
  // 服务端分页明细表翻页：table 在 meta.tablePages 白名单内时由 ReportRows 调用。
  onTablePage?: (table: string, page: number) => void;
};
export const ReportContext = createContext<ReportActions>({
  filter: '',
  query: '',
  sort: { label: '', direction: -1 },
  period: '30 天',
  onFilter() {},
  onSort() {},
  onAction() {},
});
export function useReportActions() {
  return useContext(ReportContext);
}
