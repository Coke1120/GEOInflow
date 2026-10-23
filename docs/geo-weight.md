# GEO weight · AI crawl edition

GEOInflow provides a private, per-website integer GEO weight from 1 to 10 on the traffic overview and AI crawl overview. The traffic overview places the compact weight card fourth, after AI crawler requests. The AI crawl overview places it third, after identified AI crawlers. These cards replace today's conversions and AI page coverage in those positions; the corresponding report calculations and exports remain available. The compact summary shows the integer, evidence state, actual snapshot cutoff and a calculation-evidence button. Prior-year cutoff dates retain the year. Both summaries open the same calculation details. AI crawling must be enabled, and a complete session with website read permission is required. Public shares, partial sign-ins and API keys cannot read or export this score.

The score describes observed, verified AI content access. Citations, inclusion in training, answer rankings and acquisitions require separate evidence. Content inventory size affects this score; the Beta parameters have not been calibrated across industries.

## Frozen policy

`geo-weight-v2.1-bands-evidence-beta` fixes 18 identities across eight operators: search (7), user-initiated (6), training (5). Kimi contributes three purposes; HySpider contributes Tencent training. `src/lib/liekan/geo-weight/policy.ts` contains stable IDs and coefficients. The shared crawler registry owns names, product forms and verification documentation. Registry additions do not expand the scoring policy automatically.

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
| 1 | 1-99 |
| 2 | 100-499 |
| 3 | 500-1,999 |
| 4 | 2,000-9,999 |
| 5 | 10,000-49,999 |
| 6 | 50,000-199,999 |
| 7 | 200,000-999,999 |
| 8 | 1,000,000-4,999,999 |
| 9 | 5,000,000-19,999,999 |
| 10 | 20,000,000 or more |

These fixed Beta ranges provide an approximate assessment. Higher levels require increasingly large amounts of observed activity, and the displayed weight caps at 10. For example, 3,000 search units, 400 user-triggered units and 8,000 training units give W = 56,800 and weight 6; weight 7 requires another 143,200 weighted units. A proved observed zero uses the separate value 0. The primary UI, historical chart and comparisons use integer weights throughout.

Version 2.1 retains the version 2 integer bands and requires complete evidence before publishing zero. Version 2 replaces the prior logarithmic 0 to 100 score. Historical windows are recomputed using the same version 2 policy; old and new algorithm outputs are not compared. API points expose `level` and `weightedUnits`, and purpose rows expose `coefficient` and `weightedUnits`. The old `score`, `rawScore`, category `contribution`, `weight` and `operatorAnchor` fields are retired. The algorithm version, coefficients and boundaries participate in the policy hash, cache key and export snapshot.

## Evidence and comparison

Missing input and unusable evidence return null weight and activity. A shorter observed span exposes the observed activity count and leaves the weight unrated. A 30-day span with limited continuity, sampling, host, classification or historical evidence receives a reference level. Archived first input establishes span independently of continuity. A proved complete observation with no eligible units can return observed zero; limitation reasons remain visible.

Aligned windows require matching source coverage and archived rule evidence, complete processing, request-host evidence, event-time unsampled collection, and no identity or classification gaps. Five rolling 30-day observations are spaced seven days apart. The prior comparison is a nonoverlapping 30-day window. Lines and definitive differences appear only for comparable windows; unavailable points remain empty.

Ordinary visitor records with archived catalog and classification evidence establish observation span without requiring a crawler identity. Self-check requests remain visible in exclusion totals and cannot improve evidence quality or comparability. Product-form observations use the current website hostname and its recorded host basis.

## APIs and consistency

- `GET /api/liekan/websites/{websiteId}/geo-weight/snapshot` accepts `mode=current|historical`, `timezone`, `view=summary|detail` and optional `snapshotId` or `taskId`. Historical mode requires `asOf`. A task status read pins its stored cutoff date, validates current access and its strong boundary, and registers no new work. Current-mode task reads retain the seven-day fallback scope across midnight; entering or refreshing the page checks the new current day. Supplying both pinned IDs returns 400. Current mode derives yesterday from server time in the requested timezone. GEO accepts named IANA timezones and normalizes aliases and case before assigning cache, task and request identities; numeric UTC offsets return 400. Previously saved alias snapshots and request receipts remain readable through an equivalent canonical timezone.
- `POST /api/liekan/websites/{websiteId}/geo-weight/recalculate` accepts `mode`, `timezone`, optional historical `asOf`, and UUID `requestId`. Website owners and team administrators may recalculate. Same-identity active tasks merge before the website-wide five-minute cooldown. Reusing an actor's request ID with different parameters returns 409. Receipts and their referenced heads remain available for 90 days, with at most 500 receipts per website; a full receipt store returns 429 for new IDs while retries of existing IDs continue to resolve.
- `POST /api/liekan/websites/{websiteId}/geo-weight/export` accepts `{snapshotId, locale}`. The legacy `asOf`, `timezone`, `locale`, `catalogVersion` and `snapshot` request remains available and locates the exact saved digest.
- The original GEO GET route retains its successful result shape. On a cold read it waits at most five seconds for the same durable task, then returns retryable 503. `refresh=1` reads current state. It leaves daily publication under worker control.

The snapshot envelope separates `taskStatus` from the evidence state. A ready result can contain a null level, an accumulating span, reference evidence, or proved zero. A failed update can retain a valid prior result. `requestedAsOf`, `servedAsOf`, `stale`, `snapshotId`, `nextRetryAt` and fixed error codes describe these states. Current reads can show a compatible result up to seven calendar days old. Historical reads use exactly the requested day. An exact snapshot read registers no new work. Missing exact snapshots or task IDs return 410; scope, epoch, policy or evidence conflicts return 409.

Migration 036 adds immutable PostgreSQL results, business-identity heads, bounded recalculation receipts, range-scoped evidence revisions and the installation cache UUID. Daily identity includes website, normalized hostname, timezone, cutoff date, reset epoch and scoring policy. Data revisions and later logs are recorded as lineage. They leave an already published day stable. Evidence corrections in the used window invalidate the result; ordinary coverage extensions and retention outside that window leave it usable. Catalog descriptions, locale and website display names do not change the strong boundary. Snapshot input boundaries preserve the actual archived catalog, rule and verification-range references. Referenced archives remain protected while their snapshots belong to the current reset epoch and an active website. Reset epochs and deleted website or crawler states release archive references, preserving rollback lifecycle operations and stored snapshot records.

The existing analytics worker consumes `liekan-geo-weight-snapshot`. Demand registration and PgBoss delivery share one primary PostgreSQL transaction through `fromPrisma`. A website can hold at most 20 pending identities. Websites rotate by their last started calculation. One active calculation per website and a PostgreSQL transaction advisory lock across worker instances limit aggregation concurrency to one globally. Each calculation uses a repeatable-read transaction and a 60-second deadline. Its 90-second lease renews every 15 seconds. Publication checks current access, ownership, strong boundary, lease epoch and expected generation, then saves the complete immutable result and head atomically.

Failures retry at one and five minutes, with three attempts in total. Lock contention defers work without spending an attempt. The worker reconciles at most 20 expired leases or inconsistent queue deliveries each minute. Maintenance also expires result contents for up to 20 websites per pass, with up to 100 results per website, including websites with no new visits. Valid export references and active calculations defer expiration. Deleted websites release orphan task and receipt references before expired contents are removed. Publication, reads and eviction acquire website and referencing-head locks before snapshot writes; eviction skips busy references. A terminal failure stays visible until an explicit retry. A new authorized owner can register fresh demand after an old initiator is fenced. Closing a page cancels its consumer and leaves shared background work intact.

Each website holds at most 500 result snapshots, 500 heads and 64 MiB of result bytes. A result is at most 512 KiB. Results expire after 90 days. Current-day publications, active work and 60-second export references remain protected while older records are evicted by last use. Capacity failures preserve existing results and return an explicit capacity state. Pending-demand limits return 429 with a 60-second retry hint. Oversized results fail without truncation or a substituted score.

Opening details and exporting use the displayed immutable `snapshotId`. A newer manual generation does not change an already open detail or export. When the summary reports a changed evidence boundary or cutoff date, an open detail revalidates its exact snapshot. Its evidence and export remain unavailable until that validation succeeds; a valid prior-day fallback keeps its original snapshot. The response and CSV carry the saved catalog version and calculation time. CSV includes formula, current and prior points, observations, exclusion reasons and the submitted locale. The export path rechecks the session, website access and strong boundary and performs no log aggregation. No visitor IP, full User-Agent, credential or caller capability is persisted in shared results. Response capabilities are projected from current website authority. Private responses use `private, no-store`.

A deployment applies migration 036, initializes the GEO queue, and runs the matching analytics worker. No additional service or credential is needed. Rollback stops new snapshot work, restores the previous app and worker, and retains the additive tables. Production analytics are never seeded to manufacture a score.

## Verification

Pure scoring tests cover the 56,800-unit / weight-6 example, every inclusive range boundary, the maximum level, monotonicity, coefficient ratios, safe integer limits, evidence states and daylight saving. Private API tests cover full-session authentication, origin checks, archived metadata, bounded retry responses and shared schema validation. Calculator tests retain detail-window and cancellation checks. Durable snapshot tests use an explicitly owned PostgreSQL database on loopback port 15461 and exercise transactional queue rollback, 50-reader coalescing, two-worker locking, lease fencing, bounded retries, exact export, capacity, immutable results and archive protection. `geo-weight.integration.test.ts` exercises the production SQL in PostgreSQL with deduplication, MIME, archived binding and populations larger than page-list limits. It runs only against the explicitly isolated `liekan_geo_test` database on loopback port 15450. UI tests exercise both locales, integer display, pending-history summary visibility, incomplete-export guards and empty/withdrawn states.

The supplemental UI reference is registered in `config/liekan/geo-weight-ui.json`. Live compact-card checks compare its container and score styles with the native blue metric card and independently require the approved brand-blue score before restoring the approved slot for the original pixel oracle. The original oracle separately validates the native card container and the remaining body. Existing charts, navigation and original references remain authoritative.
