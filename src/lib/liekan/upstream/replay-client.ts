'use client';
import { getReplayPlayerEvents } from '@/lib/replay';
export { getReplayViewport as replayViewport } from '@/lib/replay';
export function prepareReplayEvents(events: any[]) {
  const playable = getReplayPlayerEvents(events);
  const snapshot = playable.find(e => e.type === 2);
  const html = snapshot?.data?.node?.childNodes?.find(n => n.type === 2 && n.tagName === 'html');
  if (!html?.childNodes?.some(n => n.type === 2 && n.tagName === 'body')) return [];
  return playable;
}
