# Liekan engineering rules

Liekan / 猎看统计 is an MIT derivative of Umami, with a separate GEO statistics UI.

- UI authority: design/reference/geo-stats-v3 and supplemental feature-ui SHA-256 manifests. Preserve original HTML, chart form, table fields, spacing and colors. Approved 0.2.2 navigation/header/copy changes use config/liekan/navigation-ui.json; keep original body/chart checks alongside the incremental navigation gate. No autonomous redesign.
- User approved phase-one implementation, local branches/commits, isolated database and Docker on 127.0.0.1:3002. Do not modify the original Umami checkout or its data volume. Remote publication requires explicit user authorization for the destination and visibility.
- Work on feature/* or upstream-sync/* and freeze a verified candidate on main. Only the root controller commits, stages or changes branches while collaborators work.
- Product pages consume Liekan contracts. Upstream query/auth/permission imports belong only to src/lib/liekan/upstream. Register necessary core changes in config/liekan/core-overrides.json.
- Keep existing tracker API, database schema, SDK names and MIT copyright compatible. Own SQL migrations are incremental and immutable after use. Never reset a joined database.
- The initial Liekan login is admin / liekan. Apply the product default only to the unchanged upstream initial administrator; preserve customized credentials, renamed identities, roles and deleted accounts on upgrades and restarts.
- No fake production analytics. Empty, missing input, estimated and unsupported states are distinct. Demonstration data is explicitly named and isolated.
- Browser traffic quality uses one versioned PostgreSQL policy across analytics, cursor reads, referrals and exports. Raw collection-presence metadata stays independent of the eligible population. Historical missing verdicts stay unknown. Preserve cookieless defaults and upstream ClickHouse/link/pixel behavior. See docs/traffic-quality.md.
- Optional website event UUID receipts, events, properties, revenue and quality evidence commit atomically. Public payload overrides never establish trusted provenance. Only explicitly configured ingress headers or the authorized server collector can supply trusted IP evidence. Quality and receipt tables must not retain raw IP or full UA.
- The default bundled example is “猎看官网（示例数据）” at www.liekan.com. Initialize it with pnpm liekan:seed-demo after migrations. Keep the compressed fixture and its SHA-256 manifest together, preserve existing populated/deleted examples and administrator credentials, and verify import in an isolated database. See docs/default-demo.md.
- Never log/commit credentials or raw visitor IP. Parameterize SQL, validate website permissions and reject partial 2FA and public share identities for new endpoints.
- One-command Docker deployment uses scripts/liekan-deploy.sh and preserves existing configuration and database credentials. Geography defaults to DB-IP City Lite with visible attribution; valid authorized City MMDB files take precedence. Missing geography never prevents event collection. See docs/local-deployment.md.
- Verify pnpm frozen install, types, meaningful unit/API tests, generator consistency, original visual reference, production build and Docker migration. Upstream release checks also preserve local device/geography fixes.
- No rhetorical contrast templates in authored prose. Do not commit process plans, local review reports, temporary outputs, screenshots or database dumps.

- Navigation lives in src/lib/liekan/contracts/navigation.ts and the shared Navigation component. Global management, website analytics, account, admin, authentication and public share contexts stay distinct; private analytics require an explicit website ID. Resource metadata determines ownership; cross-site navigation clears site-owned conditions and identifiers. See docs/navigation.md.

- Crawler control uses independent Zone credentials, durable preview/confirmation and per-Zone leases. Unknown provider results quarantine the Zone across disconnected/frozen connections. Read-only handoff reconciliation never transfers write authority; adoption requires a separate confirmed preview. See docs/crawler-control.md.
- Crawler risk quality must distinguish missing input, unknown continuity, partial gaps and proved observed-file coverage. Preserve classification versions, epoch fencing, late-data correction and self-check exclusion.

- UI language is zh-CN or en-US. Browser preference and the same-origin locale cookie persist after logout. Translate display text while preserving resource IDs, raw visitor/user content, snapshot identity and Monday-to-Sunday natural weeks. New AI runs and human-readable exports capture locale at submission. See docs/i18n.md.
