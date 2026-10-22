import { describe, expect, it } from 'vitest';
import { withTrafficPolicy } from './traffic-query';

describe('one relational traffic policy', () => {
  it('restricts native recording reads even when dimension filters are empty', () => {
    const sql = 'SELECT h.* FROM heatmap_event h JOIN session_replay sr ON sr.visit_id=h.visit_id';
    expect(withTrafficPolicy(sql)).toContain(
      'heatmap_event AS NOT MATERIALIZED (SELECT * FROM liekan_effective_heatmap_event), session_replay AS NOT MATERIALIZED (SELECT * FROM liekan_effective_session_replay)',
    );
  });
  it('covers counts and every nested event denominator without changing aliases', () => {
    const sql =
      'select website_event.session_id from website_event join session s on s.session_id=website_event.session_id where exists(select 1 from website_event e where e.event_id=website_event.event_id)';
    expect(withTrafficPolicy(sql)).toBe(
      `WITH website_event AS NOT MATERIALIZED (SELECT * FROM liekan_geographic_website_event), session AS NOT MATERIALIZED (SELECT * FROM liekan_effective_session) ${sql}`,
    );
  });
  it('covers properties and revenue sharing a session with an excluded event', () => {
    const sql =
      'WITH selected AS(select * from website_event) select * from event_data d join revenue r on r.event_id=d.website_event_id';
    expect(withTrafficPolicy(sql)).toContain(
      'website_event AS NOT MATERIALIZED (SELECT * FROM liekan_geographic_website_event), event_data AS NOT MATERIALIZED (SELECT * FROM liekan_effective_event_data), revenue AS NOT MATERIALIZED (SELECT * FROM liekan_effective_revenue), selected',
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

it('geography and filters use the same complete visit tuple through scoped aliases', () => {
  const sql = withTrafficPolicy(
    `WITH visits AS (SELECT s.city AS city,s.country AS country,s.region AS region FROM website_event e JOIN session s ON s.session_id=e.session_id WHERE s.city=$1 GROUP BY s.city,s.country,s.region) SELECT * FROM visits`,
  );
  expect(sql).toContain('liekan_geographic_website_event');
  expect(sql).toContain('e.liekan_city AS city');
  expect(sql).toContain('WHERE e.liekan_city=$1');
  expect(sql).toContain('GROUP BY e.liekan_city,e.liekan_country,e.liekan_region');
  expect(
    withTrafficPolicy(
      'SELECT session.city AS city FROM session JOIN website_event ON website_event.session_id=session.session_id',
    ),
  ).toContain('website_event.liekan_city AS city');
  const nested = withTrafficPolicy(
    'SELECT s.city AS city FROM website_event e JOIN session s ON s.session_id=e.session_id WHERE EXISTS(SELECT 1 FROM session s WHERE s.city=$1)',
  );
  expect(nested).toContain('WHERE s.city=$1');
});

it('materializes one complete property window while retaining parent and sibling-key predicates', () => {
  const sql =
    'SELECT d.data_key FROM event_data d JOIN website_event e ON e.event_id=d.website_event_id WHERE EXISTS(SELECT 1 FROM event_data sibling WHERE sibling.website_event_id=e.event_id AND sibling.data_key=$8)';
  const query = withTrafficPolicy(sql, { websiteId: '$4::uuid', startDate: '$1', endDate: '$7' });
  expect(query).toContain(
    'event_data AS MATERIALIZED (SELECT * FROM liekan_effective_event_data WHERE website_id=$4::uuid AND created_at BETWEEN $1 AND $7)',
  );
  expect(query).toContain(
    'website_event AS NOT MATERIALIZED (SELECT * FROM liekan_geographic_website_event)',
  );
  expect(query).toContain(sql);
});

it('rejects raw SQL in property window binding references', () => {
  expect(() =>
    withTrafficPolicy('SELECT * FROM event_data', {
      websiteId: '$1::uuid; SELECT 1',
      startDate: '$2',
      endDate: '$3',
    }),
  ).toThrow('binding');
});
