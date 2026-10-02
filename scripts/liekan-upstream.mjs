import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const baseline = JSON.parse(readFileSync('config/liekan/upstream.json', 'utf8'));
const overrides = JSON.parse(readFileSync('config/liekan/core-overrides.json', 'utf8'));
const mode = process.argv[2];
const position = process.argv.indexOf('--tag');
const tag = position >= 0 ? process.argv[position + 1] : '';
if (!['report', 'prepare'].includes(mode) || !/^v\d+\.\d+\.\d+$/.test(tag))
  throw new Error('Usage: pnpm liekan:upstream:report|prepare --tag vX.Y.Z');
if (git('remote', 'get-url', 'upstream') !== baseline.repository)
  throw new Error('Upstream URL differs from approved official repository');
git('fetch', '--no-tags', 'upstream', `refs/tags/${tag}:refs/remotes/upstream/releases/${tag}`);
const target = git('rev-parse', `refs/remotes/upstream/releases/${tag}^{commit}`);
const paths = git('diff', '--name-only', baseline.commit, target).split('\n').filter(Boolean);
const overlap = paths.filter(path => overrides.files.some(file => file.path === path));
const critical = paths.filter(path =>
  /^(prisma\/|src\/lib\/(auth|two-factor|request|schema|prisma)|src\/permissions|src\/openapi|package.json|pnpm-lock)/.test(
    path,
  ),
);
const report = {
  sourceTag: baseline.tag,
  sourceCommit: baseline.commit,
  targetTag: tag,
  targetCommit: target,
  changedPaths: paths,
  coreOverrideOverlap: overlap,
  criticalPaths: critical,
  createdAt: new Date().toISOString(),
  mode,
};
mkdirSync('outputs/upstream', { recursive: true });
if (mode === 'prepare') {
  const branch = `upstream-sync/${tag}`;
  const path = resolve('tmp/upstream', tag);
  if (existsSync(path))
    throw new Error('Candidate already exists; inspect and reuse it before preparing again');
  mkdirSync(resolve('tmp/upstream'), { recursive: true });
  git('worktree', 'add', '-b', branch, path, 'main');
  const merge = spawnSync('git', ['merge', '--no-ff', '--no-commit', target], {
    cwd: path,
    encoding: 'utf8',
  });
  const conflicts = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], {
    cwd: path,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);
  report.candidate = {
    branch,
    path,
    result: (merge.stdout + merge.stderr).trim(),
    status: merge.status,
    conflicts,
  };
  if (merge.status) process.exitCode = 2;
  // The candidate keeps ancestry and all conflict evidence. No deployment or main mutation.
}
const path = `outputs/upstream/${tag}-${mode}.json`;
writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      report: path,
      targetCommit: target,
      changed: paths.length,
      overlaps: overlap.length,
      critical: critical.length,
      candidate: report.candidate,
    },
    null,
    2,
  ),
);
