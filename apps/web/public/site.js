(() => {
  'use strict';
  const legacy = document.getElementById('legacy-routes');
  if (legacy && location.hash) {
    const target = JSON.parse(legacy.textContent)[location.hash];
    if (target) {
      const destination = new URL(target, location.origin);
      new URLSearchParams(location.search).forEach((value, key) => { if (!destination.searchParams.has(key)) destination.searchParams.append(key, value); });
      location.replace(destination.pathname + destination.search + destination.hash);
      return;
    }
  }
  const imageDialog = document.querySelector('.interface-dialog');
  if (imageDialog) {
    const image = imageDialog.querySelector('.interface-dialog-image');
    const title = imageDialog.querySelector('h2');
    let opener;
    document.querySelectorAll('[data-interface-src]').forEach(button => button.addEventListener('click', () => {
      opener = button;
      image.src = button.dataset.interfaceSrc;
      image.alt = button.querySelector('img').alt;
      title.textContent = button.dataset.interfaceTitle;
      imageDialog.showModal();
    }));
    imageDialog.querySelector('.interface-dialog-close').addEventListener('click', () => imageDialog.close());
    imageDialog.addEventListener('close', () => opener?.focus());
    imageDialog.addEventListener('click', event => {
      const bounds = imageDialog.getBoundingClientRect();
      if (event.target === imageDialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) imageDialog.close();
    });
  }
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.site-nav');
  if (toggle && nav) {
    const close = () => {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', '打开导航');
      nav.classList.remove('is-open');
      toggle.querySelector('img').src = '/marketing/menu.svg';
    };
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
      nav.classList.toggle('is-open', open);
      toggle.querySelector('img').src = open ? '/marketing/close.svg' : '/marketing/menu.svg';
    });
    nav.addEventListener('click', event => { if (event.target.closest('a')) close(); });
    document.addEventListener('pointerdown', event => { if (!nav.contains(event.target) && !toggle.contains(event.target)) close(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) { close(); toggle.focus(); }
    });
    window.matchMedia('(min-width:1001px)').addEventListener('change', event => { if (event.matches) close(); });
  }
  document.querySelectorAll('[data-section-tabs]').forEach(section => {
    const tabs = Array.from(section.querySelectorAll(':scope > [role=tablist] > [role=tab]'));
    const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
    const select = (tab, focus = false, updateUrl = false) => {
      tabs.forEach((item, index) => {
        const active = item === tab;
        item.setAttribute('aria-selected', String(active));
        item.tabIndex = active ? 0 : -1;
        panels[index].hidden = !active;
      });
      if (focus) tab.focus();
      if (updateUrl) {
        const url = new URL(location.href);
        url.hash = tab.getAttribute('aria-controls');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    };
    const restore = () => {
      const target = document.getElementById(location.hash.slice(1));
      let index = panels.findIndex(panel => panel === target || panel.contains(target));
      if (index < 0 && !location.hash && section.dataset.sectionTabs === 'solutions') {
        const first = {trade:'replenishment',customers:'customer-operations',production:'bom-review'}[new URLSearchParams(location.search).get('group')];
        index = panels.findIndex(panel => panel.id === first);
      }
      if (index < 0) return;
      select(tabs[index]);
      if (target) {
        requestAnimationFrame(() => (target === panels[index] ? section : target).scrollIntoView({block:'start'}));
      }
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(tab, false, true));
      tab.addEventListener('keydown', event => {
        let next = index;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        select(tabs[next], true, true);
      });
    });
    window.addEventListener('hashchange', restore);
    restore();
  });
})();
