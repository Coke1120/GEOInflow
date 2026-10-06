import { describe, expect, it } from 'vitest';
import { featureHref, featurePages, matchFeatureRoute } from '@/components/liekan/features/routes';
import { globalNavigation, navigationFor } from './navigation';

describe('published AI page continuity', () => {
  it.each([
    ['ai-chat', '快速发起'],
    ['ai-config', 'AI配置器'],
  ])('keeps the published %s page reachable from global navigation and its direct link', (page, label) => {
    expect(globalNavigation).toContainEqual(expect.objectContaining({ page, label }));
    expect(featurePages).toContainEqual(expect.objectContaining({ id: page }));
    expect(featureHref(page)).toBe(`/liekan/${page}`);
    const route = matchFeatureRoute(`/liekan/${page}`, { websiteId: 'stale-site' });
    expect(route).toMatchObject({ page, websiteId: undefined });
    expect(navigationFor(route!)).toMatchObject({ scope: 'global', section: page });
  });
});
