/** Finite request-context observations. These values never affect eligibility. */
export const OBSERVATION_VERSION = 'browser-observation-v1';
type Feature = { state: 'present' | 'missing' | 'invalid'; values: string[] };
export type CollectionObservation = {
  version: typeof OBSERVATION_VERSION;
  receivedAt: string;
  features: Record<'accept' | 'language' | 'site' | 'mode' | 'dest', Feature>;
};
function header(headers: Headers, name: string): string | null | false {
  const value = headers.get(name);
  return value === null
    ? null
    : !value.trim() || value.length > 8192 || /[^\x20-\x7e\t]/.test(value)
      ? false
      : value.trim().toLowerCase();
}
function feature(value: string | null | false, parse: (value: string) => string[] | null): Feature {
  if (value === null) return { state: 'missing', values: [] };
  const values = value === false ? null : parse(value);
  return values ? { state: 'present', values } : { state: 'invalid', values: [] };
}
export function observeCollection(
  request: Pick<Request, 'headers'>,
  receivedAt = new Date(),
): CollectionObservation {
  const enumeration = (name: string, allowed: string[]) =>
    feature(header(request.headers, name), value =>
      /^[a-z][a-z0-9-]*$/.test(value) ? [allowed.includes(value) ? value : 'other'] : null,
    );
  return {
    version: OBSERVATION_VERSION,
    receivedAt: receivedAt.toISOString(),
    features: {
      accept: feature(header(request.headers, 'accept'), value => {
        const types = value.split(',').map(part => part.trim().split(';')[0].trim());
        if (
          types.some(type => !/^(?:[a-z0-9!#$&^_.+-]+|\*)\/(?:[a-z0-9!#$&^_.+-]+|\*)$/.test(type))
        )
          return null;
        return [
          ...new Set(
            types.map(type =>
              type === 'text/html' || type === 'application/xhtml+xml'
                ? 'html'
                : type === 'application/json' || type.endsWith('+json')
                  ? 'json'
                  : type.includes('*')
                    ? 'wildcard'
                    : 'other',
            ),
          ),
        ].sort();
      }),
      language: feature(header(request.headers, 'accept-language'), value =>
        /^(?:\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)(?:\s*;\s*q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?(?:\s*,\s*(?:\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)(?:\s*;\s*q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?)*$/.test(
          value,
        )
          ? ['present']
          : null,
      ),
      site: enumeration('sec-fetch-site', ['none', 'same-origin', 'same-site', 'cross-site']),
      mode: enumeration('sec-fetch-mode', [
        'navigate',
        'same-origin',
        'no-cors',
        'cors',
        'websocket',
      ]),
      dest: enumeration('sec-fetch-dest', [
        'empty',
        'document',
        'iframe',
        'script',
        'image',
        'style',
      ]),
    },
  };
}
