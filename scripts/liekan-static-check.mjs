import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertProductImports } from './liekan-boundaries.mjs';
import { assertDialogContract } from './liekan-dialog-contract.mjs';
import { assertManualReadPolicy } from './liekan-manual-read-contract.mjs';

assertDialogContract();
assertManualReadPolicy();

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync('design/reference/geo-stats-v3/manifest.json', 'utf8'));
const baseline = JSON.parse(readFileSync('config/liekan/upstream.json', 'utf8'));
const manifestDigest = hash(
  JSON.stringify(
    Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))),
  ),
);
if (manifestDigest !== baseline.uiManifestSha256)
  throw new Error('Approved UI reference collection fingerprint changed');
for (const [file, digest] of Object.entries(manifest))
  if (hash(readFileSync(`design/reference/geo-stats-v3/${file}`)) !== digest)
    throw new Error(`UI reference drift: ${file}`);
const featureUI = JSON.parse(readFileSync('config/liekan/feature-ui.json', 'utf8'));
if (hash(JSON.stringify(featureUI.files)) !== baseline.featureUiManifestSha256)
  throw new Error('Approved supplemental UI fingerprint changed');
for (const [file, digest] of Object.entries(featureUI.files))
  if (hash(readFileSync(`${featureUI.directory}/${file}`)) !== digest)
    throw new Error(`Supplemental UI drift: ${file}`);
const keywordUI = JSON.parse(readFileSync('config/liekan/keyword-ui.json', 'utf8'));
if (hash(JSON.stringify(keywordUI.files)) !== baseline.keywordUiManifestSha256)
  throw new Error('Approved keyword UI fingerprint changed');
for (const [file, digest] of Object.entries(keywordUI.files))
  if (hash(readFileSync(`${keywordUI.directory}/${file}`)) !== digest)
    throw new Error(`Keyword UI reference drift: ${file}`);
const aiUI = JSON.parse(readFileSync('config/liekan/ai-ui.json', 'utf8'));
if (hash(JSON.stringify(aiUI.sha256)) !== baseline.aiUiManifestSha256)
  throw new Error('Approved AI UI fingerprint changed');
for (const [file, digest] of Object.entries(aiUI.sha256))
  if (hash(readFileSync(`${aiUI.referenceRoot}/${file}`)) !== digest)
    throw new Error(`AI UI reference drift: ${file}`);
if (!aiUI.chatHome?.sha256 || !Object.keys(aiUI.chatHome.sha256).length)
  throw new Error('Approved AI homepage reference manifest is required');
if (hash(JSON.stringify(aiUI.chatHome.sha256)) !== baseline.aiChatHomeUiManifestSha256)
  throw new Error('Approved AI homepage reference fingerprint changed');
for (const [file, digest] of Object.entries(aiUI.chatHome.sha256))
  if (hash(readFileSync(`${aiUI.chatHome.referenceRoot}/${file}`)) !== digest)
    throw new Error(`AI homepage reference drift: ${file}`);
const migrationLock = JSON.parse(readFileSync('config/liekan/migrations.json', 'utf8'));
if (
  JSON.stringify(
    readdirSync('db/liekan/migrations')
      .filter(f => f.endsWith('.sql'))
      .sort(),
  ) !== JSON.stringify(Object.keys(migrationLock).sort())
)
  throw new Error('Migration directory and immutable register differ');
for (const [file, digest] of Object.entries(migrationLock))
  if (hash(readFileSync(`db/liekan/migrations/${file}`)) !== digest)
    throw new Error(`Immutable migration drift: ${file}`);
// scripts/liekan-migrate.mjs splits raw SQL on ';', so a semicolon inside a comment
// or a string literal would corrupt the statement list. Statement terminators in code
// (end of line, mid line, before a trailing comment) are all safe for the splitter.
const stringSemicolon = code => {
  let inside = false;
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === "'") {
      if (inside && code[i + 1] === "'") i += 1;
      else inside = !inside;
    } else if (code[i] === ';' && inside) return true;
  }
  return false;
};
for (const file of Object.keys(migrationLock)) {
  readFileSync(`db/liekan/migrations/${file}`, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const where = `${file}:${index + 1}`;
      const commentStart = line.indexOf('--');
      const code = commentStart >= 0 ? line.slice(0, commentStart) : line;
      const comment = commentStart >= 0 ? line.slice(commentStart) : '';
      if (comment.includes(';')) throw new Error(`Semicolon inside a comment in ${where}`);
      if (stringSemicolon(code)) throw new Error(`Semicolon inside a string literal in ${where}`);
    });
}
const visit = path =>
  readdirSync(path, { withFileTypes: true }).flatMap(file =>
    file.isDirectory() ? visit(join(path, file.name)) : [join(path, file.name)],
  );
for (const file of [
  ...visit('src/components/liekan'),
  ...visit('src/lib/liekan').filter(path => !path.includes('/upstream/')),
  ...visit('src/app/(main)/websites/[websiteId]/geo'),
].filter(path => /\.tsx?$/.test(path))) {
  const source = readFileSync(file, 'utf8');
  assertProductImports(file, source);
}
const overrides = JSON.parse(readFileSync('config/liekan/core-overrides.json', 'utf8'));
if (overrides.baseline !== baseline.commit)
  throw new Error('Core override baseline differs from the selected upstream commit');
for (const entry of overrides.files) {
  for (const field of ['path', 'purpose', 'owner', 'constraint', 'removalCondition'])
    if (typeof entry[field] !== 'string' || !entry[field].trim())
      throw new Error(`Incomplete core override ${entry.path}: ${field}`);
  if (!Array.isArray(entry.tests) || !entry.tests.length)
    throw new Error(`Core override lacks regression checks: ${entry.path}`);
}
const changed = execFileSync('git', ['diff', '--name-only', baseline.commit], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
changed.push(
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean),
);
const own = path =>
  /^(src\/lib\/liekan\/|src\/liekan-agent\/|src\/liekan-worker\/|src\/components\/liekan\/|src\/styles\/liekan\/|src\/app\/api\/liekan\/|src\/app\/\(main\)\/websites\/\[websiteId\]\/geo\/|scripts\/liekan-|db\/liekan\/|config\/liekan\/|design\/|docs\/|public\/liekan\/|tests\/liekan\/|tests\/api\/liekan\.spec\.ts$)/.test(
    path,
  );
for (const path of changed)
  if (!own(path) && !overrides.files.some(file => file.path === path))
    throw new Error(`Unregistered core override: ${path}`);
if (readFileSync('package.json', 'utf8').includes('"ua-parser-js"'))
  throw new Error('Direct ua-parser-js dependency returned');
if (!readFileSync('LICENSE', 'utf8').includes('Umami Software, Inc.'))
  throw new Error('Original copyright missing');
console.log(
  'UI reference, migration fingerprints, product imports and core override register passed.',
);
