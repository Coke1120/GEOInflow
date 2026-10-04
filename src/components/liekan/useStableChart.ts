'use client';
import { useEffect, useRef, useState } from 'react';
import { loadEcharts } from './chartRuntime';

// Keep one renderer per chart identity; updates replace all series and axes.
export function useStableChart(
  identity: string,
  option: any,
  onClick?: (params: any) => void,
  ready = true,
) {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef({ option, onClick, ready });
  latest.current = { option, onClick, ready };
  const active = useRef<{ update: () => void }>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let runtime: any;
    let instance: any;
    let observer: ResizeObserver;
    const cleanup = () => {
      active.current = null;
      observer?.disconnect();
      observer = undefined;
      try {
        instance?.dispose();
      } catch {}
      instance = undefined;
    };
    const fail = () => {
      if (disposed) return;
      cleanup();
      setFailed(true);
    };
    const update = () => {
      if (disposed || !runtime || !container.current) return;
      try {
        if (!instance) {
          if (!latest.current.ready) return;
          instance = runtime.init(container.current);
          instance.on?.('click', (params: any) => latest.current.onClick?.(params));
          observer = new ResizeObserver(() => {
            try {
              instance?.resize();
            } catch {
              fail();
            }
          });
          observer.observe(container.current);
        }
        instance.setOption(latest.current.option, { notMerge: true });
      } catch {
        fail();
      }
    };
    setFailed(false);
    active.current = { update };
    loadEcharts()
      .then(echarts => {
        if (disposed) return;
        runtime = echarts;
        update();
      })
      .catch(fail);
    return () => {
      disposed = true;
      cleanup();
    };
  }, [identity, attempt]);
  useEffect(() => {
    active.current?.update();
  }, [option, ready]);
  return { container, failed, retry: () => setAttempt(value => value + 1) };
}
