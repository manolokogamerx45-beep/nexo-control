// Nexo: modo claro / oscuro.
// Se carga sin "defer" en <head> para aplicar el tema antes de pintar la página (sin parpadeo).
// Sin preferencia guardada, sigue al sistema operativo y cambia con él.
'use strict';
(() => {
  const KEY = 'nexo.theme';
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const saved = () => { try { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch { return null; } };
  const system = () => (media && media.matches ? 'dark' : 'light');
  const current = () => root.dataset.theme || saved() || system();

  const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z"/></svg>';
  let button = null;

  function apply(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1310' : '#192923');
    if (button) {
      const next = theme === 'dark' ? 'claro' : 'oscuro';
      button.innerHTML = theme === 'dark' ? SUN : MOON;
      button.setAttribute('aria-label', `Cambiar a modo ${next}`);
      button.title = `Modo ${next}`;
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  }

  apply(current());

  // Sin elección manual, acompaña al sistema.
  if (media) {
    const follow = () => { if (!saved()) apply(system()); };
    if (media.addEventListener) media.addEventListener('change', follow); else if (media.addListener) media.addListener(follow);
  }

  // Si otra pestaña cambia el tema, esta lo sigue.
  window.addEventListener('storage', event => { if (event.key === KEY) apply(saved() || system()); });

  // auth.js reescribe la barra superior; el botón se reubica cada vez que eso pasa.
  function place() {
    if (!button) return;
    const shell = document.querySelector('.shell');
    const slot = shell && !shell.hidden ? shell.querySelector('.top-right') : null;
    if (slot) {
      if (button.parentElement !== slot) { button.classList.remove('floating'); slot.prepend(button); }
    } else if (button.parentElement !== document.body) {
      button.classList.add('floating');
      document.body.append(button);
    }
  }

  function init() {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle floating';
    button.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch {}
      apply(next);
    });
    apply(current());
    place();
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
