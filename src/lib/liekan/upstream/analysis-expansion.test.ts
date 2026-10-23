// @vitest-environment node
import { it, expect, vi } from 'vitest';
vi.mock('./analysis-rollups-db', () => ({}));
vi.mock('./analysis-background', () => ({}));
import { expansionShouldStop } from './analysis-expansion';
const row = {
  day: '2026-10-01T00:00:00Z',
  inputRows: 10000,
  derivedRows: 9000,
  rawMs: 100,
  acceleratedMs: 90,
  compared: true,
};
const days = [
  row,
  { ...row, day: '2026-10-02T00:00:00Z' },
  { ...row, day: '2026-10-03T00:00:00Z' },
];
it('requires three completed measured equivalent days with poor compression and speed', () => {
  expect(expansionShouldStop(days)).toBe(true);
  expect(expansionShouldStop([row, row])).toBe(false);
  for (const change of [
    { compared: false },
    { rawMs: 0 },
    { derivedRows: 8000 },
    { acceleratedMs: 80 },
  ])
    expect(expansionShouldStop([days[0], days[1], { ...days[2], ...change }])).toBe(false);
});

it('keeps expansion for sparse or repeated measurement dates', () => {
  expect(expansionShouldStop([days[0], days[1], { ...days[2], day: '2026-10-05T00:00:00Z' }])).toBe(
    false,
  );
  expect(expansionShouldStop([row, row, row])).toBe(false);
});
