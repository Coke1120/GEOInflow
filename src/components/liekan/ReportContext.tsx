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
export const ReportContext = createContext<ReportActions>(null);
export function useReportActions() {
  return useContext(ReportContext);
}
