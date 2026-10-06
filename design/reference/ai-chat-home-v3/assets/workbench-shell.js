/* One navigation state and width controller for all customer workbench pages. */
(function () {
  'use strict';
  const sidebar = document.querySelector('body > aside');
  const main = document.querySelector('[data-workbench-main]');
  const toolbar = document.querySelector('[data-workbench-toolbar]');
  if (!sidebar || !main || !toolbar) return;

  const widthKey = 'lk-side-w';
  const stateKey = 'lk-sidebar-hidden';
  const desktop = matchMedia('(min-width: 801px)');
  const clamp = value => Math.max(180, Math.min(320, Math.round(value)));
  let width = 228, collapsed = false, mobileOpen = false, resizeFrame = 0;
  try {
    const saved = Number(localStorage.getItem(widthKey));
    if (Number.isFinite(saved) && saved > 0) width = clamp(saved);
  } catch (_) {}
  try { collapsed = sessionStorage.getItem(stateKey) === 'true'; } catch (_) {}

  document.body.classList.add('lk-shell');
  sidebar.classList.add('lk-sidebar');
  sidebar.id = 'lkSidebar';
  sidebar.setAttribute('aria-label', '工作台菜单');
  function refreshContentNavigation() {
    sidebar.querySelectorAll('nav a[href]').forEach(link => {
      const target = new URL(link.getAttribute('href'), location.href).pathname.split('/').pop();
      if (target === 'questions.html') { link.remove(); return; }
      const label = target === 'answers.html' ? '意图数据' : target === 'competitors.html' ? '行业分析' : null;
      if (!label) return;
      const text = [...link.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (text) text.textContent = label;
    });
    window.BrandConsistencyUI?.mountNav(sidebar);
    // Older cached HTML can still contain the retired submenu and article marker.
    const group = sidebar.querySelector('.lk-content-group');
    if (group) {
      const trigger = group.querySelector('[data-content-menu-toggle]');
      const article = group.querySelector('a[href]');
      if (trigger && article) {
        const link = document.createElement('a');
        link.className = 'nav-item';
        link.setAttribute('href', article.getAttribute('href'));
        link.setAttribute('data-content-context-link', '');
        const icon = trigger.querySelector('svg');
        if (icon) link.appendChild(icon.cloneNode(true));
        link.appendChild(document.createTextNode('内容管理'));
        group.replaceWith(link);
      }
    }
    const links = sidebar.querySelectorAll('a[data-content-context-link]');
    if (!links.length) return;
    // Customer navigation drops internal-system links carried by older HTML.
    const internalEntries = ['pub.html', 'admin-hub.html', 'admin.html'];
    sidebar.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      const reference = link.getAttribute('data-collection-reference');
      if (internalEntries.includes(reference?.split(/[?#]/)[0])
        || (href && !href.startsWith('#') && internalEntries.includes(new URL(href, location.href).pathname.split('/').pop()))) link.remove();
    });
    const file = location.pathname.split('/').pop();
    const kind = document.body.dataset.contentClient === 'true' ? document.body.dataset.opsPage : '';
    const inContent = ['articles.html', 'images.html', 'keywords.html', 'videos.html'].includes(file)
      || ['content', 'images', 'keywords', 'videos'].includes(kind);
    const inKnowledge = file === 'knowledge.html' || kind === 'knowledge';
    const contextParams = new URLSearchParams(location.search);
    links.forEach(link => {
      link.classList.toggle('on', inContent);
      if (inContent) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      const target = new URL(link.getAttribute('href'), location.href);
      ['project', 'workspace', 'tenant', 'role'].forEach(key => {
        if (contextParams.has(key)) target.searchParams.set(key, contextParams.get(key));
      });
      link.setAttribute('href', target.pathname.split('/').pop() + target.search);
    });
    sidebar.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || link.hasAttribute('data-collection-reference')) return;
      if (new URL(href, location.href).pathname.split('/').pop() !== 'knowledge.html') return;
      link.classList.toggle('on', inKnowledge);
      if (inKnowledge) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    try { sessionStorage.removeItem('lk-content-menu-open'); } catch (_) {}
  }
  refreshContentNavigation();
  window.addEventListener('pageshow', refreshContentNavigation);
  const brandRow = sidebar.firstElementChild;
  brandRow.classList.add('lk-brand-row');
  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path class="lk-panel-fill" d="M6 7v10" stroke-width="2.5" opacity=".4"/></svg>';

  function makeToggle(slot) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lk-sidebar-toggle ${slot === 'content' ? 'lk-content-toggle' : ''}`;
    button.dataset.sidebarToggle = slot;
    button.setAttribute('aria-controls', sidebar.id);
    button.innerHTML = icon;
    return button;
  }
  brandRow.appendChild(makeToggle('brand'));
  const toolbarStart = toolbar.classList.contains('justify-between') ? toolbar.firstElementChild : toolbar;
  toolbarStart.prepend(makeToggle('content'));
  const backdrop = document.createElement('div');
  backdrop.className = 'lk-menu-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.appendChild(backdrop);

  function notifyResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      window.dispatchEvent(new Event('resize'));
    });
  }
  function render() {
    const visible = desktop.matches ? !collapsed : mobileOpen;
    document.documentElement.style.setProperty('--lk-sidebar-width', `${width}px`);
    document.documentElement.style.setProperty('--lk-sidebar-offset', desktop.matches && visible ? `${width}px` : '0px');
    document.body.classList.toggle('lk-menu-hidden', !visible);
    document.body.classList.toggle('lk-drawer-open', !desktop.matches && visible);
    sidebar.hidden = !visible;
    sidebar.inert = !visible;
    backdrop.hidden = desktop.matches || !visible;
    document.querySelectorAll('[data-sidebar-toggle]').forEach(button => {
      button.setAttribute('aria-expanded', String(visible));
      button.setAttribute('aria-label', visible ? '隐藏左侧菜单' : '展开左侧菜单');
      button.title = visible ? '隐藏左侧菜单' : '展开左侧菜单';
    });
    resizer.setAttribute('aria-valuenow', String(width));
  }
  function focusToggle() {
    const button = [...document.querySelectorAll('[data-sidebar-toggle]')].find(node => node.getClientRects().length);
    button?.focus({preventScroll: true});
  }
  function toggle() {
    if (desktop.matches) {
      collapsed = !collapsed;
      try { sessionStorage.setItem(stateKey, String(collapsed)); } catch (_) {}
    } else mobileOpen = !mobileOpen;
    render();
    focusToggle();
    notifyResize();
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-sidebar-toggle]')) toggle();
    else if (event.target === backdrop && mobileOpen) toggle();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobileOpen) { event.preventDefault(); toggle(); }
    if (event.key === 'Tab' && mobileOpen) {
      const targets = [...sidebar.querySelectorAll('a[href],button,[tabindex="0"]')].filter(node => node.getClientRects().length && !node.disabled);
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  desktop.addEventListener('change', () => { mobileOpen = false; render(); notifyResize(); });

  const resizer = document.createElement('div');
  resizer.className = 'lk-side-resizer';
  resizer.title = '拖动调整菜单宽度';
  resizer.tabIndex = 0;
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-label', '调整左侧菜单宽度');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-valuemin', '180');
  resizer.setAttribute('aria-valuemax', '320');
  sidebar.appendChild(resizer);
  function setWidth(value) {
    width = clamp(value);
    try { localStorage.setItem(widthKey, String(width)); } catch (_) {}
    render();
    notifyResize();
  }
  resizer.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setWidth(event.key === 'Home' ? 180 : event.key === 'End' ? 320 : width + (event.key === 'ArrowLeft' ? -10 : 10));
  });
  resizer.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !desktop.matches) return;
    event.preventDefault();
    const startX = event.clientX, startWidth = width;
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add('side-resizing');
    const move = next => setWidth(startWidth + next.clientX - startX);
    const finish = () => {
      document.body.classList.remove('side-resizing');
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('lostpointercapture', finish);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('lostpointercapture', finish);
  });

  const registered = new WeakSet();
  function attachDocumentWorkspaces() {
    document.querySelectorAll('[data-document-workspace], #knowledgeDetail').forEach(detail => {
      if (registered.has(detail)) return;
      registered.add(detail);
      const attachEditorToggle = () => {
        const start = detail.querySelector('.kb-header-start');
        if (start && !start.querySelector('[data-sidebar-toggle]')) start.prepend(makeToggle('content'));
        render();
      };
      new MutationObserver(attachEditorToggle).observe(detail, {childList: true});
      attachEditorToggle();
    });
  }
  new MutationObserver(attachDocumentWorkspaces).observe(document.body, {childList: true});
  attachDocumentWorkspaces();
  render();
  notifyResize();
})();
