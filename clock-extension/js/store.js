/*
 * store.js — the one persistence seam for the page: chrome.storage.local in
 * the extension, localStorage when the same folder is served as a website or
 * opened as a plain file. Both present the same get(keys, cb) / set(obj)
 * shape, so nothing above here has to know which build it is running in.
 */
(function () {
  'use strict';

  var backend = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
    ? {
        get: function (keys, cb) { chrome.storage.local.get(keys, cb); },
        set: function (obj) { chrome.storage.local.set(obj); }
      }
    : {
        get: function (keys, cb) {
          var out = {};
          keys.forEach(function (k) {
            var raw = localStorage.getItem(k);
            if (raw !== null) out[k] = JSON.parse(raw);
          });
          cb(out);
        },
        set: function (obj) {
          Object.keys(obj).forEach(function (k) {
            localStorage.setItem(k, JSON.stringify(obj[k]));
          });
        }
      };

  window.Store = {
    get: backend.get,
    set: backend.set,
    /** One-key write: Store.set(Store.entry('theme', 'dark')). */
    entry: function (key, value) {
      var obj = {};
      obj[key] = value;
      return obj;
    }
  };
})();
