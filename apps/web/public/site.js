(function () {
  if (document.documentElement.dataset.page !== 'marketing') return;

  var toggle = document.querySelector('.menu-toggle');
  var nav = document.querySelector('.site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
      nav.classList.toggle('is-open', open);
    });
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', '打开导航');
        nav.classList.remove('is-open');
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', '打开导航');
        nav.classList.remove('is-open');
      }
    });
  }

  var tabs = Array.from(document.querySelectorAll('[data-story]'));
  var panels = Array.from(document.querySelectorAll('[data-panel]'));
  function selectStory(key, focus) {
    tabs.forEach(function (tab) {
      var active = tab.dataset.story === key;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    panels.forEach(function (panel) { panel.hidden = panel.dataset.panel !== key; });
  }
  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { selectStory(tab.dataset.story, false); });
    tab.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      var next = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectStory(tabs[next].dataset.story, true);
    });
  });
  document.querySelectorAll('[data-year]').forEach(function (element) {
    element.textContent = String(new Date().getFullYear());
  });
})();
