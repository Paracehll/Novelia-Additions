// ==UserScript==
// @name         Novelia Web評論數
// @namespace    novelia-comment-tracker
// @version      1.3.2
// @description  掃描頁面上的小說連結，透過官方 /api/comment 取得留言數，存入 localStorage 並定期更新，提供手動更新按鈕。
// @match        https://n.novelia.cc/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'novelia_comment_count';
  const PAGE_SIZE = 100;
  const CONCURRENCY_LIMIT = 3;
  const PAGE_FETCH_CONCURRENCY = 3;
  const ICON = '💬';
  const BADGE_ALIGN_ITEMS = 'auto';
  const INCREMENT_COLOR = '#4caf50';
  const ERROR_COLOR = '#e06c75';
  const UPDATE_BUTTON_ICON = '🔄';
  const BULK_UPDATE_BUTTON_CLASS = 'novelia-bulk-update-button';
  const COUNT_REPLIES = true;
  const REPLIES_ARRAY_FIELD = 'replies';
  const REPLIES_COUNT_FIELD = 'replyCount';
  const CACHE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .novelia-update-button, .${BULK_UPDATE_BUTTON_CLASS} {
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
    .novelia-update-button:hover, .${BULK_UPDATE_BUTTON_CLASS}:hover {
      background: #f0f0f0;
    }
    .novelia-update-button:disabled, .${BULK_UPDATE_BUTTON_CLASS}:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  `;
  document.head.appendChild(styleEl);

  function getFullStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveFullStorage(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('[novelia-comments] localStorage 寫入失敗:', e);
    }
  }

  function getStoredEntry(source, id) {
    const store = getFullStorage();
    return (store[source] && store[source][id]) || null;
  }

  function saveCache(source, id, counts, previous) {
    const { comment_count, all_comment_count } = counts;
    const store = getFullStorage();
    if (!store[source]) store[source] = {};
    store[source][id] = {
      prev: previous ? (previous.now ?? previous.comment_count) : comment_count,
      prev_all: previous ? (previous.now_all ?? previous.all_comment_count) : all_comment_count,
      now: comment_count,
      now_all: all_comment_count,
      update: Date.now(),
    };
    saveFullStorage(store);
  }

  function getAllAsNestedObject() {
    return getFullStorage();
  }

  function buildResultFromEntry(entry) {
    if (!entry) return null;
    const now = entry.now ?? entry.comment_count;
    const nowAll = entry.now_all ?? entry.all_comment_count;
    const prev = entry.prev ?? entry.prev_comment_count ?? now;
    const prevAll = entry.prev_all ?? entry.prev_all_comment_count ?? nowAll;
    const count = COUNT_REPLIES ? nowAll : now;
    const prevCount = COUNT_REPLIES ? prevAll : prev;
    const diff = Math.max(0, (count ?? 0) - (prevCount ?? 0));
    return { count, diff, entry };
  }

  async function fetchCommentPage(site, page) {
    const url = `/api/comment?site=${encodeURIComponent(site)}&page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  function countItemWithReplies(item) {
    let total = 1;
    const repliesArr = item ? item[REPLIES_ARRAY_FIELD] : null;
    if (Array.isArray(repliesArr) && repliesArr.length > 0) {
      for (const reply of repliesArr) total += countItemWithReplies(reply);
    } else if (item && typeof item[REPLIES_COUNT_FIELD] === 'number') {
      total += item[REPLIES_COUNT_FIELD];
    }
    return total;
  }

  async function fetchAllPagesForReplies(site, totalPages, alreadyFetched) {
    const results = new Array(totalPages).fill(null);
    results[0] = alreadyFetched[0];
    if (alreadyFetched.length > 1) results[totalPages - 1] = alreadyFetched[1];
    const missing = [];
    for (let i = 0; i < totalPages; i++) if (!results[i]) missing.push(i);
    const pageLimiter = createConcurrencyLimiter(PAGE_FETCH_CONCURRENCY);
    await Promise.all(missing.map((i) => pageLimiter(async () => { results[i] = await fetchCommentPage(site, i); })));
    return results;
  }

  async function fetchCounts(source, id) {
    const site = `web-${source}-${id}`;
    const first = await fetchCommentPage(site, 0);
    const totalPages = first.pageNumber;
    let topCount;
    const already = [first];
    if (totalPages <= 1) {
      topCount = first.items.length;
    } else {
      const last = await fetchCommentPage(site, totalPages - 1);
      topCount = (totalPages - 1) * PAGE_SIZE + last.items.length;
      already.push(last);
    }
    if (!COUNT_REPLIES) return { topCount, allCount: topCount };
    const pages = totalPages <= 1 ? [first] : await fetchAllPagesForReplies(site, totalPages, already);
    let allCount = 0;
    for (const page of pages) if (page) for (const item of page.items) allCount += countItemWithReplies(item);
    return { topCount, allCount };
  }

  const pendingKeys = new Set();
  const fetchedOnceKeys = new Set();

  async function updateCommentCount(source, id) {
    const uniqueKey = `${source}/${id}`;
    if (pendingKeys.has(uniqueKey)) return null;
    pendingKeys.add(uniqueKey);
    try {
      const previous = getStoredEntry(source, id);
      const { topCount, allCount } = await fetchCounts(source, id);
      saveCache(source, id, { comment_count: topCount, all_comment_count: allCount }, previous);
      return buildResultFromEntry(getStoredEntry(source, id));
    } finally {
      pendingKeys.delete(uniqueKey);
    }
  }

  async function getCommentCount(source, id, { force = false, isInitial = false } = {}) {
    const uniqueKey = `${source}/${id}`;
    if (force) return updateCommentCount(source, id);
    if (fetchedOnceKeys.has(uniqueKey)) return null;
    fetchedOnceKeys.add(uniqueKey);
    const cached = getStoredEntry(source, id);
    if (!cached) return updateCommentCount(source, id);
    const updatedAt = cached.update ?? cached.updated_at ?? 0;
    const isStale = (Date.now() - updatedAt >= CACHE_REFRESH_INTERVAL_MS);
    const isNewInstall = !localStorage.getItem(STORAGE_KEY);
    if ((isInitial || isNewInstall) && isStale) return updateCommentCount(source, id);
    return buildResultFromEntry(cached);
  }

  function createConcurrencyLimiter(limit) {
    let active = 0;
    const queue = [];
    const runNext = () => {
      if (active >= limit || queue.length === 0) return;
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(resolve, reject).finally(() => { active--; runNext(); });
    };
    return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); runNext(); });
  }
  const limiter = createConcurrencyLimiter(CONCURRENCY_LIMIT);

  function matchNovelPath(pathname) {
    const m = pathname.match(/^\/novel\/([^\/?#]+)\/([^\/?#]+)\/?$/i);
    return m ? { source: m[1], id: m[2] } : null;
  }

  function isAllowedPage() {
    const path = window.__noveliaMockPath || location.pathname;
    return path === '/' || path.startsWith('/novel') || path.startsWith('/favorite');
  }

  function parseNovelPath(anchor) {
    try {
      return matchNovelPath(new URL(anchor.getAttribute('href'), location.origin).pathname);
    } catch (e) {
      return null;
    }
  }

  function ensureWrapper(target) {
    const existing = target.closest('.novelia-comment-wrapper, .novelia-item-wrapper');
    if (existing) return existing;
    const wrapper = document.createElement('span');
    wrapper.className = 'novelia-comment-wrapper';
    wrapper.style.alignItems = BADGE_ALIGN_ITEMS;
    wrapper.style.gap = '6px';
    target.replaceWith(wrapper);
    wrapper.appendChild(target);
    return wrapper;
  }

  function createNewBadge(count, diff) {
    const badge = document.createElement('span');
    badge.className = 'novelia-comment-badge';
    badge.style.fontSize = '12px';
    badge.style.opacity = '0.85';
    badge.style.whiteSpace = 'nowrap';
    badge.style.flex = '0 0 auto';
    badge.style.marginRight = '8px';
    badge.dataset.noveliaRenderedText = `${count}|${diff}`;

    badge.appendChild(document.createTextNode(`${ICON} ${count}`));
    if (diff > 0) {
      const incSpan = document.createElement('span');
      incSpan.className = 'novelia-comment-diff';
      incSpan.style.color = INCREMENT_COLOR;
      incSpan.textContent = ` (+${diff})`;
      badge.appendChild(incSpan);
    }
    return badge;
  }

  function renderPlainBadge(target, text, { isError = false } = {}) {
    const wrapper = ensureWrapper(target);
    let badge = wrapper.querySelector(':scope > .novelia-comment-badge');
    if (badge && badge.dataset.noveliaLocked === '1') return;
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'novelia-comment-badge';
      badge.style.fontSize = '12px';
      badge.style.opacity = '0.85';
      badge.style.whiteSpace = 'nowrap';
      badge.style.flex = '0 0 auto';
      badge.style.marginRight = '8px';
      const shareBtn = wrapper.querySelector(':scope > .novelia-copy-btn');
      if (shareBtn) shareBtn.after(badge);
      else wrapper.prepend(badge);
    }
    badge.textContent = text;
    badge.style.color = isError ? ERROR_COLOR : '';
    delete badge.dataset.noveliaRenderedText;
  }

  function renderCountBadge(target, count, diff) {
    const wrapper = ensureWrapper(target);
    const existing = wrapper.querySelector(':scope > .novelia-comment-badge');
    if (existing && existing.dataset.noveliaLocked === '1') return;
    updateBadgeInWrapper(wrapper, count, diff);
  }

  function forceRenderCountBadge(target, count, diff) {
    const wrapper = ensureWrapper(target);
    updateBadgeInWrapper(wrapper, count, diff);
  }

  function updateBadgeInWrapper(wrapper, count, diff) {
    const key = `${count}|${diff}`;
    const existing = wrapper.querySelector(':scope > .novelia-comment-badge');
    if (existing && existing.dataset.noveliaRenderedText === key) return;

    if (existing) existing.remove();

    const newBadge = createNewBadge(count, diff);
    newBadge.dataset.noveliaLocked = '1';

    const shareBtn = wrapper.querySelector(':scope > .novelia-copy-btn');
    if (shareBtn) shareBtn.after(newBadge);
    else wrapper.prepend(newBadge);
  }

  function getListTarget(a) {
    const flexParent = a.closest('.n-flex') || a.closest('.n-grid > div');
    if (!flexParent) return a;
    const targets = flexParent.querySelectorAll(':scope > span, :scope > div.text-2line');
    return targets[0] || targets[1] || a;
  }

  function collectPendingAnchors() {
    const anchors = document.querySelectorAll(`a[href]:not([data-novelia-comment-tracked])`);
    const groups = new Map();
    anchors.forEach((a) => {
      const novel = parseNovelPath(a);
      if (!novel) return;
      a.dataset['noveliaCommentTracked'] = '1';
      const key = `${novel.source}/${novel.id}`;
      if (!groups.has(key)) groups.set(key, { source: novel.source, id: novel.id, targets: [] });
      const target = getListTarget(a);
      groups.get(key).targets.push(target);
      const stored = getStoredEntry(novel.source, novel.id);
      const result = buildResultFromEntry(stored);
      if (result) renderCountBadge(target, result.count, result.diff);
      else renderPlainBadge(target, `${ICON} …`);
    });
    return Array.from(groups.values());
  }

  async function processGroup(group, { isInitial = false } = {}) {
    await limiter(async () => {
      try {
        const result = await getCommentCount(group.source, group.id, { isInitial });
        if (!result) return;
        group.targets.forEach((t) => renderCountBadge(t, result.count, result.diff));
      } catch (err) {
        group.targets.forEach((t) => renderPlainBadge(t, `${ICON} ?`, { isError: true }));
        console.error('[novelia-comments] 處理失敗:', `${group.source}/${group.id}`, err);
      }
    });
  }

  function createH1Badge(key) {
    const badge = document.createElement('span');
    badge.className = 'novelia-h1-comment-badge';
    badge.dataset.noveliaNovelKey = key;
    badge.style.fontSize = '14px';
    badge.style.opacity = '0.85';
    badge.style.whiteSpace = 'nowrap';
    badge.style.marginLeft = '4px';
    return badge;
  }

  function renderH1Badge(badge, entry) {
    const result = buildResultFromEntry(entry);
    const count = result ? result.count : '…';
    const diff = result ? result.diff : 0;
    const key = `${count}|${diff}`;

    if (badge.dataset.noveliaRenderedText === key) return;

    // For H1 badge, we just update content to avoid losing the element reference held by the button
    badge.dataset.noveliaRenderedText = key;
    badge.textContent = '';
    badge.appendChild(document.createTextNode(`${ICON} ${count}`));
    if (diff > 0) {
      const inc = document.createElement('span');
      inc.style.color = INCREMENT_COLOR;
      inc.textContent = ` (+${diff})`;
      badge.appendChild(inc);
    }
  }

  function createUpdateButton(source, id, key, badge) {
    const btn = document.createElement('button');
    btn.className = 'novelia-update-button';
    btn.textContent = UPDATE_BUTTON_ICON + ' 更新';
    btn.dataset.noveliaNovelKey = key;
    btn.title = '手動更新留言數';
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '⏳ 更新中';
      try {
        const result = await getCommentCount(source, id, { force: true });
        if (result) {
          delete badge.dataset.noveliaRenderedText;
          renderH1Badge(badge, result.entry);
          document.querySelectorAll('a[href][data-novelia-comment-tracked]').forEach((a) => {
            const n = parseNovelPath(a);
            if (n && n.source === source && n.id === id) {
              forceRenderCountBadge(getListTarget(a), result.count, result.diff);
            }
          });
        }
        btn.textContent = UPDATE_BUTTON_ICON + ' 更新';
      } catch (e) {
        btn.textContent = '⚠️';
        setTimeout(() => { btn.textContent = UPDATE_BUTTON_ICON + ' 更新'; }, 1500);
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  function injectUpdateButtonsForCurrentNovel() {
    const novel = matchNovelPath(location.pathname);
    if (!novel) return;
    const h1s = document.querySelectorAll('h1');
    if (!h1s.length) return;
    const key = `${novel.source}/${novel.id}`;
    const stored = getStoredEntry(novel.source, novel.id);
    h1s.forEach((h1) => {
      h1.style.display = 'flex';
      h1.style.alignItems = 'center';
      h1.style.flexWrap = 'wrap';
      let btn = h1.querySelector('.novelia-update-button');
      if (btn && btn.dataset.noveliaNovelKey !== key) {
        const staleBadge = h1.querySelector('.novelia-h1-comment-badge');
        btn.remove();
        if (staleBadge) staleBadge.remove();
        btn = null;
      }
      let badge = btn ? h1.querySelector('.novelia-h1-comment-badge') : null;
      if (!btn) {
        badge = createH1Badge(key);
        btn = createUpdateButton(novel.source, novel.id, key, badge);
        const lastHdrBtn = Array.from(h1.querySelectorAll('.novelia-header-btn')).pop();
        if (lastHdrBtn) { lastHdrBtn.after(btn); btn.after(badge); }
        else { h1.prepend(badge); h1.prepend(btn); }
      }
      if (badge) renderH1Badge(badge, stored);
    });
  }

  function createBulkUpdateButton() {
    const btn = document.createElement('button');
    btn.className = BULK_UPDATE_BUTTON_CLASS;
    btn.textContent = UPDATE_BUTTON_ICON + ' 批次更新';
    btn.title = '手動更新本頁所有留言數';
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '⏳ 批次更新中';
      try {
        const anchors = document.querySelectorAll('a[href][data-novelia-comment-tracked]');
        const groups = new Map();
        anchors.forEach((a) => {
          const novel = parseNovelPath(a);
          if (!novel) return;
          const key = `${novel.source}/${novel.id}`;
          if (!groups.has(key)) groups.set(key, { source: novel.source, id: novel.id, targets: new Set() });
          groups.get(key).targets.add(getListTarget(a));
        });
        await Promise.all(Array.from(groups.values()).map((group) => limiter(async () => {
          try {
            const result = await getCommentCount(group.source, group.id, { force: true });
            if (result) group.targets.forEach((t) => forceRenderCountBadge(t, result.count, result.diff));
          } catch (err) {
            group.targets.forEach((t) => renderPlainBadge(t, `${ICON} ?`, { isError: true }));
          }
        })));
        btn.textContent = UPDATE_BUTTON_ICON + ' 批次更新';
      } catch (e) {
        btn.textContent = '⚠️ 失敗';
        setTimeout(() => { btn.textContent = UPDATE_BUTTON_ICON + ' 批次更新'; }, 1500);
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  function injectBulkUpdateButtons() {
    const h1 = document.querySelector('h1');
    if (!h1 || h1.querySelector(`:scope > .${BULK_UPDATE_BUTTON_CLASS}`)) return;

    h1.style.display = 'flex';
    h1.style.alignItems = 'center';
    h1.style.flexWrap = 'wrap';
    const btn = createBulkUpdateButton();
    const lastHdrBtn = Array.from(h1.querySelectorAll('.novelia-header-btn')).pop();
    if (lastHdrBtn) lastHdrBtn.after(btn);
    else h1.appendChild(btn);
  }

  function scan({ isInitial = false } = {}) {
    if (!isAllowedPage()) return;
    const groups = collectPendingAnchors();
    groups.forEach((g) => processGroup(g, { isInitial }));
    injectUpdateButtonsForCurrentNovel();
    injectBulkUpdateButtons();
  }

  let scanTimer = null;
  function scheduleScan({ isInitial = false } = {}) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan({ isInitial }), 200);
  }

  function isNoveliaOwnNode(node) {
    if (!node) return false;
    if (node.nodeType === Node.TEXT_NODE) return isNoveliaOwnNode(node.parentElement);
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (typeof node.className === 'string' && /(^|\s)novelia-/.test(node.className)) return true;
    return !!(node.closest && node.closest('[class*="novelia-"]'));
  }

  function isSelfCausedMutation(mutation) {
    if (isNoveliaOwnNode(mutation.target)) return true;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.length > 0 && nodes.every((n) => isNoveliaOwnNode(n));
  }

  function observeDomChanges() {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.addedNodes && m.addedNodes.length > 0 && !isSelfCausedMutation(m))) scheduleScan({ isInitial: false });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function observeRouteChanges() {
    const notify = () => { scheduleScan({ isInitial: false }); setTimeout(() => scan({ isInitial: false }), 500); };
    const originalPushState = history.pushState;
    history.pushState = function (...args) { originalPushState.apply(this, args); notify(); };
    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) { originalReplaceState.apply(this, args); notify(); };
    window.addEventListener('popstate', notify);
  }

  function main() {
    scan({ isInitial: true });
    observeDomChanges();
    observeRouteChanges();
  }

  window.__noveliaCommentTracker = {
    getAllAsNestedObject,
    getCommentCount,
    scan,
    config: { COUNT_REPLIES, CACHE_REFRESH_INTERVAL_MS },
  };

  main();
})();
