import { normalizeCountryCode } from './country';

export const percentFilter = (data: any[]) => {
  if (!Array.isArray(data)) return [];
  const total = data.reduce((n, { y }) => n + y, 0);
  return data.map(({ x, y, ...props }) => ({ x, y, z: total ? (y / total) * 100 : 0, ...props }));
};

export const mergeCountryMetrics = (data: any[]) => {
  if (!Array.isArray(data)) return [];

  const map = new Map<string, any>();

  data.forEach(({ x, y = 0, ...props }) => {
    const code = normalizeCountryCode(x);

    if (!code) {
      return;
    }

    const current = map.get(code);

    if (current) {
      current.y += y;
    } else {
      map.set(code, { x: code, y, ...props });
    }
  });

  return [...map.values()].sort((a, b) => b.y - a.y);
};

export const paramFilter = (data: any[]) => {
  const map = data.reduce((obj, { x, y }) => {
    try {
      const searchParams = new URLSearchParams(x);

      for (const [key, value] of searchParams) {
        if (!obj[key]) {
          obj[key] = { [value]: y };
        } else if (!obj[key][value]) {
          obj[key][value] = y;
        } else {
          obj[key][value] += y;
        }
      }
    } catch {
      // Ignore
    }

    return obj;
  }, {});

  return Object.keys(map).flatMap(key =>
    Object.keys(map[key]).map(n => ({ x: `${key}=${n}`, p: key, v: n, y: map[key][n] })),
  );
};
