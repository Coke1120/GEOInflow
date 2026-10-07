import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATE_RANGE_CONFIG } from '@/lib/constants';
import { setItem } from '@/lib/storage';
import { activeQuickDateRange, QuickRangeButtons } from './date-quick-range';

// 30day 是解析器标准「近 30 天」（含今天共 31 个自然日），与既有错误提示快捷键、umami 上游语义一致；
// 精确边界以旁边的范围 chip 为准。
describe('activeQuickDateRange', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('highlights 30day when the URL carries the dynamic default marker', () => {
    expect(
      activeQuickDateRange({ date: 'range:1727827200000:1791388799999', dateMode: 'default' }),
    ).toBe('30day');
    expect(activeQuickDateRange({ dateMode: 'default' })).toBe('30day');
  });

  it('highlights exact quick tokens and stays dark for other ranges', () => {
    expect(activeQuickDateRange({ date: '24hour' })).toBe('24hour');
    expect(activeQuickDateRange({ date: '7day' })).toBe('7day');
    expect(activeQuickDateRange({ date: '30day' })).toBe('30day');
    expect(activeQuickDateRange({ date: 'range:1727827200000:1791388799999:day' })).toBe(null);
    expect(activeQuickDateRange({ date: '6hour' })).toBe(null);
    expect(activeQuickDateRange({ date: 'garbage' })).toBe(null);
  });

  it('uses the GEO default token when no date parameter exists', () => {
    expect(activeQuickDateRange({}, '30day')).toBe('30day');
    expect(activeQuickDateRange({ date: undefined }, '30day')).toBe('30day');
  });

  it('follows the stored account preference for feature pages', () => {
    setItem(DATE_RANGE_CONFIG, '7day');
    expect(activeQuickDateRange({})).toBe('7day');
    setItem(DATE_RANGE_CONFIG, '1month');
    expect(activeQuickDateRange({})).toBe(null);
  });

  it('defaults to 24hour when nothing is stored and no default token is given', () => {
    expect(activeQuickDateRange({})).toBe('24hour');
  });
});

describe('QuickRangeButtons', () => {
  it('renders 24h / 7 天 / 30 天 in order with aria-pressed selection', () => {
    render(<QuickRangeButtons activeToken="7day" onSelect={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['24h', '7 天', '30 天']);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the active chip and reports clicks', () => {
    const onSelect = vi.fn();
    render(<QuickRangeButtons activeToken="30day" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: '30 天' }).className).toBe('chip on');
    expect(screen.getByRole('button', { name: '24h' }).className).toBe('chip');
    fireEvent.click(screen.getByRole('button', { name: '24h' }));
    expect(onSelect).toHaveBeenCalledWith('24hour');
  });

  it('uses the btn variant classes on feature pages', () => {
    render(<QuickRangeButtons variant="btn" activeToken={null} onSelect={() => {}} />);
    for (const name of ['24h', '7 天', '30 天']) {
      expect(screen.getByRole('button', { name })).toHaveClass('btn');
    }
  });
});
