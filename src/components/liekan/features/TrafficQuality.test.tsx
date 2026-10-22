import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ table: vi.fn() }));
vi.mock('./context', () => ({
  useFeature: () => ({ siteId: 'site', range: { startAt: 1, endAt: 2, timezone: 'UTC' } }),
  useData: ([key]: string[]) => ({
    data:
      key === 'traffic-quality'
        ? {
            available: true,
            summary: [
              { classification: 'browser', pageviews: 7, visitors: null, included_pageviews: 5 },
            ],
            partition: [
              { bucket: 'included', pageviews: 5 },
              { bucket: 'known_automation', pageviews: 2 },
            ],
          }
        : { available: false },
  }),
}));
vi.mock('./TrafficGovernance', () => ({ TrafficGovernance: () => null }));
vi.mock('./TrafficEvidencePanel', () => ({ TrafficEvidencePanel: () => null }));
vi.mock('./LiekanDialog', () => ({ useDialog: () => null }));
vi.mock('./ui', () => {
  const Container = ({ children }: any) => <div>{children}</div>;
  return {
    Table: (props: any) => {
      mocks.table(props);
      return null;
    },
    TableCell: Container,
    Body: Container,
    Button: Container,
    DialogActions: Container,
    Field: Container,
    LiekanDialog: Container,
    Notice: Container,
    Panel: Container,
    QueryState: Container,
    Select: Container,
    Textarea: Container,
  };
});
import { TrafficQuality } from './TrafficQuality';
it('retains unknown visitor totals and exposes mutually exclusive pageview accounting', () => {
  render(<TrafficQuality canManage={false} onClose={() => {}} />);
  const tables = mocks.table.mock.calls.map(([props]) => props);
  const classes = tables.find(t => t.columns[0] === '质量分类');
  expect(classes.rows[0]).toEqual(['浏览器特征', 7, null, 5]);
  const partition = tables.find(t => t.columns[0] === '统计处理');
  expect(partition.rows).toEqual([
    ['已纳入浏览统计', 5],
    ['已知自动化', 2],
  ]);
});
