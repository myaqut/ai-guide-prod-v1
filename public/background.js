// Background service worker for LeanIX AI Recommendations extension

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Set side panel behavior - open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

console.log('[LeanIX AI] Background service worker loaded');
