/* Publish the first screen after its layout and initial data have settled. */
(() => {
  'use strict';
  const root = document.documentElement;
  const tasks = new Set();
  const chartApis = new WeakSet(), chartInstances = new WeakSet();
  let loaded = false, settled = false, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const parsed = document.readyState === 'loading'
    ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, {once: true}))
    : Promise.resolve();

  root.dataset.pageBooting = '';
  root.style.backgroundColor = '#F5F7FA';
  const style = document.createElement('style');
  style.textContent = 'html[data-page-booting] body{visibility:hidden}'
    + '.fade-in{animation:none!important;opacity:1!important;transform:none!important}';
  document.head.appendChild(style);

  function finish() {
    if (!loaded || tasks.size || settled) return;
    settled = true;
    delete root.dataset.pageBooting;
    resolveReady();
    dispatchEvent(new Event('prototype-ready'));
  }
  function hold(promise) {
    const task = Promise.resolve(promise);
    if (settled) return task;
    tasks.add(task);
    task.then(() => { tasks.delete(task); finish(); }, () => { tasks.delete(task); finish(); });
    return task;
  }
  function charts(api) {
    if (!api || chartApis.has(api)) return;
    chartApis.add(api);
    const init = api.init;
    api.init = function (...args) {
      const chart = init.apply(this, args);
      if (chartInstances.has(chart)) return chart;
      chartInstances.add(chart);
      const setOption = chart.setOption;
      let first = true;
      chart.setOption = function (option, ...rest) {
        if (first || !settled) {
          first = false;
          option = {...option, animation: false};
        }
        return setOption.call(this, option, ...rest);
      };
      return chart;
    };
  }
  window.PageBoot = {ready, parsed, hold, charts, get settled() { return settled; }};
  function onLoad() {
    hold(document.fonts.ready);
    loaded = true;
    finish();
  }
  if (document.readyState === 'complete') onLoad();
  else addEventListener('load', onLoad, {once: true});
})();
