// ==UserScript==
// @name         Novelia Forum-Edit Tabs 固定頁尾
// @namespace    http://tampermonkey.net/
// @version      1.1.1
// @description  將 forum-edit 頁面的 n-tabs-nav 與提交按鈕固定在最下方(footer)，新增回頂/回底按鈕
// @match        https://n.novelia.cc/*
// @match        http://n.novelia.cc/*
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  "use strict";

  const TABS_LABEL_SELECTOR = ".n-tabs-nav-scroll-wrapper";
  const SUBMIT_RIGHT_OFFSET = "16px";
  const SUBMIT_BOTTOM_OFFSET = "8px";
  const BUTTON_GAP = 8;
  const BUTTON_BG = "#4a4a4a";
  const BUTTON_BG_HOVER = "#5c5c5c";
  const BUTTON_BG_ACTIVE = "#333333";
  const BUTTON_COLOR = "#ffffff";
  const MUTATION_DEBOUNCE = 50;
  const ROUTE_CHANGE_DELAY = 200;
  const POLL_INTERVAL = 1000;

  // 只有程式碼區塊需要 minify
  let o = null,
    mt = null,
    u = location.href;
  function iS() {
    if (document.getElementById("tm-fixed-nav-style")) return;
    const s = document.createElement("style");
    s.id = "tm-fixed-nav-style";
    s.textContent = `.tm-fixed-nav-active{position:fixed!important;bottom:0!important;left:0!important;right:0!important;width:100%!important;z-index:9999!important;background:#fff;box-shadow:0 -2px 8px rgba(0,0,0,.08);display:block!important;min-height:48px;pointer-events:none!important}.tm-fixed-nav-active ${TABS_LABEL_SELECTOR}{position:absolute!important;left:50%!important;top:50%!important;transform:translate(-100%,-50%)!important;flex:none!important;pointer-events:auto!important}.tm-fixed-nav-active .n-tabs-nav__suffix{position:absolute!important;left:50%!important;top:50%!important;transform:translateY(-50%)!important;margin-left:0!important;pointer-events:auto!important}.tm-fixed-submit-active{position:fixed!important;right:${SUBMIT_RIGHT_OFFSET}!important;bottom:${SUBMIT_BOTTOM_OFFSET}!important;left:auto!important;top:auto!important;z-index:10000!important;pointer-events:auto!important}#tm-fixed-nav-buttons{position:fixed!important;display:flex!important;align-items:center!important;gap:${BUTTON_GAP}px!important;z-index:10001!important;pointer-events:auto!important;transform:translateY(-50%)!important}#tm-fixed-nav-buttons button{width:32px;height:32px;border-radius:50%;border:none;background:${BUTTON_BG};cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;color:${BUTTON_COLOR};padding:0;transition:background .15s,transform .15s}#tm-fixed-nav-buttons button:hover{background:${BUTTON_BG_HOVER}}#tm-fixed-nav-buttons button:active{background:${BUTTON_BG_ACTIVE};transform:scale(.92)}`;
    document.head.appendChild(s);
  }
  function rS() {
    const s = document.getElementById("tm-fixed-nav-style");
    if (s) s.remove();
  }
  function iT() {
    return location.pathname.includes("/forum-edit");
  }
  function fN() {
    return document.querySelector(
      ".n-tabs-nav--card-type.n-tabs-nav--top.n-tabs-nav",
    );
  }
  function fB() {
    return document.querySelector(
      "button.n-button--primary-type.n-button--large-type.float",
    );
  }
  function cBG() {
    let c = document.getElementById("tm-fixed-nav-buttons");
    if (c) return c;
    c = document.createElement("div");
    c.id = "tm-fixed-nav-buttons";
    const up = document.createElement("button");
    up.type = "button";
    up.setAttribute("aria-label", "回到頁面最上方");
    up.textContent = "↑";
    up.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    const down = document.createElement("button");
    down.type = "button";
    down.setAttribute("aria-label", "前往頁面最下方");
    down.textContent = "↓";
    down.addEventListener("click", () => {
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      window.scrollTo({ top: h, behavior: "smooth" });
    });
    c.appendChild(up);
    c.appendChild(down);
    document.body.appendChild(c);
    return c;
  }
  function rBG() {
    const c = document.getElementById("tm-fixed-nav-buttons");
    if (c) c.remove();
  }
  function pB() {
    const c = document.getElementById("tm-fixed-nav-buttons");
    const w = document.querySelector(TABS_LABEL_SELECTOR);
    if (!c || !w) return;
    const wr = w.getBoundingClientRect();
    if (wr.width === 0 && wr.height === 0) return;
    c.style.left = wr.left - c.offsetWidth - BUTTON_GAP + "px";
    c.style.top = wr.top + wr.height / 2 + "px";
  }
  function aF(n) {
    if (!n || n.classList.contains("tm-fixed-nav-active")) {
      if (n) {
        cBG();
        pB();
      }
      return;
    }
    iS();
    n.classList.add("tm-fixed-nav-active");
    cBG();
    pB();
  }
  function rF(n) {
    if (n && n.classList.contains("tm-fixed-nav-active"))
      n.classList.remove("tm-fixed-nav-active");
    rS();
    rBG();
  }
  function aB(b) {
    if (!b || b.classList.contains("tm-fixed-submit-active")) return;
    iS();
    b.classList.add("tm-fixed-submit-active");
  }
  function rB(b) {
    if (b && b.classList.contains("tm-fixed-submit-active"))
      b.classList.remove("tm-fixed-submit-active");
  }
  function tA() {
    if (!iT()) {
      const n = document.querySelector(".tm-fixed-nav-active");
      if (n) rF(n);
      else rBG();
      const b = document.querySelector(".tm-fixed-submit-active");
      if (b) rB(b);
      return;
    }
    const n = fN();
    if (n) aF(n);
    const b = fB();
    if (b) aB(b);
  }
  function sO() {
    if (o) o.disconnect();
    o = new MutationObserver(() => {
      if (mt) clearTimeout(mt);
      mt = setTimeout(tA, MUTATION_DEBOUNCE);
    });
    o.observe(document.documentElement, { childList: true, subtree: true });
  }
  function pH() {
    const ps = history.pushState,
      rs = history.replaceState;
    history.pushState = function (...a) {
      const r = ps.apply(this, a);
      window.dispatchEvent(new Event("tm-locationchange"));
      return r;
    };
    history.replaceState = function (...a) {
      const r = rs.apply(this, a);
      window.dispatchEvent(new Event("tm-locationchange"));
      return r;
    };
    window.addEventListener("popstate", () => {
      window.dispatchEvent(new Event("tm-locationchange"));
    });
  }
  function oL() {
    if (location.href === u) return;
    u = location.href;
    const n = document.querySelector(".tm-fixed-nav-active");
    if (n) rF(n);
    else rBG();
    const b = document.querySelector(".tm-fixed-submit-active");
    if (b) rB(b);
    setTimeout(tA, ROUTE_CHANGE_DELAY);
  }
  function onResize() {
    if (iT()) pB();
  }
  function init() {
    pH();
    window.addEventListener("tm-locationchange", oL);
    window.addEventListener("resize", onResize);
    setInterval(() => {
      if (location.href !== u) oL();
    }, POLL_INTERVAL);
    const sw = () => {
      tA();
      sO();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", sw);
    } else {
      sw();
    }
  }
  init();
})();
