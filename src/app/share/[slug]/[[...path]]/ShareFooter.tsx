'use client';
import { Column, Row } from '@umami/react-zen';
import { useShare } from '@/components/hooks';
import { ShareBranding } from './ShareBranding';

export function ShareFooter() {
  const share = useShare();

  return (
    <Column
      paddingX={{ base: '3', md: '6' }}
      width="100%"
      maxWidth="1320px"
      style={{ margin: '0 auto' }}
    >
      <Row border="top" justifyContent="flex-end" paddingY="4" gap wrap="wrap">
        <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">
          IP Geolocation by DB-IP
        </a>
        {share?.whiteLabel && <ShareBranding size="sm" />}
      </Row>
    </Column>
  );
}
