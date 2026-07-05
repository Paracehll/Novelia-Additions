// ==UserScript==
// @name         Novelia Forum-Edit Mobile Footer
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  適配行動端的 Novelia 編輯頁面固定頁尾：固定標籤頁與工具欄，將提交按鈕移入標籤欄，支援 UI 切換展開/收起。
// @match        https://n.novelia.cc/*
// @match        http://n.novelia.cc/*
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  "use strict";

  if (window.top !== window.self) return;

  const TABS_NAV_SELECTOR = ".n-tabs-nav--card-type.n-tabs-nav--top.n-tabs-nav";
  const TOOLBAR_SELECTOR = ".markdown-input .n-tab-pane > .n-flex";
  const SUBMIT_SELECTOR =
    "button.n-button--primary-type.n-button--large-type.float";
  const TABS_PAD_SELECTOR = ".n-tabs-pad";

  const SIDEBAR_H_GAP = 80;
  const SIDEBAR_V_GAP = 8;
  const BUTTON_GAP = 8;
  const BUTTON_BG = "rgba(74, 74, 74, 0.8)";
  const BUTTON_COLOR = "#ffffff";
  const MUTATION_DEBOUNCE = 50;
  const ROUTE_CHANGE_DELAY = 200;
  const POLL_INTERVAL = 1000;

  let o = null,
    mt = null,
    u = location.href,
    fC = !1;
  function iS() {
    if (document.getElementById("tm-mobile-fixed-style")) return;
    const t = document.createElement("style");
    ((t.id = "tm-mobile-fixed-style"),
      (t.textContent = `.tm-fixed-nav-active {position: fixed !important;bottom: 0 !important;left: 0 !important;right: 0 !important;width: 100% !important;z-index: 9999 !important;background: var(--n-color, #fff) !important;box-shadow: 0 -2px 8px rgba(0,0,0,.12);display: block !important;min-height: 40px;padding-bottom: env(safe-area-inset-bottom);}.tm-fixed-nav-active ${TABS_PAD_SELECTOR} {display: flex !important;align-items: center !important;justify-content: flex-end !important;padding-right: 8px !important;flex: 1 !important;}.tm-fixed-toolbar-active {position: fixed !important;bottom: calc(40px + env(safe-area-inset-bottom)) !important;left: 0 !important;right: 0 !important;z-index: 9998 !important;background: var(--n-color, #fff) !important;border-top: 1px solid var(--n-border-color, #eee);padding: 4px 8px !important;margin-bottom: 0 !important;display: flex !important;overflow-x: auto !important;flex-wrap: nowrap !important;-webkit-overflow-scrolling: touch;gap: 4px !important;}.tm-fixed-toolbar-active > button {flex: 0 0 auto !important;}.tm-fixed-submit-in-pad {//position: static !important;height: 28px !important;padding: 0 12px !important;font-size: 12px !important;margin-left: auto !important;bottom: 10px !important;right: 10px !important;}#tm-fixed-nav-buttons {position: fixed !important;right: ${SIDEBAR_V_GAP}px !important;bottom: calc(${SIDEBAR_H_GAP}px + env(safe-area-inset-bottom)) !important;display: flex !important;flex-direction: column !important;gap: ${BUTTON_GAP}px !important;z-index: 10001 !important;}#tm-fixed-nav-buttons button {width: 36px;height: 36px;border-radius: 50%;border: none;background: ${BUTTON_BG};color: ${BUTTON_COLOR};display: flex;align-items: center;justify-content: center;font-size: 18px;box-shadow: 0 2px 4px rgba(0,0,0,0.2);padding: 0;cursor: pointer;}.tm-fixed-footer-collapsed {display: none !important;}`),
      document.head.appendChild(t));
  }
  function iT() {
    return location.pathname.includes("/forum-edit");
  }
  function fN() {
    return document.querySelector(TABS_NAV_SELECTOR);
  }
  function fT() {
    return document.querySelector(TOOLBAR_SELECTOR);
  }
  function fB() {
    return document.querySelector(SUBMIT_SELECTOR);
  }
  function fP() {
    return document.querySelector(TABS_PAD_SELECTOR);
  }
  function cBG() {
    let t = document.getElementById("tm-fixed-nav-buttons");
    if (t) return t;
    ((t = document.createElement("div")), (t.id = "tm-fixed-nav-buttons"));
    const n = document.createElement("button");
    ((n.type = "button"),
      (n.textContent = "👁"),
      n.setAttribute("aria-label", "顯示/隱藏頁尾工具欄"),
      (n.onclick = () => {
        ((fC = !fC), tA());
      }));
    const e = document.createElement("button");
    ((e.type = "button"),
      (e.textContent = "↑"),
      e.setAttribute("aria-label", "回到最上方"),
      (e.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" })));
    const o = document.createElement("button");
    return (
      (o.type = "button"),
      (o.textContent = "↓"),
      o.setAttribute("aria-label", "回到最下方"),
      (o.onclick = () => {
        const t = Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
        );
        window.scrollTo({ top: t, behavior: "smooth" });
      }),
      t.appendChild(n),
      t.appendChild(e),
      t.appendChild(o),
      document.body.appendChild(t),
      t
    );
  }
  function tA() {
    if (!iT()) {
      document
        .querySelectorAll(
          ".tm-fixed-nav-active, .tm-fixed-toolbar-active, .tm-fixed-submit-in-pad",
        )
        .forEach((t) => {
          t.classList.remove(
            "tm-fixed-nav-active",
            "tm-fixed-toolbar-active",
            "tm-fixed-submit-in-pad",
          );
        });
      const t = document.getElementById("tm-fixed-nav-buttons");
      return void (t && t.remove());
    }
    iS();
    const t = fN();
    t && t.classList.add("tm-fixed-nav-active");
    const n = fT();
    n && n.classList.add("tm-fixed-toolbar-active");
    const e = fB(),
      o = fP();
    e &&
      o &&
      (e.parentElement !== o && o.appendChild(e),
      e.classList.add("tm-fixed-submit-in-pad"));
    cBG();
    [t, n, e].forEach((t) => {
      t && t.classList.toggle("tm-fixed-footer-collapsed", fC);
    });
  }
  function sO() {
    (o && o.disconnect(),
      (o = new MutationObserver(() => {
        (mt && clearTimeout(mt), (mt = setTimeout(tA, MUTATION_DEBOUNCE)));
      })),
      o.observe(document.documentElement, { childList: !0, subtree: !0 }));
  }
  function pH() {
    const t = history.pushState,
      n = history.replaceState;
    ((history.pushState = function (...n) {
      const e = t.apply(this, n);
      return (window.dispatchEvent(new Event("tm-locationchange")), e);
    }),
      (history.replaceState = function (...t) {
        const e = n.apply(this, t);
        return (window.dispatchEvent(new Event("tm-locationchange")), e);
      }),
      window.addEventListener("popstate", () => {
        window.dispatchEvent(new Event("tm-locationchange"));
      }));
  }
  function init() {
    (pH(),
      window.addEventListener("tm-locationchange", tA),
      setInterval(() => {
        location.href !== u && ((u = location.href), tA());
      }, POLL_INTERVAL));
    const t = () => {
      (tA(), sO());
    };
    "loading" === document.readyState
      ? document.addEventListener("DOMContentLoaded", t)
      : t();
  }
  init();
})();
