import { expect, test } from 'vitest';
import { getComponentDefinition } from '@/app/(main)/boards/boardComponentRegistry';
import {
  BOARD_COMPONENT_COMPATIBILITY_MATRIX,
  getSupportedBoardComponentEntityTypes,
} from './boardComponentCompatibility';
import {
  BOARD_ENTITY_TYPES,
  getBoardEntityIds,
  getResolvedComponentEntity,
  isBoardComponentSupported,
} from './boards';
import type { BoardParameters } from './types';

test.each(['website', 'pixel', 'link'] as const)(
  'fixed %s board scope follows its rendered source without rewriting legacy bindings',
  type => {
    const parameters: BoardParameters = {
      websiteId: 'unused-website',
      pixelId: 'unused-pixel',
      linkId: 'unused-link',
      [`${type}Id`]: 'current-source',
      rows: [
        {
          id: 'row',
          columns: [
            {
              id: 'chart',
              component: { type: 'WebsiteChart', entityType: 'website', entityId: 'old-source' },
            },
            {
              id: 'text',
              component: {
                type: 'TextBlock',
                websiteId: 'old-text-source',
                props: { content: 'Notes' },
              },
            },
          ],
        },
      ],
    };
    const board = { type, parameters };
    expect(getResolvedComponentEntity(board, parameters.rows[0].columns[0].component)).toEqual({
      entityType: type,
      entityId: 'current-source',
    });
    expect(getBoardEntityIds(board)).toEqual({
      websiteIds: type === 'website' ? ['current-source'] : [],
      pixelIds: type === 'pixel' ? ['current-source'] : [],
      linkIds: type === 'link' ? ['current-source'] : [],
    });
    expect(parameters.rows[0].columns[0].component.entityId).toBe('old-source');
    expect(parameters.rows[0].columns[1].component.props.content).toBe('Notes');
  },
);

test.each(['mixed', 'open', 'dashboard'])(
  '%s boards retain every independent and legacy resource reference',
  type => {
    const parameters: BoardParameters = {
      websiteId: 'legacy-website',
      linkId: 'legacy-link',
      pixelId: 'legacy-pixel',
      rows: [
        {
          id: 'row',
          columns: [
            {
              id: 'website',
              component: { type: 'WebsiteChart', entityType: 'website', entityId: 'website' },
            },
            {
              id: 'pixel',
              component: { type: 'MetricsTable', entityType: 'pixel', entityId: 'pixel' },
            },
            {
              id: 'link',
              component: { type: 'MetricsTable', entityType: 'link', entityId: 'link' },
            },
            { id: 'legacy', component: { type: 'WeeklyTraffic', websiteId: 'old-website' } },
            { id: 'text', component: { type: 'TextBlock', props: { content: 'Notes' } } },
          ],
        },
      ],
    };
    expect(getBoardEntityIds({ type, parameters })).toEqual({
      websiteIds: ['legacy-website', 'website', 'old-website'],
      linkIds: ['legacy-link', 'link'],
      pixelIds: ['legacy-pixel', 'pixel'],
    });
  },
);

test('fixed boards without a root source retain the same component fallback as rendering', () => {
  const board = {
    type: 'website',
    parameters: {
      linkId: 'unused-root-link',
      rows: [
        {
          id: 'row',
          columns: [{ id: 'chart', component: { type: 'WebsiteChart', websiteId: 'fallback' } }],
        },
      ],
    },
  };
  expect(getResolvedComponentEntity(board, board.parameters.rows[0].columns[0].component)).toEqual({
    entityType: 'website',
    entityId: 'fallback',
  });
  expect(getBoardEntityIds(board)).toEqual({ websiteIds: ['fallback'], linkIds: [], pixelIds: [] });
});

test('a fixed board keeps its root source when it contains only text or no components', () => {
  expect(
    getBoardEntityIds({ type: 'website', parameters: { websiteId: 'source' } }).websiteIds,
  ).toEqual(['source']);
  expect(
    getBoardEntityIds({
      type: 'website',
      parameters: {
        websiteId: 'source',
        rows: [
          {
            id: 'row',
            columns: [
              { id: 'text', component: { type: 'TextBlock', props: { content: 'Notes' } } },
            ],
          },
        ],
      },
    }).websiteIds,
  ).toEqual(['source']);
});

test('isBoardComponentSupported allows events chart on website boards', () => {
  expect(isBoardComponentSupported('EventsChart', BOARD_ENTITY_TYPES.website)).toBe(true);
});

test('isBoardComponentSupported rejects events chart on pixel and link boards', () => {
  expect(isBoardComponentSupported('EventsChart', BOARD_ENTITY_TYPES.pixel)).toBe(false);
  expect(isBoardComponentSupported('EventsChart', BOARD_ENTITY_TYPES.link)).toBe(false);
});

test('isBoardComponentSupported rejects event metrics bar and weekly traffic on pixel and link boards', () => {
  expect(isBoardComponentSupported('EventsMetricsBar', BOARD_ENTITY_TYPES.pixel)).toBe(false);
  expect(isBoardComponentSupported('EventsMetricsBar', BOARD_ENTITY_TYPES.link)).toBe(false);
  expect(isBoardComponentSupported('WeeklyTraffic', BOARD_ENTITY_TYPES.pixel)).toBe(false);
  expect(isBoardComponentSupported('WeeklyTraffic', BOARD_ENTITY_TYPES.link)).toBe(false);
});

test('board component compatibility matrix defines website-only components explicitly', () => {
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.EventsMetricsBar).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.EventsChart).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.Funnel).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.Goal).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.RealtimeActiveUsers).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.RealtimeHeader).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.RealtimeChart).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.RevenueMetricsBar).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.RevenueChart).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.RevenueMetricsTable).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.UTM).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(BOARD_COMPONENT_COMPATIBILITY_MATRIX.WeeklyTraffic).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(getSupportedBoardComponentEntityTypes('EventsMetricsBar')).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(getSupportedBoardComponentEntityTypes('EventsChart')).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(getSupportedBoardComponentEntityTypes('Funnel')).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(getSupportedBoardComponentEntityTypes('Goal')).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(getSupportedBoardComponentEntityTypes('RealtimeActiveUsers')).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(getSupportedBoardComponentEntityTypes('RealtimeHeader')).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(getSupportedBoardComponentEntityTypes('RealtimeChart')).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(getSupportedBoardComponentEntityTypes('RevenueMetricsBar')).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(getSupportedBoardComponentEntityTypes('RevenueChart')).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(getSupportedBoardComponentEntityTypes('RevenueMetricsTable')).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
  expect(getSupportedBoardComponentEntityTypes('UTM')).toEqual([BOARD_ENTITY_TYPES.website]);
  expect(getSupportedBoardComponentEntityTypes('WeeklyTraffic')).toEqual([
    BOARD_ENTITY_TYPES.website,
  ]);
});

test('isBoardComponentSupported leaves other components available for all board entities', () => {
  expect(isBoardComponentSupported('WebsiteChart', BOARD_ENTITY_TYPES.pixel)).toBe(true);
  expect(isBoardComponentSupported('TextBlock', BOARD_ENTITY_TYPES.link)).toBe(true);
});

test('metrics table limits pixel and link boards to overview-page metric types', () => {
  const definition = getComponentDefinition('MetricsTable');
  const options = definition?.configFields?.find(
    field => field.name === 'type',
  )?.optionsByEntityType;

  expect(options?.pixel?.map(option => option.value)).toEqual([
    'referrer',
    'channel',
    'country',
    'region',
    'city',
    'browser',
    'os',
    'device',
  ]);
  expect(options?.link?.map(option => option.value)).toEqual([
    'referrer',
    'channel',
    'country',
    'region',
    'city',
    'browser',
    'os',
    'device',
  ]);
});
