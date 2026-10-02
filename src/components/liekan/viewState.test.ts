import { describe, expect, it } from 'vitest';
import {
  defaultDateRange,
  isLiveLogView,
  previousWeekRange,
  readViewState,
  resetViewParams,
} from './viewState';

describe('shareable GEO view conditions', () => {
  it('restores log filter, query, page, and sort directly from URL values', () => {
    const params = {
      filter: '仅 AI 蜘蛛',
      search: '/actual',
      page: '3',
      sort: '状态',
      direction: 'asc',
      cursor: 'opaque-log-cursor',
      seek: 'after',
    };
    expect(readViewState(params, 'logs')).toMatchObject({
      filter: '仅 AI 蜘蛛',
      search: '/actual',
      logPage: 3,
      sort: { label: '状态', direction: 1 },
      cursor: 'opaque-log-cursor',
      seek: 'after',
    });
    expect(readViewState({ ...params, page: '100001' }, 'logs').logPage).toBe(1);
    expect(readViewState({ ...params, cursor: 'x'.repeat(513) }, 'logs').cursor).toBe('');
    expect(readViewState({ ...params, seek: 'invalid' }, 'logs').seek).toBe('');
    expect(readViewState({ ...params, seek: 'before' }, 'logs').seek).toBe('before');
  });
  it('restores trend period and rejects conditions from another resource', () => {
    expect(readViewState({ chartPeriod: '7d' }, 'overview').chartPeriod).toBe('7d');
    expect(
      readViewState(
        { filter: 'AI 训练', search: 'GPTBot', page: '2', chartPeriod: '7d', sort: '状态' },
        'content',
      ),
    ).toMatchObject({
      filter: '',
      search: '',
      logPage: 1,
      chartPeriod: '30d',
      sort: { label: '' },
    });
    expect(Object.keys(resetViewParams)).toContain('chartPeriod');
    expect(Object.keys(resetViewParams)).toContain('cursor');
    expect(Object.keys(resetViewParams)).toContain('seek');
    expect(Object.values(resetViewParams).every(value => value === undefined)).toBe(true);
  });
  it('compares the selected window shifted exactly seven days, including a 30-day selection', () => {
    const startAt = Date.parse('2026-09-01T00:00:00+08:00');
    const endAt = Date.parse('2026-09-30T23:59:59+08:00');
    const previous = previousWeekRange(startAt, endAt);
    expect(startAt - previous.startAt).toBe(7 * 86400000);
    expect(endAt - previous.endAt).toBe(7 * 86400000);
    expect(previous.endAt - previous.startAt).toBe(endAt - startAt);
  });
  it('keeps automatic log windows live while preserving explicitly selected history', () => {
    const date = 'range:1751328000000:1754006399999';
    expect(isLiveLogView({}, 'logs')).toBe(true);
    expect(isLiveLogView({ date, dateMode: 'default' }, 'logs')).toBe(true);
    expect(isLiveLogView({ date, live: '1' }, 'logs')).toBe(true);
    expect(isLiveLogView({ date }, 'logs')).toBe(false);
    expect(isLiveLogView({ live: '1' }, 'overview')).toBe(false);
    expect(Object.keys(resetViewParams)).toContain('live');
  });
  it('ends the automatic statistics range at Shanghai day end', () => {
    const range = defaultDateRange(Date.parse('2026-10-02T12:00:00+08:00'));
    expect(range.endAt).toBe(Date.parse('2026-10-02T23:59:59.999+08:00'));
    expect(range.startAt).toBe(Date.parse('2026-09-03T00:00:00+08:00'));
  });
});
