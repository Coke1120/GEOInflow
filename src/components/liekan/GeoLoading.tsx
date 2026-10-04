'use client';
import { AiBots } from './pages/AiBots';
import { AiOverview } from './pages/AiOverview';
import { AiPages } from './pages/AiPages';
import { AiPreference } from './pages/AiPreference';
import { Content } from './pages/Content';
import { Conversions } from './pages/Conversions';
import { HumanGeo } from './pages/HumanGeo';
import { HumanOverview } from './pages/HumanOverview';
import { HumanSources } from './pages/HumanSources';
import { Logs } from './pages/Logs';
import { Overview } from './pages/Overview';
import { DataLoadingContext } from './LoadingState';
import { ReportContext } from './ReportContext';
import styles from '@/styles/liekan/Shell.module.css';
export const geoViews = {
  overview: Overview,
  'ai/overview': AiOverview,
  'ai/bots': AiBots,
  'ai/pages': AiPages,
  'ai/preference': AiPreference,
  'human/overview': HumanOverview,
  'human/geo': HumanGeo,
  'human/sources': HumanSources,
  content: Content,
  conversions: Conversions,
  logs: Logs,
};
export function GeoLoading({ resource = 'overview' }: { resource?: string }) {
  const View = geoViews[resource] || geoViews.overview;
  return (
    <ReportContext.Provider
      value={{
        filter: '',
        query: '',
        sort: { label: '', direction: -1 },
        period: '30 天',
        onFilter: () => {},
        onSort: () => {},
        onAction: () => {},
      }}
    >
      <DataLoadingContext.Provider value={true}>
        <span className={styles.srOnly} role="status">
          正在读取统计数据
        </span>
        <View rangeLabel="正在读取" />
      </DataLoadingContext.Provider>
    </ReportContext.Provider>
  );
}
