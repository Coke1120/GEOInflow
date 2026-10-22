// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { analyzeSourceOperation } from './source-analysis';

const analyze = (text: string) =>
  analyzeSourceOperation(
    ts.createSourceFile('route.ts', text, ts.ScriptTarget.Latest, true),
    'get',
  );
const body = `
  const schema = z.object({ startAt: z.coerce.number().int(), endAt: z.coerce.number().int() });
  const { auth, query, error } = await parseRequest(request, schema);
  if (error) return error();
  if (!(await canViewWebsiteSection(auth, 'site', 'sessions'))) return unauthorized();
  return json({ visitors: 1, label: 'known' });
`;

describe('local reporting handler delegation', () => {
  it('preserves auth, query and response analysis through nested cache and snapshot callbacks', () => {
    const direct = analyze(`export async function GET(request) { ${body} }`);
    const wrapped = analyze(`async function getResponse(request) { ${body} }
      export async function GET(...args) { return withQueryCacheHeaders(() => nativeSnapshot(() => getResponse(...args)), args[0]); }`);
    expect(direct.auth).toBe('bearer-or-share');
    expect(direct.requestSchema).toMatchObject({ type: 'object', required: ['startAt', 'endAt'] });
    expect(wrapped).toEqual(direct);
  });
  it('follows local function expressions with recursion protection and excludes uncalled helpers', () => {
    const direct = analyze(`export async function GET(request) { ${body} }`);
    const wrapped = analyze(`
      const handle = async function(request) { ${body} };
      function delegate(request) { if (retry) return delegate(request); return handle(request); }
      async function unused(request) { await parseRequest(request, null, {skipAuth: true}); return payloadTooLarge(); }
      export const GET = request => {
        const uncalled = () => { const schema = z.object({ wrong: z.string() }); return notFound(); };
        return withQueryCacheHeaders(() => delegate(request));
      };
    `);
    expect(wrapped).toEqual(direct);
    expect(wrapped.responseStatuses).not.toContain(413);
  });
  it('matches the direct implementation of the actual event-data route', () => {
    const route = readFileSync(
      path.join(process.cwd(), 'src/app/api/websites/[websiteId]/event-data/route.ts'),
      'utf8',
    );
    const direct = route
      .split('export async function GET(...args')[0]
      .replace('async function getResponse(', 'export async function GET(');
    const expected = analyze(direct);
    expect(expected.auth).toBe('bearer-or-share');
    expect(expected.requestSchema).toHaveProperty('properties.startAt');
    expect(expected.requestSchema).toHaveProperty('properties.page');
    expect(analyze(route)).toEqual(expected);
  });
});
