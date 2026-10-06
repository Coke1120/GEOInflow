import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigation } from './useNavigation';

const navigation = vi.hoisted(() => ({ pathname: '', params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const id = '67a8e084-de35-5f1c-a2b0-8f2732f830bf';
const entities = [
  ['teams', 'teamId'],
  ['websites', 'websiteId'],
  ['links', 'linkId'],
  ['pixels', 'pixelId'],
  ['boards', 'boardId'],
] as const;

describe('navigation entity identity', () => {
  beforeEach(() => {
    navigation.params = new URLSearchParams();
  });
  it.each(entities)('accepts the complete %s UUID segment', (path, key) => {
    for (const suffix of ['', '/edit']) {
      navigation.pathname = `/${path}/${id}${suffix}`;
      expect(renderHook(() => useNavigation()).result.current[key]).toBe(id);
    }
  });
  it.each(entities)('ignores %s creation routes and partial identifiers', (path, key) => {
    for (const value of ['create', 'c', `${id}suffix`, id.slice(0, -1), 'a'.repeat(36)]) {
      navigation.pathname = `/${path}/${value}`;
      expect(renderHook(() => useNavigation()).result.current[key]).toBeUndefined();
    }
  });
  it('accepts the short numeric site number in website URLs', () => {
    for (const suffix of ['', '/geo/human/geo']) {
      navigation.pathname = `/websites/101${suffix}`;
      expect(renderHook(() => useNavigation()).result.current.websiteId).toBe('101');
    }
    navigation.pathname = `/teams/${id}/websites/101/geo`;
    expect(renderHook(() => useNavigation()).result.current.websiteId).toBe('101');
  });
  it.each(entities.filter(([path]) => path !== 'websites'))(
    'ignores numeric segments for %s',
    (path, key) => {
      navigation.pathname = `/${path}/101`;
      expect(renderHook(() => useNavigation()).result.current[key]).toBeUndefined();
    },
  );
  it('preserves team and website context without adding a board from create', () => {
    navigation.pathname = `/teams/${id}/websites/${id}/events`;
    navigation.params = new URLSearchParams('date=30d&page=2');
    const { result } = renderHook(() => useNavigation());
    expect(result.current.teamId).toBe(id);
    expect(result.current.websiteId).toBe(id);
    expect(result.current.renderUrl('/boards/create', false)).toBe(`/teams/${id}/boards/create`);
  });
});
