// ==UserScript==
// @name         Novelia Web評論數
// @namespace    novelia-comment-tracker
// @version      1.3.0
// @description  掃描頁面上的小說連結，透過官方 /api/comment 取得留言數（可選擇是否計入回覆），存入 localStorage 並每 10 分鐘（可設定）於重新整理頁面時更新，於 h1 旁提供手動更新按鈕；連結旁的留言數 badge 顯示一次後即鎖定不再更新
// @match        https://n.novelia.cc/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ===================== 可調整常數 =====================
  const STORAGE_KEY = 'novelia_comment_count';
  const PAGE_SIZE = 100;
  const CONCURRENCY_LIMIT = 3; // 同時處理幾個「小說」
  const PAGE_FETCH_CONCURRENCY = 3; // 計入回覆時，同時抓幾「頁」留言
  const ICON = '💬';
  const BADGE_ALIGN_ITEMS = 'auto';
  const INCREMENT_COLOR = '#4caf50';
  const ERROR_COLOR = '#e06c75';
  const UPDATE_BUTTON_ICON = '🔄';
  // 需求：清單型頁面（例如「我的收藏」、搜尋結果等，非單一小說頁）的 h1 旁批次更新按鈕，
  // 用獨特 class 標記，方便用 selector 檢查是否已經加過，避免重複注入。
  const BULK_UPDATE_BUTTON_CLASS = 'novelia-bulk-update-button';

  // 需求1：是否計入 replies 內的留言數（回覆的回覆也會遞迴計入）
  // 開啟後，每次「真正發出請求」時會改成抓取全部分頁（而非只抓首頁+末頁），
  // 對於留言很多的小說會多花一些時間/請求數，請視需要開關。
  const COUNT_REPLIES = true;

  // 回覆資料的欄位名稱，需依 /api/comment 實際回傳格式調整：
  // 若某則留言物件底下有 replies: [...] 陣列，會遞迴加總其中每一則（含它們自己的 replies）。
  // 若沒有陣列、但有像 replyCount: number 這種欄位，會直接加上該數字（不會再遞迴，因為沒有明細）。
  const REPLIES_ARRAY_FIELD = 'replies';
  const REPLIES_COUNT_FIELD = 'replyCount';

  // 需求2：快取有效時間，超過此時間、且頁面「重新整理」時才會重新打 API
  const CACHE_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 分鐘
  // =======================================================

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .novelia-update-button, .${BULK_UPDATE_BUTTON_CLASS} {
      margin-left: 10px;
      padding: 4px 10px;
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
      line-height: 1;
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

  // 需求：儲存 prev/new 的「一般留言數」與「含回覆的留言數」於單一 key
  function saveCache(source, id, counts, previous) {
    const { comment_count, all_comment_count } = counts;
    const store = getFullStorage();
    if (!store[source]) store[source] = {};

    // 格式：update: .., prev: .., prev_all: .., now: .., now_all: ..
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

  // 依目前的 entry（支援新舊格式）與 COUNT_REPLIES 模式，算出要顯示的數字與新增數
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
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.json();
  }

  // 遞迴計算單一留言（含其所有回覆）的總數
  function countItemWithReplies(item) {
    let total = 1;
    const repliesArr = item ? item[REPLIES_ARRAY_FIELD] : null;
    if (Array.isArray(repliesArr) && repliesArr.length > 0) {
      for (const reply of repliesArr) {
        total += countItemWithReplies(reply);
      }
    } else if (item && typeof item[REPLIES_COUNT_FIELD] === 'number') {
      total += item[REPLIES_COUNT_FIELD];
    }
    return total;
  }

  // 需要抓「所有分頁」時使用（計入回覆模式），重用已經抓過的首頁/末頁，其餘用有限併發補齊
  async function fetchAllPagesForReplies(site, totalPages, alreadyFetched) {
    const results = new Array(totalPages).fill(null);
    results[0] = alreadyFetched[0];
    if (alreadyFetched.length > 1) {
      results[totalPages - 1] = alreadyFetched[1];
    }
    const missing = [];
    for (let i = 0; i < totalPages; i++) {
      if (!results[i]) missing.push(i);
    }
    const pageLimiter = createConcurrencyLimiter(PAGE_FETCH_CONCURRENCY);
    await Promise.all(
      missing.map((i) =>
        pageLimiter(async () => {
          results[i] = await fetchCommentPage(site, i);
        })
      )
    );
    return results;
  }

  // 回傳 { topCount, allCount }：topCount 為一般留言數，allCount 為依 COUNT_REPLIES 計算後的留言數
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

    if (!COUNT_REPLIES) {
      return { topCount, allCount: topCount };
    }

    const pages = totalPages <= 1 ? [first] : await fetchAllPagesForReplies(site, totalPages, already);
    let allCount = 0;
    for (const page of pages) {
      if (!page) continue;
      for (const item of page.items) {
        allCount += countItemWithReplies(item);
      }
    }
    return { topCount, allCount };
  }

  const pendingKeys = new Set();
  // 每個小說在本次頁面生命週期最多「自動」處理一次（手動按鈕 force 不受此限制）
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

  // 需求2：每 10min (CACHE_REFRESH_INTERVAL_MS)，重新載入網頁時 (isInitial)，
  // request 並更新 localstorage，其餘直接取用 localstorage。
  // 需求3：force = true 時（按下🔄按鈕），一律直接觸發 request 並更新 localstorage。
  async function getCommentCount(source, id, { force = false, isInitial = false } = {}) {
    const uniqueKey = `${source}/${id}`;

    if (force) {
      return updateCommentCount(source, id);
    }

    if (fetchedOnceKeys.has(uniqueKey)) return null;
    fetchedOnceKeys.add(uniqueKey);

    const cached = getStoredEntry(source, id);
    const updatedAt = cached ? (cached.update ?? cached.updated_at) : 0;
    const isStale = !cached || (Date.now() - updatedAt >= CACHE_REFRESH_INTERVAL_MS);

    // 需求：如果檢測到 localstorage 沒有 key (代表全新安裝或被清空)，立刻更新一輪
    const isNewInstall = !localStorage.getItem(STORAGE_KEY);

    if ((isInitial || isNewInstall) && isStale) {
      return updateCommentCount(source, id);
    }

    return buildResultFromEntry(cached);
  }

  function createConcurrencyLimiter(limit) {
    let active = 0;
    const queue = [];
    const runNext = () => {
      if (active >= limit || queue.length === 0) return;
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn()
        .then(resolve, reject)
        .finally(() => {
          active--;
          runNext();
        });
    };
    return (fn) =>
      new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        runNext();
      });
  }
  const limiter = createConcurrencyLimiter(CONCURRENCY_LIMIT);

  function matchNovelPath(pathname) {
    const m = pathname.match(/^\/novel\/([^\/?#]+)\/([^\/?#]+)\/?$/i);
    if (!m) return null;
    return { source: m[1], id: m[2] };
  }

  function parseNovelPath(anchor) {
    let pathname;
    try {
      pathname = new URL(anchor.getAttribute('href'), location.origin).pathname;
    } catch (e) {
      return null;
    }
    return matchNovelPath(pathname);
  }

  function ensureWrapper(anchor) {
    const parent = anchor.parentElement;
    if (parent && parent.classList.contains('novelia-comment-wrapper')) {
      return parent;
    }
    const wrapper = document.createElement('span');
    wrapper.className = 'novelia-comment-wrapper';
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = BADGE_ALIGN_ITEMS;
    wrapper.style.gap = '6px';
    anchor.replaceWith(wrapper);
    wrapper.appendChild(anchor);
    return wrapper;
  }

  function getOrCreateBadge(anchor) {
    const wrapper = ensureWrapper(anchor);
    let badge = wrapper.firstElementChild;
    if (!badge || !badge.classList.contains('novelia-comment-badge')) {
      badge = document.createElement('span');
      badge.className = 'novelia-comment-badge';
      badge.style.fontSize = '12px';
      badge.style.opacity = '0.85';
      badge.style.whiteSpace = 'nowrap';
      badge.style.flex = '0 0 auto';
      wrapper.insertBefore(badge, anchor);
    }
    return badge;
  }

  function renderPlainBadge(anchor, text, { isError = false } = {}) {
    const badge = getOrCreateBadge(anchor);
    // 只要已經顯示過「實際留言數」就鎖定，loading/error 這種暫時性文字不應該覆蓋掉最終結果
    if (badge.dataset.noveliaLocked === '1') return;
    badge.textContent = text;
    badge.style.color = isError ? ERROR_COLOR : '';
  }

  // 需求2：badge 一旦被加上「實際留言數」就鎖定，之後的 scan/mutation 都不會再更新它，
  // 避免因為 MutationObserver 偵測到自己寫入 DOM 而不斷觸發重新渲染、造成閃爍。
  function renderCountBadge(anchor, count, diff) {
    const badge = getOrCreateBadge(anchor);
    if (badge.dataset.noveliaLocked === '1') return;
    writeCountBadge(badge, count, diff);
    badge.dataset.noveliaLocked = '1';
  }

  // 供手動按下🔄按鈕時使用：不受鎖定限制，直接覆寫成最新結果
  function forceRenderCountBadge(anchor, count, diff) {
    const badge = getOrCreateBadge(anchor);
    writeCountBadge(badge, count, diff);
    badge.dataset.noveliaLocked = '1';
  }

  function writeCountBadge(badge, count, diff) {
    badge.style.color = '';
    badge.textContent = '';
    badge.appendChild(document.createTextNode(`${ICON} ${count}`));
    if (diff > 0) {
      badge.appendChild(document.createTextNode(' '));
      const incSpan = document.createElement('span');
      incSpan.className = 'novelia-comment-diff';
      incSpan.style.color = INCREMENT_COLOR;
      incSpan.textContent = `(+${diff})`;
      badge.appendChild(incSpan);
    }
  }

  function collectPendingAnchors() {
    const anchors = document.querySelectorAll(`a[href]:not([data-novelia-comment-tracked])`);
    const groups = new Map();

    anchors.forEach((a) => {
      const novel = parseNovelPath(a);
      if (!novel) return;

      a.dataset['noveliaCommentTracked'] = '1';

      const key = `${novel.source}/${novel.id}`;
      if (!groups.has(key)) {
        groups.set(key, { source: novel.source, id: novel.id, anchors: [] });
      }
      groups.get(key).anchors.push(a);

      const stored = getStoredEntry(novel.source, novel.id);
      const result = buildResultFromEntry(stored);
      if (result) {
        renderCountBadge(a, result.count, result.diff);
      } else {
        renderPlainBadge(a, `${ICON} …`);
      }
    });

    return Array.from(groups.values());
  }

  async function processGroup(group, { isInitial = false } = {}) {
    await limiter(async () => {
      try {
        const result = await getCommentCount(group.source, group.id, { isInitial });
        if (!result) return;
        group.anchors.forEach((a) => renderCountBadge(a, result.count, result.diff));
      } catch (err) {
        group.anchors.forEach((a) => renderPlainBadge(a, `${ICON} ?`, { isError: true }));
        console.error(
          '[novelia-comments] 處理失敗:',
          `${group.source}/${group.id}`,
          err
        );
      }
    });
  }

  // ===================== 需求3：h1 旁的手動更新按鈕 =====================
  // 注意：不要用 replaceWith/包一層 wrapper 去移動 h1 本身。
  // 這個網站是 SPA（框架會重新渲染），若我們把 h1 移出原本的位置、包進自己建立的容器，
  // 框架下次重新渲染該區塊時很容易整個丟掉我們塞的結構（甚至可能因為 DOM 結構跟框架內部
  // 紀錄的不一致而在下一輪 re-render 直接把新的 h1 蓋掉我們的包裹層），造成按鈕「看起來沒被注入」。
  // 改成單純在 h1 後面插入兄弟節點，不動 h1 本身，最穩定也最不易被框架清掉；
  // 就算真的被清掉，下次 scan() 偵測到不存在時也會自動補回。

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
    const nextText = result ? `${ICON} ${result.count}` : `${ICON} …`;
    const nextDiff = result ? result.diff : 0;
    // 避免沒必要的 DOM 重寫（減少 mutation，也避免視覺閃爍）
    if (badge.dataset.noveliaRenderedText === `${nextText}|${nextDiff}`) return;
    badge.dataset.noveliaRenderedText = `${nextText}|${nextDiff}`;

    badge.textContent = '';
    badge.appendChild(document.createTextNode(nextText));
    if (nextDiff > 0) {
      badge.appendChild(document.createTextNode(' '));
      const inc = document.createElement('span');
      inc.style.color = INCREMENT_COLOR;
      inc.textContent = `(+${nextDiff})`;
      badge.appendChild(inc);
    }
  }

  function createUpdateButton(source, id, key, badge) {
    const btn = document.createElement('button');
    btn.className = 'novelia-update-button';
    btn.dataset.noveliaNovelKey = key;
    btn.type = 'button';
    btn.textContent = UPDATE_BUTTON_ICON + ' 更新';
    btn.title = '手動更新留言數（會重置 10 分鐘計時器）';
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      console.log(`[novelia-comments] 手動更新開始: ${source}/${id}`);
      btn.disabled = true;
      btn.textContent = '⏳ 更新中';
      try {
        const result = await getCommentCount(source, id, { force: true });
        if (result) {
          console.log(`[novelia-comments] 手動更新成功: ${source}/${id}, 留言數: ${result.count} (+${result.diff})`);
          // 強制更新是使用者主動觸發的，因此直接覆寫（忽略去重判斷）
          delete badge.dataset.noveliaRenderedText;
          renderH1Badge(badge, result.entry);
          // 同步更新頁面上其他指向同一小說的連結標註（若有）
          document.querySelectorAll('a[href][data-novelia-comment-tracked]').forEach((a) => {
            const n = parseNovelPath(a);
            if (n && n.source === source && n.id === id) {
              forceRenderCountBadge(a, result.count, result.diff);
            }
          });
        }
        btn.textContent = UPDATE_BUTTON_ICON + ' 更新';
      } catch (e) {
        console.error('[novelia-comments] 手動更新失敗:', e);
        btn.textContent = '⚠️';
        setTimeout(() => {
          btn.textContent = UPDATE_BUTTON_ICON;
        }, 1500);
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  // 需求修正：頁面上可能不只一個 h1（例如站台 header 也用 h1），
  // 為了確保「小說標題旁」一定會有按鈕，改成對每一個 h1 都各自處理注入，
  // 而不是只取 document.querySelector('h1') 抓到的第一個。
  //
  // 更改：不再區分「沿用既有按鈕」與「建立新按鈕」兩條分支各自 return，
  // 而是統一流程 —— 直接取得所有 h1，每個 h1 先確保按鈕/badge 存在（沒有就建立、
  // key 不對就換成新的），最後一律呼叫 renderH1Badge 更新內容，
  // 讓「所有」符合條件的 h1 都會被更新到，而不是每個 h1 走各自不同的更新路徑。
  function injectUpdateButtonsForCurrentNovel() {
    const novel = matchNovelPath(location.pathname);
    if (!novel) return;
    const h1s = document.querySelectorAll('h1');
    if (!h1s.length) return; // 內容可能還沒渲染完成，下一次 scan 會再試

    const key = `${novel.source}/${novel.id}`;
    const stored = getStoredEntry(novel.source, novel.id);

    h1s.forEach((h1) => {
      let btn = h1.nextElementSibling;
      const isOurButton = btn && btn.classList && btn.classList.contains('novelia-update-button');

      if (isOurButton && btn.dataset.noveliaNovelKey !== key) {
        // 小說變了（SPA 換頁）：清掉這個 h1 自己的舊按鈕/badge，不動其他 h1
        const staleBadge = btn.nextElementSibling;
        btn.remove();
        if (staleBadge && staleBadge.classList && staleBadge.classList.contains('novelia-h1-comment-badge')) {
          staleBadge.remove();
        }
        btn = null;
      }

      let badge = isOurButton && btn ? btn.nextElementSibling : null;
      if (!btn) {
        badge = createH1Badge(key);
        btn = createUpdateButton(novel.source, novel.id, key, badge);
        h1.insertAdjacentElement('afterend', btn);
        btn.insertAdjacentElement('afterend', badge);
      }

      // 不論是沿用既有的還是剛建立的，一律更新 badge 內容，確保所有 h1 都拿到最新資料
      if (badge && badge.classList && badge.classList.contains('novelia-h1-comment-badge')) {
        renderH1Badge(badge, stored);
      }
    });
  }
  // =======================================================

  // ===================== 清單型頁面的批次更新按鈕 =====================
  // 適用於像「我的收藏」這種列表頁：頁面上的 h1 不對應單一小說，
  // 而是同時列出很多本小說連結。這裡在 h1 右邊加一顆按鈕，
  // 按下去會對「目前頁面上所有已追蹤到的小說連結」強制重新請求並更新 localStorage，
  // 同時重置各自的 10 分鐘計時器，而不是只更新單一小說。
  function createBulkUpdateButton() {
    const btn = document.createElement('button');
    btn.className = BULK_UPDATE_BUTTON_CLASS;
    btn.type = 'button';
    btn.textContent = UPDATE_BUTTON_ICON + ' 批次更新';
    btn.title = '手動更新本頁所有留言數（會重置各自的 10 分鐘計時器）';
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      console.log('[novelia-comments] 批次更新開始');
      btn.disabled = true;
      btn.textContent = '⏳ 批次更新中';
      try {
        const anchors = document.querySelectorAll('a[href][data-novelia-comment-tracked]');
        console.log(`[novelia-comments] 找到 ${anchors.length} 個已追蹤的小說連結`);
        const groups = new Map();
        anchors.forEach((a) => {
          const novel = parseNovelPath(a);
          if (!novel) return;
          const key = `${novel.source}/${novel.id}`;
          if (!groups.has(key)) {
            groups.set(key, { source: novel.source, id: novel.id, anchors: [] });
          }
          groups.get(key).anchors.push(a);
        });

        console.log(`[novelia-comments] 預計更新 ${groups.size} 部小說`);
        if (groups.size === 0) {
          console.log('[novelia-comments] 未發現可更新的小說');
        }

        await Promise.all(
          Array.from(groups.values()).map((group) =>
            limiter(async () => {
              try {
                // force: true → 直接觸發真正的 request，寫回 localStorage 並重置 updated_at 計時器
                const result = await getCommentCount(group.source, group.id, { force: true });
                if (result) {
                  console.log(`[novelia-comments] 批次更新成功: ${group.source}/${group.id}, 留言數: ${result.count} (+${result.diff})`);
                  group.anchors.forEach((a) => forceRenderCountBadge(a, result.count, result.diff));
                }
              } catch (err) {
                group.anchors.forEach((a) => renderPlainBadge(a, `${ICON} ?`, { isError: true }));
                console.error(
                  '[novelia-comments] 批次更新失敗:',
                  `${group.source}/${group.id}`,
                  err
                );
              }
            })
          )
        );
        btn.textContent = UPDATE_BUTTON_ICON + ' 批次更新';
      } catch (e) {
        console.error('[novelia-comments] 批次更新失敗:', e);
        btn.textContent = '⚠️ 失敗';
        setTimeout(() => {
          btn.textContent = UPDATE_BUTTON_ICON + ' 批次更新';
        }, 1500);
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  // 只在「不是單一小說頁」時才加這顆批次按鈕（單一小說頁已經有 injectUpdateButtonsForCurrentNovel 處理）。
  // 按鈕加在 h1 樹下（作為 h1 的子節點），而不是 h1 後面的兄弟節點。
  // 檢查是否已加過按鈕時，直接在該 h1 底下用 CSS selector 找該按鈕的獨特 class，
  // 找到就跳過、找不到就補上，避免每次 scan() 都重複插入。
  function injectBulkUpdateButtonsForListPages() {
    if (matchNovelPath(location.pathname)) return;
    const h1s = document.querySelectorAll('h1');
    if (!h1s.length) return;

    h1s.forEach((h1) => {
      const existing = h1.querySelector(`:scope > .${BULK_UPDATE_BUTTON_CLASS}`);
      if (existing) return;
      const btn = createBulkUpdateButton();
      h1.appendChild(btn);
    });
  }
  // =======================================================

  function scan({ isInitial = false } = {}) {
    const groups = collectPendingAnchors();
    groups.forEach((g) => processGroup(g, { isInitial }));
    injectUpdateButtonsForCurrentNovel();
    injectBulkUpdateButtonsForListPages();
  }

  let scanTimer = null;
  function scheduleScan({ isInitial = false } = {}) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan({ isInitial }), 200);
  }

  // 判斷某個節點是否屬於本腳本自己注入/管理的元素（class 以 novelia- 開頭）
  function isNoveliaOwnNode(node) {
    if (!node) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      return isNoveliaOwnNode(node.parentElement);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (typeof node.className === 'string' && /(^|\s)novelia-/.test(node.className)) return true;
    return !!(node.closest && node.closest('[class*="novelia-"]'));
  }

  // 一筆 mutation 是否「完全」是本腳本自己造成的（target 本身或所有新增/刪除節點都屬於 novelia- 元素）
  function isSelfCausedMutation(mutation) {
    if (isNoveliaOwnNode(mutation.target)) return true;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    if (nodes.length === 0) return false;
    return nodes.every((n) => isNoveliaOwnNode(n));
  }

  function observeDomChanges() {
    const observer = new MutationObserver((mutations) => {
      const hasExternalChange = mutations.some(
        (m) => m.addedNodes && m.addedNodes.length > 0 && !isSelfCausedMutation(m)
      );
      if (hasExternalChange) {
        scheduleScan({ isInitial: false });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function observeRouteChanges() {
    const notify = () => {
      scheduleScan({ isInitial: false });
      setTimeout(() => scan({ isInitial: false }), 500);
    };

    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      notify();
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      notify();
      return result;
    };

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
    config: {
      COUNT_REPLIES,
      CACHE_REFRESH_INTERVAL_MS,
    },
  };

  main();
})();