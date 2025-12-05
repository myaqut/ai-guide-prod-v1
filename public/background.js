// Background service worker for LeanIX AI Recommendations extension

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Set side panel behavior - open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Relay messages from content scripts to side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'activeFieldChanged') {
    // Broadcast to all extension contexts (side panel will receive this)
    chrome.runtime.sendMessage(message).catch(() => {
      // Side panel might not be open, that's ok
    });
  }
  return true;
});

console.log('[LeanIX AI] Background service worker loaded');
