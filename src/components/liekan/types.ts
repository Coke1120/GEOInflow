import type { DataState, LiekanReport, Row } from '@/lib/liekan/contracts/report';

export type { DataState, LiekanReport, Row };
export type ChartData = LiekanReport['charts'][string];
export type ReportViewProps = {
  report?: LiekanReport;
  rangeLabel: string;
  trendLabel?: string;
  live?: boolean;
  aiCrawlerEnabled?: boolean;
};
export type Resource =
  | 'overview'
  | 'ai/overview'
  | 'ai/bots'
  | 'ai/pages'
  | 'ai/preference'
  | 'human/overview'
  | 'human/geo'
  | 'human/sources'
  | 'human/search-engines'
  | 'human/keywords'
  | 'content'
  | 'conversions'
  | 'logs';
