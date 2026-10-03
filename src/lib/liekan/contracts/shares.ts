export function validShareParameters(value: unknown) {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    (p.password == null ||
      (typeof p.password === 'string' && new TextEncoder().encode(p.password).byteLength <= 72)) &&
    (p.enabled === undefined || typeof p.enabled === 'boolean')
  );
}
