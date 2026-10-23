import type { IdentityIngressDiagnostic } from '../contracts/installation';

/** Configuration presence is an operator diagnostic; it does not prove proxy/header provenance. */
export function identityIngressDiagnostic(
  env: Record<string, string | undefined> = process.env,
): IdentityIngressDiagnostic {
  const names = [env.CLIENT_IP_HEADER, ...(env.CLOUD_MODE ? ['x-umami-client-ip'] : [])].filter(
    Boolean,
  );
  const configured = names.some(name => /^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name));
  return { configured, state: configured ? 'needs_ingress_verification' : 'missing_configuration' };
}
