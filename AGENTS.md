# Liekan engineering rules

Liekan / 猎看统计 is an MIT derivative of Umami, with a separate GEO statistics UI.

- UI authority: design/reference/geo-stats-v3 and supplemental feature-ui SHA-256 manifests. Preserve original HTML, chart form, table fields, spacing and colors. Approved 0.2.2 navigation/header/copy changes use config/liekan/navigation-ui.json; keep original body/chart checks alongside the incremental navigation gate. No autonomous redesign.
- User approved phase-one implementation, local branches/commits, isolated database and Docker on 127.0.0.1:3002. Do not modify the original Umami checkout or its data volume. No external publication is authorized.
- Work on feature/* or upstream-sync/* and freeze a verified candidate on main. Only the root controller commits, stages or changes branches while collaborators work.
- Product pages consume Liekan contracts. Upstream query/auth/permission imports belong only to src/lib/liekan/upstream. Register necessary core changes in config/liekan/core-overrides.json.
- Keep existing tracker API, database schema, SDK names and MIT copyright compatible. Own SQL migrations are incremental and immutable after use. Never reset a joined database.
- The initial Liekan login is admin / liekan. Apply the product default only to the unchanged upstream initial administrator; preserve customized credentials, renamed identities, roles and deleted accounts on upgrades and restarts.
- No fake production analytics. Empty, missing input, estimated and unsupported states are distinct. Demonstration data is explicitly named and isolated.
- Never log/commit credentials or raw visitor IP. Parameterize SQL, validate website permissions and reject partial 2FA and public share identities for new endpoints.
- Verify pnpm frozen install, types, meaningful unit/API tests, generator consistency, original visual reference, production build and Docker migration. Upstream release checks also preserve local device/geography fixes.
- No rhetorical contrast templates in authored prose. Do not commit process plans, local review reports, temporary outputs, screenshots or database dumps.

- Navigation lives in src/lib/liekan/contracts/navigation.ts and the shared Navigation component. Global management, website analytics, account, admin, authentication and public share contexts stay distinct; private analytics require an explicit website ID. Resource metadata determines ownership; cross-site navigation clears site-owned conditions and identifiers. See docs/navigation.md.
