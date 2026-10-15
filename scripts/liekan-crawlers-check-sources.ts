import { pathToFileURL } from 'node:url';
import { checkRangeSource, rangeCheckErrorCode } from '../src/lib/liekan/crawlers/range-check';
import { rangeSources } from '../src/lib/liekan/crawlers/range-sources';
import {
  checkDocumentSource,
  documentCheckErrorCode,
} from '../src/lib/liekan/crawlers/document-check';
import { documentSources } from '../src/lib/liekan/crawlers/document-sources';

/** Read-only public-source inspection. No database client or persistence module is imported. */
export async function checkSources(fetcher?: typeof fetch) {
  const checks = [
    ...rangeSources.map(source => async () => {
      try {
        const result = await checkRangeSource(source, undefined, { fetcher });
        return {
          kind: 'ip',
          id: source.id,
          status: result.status,
          change: result.change,
          candidateReason: result.candidateReason,
          errorCode: null,
        };
      } catch (error) {
        return {
          kind: 'ip',
          id: source.id,
          status: 'failed',
          errorCode: rangeCheckErrorCode(error),
        };
      }
    }),
    ...documentSources.map(source => async () => {
      try {
        const result = await checkDocumentSource(source, undefined, { fetcher });
        return {
          kind: 'document',
          id: source.id,
          status: result.status,
          hash: result.hash,
          comparison: 'first_observation',
          errorCode: null,
        };
      } catch (error) {
        return {
          kind: 'document',
          id: source.id,
          status: 'failed',
          errorCode: documentCheckErrorCode(error),
        };
      }
    }),
  ];
  const results: Awaited<ReturnType<(typeof checks)[number]>>[] = new Array(checks.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (cursor < checks.length) {
        const index = cursor++;
        results[index] = await checks[index]();
      }
    }),
  );
  return {
    checkedAt: new Date().toISOString(),
    readOnly: true,
    documentsBaseline: 'first_observation',
    results,
  };
}
async function main() {
  if (process.argv.slice(2).some(option => !['--json', '--help'].includes(option))) {
    console.error('Usage: pnpm liekan:crawlers:check-sources [--json]');
    process.exitCode = 2;
    return;
  }
  if (process.argv.includes('--help')) {
    console.log(
      'Usage: pnpm liekan:crawlers:check-sources [--json]\nRead-only fixed public sources. IP diffs use bundled baselines. Documents report a first observation; document changes are tracked by the persistent worker.',
    );
    return;
  }
  const report = await checkSources();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('Read-only crawler source check · document comparison: first observation');
    for (const result of report.results) {
      const detail = 'change' in result ? ` +${result.change.added} -${result.change.removed}` : '';
      console.log(
        `${result.kind}\t${result.id}\t${result.status}${detail}${result.errorCode ? ` (${result.errorCode})` : ''}`,
      );
    }
  }
  if (report.results.some(result => result.status === 'failed' || result.status === 'candidate'))
    process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Crawler source check unavailable');
    process.exitCode = 1;
  });
}
