/*
 * theme.js — light/dark selection. 'system' (the default) leaves the page to
 * follow Chrome via `color-scheme: light dark`; 'light'/'dark' pin it with a
 * data-theme attribute on <html>.
 *
 * Loaded from <head>, ahead of the face and the sidebar, because this is a new
 * tab page: an override read back asynchronously would repaint the whole page
 * in the wrong theme first, on every single tab. chrome.storage.local stays the
 * source of truth — it is where the rest of the options live — so the choice is
 * mirrored into localStorage purely as a synchronous fast path for this first
 * paint, under a key of its own so it cannot be confused with the stored
 * setting. sidebar.js reconciles the two once storage answers.
 */
(function () {
  'use strict';

  var CACHE_KEY = 'themeFastPath';
  var MODES = ['system', 'light', 'dark'];

  /** Any stored shape to a known mode, defaulting to following the browser. */
  function normalize(value) {
    return MODES.indexOf(value) === -1 ? 'system' : value;
  }

  function apply(mode) {
    if (mode === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', mode);
    }
  }

  function readCache() {
    try {
      return normalize(localStorage.getItem(CACHE_KEY));
    } catch (e) {
      return 'system'; // storage unavailable: the browser's own setting applies
    }
  }

  var cached = readCache();
  apply(cached);

  window.Theme = {
    /**
     * Paint the mode, keep the first-paint fast path in step with it, and
     * hand back the mode actually applied so callers can store that.
     */
    set: function (mode) {
      var normalized = normalize(mode);
      apply(normalized);
      // Skipping the no-op write keeps a synchronous disk touch off the path
      // every new tab takes, since the reconcile from storage usually agrees.
      if (normalized !== cached) {
        cached = normalized;
        try {
          localStorage.setItem(CACHE_KEY, normalized);
        } catch (e) { /* the canonical copy in chrome.storage is enough */ }
      }
      return normalized;
    }
  };
})();
