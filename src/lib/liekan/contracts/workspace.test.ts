import { describe, expect, it } from 'vitest';
import { getBoardEntityIds, getResolvedComponentEntity } from '@/lib/boards';
import { boardParameters, type WorkspaceParameters } from './workspace';

const layout: WorkspaceParameters = {
  websiteId: 'site-a',
  extension: { keep: true },
  rows: [
    {
      id: 'row',
      size: 360,
      extension: 'row metadata',
      columns: [
        {
          id: 'column',
          size: 50,
          extension: 'column metadata',
          component: {
            type: 'Goal',
            title: 'Saved goal',
            entityType: 'website',
            entityId: 'old-component-site',
            websiteId: 'legacy-component-site',
            extension: 'component metadata',
            props: { reportId: 'saved-goal', retain: true },
          },
        },
        { id: 'text', component: { type: 'TextBlock', props: { content: 'Notes' } } },
      ],
    },
  ],
};

describe('board source transitions', () => {
  it('rebinding a fixed board retains layout and report configuration with only the new source', () => {
    const next = boardParameters(layout, 'website', 'site-b', 'website');
    const component = next.rows[0].columns[0].component;
    expect(getBoardEntityIds({ type: 'website', parameters: next })).toEqual({
      websiteIds: ['site-b'],
      pixelIds: [],
      linkIds: [],
    });
    expect(getResolvedComponentEntity({ type: 'website', parameters: next }, component)).toEqual({
      entityType: 'website',
      entityId: 'site-b',
    });
    expect(component).toEqual({
      type: 'Goal',
      title: 'Saved goal',
      extension: 'component metadata',
      props: { reportId: 'saved-goal', retain: true },
    });
    expect(next.extension).toEqual(layout.extension);
    expect(next.rows[0]).toMatchObject({ id: 'row', size: 360, extension: 'row metadata' });
    expect(next.rows[0].columns[0]).toMatchObject({
      id: 'column',
      size: 50,
      extension: 'column metadata',
    });
    expect(layout.rows[0].columns[0].component.entityId).toBe('old-component-site');
  });

  it.each(['mixed', 'open'])('fixed to %s preserves each widget current visible source', type => {
    const next = boardParameters(layout, type, undefined, 'website');
    const component = next.rows[0].columns[0].component;
    expect(next.websiteId).toBeUndefined();
    expect(component).toMatchObject({ entityType: 'website', entityId: 'site-a' });
    expect(component.websiteId).toBeUndefined();
    expect(getResolvedComponentEntity({ type, parameters: next }, component)).toEqual({
      entityType: 'website',
      entityId: 'site-a',
    });
    expect(getBoardEntityIds({ type, parameters: next }).websiteIds).toEqual(['site-a']);
    expect(next.rows[0].columns[1]).toEqual(layout.rows[0].columns[1]);
  });

  it('mixed to fixed follows the global source and removes old explicit bindings', () => {
    const mixed = boardParameters(layout, 'mixed', undefined, 'website');
    const next = boardParameters(mixed, 'pixel', 'pixel-b', 'mixed');
    expect(getBoardEntityIds({ type: 'pixel', parameters: next })).toEqual({
      websiteIds: [],
      pixelIds: ['pixel-b'],
      linkIds: [],
    });
    expect(next.rows[0].columns[0].component.props).toEqual(
      layout.rows[0].columns[0].component.props,
    );
  });

  it('mixed edits retain the independent widget sources and clear obsolete root source fields', () => {
    const next = boardParameters(layout, 'mixed', undefined, 'mixed');
    expect(next.websiteId).toBeUndefined();
    expect(next.rows[0].columns[0].component).toEqual(layout.rows[0].columns[0].component);
  });

  it('opening a fixed board clears text-only component sources while preserving content and metadata', () => {
    const parameters: WorkspaceParameters = {
      websiteId: 'site-a',
      rows: [
        {
          id: 'row',
          columns: [
            {
              id: 'text',
              component: {
                type: 'TextBlock',
                entityType: 'website',
                entityId: 'obsolete-site',
                websiteId: 'legacy-site',
                extension: 'text metadata',
                props: { content: 'Notes', retain: true },
              },
            },
          ],
        },
      ],
    };
    const next = boardParameters(parameters, 'mixed', undefined, 'website');
    expect(next.rows[0].columns[0].component).toEqual({
      type: 'TextBlock',
      extension: 'text metadata',
      props: { content: 'Notes', retain: true },
    });
    expect(getBoardEntityIds({ type: 'mixed', parameters: next })).toEqual({
      websiteIds: [],
      pixelIds: [],
      linkIds: [],
    });
  });
});
