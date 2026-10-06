import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';

// Page URLs carry the short site number, while upstream analytics routes key SQL and
// permissions on the website UUID. Middleware (local src/proxy.ts and the Docker
// variant) calls rewriteWebsiteHandle so /api/websites/101/metrics resolves to the
// owner UUID before those routes run. In-process dispatch (src/lib/mcp) calls
// rewriteHandlePathname for the same reason: it bypasses the middleware entirely.
// Page routes and /api/liekan/websites/* resolve handles themselves. The proxy file
// runs on the Node runtime (pg requires it); do not add an edge runtime export to
// src/proxy.ts or docker/proxy.ts.
// The pattern is capped at 9 digits to match the server-side handle validators;
// longer segments pass through and fail upstream UUID validation.
const WEBSITE_HANDLE_PATH = /^(\/(?:compat\/)?api\/(?:websites|realtime)\/)(\d{1,9})(?=\/|$)/;

const HANDLE_TTL = 60_000;
const MISS_TTL = 5_000;
const HANDLE_CACHE_LIMIT = 1000;
const entries = new Map<string, { id: string | null; expires: number }>();

let pool: Pool | undefined;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  }
  return pool;
}

function searchPath() {
  try {
    const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema') || 'public';
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema) ? schema : null;
  } catch {
    return null;
  }
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
  // This cache sits in front of authentication; cap it so probing distinct handles
  // cannot grow middleware memory without bound.
  while (entries.size > HANDLE_CACHE_LIMIT) {
    entries.delete(entries.keys().next().value);
  }
  return id;
}

/** Resolve a numeric site-number segment on analytics API paths to the website UUID. */
export async function rewriteHandlePathname(pathname: string): Promise<string> {
  const match = pathname.match(WEBSITE_HANDLE_PATH);
  if (!match) {
    return pathname;
  }

  const id = await resolveHandle(match[2]);
  if (!id) {
    return pathname;
  }

  return `${match[1]}${id}${pathname.slice(match[0].length)}`;
}

export async function rewriteWebsiteHandle(
  request: NextRequest,
): Promise<NextResponse | undefined> {
  const pathname = await rewriteHandlePathname(request.nextUrl.pathname);
  if (pathname === request.nextUrl.pathname) {
    return undefined;
  }

  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url);
}
