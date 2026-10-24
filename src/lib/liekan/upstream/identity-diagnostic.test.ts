import { expect, it } from 'vitest';
import { identityIngressDiagnostic } from './identity-diagnostic';
it('does not turn header configuration into proof of trusted ingress', () => {
  expect(identityIngressDiagnostic({ CLIENT_IP_HEADER: 'x-real-ip' })).toEqual({
    configured: true,
    state: 'needs_ingress_verification',
  });
  expect(identityIngressDiagnostic({})).toEqual({
    configured: false,
    state: 'missing_configuration',
  });
  expect(identityIngressDiagnostic({ CLIENT_IP_HEADER: 'invalid header' }).configured).toBe(false);
});
