const symbol = Symbol.for('liekan.process-singletons.v1');
const shared = globalThis as typeof globalThis & { [symbol]?: Map<string, unknown> };
const instances = (shared[symbol] ??= new Map<string, unknown>());

/** Next may bundle API and server rendering modules separately in the same process. */
export function processSingleton<T>(name: string, create: () => T): T {
  if (!instances.has(name)) instances.set(name, create());
  return instances.get(name) as T;
}
