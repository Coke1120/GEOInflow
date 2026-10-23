'use client';
import { DataLoading } from './DataLoading';
import { AiBots } from './pages/AiBots';
import { AiOverview } from './pages/AiOverview';
import { AiPages } from './pages/AiPages';
import { AiPreference } from './pages/AiPreference';
import { Content } from './pages/Content';
import { Conversions } from './pages/Conversions';
import { HumanGeo } from './pages/HumanGeo';
import { HumanOverview } from './pages/HumanOverview';
import { HumanKeywords } from './pages/HumanKeywords';
import { HumanSearchEngines } from './pages/HumanSearchEngines';
import { HumanSources } from './pages/HumanSources';
import { Logs } from './pages/Logs';
import { Overview } from './pages/Overview';
import type { ReportViewProps, Resource } from './types';

export const reportViews = {
  overview: Overview,
  'ai/overview': AiOverview,
  'ai/bots': AiBots,
  'ai/pages': AiPages,
  'ai/preference': AiPreference,
  'human/overview': HumanOverview,
  'human/geo': HumanGeo,
  'human/sources': HumanSources,
  'human/search-engines': HumanSearchEngines,
  'human/keywords': HumanKeywords,
  content: Content,
  conversions: Conversions,
  logs: Logs,
};

export function AnalysisLoading({
  resource = 'overview',
  rangeLabel = '',
  trendLabel,
  aiCrawlerEnabled,
  geoWeight,
}: Partial<ReportViewProps> & { resource?: Resource }) {
  const View = reportViews[resource];
  return (
    <DataLoading loading>
      <View
        rangeLabel={rangeLabel}
        trendLabel={trendLabel}
        aiCrawlerEnabled={aiCrawlerEnabled}
        geoWeight={geoWeight}
      />
    </DataLoading>
  );
}
