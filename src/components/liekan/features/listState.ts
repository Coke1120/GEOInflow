'use client';
import { useEffect, useState } from 'react';
import { useFeature } from './context';

export function useListState<T extends string | number>(key: string, initial: T) {
  type Value = T extends number ? number : string;
  const c = useFeature();
  const read = () => {
    const raw = c?.query?.[key];
    return (
      typeof initial === 'number'
        ? Number.isInteger(Number(raw)) && Number(raw) > 0
          ? Number(raw)
          : initial
        : (raw ?? initial)
    ) as Value;
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    setValue(read());
  }, [c?.query?.[key]]);
  const change = (next: Value) => {
    setValue(next);
    c?.updateQuery?.({
      [key]: Object.is(next, initial) ? undefined : next,
      ...(key === 'search' ? { page: undefined } : {}),
    });
  };
  return [value, change] as const;
}
