'use client';
import { Column, Grid, Loading, Row } from '@umami/react-zen';
import Script from 'next/script';
import { useEffect } from 'react';
import { MobileNav } from '@/app/(main)/MobileNav';
import { SideNav } from '@/app/(main)/SideNav';
import { TopNav } from '@/app/(main)/TopNav';
import {
  useConfig,
  useLoginQuery,
  useNavigation,
  useTeamQuery,
  useTwoFactorStatusQuery,
} from '@/components/hooks';
import { isLiekanRoute, isWebsiteLanding } from '@/components/liekan/data';
import { NavigationFrame } from '@/components/liekan/NavigationFrame';
import { PageLoadingFrame } from '@/components/liekan/PageLoadingFrame';
import { geoPageFromPath } from '@/lib/liekan/contracts/navigation';
import { LiekanShell } from '@/components/liekan/LiekanShell';
import { FeatureApp, canRenderFeatureRoute } from '@/components/liekan/features/FeatureApp';
import { matchFeatureRoute } from '@/components/liekan/features/routes';
import { TwoFactorSetupModal } from '@/components/modals/TwoFactorSetupModal';
import { LAST_TEAM_CONFIG } from '@/lib/constants';
import { removeItem, setItem } from '@/lib/storage';
import { UpdateNotice } from './UpdateNotice';

export function App({ children }) {
  const { user, isLoading, error } = useLoginQuery();
  const config = useConfig();
  const { pathname, router, teamId, websiteId, query } = useNavigation();
  const showLiekan = query.legacy !== '1';
  const isGeo = isLiekanRoute(pathname);
  const featureRoute = matchFeatureRoute(pathname, query);
  const showFeature = canRenderFeatureRoute(featureRoute);
  const { isLoading: isTeamLoading, error: teamError } = useTeamQuery(teamId);
  const { data: twoFactorStatus } = useTwoFactorStatusQuery(!!user && !config?.cloudMode);
  const needsTwoFactorSetup = !!(twoFactorStatus?.isRequired && !twoFactorStatus?.isEnabled);

  useEffect(() => {
    if (teamId) {
      setItem(LAST_TEAM_CONFIG, teamId);
    } else {
      removeItem(LAST_TEAM_CONFIG);
    }
  }, [teamId]);

  useEffect(() => {
    if (teamId && teamError) {
      removeItem(LAST_TEAM_CONFIG);
      router.replace('/');
    }
  }, [teamId, teamError, router]);

  useEffect(() => {
    if (user && !isLoading && query.legacy !== '1' && isWebsiteLanding(pathname)) {
      router.replace(`${pathname}/geo${window.location.search}`);
    }
  }, [user, isLoading, pathname, query.legacy, router]);

  if (isLoading || !config) {
    return <Loading placement="absolute" />;
  }

  if (error) {
    window.location.href = config.cloudMode
      ? `${process.env.cloudUrl}/login`
      : `${process.env.basePath || ''}/login`;
    return null;
  }

  if (!user || !config) {
    return null;
  }

  if (teamId && teamError) {
    return null;
  }

  return (
    <>
      <NavigationFrame
        user={user}
        route={
          isGeo
            ? { page: geoPageFromPath(pathname), websiteId }
            : featureRoute || { page: 'dashboard' }
        }
        enabled={
          (showFeature || showLiekan) &&
          !(
            showFeature &&
            (needsTwoFactorSetup ||
              ['share-preview', 'two-factor', 'backup-codes'].includes(featureRoute.page))
          )
        }
      >
        {teamId && isTeamLoading ? (
          <PageLoadingFrame page={featureRoute?.page || 'dashboard'} />
        ) : showFeature ? (
          <FeatureApp user={user} route={featureRoute} forceSetup={needsTwoFactorSetup} />
        ) : showLiekan ? (
          <LiekanShell user={user}>
            <div
              aria-hidden={needsTwoFactorSetup || undefined}
              style={needsTwoFactorSetup ? { pointerEvents: 'none' } : undefined}
            >
              {!isGeo && <TopNav />}
              {children}
            </div>
          </LiekanShell>
        ) : (
          <Grid
            columns={{ base: '1fr', lg: 'auto 1fr' }}
            rows={{ base: 'auto 1fr', lg: '1fr' }}
            height="screen"
          >
            <Row display={{ base: 'flex', lg: 'none' }} alignItems="center" gap padding="3">
              <MobileNav />
            </Row>
            <Column
              display={{ base: 'none', lg: 'flex' }}
              minHeight="0"
              style={{ overflow: 'hidden' }}
            >
              <SideNav />
            </Column>
            <Column overflowX="hidden" minHeight="0" position="relative">
              <TopNav />
              <Column
                alignItems="center"
                aria-hidden={needsTwoFactorSetup || undefined}
                style={needsTwoFactorSetup ? { pointerEvents: 'none' } : undefined}
              >
                {children}
              </Column>
            </Column>
          </Grid>
        )}
      </NavigationFrame>
      {needsTwoFactorSetup && !showFeature && <TwoFactorSetupModal required={true} />}
      {!showLiekan && <UpdateNotice user={user} config={config} />}
      {process.env.NODE_ENV === 'production' && !pathname.includes('/share/') && (
        <Script src={`${process.env.basePath || ''}/telemetry.js`} />
      )}
      {process.env.selfTrack && (
        <Script
          async
          data-website-id={process.env.selfTrack}
          src={`${process.env.basePath || ''}/script.js`}
          data-cache="true"
          data-performance="true"
        />
      )}
      {process.env.selfRecord && (
        <Script
          async
          data-website-id={process.env.selfRecord}
          data-sample-rate="1"
          src={`${process.env.basePath || ''}/recorder.js`}
        />
      )}
    </>
  );
}
