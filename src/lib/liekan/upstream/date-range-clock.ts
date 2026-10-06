'use client';
import { useEffect, useState } from 'react';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** Calendar presets advance at midnight in the selected site's timezone. */
export function useDateRangeClock(timezone: string, dynamic = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!dynamic) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      const current = Date.now();
      const day = formatInTimeZone(current, timezone, 'yyyy-MM-dd');
      setNow(previous =>
        formatInTimeZone(previous, timezone, 'yyyy-MM-dd') === day ? previous : current,
      );
      const nextDay = new Date(`${day}T00:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const next = +fromZonedTime(`${nextDay.toISOString().slice(0, 10)}T00:00:00`, timezone);
      timer = setTimeout(check, Math.max(1, next - current));
    };
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [timezone, dynamic]);
  return now;
}
