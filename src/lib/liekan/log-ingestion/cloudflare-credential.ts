export function cloudflareRefreshTokenIssued(
  access: { refreshToken?: unknown } | null | undefined,
) {
  return typeof access?.refreshToken === 'string' && access.refreshToken.trim().length > 0;
}

export function cloudflareAccessExpired(
  access: { expiresAt?: number; refreshToken?: unknown },
  now = Date.now(),
) {
  return (
    typeof access.expiresAt === 'number' &&
    access.expiresAt < now &&
    !cloudflareRefreshTokenIssued(access)
  );
}

export function cloudflareProviderCredentialUnusable(health: unknown) {
  let value = health;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { providerCredentialUnusable?: unknown }).providerCredentialUnusable === true,
  );
}

export function publishLogSource<
  T extends { id: string; kind: string; provider_config?: string | null },
>(row: T, open: (value: string, purpose: string) => string) {
  const { provider_config: sealed, ...source } = row;
  if (row.kind !== 'cloudflare' || typeof sealed !== 'string' || !sealed) return source;
  try {
    const issued = cloudflareRefreshTokenIssued(JSON.parse(open(sealed, row.id)));
    return { ...source, refreshTokenIssued: issued };
  } catch {
    return source;
  }
}
