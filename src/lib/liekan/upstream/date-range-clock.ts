'use client';
import { useRef } from 'react';
import { useManualRefresh } from './manual-client';

/** Calendar presets share the current page's explicit read time. */
export function useDateRangeClock(_timezone: string, _dynamic = true) {
  const reading = useManualRefresh();
  const initial = useRef(Date.now());
  return reading?.page.now ?? initial.current;
}
