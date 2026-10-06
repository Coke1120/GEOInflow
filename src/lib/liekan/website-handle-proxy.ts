import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';

// Page URLs carry the short site number, while upstream analytics routes key SQL and
// permissions on the website UUID. Middleware (local src/proxy.ts and the Docker
// variant) calls rewriteWebsiteHandle so /api/websites/101/metrics resolves to the
// owner UUID before those routes run. Page routes and /api/liekan/websites/* resolve
// handles themselves.
const WEBSITE_HANDLE_PATH = /^(\/(?:compat\/)?api\/(?:websites|realtime)\/)(\d+)(?=\/|$)/;

const HANDLE_TTL = 60_000;
const MISS_TTL = 5_000;
const entries = new Map<string, { id: string | null; expires: number }>();

let pool: Pool | undefined;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  }
  return pool;
}

function searchPath() {
  const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema') || 'public';
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema) ? schema : null;
}

async function resolveHandle(handle: string): Promise<string | null> {
  const now = Date.now();
  const cached = entries.get(handle);
  if (cached && cached.expires > now) {
    return cached.id;
  }

  let id: string | null = null;
  const client = getPool();
  const schema = process.env.DATABASE_URL ? searchPath() : null;
  if (client && schema) {
    try {
      const result = await client.query(
        `SELECT website_id FROM "${schema}".website WHERE site_number=$1 LIMIT 1`,
        [Number(handle)],
      );
      id = result.rows[0]?.website_id ?? null;
    } catch {
      id = null;
    }
  }

  entries.set(handle, { id, expires: now + (id ? HANDLE_TTL : MISS_TTL) });
  return id;
}

export async function rewriteWebsiteHandle(
  request: NextRequest,
): Promise<NextResponse | undefined> {
  const match = request.nextUrl.pathname.match(WEBSITE_HANDLE_PATH);
  if (!match) {
    return undefined;
  }

  const id = await resolveHandle(match[2]);
  if (!id) {
    return undefined;
  }

  const url = request.nextUrl.clone();
  url.pathname = `${match[1]}${id}${request.nextUrl.pathname.slice(match[0].length)}`;
  return NextResponse.rewrite(url);
}
