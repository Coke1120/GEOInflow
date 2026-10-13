import { processSingleton } from './process-singleton';
const authenticated = processSingleton(
  'liekan-authenticated-collection',
  () => new WeakSet<Request>(),
);

export function isAuthenticatedCollection(request: Request) {
  return authenticated.has(request);
}

// Only a server-side permission check can establish collection provenance.
export async function withAuthenticatedCollection<T>(
  request: Request,
  work: () => Promise<T>,
): Promise<T> {
  authenticated.add(request);
  try {
    return await work();
  } finally {
    authenticated.delete(request);
  }
}
