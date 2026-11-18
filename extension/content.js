/* Spoiler Shield: GTA 6 — content script
 * Finds GTA 6 mentions, rates them yellow / orange / red, and blurs (or hides)
 * the surrounding post, video or comment with a click-to-show label.
 */
(() => {
  "use strict";

  const IS_TOP = window.top === window;

  // Post / video / comment containers per platform, so a whole card is covered.
  const CONTAINER_SELECTORS = [
    // YouTube (incl. Shorts, live chat, notifications)
    "ytd-rich-item-renderer", "ytd-video-renderer", "ytd-compact-video-renderer",
    "ytd-grid-video-renderer", "ytd-playlist-renderer", "ytd-reel-item-renderer",
    "ytd-reel-video-renderer", "ytd-comment-view-model", "ytd-comment-thread-renderer",
    "yt-lockup-view-model", "ytm-shorts-lockup-view-model", "ytd-notification-renderer",
    "yt-live-chat-text-message-renderer", "ytd-post-renderer", "ytd-backstage-post-thread-renderer",
    // Reddit
    "shreddit-post", "shreddit-comment", "faceplate-tracker[source='search']",
    // X / Twitter
    "article[data-testid='tweet']", "[data-testid='trend']", "[data-testid='UserCell']",
    // TikTok
    "[data-e2e='recommend-list-item-container']", "[data-e2e='search_top-item']",
    "[data-e2e='search-card-desc']", "[data-e2e='comment-level-1']", "[data-e2e='comment-level-2']",
    // Instagram
    "article", "ul._a9ym > div", "div._a9zr",
    // Facebook
    "div[aria-posinset]", "div[role='article']", "[data-pagelet^='FeedUnit']",
    // Threads
    "div[data-pressable-container='true']",
    // Bluesky
    "[data-testid^='feedItem-']", "[data-testid^='postThreadItem-']",
    // Tumblr
    "div[data-id] article", "div[data-cell-id]",
    // LinkedIn
    "div.feed-shared-update-v2", "article.comments-comment-entity",
    // Pinterest
    "[data-test-id='pin']", "[data-grid-item='true']",
    // Mastodon
    "div.status", "article.status",
    // Twitch & Kick chat and cards
    "[data-a-target='chat-line-message']", ".chat-line__message", "[data-chat-entry]",
    "[data-a-target='preview-card-image-link']",
    // Discord
    "li[id^='chat-messages']",
    // Telegram Web / WhatsApp Web
    "div.message", ".Message", "div[role='row']",
    // Steam community
    ".apphub_Card",
    // Google Search / News
    "div.MjjYud", "div.g", "g-inner-card",
    // Generic
    "[role='article']", "li"
  ].join(",");

  const FALLBACK_BLOCK = "p,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,dd,dt,a,span,div";
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "TITLE", "SVG", "CODE", "PRE"]);

  let settings = { ...GSS_DEFAULT_SETTINGS };
  let re = {}; // trigger, orange, red, custom1..3, safe
  let active = false;
  let observer = null;
  const pending = new Set();
  let flushTimer = null;
  const revealed = new WeakSet();
  const shielded = new Map(); // element -> level

  // ---------- matching ----------

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildRegex(words) {
    const parts = (words || [])
      .map((w) => String(w).trim())
      .filter(Boolean)
      .map((w) => escapeRe(w).replace(/\s+/g, "[\\s\\-_.]*") + "(?:'?s|es)?");
    if (!parts.length) return null;
    return new RegExp("(?:^|[^\\p{L}\\p{N}])(?:" + parts.join("|") + ")(?![\\p{L}\\p{N}])", "iu");
  }

  function compile() {
    const builtIn = settings.useDefaultKeywords;
    re = {
      yellow: builtIn ? buildRegex(GSS_WORDS_YELLOW) : null,
      orange: builtIn ? buildRegex(GSS_WORDS_ORANGE) : null,
      red: builtIn ? buildRegex(GSS_WORDS_RED) : null,
      c1: buildRegex(settings.custom1),
      c2: buildRegex(settings.custom2),
      c3: buildRegex(settings.custom3),
      safe: new RegExp(GSS_SAFE_PHRASES.map(escapeRe).join("|"), "giu")
    };
  }

  const test = (r, t) => !!(r && t && r.test(t));

  // Is there anything here that should start a check at all?
  function isTrigger(text) {
    return test(re.yellow, text) || test(re.c1, text) || test(re.c2, text) || test(re.c3, text);
  }

  // Your own words always shield, even below the "Block from" level.
  function customHit(text) {
    return test(re.c1, text) || test(re.c2, text) || test(re.c3, text);
  }

  // 0 = clean, 1 = yellow, 2 = orange, 3 = red
  function levelOf(text) {
    if (!text) return 0;
    let level = 0;
    if (test(re.c3, text)) return 3;
    if (test(re.c2, text)) level = 2;
    else if (test(re.c1, text)) level = 1;
    if (test(re.yellow, text)) {
      const cleaned = text.replace(re.safe, " ");
      if (test(re.red, cleaned)) return 3;
      if (test(re.orange, cleaned)) level = Math.max(level, 2);
      level = Math.max(level, 1);
    }
    return level;
  }

  function siteDisabled() {
    const host = location.hostname.replace(/^www\./, "");
    return (settings.disabledSites || []).some((s) => host === s || host.endsWith("." + s));
  }

  const isEditable = (el) => !!el.closest("textarea,input,[contenteditable=''],[contenteditable='true']");
  const isOurs = (el) => !!el.closest(".gss-overlay,#gss-interstitial");

  function tooBig(el) {
    if (el === document.body || el === document.documentElement) return true;
    const r = el.getBoundingClientRect();
    return r.height > window.innerHeight * 0.9 && r.width > window.innerWidth * 0.8;
  }

  function findContainer(el) {
    const card = el.closest(CONTAINER_SELECTORS);
    if (card && !tooBig(card)) return card;
    let block = el.closest(FALLBACK_BLOCK) || el;
    while (block.parentElement && block.parentElement !== document.body) {
      const d = getComputedStyle(block).display;
      if (d !== "inline" && d !== "contents") break;
      block = block.parentElement;
    }
    return tooBig(block) ? null : block;
  }

  // ---------- shield / reveal ----------
  // State lives in data-gss / data-gss-level attributes, not classes: sites
  // like X (React) rewrite className on hover and re-render, which used to
  // wipe the blur. A watchdog also re-applies anything a site strips off.

  const SHIELDED_SEL = "[data-gss]";

  function shield(container, level, force) {
    if (!container || !level || revealed.has(container)) return;
    if (level < settings.minLevel && !force) return;

    const existing = shielded.get(container);
    if (existing !== undefined) {
      if (level > existing) shielded.set(container, level);
      applyShield(container);
      return;
    }
    // Already covered by a shielded parent: raise the parent's level if needed.
    const parent = container.parentElement?.closest(SHIELDED_SEL);
    if (parent && shielded.has(parent)) {
      if (level > shielded.get(parent)) {
        shielded.set(parent, level);
        applyShield(parent);
      }
      return;
    }
    // A newly shielded parent replaces shielded children (keep the highest level).
    container.querySelectorAll(SHIELDED_SEL).forEach((child) => {
      level = Math.max(level, shielded.get(child) || 0);
      unshield(child);
    });

    shielded.set(container, level);
    applyShield(container);
  }

  // Idempotent: (re)applies attributes, overlay and label for a shielded element.
  function applyShield(container) {
    const level = shielded.get(container);
    if (!level || revealed.has(container) || !container.isConnected) return;
    const info = GSS_LEVELS[level];
    const state = settings.mode === "hide" ? "hide" : "blur";
    if (container.getAttribute("data-gss") !== state) container.setAttribute("data-gss", state);
    if (container.getAttribute("data-gss-level") !== info.key) container.setAttribute("data-gss-level", info.key);

    let overlay = container.querySelector(":scope > .gss-overlay");
    if (state === "hide") {
      overlay?.remove();
    } else {
      if (!overlay) overlay = makeOverlay(container);
      else if (overlay !== container.lastElementChild) container.appendChild(overlay); // keep on top
      const label = overlay.querySelector("strong");
      if (label.textContent !== info.label) label.textContent = info.label;
      overlay.setAttribute("aria-label", info.label + " for GTA 6. Click to show.");
    }
    reportCountSoon();
  }

  function makeOverlay(container) {
    const overlay = document.createElement("div");
    overlay.className = "gss-overlay";
    overlay.setAttribute("role", "button");
    overlay.setAttribute("tabindex", "0");
    const tag = document.createElement("span");
    tag.className = "gss-tag";
    const label = document.createElement("strong");
    const hint = document.createElement("span");
    hint.className = "gss-hint";
    hint.textContent = "Click to show";
    tag.append(label, hint);
    overlay.appendChild(tag);

    const reveal = (e) => {
      e.preventDefault();
      e.stopPropagation();
      revealed.add(container);
      unshield(container);
    };
    // Stop the site from treating clicks/hovers on the overlay as opening the post.
    for (const type of ["click", "mousedown", "mouseup", "pointerdown", "pointerup"]) {
      overlay.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === "click") reveal(e);
        else e.preventDefault();
      }, true);
    }
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") reveal(e);
    });
    container.appendChild(overlay);
    return overlay;
  }

  function unshield(el) {
    shielded.delete(el);
    el.removeAttribute("data-gss");
    el.removeAttribute("data-gss-level");
    el.querySelectorAll(":scope > .gss-overlay").forEach((o) => o.remove());
    reportCountSoon();
  }

  function unshieldAll() {
    [...shielded.keys()].forEach(unshield);
    document.querySelectorAll(SHIELDED_SEL).forEach(unshield);
    reportCount();
  }

  // Watchdog: re-apply shields a site removed, drop elements that left the page.
  function sweep() {
    if (!active) return;
    for (const el of [...shielded.keys()]) {
      if (!el.isConnected) shielded.delete(el);
      else applyShield(el);
    }
  }

  let countTimer = null;
  function reportCountSoon() {
    if (!countTimer) countTimer = setTimeout(() => { countTimer = null; reportCount(); }, 150);
  }

  // ---------- scanning ----------

  function scan(root) {
    if (!active || !root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement) checkFrom(root.parentElement, root.nodeValue);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(root.tagName) || isOurs(root)) return;

    // 1) Whole cards, using all of their text (catches "GTA <b>6</b>" and
    //    a title with GTA 6 plus a description with "ending").
    const cards = root.matches?.(CONTAINER_SELECTORS) ? [root] : [];
    root.querySelectorAll?.(CONTAINER_SELECTORS).forEach((c) => cards.push(c));
    for (const card of cards) {
      if (revealed.has(card) || isOurs(card)) continue;
      const text = card.textContent;
      if (card.tagName === "LI" && text.length > 2000) continue;
      if (!isTrigger(text) || tooBig(card)) continue;
      const inner = [...card.querySelectorAll(CONTAINER_SELECTORS)].reverse().find((c) => isTrigger(c.textContent));
      const target = inner && !tooBig(inner) ? inner : card;
      shield(target, levelOf(target.textContent), customHit(target.textContent));
    }

    // 2) Text anywhere else.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        return node.nodeValue && node.nodeValue.length > 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    let n;
    while ((n = walker.nextNode())) checkFrom(n.parentElement, n.nodeValue);

    // 3) Thumbnails and links: alt / title / aria-label.
    root.querySelectorAll?.("img[alt],a[title],[aria-label]").forEach((el) => {
      if (isOurs(el)) return;
      const t = el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("aria-label");
      if (isTrigger(t)) checkFrom(el, t);
    });
  }

  function checkFrom(el, text) {
    if (!el || isEditable(el) || isOurs(el)) return;
    const card = el.closest(CONTAINER_SELECTORS);

    // New text inside an already-shielded card (or a card with a trigger) may raise its level.
    if (!isTrigger(text)) {
      if (card && shielded.has(card)) shield(card, levelOf(card.textContent), customHit(card.textContent));
      return;
    }
    const c = findContainer(el);
    if (!c) return;
    const all = text + " " + c.textContent;
    shield(c, Math.max(levelOf(text), levelOf(all)), customHit(all));
  }

  function queue(node) {
    pending.add(node);
    if (!flushTimer) flushTimer = setTimeout(flush, 60);
  }

  function flush() {
    flushTimer = null;
    const nodes = [...pending];
    pending.clear();
    nodes.forEach((node) => node.isConnected && scan(node));
    checkPageTitle();
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      let damaged = false;
      for (const m of mutations) {
        if (m.type === "characterData") queue(m.target);
        else if (m.type === "attributes") {
          if (shielded.has(m.target) && !m.target.hasAttribute(m.attributeName)) damaged = true;
        } else {
          m.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE && node.classList?.contains("gss-overlay")) return;
            queue(node);
          });
          m.removedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE && node.classList?.contains("gss-overlay")) damaged = true;
          });
        }
      }
      if (damaged) sweep();
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["data-gss", "data-gss-level"]
    });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
    pending.clear();
  }

  setInterval(sweep, 400);

  // ---------- full-page warning ----------

  let dismissedFor = null;

  function isSearchPage() {
    const p = new URLSearchParams(location.search);
    return p.has("q") || p.has("search_query") || p.has("query") || /\/search/.test(location.pathname);
  }

  function checkPageTitle() {
    if (!IS_TOP) return;
    if (!active || !settings.warnPages || isSearchPage()) return removeInterstitial();
    if (dismissedFor === location.href) return;
    const level = levelOf(document.title || "");
    if (level > 0 && (level >= settings.minLevel || customHit(document.title))) showInterstitial(level);
    else removeInterstitial();
  }

  function showInterstitial(level) {
    if (!document.body) return;
    const info = GSS_LEVELS[level];
    let wrap = document.getElementById("gss-interstitial");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "gss-interstitial";
      wrap.innerHTML = `
        <div class="gss-card">
          <div class="gss-level"></div>
          <h1></h1>
          <p>This page looks like it's about GTA 6.</p>
          <div class="gss-actions">
            <button type="button" class="gss-back">Go back</button>
            <button type="button" class="gss-show">Show page</button>
          </div>
        </div>`;
      wrap.querySelector(".gss-back").addEventListener("click", () => {
        if (history.length > 1) history.back();
        else location.href = "about:blank";
      });
      wrap.querySelector(".gss-show").addEventListener("click", () => {
        dismissedFor = location.href;
        removeInterstitial();
      });
      document.body.appendChild(wrap);
      document.querySelectorAll("video").forEach((v) => {
        try { v.pause(); } catch (_) { /* ignore */ }
      });
    }
    wrap.dataset.gssLevel = info.key;
    wrap.querySelector(".gss-level").textContent = info.label;
    wrap.querySelector("h1").textContent =
      level === 3 ? "Major/critical spoilers ahead" : level === 2 ? "Story spoilers ahead" : "Possible spoilers ahead";
  }

  function removeInterstitial() {
    document.getElementById("gss-interstitial")?.remove();
  }

  // ---------- badge ----------

  function counts() {
    const c = { 1: 0, 2: 0, 3: 0 };
    for (const [el, lvl] of shielded) if (el.isConnected) c[lvl]++;
    return c;
  }

  function reportCount() {
    try {
      chrome.runtime.sendMessage({ type: "gss-count", counts: counts(), top: IS_TOP });
    } catch (_) {
      /* extension was reloaded */
    }
  }

  // ---------- lifecycle ----------

  function apply() {
    compile();
    unshieldAll();
    removeInterstitial();
    const hasWords = re.yellow || re.c1 || re.c2 || re.c3;
    active = settings.enabled && !siteDisabled() && !!hasWords;
    if (active) {
      startObserver();
      if (document.body) scan(document.body);
      checkPageTitle();
    } else {
      stopObserver();
    }
  }

  chrome.storage.sync.get(GSS_DEFAULT_SETTINGS, (stored) => {
    settings = { ...GSS_DEFAULT_SETTINGS, ...stored };
    apply();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => active && scan(document.body), { once: true });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
    apply();
  });

  if (IS_TOP) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "gss-get-count") {
        sendResponse({ counts: counts(), host: location.hostname.replace(/^www\./, "") });
      }
    });

    // SPA navigation (YouTube, Reddit, X, Instagram...) without a page reload.
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        dismissedFor = null;
        checkPageTitle();
      }
    }, 500);
  }
})();
