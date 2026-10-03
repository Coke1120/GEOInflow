import { describe, expect, it } from 'vitest';
import { prepareReplayEvents } from './replay-client';
const meta = {
  type: 4,
  timestamp: 100,
  data: { href: 'https://example.test', width: 1280, height: 800 },
};
describe('replay snapshot readiness', () => {
  it('rejects empty document snapshots before the player loads', () =>
    expect(
      prepareReplayEvents([
        meta,
        {
          type: 2,
          timestamp: 110,
          data: { node: { type: 0, childNodes: [] }, initialOffset: { left: 0, top: 0 } },
        },
      ] as any),
    ).toEqual([]));
  it('retains an actual HTML and body snapshot', () =>
    expect(
      prepareReplayEvents([
        meta,
        {
          type: 2,
          timestamp: 110,
          data: {
            node: {
              type: 0,
              id: 1,
              childNodes: [
                {
                  type: 2,
                  id: 2,
                  tagName: 'html',
                  attributes: {},
                  childNodes: [{ type: 2, id: 3, tagName: 'body', attributes: {}, childNodes: [] }],
                },
              ],
            },
            initialOffset: { left: 0, top: 0 },
          },
        },
      ] as any).length,
    ).toBeGreaterThanOrEqual(2));
});
