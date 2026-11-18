// Toolbar badge: number of shielded items on the page, colored by the worst level found.
const BADGE_COLORS = { 1: "#F2C230", 2: "#F08A24", 3: "#D7263D" };

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "gss-count" || !msg.top || !sender.tab?.id) return;
  const c = msg.counts || {};
  const total = (c[1] || 0) + (c[2] || 0) + (c[3] || 0);
  const worst = c[3] ? 3 : c[2] ? 2 : 1;
  const tabId = sender.tab.id;
  chrome.action.setBadgeText({ tabId, text: total ? (total > 99 ? "99+" : String(total)) : "" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLORS[worst] });
  if (chrome.action.setBadgeTextColor) {
    chrome.action.setBadgeTextColor({ tabId, color: worst === 3 ? "#FFFFFF" : "#111111" });
  }
});
