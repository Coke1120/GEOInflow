'use client';
import { createContext, useContext } from 'react';
export type ReportActions = {
  filter: string;
  query: string;
  sort: { label: string; direction: number };
  period: string;
  onFilter: (label: string) => void;
  onSort: (label: string) => void;
  onAction: (label: string) => void;
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
