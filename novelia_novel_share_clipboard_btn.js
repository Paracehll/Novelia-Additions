// ==UserScript==
// @name         Novelia 小說鏈結分享按鈕（整合版）
// @namespace    http://tampermonkey.net/
// @version      1.5.2
// @description  在小說列表的標題前或文庫標題前添加「複製」按鈕，格式為「[中文標題](完整連結)」。支援快捷鍵與按鈕雙模式。自動偵測 SPA 換頁，重新注入。
// @match        *://n.novelia.cc/*
// @grant        GM_setClipboard
// ==/UserScript==

!(function () {
  "use strict";

  // ── 設定區 ──────────────────────────────────────────────────────────────
  const CLEAR_KEY = { ctrl: true, alt: false, shift: false, key: "q" }; // 預設 Ctrl+Q
  const VIEW_KEY = { ctrl: true, alt: false, shift: false, key: "v" }; // 預設 Ctrl+V
  const REFRESH_KEY = { ctrl: false, alt: false, shift: true, key: "r" }; // 預設 Shift+R
  const BTN_WIDTH = "36px";
  const ALIGN_TYPE = "center"; // flex-start  center
  const SHOW_HEADER_BTNS = true; // true=永遠顯示；false=永遠隱藏；"auto"=行動裝置才顯示
  // ───────────────────────────────────────────────────────────────────────

  const CACHE_EVENT = "novelia-cache-change",
    BTN_CLASS = "novelia-copy-btn",
    TOAST_CLASS = "novelia-toast",
    HDR_BTN_CLASS = "novelia-header-btn",
    HDR_MARK = "noveliaHeaderInjected",
    ITEM_WRAPPER_CLASS = "novelia-item-wrapper",
    ITEM_SELECTOR = 'div.n-flex[role="none"]';
  let cache = [],
    toastTimer;
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    .${BTN_CLASS}{position:relative;overflow:hidden;margin-right:6px;padding:1px 0;width:${BTN_WIDTH};font-size:12px;cursor:pointer;background:transparent;border:1px solid #aaa;border-radius:4px;vertical-align:middle;opacity:.6;text-align:center;flex-shrink:0;line-height:1.4;transition:opacity .15s,background .15s,border-color .15s}
    .${BTN_CLASS}:hover { opacity: 1; background: #eee; }
    .${BTN_CLASS}.flashing::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 10px;
      height: 10px;
      background: rgba(40, 167, 69, .4);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      animation: novelia-ripple .4s ease-out;
    }
    @keyframes novelia-ripple {
      0% { width: 0; height: 0; opacity: 1; }
      100% { width: 120px; height: 120px; opacity: 0; }
    }
    .${TOAST_CLASS} {
      position: fixed;
      top: -50px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(51, 51, 51, .95);
      color: #fff;
      padding: 14px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 99999;
      opacity: 0;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0, 0, 0, .25);
      transition: top .3s, opacity .3s;
      white-space: pre-wrap;
      max-width: 90vw;
      font-family: monospace;
      line-height: 1.5;
    }
    .${TOAST_CLASS}.show { top: 30px; opacity: 1; }
    .${HDR_BTN_CLASS} {
      margin-left: 10px;
      padding: 0 10px;
      height: 28px;
      font-size: 13px;
      cursor: pointer;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 6px;
      transition: background .2s;
      color: #333;
      font-weight: normal;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      vertical-align: middle;
    }
    .${HDR_BTN_CLASS}:hover { background: #f0f0f0; }
    .novelia-grid-wrapper { display: inline-flex; align-items: flex-start; width: 100%; }
    .${ITEM_WRAPPER_CLASS} { display: flex; flex-flow: row; align-items: ${ALIGN_TYPE}; }
  `;
  document.head.appendChild(styleEl);
  const toastEl = document.createElement("div");
  toastEl.className = TOAST_CLASS;
  document.body.appendChild(toastEl);
  function showToast(e, t = 2200) {
    clearTimeout(toastTimer);
    toastEl.textContent = e;
    toastEl.classList.add("show");
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), t);
  }
  function writeClipboard(e, t) {
    "function" == typeof GM_setClipboard
      ? (GM_setClipboard(e), t && animateSuccess(t))
      : navigator.clipboard
          .writeText(e)
          .then(() => {
            t && animateSuccess(t);
          })
          .catch((e) => {
            console.error("[Novelia]", e);
            t &&
              ((t.textContent = "❌"),
              setTimeout(() => {
                t.textContent = "📋";
              }, 1550));
          });
  }
  function animateSuccess(e) {
    e.textContent = "✅";
    e.style.opacity = "1";
    setTimeout(() => {
      e.textContent = "📋";
      e.style.opacity = "";
      e.classList.remove("flashing");
    }, 1500);
  }
  function dispatchCacheChange() {
    document.dispatchEvent(
      new CustomEvent(CACHE_EVENT, { detail: { cache: [...cache] } }),
    );
  }
  function clearCache() {
    cache = [];
    writeClipboard("", null);
    dispatchCacheChange();
    showToast("🧹 快取與剪貼簿已清空！");
  }
  function viewCache() {
    0 === cache.length
      ? showToast("ℹ️ 當前快取中沒有任何連結。")
      : showToast(
          `📂 當前快取連結 (共 ${cache.length} 條)：\n${cache.join("\n")}`,
          3500,
        );
  }
  function triggerRefresh() {
    (removeStaleButtons(),
      requestAnimationFrame(() => requestAnimationFrame(fullScan)),
      showToast("🔄 已重新偵測當前頁面並重新注入按鈕！"));
  }
  function createBtn(e, t) {
    const o = document.createElement("button");
    o.className = BTN_CLASS;
    o.textContent = "📋";
    return (
      (o.title = "點擊累加複製：" + e),
      cache.includes(e) && (o.style.display = "none"),
      document.addEventListener(CACHE_EVENT, (t) => {
        o.style.display = t.detail.cache.includes(e) ? "none" : "";
      }),
      o.addEventListener("click", (n) => {
        (n.preventDefault(),
          n.stopPropagation(),
          o.classList.remove("flashing"),
          void o.offsetWidth,
          o.classList.add("flashing"),
          cache.includes(e)
            ? (showToast("ℹ️ 此小說連結已在快取清單中！"), animateSuccess(o))
            : (cache.push(e),
              writeClipboard(cache.join("\n"), o),
              setTimeout(dispatchCacheChange, 1500)));
      }),
      o
    );
  }
  function injectItemButtons(e) {
    (e.querySelectorAll(ITEM_SELECTOR).forEach((e) => {
      if (e.querySelector(`.${BTN_CLASS}`)) return;
      // 兼容 a 被 novelia-comment-wrapper 包裹的情況
      const t = e.querySelector("a[href]"),
        o = e.querySelector("span.n-text");
      if (!t || !o) return;
      const n = o.textContent.trim(),
        a = t.getAttribute("href");
      if (!n || !a) return;
      const c = `[${n}](https://n.novelia.cc${a})`,
        s = createBtn(c, t),
        l = document.createElement("div");
      l.className = ITEM_WRAPPER_CLASS;
      const wrapper = t.closest(".novelia-comment-wrapper"),
        targetToReplace = wrapper || t;

      (targetToReplace.replaceWith(l),
        l.appendChild(s),
        l.appendChild(targetToReplace));
    }),
      e.querySelectorAll(".n-grid a[href*='/wenku/']").forEach((e) => {
        if (e.querySelector(`.${BTN_CLASS}`)) return;
        const t = e.querySelector("span.n-text");
        if (!t) return;
        const o = t.textContent.trim(),
          n = e.getAttribute("href");
        if (!o || !n) return;
        const a = `[${o}](https://n.novelia.cc${n})`,
          c = createBtn(a, e),
          s = document.createElement("div");
        ((s.className = "novelia-grid-wrapper"),
          t.replaceWith(s),
          s.appendChild(c),
          s.appendChild(t));
      }));
  }
  function shouldShowHeaderBtns() {
    return (
      !0 === SHOW_HEADER_BTNS ||
      (!1 !== SHOW_HEADER_BTNS &&
        (navigator.maxTouchPoints > 0 ||
          window.matchMedia("(pointer:coarse)").matches))
    );
  }
  function injectHeaderButtons() {
    if (!shouldShowHeaderBtns()) return;
    const e = document.querySelector("h1");
    if (!e || e.dataset[HDR_MARK]) return;
    ((e.dataset[HDR_MARK] = "1"),
      (e.style.display = "flex"),
      (e.style.alignItems = "center"),
      (e.style.flexWrap = "wrap"));
    const t = document.createElement("button");
    t.className = HDR_BTN_CLASS;
    t.textContent = "🔄 刷新";
    t.addEventListener("click", (e) => {
      (e.preventDefault(), triggerRefresh());
    });
    const o = document.createElement("button");
    o.className = HDR_BTN_CLASS;
    o.textContent = "🧹 清除快取";
    o.addEventListener("click", (e) => {
      (e.preventDefault(), clearCache());
    });
    const n = document.createElement("button");
    n.className = HDR_BTN_CLASS;
    n.textContent = "📂 查看快取";
    n.addEventListener("click", (e) => {
      (e.preventDefault(), viewCache());
    });
    (e.prepend(n), e.prepend(o), e.prepend(t));
  }
  function matchKey(e, t) {
    return (
      e.ctrlKey === t.ctrl &&
      e.altKey === t.alt &&
      e.shiftKey === t.shift &&
      e.key.toLowerCase() === t.key.toLowerCase()
    );
  }
  window.addEventListener("keydown", (e) => {
    (matchKey(e, CLEAR_KEY) && (e.preventDefault(), clearCache()),
      matchKey(e, VIEW_KEY) && (e.preventDefault(), viewCache()),
      matchKey(e, REFRESH_KEY) && (e.preventDefault(), triggerRefresh()));
  });
  function removeStaleButtons() {
    document.querySelectorAll(`.${BTN_CLASS}`).forEach((e) => {
      const t = e.closest("." + ITEM_WRAPPER_CLASS) || e.closest("div[style]");
      if (t) {
        // 優先找 span，若無則找 a (原本邏輯)
        const s = t.querySelector("span") || t.querySelector("a");
        if (s) {
          const wrapper = s.closest(".novelia-comment-wrapper");
          t.replaceWith(wrapper || s);
        } else {
          t.remove();
        }
      }
      const o = e.closest(".novelia-grid-wrapper");
      if (o) {
        const e = o.querySelector("span.n-text");
        e ? o.replaceWith(e) : o.remove();
      }
      e.remove();
    });
    // 不再移除 HDR_BTN_CLASS 按鈕與 HDR_MARK，避免 h1 buttons 被刷新
  }
  function fullScan() {
    (injectItemButtons(document), injectHeaderButtons());
  }
  fullScan();
  const observer = new MutationObserver((e) => {
    let t = !1;
    for (const o of e)
      if (o.removedNodes.length >= 3) {
        t = !0;
        break;
      }
    if (t)
      return (
        removeStaleButtons(),
        void requestAnimationFrame(() => requestAnimationFrame(fullScan))
      );
    for (const t of e)
      for (const e of t.addedNodes)
        e.nodeType === Node.ELEMENT_NODE && injectItemButtons(e);
    injectHeaderButtons();
  });
  observer.observe(document.body, { childList: !0, subtree: !0 });
})();
