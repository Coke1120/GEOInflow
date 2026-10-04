'use client';
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
          ['gtm', '标签管理器'],
        ]}
        active={tab}
        onChange={setTab}
      />
      <Code>{snippet || '正在生成安装代码…'}</Code>
      <div className="row">
        <Button
          disabled={!snippet}
          onClick={async () => {
            await navigator.clipboard.writeText(snippet);
            c.notify('安装代码已复制');
          }}
        >
          <Icon name="copy" />
          复制安装代码
        </Button>
        <span className="muted">使用当前网站标识与本实例地址。</span>
      </div>
    </>
  );
}
