/* ============================================================
   Shared i18n loader for hub / sub-hub / converter pages.
   The editor has its own richer inline copy of this logic
   (because it needs t() inside dynamic render code paths).

   Usage in a page:
     <script>
       window.I18N_BASE_PATH = '../i18n/';   // relative path to /i18n/ from THIS page
       window.I18N_META_TITLE_KEY = 'meta_title_p69';  // optional
     </script>
     <script src="../i18n/i18n.js"></script>

   Mark up text with data-i18n / data-i18n-html / data-i18n-title.
   The script auto-bootstraps on DOMContentLoaded: loads en.json as
   fallback, then the user's saved or default locale, then walks the
   DOM applying translations + wires the .lang-switcher buttons.

   Window exports:
     SVI18n.t(key, params)         translate, with {param} substitution
     SVI18n.switchLanguage(lang)   change locale at runtime (re-applies)
     SVI18n.applyI18nToDOM()       re-apply (call after dynamic DOM mutations)
   ============================================================ */
(function () {
  'use strict';

  const I18N_KEY_LANG = 'p69-lang';
  const I18N_DEFAULT = 'en';
  const I18N_SUPPORTED = ['en', 'ja', 'ko', 'zh-Hant'];
  const BASE_PATH = (typeof window !== 'undefined' && window.I18N_BASE_PATH) || '../i18n/';

  let i18nCurrent = I18N_DEFAULT;
  let i18nDict = { ui: {} };
  let i18nFallback = null;

  async function i18nLoad(lang) {
    try {
      const res = await fetch(BASE_PATH + lang + '.json');
      if (!res.ok) throw new Error('lang fetch failed: ' + res.status);
      i18nDict = await res.json();
      i18nCurrent = lang;
      document.documentElement.lang = lang;
      applyLangClass();
      try { localStorage.setItem(I18N_KEY_LANG, lang); } catch (e) {}
      return true;
    } catch (e) {
      console.warn('Failed to load language ' + lang + ':', e);
      return false;
    }
  }

  async function i18nInitFallback() {
    if (i18nFallback) return;
    try {
      const res = await fetch(BASE_PATH + 'en.json');
      if (res.ok) i18nFallback = await res.json();
    } catch (e) { /* fallback unavailable */ }
  }

  function t(key, params) {
    const ui = (i18nDict && i18nDict.ui) || {};
    let str = ui[key];
    if (str === undefined && i18nFallback) {
      str = ((i18nFallback.ui) || {})[key];
    }
    if (str === undefined) str = key;
    if (params) {
      for (const k of Object.keys(params)) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
      }
    }
    return str;
  }

  function applyI18nToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
    const metaKey = window.I18N_META_TITLE_KEY;
    if (metaKey && i18nDict.ui && i18nDict.ui[metaKey]) {
      document.title = i18nDict.ui[metaKey];
    }
  }

  function applyLangClass() {
    const isCjk = i18nCurrent === 'zh-Hant' || i18nCurrent === 'ja' || i18nCurrent === 'ko';
    document.documentElement.classList.toggle('cjk', isCjk);
  }

  async function switchLanguage(lang) {
    if (lang === i18nCurrent) return;
    await i18nLoad(lang);
    applyI18nToDOM();
    updateLangSwitcher();
    if (typeof window.onI18nChanged === 'function') {
      try { window.onI18nChanged(lang); } catch (e) {}
    }
  }

  function updateLangSwitcher() {
    document.querySelectorAll('.lang-switcher button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === i18nCurrent);
    });
  }

  function setupLangSwitcher() {
    document.querySelectorAll('.lang-switcher button').forEach(btn => {
      btn.addEventListener('click', () => switchLanguage(btn.dataset.lang));
    });
    updateLangSwitcher();
  }

  async function bootstrap() {
    await i18nInitFallback();
    let savedLang = I18N_DEFAULT;
    try { savedLang = localStorage.getItem(I18N_KEY_LANG) || I18N_DEFAULT; } catch (e) {}
    if (I18N_SUPPORTED.indexOf(savedLang) < 0) savedLang = I18N_DEFAULT;
    if (savedLang !== I18N_DEFAULT) {
      await i18nLoad(savedLang);
    } else if (i18nFallback) {
      i18nDict = i18nFallback;
      i18nCurrent = 'en';
      document.documentElement.lang = 'en';
      applyLangClass();
    }
    applyI18nToDOM();
    setupLangSwitcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  window.SVI18n = { t, switchLanguage, i18nLoad, applyI18nToDOM };
})();
