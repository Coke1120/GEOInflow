import assert from 'node:assert/strict';
import { checkDialog } from './liekan-dialog-contract.mjs';

// Isolated checker fixtures exercise asynchronous layout and real scroll failures.
export async function verifyDialogChecker(browser, checker = checkDialog) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  try {
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; }
        [role=dialog] { position: fixed; inset: 0; display: flex;
          align-items: center; justify-content: center; }
        .liekan-dialog { width: 920px; max-height: calc(100vh - 64px); display: flex;
          flex-direction: column; border: 1px solid; }
        .dialog-head, .dialog-footer { flex: none; height: 60px; }
        .dialog-body { overflow-y: auto; }
        .content { height: 250px; }
        [role=status] { margin: 0; height: 38px; }
      </style>
      <div role="dialog" aria-label="Checker fixture">
        <div class="liekan-dialog" data-dialog-size="standard">
          <div class="dialog-head">Header</div>
          <div class="dialog-body">
            <div class="content">Asynchronous comparison fixture</div>
            <p role="status">正在读取上周数据…</p>
          </div>
          <div class="dialog-footer"><div class="dialog-actions">
            <button autofocus>Close</button>
          </div></div>
        </div>
      </div>
      <script>
        window.finishRead = () => {
          clearTimeout(window.pendingRead);
          document.querySelector('[role=status]')?.remove();
        };
      </script>
    `);
    await page.getByRole('button', { name: 'Close' }).focus();
    const getByRole = page.getByRole.bind(page);
    page.getByRole = (...args) => {
      const locator = getByRole(...args);
      if (args[0] === 'dialog') {
        const evaluate = locator.evaluate.bind(locator);
        locator.evaluate = async (...input) => {
          const value = await evaluate(...input);
          if (value?.width) {
            // Complete the read between measuring geometry and attempting to scroll.
            await page.evaluate(() => window.finishRead());
          }
          return value;
        };
      }
      return locator;
    };
    for (const label of [
      '正在读取上周数据…',
      '正在读取数据',
      '正在读取统计数据',
      'Loading data',
      'Loading analytics',
    ]) {
      await page.evaluate(label => {
        window.finishRead();
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.textContent = label;
        document.querySelector('.dialog-body').appendChild(status);
      }, label);
      const firstHeight = await page.locator('.liekan-dialog').evaluate(el => el.offsetHeight);
      assert.equal(await page.getByRole('status').count(), 1, 'Fixture starts with a pending read');
      await page.evaluate(() => {
        window.pendingRead = setTimeout(window.finishRead, 1500);
      });
      const geometry = await checker(page);
      assert.equal(geometry.height, firstHeight - 38, `Measure completed layout: ${label}`);
      assert.equal(await page.getByRole('status').count(), 0, `Read must finish: ${label}`);
    }
    page.getByRole = getByRole;
    await page.locator('.content').evaluate(el => (el.style.height = '1800px'));
    const getLocator = page.locator.bind(page);
    page.locator = (...args) => {
      const locator = getLocator(...args);
      if (args[0] === '.liekan-dialog .dialog-body') {
        const evaluate = locator.evaluate.bind(locator);
        locator.evaluate = async (...input) => {
          const value = await evaluate(...input);
          await page.evaluate(() => {
            if (document.querySelector('.dialog-body').scrollTop > 0)
              document.querySelector('.dialog-head').style.transform = 'translateY(-8px)';
          });
          return value;
        };
      }
      return locator;
    };
    await assert.rejects(checker(page), /Header or footer moved with body scrolling/);
    return {
      pendingComparison: 'passed',
      pendingGeneric: 'passed',
      pendingEnglish: 'passed',
      movingHeaderRejected: 'passed',
    };
  } finally {
    await context.close();
  }
}
