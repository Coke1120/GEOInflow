import { author, license, version } from '../../../../package.json';
import { HELP_REVIEWED_AT, type HelpArticle } from '../help/types';

export const liekanProduct = {
  name: 'Liekan',
  displayName: '猎看统计',
  version,
  copyright: `© 2026 ${author}`,
  license,
  upstream: { name: 'Umami', href: 'https://github.com/umami-software/umami' },
  links: {
    about: '/liekan/help?article=project-about',
    changelog: '/liekan/help?article=project-changelog',
    license: '/liekan/help?article=project-license',
    help: '/liekan/help',
    author: 'https://x.com/yaojingang',
  },
} as const;

export const liekanFooterLinks = [
  { label: '更新日志', href: liekanProduct.links.changelog },
  { label: '作者 X', href: liekanProduct.links.author },
  { label: '帮助文档', href: liekanProduct.links.help },
  { label: '项目说明', href: liekanProduct.links.about },
] as const;

export const projectArticles: HelpArticle[] = [
  {
    id: 'project-about',
    section: 'start',
    title: '关于猎看统计',
    summary: '面向 GEO 增长的 AI 与搜索流量分析系统。',
    keywords: ['Liekan', '项目说明', '开源'],
    blocks: [
      {
        title: '项目与版本',
        paragraphs: [
          `${liekanProduct.displayName}（${liekanProduct.name}）当前版本为 ${liekanProduct.version}。系统提供浏览器采集、账号权限、网站与团队、目标和漏斗，通过独立日志接入分析 AI 抓取行为与搜索引荐。`,
        ],
      },
      {
        title: '数据与使用范围',
        paragraphs: [
          '浏览统计来自网站实际收到的采集数据，AI 抓取分析来自接入的服务器日志。缺少输入、当前期间无数据、估算和未支持的字段分别展示。演示站使用独立的示例数据标识。',
        ],
      },
      {
        title: '开源许可',
        paragraphs: [
          'Liekan 使用 MIT 许可。第三方图表、字体、组件与地理数据适用各自的许可。',
          '本版提供站内帮助、更新日志和许可说明；项目公开仓库链接将在发布后补充。',
        ],
      },
    ],
    sources: [{ label: '作者 X 主页', url: liekanProduct.links.author }],
    related: ['project-changelog', 'project-license', 'connect-website', 'reading-data'],
    reviewedAt: HELP_REVIEWED_AT,
  },
  {
    id: 'project-changelog',
    section: 'start',
    title: '猎看统计更新日志',
    summary: '查阅已发布版本的主要变化。',
    keywords: ['更新', '版本', 'changelog', 'release'],
    blocks: [
      {
        title: '0.2.4',
        paragraphs: [
          '完整登录状态保留 90 天，同一浏览器再次打开后台自动恢复登录。主动退出和密码变更后需要重新登录。',
          '临时网络或服务故障保留已保存的登录凭据，双重验证完成后进入后台。',
        ],
      },
      {
        title: '0.2.3',
        paragraphs: [
          '创建链接、像素和看板可选择有权限的所属空间，创建及看板编辑等待空间和来源加载完成。详情进入分析工具后保留原模块的返回入口。',
          '切换网站保留日期与网站列表条件，修复重复退出影响新会话和后退时保留过期网站切换确认的问题。',
        ],
      },
      {
        title: '0.2.2',
        paragraphs: [
          '统一全局管理、网站分析、个人账户和系统管理的导航层级。网站信息与切换入口集中展示，跨网站切换清除原网站条件。',
          '网站设置按基本信息、安装接入、采集设置、分享设置和危险操作组织，统一数据缺失状态、操作文案和移动端导航。',
        ],
      },
      {
        title: '0.2.0',
        paragraphs: [
          '接入 GEO 统计和补充 UI，统一身份安全、访客分析、目标漏斗、工作台、协作和分享。新增完整导出、路径明细、精确滚动与来源地域统计。',
          '分享密码使用哈希保存，分享请求实时校验权限、资源归属和可见范围。',
        ],
      },
    ],
    sources: [],
    related: ['project-about', 'project-license'],
    reviewedAt: HELP_REVIEWED_AT,
  },
  {
    id: 'project-license',
    section: 'start',
    title: '开源许可与版权说明',
    summary: 'Liekan 主项目采用 MIT 许可，保留上游版权与第三方许可。',
    keywords: ['MIT', '版权', 'license', '开源', 'Umami'],
    blocks: [
      {
        title: '版权归属',
        paragraphs: [
          'Copyright (c) 2022 Umami Software, Inc. <hello@umami.is>',
          'Copyright (c) 2026 Liekan contributors',
        ],
      },
      {
        title: 'MIT License',
        paragraphs: [
          'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
          'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
          'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
        ],
      },
      {
        title: '第三方组件与数据',
        paragraphs: [
          'Umami 保留 MIT 版权；Apache ECharts 使用 Apache-2.0，Inter 字体使用 SIL Open Font License 1.1。可选 GeoLite2 地理数据适用 MaxMind 数据条款。',
          '各依赖的 LICENSE/COPYING 随安装包保留，完整第三方声明见项目分发文件 THIRD_PARTY_NOTICES.md。',
        ],
      },
    ],
    sources: [{ label: 'Umami 上游项目', url: liekanProduct.upstream.href }],
    related: ['project-about', 'project-changelog'],
    reviewedAt: HELP_REVIEWED_AT,
  },
];
