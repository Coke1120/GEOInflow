import { Row } from '@umami/react-zen';
import type { ReactNode } from 'react';
import { normalizeCountryCode } from '@/lib/country';

export function TypeIcon({
  type,
  value,
  children,
}: {
  type: 'browser' | 'country' | 'device' | 'os';
  value: string;
  children?: ReactNode;
}) {
  const iconValue =
    type === 'country'
      ? normalizeCountryCode(value)
      : type === 'browser' && value === 'browser'
        ? 'unknown'
        : value;

  return (
    <Row gap="3" alignItems="center">
      <img
        src={`${process.env.basePath || ''}/images/${type}/${
          iconValue?.replaceAll(' ', '-').toLowerCase() || 'unknown'
        }.png`}
        onError={e => {
          e.currentTarget.src = `${process.env.basePath || ''}/images/${type}/unknown.png`;
        }}
        alt={iconValue}
        width={type === 'country' ? undefined : 16}
        height={type === 'country' ? undefined : 16}
      />
      {children}
    </Row>
  );
}
