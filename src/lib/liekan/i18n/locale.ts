export const liekanLocales = ['zh-CN', 'en-US'] as const;
export type LiekanLocale = (typeof liekanLocales)[number];
export const localeCookie = 'liekan.locale';

export function isLiekanLocale(value: unknown): value is LiekanLocale {
  return value === 'zh-CN' || value === 'en-US';
}

export function defaultLiekanLocale(value?: string): LiekanLocale {
  return value?.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

export function readLocaleCookie(cookies: string): LiekanLocale | undefined {
  const value = cookies.split(';').find(part => part.trim().startsWith(`${localeCookie}=`));
  if (!value) return undefined;
  try {
    const locale = decodeURIComponent(value.trim().slice(localeCookie.length + 1));
    return isLiekanLocale(locale) ? locale : undefined;
  } catch {
    return undefined;
  }
}

/** Cookie is the current preference; local storage provides the upgrade path. */
export function resolveLiekanLocale(input: {
  cookie?: unknown;
  stored?: unknown;
  hint?: unknown;
  configured?: string;
}): LiekanLocale {
  for (const value of [input.cookie, input.stored, input.hint])
    if (isLiekanLocale(value)) return value;
  return defaultLiekanLocale(input.configured);
}
