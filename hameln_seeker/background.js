// Chrome Extension Background Service Worker
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: chrome.runtime.getURL("hameln_seeker.html") });
});
