import { fixtures } from './catalog.js';
import { S } from './components.js';

export function eventSample(property = 'plan') {
  const event = fixtures.events[S.selected.event] || fixtures.events[0];
  const values =
    {
      plan: [
        ['growth', 187],
        ['starter', 112],
        ['enterprise', 64],
        ['未提供', 23],
      ],
      placement: [
        ['header', 164],
        ['pricing', 117],
        ['footer', 83],
        ['未提供', 22],
      ],
      source: [
        ['organic', 147],
        ['ai-referral', 87],
        ['direct', 96],
        ['未提供', 56],
      ],
      value: [
        ['0–99', 73],
        ['100–299', 128],
        ['300–699', 117],
        ['700+', 68],
      ],
    }[property] || [];
  const total = Number(event[1].replaceAll(',', ''));
  const scaled = values.map(([label, value]) => [label, Math.round((value * total) / 386)]);
  if (scaled.length) scaled.at(-1)[1] += total - scaled.reduce((sum, row) => sum + row[1], 0);
  return { event, total, values: scaled.sort((a, b) => b[1] - a[1]) };
}

export function sessionSample() {
  const row = fixtures.sessions[S.selected.session] || fixtures.sessions[0];
  const pages = Number(row[5]);
  const [minutes, seconds] = row[6].split(':').map(Number);
  const duration = minutes * 60 + seconds;
  const start = row[1].split(':').reduce((sum, value) => sum * 60 + Number(value), 0);
  const paths =
    pages === 1
      ? [row[4]]
      : ['/guide/geo', '/pricing', '/demo', '/demo/thanks', '/solutions', row[4]].slice(0, pages);
  const entries = paths.map((path, i) => ({
    value: path,
    description: `页面访问${i === 0 ? ' · 入口' : i === paths.length - 1 ? ' · 出口' : ''}`,
  }));
  if (pages > 1)
    entries.splice(1, 0, { value: 'navigation_click', description: '事件 · placement: header' });
  if (pages >= 3)
    entries.splice(entries.length - 1, 0, {
      value: 'demo_submit',
      description: '事件 · plan: growth',
    });
  const timeline = entries.map((entry, i) => {
    const elapsed =
      entries.length === 1 ? duration : Math.round((i * duration) / (entries.length - 1));
    const value = (start + elapsed) % 86400;
    return {
      ...entry,
      time: [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60]
        .map(x => String(x).padStart(2, '0'))
        .join(':'),
    };
  });
  return {
    row,
    timeline,
    entry: paths[0],
    exit: paths.at(-1),
    events: entries.filter(x => !x.value.startsWith('/')).map(x => x.value),
  };
}

export function journeySample(settings = S.tab) {
  const type = settings.journeyType || 'all';
  const steps = Math.max(2, Math.min(7, Number(settings.journeySteps || 3)));
  const paths = [
    {
      nodes: [
        '/guide/geo',
        'navigation_click',
        '/pricing',
        'demo_submit',
        '/demo/thanks',
        'report_download',
        '/research',
      ],
      count: 236,
    },
    {
      nodes: [
        '/guide/geo',
        'navigation_click',
        '/solutions',
        'demo_submit',
        '/demo/thanks',
        'trial_start',
        '/welcome',
      ],
      count: 150,
    },
    {
      nodes: [
        '/guide/geo',
        'navigation_click',
        '/pricing',
        'report_download',
        '/research',
        'trial_start',
        '/welcome',
      ],
      count: 187,
    },
  ].map(path => ({
    ...path,
    nodes:
      type === 'pages'
        ? path.nodes.filter(x => x.startsWith('/'))
        : type === 'events'
          ? path.nodes.filter(x => !x.startsWith('/'))
          : path.nodes.filter(x => x !== 'navigation_click'),
  }));
  const start = settings.journeyStart || '',
    end = settings.journeyEnd || '';
  return paths
    .map(path => {
      let nodes = path.nodes;
      if (start) {
        const index = nodes.indexOf(start);
        nodes = index < 0 ? [] : nodes.slice(index);
      }
      if (end) {
        const index = nodes.indexOf(end);
        nodes = index < 0 ? [] : nodes.slice(0, index + 1);
      }
      return { ...path, nodes: nodes.slice(0, steps) };
    })
    .filter(path => path.nodes.length >= 2);
}
