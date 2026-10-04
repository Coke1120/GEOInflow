import type { HttpMethod } from '../client';
import { loadOperations } from '../coverage/oracle';
export const getAiEndpoints = () =>
  loadOperations()
    .filter(operation => operation.path.startsWith('/api/liekan/ai/'))
    .map(operation => ({
      method: operation.method.toUpperCase() as HttpMethod,
      path: operation.path.replace(/\{[^}]+\}/g, '11111111-1111-4111-8111-111111111111'),
    }));
