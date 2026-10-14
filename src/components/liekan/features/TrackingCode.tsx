'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import { useEffect, useState } from 'react';
import { trackerSnippet } from '@/lib/liekan/contracts/core';
import { useFeature } from './context';
import { Button, Code, Icon, Tabs } from './ui';

export function TrackingCode({
  websiteId,
  file = 'script.js',
}: {
  websiteId: string;
  file?: string;
}) {
  const i18n = useLiekanI18n();
  const c = useFeature();
  const [tab, setTab] = useState('html');
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const snippet = origin
    ? trackerSnippet(origin, process.env.basePath || '', websiteId, tab, file)
    : '';
  return (
    <>
      <Tabs
        items={[
          ['html', 'HTML'],
          ['next', 'Next.js'],
          ['gtm', i18n.text('标签管理器')],
        ]}
        active={tab}
        onChange={setTab}
      />
      <Code>{snippet || i18n.text('正在生成安装代码…')}</Code>
      <div className="row">
        <Button
          disabled={!snippet}
          onClick={async () => {
            await navigator.clipboard.writeText(snippet);
            c.notify('安装代码已复制');
          }}
        >
          <Icon name="copy" />
          {i18n.fragment('复制安装代码', true, false)}
        </Button>
        <span className="muted">{i18n.text('使用当前网站标识与本实例地址。')}</span>
      </div>
    </>
  );
}
