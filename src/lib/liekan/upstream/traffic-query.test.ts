import { describe, expect, it } from 'vitest';
import { withTrafficPolicy } from './traffic-query';

describe('one relational traffic policy', () => {
  it('restricts native recording reads even when dimension filters are empty', () => {
    const sql = 'SELECT h.* FROM heatmap_event h JOIN session_replay sr ON sr.visit_id=h.visit_id';
    expect(withTrafficPolicy(sql)).toContain(
      'heatmap_event AS (SELECT * FROM liekan_effective_heatmap_event), session_replay AS (SELECT * FROM liekan_effective_session_replay)',
    );
  });
  it('covers counts and every nested event denominator without changing aliases', () => {
    const sql =
      'select website_event.session_id from website_event join session s on s.session_id=website_event.session_id where exists(select 1 from website_event e where e.event_id=website_event.event_id)';
    expect(withTrafficPolicy(sql)).toBe(
      `WITH website_event AS (SELECT * FROM liekan_effective_website_event) ${sql}`,
    );
  });
  it('covers properties and revenue sharing a session with an excluded event', () => {
    const sql =
      'WITH selected AS(select * from website_event) select * from event_data d join revenue r on r.event_id=d.website_event_id';
    expect(withTrafficPolicy(sql)).toContain(
      'website_event AS (SELECT * FROM liekan_effective_website_event), event_data AS (SELECT * FROM liekan_effective_event_data), revenue AS (SELECT * FROM liekan_effective_revenue), selected',
    );
  });
  it('preserves recursive WITH, comments, quoted table names and values', () => {
    const sql =
      '/* report */ WITH RECURSIVE nodes AS(select 1) SELECT "website_event".* FROM "website_event" WHERE url_path=\'update website_event\'';
    expect(withTrafficPolicy(sql)).toContain('WITH RECURSIVE website_event AS');
    expect(withTrafficPolicy(sql)).toContain("url_path='update website_event'");
  });
  it('leaves writes and unrelated metadata untouched', () => {
    for (const sql of [
      'DELETE FROM website_event',
      'WITH removed AS (DELETE FROM website_event RETURNING *) SELECT * FROM removed',
      "select 'from website_event' as example from website",
      'select $$from website_event$$ from website',
    ])
      expect(withTrafficPolicy(sql)).toBe(sql);
  });
  it('fails explicitly on caller CTE name collisions', () => {
    expect(() =>
      withTrafficPolicy('WITH website_event AS (select 1) SELECT * FROM website_event'),
    ).toThrow('conflicts');
  });
});
