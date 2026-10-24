(function () {
  if (document.documentElement.dataset.page !== 'marketing') return;
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.site-nav');
  if (!toggle || !nav) return;
  function close(returnFocus) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '打开导航');
    nav.classList.remove('is-open');
    if (returnFocus) toggle.focus();
  }
  toggle.addEventListener('click', function () {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
    nav.classList.toggle('is-open', open);
  });
  nav.addEventListener('click', function (event) { if (event.target.closest('a')) close(false); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') close(true); });
  document.addEventListener('click', function (event) { if (!event.target.closest('.site-header')) close(false); });
  window.matchMedia('(min-width: 841px)').addEventListener('change', function (event) { if (event.matches) close(false); });
})();
