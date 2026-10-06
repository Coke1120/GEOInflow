import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const dialogBaseline = JSON.parse(readFileSync('config/liekan/dialog-ui.json', 'utf8'));
export function assertDialogContract() {
  assert.equal(dialogBaseline.baselineVersion, 'liekan-dialog-v0.2.4');
  assert.deepEqual(
    dialogBaseline.scenes.map(scene => scene.id),
    Array.from({ length: 50 }, (_, i) => i + 1),
  );
  const visit = directory =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? visit(join(directory, entry.name)) : [join(directory, entry.name)],
    );
  for (const file of visit('src/components/liekan').filter(
    path => path.endsWith('.tsx') && !path.endsWith('.test.tsx'),
  )) {
    const source = readFileSync(file, 'utf8');
    assert(
      !/<Drawer\b|window\.confirm\s*\(/.test(source),
      `Unmigrated functional drawer or native confirm: ${file}`,
    );
  }
  const css = readFileSync('src/styles/liekan/Features.module.css', 'utf8');
  for (const width of Object.values(dialogBaseline.sizes))
    assert(css.includes(`min(${width}px, 100%)`), `Dialog width ${width} differs`);
  assert(
    !/\.dialog-overlay|\.drawer-in|@keyframes drawer-in/.test(css),
    'Retired functional drawer styles returned',
  );
}

export async function checkDialog(page, size = 'standard') {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page
    .locator('.liekan-dialog .dialog-actions, .liekan-dialog .dialog-default-close:not([hidden])')
    .first()
    .waitFor();
  await page.waitForFunction(() =>
    document.querySelector('[role="dialog"]')?.contains(document.activeElement),
  );
  await dialog.getByText('正在读取网站设置…', { exact: true }).waitFor({ state: 'hidden' });
  await dialog.getByText('正在生成二维码', { exact: true }).waitFor({ state: 'hidden' });
  await page.evaluate(() => document.fonts.ready);
  await dialog
    .locator('img')
    .evaluateAll(images => Promise.all(images.map(image => image.decode())));
  const geometry = await dialog.evaluate(element => {
    const panel = element.querySelector('.liekan-dialog'),
      body = panel.querySelector('.dialog-body'),
      head = panel.querySelector('.dialog-head'),
      footer = panel.querySelector('.dialog-footer');
    const rect = panel.getBoundingClientRect();
    const measure = el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    return {
      width: rect.width,
      height: rect.height,
      centerX: rect.x + rect.width / 2,
      centerY: rect.y + rect.height / 2,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      size: panel.dataset.dialogSize,
      overflow: document.documentElement.scrollWidth - innerWidth,
      bodyOverflow: getComputedStyle(body).overflowY,
      smallActions:
        innerWidth <= 900
          ? [...panel.querySelectorAll('.dialog-body .btn,.dialog-footer .btn')]
              .filter(
                el =>
                  el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height < 43.5,
              )
              .map(el => el.textContent)
          : [],
      headerOverflow: head.scrollWidth - head.clientWidth,
      head: measure(head),
      footer: measure(footer),
      focusInside: element.contains(document.activeElement),
    };
  });
  const margin =
    geometry.viewportWidth <= dialogBaseline.mobileBreakpoint
      ? dialogBaseline.mobileMargin
      : dialogBaseline.desktopMargin;
  assert.equal(geometry.size, size);
  assert(geometry.headerOverflow <= 1, 'Dialog header content exceeds its width');
  assert(
    Math.abs(
      geometry.width - Math.min(dialogBaseline.sizes[size], geometry.viewportWidth - margin * 2),
    ) <= 2,
    `Dialog width: ${JSON.stringify(geometry)}`,
  );
  assert(
    Math.abs(geometry.centerX - geometry.viewportWidth / 2) <= dialogBaseline.centerTolerance,
    'Dialog horizontal center',
  );
  assert(
    Math.abs(geometry.centerY - geometry.viewportHeight / 2) <= dialogBaseline.centerTolerance,
    'Dialog vertical center',
  );
  assert(
    geometry.height <= geometry.viewportHeight - margin * 2 + 2,
    'Dialog height exceeds viewport',
  );
  assert.equal(geometry.overflow, 0, 'Dialog creates page overflow');
  assert.equal(geometry.bodyOverflow, 'auto', 'Dialog body must scroll independently');
  assert.deepEqual(geometry.smallActions, [], 'Mobile dialog actions must reach 44px');
  assert(geometry.focusInside, 'Focus escaped the active dialog');
  await page.locator('.liekan-dialog .dialog-body').evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  const after = await dialog.evaluate(element => {
    const panel = element.querySelector('.liekan-dialog');
    return ['.dialog-head', '.dialog-footer'].map(selector => {
      const rect = panel.querySelector(selector).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
  });
  assert.deepEqual(
    after,
    [geometry.head, geometry.footer],
    'Header or footer moved with body scrolling',
  );
  await page.locator('.liekan-dialog .dialog-body').evaluate(element => {
    element.scrollTop = 0;
  });
  return geometry;
}
