import { onRulesChanged } from '../shared/storage.js';

chrome.runtime.onInstalled.addListener(() => {
  console.debug('[hide-em] Extension installed/updated');
});

// Subscribe to rule changes so the event listener is registered in the service worker.
// Content script broadcasting is wired up in M2 when content scripts exist.
onRulesChanged((_rules) => {
  // M2: broadcast to all content-script tabs via chrome.tabs.sendMessage
});
