'use client';
import type { CSSProperties } from 'react';
import { pageNavigation } from '@/lib/liekan/contracts/navigation';
import { useSidebarWidth } from './Navigation';
import { AnalysisLoading } from './AnalysisLoading';

export function PageLoadingFrame({ page }: { page: string }) {
  const [width] = useSidebarWidth();
  return (
    <div data-liekan-features lang="zh-CN" style={{ '--side': `${width}px` } as CSSProperties}>
      <div className="shell-content">
        <header className="header">
          <div className="header-inner">
            <h1>{pageNavigation[page]?.title || '猎看统计'}</h1>
          </div>
        </header>
        <main className="content" id="main-content">
          <AnalysisLoading />
        </main>
      </div>
    </div>
  );
}
