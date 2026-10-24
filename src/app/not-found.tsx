'use client';
import { Flexbox } from '@umami/react-zen';
import { useMessages } from '@/components/hooks';
import { LanguageSelector } from '@/components/liekan/LanguageSelector';

export default function () {
  const { t, labels } = useMessages();

  return (
    <>
      <LanguageSelector compact toolbar />
      <Flexbox alignItems="center" justifyContent="center" flexGrow="1" minHeight="600px">
        <h1>{t(labels.pageNotFound)}</h1>
      </Flexbox>
    </>
  );
}
