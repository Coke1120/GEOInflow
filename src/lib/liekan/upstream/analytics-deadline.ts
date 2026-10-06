import { AsyncLocalStorage } from 'node:async_hooks';
import { AnalyticsUnavailable } from './analytics-budget';
import { processSingleton } from './process-singleton';

const metadata = processSingleton('analytics-primary-metadata', () => new AsyncLocalStorage<any>());
export const primaryMetadataClient = () => metadata.getStore();
export const withinPrimaryMetadata = <T>(client: any, work: () => Promise<T>) =>
  metadata.run(client, work);

export function analyticsRemaining(deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new AnalyticsUnavailable('统计查询超时，请缩小时间范围后重试');
  return Math.ceil(remaining);
}

/** Serialize timeout + statement as one operation, including concurrent snapshot loaders. */
export function timedAnalyticsClient(tx: any, deadline: number) {
  let tail = Promise.resolve();
  let failure: unknown;
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(async () => {
      if (failure) throw failure;
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${analyticsRemaining(deadline)}`);
      return work();
    });
    tail = next.then(
      () => {},
      error => {
        failure = error;
      },
    );
    return next;
  };
  const models = new Map<PropertyKey, any>();
  return new Proxy(tx, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property === '$queryRawUnsafe' || property === '$executeRawUnsafe')
        return (...args: any[]) => run(() => value.apply(target, args));
      if (
        typeof property === 'string' &&
        !property.startsWith('$') &&
        value &&
        typeof value === 'object'
      ) {
        if (!models.has(property))
          models.set(
            property,
            new Proxy(value, {
              get(model, method) {
                const member = Reflect.get(model, method);
                return typeof member === 'function'
                  ? (...args: any[]) => run(() => member.apply(model, args))
                  : member;
              },
            }),
          );
        return models.get(property);
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
