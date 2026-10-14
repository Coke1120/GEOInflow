'use client';
import { useEffect, useState } from 'react';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
export function GeographyAttribution() {
  const i18n = useLiekanI18n();
  const [links, setLinks] = useState([
    { label: 'IP Geolocation by DB-IP', href: 'https://db-ip.com' },
  ]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/liekan/geography/attribution', { signal: controller.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (
          Array.isArray(data?.links) &&
          data.links.every(
            l =>
              typeof l.label === 'string' &&
              [
                'https://db-ip.com',
                'https://www.maxmind.com',
                'https://github.com/lionsoul2014/ip2region',
                '/liekan/help?article=project-about',
              ].includes(l.href),
          )
        )
          setLinks(data.links);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <>
      {links.map(link => (
        <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
          {i18n.system(link.label)}
        </a>
      ))}
    </>
  );
}
