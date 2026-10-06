// ==UserScript==
// @name         Novelia 體驗優化 綑綁包
// @namespace    novelia-enhanced
// @version      1.5.2
// @description  整合 Novelia 多種功能，支援自訂開關。包含評論數追蹤、分享按鈕、源站跳轉、評論回覆摺疊及預設摺疊圖片。
// @updateURL    https://raw.githubusercontent.com/Paracehll/Novelia-Additions/refs/heads/master/novelia_qol_bundle.js
// @downloadURL  https://raw.githubusercontent.com/Paracehll/Novelia-Additions/refs/heads/master/novelia_qol_bundle.js
// @match        *://n.novelia.cc/*
// @match        *://forum.novelia.cc/*
// @match        *://syosetu.org/*
// @match        *://syosetu.com/*
// @match        *://yomou.syosetu.com/*
// @match        *://books.fishhawk.top/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const FEATURES = [
        { id: 'comment_count', name: 'Web 評論數追蹤', default: true },
        // { id: 'forum_search', name: '論壇搜尋增強', default: true },
        { id: 'share_btn', name: '小說分享按鈕', default: true },
        { id: 'source_link', name: '源站跳轉按鈕', default: true },
        // { id: 'thread_footer', name: '編輯頁面固定頁尾', default: true },
        { id: 'collapse_replies', name: '摺疊評論區回覆', default: true },
        { id: 'collapse_images', name: '預設摺疊圖片', default: true }
    ];

    const config = {};

    function initMenu() {
        FEATURES.forEach(feature => {
            const enabled = GM_getValue(`feature_${feature.id}`, feature.default);
            config[feature.id] = enabled;

            const label = `${enabled ? '✅' : '❌'} ${feature.name}`;
            GM_registerMenuCommand(label, () => {
                GM_setValue(`feature_${feature.id}`, !enabled);
                location.reload();
            });
        });
    }

    const Modules = {};

    function runModules() {
        FEATURES.forEach(feature => {
            if (config[feature.id] && Modules[feature.id]) {
                try {
                    console.log(`[Novelia Bundle] Initializing ${feature.name}...`);
                    Modules[feature.id].init();
                } catch (error) {
                    console.error(`[Novelia Bundle] Failed to initialize ${feature.name}:`, error);
                }
            }
        });
    }

    initMenu();

    function injectGlobalStyles() {
        if (document.getElementById('novelia-bundle-global-styles')) return;
        const styleElement = document.createElement('style');
        styleElement.id = 'novelia-bundle-global-styles';
        styleElement.textContent = `
            .novelia-bundle-btn {
                font-weight: 400;
                line-height: 1;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                cursor: pointer;
                text-align: center;
                border-radius: 3px;
                padding: 0 10px;
                height: 28px;
                font-size: 13px;
                transition: color .3s, background-color .3s, border-color .3s, opacity .3s;
                white-space: nowrap;
                vertical-align: middle;
                box-sizing: border-box;
                background-color: transparent;
                border: 1px solid rgba(0, 0, 0, 0.2);
                color: #333;
                gap: 6px;
                margin-left: 10px;
            }
            .novelia-bundle-btn:hover {
                background-color: rgba(99, 226, 183, 0.1);
                border-color: #63e2b7;
                color: #63e2b7;
            }
            .novelia-bundle-btn:disabled {
                cursor: not-allowed;
                opacity: 0.5;
            }
            .novelia-bundle-btn svg {
                width: 14px;
                height: 14px;
                fill: currentColor;
            }
            @media (prefers-color-scheme: dark) {
                .novelia-bundle-btn {
                    border-color: rgba(255, 255, 255, 0.24);
                    color: rgba(255, 255, 255, 0.82);
                }
            }
            /* Dark mode override for the site if it uses a specific class on body/html */
            body.dark .novelia-bundle-btn,
            .n-config-provider .novelia-bundle-btn {
                border-color: rgba(255, 255, 255, 0.24);
                color: rgba(255, 255, 255, 0.82);
            }
        `;
        document.head.appendChild(styleElement);
    }

    injectGlobalStyles();

    function setupRouterObserver() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function(...args) {
            const result = originalPushState.apply(this, args);
            window.dispatchEvent(new Event("tm-locationchange"));
            return result;
        };

        history.replaceState = function(...args) {
            const result = originalReplaceState.apply(this, args);
            window.dispatchEvent(new Event("tm-locationchange"));
            return result;
        };

        window.addEventListener('popstate', () => {
            window.dispatchEvent(new Event("tm-locationchange"));
        });
    }

    setupRouterObserver();

    // ==========================================
    // 1. Web 評論數追蹤 (Modules.comment_count)
    // ==========================================
    Modules.comment_count = {
        init: function() {
            if (location.hostname !== 'n.novelia.cc') return;

            const PAGE_SIZE = 100;
            const CONCURRENCY_LIMIT = 3;
            const PAGE_FETCH_CONCURRENCY = 3;
            const COMMENT_ICON = '💬';
            const BADGE_ALIGN_ITEMS = 'auto';
            const INCREMENT_COLOR = '#63e2b7';
            const UPDATE_BUTTON_LABEL = '批次更新';
            const COUNT_REPLIES = true;
            const CACHE_REFRESH_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

            const SVG_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="23 4 23 10 18 10"></polyline><polyline points="1 20 1 14 6 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
            const SVG_BULK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect></svg>';

            const styleElement = document.createElement('style');
            styleElement.textContent = `
                .novelia-comment-badge, .novelia-h1-comment-badge {
                  opacity: 0.85;
                  white-space: nowrap;
                }
                .novelia-comment-badge {
                  font-size: 12px;
                  flex: 0 0 auto;
                  margin-right: 8px;
                }
                .novelia-h1-comment-badge {
                  font-size: 14px;
                  margin-left: 8px;
                }
            `;
            document.head.appendChild(styleElement);

            function getFullStorage() {
                try {
                    const rawData = localStorage.getItem('novelia_comment_count');
                    return rawData ? JSON.parse(rawData) : {};
                } catch (error) {
                    return {};
                }
            }

            function saveFullStorage(data) {
                try {
                    localStorage.setItem('novelia_comment_count', JSON.stringify(data));
                } catch (error) {
                    console.error('[novelia-comments] localStorage 寫入失敗:', error);
                }
            }

            function getStoredEntry(source, id) {
                const storage = getFullStorage();
                return (storage[source] && storage[source][id]) || null;
            }

            function saveCache(source, id, counts, previous) {
                const { comment_count, all_comment_count } = counts;
                const storage = getFullStorage();
                if (!storage[source]) storage[source] = {};
                storage[source][id] = {
                    prev: previous ? (previous.now ?? previous.comment_count) : comment_count,
                    prev_all: previous ? (previous.now_all ?? previous.all_comment_count) : all_comment_count,
                    now: comment_count,
                    now_all: all_comment_count,
                    update: Date.now(),
                };
                saveFullStorage(storage);
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

            async function fetchCommentPage(site, page, pageSize = PAGE_SIZE) {
                const p = Math.max(1, page);
                const ps = Math.max(1, pageSize);
                const url = `https://forum.novelia.cc/api/v1/external/comment/novel/${encodeURIComponent(site)}?page=${p}&page_size=${ps}`;
                const response = await fetch(url, { credentials: 'same-origin' });
                if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
                return response.json();
            }

            function countItemWithReplies(item) {
                let total = 1;
                const repliesArray = item ? item['replies'] : null;
                if (Array.isArray(repliesArray) && repliesArray.length > 0) {
                    for (const reply of repliesArray) total += countItemWithReplies(reply);
                } else if (item && typeof item['replyCount'] === 'number') {
                    total += item['replyCount'];
                }
                return total;
            }

            async function fetchAllPagesForReplies(site, totalPages, alreadyFetched) {
                const results = new Array(totalPages).fill(null);
                results[0] = alreadyFetched[0];
                if (alreadyFetched.length > 1) results[totalPages - 1] = alreadyFetched[1];
                const missingPages = [];
                for (let index = 0; index < totalPages; index++) if (!results[index]) missingPages.push(index);
                const pageLimiter = createConcurrencyLimiter(PAGE_FETCH_CONCURRENCY);
                await Promise.all(missingPages.map((pageIndex) => pageLimiter(async () => { results[pageIndex] = await fetchCommentPage(site, pageIndex + 1); })));
                return results;
            }

            async function fetchCounts(source, id) {
                const site = source === 'wenku' ? `wenku-${id}` : `web-${source}-${id}`;
                const firstPage = await fetchCommentPage(site, 1, 1);
                if (typeof firstPage.total === 'number') {
                    return { topCount: firstPage.total, allCount: firstPage.total };
                }
                const fullFirstPage = (PAGE_SIZE === 1) ? firstPage : await fetchCommentPage(site, 1, PAGE_SIZE);
                const totalPages = fullFirstPage.pageNumber || fullFirstPage.totalPages || 1;
                const items = fullFirstPage.items || fullFirstPage.data || [];
                let topCount;
                const alreadyFetched = [fullFirstPage];
                if (totalPages <= 1) {
                    topCount = items.length;
                } else {
                    const lastPage = await fetchCommentPage(site, totalPages, PAGE_SIZE);
                    const lastItems = lastPage.items || lastPage.data || [];
                    topCount = (totalPages - 1) * PAGE_SIZE + lastItems.length;
                    alreadyFetched.push(lastPage);
                }
                if (!COUNT_REPLIES) return { topCount, allCount: topCount };
                const pages = totalPages <= 1 ? [fullFirstPage] : await fetchAllPagesForReplies(site, totalPages, alreadyFetched);
                let allCount = 0;
                for (const page of pages) if (page) for (const item of (page.items || page.data || [])) allCount += countItemWithReplies(item);
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
                const isNewInstall = !localStorage.getItem('novelia_comment_count');
                if ((isInitial || isNewInstall) && isStale) return updateCommentCount(source, id);
                return buildResultFromEntry(cached);
            }

            function createConcurrencyLimiter(limit) {
                let activeCount = 0;
                const taskQueue = [];
                const runNextTask = () => {
                    if (activeCount >= limit || taskQueue.length === 0) return;
                    activeCount++;
                    const { task, resolve, reject } = taskQueue.shift();
                    task().then(resolve, reject).finally(() => { activeCount--; runNextTask(); });
                };
                return (task) => new Promise((resolve, reject) => { taskQueue.push({ task, resolve, reject }); runNextTask(); });
            }
            const taskLimiter = createConcurrencyLimiter(CONCURRENCY_LIMIT);

            function matchNovelPath(pathname) {
                const pathMatch = pathname.match(/^\/novel\/([^\/?#]+)\/([^\/?#]+)\/?$/i);
                if (pathMatch) return { source: pathMatch[1], id: pathMatch[2] };
                const wenkuMatch = pathname.match(/^\/wenku\/([^\/?#]+)\/?$/i);
                if (wenkuMatch) return { source: 'wenku', id: wenkuMatch[1] };
                return null;
            }

            function isAllowedPage() {
                const path = window.__noveliaMockPath || location.pathname;
                if (/^\/novel\/[^\/]+\/[^\/]+\/[^\/]+/i.test(path)) return false;
                return path === '/' ||
                path.startsWith('/novel') ||
                path.startsWith('/favorite') ||
                path.startsWith('/wenku') ||
                path.startsWith('/read-history');
            }

            function parseNovelPath(anchorElement) {
                try {
                    return matchNovelPath(new URL(anchorElement.getAttribute('href'), location.origin).pathname);
                } catch (error) {
                    return null;
                }
            }

            function ensureWrapper(targetElement) {
                const existingWrapper = targetElement.closest('.novelia-comment-wrapper, .novelia-item-wrapper');
                if (existingWrapper) return existingWrapper;
                const wrapperElement = document.createElement('span');
                wrapperElement.className = 'novelia-comment-wrapper';
                wrapperElement.style.alignItems = BADGE_ALIGN_ITEMS;
                wrapperElement.style.gap = '6px';
                targetElement.replaceWith(wrapperElement);
                wrapperElement.appendChild(targetElement);
                return wrapperElement;
            }

            function createNewBadge(count, diff) {
                const badgeElement = document.createElement('span');
                badgeElement.className = 'novelia-comment-badge';
                badgeElement.dataset.noveliaRenderedText = `${count}|${diff}`;

                badgeElement.appendChild(document.createTextNode(`${COMMENT_ICON} ${count}`));
                if (diff > 0) {
                    const incrementSpan = document.createElement('span');
                    incrementSpan.className = 'novelia-comment-diff';
                    incrementSpan.style.color = INCREMENT_COLOR;
                    incrementSpan.textContent = ` (+${diff})`;
                    badgeElement.appendChild(incrementSpan);
                }
                return badgeElement;
            }

            function renderPlainBadge(targetElement, text, { isError = false } = {}) {
                const wrapperElement = ensureWrapper(targetElement);
                let badgeElement = wrapperElement.querySelector(':scope > .novelia-comment-badge');
                if (badgeElement && badgeElement.dataset.noveliaLocked === '1') return;
                if (!badgeElement) {
                    badgeElement = document.createElement('span');
                    badgeElement.className = 'novelia-comment-badge';
                    const shareButton = wrapperElement.querySelector(':scope > .novelia-copy-btn');
                    if (shareButton) shareButton.after(badgeElement);
                    else wrapperElement.prepend(badgeElement);
                }
                badgeElement.textContent = text;
                badgeElement.style.color = isError ? '#e06c75' : '';
                delete badgeElement.dataset.noveliaRenderedText;
            }

            function renderCountBadge(targetElement, count, diff) {
                const wrapperElement = ensureWrapper(targetElement);
                const existingBadge = wrapperElement.querySelector(':scope > .novelia-comment-badge');
                if (existingBadge && existingBadge.dataset.noveliaLocked === '1') return;
                updateBadgeInWrapper(wrapperElement, count, diff);
            }

            function forceRenderCountBadge(targetElement, count, diff) {
                const wrapperElement = ensureWrapper(targetElement);
                updateBadgeInWrapper(wrapperElement, count, diff);
            }

            function updateBadgeInWrapper(wrapperElement, count, diff) {
                const key = `${count}|${diff}`;
                const existingBadge = wrapperElement.querySelector(':scope > .novelia-comment-badge');
                if (existingBadge && existingBadge.dataset.noveliaRenderedText === key) return;

                if (existingBadge) existingBadge.remove();

                const newBadge = createNewBadge(count, diff);
                newBadge.dataset.noveliaLocked = '1';

                const shareButton = wrapperElement.querySelector(':scope > .novelia-copy-btn');
                if (shareButton) shareButton.after(newBadge);
                else wrapperElement.prepend(newBadge);
            }

            function getListTarget(anchorElement) {
                const flexParent = anchorElement.closest('.n-flex') || anchorElement.closest('.n-grid > div');
                if (!flexParent) return anchorElement;
                const targets = flexParent.querySelectorAll(':scope > span, :scope > div.text-2line');
                return targets[0] || targets[1] || anchorElement;
            }

            function collectPendingAnchors() {
                const anchors = document.querySelectorAll(`a[href]:not([data-novelia-comment-tracked])`);
                const groupsMap = new Map();
                anchors.forEach((anchorElement) => {
                    if (anchorElement.closest('.n-drawer')) return;
                    const novelInfo = parseNovelPath(anchorElement);
                    if (!novelInfo) return;
                    anchorElement.dataset['noveliaCommentTracked'] = '1';
                    const key = `${novelInfo.source}/${novelInfo.id}`;
                    if (!groupsMap.has(key)) groupsMap.set(key, { source: novelInfo.source, id: novelInfo.id, targets: [] });
                    const targetElement = getListTarget(anchorElement);
                    groupsMap.get(key).targets.push(targetElement);
                    const storedEntry = getStoredEntry(novelInfo.source, novelInfo.id);
                    const result = buildResultFromEntry(storedEntry);
                    if (result) renderCountBadge(targetElement, result.count, result.diff);
                    else renderPlainBadge(targetElement, `${COMMENT_ICON} …`);
                });
                return Array.from(groupsMap.values());
            }

            async function processGroup(novelGroup, { isInitial = false } = {}) {
                if (!isAllowedPage()) return;
                await taskLimiter(async () => {
                    try {
                        const result = await getCommentCount(novelGroup.source, novelGroup.id, { isInitial });
                        if (!result) return;
                        novelGroup.targets.forEach((targetElement) => renderCountBadge(targetElement, result.count, result.diff));
                    } catch (error) {
                        novelGroup.targets.forEach((targetElement) => renderPlainBadge(targetElement, `${COMMENT_ICON} ?`, { isError: true }));
                        console.error('[novelia-comments] 處理失敗:', `${novelGroup.source}/${novelGroup.id}`, error);
                    }
                });
            }

            function createH1Badge(novelKey) {
                const badgeElement = document.createElement('span');
                badgeElement.className = 'novelia-h1-comment-badge';
                badgeElement.dataset.noveliaNovelKey = novelKey;
                return badgeElement;
            }

            function renderH1Badge(badgeElement, entry) {
                const result = buildResultFromEntry(entry);
                const count = result ? result.count : '…';
                const diff = result ? result.diff : 0;
                const key = `${count}|${diff}`;

                if (badgeElement.dataset.noveliaRenderedText === key) return;

                badgeElement.dataset.noveliaRenderedText = key;
                badgeElement.textContent = '';
                badgeElement.appendChild(document.createTextNode(`${COMMENT_ICON} ${count}`));
                if (diff > 0) {
                    const incrementSpan = document.createElement('span');
                    incrementSpan.style.color = INCREMENT_COLOR;
                    incrementSpan.textContent = ` (+${diff})`;
                    badgeElement.appendChild(incrementSpan);
                }
            }

            function createUpdateButton(source, id, novelKey, badgeElement) {
                const buttonElement = document.createElement('button');
                buttonElement.className = 'novelia-bundle-btn novelia-update-button';
                buttonElement.innerHTML = `${SVG_REFRESH}<span>刷新</span>`;
                buttonElement.dataset.noveliaNovelKey = novelKey;
                buttonElement.title = '手動更新留言數';
                buttonElement.addEventListener('click', async () => {
                    if (buttonElement.disabled) return;
                    buttonElement.disabled = true;
                    const originalContent = buttonElement.innerHTML;
                    buttonElement.innerHTML = `<span>⏳ 刷新中</span>`;
                    try {
                        const result = await getCommentCount(source, id, { force: true });
                        if (result) {
                            delete badgeElement.dataset.noveliaRenderedText;
                            renderH1Badge(badgeElement, result.entry);
                            injectH2CommentCount();
                            document.querySelectorAll('a[href][data-novelia-comment-tracked]').forEach((anchor) => {
                                const novelInfo = parseNovelPath(anchor);
                                if (novelInfo && novelInfo.source === source && novelInfo.id === id) {
                                    forceRenderCountBadge(getListTarget(anchor), result.count, result.diff);
                                }
                            });
                        }
                        buttonElement.innerHTML = originalContent;
                    } catch (error) {
                        buttonElement.innerHTML = '<span>⚠️</span>';
                        setTimeout(() => { buttonElement.innerHTML = originalContent; }, 1500);
                    } finally {
                        buttonElement.disabled = false;
                    }
                });
                return buttonElement;
            }

            function injectUpdateButtonsForCurrentNovel() {
                if (!isAllowedPage()) return;
                const novelInfo = matchNovelPath(location.pathname);
                if (!novelInfo) return;
                const h1Elements = document.querySelectorAll('h1');
                if (!h1Elements.length) return;
                const novelKey = `${novelInfo.source}/${novelInfo.id}`;
                const storedEntry = getStoredEntry(novelInfo.source, novelInfo.id);
                h1Elements.forEach((h1Element) => {
                    if (h1Element.closest('.n-drawer')) return;
                    Object.assign(h1Element.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap' });
                    let updateButton = h1Element.querySelector('.novelia-update-button');
                    if (updateButton && updateButton.dataset.noveliaNovelKey !== novelKey) {
                        const staleBadge = h1Element.querySelector('.novelia-h1-comment-badge');
                        updateButton.remove();
                        if (staleBadge) staleBadge.remove();
                        updateButton = null;
                    }
                    let badgeElement = updateButton ? h1Element.querySelector('.novelia-h1-comment-badge') : null;
                    if (!updateButton) {
                        badgeElement = createH1Badge(novelKey);
                        updateButton = createUpdateButton(novelInfo.source, novelInfo.id, novelKey, badgeElement);
                        const lastHeaderButton = Array.from(h1Element.querySelectorAll('.novelia-header-btn')).pop();
                        if (lastHeaderButton) { lastHeaderButton.after(updateButton); updateButton.after(badgeElement); }
                        else { h1Element.prepend(badgeElement); h1Element.prepend(updateButton); }
                    }
                    if (badgeElement) renderH1Badge(badgeElement, storedEntry);
                });
            }

            function injectH2CommentCount() {
                if (!isAllowedPage()) return;
                const novelInfo = matchNovelPath(location.pathname);
                if (!novelInfo) return;
                const h2Elements = Array.from(document.querySelectorAll('h2')).filter((h2) => h2.textContent.trim() === '评论');
                if (!h2Elements.length) return;
                const novelKey = `${novelInfo.source}/${novelInfo.id}`;
                const storedEntry = getStoredEntry(novelInfo.source, novelInfo.id);
                h2Elements.forEach((h2Element) => {
                    if (h2Element.closest('.n-drawer')) return;
                    Object.assign(h2Element.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap' });
                    let badgeElement = h2Element.querySelector('.novelia-h1-comment-badge');
                    if (!badgeElement) {
                        badgeElement = createH1Badge(novelKey);
                        h2Element.appendChild(badgeElement);
                    }
                    if (badgeElement) renderH1Badge(badgeElement, storedEntry);
                });
            }

            function createBulkUpdateButton() {
                const buttonElement = document.createElement('button');
                buttonElement.className = 'novelia-bundle-btn novelia-bulk-update-button';
                buttonElement.innerHTML = `${SVG_BULK}<span>${UPDATE_BUTTON_LABEL}</span>`;
                buttonElement.title = '手動更新本頁所有留言數';
                buttonElement.addEventListener('click', async () => {
                    if (buttonElement.disabled) return;
                    buttonElement.disabled = true;
                    const originalContent = buttonElement.innerHTML;
                    buttonElement.innerHTML = '<span>⏳ 批次更新中</span>';
                    try {
                        const anchors = document.querySelectorAll('a[href][data-novelia-comment-tracked]');
                        const groupsMap = new Map();
                        anchors.forEach((anchorElement) => {
                            const novelInfo = parseNovelPath(anchorElement);
                            if (!novelInfo) return;
                            const key = `${novelInfo.source}/${novelInfo.id}`;
                            if (!groupsMap.has(key)) groupsMap.set(key, { source: novelInfo.source, id: novelInfo.id, targets: new Set() });
                            groupsMap.get(key).targets.add(getListTarget(anchorElement));
                        });
                        await Promise.all(Array.from(groupsMap.values()).map((novelGroup) => taskLimiter(async () => {
                            try {
                                const result = await getCommentCount(novelGroup.source, novelGroup.id, { force: true });
                                if (result) novelGroup.targets.forEach((targetElement) => forceRenderCountBadge(targetElement, result.count, result.diff));
                            } catch (error) {
                                novelGroup.targets.forEach((targetElement) => renderPlainBadge(targetElement, `${COMMENT_ICON} ?`, { isError: true }));
                            }
                        })));
                        buttonElement.innerHTML = originalContent;
                    } catch (error) {
                        buttonElement.innerHTML = '<span>⚠️ 失敗</span>';
                        setTimeout(() => { buttonElement.innerHTML = originalContent; }, 1500);
                    } finally {
                        buttonElement.disabled = false;
                    }
                });
                return buttonElement;
            }

            function injectBulkUpdateButtons() {
                const h1Element = document.querySelector('h1');
                if (!h1Element || h1Element.closest('.n-drawer') || h1Element.querySelector(':scope > .novelia-bulk-update-button')) return;

                Object.assign(h1Element.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap' });
                const bulkButton = createBulkUpdateButton();
                const lastHeaderButton = Array.from(h1Element.querySelectorAll('.novelia-header-btn')).pop();
                if (lastHeaderButton) lastHeaderButton.after(bulkButton);
                else h1Element.appendChild(bulkButton);
            }

            function scanPage({ isInitial = false } = {}) {
                if (!isAllowedPage()) return;
                const novelGroups = collectPendingAnchors();
                novelGroups.forEach((group) => processGroup(group, { isInitial }));
                injectUpdateButtonsForCurrentNovel();
                injectH2CommentCount();
                injectBulkUpdateButtons();
            }

            let scanTimeoutTimer = null;
            function schedulePageScan({ isInitial = false } = {}) {
                clearTimeout(scanTimeoutTimer);
                scanTimeoutTimer = setTimeout(() => scanPage({ isInitial }), 200);
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
                return nodes.length > 0 && nodes.every((node) => isNoveliaOwnNode(node));
            }

            function observeDomChanges() {
                const observer = new MutationObserver((mutations) => {
                    if (!isAllowedPage()) return;
                    if (mutations.some((mutation) => mutation.addedNodes && mutation.addedNodes.length > 0 && !isSelfCausedMutation(mutation))) schedulePageScan({ isInitial: false });
                });
                observer.observe(document.body, { childList: true, subtree: true });
            }

            function main() {
                scanPage({ isInitial: true });
                observeDomChanges();
                window.addEventListener("tm-locationchange", () => {
                    schedulePageScan({ isInitial: false });
                    setTimeout(() => scanPage({ isInitial: false }), 500);
                });
            }

            main();
        }
    };

    // ==========================================
    // 2. 論壇搜尋增強 (Modules.forum_search)
    // ==========================================
    Modules.forum_search = {
        init: function() {
            if (location.hostname !== 'n.novelia.cc') return;
            if (window.top !== window.self) return;

            function main() {}

            main();
        }
    };

    // ==========================================
    // 3. 小說分享按鈕 (Modules.share_btn)
    // ==========================================
    Modules.share_btn = {
        init: function() {
            if (location.hostname !== 'n.novelia.cc') return;

            const CLEAR_CACHE_KEY = { ctrl: true, alt: false, shift: false, key: "q" };
            const VIEW_CACHE_KEY = { ctrl: true, alt: false, shift: false, key: "v" };
            const REFRESH_UI_KEY = { ctrl: false, alt: false, shift: true, key: "r" };
            const BUTTON_WIDTH = "36px";
            const ALIGNMENT_TYPE = "center";
            const SHOW_HEADER_BUTTONS_CONFIG = true;

            const CACHE_CHANGE_EVENT_NAME = "novelia-cache-change",
                COPY_BUTTON_CLASS = "novelia-copy-btn",
                TOAST_NOTIFICATION_CLASS = "novelia-toast",
                HEADER_BUTTON_CLASS = "novelia-header-btn",
                HEADER_INJECTION_MARK = "noveliaHeaderInjected",
                LIST_ITEM_SELECTOR = 'div.n-flex[role="none"]',
                LIST_WRAPPER_CLASS = "novelia-share-wrapper";

            const SVG_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="23 4 23 10 18 10"></polyline><polyline points="1 20 1 14 6 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
            const SVG_CLEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
            const SVG_VIEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';

            let linkCache = [],
                toastNotificationTimer;

            const styleElement = document.createElement("style");
            styleElement.textContent = `
                .${COPY_BUTTON_CLASS}{position:relative;overflow:hidden;margin-right:6px;padding:1px 0;width:${BUTTON_WIDTH};font-size:12px;cursor:pointer;background:transparent;border:1px solid #aaa;border-radius:4px;vertical-align:middle;opacity:.6;text-align:center;flex-shrink:0;line-height:1.4;transition:opacity .15s,background .15s,border-color .15s}
                .${COPY_BUTTON_CLASS}:hover{opacity:1;background:#eee}
                .${COPY_BUTTON_CLASS}.flashing::after{content:'';position:absolute;top:50%;left:50%;width:10px;height:10px;background:rgba(40,167,69,.4);border-radius:50%;transform:translate(-50%,-50%);animation:novelia-ripple .4s ease-out}
                @keyframes novelia-ripple{0%{width:0;height:0;opacity:1}100%{width:120px;height:120px;opacity:0}}
                .${TOAST_NOTIFICATION_CLASS}{position:fixed;top:-50px;left:50%;transform:translateX(-50%);background:rgba(51,51,51,.95);color:#fff;padding:14px 24px;border-radius:8px;font-size:14px;z-index:99999;opacity:0;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.25);transition:top .3s,opacity .3s;white-space:pre-wrap;max-width:90vw;font-family:monospace;line-height:1.5}
                .${TOAST_NOTIFICATION_CLASS}.show{top:30px;opacity:1}
                .${LIST_WRAPPER_CLASS}{display:inline-flex;align-items:center;width:auto;flex-flow:row;margin-bottom:2px;}
                .novelia-grid-wrapper{display:inline-flex;align-items:flex-start;width:100%}
            `;
            document.head.appendChild(styleElement);

            const toastElement = document.createElement("div");
            toastElement.className = TOAST_NOTIFICATION_CLASS;
            document.body.appendChild(toastElement);

            function showCopyToast(message, duration = 2200) {
                clearTimeout(toastNotificationTimer);
                toastElement.textContent = message;
                toastElement.classList.add("show");
                toastNotificationTimer = setTimeout(() => toastElement.classList.remove("show"), duration);
            }

            function writeToClipboard(text, buttonElement) {
                if (typeof GM_setClipboard === "function") {
                    GM_setClipboard(text);
                    if (buttonElement) animateCopySuccess(buttonElement);
                } else if (navigator.clipboard) {
                    navigator.clipboard.writeText(text)
                        .then(() => { if (buttonElement) animateCopySuccess(buttonElement); })
                        .catch((error) => {
                            console.error("[Novelia Share]", error);
                            if (buttonElement) {
                                buttonElement.textContent = "❌";
                                setTimeout(() => { buttonElement.textContent = "📋"; }, 1550);
                            }
                        });
                }
            }

            function animateCopySuccess(buttonElement) {
                buttonElement.textContent = "✅";
                buttonElement.style.opacity = "1";
                buttonElement.style.borderColor = "#28a745";
                setTimeout(() => {
                    buttonElement.textContent = "📋";
                    buttonElement.style.opacity = ".6";
                    buttonElement.style.borderColor = "#aaa";
                    buttonElement.classList.remove("flashing");
                }, 1500);
            }

            function dispatchCacheChangeEvent() {
                document.dispatchEvent(new CustomEvent(CACHE_CHANGE_EVENT_NAME, { detail: { cache: [...linkCache] } }));
            }

            function clearLinkCache() {
                linkCache = [];
                writeToClipboard("", null);
                dispatchCacheChangeEvent();
                showCopyToast("🧹 快取與剪貼簿已清空！");
            }

            function viewLinkCache() {
                if (linkCache.length === 0) {
                    showCopyToast("ℹ️ 當前快取中沒有任何連結。");
                } else {
                    showCopyToast(`📂 當前快取連結 (共 ${linkCache.length} 條)：\n${linkCache.join("\n")}`, 3500);
                }
            }

            function isSharePage() {
                const path = location.pathname;
                // 黑名單: n.novelia.cc/novel/*/*/*
                if (/^\/novel\/[^\/]+\/[^\/]+\/[^\/]+/i.test(path)) return false;
                // 排除 /novel/source/id 格式的小說詳情頁
                if (/^\/novel\/[^\/]+\/[^\/]+\/?$/.test(path)) return false;

                return path === '/' ||
                       path.startsWith('/novel') ||
                       path.startsWith('/favorite') ||
                       path.startsWith('/wenku') ||
                       path.startsWith('/search') ||
                       path.startsWith('/read-history');
            }

            function triggerUIRefresh() {
                removeStaleButtons(true);
                // Ensure DOM has settled before re-scanning
                setTimeout(() => {
                    performFullScan();
                    showCopyToast("🔄 已重新偵測當前頁面並重新注入按鈕！");
                }, 200);
            }

            function createCopyButton(formattedLink) {
                const buttonElement = document.createElement("button");
                buttonElement.className = COPY_BUTTON_CLASS;
                buttonElement.title = "點擊累加複製：" + formattedLink;
                buttonElement.textContent = "📋";
                if (linkCache.includes(formattedLink)) buttonElement.style.display = "none";

                document.addEventListener(CACHE_CHANGE_EVENT_NAME, (event) => {
                    buttonElement.style.display = event.detail.cache.includes(formattedLink) ? "none" : "";
                });

                buttonElement.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    buttonElement.classList.remove("flashing");
                    void buttonElement.offsetWidth;
                    buttonElement.classList.add("flashing");
                    if (linkCache.includes(formattedLink)) {
                        showCopyToast("ℹ️ 此小說連結已在快取清單中！");
                        animateCopySuccess(buttonElement);
                    } else {
                        linkCache.push(formattedLink);
                        writeToClipboard(linkCache.join("\n"), buttonElement);
                        setTimeout(dispatchCacheChangeEvent, 1500);
                    }
                });
                return buttonElement;
            }

            function injectLinkButtonsToItems(parentElement) {
                if (!isSharePage()) return;
                // For novel lists (Home, Search, Favorites)
                parentElement.querySelectorAll(LIST_ITEM_SELECTOR).forEach((itemElement) => {
                    if (itemElement.closest('.n-drawer')) return;
                    if (itemElement.querySelector(`.${COPY_BUTTON_CLASS}`)) return;

                    // Find the main novel link.
                    const anchorElement = itemElement.querySelector("a[href^='/novel/']");
                    if (!anchorElement) return;

                    // Also find the Chinese title if it exists to include in the copy format
                    const textSpanElement = itemElement.querySelector("span.n-text");
                    const titleText = textSpanElement ? textSpanElement.textContent.trim() : anchorElement.textContent.trim();
                    const linkHref = anchorElement.getAttribute("href");
                    if (!titleText || !linkHref) return;

                    const formattedLink = `[${titleText}](https://n.novelia.cc${linkHref})`;
                    const copyBtn = createCopyButton(formattedLink);

                    // Create a row wrapper for the button and anchor to keep them together
                    let wrapper = anchorElement.closest(`.${LIST_WRAPPER_CLASS}`);
                    if (!wrapper) {
                        wrapper = document.createElement('div');
                        wrapper.className = LIST_WRAPPER_CLASS;
                        anchorElement.replaceWith(wrapper);
                        wrapper.appendChild(copyBtn);
                        wrapper.appendChild(anchorElement);
                    } else if (!wrapper.querySelector(`.${COPY_BUTTON_CLASS}`)) {
                        wrapper.prepend(copyBtn);
                    }
                });

                // For Wenku grid
                parentElement.querySelectorAll(".n-grid a[href*='/wenku/']").forEach((anchorElement) => {
                    if (anchorElement.closest('.n-drawer')) return;
                    if (anchorElement.querySelector(`.${COPY_BUTTON_CLASS}`)) return;
                    const textSpanElement = anchorElement.querySelector("span.n-text");
                    if (!textSpanElement) return;
                    const titleText = textSpanElement.textContent.trim();
                    const linkHref = anchorElement.getAttribute("href");
                    if (!titleText || !linkHref) return;
                    const formattedLink = `[${titleText}](https://n.novelia.cc${linkHref})`;
                    const copyBtn = createCopyButton(formattedLink);

                    const gridWrapperDiv = document.createElement("div");
                    gridWrapperDiv.className = "novelia-grid-wrapper";
                    textSpanElement.replaceWith(gridWrapperDiv);
                    gridWrapperDiv.appendChild(copyBtn);
                    gridWrapperDiv.appendChild(textSpanElement);
                });
            }

            function shouldDisplayHeaderButtons() {
                if (SHOW_HEADER_BUTTONS_CONFIG === true) return true;
                if (SHOW_HEADER_BUTTONS_CONFIG === false) return false;
                return (navigator.maxTouchPoints > 0 || window.matchMedia("(pointer:coarse)").matches);
            }

            function injectHeaderActionButtons() {
                if (!shouldDisplayHeaderButtons()) return;

                const h1Element = document.querySelector("h1");
                const existingButtons = document.querySelectorAll(`.${HEADER_BUTTON_CLASS}`);

                if (!isSharePage()) {
                    existingButtons.forEach(button => button.remove());
                    if (h1Element) delete h1Element.dataset[HEADER_INJECTION_MARK];
                    return;
                }

                if (!h1Element || h1Element.closest('.n-drawer') || h1Element.dataset[HEADER_INJECTION_MARK]) return;

                // Double check if buttons already exist (manual check instead of just dataset)
                if (h1Element.querySelector(`.${HEADER_BUTTON_CLASS}`)) return;

                h1Element.dataset[HEADER_INJECTION_MARK] = "1";
                Object.assign(h1Element.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap' });

                const refreshBtn = document.createElement("button");
                refreshBtn.className = `novelia-bundle-btn ${HEADER_BUTTON_CLASS}`;
                refreshBtn.innerHTML = `${SVG_REFRESH}<span>刷新</span>`;
                refreshBtn.addEventListener("click", (event) => { event.preventDefault(); triggerUIRefresh(); });

                const clearBtn = document.createElement("button");
                clearBtn.className = `novelia-bundle-btn ${HEADER_BUTTON_CLASS}`;
                clearBtn.innerHTML = `${SVG_CLEAR}<span>清除快取</span>`;
                clearBtn.addEventListener("click", (event) => { event.preventDefault(); clearLinkCache(); });

                const viewBtn = document.createElement("button");
                viewBtn.className = `novelia-bundle-btn ${HEADER_BUTTON_CLASS}`;
                viewBtn.innerHTML = `${SVG_VIEW}<span>查看快取</span>`;
                viewBtn.addEventListener("click", (event) => { event.preventDefault(); viewLinkCache(); });

                h1Element.appendChild(refreshBtn);
                h1Element.appendChild(clearBtn);
                h1Element.appendChild(viewBtn);
            }

            function checkKeyboardShortcut(event, shortcutConfig) {
                return (
                    event.ctrlKey === shortcutConfig.ctrl &&
                    event.altKey === shortcutConfig.alt &&
                    event.shiftKey === shortcutConfig.shift &&
                    event.key.toLowerCase() === shortcutConfig.key.toLowerCase()
                );
            }

            window.addEventListener("keydown", (event) => {
                if (checkKeyboardShortcut(event, CLEAR_CACHE_KEY)) { event.preventDefault(); clearLinkCache(); }
                if (checkKeyboardShortcut(event, VIEW_CACHE_KEY)) { event.preventDefault(); viewLinkCache(); }
                if (checkKeyboardShortcut(event, REFRESH_UI_KEY)) { event.preventDefault(); triggerUIRefresh(); }
            });

            function removeStaleButtons(skipHeaders = false) {
                // Revert novel list item wrappers
                document.querySelectorAll(`.${LIST_WRAPPER_CLASS}`).forEach((wrapper) => {
                    const anchor = wrapper.querySelector('a');
                    if (anchor) wrapper.replaceWith(anchor);
                    else wrapper.remove();
                });

                // Revert grid wrappers
                document.querySelectorAll('.novelia-grid-wrapper').forEach((wrapper) => {
                    const originalText = wrapper.querySelector("span.n-text");
                    if (originalText) wrapper.replaceWith(originalText);
                    else wrapper.remove();
                });

                // Remove any leftover buttons just in case
                document.querySelectorAll(`.${COPY_BUTTON_CLASS}`).forEach((button) => button.remove());

                if (!skipHeaders) {
                    document.querySelectorAll(`.${HEADER_BUTTON_CLASS}`).forEach((button) => button.remove());
                    const h1Element = document.querySelector("h1");
                    if (h1Element) delete h1Element.dataset[HEADER_INJECTION_MARK];
                }
            }

            function performFullScan() {
                if (!isSharePage()) {
                    removeStaleButtons();
                    return;
                }
                injectLinkButtonsToItems(document);
                injectHeaderActionButtons();
            }

            function main() {
                performFullScan();

                window.addEventListener("tm-locationchange", () => {
                    // Slight delay to allow DOM to update after SPA navigation
                    setTimeout(performFullScan, 200);
                });

                const mutationObserver = new MutationObserver((mutations) => {
                    if (!isSharePage()) {
                        if (document.querySelector(`.${COPY_BUTTON_CLASS}`) || document.querySelector(`.${HEADER_BUTTON_CLASS}`)) {
                            removeStaleButtons();
                        }
                        return;
                    }

                    let needsReinjection = false;
                    for (const mutation of mutations) {
                        if (mutation.removedNodes.length >= 3) { needsReinjection = true; break; }
                    }
                    if (needsReinjection) {
                        removeStaleButtons();
                        requestAnimationFrame(() => requestAnimationFrame(performFullScan));
                    } else {
                        for (const mutation of mutations) {
                            for (const node of mutation.addedNodes) {
                                if (node.nodeType === Node.ELEMENT_NODE) injectLinkButtonsToItems(node);
                            }
                        }
                        injectHeaderActionButtons();
                    }
                });
                mutationObserver.observe(document.body, { childList: true, subtree: true });
            }

            main();
        }
    };

    // ==========================================
    // 4. 源站跳轉按鈕 (Modules.source_link)
    // ==========================================
    Modules.source_link = {
        init: function() {
            if (location.hostname.includes('novelia.cc')) return;
            const currentHostName = location.hostname;

            function processAnchor(anchorLink) {
                if (anchorLink.dataset.noveliaSourceLinkProcessed) return;

                const linkHref = anchorLink.href;
                const linkText = anchorLink.textContent.trim();
                let sourceSiteType;
                let novelId = '';

                if (linkHref.includes('n.novelia.cc')) return;

                const syosetuRegex = /https?:\/\/(ncode|novel18)\.syosetu\.com\/([^/]+)/;
                const hamelnRegex = /https?:\/\/syosetu\.org\/novel\/(\d+)/;

                let match = linkHref.match(syosetuRegex);
                if (match) {
                    sourceSiteType = "syosetu";
                    novelId = match[2];
                } else if ((match = linkHref.match(hamelnRegex))) {
                    sourceSiteType = "hameln";
                    novelId = match[1];
                } else {
                    match = linkText.match(syosetuRegex);
                    if (match) {
                        sourceSiteType = "syosetu";
                        novelId = match[2];
                    } else if ((match = linkText.match(hamelnRegex))) {
                        sourceSiteType = "hameln";
                        novelId = match[1];
                    } else {
                        return;
                    }
                }

                anchorLink.dataset.noveliaSourceLinkProcessed = "1";

                const jumpButton = document.createElement('button');
                jumpButton.textContent = '↗';
                jumpButton.style.marginLeft = '6px';
                jumpButton.style.border = 'none';
                jumpButton.style.background = 'none';
                jumpButton.style.cursor = 'pointer';
                jumpButton.style.fontSize = '14px';
                jumpButton.style.color = '#007BFF';

                jumpButton.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    window.open(`https://n.novelia.cc/novel/${sourceSiteType}/${novelId}`, '_blank');
                });

                if (currentHostName.includes("syosetu.com")) {
                    anchorLink.appendChild(jumpButton);
                } else {
                    anchorLink.insertAdjacentElement('afterend', jumpButton);
                }
            }

            function scanAllAnchors(rootElement = document) {
                const anchors = rootElement.querySelectorAll('a');
                anchors.forEach(processAnchor);
            }

            scanAllAnchors();

            const observer = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.tagName === 'A') {
                                processAnchor(node);
                            } else {
                                scanAllAnchors(node);
                            }
                        }
                    });
                });
            });

            observer.observe(document.body, { childList: true, subtree: true });
        }
    };

    // ==========================================
    // 6. 摺疊評論區回覆 (Modules.collapse_replies)
    // ==========================================
    Modules.collapse_replies = {
        init: function() {
            if (location.hostname !== 'n.novelia.cc' && location.hostname !== 'forum.novelia.cc') return;

            GM_addStyle(`
                .novelia-collapse-btn-wrapper {
                    margin-top: 8px;
                    display: flex;
                    align-items: center;
                }
                .novelia-collapse-btn {
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    padding: 0 6px 0 0;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    color: var(--n-text-color);
                    opacity: 0.8;
                    transition: opacity 0.2s, background-color 0.2s;
                    border-radius: 2px;
                }
                .novelia-collapse-btn:hover {
                    opacity: 1;
                    background-color: rgba(0, 0, 0, 0.05);
                }
                .dark .novelia-collapse-btn:hover {
                    background-color: rgba(255, 255, 255, 0.1);
                }
                .novelia-collapse-icon {
                    transition: transform 0.3s ease;
                    margin-right: 4px;
                    display: flex;
                    align-items: center;
                }
                .novelia-collapse-icon.collapsed {
                    transform: rotate(0deg);
                }
                .novelia-collapse-icon.expanded {
                    transform: rotate(90deg);
                }
                .novelia-collapse-replies-wrapper {
                    display: grid;
                    transition: grid-template-rows 0.3s ease-in-out;
                    overflow: hidden;
                }
                .novelia-collapse-replies-wrapper.collapsed {
                    grid-template-rows: 0fr;
                }
                .novelia-collapse-replies-wrapper.expanded {
                    grid-template-rows: 1fr;
                }
                .novelia-collapse-replies-inner {
                    overflow: hidden;
                    display: flow-root;
                }
            `);

            const LS_KEY = 'novelia_collapsed_comments';
            let collapsedStore = {};
            try {
                collapsedStore = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
                if (typeof collapsedStore !== 'object' || collapsedStore === null) collapsedStore = {};
            } catch (e) {
                collapsedStore = {};
            }

            function saveStore() {
                localStorage.setItem(LS_KEY, JSON.stringify(collapsedStore));
            }

            const chevronSvg = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"></path>
                </svg>
            `;

            // Sub-module 1: Novel Comment Collapse
            const NovelCommentCollapse = {
                getContext: function() {
                    const path = window.__noveliaMockPath || location.pathname;
                    const matchNovel = path.match(/^\/novel\/([^\/?#]+)\/([^\/?#]+)/i);
                    if (matchNovel) return { provider: matchNovel[1], id: matchNovel[2] };

                    const matchWenku = path.match(/^\/wenku\/([^\/?#]+)/i);
                    if (matchWenku) return { provider: 'wenku', id: matchWenku[1] };

                    return null;
                },

                isCollapsed: function(ctx, hash) {
                    if (!hash || !ctx) return false;
                    const list = collapsedStore[ctx.provider]?.[ctx.id];
                    return Array.isArray(list) && list.includes(hash);
                },

                setCollapsed: function(ctx, hash, collapsedState) {
                    if (!hash || !ctx) return;
                    if (collapsedState) {
                        if (!collapsedStore[ctx.provider]) collapsedStore[ctx.provider] = {};
                        if (!Array.isArray(collapsedStore[ctx.provider][ctx.id])) {
                            collapsedStore[ctx.provider][ctx.id] = [];
                        }
                        const list = collapsedStore[ctx.provider][ctx.id];
                        if (!list.includes(hash)) list.push(hash);
                    } else {
                        if (collapsedStore[ctx.provider] && Array.isArray(collapsedStore[ctx.provider][ctx.id])) {
                            const list = collapsedStore[ctx.provider][ctx.id];
                            const idx = list.indexOf(hash);
                            if (idx !== -1) list.splice(idx, 1);
                            if (list.length === 0) delete collapsedStore[ctx.provider][ctx.id];
                            if (Object.keys(collapsedStore[ctx.provider]).length === 0) delete collapsedStore[ctx.provider];
                        }
                    }
                    saveStore();
                },

                getReplyCount: function(repliesArea) {
                    if (!repliesArea) return 0;
                    const subReplies = repliesArea.querySelectorAll('div[style*="margin-left: 32px"]');
                    if (subReplies.length > 0) return subReplies.length;
                    if (repliesArea.matches('div[style*="margin-left: 32px"]')) return 1;
                    return repliesArea.querySelectorAll('.n-flex').length;
                },

                processThread: function(commentHeader) {
                    try {
                        const headerFlex = commentHeader.closest('.n-flex');
                        if (!headerFlex) return;

                        const isRoot = !headerFlex.parentElement.closest('div[style*="margin-left: 32px"]');
                        if (!isRoot) return;

                        const card = headerFlex.nextElementSibling;
                        if (!card || !card.classList.contains('n-card')) return;

                        if (headerFlex.dataset.noveliaCollapseProcessed) {
                            const btnWrapper = card.nextElementSibling;
                            if (!btnWrapper || !btnWrapper.classList.contains('novelia-collapse-btn-wrapper')) return;

                            const wrapper = btnWrapper.nextElementSibling;
                            if (!wrapper || !wrapper.classList.contains('novelia-collapse-replies-wrapper')) return;

                            const inner = wrapper.querySelector('.novelia-collapse-replies-inner');
                            const repliesArea = inner ? inner.firstElementChild : null;
                            if (!repliesArea) return;

                            const replyCount = NovelCommentCollapse.getReplyCount(repliesArea);
                            if (replyCount === 0) {
                                wrapper.parentNode.insertBefore(repliesArea, wrapper);
                                btnWrapper.remove();
                                wrapper.remove();
                                delete headerFlex.dataset.noveliaCollapseProcessed;
                            } else {
                                const btnText = btnWrapper.querySelector('.novelia-collapse-btn-text');
                                if (btnText) {
                                    const isCollapsed = wrapper.classList.contains('collapsed');
                                    const newText = `${isCollapsed ? '展開回覆' : '收起回覆'} (${replyCount})`;
                                    if (btnText.innerText !== newText) btnText.innerText = newText;
                                }
                            }
                            return;
                        }

                        let repliesArea = null;
                        let curr = card.nextElementSibling;
                        while (curr) {
                            if (curr.classList.contains('n-divider')) break;
                            if (curr.classList.contains('n-flex') && curr.querySelector('b')) break;

                            if (curr.matches('div[style*="margin-left: 32px"]')) {
                                const replySiblings = [curr];
                                let next = curr.nextElementSibling;
                                while (next && next.matches('div[style*="margin-left: 32px"]')) {
                                    replySiblings.push(next);
                                    next = next.nextElementSibling;
                                }
                                if (replySiblings.length > 1) {
                                    const container = document.createElement('div');
                                    curr.parentNode.insertBefore(container, curr);
                                    replySiblings.forEach(s => container.appendChild(s));
                                    repliesArea = container;
                                } else {
                                    repliesArea = curr;
                                }
                                break;
                            } else if (curr.querySelector && curr.querySelector('div[style*="margin-left: 32px"]')) {
                                repliesArea = curr;
                                break;
                            }
                            curr = curr.nextElementSibling;
                        }

                        if (!repliesArea) return;

                        const replyCount = NovelCommentCollapse.getReplyCount(repliesArea);
                        if (replyCount === 0) return;

                        headerFlex.dataset.noveliaCollapseProcessed = "true";

                        const author = commentHeader.innerText.trim();
                        const time = headerFlex.querySelector('time')?.innerText || "";
                        const rawId = author + time;
                        let hash = 0;
                        for (let i = 0; i < rawId.length; i++) {
                            const char = rawId.charCodeAt(i);
                            hash = ((hash << 5) - hash) + char;
                            hash = hash & hash;
                        }
                        const commentId = Math.abs(hash).toString(36);

                        const ctx = NovelCommentCollapse.getContext();
                        const isCollapsedState = NovelCommentCollapse.isCollapsed(ctx, commentId);

                        const btnWrapper = document.createElement('div');
                        btnWrapper.className = 'novelia-collapse-btn-wrapper';

                        const btn = document.createElement('button');
                        btn.className = 'novelia-collapse-btn';
                        btn.innerHTML = `
                            <span class="novelia-collapse-icon ${isCollapsedState ? 'collapsed' : 'expanded'}">${chevronSvg}</span>
                            <span class="novelia-collapse-btn-text">${isCollapsedState ? '展開回覆' : '收起回覆'} (${replyCount})</span>
                        `;

                        btnWrapper.appendChild(btn);
                        card.after(btnWrapper);

                        const wrapper = document.createElement('div');
                        wrapper.className = `novelia-collapse-replies-wrapper ${isCollapsedState ? 'collapsed' : 'expanded'}`;
                        const inner = document.createElement('div');
                        inner.className = 'novelia-collapse-replies-inner';

                        repliesArea.parentNode.insertBefore(wrapper, repliesArea);
                        inner.appendChild(repliesArea);
                        wrapper.appendChild(inner);

                        btn.addEventListener('click', () => {
                            const currentlyCollapsed = wrapper.classList.contains('collapsed');
                            const currentReplyCount = NovelCommentCollapse.getReplyCount(repliesArea);

                            if (currentlyCollapsed) {
                                wrapper.classList.remove('collapsed');
                                wrapper.classList.add('expanded');
                                btn.querySelector('.novelia-collapse-icon').classList.replace('collapsed', 'expanded');
                                btn.querySelector('.novelia-collapse-btn-text').innerText = `收起回覆 (${currentReplyCount})`;
                                NovelCommentCollapse.setCollapsed(ctx, commentId, false);
                            } else {
                                wrapper.classList.remove('expanded');
                                wrapper.classList.add('collapsed');
                                btn.querySelector('.novelia-collapse-icon').classList.replace('expanded', 'collapsed');
                                btn.querySelector('.novelia-collapse-btn-text').innerText = `展開回覆 (${currentReplyCount})`;
                                NovelCommentCollapse.setCollapsed(ctx, commentId, true);
                            }
                        });

                        btn.addEventListener('mouseup', () => btn.blur());

                        const nativeReplyBtn = Array.from(headerFlex.querySelectorAll('button')).find(b => b.innerText.includes('回复') || b.innerText.includes('回覆'));
                        if (nativeReplyBtn) {
                            nativeReplyBtn.addEventListener('click', () => {
                                if (wrapper.classList.contains('collapsed')) btn.click();
                            });
                        }
                    } catch (e) {
                        console.error('[Novelia Bundle] Error processing novel comment thread:', e);
                    }
                },

                scan: function() {
                    document.querySelectorAll('.n-flex b').forEach(NovelCommentCollapse.processThread);
                },

                init: function() {
                    let timer = null;
                    const observer = new MutationObserver(() => {
                        clearTimeout(timer);
                        timer = setTimeout(NovelCommentCollapse.scan, 100);
                    });

                    observer.observe(document.body, { childList: true, subtree: true });
                    NovelCommentCollapse.scan();
                    setTimeout(NovelCommentCollapse.scan, 500);
                }
            };

            // Sub-module 2: Forum Comment Collapse
            const ForumCommentCollapse = {
                getContext: function() {
                    const path = window.__noveliaMockPath || location.pathname;
                    const match = path.match(/^\/p\/([^\/?#]+)/i);
                    if (match) return { id: match[1] };
                    return null;
                },

                isCollapsed: function(ctx, hash) {
                    if (!hash || !ctx) return false;
                    const list = collapsedStore[ctx.id];
                    return Array.isArray(list) && list.includes(hash);
                },

                setCollapsed: function(ctx, hash, collapsedState) {
                    if (!hash || !ctx) return;
                    if (collapsedState) {
                        if (!Array.isArray(collapsedStore[ctx.id])) {
                            collapsedStore[ctx.id] = [];
                        }
                        const list = collapsedStore[ctx.id];
                        if (!list.includes(hash)) list.push(hash);
                    } else {
                        if (Array.isArray(collapsedStore[ctx.id])) {
                            const list = collapsedStore[ctx.id];
                            const idx = list.indexOf(hash);
                            if (idx !== -1) list.splice(idx, 1);
                            if (list.length === 0) delete collapsedStore[ctx.id];
                        }
                    }
                    saveStore();
                },

                processSection: function(section) {
                    try {
                        const rootArticle = section.querySelector('article');
                        if (!rootArticle) return;

                        if (rootArticle.classList.contains('ml-6') || rootArticle.className.includes('ml-')) return;

                        if (rootArticle.dataset.noveliaCollapseProcessed) {
                            const btnWrapper = rootArticle.nextElementSibling;
                            if (!btnWrapper || !btnWrapper.classList.contains('novelia-collapse-btn-wrapper')) return;

                            const wrapper = btnWrapper.nextElementSibling;
                            if (!wrapper || !wrapper.classList.contains('novelia-collapse-replies-wrapper')) return;

                            const inner = wrapper.querySelector('.novelia-collapse-replies-inner');
                            const repliesArea = inner ? inner.firstElementChild : null;
                            if (!repliesArea) return;

                            const replyCount = repliesArea.querySelectorAll('article').length;
                            if (replyCount === 0) {
                                wrapper.parentNode.insertBefore(repliesArea, wrapper);
                                btnWrapper.remove();
                                wrapper.remove();
                                delete rootArticle.dataset.noveliaCollapseProcessed;
                            } else {
                                const btnText = btnWrapper.querySelector('.novelia-collapse-btn-text');
                                if (btnText) {
                                    const isCollapsed = wrapper.classList.contains('collapsed');
                                    const newText = `${isCollapsed ? '展開回覆' : '收起回覆'} (${replyCount})`;
                                    if (btnText.innerText !== newText) btnText.innerText = newText;
                                }
                            }
                            return;
                        }

                        let repliesArea = rootArticle.nextElementSibling;
                        while (repliesArea && !repliesArea.querySelector('article')) {
                            repliesArea = repliesArea.nextElementSibling;
                        }

                        if (!repliesArea) return;

                        const replyCount = repliesArea.querySelectorAll('article').length;
                        if (replyCount === 0) return;

                        rootArticle.dataset.noveliaCollapseProcessed = "true";

                        let commentId = rootArticle.id ? rootArticle.id.replace(/^comment-/, '') : '';
                        if (!commentId) {
                            const author = rootArticle.querySelector('header span')?.innerText.trim() || "";
                            const time = rootArticle.querySelector('time')?.innerText.trim() || "";
                            const rawId = author + time;
                            let hash = 0;
                            for (let i = 0; i < rawId.length; i++) {
                                const char = rawId.charCodeAt(i);
                                hash = ((hash << 5) - hash) + char;
                                hash = hash & hash;
                            }
                            commentId = Math.abs(hash).toString(36);
                        }

                        const ctx = ForumCommentCollapse.getContext();
                        const isCollapsedState = ForumCommentCollapse.isCollapsed(ctx, commentId);

                        const btnWrapper = document.createElement('div');
                        btnWrapper.className = 'novelia-collapse-btn-wrapper';
                        btnWrapper.style.margin = '4px 0 8px 0';

                        const btn = document.createElement('button');
                        btn.className = 'novelia-collapse-btn';
                        btn.type = 'button';
                        btn.innerHTML = `
                            <span class="novelia-collapse-icon ${isCollapsedState ? 'collapsed' : 'expanded'}">${chevronSvg}</span>
                            <span class="novelia-collapse-btn-text">${isCollapsedState ? '展開回覆' : '收起回覆'} (${replyCount})</span>
                        `;

                        btnWrapper.appendChild(btn);
                        rootArticle.after(btnWrapper);

                        const wrapper = document.createElement('div');
                        wrapper.className = `novelia-collapse-replies-wrapper ${isCollapsedState ? 'collapsed' : 'expanded'}`;
                        const inner = document.createElement('div');
                        inner.className = 'novelia-collapse-replies-inner';

                        repliesArea.parentNode.insertBefore(wrapper, repliesArea);
                        inner.appendChild(repliesArea);
                        wrapper.appendChild(inner);

                        btn.addEventListener('click', () => {
                            const currentlyCollapsed = wrapper.classList.contains('collapsed');
                            const currentReplyCount = repliesArea.querySelectorAll('article').length;

                            if (currentlyCollapsed) {
                                wrapper.classList.remove('collapsed');
                                wrapper.classList.add('expanded');
                                btn.querySelector('.novelia-collapse-icon').classList.replace('collapsed', 'expanded');
                                btn.querySelector('.novelia-collapse-btn-text').innerText = `收起回覆 (${currentReplyCount})`;
                                ForumCommentCollapse.setCollapsed(ctx, commentId, false);
                            } else {
                                wrapper.classList.remove('expanded');
                                wrapper.classList.add('collapsed');
                                btn.querySelector('.novelia-collapse-icon').classList.replace('expanded', 'collapsed');
                                btn.querySelector('.novelia-collapse-btn-text').innerText = `展開回覆 (${currentReplyCount})`;
                                ForumCommentCollapse.setCollapsed(ctx, commentId, true);
                            }
                        });

                        btn.addEventListener('mouseup', () => btn.blur());

                        const nativeReplyBtn = Array.from(rootArticle.querySelectorAll('button')).find(b => b.innerText.includes('回复') || b.innerText.includes('回覆'));
                        if (nativeReplyBtn) {
                            nativeReplyBtn.addEventListener('click', () => {
                                if (wrapper.classList.contains('collapsed')) btn.click();
                            });
                        }
                    } catch (e) {
                        console.error('[Novelia Bundle] Error processing forum section:', e);
                    }
                },

                scan: function() {
                    document.querySelectorAll('section').forEach(ForumCommentCollapse.processSection);
                },

                init: function() {
                    let timer = null;
                    const observer = new MutationObserver(() => {
                        clearTimeout(timer);
                        timer = setTimeout(ForumCommentCollapse.scan, 100);
                    });

                    observer.observe(document.body, { childList: true, subtree: true });
                    ForumCommentCollapse.scan();
                    setTimeout(ForumCommentCollapse.scan, 500);
                }
            };

            // Route initialization based on domain
            if (location.hostname.includes('forum.novelia.cc')) {
                ForumCommentCollapse.init();
            } else {
                NovelCommentCollapse.init();
            }
        }
    };

    // ==========================================
    // 7. 預設摺疊圖片 (Modules.collapse_images)
    // ==========================================
    Modules.collapse_images = {
        init: function() {
            if (location.hostname !== 'n.novelia.cc') return;

            GM_addStyle(`
                .novelia-image-wrapper {
                    display: inline-flex;
                    flex-direction: column;
                    margin: 8px 0 32px 0;
                    max-width: 100%;
                }
                .novelia-image-btn {
                    align-self: flex-start;
                    background-color: var(--n-color, rgba(0, 0, 0, 0.05));
                    border: 1px solid var(--n-border-color, rgba(0, 0, 0, 0.15));
                    border-radius: 4px;
                    color: var(--n-text-color, #333);
                    cursor: pointer;
                    font-size: 18px;
                    padding: 6px 12px;
                    margin-bottom: 6px;
                    transition: background-color 0.2s, border-color 0.2s;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-family: inherit;
                }
                .dark .novelia-image-btn,
                body.dark .novelia-image-btn {
                    background-color: rgba(255, 255, 255, 0.1);
                    border-color: rgba(255, 255, 255, 0.2);
                    color: rgba(255, 255, 255, 0.82);
                }
                .novelia-image-btn:hover {
                    background-color: rgba(99, 226, 183, 0.15);
                    border-color: #63e2b7;
                    color: #63e2b7;
                }
                .novelia-image-btn-icon {
                    transition: transform 0.15s ease-in-out;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 18px;
                    height: 18px;
                }
                .novelia-image-btn-icon.collapsed {
                    transform: rotate(0deg);
                }
                .novelia-image-btn-icon.expanded {
                    transform: rotate(90deg);
                }
                .novelia-image-container {
                    display: grid;
                    transition: grid-template-rows 0.15s ease-in-out;
                    overflow: hidden;
                }
                .novelia-image-container.collapsed {
                    grid-template-rows: 0fr;
                }
                .novelia-image-container.expanded {
                    grid-template-rows: 1fr;
                }
                .novelia-image-inner {
                    overflow: hidden;
                    display: flow-root;
                }
                .novelia-image-inner img {
                    max-width: 100%;
                    height: auto;
                    display: block;
                }
            `);

            const chevronSvg = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"></path>
                </svg>
            `;

            function isChapterPage() {
                const path = window.__noveliaMockPath || location.pathname;
                return /^\/novel\/[^/]+\/[^/]+\/[^/]+/i.test(path);
            }

            function shouldCollapseImage(img) {
                if (img.dataset.noveliaImageProcessed) return false;

                if (img.naturalWidth > 0 && img.naturalWidth <= 40) return false;
                if (img.naturalHeight > 0 && img.naturalHeight <= 40) return false;

                if (img.closest('.n-avatar, [class*="avatar"], [class*="Avatar"], [class*="emoji"], [class*="icon"], [class*="logo"], header, footer, nav, .n-drawer, #tm-fixed-nav-buttons, .fs-search-wrap, .novelia-update-button')) {
                    return false;
                }

                const src = img.getAttribute('src') || '';
                const className = img.className || '';
                const id = img.id || '';

                const ignoreRegex = /avatar|logo|emoji|icon|captcha|loading|spinner|badge/i;
                if (ignoreRegex.test(src) || ignoreRegex.test(className) || ignoreRegex.test(id)) {
                    return false;
                }

                if (src.startsWith('data:') && src.length < 2048) {
                    return false;
                }

                return true;
            }

            function wrapImage(img) {
                if (!isChapterPage()) return;
                if (!shouldCollapseImage(img)) return;
                img.dataset.noveliaImageProcessed = "true";

                const wrapper = document.createElement('div');
                wrapper.className = 'novelia-image-wrapper';

                const btn = document.createElement('button');
                btn.className = 'novelia-image-btn';
                btn.type = 'button';
                btn.innerHTML = `
                    <span class="novelia-image-btn-icon collapsed">${chevronSvg}</span>
                    <span class="novelia-image-btn-text">顯示圖片</span>
                `;

                const container = document.createElement('div');
                container.className = 'novelia-image-container collapsed';

                const inner = document.createElement('div');
                inner.className = 'novelia-image-inner';

                img.parentNode.insertBefore(wrapper, img);
                inner.appendChild(img);
                container.appendChild(inner);
                wrapper.appendChild(btn);
                wrapper.appendChild(container);

                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const isCollapsed = container.classList.contains('collapsed');
                    const icon = btn.querySelector('.novelia-image-btn-icon');
                    if (isCollapsed) {
                        container.classList.remove('collapsed');
                        container.classList.add('expanded');
                        icon.classList.remove('collapsed');
                        icon.classList.add('expanded');
                        btn.querySelector('.novelia-image-btn-text').textContent = '收起圖片';
                    } else {
                        container.classList.remove('expanded');
                        container.classList.add('collapsed');
                        icon.classList.remove('expanded');
                        icon.classList.add('collapsed');
                        btn.querySelector('.novelia-image-btn-text').textContent = '顯示圖片';
                    }
                });
            }

            // Use debounced MutationObserver to handle dynamically added content safely
            function scanImages(root = document) {
                if (!isChapterPage()) return;
                root.querySelectorAll('img').forEach(wrapImage);
            }

            let scanTimer = null;
            const observer = new MutationObserver((mutations) => {
                if (!isChapterPage()) return;
                let hasNewImages = false;
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                if (node.tagName === 'IMG' || node.querySelector('img')) {
                                    hasNewImages = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (hasNewImages) break;
                }
                if (hasNewImages) {
                    clearTimeout(scanTimer);
                    scanTimer = setTimeout(() => {
                        scanImages();
                    }, 100);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            window.addEventListener("tm-locationchange", () => {
                if (isChapterPage()) {
                    scanImages();
                    setTimeout(scanImages, 100);
                    setTimeout(scanImages, 300);
                    setTimeout(scanImages, 600);
                }
            });

            if (isChapterPage()) {
                scanImages();
            }
        }
    };

    runModules();

})();
