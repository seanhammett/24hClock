/*
 * background.js — MV3 service worker.
 * Clicking the toolbar icon opens the clock in a new tab. When the
 * "show the clock in every new tab" option is enabled, freshly created
 * new-tab pages are redirected to the clock (a runtime-toggleable
 * alternative to the static chrome_url_overrides manifest key).
 */
'use strict';

var OVERRIDE_KEY = 'overrideNewTabs';
var CLOCK_URL = chrome.runtime.getURL('newtab.html');

chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: CLOCK_URL });
});

chrome.tabs.onCreated.addListener(function (tab) {
  var url = tab.pendingUrl || tab.url || '';
  if (url !== 'chrome://newtab/' && url !== 'chrome://new-tab-page/') {
    return;
  }
  chrome.storage.local.get(OVERRIDE_KEY, function (items) {
    if (items[OVERRIDE_KEY] === true) {
      chrome.tabs.update(tab.id, { url: CLOCK_URL });
    }
  });
});
