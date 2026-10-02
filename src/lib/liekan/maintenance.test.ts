import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const nativeRequire = createRequire(path.join(root, 'scripts/test-runner.cjs'));
function runScript(name: string, modules: Record<string, unknown>, argv: string[]) {
  const output = ts.transpileModule(fs.readFileSync(`scripts/${name}`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localProcess = { argv, exitCode: undefined };
  const require = (id: string) => modules[id] || nativeRequire(id);
  new Function('require', 'exports', 'process', 'console', output)(require, {}, localProcess, {
    log() {},
  });
  return localProcess;
}

describe('shipped maintenance gates', () => {
  it('flags upstream statistics dependencies even when Liekan has no override', () => {
    let report: any;
    const paths = ['src/queries/sql/getWebsiteStats.ts', 'src/queries/sql/funnels/getFunnel.ts'];
    runScript(
      'liekan-upstream.mjs',
      {
        'node:child_process': {
          execFileSync: (_cmd: string, args: string[]) => {
            if (args[0] === 'remote') return 'https://github.com/umami-software/umami.git';
            if (args[0] === 'rev-parse') return 'b'.repeat(40);
            if (args[0] === 'diff')
              return args.includes('--name-status')
                ? paths.map(p => `M\t${p}`).join('\n')
                : paths.join('\n');
            return '';
          },
        },
        'node:fs': {
          ...fs,
          mkdirSync() {},
          writeFileSync: (_name: string, value: string) => {
            report = JSON.parse(value);
          },
        },
      },
      ['node', 'script', 'report', '--tag', 'v3.5.0'],
    );
    expect(report.criticalPaths).toEqual(expect.arrayContaining(paths));
  });
  it('keeps both names of an upstream dependency rename in the impact report', () => {
    let report: any;
    const old = 'src/queries/sql/getWebsiteStats.ts',
      next = 'src/analytics/getWebsiteStats.ts';
    runScript(
      'liekan-upstream.mjs',
      {
        'node:child_process': {
          execFileSync: (_cmd: string, args: string[]) => {
            if (args[0] === 'remote') return 'https://github.com/umami-software/umami.git';
            if (args[0] === 'rev-parse') return 'b'.repeat(40);
            if (args[0] === 'diff')
              return args.includes('--name-status') ? `R100\t${old}\t${next}` : next;
            return '';
          },
        },
        'node:fs': {
          ...fs,
          mkdirSync() {},
          writeFileSync: (_name: string, value: string) => {
            report = JSON.parse(value);
          },
        },
      },
      ['node', 'script', 'report', '--tag', 'v3.5.0'],
    );
    expect(report.changedPaths).toEqual(expect.arrayContaining([old, next]));
    expect(report.criticalPaths).toContain(old);
  });
  it.each([
    { status: null, signal: 'SIGKILL', error: undefined },
    { status: null, signal: null, error: new Error('Could not launch') },
  ])('keeps failed merge candidates reviewable and exits with failure: %o', failure => {
    let report: any;
    const result = runScript(
      'liekan-upstream.mjs',
      {
        'node:child_process': {
          execFileSync: (_cmd: string, args: string[]) => {
            if (args[0] === 'remote') return 'https://github.com/umami-software/umami.git';
            if (args[0] === 'rev-parse') return 'b'.repeat(40);
            return '';
          },
          spawnSync: () => ({ ...failure, stdout: '', stderr: '' }),
        },
        'node:fs': {
          ...fs,
          existsSync: () => false,
          mkdirSync() {},
          writeFileSync: (_name: string, value: string) => {
            report = JSON.parse(value);
          },
        },
      },
      ['node', 'script', 'prepare', '--tag', 'v3.5.0'],
    );
    expect(result.exitCode).toBe(2);
    expect(report.candidate.branch).toBe('upstream-sync/v3.5.0');
    expect(report.candidate.status).toBeNull();
    expect(report.candidate.signal).toBe(failure.signal);
    if (failure.error) expect(report.candidate.error).toBe('Merge process could not start');
  });
  it.each([
    "import { getWebsiteStats } from '../../queries/sql/getWebsiteStats';",
    "export { getWebsiteStats } from '../../queries/sql/getWebsiteStats';",
    "import '../../queries/sql/getWebsiteStats';",
    "const query = import('../../queries/sql/getWebsiteStats');",
    "const query = require('../../queries/sql/getWebsiteStats');",
    "import query = require('../../queries/sql/getWebsiteStats');",
    "import { PrismaClient } from '../../../generated/prisma/client.js';",
  ])('rejects adapter bypass: %s', code => {
    const source = `${fs.readFileSync('src/lib/liekan/report.ts', 'utf8')}\n${code}`;
    const fakeFs = {
      ...fs,
      readFileSync: (file: string, encoding?: any) =>
        file === 'src/lib/liekan/report.ts' ? source : fs.readFileSync(file, encoding),
    };
    expect(() =>
      runScript(
        'liekan-static-check.mjs',
        {
          'node:fs': fakeFs,
          'node:child_process': { execFileSync: () => '' },
        },
        ['node', 'script'],
      ),
    ).toThrow(/Upstream import crossed product boundary/);
  });
  it('accepts the existing product imports', () => {
    expect(() =>
      runScript(
        'liekan-static-check.mjs',
        {
          'node:child_process': { execFileSync: () => '' },
        },
        ['node', 'script'],
      ),
    ).not.toThrow();
  });
});
