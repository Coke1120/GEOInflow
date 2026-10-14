'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { GeographyAttribution } from '@/components/liekan/GeographyAttribution';
import { Column, Row } from '@umami/react-zen';
import { useShare } from '@/components/hooks';
import { ShareBranding } from './ShareBranding';

export function ShareFooter() {
  const share = useShare();
  const i18n = useLiekanI18n();

  return (
    <Column
      paddingX={{ base: '3', md: '6' }}
      width="100%"
      maxWidth="1320px"
      style={{ margin: '0 auto' }}
    >
      <Row border="top" justifyContent="flex-end" paddingY="4" gap wrap="wrap">
        <GeographyAttribution />
        <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">
          {i18n.text('地名数据：GeoNames（已整理）')}
        </a>
        {share?.whiteLabel && <ShareBranding size="sm" />}
      </Row>
    </Column>
  );
}
