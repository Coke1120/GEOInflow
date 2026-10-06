export function privateAiQueryLog<
  T extends { query?: string; params?: unknown; duration?: number },
>(event: T): T | { component: string; duration: number | undefined } {
  if (/\bliekan_ai(?:_|\b)/i.test(event.query ?? ''))
    return { component: 'liekan-ai', duration: event.duration };
  return event;
}
