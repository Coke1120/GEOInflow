# GEO weight · AI crawl edition

GEOInflow provides a private, per-website integer GEO weight from 1 to 10 on the traffic overview and AI crawl overview. Both summaries open the same calculation details. AI crawling must be enabled, and a complete session with website read permission is required. Public shares, partial sign-ins and API keys cannot read or export this score.

The score describes observed, verified AI content access. Citations, inclusion in training, answer rankings and acquisitions require separate evidence. Content inventory size affects this score; the Beta parameters have not been calibrated across industries.

## Frozen policy

`geo-weight-v2-bands-beta` fixes 18 identities across eight operators: search (7), user-initiated (6), training (5). Kimi contributes three purposes; HySpider contributes Tencent training. `src/lib/liekan/geo-weight/policy.ts` contains stable IDs and coefficients. The shared crawler registry owns names, product forms and verification documentation. Registry additions do not expand the scoring policy automatically.

Each accepted record requires its archived catalog, classification and website configuration; an active official HTTP identity; matching purpose and operator; and a stored `verified_range` decision bound to an archived official range snapshot. Current catalog edits never reclassify historical evidence during scoring. Personal agents and workbenches remain overlapping observations and add no separate contribution. DNS, edge and signature classifications do not establish eligibility in this version.

## Window and formula

`asOf` is the last complete local date. Each calculation covers 30 calendar days ending on that date. Today is reduced to yesterday in the UI. Local timezone conversion preserves daylight-saving boundaries. Host scope is the website's normalized hostname, preserving subdomains. Missing or mismatched hosts are excluded. Configured or declared hosts retain a limitation label.

Only content GET 200/304 requests count. Explicit HTML, XHTML, plain text, Markdown or PDF MIME types take precedence; absent MIME uses conservative path exclusions. Invalid MIME, metadata paths, static resources and self-check requests are excluded. Query strings are not reconstructed. PostgreSQL deduplicates `(website, host, purpose, operator, path, local date)` across 200 and 304 responses.

For each purpose, P is distinct content paths, E is daily units, D is active days, and B counts operators with at least 10 units over three days. No Top-N list contributes to these inputs.

```text
W = 10 × E_search + 7 × E_user + 3 × E_training
```

W is an integer weighted activity count. The coefficients preserve the relative search/user/training importance of 50:35:15. E already captures content paths, operators and repeated activity across calendar days through deduplication. P, D and B remain explanatory evidence; they do not add separate score multipliers. Missing purposes contribute zero and no weights are redistributed. There is no sampling or short-window extrapolation.

The weight is the highest level whose inclusive lower bound is at most W:

| GEO weight | Weighted activity W |
| --- | --- |
| 1 | 1–99 |
| 2 | 100–499 |
| 3 | 500–1,999 |
| 4 | 2,000–9,999 |
| 5 | 10,000–49,999 |
| 6 | 50,000–199,999 |
| 7 | 200,000–999,999 |
| 8 | 1,000,000–4,999,999 |
| 9 | 5,000,000–19,999,999 |
| 10 | 20,000,000 or more |

These fixed Beta ranges provide an approximate assessment. Higher levels require increasingly large amounts of observed activity, and the displayed weight caps at 10. For example, 3,000 search units, 400 user-triggered units and 8,000 training units give W = 56,800 and weight 6; weight 7 requires another 143,200 weighted units. A proved observed zero uses the separate value 0. The primary UI, historical chart and comparisons use integer weights throughout.

Version 2 replaces the prior logarithmic 0–100 score. Historical windows are recomputed using the same version 2 policy; old and new algorithm outputs are not compared. API points expose `level` and `weightedUnits`, and purpose rows expose `coefficient` and `weightedUnits`. The old `score`, `rawScore`, category `contribution`, `weight` and `operatorAnchor` fields are retired. The algorithm version, coefficients and boundaries participate in the policy hash, cache key and export snapshot.

## Evidence and comparison

Missing input and unusable evidence return null weight and activity. A shorter observed span exposes the observed activity count and leaves the weight unrated. A 30-day span with limited continuity, sampling, host, classification or historical evidence receives a reference level. Archived first input establishes span independently of continuity. A proved complete observation with no eligible units can return observed zero; limitation reasons remain visible.

Aligned windows require matching source coverage and archived rule evidence, complete processing, request-host evidence, event-time unsampled collection, and no identity or classification gaps. Five rolling 30-day observations are spaced seven days apart. The prior comparison is a nonoverlapping 30-day window. Lines and definitive differences appear only for comparable windows; unavailable points remain empty.

Ordinary visitor records with archived catalog and classification evidence establish observation span without requiring a crawler identity. Self-check requests remain visible in exclusion totals and cannot improve evidence quality or comparability. Product-form observations use the current website hostname and its recorded host basis.

## APIs and consistency

- `GET /api/liekan/websites/{websiteId}/geo-weight?asOf=YYYY-MM-DD&timezone=...&view=summary|detail`
- `POST /api/liekan/websites/{websiteId}/geo-weight/export` with `asOf`, `timezone`, submitted `locale`, `catalogVersion`, and displayed detail `snapshot`.

Opening details immediately displays the available summary and its current evidence. The explicit detail request uses `refresh=1` to avoid returning a cached detail result older than the visible summary, while preserving the page's catalog pin and cancellation signal. Historical comparison remains pending until a matching detail result arrives; export requires a complete detail snapshot. Transient failures allow a manual retry. A successful detail read with a newer reset epoch also withdraws the old summary until a fresh matching read completes.

The page's manual-read round pins the catalog version. Summary reads aggregate 30 days; detail reads at most 60 days plus an indexed, time-budgeted first-input lookup. Archived range-source bindings are expanded once per catalog/snapshot, and identity exclusions are grouped once per window. Intermediate rows carry only the fields needed by the aggregate. The existing analytics gate, cancellation and transaction budget apply. A five-second in-process cache keys website, host, dates, timezone, policy, catalog, epoch, data/policy revisions and quality evidence. Authorization, reset and policy boundaries are checked before and after cache use. A repeatable-read transaction captures consistent input; later ingestion invalidates future cache reads without discarding that captured calculation.

The snapshot includes result evidence and stable inputs; calculation time, display locale and the global ingestion revision do not affect its identity. New input outside the selected historical windows leaves an unchanged snapshot exportable. Export freshly recomputes the pinned detail snapshot. A mismatch returns 409 with the updated result; the UI clears obsolete results, reloads and requires another export click. CSV includes metadata, formula, current/prior points and observations, with protected cells and the submission locale. No visitor IP or full User-Agent is returned.

The page clock stays fixed through midnight until an explicit refresh. Related analytics links carry the scored date range. Confirmed permission failures and snapshot conflicts keep cached results withdrawn through subsequent transient failures; a successful fresh read restores them. Export rechecks the session and website access before either CSV or conflict data. All calculation and authorization transactions share the remaining 60-second budget.

This feature adds no SQL migration, scheduled task, credential or service. It uses the registry and evidence migrations through 033. A deployment must include these prerequisite changes. Production analytics are never seeded to manufacture a score.

## Verification

Pure scoring tests cover the 56,800-unit / weight-6 example, every inclusive range boundary, the maximum level, monotonicity, coefficient ratios, safe integer limits, evidence states and daylight saving. Private API tests cover authentication, permissions, cache rechecks, date validation, export conflicts and cancellation. `geo-weight.integration.test.ts` exercises the production SQL in PostgreSQL with deduplication, MIME, archived binding and populations larger than page-list limits. It runs only against the explicitly isolated `liekan_geo_test` database on loopback port 15450. UI tests exercise both locales, integer display, pending-history summary visibility, incomplete-export guards and empty/withdrawn states.

The supplemental UI reference is registered in `config/liekan/geo-weight-ui.json`. Existing charts, navigation and original references remain authoritative.
