import { useDateRange } from './useDateRange';
import { useTimezone } from './useTimezone';
import { featureDateRange } from '@/lib/liekan/contracts/analysis';

function safeToISOString(date: Date, fallback: Date): string {
  try {
    return date.toISOString();
  } catch {
    return fallback.toISOString();
  }
}

export function useDateParameters(options: { calendarMetadata?: boolean } = {}) {
  const { timezone, toUtc, canonicalizeTimezone } = useTimezone();
  const { dateRange, sharedRange } = useDateRange({ timezone });
  const { startDate, endDate, unit } = dateRange;
  const selected =
    sharedRange || (dateRange.value ? featureDateRange(dateRange, timezone) : undefined);
  const utcStart = selected ? new Date(selected.startAt) : toUtc(startDate);
  const utcEnd = selected ? new Date(selected.endAt) : toUtc(endDate);
  const startAtValue = +utcStart;
  const endAtValue = +utcEnd;
  const isStartValid = Number.isFinite(startAtValue);
  const isEndValid = Number.isFinite(endAtValue);

  return {
    startAt: isStartValid ? startAtValue : +startDate,
    endAt: isEndValid ? endAtValue : +endDate,
    startDate: safeToISOString(isStartValid ? utcStart : startDate, startDate),
    endDate: safeToISOString(isEndValid ? utcEnd : endDate, endDate),
    unit: sharedRange?.unit || unit,
    timezone: sharedRange?.timezone || canonicalizeTimezone(timezone),
    ...(options.calendarMetadata
      ? {
          datesAreLocal: !!sharedRange || !dateRange.value?.startsWith('range:'),
          displayStartAt: +startDate,
          displayEndAt: +endDate,
        }
      : {}),
  };
}
