const $ = (id) => document.getElementById(id);
let settings = { ...GSS_DEFAULT_SETTINGS };
let currentHost = null;

const MIN_HINTS = {
  1: "Blocks anything that mentions GTA 6.",
  2: "Lets general news through. Blocks story and gameplay details.",
  3: "Only blocks major/critical spoilers: endings, deaths, twists."
};

function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.sync.set(patch);
  render();
}

function render() {
  $("enabled").checked = settings.enabled;
  $("warnPages").checked = settings.warnPages;
  $("useDefaultKeywords").checked = settings.useDefaultKeywords;
  document.querySelectorAll("input[name=mode]").forEach((r) => (r.checked = r.value === settings.mode));
  document.querySelectorAll("input[name=minLevel]").forEach((r) => (r.checked = Number(r.value) === Number(settings.minLevel)));
  $("minHint").textContent = MIN_HINTS[settings.minLevel] || "";

  const paused = currentHost && settings.disabledSites.includes(currentHost);
  const btn = $("siteToggle");
  btn.disabled = !currentHost;
  btn.textContent = paused ? "Resume on this site" : "Pause on this site";
  btn.classList.toggle("paused", !!paused);
  $("status").textContent = !settings.enabled ? "Off" : paused ? `Paused on ${currentHost}` : "On";
}

function showCounts(c) {
  $("c1").textContent = c[1] || 0;
  $("c2").textContent = c[2] || 0;
  $("c3").textContent = c[3] || 0;
  $("total").textContent = (c[1] || 0) + (c[2] || 0) + (c[3] || 0);
}

async function init() {
  settings = { ...GSS_DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(GSS_DEFAULT_SETTINGS)) };
  for (const n of [1, 2, 3]) $("custom" + n).value = (settings["custom" + n] || []).join("\n");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "gss-get-count" });
      if (res) {
        showCounts(res.counts || {});
        currentHost = res.host;
      }
    } catch (_) {
      $("total").textContent = "–"; // chrome:// pages, Web Store, etc.
    }
  }
  render();
}

$("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
$("warnPages").addEventListener("change", (e) => save({ warnPages: e.target.checked }));
$("useDefaultKeywords").addEventListener("change", (e) => save({ useDefaultKeywords: e.target.checked }));
document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", (e) => save({ mode: e.target.value })));
document.querySelectorAll("input[name=minLevel]").forEach((r) => r.addEventListener("change", (e) => save({ minLevel: Number(e.target.value) })));

$("siteToggle").addEventListener("click", () => {
  if (!currentHost) return;
  const list = new Set(settings.disabledSites);
  list.has(currentHost) ? list.delete(currentHost) : list.add(currentHost);
  save({ disabledSites: [...list] });
});

function parseWords(value) {
  return [...new Set(
    value.split(/[\n,]+/).map((w) => w.trim()).filter((w) => w.length >= 2)
  )].slice(0, 100);
}

function saveCustom() {
  const patch = {};
  for (const n of [1, 2, 3]) patch["custom" + n] = parseWords($("custom" + n).value);
  // Don't re-render the textareas while typing; just store.
  settings = { ...settings, ...patch };
  chrome.storage.sync.set(patch, () => {
    const total = patch.custom1.length + patch.custom2.length + patch.custom3.length;
    $("saved").textContent = chrome.runtime.lastError
      ? "Couldn't save: " + chrome.runtime.lastError.message
      : `Saved (${total} word${total === 1 ? "" : "s"})`;
    $("saved").classList.toggle("ok", !chrome.runtime.lastError);
  });
}

let saveTimer = null;
for (const n of [1, 2, 3]) {
  const box = $("custom" + n);
  box.addEventListener("input", () => {
    $("saved").textContent = "Saving...";
    $("saved").classList.remove("ok");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCustom, 300);
  });
  // Save right away when leaving the box or closing the popup.
  box.addEventListener("blur", () => { clearTimeout(saveTimer); saveCustom(); });
}
window.addEventListener("pagehide", () => { clearTimeout(saveTimer); saveCustom(); });

init();
