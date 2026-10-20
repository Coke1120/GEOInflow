// The immutable prototype has seven crawler-page columns. Read its data using
// that schema before adding the separately approved title column to its rendering.
export function referenceColumns(columns) {
  return Object.fromEntries(
    Object.entries(columns).map(([table, fields]) => [
      table,
      table === 'apBody' ? fields.filter(([field]) => field !== 'title') : fields,
    ]),
  );
}

// Runs in the reference browser only; never derives expected markup from the app.
// Mirrors the bounded crawler-page additions from the already merged 947897979.
export function approveCrawlerPagesReference(approval) {
  const table = document.getElementById(approval.table).closest('table');
  const heading = table.previousElementSibling;
  const controls = heading.lastElementChild;
  heading.style.flexWrap = controls.style.flexWrap = 'wrap';
  const select = document.createElement('select');
  select.className = 'chip';
  select.setAttribute('aria-label', approval.crawlerSelector);
  select.add(new Option(approval.defaultCrawler, ''));
  controls.prepend(select);
  const types = document.createElement('div');
  types.className = 'px-6 py-4 border-b border-line flex items-center gap-2';
  types.style.flexWrap = 'wrap';
  for (const [index, label] of approval.typeFilters.entries()) {
    const button = document.createElement('button');
    button.className = `chip${index === 0 ? ' on' : ''}`;
    button.textContent = label;
    types.append(button);
  }
  table.before(types);
  table.classList.add('crawler-pages-table');
  table.tHead.style.whiteSpace = 'nowrap';
  const title = document.createElement('th');
  title.className = 'font-medium px-4 py-3';
  title.textContent = approval.addedColumn.label;
  table.tHead.rows[0].cells[0].after(title);
  table.tHead.rows[0].cells[4].className = 'font-medium px-4 py-3 text-right';
  for (const row of table.tBodies[0].rows) {
    const title = row.insertCell(1);
    title.className = 'px-4 py-3 text-[12px] text-ink';
    title.textContent = '未提供';
    const heat = row.cells[4];
    heat.textContent = heat.querySelector('span').textContent;
    heat.className = 'px-4 py-3 num text-right text-sub';
    const bot = row.cells[5];
    const wrapper = document.createElement('span');
    wrapper.className = 'crawler-page-leaders';
    const value = document.createElement('span');
    value.textContent = bot.textContent;
    wrapper.append(value);
    bot.replaceChildren(wrapper);
  }
  const style = document.createElement('style');
  style.textContent = `
    .crawler-pages-table th:first-child { min-width:156px; }
    .crawler-pages-table :is(th,td):first-child { width:30%; max-width:360px; overflow-wrap:anywhere; }
    .crawler-pages-table :is(th,td):nth-child(2) { min-width:160px; max-width:240px; overflow-wrap:anywhere; }
    .crawler-pages-table :is(th,td):nth-child(5) { width:1%; white-space:nowrap; }
    .crawler-pages-table :is(th,td):nth-child(6) { width:1%; }
    .crawler-page-leaders { display:flex; flex-direction:column; width:max-content; max-width:144px; }
    .crawler-page-leaders > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    select.chip { max-width:100%; appearance:none; padding-right:40px;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23697386' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat:no-repeat; background-position:right 12px center; background-size:16px 16px; }
  `;
  document.head.append(style);
}
