import { geographyRegion } from './liekan/contracts/geography';
import path from 'node:path';
import { browserName, detectOS } from 'detect-browser';
import ipaddr from 'ipaddr.js';
import isLocalhost from 'is-localhost-ip';
import maxmind from 'maxmind';
import { normalizeCountryCode, normalizeRegionCode } from '@/lib/country';
import { getIpAddress, stripPort } from '@/lib/ip';
import { safeDecodeURIComponent } from '@/lib/url';

const MAXMIND = 'maxmind';
let locationRetryAt = 0;
let locationDatabaseLoading: Promise<void> | undefined;

function unavailableLocation() {
  delete globalThis[MAXMIND];
  locationRetryAt = Date.now() + 60_000;
  // eslint-disable-next-line no-console
  console.warn('City geography unavailable; collection continues with missing location fields.');
}

const PROVIDER_HEADERS = [
  // Umami custom headers (cloud mode only)
  ...(process.env.CLOUD_MODE
    ? [
        {
          countryHeader: 'x-umami-client-country',
          regionHeader: 'x-umami-client-region',
          cityHeader: 'x-umami-client-city',
        },
      ]
    : []),
  // Cloudflare headers
  {
    countryHeader: 'cf-ipcountry',
    regionHeader: 'cf-region-code',
    cityHeader: 'cf-ipcity',
  },
  // Vercel headers
  {
    countryHeader: 'x-vercel-ip-country',
    regionHeader: 'x-vercel-ip-country-region',
    cityHeader: 'x-vercel-ip-city',
  },
  // CloudFront headers
  {
    countryHeader: 'cloudfront-viewer-country',
    regionHeader: 'cloudfront-viewer-country-region',
    cityHeader: 'cloudfront-viewer-city',
  },
  // EdgeOne headers (requires custom request headers in Rule Priorities, see: https://edgeone.ai/document/46151)
  {
    countryHeader: 'eo-ipcountry',
    regionHeader: 'eo-region-code',
    cityHeader: 'eo-ipcity',
  },
];

export function getDevice(userAgent: string | null | undefined, screen: string = '') {
  const ua = userAgent || '';

  // Classify device families from public user-agent tokens; no external device database is used.
  if (/playstation|xbox|nintendo/i.test(ua)) {
    return 'console';
  }

  if (
    /smart[- ]?tv|hbbtv|googletv|appletv|android[- ]?tv|roku|\baft\w+\b|web0s|bravia|viera|netcast/i.test(
      ua,
    )
  ) {
    return 'smarttv';
  }

  if (/applewatch|\bwatch\b|\bwear ?os\b|\bglass\b/i.test(ua)) {
    return 'wearable';
  }

  if (/crkey|chromecast/i.test(ua)) {
    return 'embedded';
  }

  if (
    /ipad|tablet|kindle|playbook|touchpad/i.test(ua) ||
    (/macintosh/i.test(ua) && /\bmobile\b/i.test(ua))
  ) {
    return 'tablet';
  }

  if (/windows phone|windows ce|iemobile/i.test(ua)) {
    return 'mobile';
  }

  if (/\bandroid\b|silk\//i.test(ua)) {
    return /\bmobile\b/i.test(ua) ? 'mobile' : 'tablet';
  }

  if (/iphone|ipod|blackberry|bb10|opera mini|opera mobi|\bmobile\b/i.test(ua)) {
    return 'mobile';
  }

  const [width] = screen.split('x');

  if (screen && +width <= 1920) {
    return 'laptop';
  }

  return 'desktop';
}

function getRegionCode(country: string | null | undefined, region: string | null | undefined) {
  return normalizeRegionCode(region, country);
}

function decodeHeader(s: string | undefined | null): string | undefined | null {
  if (s === undefined || s === null) {
    return s;
  }

  return Buffer.from(s, 'latin1').toString('utf-8');
}

async function isLocalIp(ip: string) {
  try {
    return await isLocalhost(ip);
  } catch {
    return false;
  }
}

export async function getLocation(ip: string = '', headers: Headers, skipHeaders: boolean) {
  const cleanIp = stripPort(ip);

  // Ignore local or invalid ips
  if (!cleanIp || !ipaddr.isValid(cleanIp) || (await isLocalIp(cleanIp))) {
    return null;
  }

  if (!skipHeaders && !process.env.SKIP_LOCATION_HEADERS) {
    for (const provider of PROVIDER_HEADERS) {
      const countryHeader = headers.get(provider.countryHeader);
      if (countryHeader) {
        const sourceCountry = decodeHeader(countryHeader);
        const country = normalizeCountryCode(sourceCountry);
        const region = decodeHeader(headers.get(provider.regionHeader));
        const city = decodeHeader(headers.get(provider.cityHeader));

        const header = { country, region: getRegionCode(sourceCountry, region), city };
        if (header.region && header.city) return header;
        const database = await getLocation(cleanIp, headers, true);
        if (
          !database ||
          database.country !== header.country ||
          (header.region &&
            geographyRegion(header.region, header.country) !==
              geographyRegion(database.region, database.country))
        )
          return header;
        // A city-bearing header without a province supplies no evidence that the two cities agree.
        if (
          header.city &&
          (!database.city ||
            header.city.normalize('NFC').trim().toLowerCase() !==
              database.city.normalize('NFC').trim().toLowerCase())
        )
          return header;
        return {
          country: header.country,
          region: header.region || database.region,
          city: header.city || database.city,
        };
      }
    }
  }

  // Database lookup
  if (!globalThis[MAXMIND]) {
    if (Date.now() < locationRetryAt) return null;
    const dir = path.join(process.cwd(), 'geo');
    locationDatabaseLoading ??= maxmind
      .open(process.env.GEOLITE_DB_PATH || path.resolve(dir, 'GeoLite2-City.mmdb'))
      .then(reader => {
        globalThis[MAXMIND] = reader;
      })
      .catch(() => {
        // Missing geography must not prevent collecting an otherwise valid event.
        unavailableLocation();
      })
      .finally(() => {
        locationDatabaseLoading = undefined;
      });
    await locationDatabaseLoading;
    if (!globalThis[MAXMIND]) return null;
  }

  try {
    const result = globalThis[MAXMIND]?.get(cleanIp);
    if (result) {
      const sourceCountry = result.country?.iso_code ?? result?.registered_country?.iso_code;
      const region = result.subdivisions?.[0]?.iso_code;
      const city = result.city?.names?.en;
      if ([sourceCountry, region, city].some(value => value != null && typeof value !== 'string')) {
        throw new Error('invalid-geography-fields');
      }
      return {
        country: normalizeCountryCode(sourceCountry),
        region: getRegionCode(sourceCountry, region),
        city,
      };
    }
  } catch {
    // A readable database can still contain a corrupt tree or invalid field types.
    unavailableLocation();
    return null;
  }
}

export async function getClientInfo(request: Request, payload: Record<string, any>) {
  const userAgent = payload?.userAgent || request.headers.get('user-agent');
  const ip = payload?.ip || getIpAddress(request.headers);
  const location = await getLocation(ip, request.headers, !!payload?.ip);
  const country = normalizeCountryCode(safeDecodeURIComponent(location?.country));
  const region = normalizeRegionCode(safeDecodeURIComponent(location?.region), country);
  const city = safeDecodeURIComponent(location?.city);
  const browser = payload?.browser ?? browserName(userAgent);
  const os = payload?.os ?? (detectOS(userAgent) as string);
  const device = payload?.device ?? getDevice(userAgent, payload?.screen);

  return { userAgent, browser, os, ip, country, region, city, device };
}

export function hasBlockedIp(clientIp: string) {
  const ignoreIps = process.env.IGNORE_IP;

  if (!clientIp || !ignoreIps) {
    return false;
  }

  const ips = ignoreIps.split(',').map(n => n.trim());

  return ips.some(ip => {
    if (ip === clientIp) {
      return true;
    }

    // CIDR notation
    if (ip.indexOf('/') > 0) {
      try {
        const addr = ipaddr.parse(clientIp);
        const range = ipaddr.parseCIDR(ip);

        if (addr.kind() === range[0].kind() && addr.match(range)) {
          return true;
        }
      } catch {
        // Ignore parsing errors
      }
    }

    return false;
  });
}
