/** @param {Record<string, string | undefined>} [env] */
export function acceptancePort(env = process.env) {
  const input = env.LIEKAN_ACCEPTANCE_PORT ?? '3302';
  if (!/^[1-9]\d{0,4}$/.test(input) || Number(input) > 65535)
    throw new Error('LIEKAN_ACCEPTANCE_PORT must be an integer from 1 to 65535');
  return Number(input);
}

/**
 * @param {string} base
 * @param {{env?: Record<string, string | undefined>, aiPreview?: boolean, localhost?: boolean}} [options]
 */
export function isolatedAcceptanceTarget(
  base,
  { env = process.env, aiPreview = false, localhost = true } = {},
) {
  const target = new URL(base);
  const hosts = localhost ? ['127.0.0.1', 'localhost'] : ['127.0.0.1'];
  const ports = [String(acceptancePort(env))];
  if (aiPreview && env.LIEKAN_ACCEPTANCE_PORT === undefined) ports.push('3305');
  if (
    target.protocol !== 'http:' ||
    !hosts.includes(target.hostname) ||
    !ports.includes(target.port || '80') ||
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  )
    throw new Error('Use the explicitly configured isolated loopback candidate');
  return target;
}

export function acceptanceRuntimeDirectory(target) {
  return `tests/api/.runtime/${target.host.replace(/[^a-z0-9.-]+/gi, '-')}`;
}

export function acceptanceSeedFile(target) {
  return `${acceptanceRuntimeDirectory(target)}/seed.json`;
}
