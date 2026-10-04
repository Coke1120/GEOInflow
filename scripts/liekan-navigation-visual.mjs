import assert from 'node:assert/strict';

export async function checkNavigation(page, expected, width, baseline) {
  const sidebar = page.locator('#liekan-navigation');
  if (['auth', 'public'].includes(expected.scope)) {
    assert.equal(await sidebar.count(), 0, `${expected.scope} exposes private navigation`);
    return { scope: expected.scope, standalone: true };
  }
  assert.equal(await sidebar.count(), 1, 'Shared sidebar missing or duplicated');
  const mobile = width <= 900;
  const toggle = page.getByRole('button', { name: '页面导航', exact: true });
  if (mobile) {
    const closed = await sidebar.boundingBox();
    assert(closed && closed.x + closed.width <= 1, 'Mobile sidebar visible before opening');
    await toggle.click();
    await page.waitForFunction(
      () => document.querySelector('#liekan-navigation').getBoundingClientRect().left >= -1,
    );
  }
  if (expected.scope === 'account') {
    const account = sidebar.getByRole('button', { name: '个人账户', exact: true });
    if ((await account.getAttribute('aria-expanded')) !== 'true') await account.click();
  }
  let current;
  try {
    current = await sidebar.evaluate(side => {
      const groups = [...side.querySelectorAll('[data-navigation-group]')].map(el => ({
        id: el.getAttribute('data-navigation-group'),
        label: el.querySelector(':scope > div:not(:has(a))')?.textContent.trim(),
        items: [...el.querySelectorAll('a')].map(a => ({
          label: a.textContent.trim(),
          href: a.getAttribute('href'),
          icon: !!a.querySelector('svg'),
        })),
      }));
      const rect = side.getBoundingClientRect();
      const item = side.querySelector('[data-navigation-primary] a');
      const s = getComputedStyle(item);
      return {
        label: side.getAttribute('aria-label'),
        groups,
        current: [...side.querySelectorAll('a[aria-current="page"]')].map(
          a => a.getAttribute('aria-label') || a.textContent.trim(),
        ),
        primaryButtons: side.querySelectorAll('[data-navigation-primary] button').length,
        footerHeight: side.querySelector('footer').getBoundingClientRect().height,
        footerColors: [...side.querySelectorAll('footer > div > a')].map(a => ({
          selected: a.getAttribute('aria-current') === 'page',
          color: getComputedStyle(a).color,
        })),
        site: !!side.querySelector('.site-switch'),
        account: [...side.querySelectorAll('#account-navigation a')].map(a => a.textContent.trim()),
        fontSize: parseFloat(s.fontSize),
        rowHeight: item.getBoundingClientRect().height,
        rect: { x: rect.x, width: rect.width, right: rect.right },
        focusInside: side.contains(document.activeElement),
      };
    });
    const kind =
      expected.scope === 'admin' ? 'admin' : expected.scope === 'website' ? 'website' : 'global';
    const groups = baseline.groups[kind];
    assert.deepEqual(
      current.groups.map(g => g.id),
      groups.map(g => g.id),
      `${kind} groups`,
    );
    assert.equal(
      current.label,
      kind === 'website' ? '网站导航' : kind === 'admin' ? '系统管理导航' : '全局导航',
    );
    assert.equal(current.primaryButtons, 0, 'Categories must remain static');
    for (const group of groups) {
      const actual = current.groups.find(g => g.id === group.id);
      if (group.children.length) assert.equal(actual.label, group.label, 'Category label');
      const items = group.children.length ? group.children : [group];
      assert.deepEqual(
        actual.items.map(i => i.label),
        items.map(i => i.label),
        `${group.id} permanently expanded items`,
      );
      for (const item of actual.items) {
        assert(item.icon, `Missing icon: ${item.label}`);
        assert(
          item.href?.startsWith('/') && !item.href.startsWith('//'),
          `Invalid link: ${item.label}`,
        );
      }
    }
    const items = groups.flatMap(g => (g.children.length ? g.children : [g]));
    const active =
      expected.scope === 'account'
        ? baseline.account.find(([id]) => id === expected.active)?.[1]
        : expected.active === 'website-settings'
          ? '网站设置'
          : items.find(i => i.page === expected.active)?.label;
    if (expected.scope === 'state') assert(current.current.length <= 1);
    else assert.deepEqual(current.current, [active], 'Selected menu');
    assert.equal(current.site, false, 'Website context must be in the content header');
    assert.equal(current.fontSize, baseline.websiteLayout.fontSize, 'Navigation font');
    assert.equal(
      current.rowHeight,
      mobile ? baseline.websiteLayout.mobileRowHeight : baseline.websiteLayout.rowHeight,
      'Navigation row height',
    );
    assert(current.footerHeight <= 70, 'Footer must fit a single row');
    for (const link of current.footerColors)
      assert.equal(
        link.color,
        link.selected ? 'rgb(15, 98, 254)' : 'rgb(154, 163, 178)',
        'Footer link color',
      );
    await sidebar
      .getByRole('button', { name: '个人账户', exact: true })
      .count()
      .then(n => assert.equal(n, 1));
    assert.equal(await sidebar.getByRole('link', { name: '网站列表', exact: true }).count(), 1);
    assert.equal(
      await sidebar
        .getByRole('link', { name: kind === 'website' ? '网站设置' : '系统管理', exact: true })
        .count(),
      1,
    );
    if (expected.scope === 'account')
      assert.deepEqual(
        current.account,
        baseline.account.map(([, label]) => label),
      );
    assert(Math.abs(current.rect.x) < 1 && current.rect.right <= width);
    assert.equal(current.rect.width, 228);
    if (mobile) {
      assert(current.focusInside, 'Mobile focus must enter sidebar');
      await page.keyboard.press('Shift+Tab');
      assert(
        await sidebar.evaluate(side => side.contains(document.activeElement)),
        'Mobile focus escaped',
      );
    }
  } finally {
    if (mobile) {
      if (await sidebar.locator('#account-navigation').count()) await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () => document.querySelector('#liekan-navigation').getBoundingClientRect().right <= 1,
      );
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert(await toggle.evaluate(el => document.activeElement === el));
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    }
  }
  assert.equal(
    await page.locator('[aria-label="页面位置"]').count(),
    0,
    'Header copy must be title only',
  );
  const tabs = page.locator('[data-analysis-family]').getByRole('tab');
  assert.deepEqual(
    await tabs.allTextContents(),
    (expected.tabs || []).map(t => t.label),
    'Merged view tabs',
  );
  if (expected.tabs?.length) {
    for (const tab of await tabs.all()) {
      const selected = (await tab.getAttribute('aria-selected')) === 'true';
      assert.equal(
        await tab.evaluate(el => getComputedStyle(el).color),
        selected ? 'rgb(15, 98, 254)' : 'rgb(105, 115, 134)',
        'Selected and inactive tab colors',
      );
    }
    const bar = page.locator('[data-analysis-family]');
    const available = await bar.evaluate(el => {
      const parent = el.parentElement;
      const style = getComputedStyle(parent);
      return (
        parent.getBoundingClientRect().width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)
      );
    });
    assert(
      Math.abs((await bar.boundingBox()).width - Math.min(1136, available)) < 2,
      'Tabs must fill the available content width',
    );
    const selected = expected.tabs.find(t => t.page === expected.activeTab);
    assert.equal(
      await page
        .locator('[data-analysis-family]')
        .getByRole('tab', { selected: true })
        .textContent(),
      selected.label,
      'Selected deep-link tab',
    );
  }
  if (expected.scope === 'website') {
    const picker = page.getByRole('button', { name: /切换网站，当前/ });
    assert.equal(await picker.count(), 1);
    const height = await picker.evaluate(el => el.getBoundingClientRect().height);
    assert.equal(height, mobile ? 40 : 36, 'Compact website picker height');
    assert.equal(await page.getByRole('link', { name: '返回网站列表', exact: true }).count(), 1);
    await picker.click();
    const popover = page.getByRole('dialog', { name: '切换网站', exact: true });
    await popover.getByRole('textbox', { name: '搜索网站' }).waitFor();
    assert(
      await popover
        .getByRole('textbox', { name: '搜索网站' })
        .evaluate(el => document.activeElement === el),
    );
    await page.keyboard.press('Escape');
    assert.equal(await popover.count(), 0);
    assert(await picker.evaluate(el => document.activeElement === el));
  } else assert.equal(await page.locator('.site-switch').count(), 0, 'Private context separation');
  return {
    scope: expected.scope,
    primaryCount: current.groups.length,
    current: current.current,
    mobile,
    tabs: expected.tabs?.length || 0,
  };
}
