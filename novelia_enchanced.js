// ==UserScript==
// @name         Novelia Script Bundle
// @namespace    novelia-enhanced
// @version      1.1.0
// @description  整合 Novelia 多種功能，支援自訂開關。包含評論數追蹤、論壇搜尋、分享按鈕、源站跳轉及編輯器增強。
// @author       Jules
// @match        *://n.novelia.cc/*
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
        { id: 'forum_search', name: '論壇搜尋增強', default: true },
        { id: 'share_btn', name: '小說分享按鈕', default: true },
        { id: 'source_link', name: '源站跳轉按鈕', default: true },
        { id: 'thread_footer', name: '編輯頁面固定頁尾', default: true }
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
            const CACHE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

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

            async function fetchCommentPage(site, page) {
                const url = `/api/comment?site=${encodeURIComponent(site)}&page=${page}&pageSize=${PAGE_SIZE}`;
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
                await Promise.all(missingPages.map((pageIndex) => pageLimiter(async () => { results[pageIndex] = await fetchCommentPage(site, pageIndex); })));
                return results;
            }

            async function fetchCounts(source, id) {
                const site = `web-${source}-${id}`;
                const firstPage = await fetchCommentPage(site, 0);
                const totalPages = firstPage.pageNumber;
                let topCount;
                const alreadyFetched = [firstPage];
                if (totalPages <= 1) {
                    topCount = firstPage.items.length;
                } else {
                    const lastPage = await fetchCommentPage(site, totalPages - 1);
                    topCount = (totalPages - 1) * PAGE_SIZE + lastPage.items.length;
                    alreadyFetched.push(lastPage);
                }
                if (!COUNT_REPLIES) return { topCount, allCount: topCount };
                const pages = totalPages <= 1 ? [firstPage] : await fetchAllPagesForReplies(site, totalPages, alreadyFetched);
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
                return pathMatch ? { source: pathMatch[1], id: pathMatch[2] } : null;
            }

            function isAllowedPage() {
                const path = window.__noveliaMockPath || location.pathname;
                return path === '/' || path.startsWith('/novel') || path.startsWith('/favorite');
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
                const novelInfo = matchNovelPath(location.pathname);
                if (!novelInfo) return;
                const h1Elements = document.querySelectorAll('h1');
                if (!h1Elements.length) return;
                const novelKey = `${novelInfo.source}/${novelInfo.id}`;
                const storedEntry = getStoredEntry(novelInfo.source, novelInfo.id);
                h1Elements.forEach((h1Element) => {
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
                const novelInfo = matchNovelPath(location.pathname);
                if (!novelInfo) return;
                const h2Elements = Array.from(document.querySelectorAll('h2')).filter((h2) => h2.textContent.trim() === '评论');
                if (!h2Elements.length) return;
                const novelKey = `${novelInfo.source}/${novelInfo.id}`;
                const storedEntry = getStoredEntry(novelInfo.source, novelInfo.id);
                h2Elements.forEach((h2Element) => {
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
                if (!h1Element || h1Element.querySelector(':scope > .novelia-bulk-update-button')) return;

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
                    if (mutations.some((mutation) => mutation.addedNodes && mutation.addedNodes.length > 0 && !isSelfCausedMutation(mutation))) schedulePageScan({ isInitial: false });
                });
                observer.observe(document.body, { childList: true, subtree: true });
            }

            function observeRouteChanges() {
                const notifyScan = () => { schedulePageScan({ isInitial: false }); setTimeout(() => scanPage({ isInitial: false }), 500); };
                const originalPushState = history.pushState;
                history.pushState = function (...args) { originalPushState.apply(this, args); notifyScan(); };
                const originalReplaceState = history.replaceState;
                history.replaceState = function (...args) { originalReplaceState.apply(this, args); notifyScan(); };
                window.addEventListener('popstate', notifyScan);
            }

            function main() {
                scanPage({ isInitial: true });
                observeDomChanges();
                observeRouteChanges();
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

            const FORUM_SEARCH_CACHE_KEY = 'novelia_forum_search_cache_v1';
            const FORUM_SEARCH_AUTHORS_KEY = 'novelia_forum_search_authors_v1';
            const FORUM_SEARCH_SETTINGS_KEY = 'novelia_forum_search_settings_v1';
            const FORUM_SEARCH_COLLAPSED_KEY = 'novelia_forum_search_collapsed_v1';
            const TARGET_BOARD_LABEL = '小说交流';
            const FORUM_API_URL_GENERATOR = (pageNumber) => `https://n.novelia.cc/api/article?page=${pageNumber - 1}&pageSize=20&category=General`;
            const RELATIVE_TIME_UNIT_MS = { '分钟前': 6e4, '小时前': 36e5, '天前': 864e5, '个月前': 2592e6, '年前': 31536e6 };
            const DEFAULT_FORUM_SETTINGS = {
                refreshIntervalMin: 30,
                refreshPages: 3,
                authorFromStart: false,
                authorCaseInsensitive: true,
                authorFuzzy: false,
            };

            function getPostIdFromUrl(url) {
                const idMatch = (url || '').match(/\/forum\/([a-f0-9]{24})/i);
                return idMatch ? idMatch[1] : null;
            }

            function getRelativeTimeFromNow(timestamp) {
                if (!timestamp) return '未知';
                const minutes = Math.floor((Date.now() - timestamp) / 60000);
                const hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
                if (minutes < 1) return '刚刚';
                if (hours < 1) return `${minutes} 分钟前`;
                if (days < 1) return `${hours} 小时前`;
                if (days < 30) return `${days} 天前`;
                if (days < 365) return `${Math.floor(days / 30)} 个月前`;
                return `${Math.floor(days / 365)} 年前`;
            }

            function findActiveDateToken(inputValue, cursorPosition, searchType) {
                const regex = new RegExp(`${searchType}:"([^"]*)"`, 'gi');
                let matchResult;
                while ((matchResult = regex.exec(inputValue))) {
                    const startPos = matchResult.index + 3;
                    const endPos = startPos + matchResult[1].length;
                    if (cursorPosition >= startPos && cursorPosition <= endPos) {
                        return { start: startPos, end: endPos, partial: inputValue.slice(startPos, cursorPosition), type: searchType };
                    }
                }
                return null;
            }

            function getPast7DaysDates(reverseOrder = false) {
                const datesArray = [];
                const timezoneOffset = (new Date()).getTimezoneOffset() * 60000;
                for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
                    const dateObj = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000);
                    const localISOTime = (new Date(dateObj - timezoneOffset)).toISOString();
                    const yyyymmdd = localISOTime.slice(0, 10).replace(/-/g, '');
                    datesArray.push(yyyymmdd);
                }
                return reverseOrder ? datesArray : datesArray.reverse();
            }

            function loadForumCache() {
                try { return JSON.parse(localStorage.getItem(FORUM_SEARCH_CACHE_KEY) || 'null'); } catch { return null; }
            }
            function saveForumCache(cacheData) {
                try { localStorage.setItem(FORUM_SEARCH_CACHE_KEY, JSON.stringify(cacheData)); }
                catch (error) { console.warn('[Novelia Forum Search] 缓存写入失敗', error); }
            }

            function findActiveAuthorToken(inputValue, cursorPosition) {
                const regex = /a:"([^"]*)"/gi;
                let matchResult;
                while ((matchResult = regex.exec(inputValue))) {
                    const startPos = matchResult.index + 3;
                    const endPos = startPos + matchResult[1].length;
                    if (cursorPosition >= startPos && cursorPosition <= endPos) {
                        return { start: startPos, end: endPos, partial: inputValue.slice(startPos, cursorPosition) };
                    }
                }
                return null;
            }

            function loadAuthorsCache() {
                try { return JSON.parse(localStorage.getItem(FORUM_SEARCH_AUTHORS_KEY) || '[]'); } catch { return []; }
            }
            function saveAuthorsCache(authorsArray) {
                try { localStorage.setItem(FORUM_SEARCH_AUTHORS_KEY, JSON.stringify(authorsArray)); } catch (error) { /* ignore */ }
            }
            function updateAuthorsCacheFromPosts(postsArray) {
                const existingAuthors = new Set(loadAuthorsCache());
                let hasChanged = false;
                (postsArray || []).forEach(post => {
                    if (post.author && !existingAuthors.has(post.author)) { existingAuthors.add(post.author); hasChanged = true; }
                });
                if (hasChanged) saveAuthorsCache(Array.from(existingAuthors).sort());
            }

            function loadForumSettings() {
                try { return Object.assign({}, DEFAULT_FORUM_SETTINGS, JSON.parse(localStorage.getItem(FORUM_SEARCH_SETTINGS_KEY) || '{}')); }
                catch { return Object.assign({}, DEFAULT_FORUM_SETTINGS); }
            }
            function saveForumSettings(settingsObj) {
                try { localStorage.setItem(FORUM_SEARCH_SETTINGS_KEY, JSON.stringify(settingsObj)); } catch (error) { /* ignore */ }
            }

            function loadForumCollapsedState() {
                try { return localStorage.getItem(FORUM_SEARCH_COLLAPSED_KEY) === '1'; } catch { return false; }
            }
            function saveForumCollapsedState(isCollapsed) {
                try { localStorage.setItem(FORUM_SEARCH_COLLAPSED_KEY, isCollapsed ? '1' : '0'); } catch (error) { /* ignore */ }
            }

            function escapeHtml(unsafe) {
                return unsafe
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            }

            function showForumToast(message) {
                const toastElement = document.createElement('div');
                toastElement.className = 'fs-toast';
                toastElement.textContent = message;
                document.body.appendChild(toastElement);
                setTimeout(() => toastElement.remove(), 2500);
            }

            function calculateLevenshteinDistance(stringA, stringB) {
                const lengthA = stringA.length, lengthB = stringB.length;
                if (lengthA === 0) return lengthB;
                if (lengthB === 0) return lengthA;
                const matrix = Array.from({ length: lengthA + 1 }, () => new Array(lengthB + 1).fill(0));
                for (let rowIndex = 0; rowIndex <= lengthA; rowIndex++) matrix[rowIndex][0] = rowIndex;
                for (let colIndex = 0; colIndex <= lengthB; colIndex++) matrix[0][colIndex] = colIndex;
                for (let rowIndex = 1; rowIndex <= lengthA; rowIndex++) {
                    for (let colIndex = 1; colIndex <= lengthB; colIndex++) {
                        const substitutionCost = stringA[rowIndex - 1] === stringB[colIndex - 1] ? 0 : 1;
                        matrix[rowIndex][colIndex] = Math.min(matrix[rowIndex - 1][colIndex] + 1, matrix[rowIndex][colIndex - 1] + 1, matrix[rowIndex - 1][colIndex - 1] + substitutionCost);
                    }
                }
                return matrix[lengthA][lengthB];
            }
            function calculateSimilarity(stringA, stringB) {
                if (!stringA.length && !stringB.length) return 1;
                const distance = calculateLevenshteinDistance(stringA, stringB);
                return 1 - distance / Math.max(stringA.length, stringB.length);
            }

            function getAuthorSuggestions(partialName, forumSettings) {
                const authorsList = loadAuthorsCache();
                if (!authorsList.length) return [];
                const isCaseInsensitive = forumSettings.authorCaseInsensitive;
                const normalizeString = (text) => isCaseInsensitive ? text.toLowerCase() : text;
                const partialNormalized = normalizeString(partialName || '');
                if (!partialNormalized) return authorsList.slice(0, 8);
                if (forumSettings.authorFuzzy) {
                    return authorsList
                        .map(author => ({ author, score: Math.max(calculateSimilarity(normalizeString(author), partialNormalized), normalizeString(author).includes(partialNormalized) ? 0.5 : 0) }))
                        .filter(entry => entry.score > 0.3)
                        .sort((first, second) => second.score - first.score)
                        .slice(0, 8)
                        .map(entry => entry.author);
                }
                const filteredAuthors = authorsList.filter(author => forumSettings.authorFromStart ? normalizeString(author).startsWith(partialNormalized) : normalizeString(author).includes(partialNormalized));
                return filteredAuthors.slice(0, 8);
            }

            GM_addStyle(`
                :root {
                    --fs-primary: #63e2b7;
                    --fs-primary-bg: rgba(99,226,183,0.12);
                    --fs-danger: #e88080;
                }
                #fs-search-wrap { margin: 4px 0 20px 0; border-radius: 8px; font-family: "PingFang SC", sans-serif; font-size: 14px; transition: background-color 0.2s, color 0.2s, border-color 0.2s; }
                #fs-search-wrap.fs-dark { background: #18181c; color: rgba(255,255,255,0.9); border: 1px solid #333; }
                #fs-search-wrap.fs-light { background: #fff; color: #333; border: 1px solid #eee; }

                #fs-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; cursor: pointer; user-select: none; }
                #fs-header .fs-title { font-weight: 600; display: flex; align-items: center; gap: 8px; }
                #fs-header .fs-header-status { font-size: 11.5px; opacity: 0.6; font-weight: 400; }
                #fs-header .fs-header-actions { display: flex; align-items: center; gap: 4px; }
                .fs-icon-btn { width: 24px; height: 24px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer; font-size: 14px; opacity: 0.7; transition: 0.15s; }
                .fs-icon-btn:hover { opacity: 1; background: var(--fs-primary-bg); color: var(--fs-primary); }
                #fs-settings-btn { color: #fff; opacity: 0.95; background: rgba(0,0,0,0.45); }
                #fs-settings-btn:hover { color: #fff; opacity: 1; background: rgba(0,0,0,0.6); }
                .fs-collapse-icon { display: inline-flex; align-items: center; justify-content: center; transition: transform 0.2s; }
                .fs-collapse-icon svg { display: block; }
                #fs-search-wrap.fs-collapsed { overflow: hidden; }
                #fs-search-wrap.fs-collapsed .fs-collapse-icon { transform: rotate(-90deg); }
                #fs-search-wrap.fs-collapsed #fs-body, #fs-search-wrap.fs-collapsed #fs-settings-panel { display: none !important; }

                #fs-body { padding: 0 14px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
                #fs-search-wrap .fs-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
                #fs-search-wrap .fs-hint { font-size: 11px; opacity: 0.55; }
                #fs-search-wrap .fs-input { padding: 0 10px; height: 28px; border-radius: 3px; font-size: 13px; outline: none; transition: border-color 0.2s; }
                #fs-search-wrap.fs-dark .fs-input { background: #26262a; border: 1px solid #444; color: #fff; }
                #fs-search-wrap.fs-light .fs-input { background: #fff; border: 1px solid #ccc; color: #333; }
                #fs-search-wrap #fs-query:not(:placeholder-shown) { border-color: var(--fs-primary); }
                #fs-search-wrap .fs-btn { display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; height: 28px; border-radius: 3px; cursor: pointer; font-size: 13px; background: transparent; transition: 0.2s; white-space: nowrap; }
                #fs-search-wrap .fs-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                #fs-search-wrap.fs-dark .fs-btn { border: 1px solid rgba(255,255,255,0.24); color: rgba(255,255,255,0.82); }
                #fs-search-wrap.fs-dark .fs-btn:hover { border-color: var(--fs-primary); color: var(--fs-primary); }
                #fs-search-wrap.fs-light .fs-btn { border: 1px solid rgba(0,0,0,0.2); color: #444; }
                #fs-search-wrap.fs-light .fs-btn:hover { border-color: #38b28a; color: #38b28a; }
                #fs-search-wrap .fs-btn-primary { background: var(--fs-primary-bg); border-color: var(--fs-primary) !important; color: var(--fs-primary) !important; }
                #fs-search-wrap .fs-range-input { width: 64px; text-align: center; }
                #fs-search-wrap .fs-range-sep { opacity: 0.5; }
                #fs-status { font-size: 12px; opacity: 0.75; min-height: 16px; }

                .fs-query-wrap { position: relative; flex: 1; min-width: 260px; }
                .fs-query-wrap #fs-query { width: 100%; box-sizing: border-box; padding-right: 30px; }
                .fs-query-icon { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; opacity: 0.5; display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; }
                .fs-suggest-box { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20; border-radius: 4px; overflow: hidden; max-height: 220px; overflow-y: auto; box-shadow: 0 4px 14px rgba(0,0,0,0.25); }
                #fs-search-wrap.fs-dark .fs-suggest-box { background: #26262a; border: 1px solid #444; }
                #fs-search-wrap.fs-light .fs-suggest-box { background: #fff; border: 1px solid #ccc; }
                .fs-suggest-item { padding: 6px 10px; font-size: 13px; cursor: pointer; }
                #fs-search-wrap.fs-dark .fs-suggest-item:hover, #fs-search-wrap.fs-dark .fs-suggest-item.fs-suggest-active { background: rgba(99,226,183,0.15); }
                #fs-search-wrap.fs-light .fs-suggest-item:hover, #fs-search-wrap.fs-light .fs-suggest-item.fs-suggest-active { background: rgba(56,178,138,0.12); }

                #fs-settings-panel { margin: 0 14px 12px 14px; padding: 10px 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 10px; font-size: 12.5px; }
                #fs-search-wrap.fs-dark #fs-settings-panel { background: #202024; border: 1px solid #333; }
                #fs-search-wrap.fs-light #fs-settings-panel { background: #f7f7f7; border: 1px solid #e5e5e5; }
                #fs-settings-panel .fs-settings-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
                #fs-settings-panel .fs-settings-group { font-weight: 600; opacity: 0.7; margin-top: 2px; }
                #fs-settings-panel label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
                #fs-settings-panel input[type="number"] { width: 64px; }
                #fs-settings-panel input[type="checkbox"] { cursor: pointer; }

                #fs-results table.fs-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                #fs-results table.fs-table th, #fs-results table.fs-table td { padding: 8px 6px; text-align: left; vertical-align: top; }
                #fs-search-wrap.fs-dark #fs-results table.fs-table th, #fs-search-wrap.fs-dark #fs-results table.fs-table td { border-bottom: 1px solid #333; }
                #fs-search-wrap.fs-light #fs-results table.fs-table th, #fs-search-wrap.fs-light #fs-results table.fs-table td { border-bottom: 1px solid #eee; }
                #fs-results .fs-col-title { width: 65%; }
                #fs-results .fs-col-time, #fs-results .fs-col-stats { width: 17.5%; white-space: nowrap; }
                #fs-results .fs-title-wrap { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal; line-height: 1.5; font-weight: 500; }
                #fs-results a { color: var(--fs-primary); text-decoration: none; }
                #fs-results a:hover { text-decoration: underline; }
                .fs-toast { position: fixed; bottom: 24px; right: 24px; padding: 10px 18px; border-radius: 4px; font-size: 13px; z-index: 99999; pointer-events: none; background: rgba(99,226,183,0.2); color: #63e2b7; border: 1px solid rgba(99,226,183,0.3); animation: fs-toast-in 0.2s ease; }
                @keyframes fs-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
            `);

            function transformApiItemsToPosts(itemsArray) {
                return (itemsArray || []).map(item => {
                    const timestamp = (item.updateAt || item.createAt) * 1000;
                    return {
                        id: item.id,
                        title: item.title,
                        url: `/forum/${item.id}`,
                        author: item.user?.username || '未知',
                        relText: getRelativeTimeFromNow(timestamp),
                        ts: timestamp,
                        views: item.numViews || 0,
                        replies: item.numComments || 0
                    };
                });
            }

            async function fetchForumApiPage(pageNumber) {
                try {
                    const response = await fetch(FORUM_API_URL_GENERATOR(pageNumber));
                    if (!response.ok) return null;
                    return await response.json();
                } catch (error) {
                    console.error('[Novelia Forum Search] API 請求失敗', error);
                    return null;
                }
            }

            function crawlAllForumPages(onProgressCallback, maxPagesLimit) {
                return new Promise((resolve) => {
                    const allPostsList = [];
                    let totalPagesCount = null;

                    (async () => {
                        let pageNum = 1;
                        while (true) {
                            const apiData = await fetchForumApiPage(pageNum);
                            if (!apiData || !apiData.items) break;
                            if (totalPagesCount === null) {
                                totalPagesCount = apiData.pageNumber || 1;
                                if (maxPagesLimit) totalPagesCount = Math.min(totalPagesCount, maxPagesLimit);
                            }
                            const postsFromPage = transformApiItemsToPosts(apiData.items);
                            if (postsFromPage.length === 0 && pageNum > 1) break;
                            allPostsList.push(...postsFromPage);
                            if (onProgressCallback) onProgressCallback(pageNum, totalPagesCount || pageNum);
                            if (pageNum >= (totalPagesCount || pageNum)) break;
                            pageNum++;
                            await new Promise(resolveTimer => setTimeout(resolveTimer, 100));
                        }
                        resolve(allPostsList);
                    })();
                });
            }

            function crawlForumPageRange(onProgressCallback, startPageNum, endPageNum) {
                return new Promise((resolve) => {
                    const allPostsList = [];
                    const totalPagesToCrawl = Math.max(1, endPageNum - startPageNum + 1);

                    (async () => {
                        for (let pageNum = startPageNum; pageNum <= endPageNum; pageNum++) {
                            const apiData = await fetchForumApiPage(pageNum);
                            if (!apiData || !apiData.items) break;
                            const postsFromPage = transformApiItemsToPosts(apiData.items);
                            if (onProgressCallback) onProgressCallback(pageNum - startPageNum + 1, totalPagesToCrawl);
                            if (postsFromPage.length === 0) break;
                            allPostsList.push(...postsFromPage);
                            if (pageNum < endPageNum) await new Promise(resolveTimer => setTimeout(resolveTimer, 100));
                        }
                        resolve(allPostsList);
                    })();
                });
            }

            let cacheBuildingPromise = null;
            function ensureForumCache(forceRescan, onProgressCallback) {
                if (!forceRescan) {
                    const existingCache = loadForumCache();
                    if (existingCache && Array.isArray(existingCache.posts) && existingCache.posts.length) return Promise.resolve(existingCache);
                }
                if (cacheBuildingPromise) return cacheBuildingPromise;
                cacheBuildingPromise = (async () => {
                    const allPosts = await crawlAllForumPages(onProgressCallback, null);
                    const newCache = { fetchedAt: Date.now(), posts: allPosts };
                    saveForumCache(newCache);
                    updateAuthorsCacheFromPosts(allPosts);
                    showForumToast(`抓取完成，共 ${allPosts.length} 篇帖子`);
                    updateForumHeaderStatus();
                    cacheBuildingPromise = null;
                    return newCache;
                })();
                return cacheBuildingPromise;
            }

            function mergePostsIntoCache(newPostsArray) {
                let currentCache = loadForumCache();
                if (!currentCache || !Array.isArray(currentCache.posts)) currentCache = { fetchedAt: Date.now(), posts: [] };
                const postsMap = new Map(currentCache.posts.map(post => [post.id, post]));
                newPostsArray.forEach(post => postsMap.set(post.id, post));
                currentCache.posts = Array.from(postsMap.values());
                currentCache.fetchedAt = Date.now();
                saveForumCache(currentCache);
                updateAuthorsCacheFromPosts(newPostsArray);
                updateForumHeaderStatus();
                return currentCache;
            }

            async function performIncrementalRefresh() {
                if (cacheBuildingPromise) return;
                const forumSettings = loadForumSettings();
                const resultsContainer = document.getElementById('fs-results');
                const statusDisplay = document.getElementById('fs-status');
                if (resultsContainer) resultsContainer.innerHTML = '';
                if (statusDisplay) statusDisplay.textContent = '正在自動掃描更新...';
                try {
                    const recentlyUpdatedPosts = await crawlAllForumPages(null, forumSettings.refreshPages);
                    if (recentlyUpdatedPosts.length) mergePostsIntoCache(recentlyUpdatedPosts);
                    if (statusDisplay) statusDisplay.textContent = '自動掃描完成';
                } catch (error) {
                    console.error('[Novelia Forum Search] 自動掃描失敗', error);
                }
            }

            let autoRefreshIntervalTimer = null;
            function setupAutoRefresh() {
                if (autoRefreshIntervalTimer) clearInterval(autoRefreshIntervalTimer);
                const forumSettings = loadForumSettings();
                const intervalMs = Math.max(1, forumSettings.refreshIntervalMin || 1) * 60000;
                autoRefreshIntervalTimer = setInterval(performIncrementalRefresh, intervalMs);
            }

            function updateForumHeaderStatus() {
                const statusElement = document.getElementById('fs-header-status');
                if (!statusElement) return;
                const forumCache = loadForumCache();
                const authorsList = loadAuthorsCache();
                if (!forumCache || !forumCache.posts || !forumCache.posts.length) {
                    statusElement.textContent = '尚未建立快取';
                    return;
                }
                statusElement.textContent = `共 ${forumCache.posts.length} 篇 · 更新於 ${getRelativeTimeFromNow(forumCache.fetchedAt)} · 作者 ${authorsList.length} 位`;
            }

            function parseSearchQuery(rawQueryString) {
                let remainingText = rawQueryString;
                let authorName = null, startDateTimestamp = null, endDateTimestamp = null;
                const authorMatch = remainingText.match(/a:"([^"]*)"/i);
                if (authorMatch) { authorName = authorMatch[1]; remainingText = remainingText.replace(authorMatch[0], ''); }

                const fromDateMatch = remainingText.match(/f:"(\d{8})"/i);
                if (fromDateMatch) { startDateTimestamp = getTimestampFromYYYYMMDD(fromDateMatch[1], false); remainingText = remainingText.replace(fromDateMatch[0], ''); }

                const toDateMatch = remainingText.match(/t:"(\d{8})"/i);
                if (toDateMatch) { endDateTimestamp = getTimestampFromYYYYMMDD(toDateMatch[1], true); remainingText = remainingText.replace(toDateMatch[0], ''); }

                return { keyword: remainingText.trim(), author: authorName, from: startDateTimestamp, to: endDateTimestamp };
            }

            function getTimestampFromYYYYMMDD(yyyymmddString, isEndOfDay) {
                const year = +yyyymmddString.slice(0, 4), month = +yyyymmddString.slice(4, 6) - 1, day = +yyyymmddString.slice(6, 8);
                const dateObj = isEndOfDay ? new Date(year, month, day, 23, 59, 59, 999) : new Date(year, month, day, 0, 0, 0, 0);
                return dateObj.getTime();
            }

            function filterPostsByQuery(postsArray, rawQuery) {
                const { keyword, author, from, to } = parseSearchQuery(rawQuery);
                const keywordLower = keyword.toLowerCase();
                return postsArray.filter(post => {
                    if (keywordLower && !post.title.toLowerCase().includes(keywordLower)) return false;
                    if (author && post.author !== author) return false;
                    if (from !== null && (post.ts === null || post.ts < from)) return false;
                    if (to !== null && (post.ts === null || post.ts > to)) return false;
                    return true;
                });
            }

            async function runForumSearch(rawQuery, statusDisplay, resultsContainer, searchButton, forceRescan) {
                if (searchButton) {
                    searchButton.disabled = true;
                    searchButton.textContent = forceRescan ? '掃描中...' : '搜索中...';
                }
                if (forceRescan) { resultsContainer.innerHTML = ''; statusDisplay.textContent = ''; }
                try {
                    const hasCache = !!loadForumCache();
                    statusDisplay.textContent = forceRescan
                        ? '正在完整重新掃描...'
                        : (hasCache ? '搜索中...' : '本地快取尚未建立，正在建立（首次掃描可能需要較長時間）...');
                    const currentCache = await ensureForumCache(forceRescan, (page, total) => {
                        statusDisplay.textContent = `正在掃描「${TARGET_BOARD_LABEL}」第 ${page}/${total} 頁...`;
                    });

                    if (forceRescan) {
                        statusDisplay.textContent = '完整重新掃描完成，快取已更新';
                        updateForumHeaderStatus();
                        return;
                    }

                    const filteredResults = filterPostsByQuery(currentCache.posts, rawQuery);

                    statusDisplay.innerHTML = `匹配到 ${filteredResults.length} 條結果 <button id="fs-clear-btn" class="fs-btn" style="margin-left:8px;height:22px;padding:0 8px;">清除結果</button>`;
                    statusDisplay.querySelector('#fs-clear-btn').onclick = () => { statusDisplay.innerHTML = ''; resultsContainer.innerHTML = ''; };
                    renderSearchResults(filteredResults, resultsContainer);
                    updateForumHeaderStatus();
                } finally {
                    if (searchButton) {
                        searchButton.disabled = false;
                        searchButton.textContent = forceRescan ? '完整重新掃描' : '搜索';
                    }
                }
            }

            async function runRangeScan(rawQuery, statusDisplay, resultsContainer, scanButton, startPageNum, endPageNum) {
                if (scanButton) {
                    scanButton.disabled = true;
                    scanButton.textContent = '掃描中...';
                }
                resultsContainer.innerHTML = '';
                statusDisplay.textContent = '';
                try {
                    statusDisplay.textContent = `正在掃描第 ${startPageNum}-${endPageNum} 頁...`;
                    const scannedPosts = await crawlForumPageRange((page, total) => {
                        statusDisplay.textContent = `正在掃描第 ${startPageNum}-${endPageNum} 頁（${page}/${total}）...`;
                    }, startPageNum, endPageNum);
                    mergePostsIntoCache(scannedPosts);
                    showForumToast(`掃描完成，本次更新 ${scannedPosts.length} 篇帖子`);

                    statusDisplay.textContent = '範圍掃描完成，快取已更新';
                    updateForumHeaderStatus();
                }
                catch (error) {
                    statusDisplay.textContent = '掃描失敗，請重試';
                    console.error('[Novelia Forum Search] 自訂範圍掃描失敗', error);
                } finally {
                    if (scanButton) {
                        scanButton.disabled = false;
                        scanButton.textContent = '掃描';
                    }
                }
            }

            function renderSearchResults(resultsList, containerElement) {
                if (!resultsList.length) {
                    containerElement.innerHTML = '<div style="padding:30px;text-align:center;opacity:0.6;">沒有找到匹配的帖子</div>';
                    return;
                }
                resultsList.sort((a, b) => (b.ts || 0) - (a.ts || 0));
                containerElement.innerHTML = `<table class="fs-table"><thead><tr><th class="fs-col-title">標題</th><th class="fs-col-time">更新</th><th class="fs-col-stats">查看/回覆</th></tr></thead><tbody>${
                    resultsList.map(post => `<tr>
                        <td class="fs-col-title"><div class="fs-title-wrap"><a href="${escapeHtml(post.url)}" target="_blank">${escapeHtml(post.title)}</a></div><div style="font-size:11px;opacity:0.6;margin-top:2px;">by ${escapeHtml(post.author || '未知')}</div></td>
                        <td class="fs-col-time">${escapeHtml(post.relText || '未知')}</td>
                        <td class="fs-col-stats">${escapeHtml(String(post.views))}/${escapeHtml(String(post.replies))}</td>
                    </tr>`).join('')
                }</tbody></table>`;
            }

            function detectCurrentTheme() {
                const backgroundColor = window.getComputedStyle(document.body).backgroundColor;
                const matchResult = backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                return (matchResult && ((parseInt(matchResult[1]) * 299 + parseInt(matchResult[2]) * 587 + parseInt(matchResult[3]) * 114) / 1000) < 128) ? 'dark' : 'light';
            }

            function isCursorPositionOutsideQuotes(inputValue, cursorPosition) {
                const textBeforeCursor = inputValue.slice(0, cursorPosition);
                const quoteCount = (textBeforeCursor.match(/"/g) || []).length;
                return quoteCount % 2 === 0;
            }

            const SEARCH_TOKEN_DEFINITIONS = [
                { key: 'a', label: 'a:""' },
                { key: 'f', label: 'f:""' },
                { key: 't', label: 't:""' },
            ];
            function getMissingSearchTokens(inputValue) {
                return SEARCH_TOKEN_DEFINITIONS.filter(def => !new RegExp(`(^|[^A-Za-z0-9_])${def.key}:"`, 'i').test(inputValue));
            }

            function setupQueryInputInteractions(queryInputElement, suggestionsElement) {
                let currentActiveSuggestions = [];
                let currentSuggestionIndex = -1;

                function hideSuggestionsList() {
                    suggestionsElement.style.display = 'none';
                    suggestionsElement.innerHTML = '';
                    currentActiveSuggestions = [];
                    currentSuggestionIndex = -1;
                }

                function highlightActiveSuggestion() {
                    suggestionsElement.querySelectorAll('.fs-suggest-item').forEach((element, index) => {
                        const isActive = index === currentSuggestionIndex;
                        element.classList.toggle('fs-suggest-active', isActive);
                        if (isActive) {
                            element.scrollIntoView({ block: 'nearest' });
                        }
                    });
                }

                function applySelectedSuggestion(suggestion) {
                    if (suggestion.type === 'token') {
                        const position = queryInputElement.selectionStart;
                        const value = queryInputElement.value;
                        const textBefore = value.slice(0, position);
                        const textAfter = value.slice(position);
                        const needsSpaceBefore = textBefore.length > 0 && !/\s$/.test(textBefore);
                        const insertionText = (needsSpaceBefore ? ' ' : '') + suggestion.prefixChar + ':""';
                        queryInputElement.value = textBefore + insertionText + textAfter;
                        const newCursorPos = textBefore.length + insertionText.length - 1;
                        queryInputElement.setSelectionRange(newCursorPos, newCursorPos);
                        hideSuggestionsList();
                        queryInputElement.focus();
                        updateSuggestionsList();
                        return;
                    }
                    if (suggestion.type === 'date') {
                        const value = queryInputElement.value;
                        const newValue = value.slice(0, suggestion.token.start) + suggestion.value + value.slice(suggestion.token.end);
                        queryInputElement.value = newValue;
                        const newCursorPos = suggestion.token.start + suggestion.value.length + 1;
                        queryInputElement.setSelectionRange(newCursorPos, newCursorPos);
                        hideSuggestionsList();
                        queryInputElement.focus();
                        return;
                    }
                    const { token } = suggestion;
                    const value = queryInputElement.value;
                    const newValue = value.slice(0, token.start) + suggestion.author + value.slice(token.end);
                    queryInputElement.value = newValue;
                    const newCursorPos = token.start + suggestion.author.length + 1;
                    queryInputElement.setSelectionRange(newCursorPos, newCursorPos);
                    hideSuggestionsList();
                    queryInputElement.focus();
                }

                function renderSuggestionsUI() {
                    suggestionsElement.innerHTML = currentActiveSuggestions.map((suggestion, index) => {
                        let labelText = '';
                        if (suggestion.type === 'token') labelText = suggestion.label;
                        else if (suggestion.type === 'date') labelText = suggestion.label;
                        else labelText = suggestion.author;
                        return `<div class="fs-suggest-item" data-i="${index}">${labelText}</div>`;
                    }).join('');
                    suggestionsElement.style.display = 'block';
                    suggestionsElement.querySelectorAll('.fs-suggest-item').forEach(element => {
                        element.addEventListener('mousedown', (event) => {
                            event.preventDefault();
                            const index = +element.dataset.i;
                            applySelectedSuggestion(currentActiveSuggestions[index]);
                        });
                    });
                }

                function updateSuggestionsList() {
                    const position = queryInputElement.selectionStart;
                    const value = queryInputElement.value;

                    const authorToken = findActiveAuthorToken(value, position);
                    if (authorToken) {
                        const forumSettings = loadForumSettings();
                        const matches = getAuthorSuggestions(authorToken.partial, forumSettings);
                        if (!matches.length) { hideSuggestionsList(); return; }
                        currentActiveSuggestions = matches.map(author => ({ type: 'author', author: author, token: authorToken }));
                        currentSuggestionIndex = -1;
                        renderSuggestionsUI();
                        return;
                    }

                    const fromDateToken = findActiveDateToken(value, position, 'f');
                    if (fromDateToken) {
                        const dates = getPast7DaysDates(false).filter(date => date.includes(fromDateToken.partial));
                        if (!dates.length) { hideSuggestionsList(); return; }
                        currentActiveSuggestions = dates.map(date => ({ type: 'date', value: date, label: date, token: fromDateToken }));
                        currentSuggestionIndex = -1;
                        renderSuggestionsUI();
                        return;
                    }

                    const toDateToken = findActiveDateToken(value, position, 't');
                    if (toDateToken) {
                        const dates = getPast7DaysDates(true).filter(date => date.includes(toDateToken.partial));
                        if (!dates.length) { hideSuggestionsList(); return; }
                        currentActiveSuggestions = dates.map(date => ({ type: 'date', value: date, label: date, token: toDateToken }));
                        currentSuggestionIndex = -1;
                        renderSuggestionsUI();
                        return;
                    }

                    if (isCursorPositionOutsideQuotes(value, position)) {
                        const missingTokens = getMissingSearchTokens(value);
                        if (missingTokens.length) {
                            currentActiveSuggestions = missingTokens.map(def => ({ type: 'token', prefixChar: def.key, label: def.label }));
                            currentSuggestionIndex = -1;
                            renderSuggestionsUI();
                            return;
                        }
                    }

                    hideSuggestionsList();
                }

                queryInputElement.addEventListener('keydown', (event) => {
                    if (event.key === '"') {
                        const position = queryInputElement.selectionStart;
                        const textBefore = queryInputElement.value.slice(0, position);
                        if (/(^|[^A-Za-z0-9_])[aft]:$/i.test(textBefore)) {
                            event.preventDefault();
                            const textAfter = queryInputElement.value.slice(position);
                            queryInputElement.value = textBefore + '""' + textAfter;
                            const newCursorPos = position + 1;
                            queryInputElement.setSelectionRange(newCursorPos, newCursorPos);
                            updateSuggestionsList();
                            return;
                        }
                    }
                    if (suggestionsElement.style.display !== 'none' && currentActiveSuggestions.length) {
                        if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            currentSuggestionIndex = (currentSuggestionIndex + 1) % currentActiveSuggestions.length;
                            highlightActiveSuggestion();
                            return;
                        }
                        if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            currentSuggestionIndex = (currentSuggestionIndex - 1 + currentActiveSuggestions.length) % currentActiveSuggestions.length;
                            highlightActiveSuggestion();
                            return;
                        }
                        if (event.key === 'Enter' && currentSuggestionIndex >= 0) {
                            event.preventDefault();
                            applySelectedSuggestion(currentActiveSuggestions[currentSuggestionIndex]);
                            return;
                        }
                        if (event.key === 'Escape') {
                            hideSuggestionsList();
                            return;
                        }
                    }
                });
                queryInputElement.addEventListener('input', updateSuggestionsList);
                queryInputElement.addEventListener('click', updateSuggestionsList);
                queryInputElement.addEventListener('focus', updateSuggestionsList);
                queryInputElement.addEventListener('blur', () => setTimeout(hideSuggestionsList, 150));
            }

            function buildForumSettingsPanelHTML() {
                const settings = loadForumSettings();
                return `
                    <div class="fs-settings-row">
                        <span class="fs-settings-group">定時掃描</span>
                        <label>間隔（分鐘）<input type="number" min="1" id="fs-set-interval" class="fs-input" value="${settings.refreshIntervalMin}" style="width:64px;"></label>
                        <label>掃描頁數<input type="number" min="1" id="fs-set-pages" class="fs-input" value="${settings.refreshPages}" style="width:64px;"></label>
                    </div>
                    <div class="fs-settings-row">
                        <span class="fs-settings-group">作者自動補全</span>
                        <label><input type="checkbox" id="fs-set-fromstart" ${settings.authorFromStart ? 'checked' : ''}>從頭比對</label>
                        <label><input type="checkbox" id="fs-set-ci" ${settings.authorCaseInsensitive ? 'checked' : ''}>不分大小寫</label>
                        <label><input type="checkbox" id="fs-set-fuzzy" ${settings.authorFuzzy ? 'checked' : ''}>字串相似度比對</label>
                    </div>
                    <div class="fs-settings-row">
                        <span class="fs-settings-group">快取維護</span>
                        <button id="fs-rescan-btn" class="fs-btn">完整重新掃描</button>
                        <span class="fs-hint" style="margin:0;">重新掃描全部頁面並完全覆蓋本地快取</span>
                    </div>
                `;
            }

            function bindForumSettingsPanelEvents(panelElement) {
                const intervalInput = panelElement.querySelector('#fs-set-interval');
                const pagesInput = panelElement.querySelector('#fs-set-pages');
                const fromStartInput = panelElement.querySelector('#fs-set-fromstart');
                const caseInsensitiveInput = panelElement.querySelector('#fs-set-ci');
                const fuzzyInput = panelElement.querySelector('#fs-set-fuzzy');

                function persistForumSettings(restartTimer) {
                    const newSettings = {
                        refreshIntervalMin: Math.max(1, parseInt(intervalInput.value, 10) || DEFAULT_FORUM_SETTINGS.refreshIntervalMin),
                        refreshPages: Math.max(1, parseInt(pagesInput.value, 10) || DEFAULT_FORUM_SETTINGS.refreshPages),
                        authorFromStart: fromStartInput.checked,
                        authorCaseInsensitive: caseInsensitiveInput.checked,
                        authorFuzzy: fuzzyInput.checked,
                    };
                    saveForumSettings(newSettings);
                    if (restartTimer) setupAutoRefresh();
                    showForumToast('設定已保存');
                }

                intervalInput.addEventListener('change', () => persistForumSettings(true));
                pagesInput.addEventListener('change', () => persistForumSettings(false));
                fromStartInput.addEventListener('change', () => persistForumSettings(false));
                caseInsensitiveInput.addEventListener('change', () => persistForumSettings(false));
                fuzzyInput.addEventListener('change', () => persistForumSettings(false));
            }

            function injectForumSearchBar() {
                if (!/^\/forum\/?(\?|$)/.test(location.pathname)) {
                    const existingWrap = document.getElementById('fs-search-wrap');
                    if (existingWrap) existingWrap.remove();
                    return;
                }

                const boardLabelElement = Array.from(document.querySelectorAll('.n-text')).find(el => {
                    const text = el.textContent.trim();
                    return text === '版块' || text === '版塊';
                });
                const filterRowElement = boardLabelElement ? boardLabelElement.closest('.n-flex') : null;
                if (!filterRowElement) return;

                const checkedRadioButton = filterRowElement.querySelector('.n-radio-button--checked .n-radio__label');
                const isTargetBoardSelected = checkedRadioButton && checkedRadioButton.textContent.trim() === TARGET_BOARD_LABEL;

                let searchWrapElement = document.getElementById('fs-search-wrap');
                if (!isTargetBoardSelected) {
                    if (searchWrapElement) searchWrapElement.style.display = 'none';
                    return;
                }

                if (searchWrapElement) {
                    searchWrapElement.style.display = 'block';
                    searchWrapElement.className = 'fs-search-wrap ' + (detectCurrentTheme() === 'dark' ? 'fs-dark' : 'fs-light') + (loadForumCollapsedState() ? ' fs-collapsed' : '');
                    updateForumHeaderStatus();
                    return;
                }

                searchWrapElement = document.createElement('div');
                searchWrapElement.id = 'fs-search-wrap';
                searchWrapElement.className = 'fs-search-wrap ' + (detectCurrentTheme() === 'dark' ? 'fs-dark' : 'fs-light') + (loadForumCollapsedState() ? ' fs-collapsed' : '');
                searchWrapElement.innerHTML = `
                    <div id="fs-header">
                        <span class="fs-title">🔍 ${TARGET_BOARD_LABEL} 搜索 <span id="fs-header-status" class="fs-header-status"></span></span>
                        <span class="fs-header-actions">
                            <button id="fs-settings-btn" class="fs-icon-btn" title="設定">⚙</button>
                            <span class="fs-icon-btn fs-collapse-icon" title="折疊/展開"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
                        </span>
                    </div>
                    <div id="fs-settings-panel" style="display:none;">${buildForumSettingsPanelHTML()}</div>
                    <div id="fs-body">
                        <div class="fs-row">
                            <div class="fs-query-wrap">
                                <input id="fs-query" type="text" class="fs-input" placeholder='搜索標題... 例：戀愛 a:"frank3215" f:"20260101" t:"20260630"' autocomplete="off">
                                <span class="fs-query-icon"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14z" fill="currentColor"></path></svg></span>
                                <div id="fs-author-suggest" class="fs-suggest-box" style="display:none;"></div>
                            </div>
                            <button id="fs-search-btn" class="fs-btn fs-btn-primary">搜索</button>
                            <input id="fs-range-start" type="number" min="1" class="fs-input fs-range-input" placeholder="起始頁">
                            <span class="fs-range-sep">-</span>
                            <input id="fs-range-end" type="number" min="1" class="fs-input fs-range-input" placeholder="結束頁">
                            <button id="fs-scan-btn" class="fs-btn">掃描</button>
                        </div>
                        <div class="fs-hint">僅支持「${TARGET_BOARD_LABEL}」版塊；a:"作者名"，f:"YYYYMMDD" / t:"YYYYMMDD" 時間範圍(from~to)；輸入 a:" f:" t:" 後會自動補上閉合引號</div>
                        <div id="fs-status"></div>
                        <div id="fs-results"></div>
                    </div>
                `;
                filterRowElement.insertAdjacentElement('afterend', searchWrapElement);

                const headerElement = searchWrapElement.querySelector('#fs-header');
                const settingsButton = searchWrapElement.querySelector('#fs-settings-btn');
                const settingsPanelElement = searchWrapElement.querySelector('#fs-settings-panel');
                const queryInputElement = searchWrapElement.querySelector('#fs-query');
                const suggestionsElement = searchWrapElement.querySelector('#fs-author-suggest');
                const statusDisplayElement = searchWrapElement.querySelector('#fs-status');
                const resultsContainerElement = searchWrapElement.querySelector('#fs-results');
                const searchButtonElement = searchWrapElement.querySelector('#fs-search-btn');
                const scanButtonElement = searchWrapElement.querySelector('#fs-scan-btn');
                const rangeStartInputElement = searchWrapElement.querySelector('#fs-range-start');
                const rangeEndInputElement = searchWrapElement.querySelector('#fs-range-end');

                headerElement.addEventListener('click', (event) => {
                    if (event.target.closest('#fs-settings-btn')) return;
                    searchWrapElement.classList.toggle('fs-collapsed');
                    saveForumCollapsedState(searchWrapElement.classList.contains('fs-collapsed'));
                });

                settingsButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    settingsPanelElement.style.display = settingsPanelElement.style.display === 'none' ? 'flex' : 'none';
                });
                bindForumSettingsPanelEvents(settingsPanelElement);
                const rescanButtonElement = settingsPanelElement.querySelector('#fs-rescan-btn');

                setupQueryInputInteractions(queryInputElement, suggestionsElement);
                const triggerSearch = (forceRescan) => {
                    if (!queryInputElement.value.trim() && !forceRescan) { resultsContainerElement.innerHTML = ''; statusDisplayElement.textContent = ''; return; }
                    runForumSearch(queryInputElement.value, statusDisplayElement, resultsContainerElement, forceRescan ? rescanButtonElement : searchButtonElement, !!forceRescan);
                };
                searchButtonElement.onclick = () => triggerSearch(false);
                rescanButtonElement.onclick = (event) => { event.stopPropagation(); triggerSearch(true); };
                scanButtonElement.onclick = () => {
                    const forumSettings = loadForumSettings();
                    let startPage = parseInt(rangeStartInputElement.value, 10);
                    let endPage = parseInt(rangeEndInputElement.value, 10);
                    if (!startPage || startPage < 1) startPage = 1;
                    if (!endPage || endPage < startPage) endPage = startPage + Math.max(0, forumSettings.refreshPages - 1);
                    runRangeScan(queryInputElement.value, statusDisplayElement, resultsContainerElement, scanButtonElement, startPage, endPage);
                };
                queryInputElement.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' && suggestionsElement.style.display === 'none') triggerSearch(false);
                });

                const existingCacheData = loadForumCache();
                if (!existingCacheData || !existingCacheData.posts || !existingCacheData.posts.length) {
                    statusDisplayElement.textContent = '本地快取尚未建立，正在背景建立（首次掃描可能需要較長時間）...';
                    ensureForumCache(false, (page, total) => {
                        statusDisplayElement.textContent = `正在掃描「${TARGET_BOARD_LABEL}」第 ${page}/${total} 頁...`;
                    }).then(() => {
                        statusDisplayElement.textContent = '本地快取已建立';
                    }).catch(error => {
                        statusDisplayElement.textContent = '快取建立失敗，請稍後點擊「完整重新掃描」重試';
                        console.error('[Novelia Forum Search] 背景建立快取失敗', error);
                    });
                }

                updateForumHeaderStatus();
            }

            let injectionDebounceTimer = null;
            function scheduleInjection() {
                clearTimeout(injectionDebounceTimer);
                injectionDebounceTimer = setTimeout(() => {
                    try { injectForumSearchBar(); } catch (error) { console.error('[Novelia Forum Search] 注入失敗', error); }
                }, 250);
            }

            function main() {
                new MutationObserver(scheduleInjection).observe(document.body, {
                    childList: true, subtree: true, attributes: true, attributeFilter: ['class']
                });
                scheduleInjection();
                setupAutoRefresh();
                setInterval(updateForumHeaderStatus, 60000);
            }

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
                LIST_ITEM_SELECTOR = 'div.n-flex[role="none"]';

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

            function triggerUIRefresh() {
                removeStaleButtons(true);
                requestAnimationFrame(() => requestAnimationFrame(performFullScan));
                showCopyToast("🔄 已重新偵測當前頁面並重新注入按鈕！");
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
                parentElement.querySelectorAll(LIST_ITEM_SELECTOR).forEach((itemElement) => {
                    if (itemElement.querySelector(`.${COPY_BUTTON_CLASS}`)) return;
                    const anchorElement = itemElement.querySelector(":scope > a");
                    const textSpanElement = itemElement.querySelector(":scope > span:first-of-type");
                    if (!anchorElement || !textSpanElement) return;
                    const titleText = textSpanElement.textContent.trim();
                    const linkHref = anchorElement.getAttribute("href");
                    if (!titleText || !linkHref) return;
                    const formattedLink = `[${titleText}](https://n.novelia.cc${linkHref})`;
                    const copyBtn = createCopyButton(formattedLink);
                    const wrapperDiv = document.createElement("div");
                    wrapperDiv.style.cssText = `display:flex;flex-flow:row;align-items:${ALIGNMENT_TYPE}`;
                    anchorElement.replaceWith(wrapperDiv);
                    wrapperDiv.appendChild(copyBtn);
                    wrapperDiv.appendChild(anchorElement);
                });

                parentElement.querySelectorAll(".n-grid a[href*='/wenku/']").forEach((anchorElement) => {
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
                if (!h1Element || h1Element.dataset[HEADER_INJECTION_MARK]) return;
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
                document.querySelectorAll(`.${COPY_BUTTON_CLASS}`).forEach((button) => {
                    const flexWrapper = button.closest("div[style*='display:flex']");
                    if (flexWrapper) {
                        const originalAnchor = flexWrapper.querySelector("a");
                        if (originalAnchor) flexWrapper.replaceWith(originalAnchor);
                        else flexWrapper.remove();
                    }
                    const gridWrapper = button.closest(".novelia-grid-wrapper");
                    if (gridWrapper) {
                        const originalText = gridWrapper.querySelector("span.n-text");
                        if (originalText) gridWrapper.replaceWith(originalText);
                        else gridWrapper.remove();
                    }
                    button.remove();
                });

                if (!skipHeaders) {
                    document.querySelectorAll(`.${HEADER_BUTTON_CLASS}`).forEach((button) => button.remove());
                    const h1Element = document.querySelector("h1");
                    if (h1Element) delete h1Element.dataset[HEADER_INJECTION_MARK];
                }
            }

            function performFullScan() {
                injectLinkButtonsToItems(document);
                injectHeaderActionButtons();
            }

            function main() {
                performFullScan();
                const mutationObserver = new MutationObserver((mutations) => {
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
            const currentHostname = location.hostname;

            function processAnchor(anchorLink) {
                if (anchorLink.dataset.noveliaSourceLinkProcessed) return;

                const linkHref = anchorLink.href;
                const linkText = anchorLink.textContent.trim();
                let sourceSiteType;
                let novelId = '';

                if (linkHref.startsWith('https://syosetu.org/novel/')) {
                    const matchResult = linkHref.match(/https:\/\/syosetu\.org\/novel\/(\d+)/);
                    if (!matchResult) return;
                    sourceSiteType = "hameln";
                    novelId = matchResult[1];
                } else if (linkHref.startsWith('https://ncode.syosetu.com/')) {
                    const matchResult = linkHref.match(/https:\/\/ncode\.syosetu\.com\/([^/]+)/);
                    if (!matchResult) return;
                    sourceSiteType = "syosetu";
                    novelId = matchResult[1];
                } else if (linkText.startsWith('https://ncode.syosetu.com/')) {
                    const matchResult = linkText.match(/https:\/\/ncode\.syosetu\.com\/([^/]+)/);
                    if (!matchResult) return;
                    sourceSiteType = "syosetu";
                    novelId = matchResult[1];
                } else if (linkText.startsWith('https://kakuyomu.jp/works/')) {
                    const matchResult = linkText.match(/https:\/\/kakuyomu\.jp\/works\/(\d+)/);
                    if (!matchResult) return;
                    sourceSiteType = "kakuyomu";
                    novelId = matchResult[1];
                } else if (linkText.startsWith('https://www.pixiv.net/novel/series/')) {
                    const matchResult = linkText.match(/https:\/\/www\.pixiv\.net\/novel\/series\/(\d+)/);
                    if (!matchResult) return;
                    sourceSiteType = "pixiv";
                    novelId = matchResult[1];
                } else {
                    return;
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

                if (currentHostname.includes("syosetu.com")) {
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
    // 5. 編輯頁面固定頁尾 (Modules.thread_footer)
    // ==========================================
    Modules.thread_footer = {
        init: function() {
            if (location.hostname !== 'n.novelia.cc') return;

            const isMobileEnvironment = !!navigator.userAgent.match(/Android|iPhone|iPad/i);

            // Selectors
            const TABS_NAV_ELEMENT_SELECTOR = ".n-tabs-nav--card-type.n-tabs-nav--top.n-tabs-nav";
            const TABS_NAV_LABEL_SELECTOR = ".n-tabs-nav-scroll-wrapper";
            const SUBMIT_BUTTON_SELECTOR = "button.n-button--primary-type.n-button--large-type.float";
            const TOOLBAR_CONTAINER_SELECTOR = ".markdown-input .n-tab-pane > .n-flex";
            const TABS_PAD_ELEMENT_SELECTOR = ".n-tabs-pad";

            // Common constants
            const MUTATION_THROTTLE_MS = 50;
            const STATE_POLLING_INTERVAL_MS = 1000;
            const COMMON_BUTTON_GAP = 8;

            // Desktop specific constants
            const SUBMIT_BUTTON_RIGHT_OFFSET = "16px";
            const SUBMIT_BUTTON_BOTTOM_OFFSET = "8px";
            const NAV_BUTTON_BG_COLOR = "#4a4a4a";
            const NAV_BUTTON_BG_HOVER_COLOR = "#5c5c5c";
            const NAV_BUTTON_BG_ACTIVE_COLOR = "#333333";
            const NAV_BUTTON_TEXT_COLOR = "#ffffff";

            // Mobile specific constants
            const MOBILE_SIDEBAR_HORIZ_GAP = 80;
            const MOBILE_SIDEBAR_VERT_GAP = 8;
            const MOBILE_BUTTON_BG = "rgba(74, 74, 74, 0.8)";
            const MOBILE_BUTTON_TEXT_COLOR = "#ffffff";

            let mutationObserverInstance = null,
                mutationDebounceTimer = null,
                currentWindowLocation = location.href,
                isFooterCollapsed = false;

            function injectStyles() {
                if (isMobileEnvironment) {
                    if (document.getElementById("tm-mobile-fixed-style")) return;
                    const styleElement = document.createElement("style");
                    styleElement.id = "tm-mobile-fixed-style";
                    styleElement.textContent = `
                        .tm-fixed-nav-active {position: fixed !important;bottom: 0 !important;left: 0 !important;right: 0 !important;width: 100% !important;z-index: 9999 !important;background: var(--n-color, #fff) !important;box-shadow: 0 -2px 8px rgba(0,0,0,.12);display: block !important;min-height: 40px;padding-bottom: env(safe-area-inset-bottom);}
                        .tm-fixed-nav-active ${TABS_PAD_ELEMENT_SELECTOR} {display: flex !important;align-items: center !important;justify-content: flex-end !important;padding-right: 8px !important;flex: 1 !important;}
                        .tm-fixed-toolbar-active {position: fixed !important;bottom: calc(40px + env(safe-area-inset-bottom)) !important;left: 0 !important;right: 0 !important;z-index: 9998 !important;background: var(--n-color, #fff) !important;border-top: 1px solid var(--n-border-color, #eee);padding: 4px 8px !important;margin-bottom: 0 !important;display: flex !important;overflow-x: auto !important;flex-wrap: nowrap !important;-webkit-overflow-scrolling: touch;gap: 4px !important;}
                        .tm-fixed-toolbar-active > button {flex: 0 0 auto !important;}
                        .tm-fixed-submit-in-pad {height: 28px !important;padding: 0 12px !important;font-size: 12px !important;margin-left: auto !important;}
                        #tm-fixed-nav-buttons {position: fixed !important;right: ${MOBILE_SIDEBAR_VERT_GAP}px !important;bottom: calc(${MOBILE_SIDEBAR_HORIZ_GAP}px + env(safe-area-inset-bottom)) !important;display: flex !important;flex-direction: column !important;gap: ${COMMON_BUTTON_GAP}px !important;z-index: 10001 !important;}
                        #tm-fixed-nav-buttons button {width: 36px;height: 36px;border-radius: 50%;border: none;background: ${MOBILE_BUTTON_BG};color: ${MOBILE_BUTTON_TEXT_COLOR};display: flex;align-items: center;justify-content: center;font-size: 18px;box-shadow: 0 2px 4px rgba(0,0,0,0.2);padding: 0;cursor: pointer;}
                        .tm-fixed-footer-collapsed {display: none !important;}
                    `;
                    document.head.appendChild(styleElement);
                } else {
                    if (document.getElementById("tm-fixed-nav-style")) return;
                    const styleElement = document.createElement("style");
                    styleElement.id = "tm-fixed-nav-style";
                    styleElement.textContent = `
                        .tm-fixed-nav-active{position:fixed!important;bottom:0!important;left:0!important;right:0!important;width:100%!important;z-index:9999!important;background:#fff;box-shadow:0 -2px 8px rgba(0,0,0,.08);display:block!important;min-height:48px;pointer-events:none!important}
                        .tm-fixed-nav-active ${TABS_NAV_LABEL_SELECTOR}{position:absolute!important;left:50%!important;top:50%!important;transform:translate(-100%,-50%)!important;flex:none!important;pointer-events:auto!important}
                        .tm-fixed-nav-active .n-tabs-nav__suffix{position:absolute!important;left:50%!important;top:50%!important;transform:translateY(-50%)!important;margin-left:0!important;pointer-events:auto!important}
                        .tm-fixed-submit-active{position:fixed!important;right:${SUBMIT_BUTTON_RIGHT_OFFSET}!important;bottom:${SUBMIT_BUTTON_BOTTOM_OFFSET}!important;left:auto!important;top:auto!important;z-index:10000!important;pointer-events:auto!important}
                        #tm-fixed-nav-buttons{position:fixed!important;display:flex!important;align-items:center!important;gap:${COMMON_BUTTON_GAP}px!important;z-index:10001!important;pointer-events:auto!important;transform:translateY(-50%)!important}
                        #tm-fixed-nav-buttons button{width:32px;height:32px;border-radius:50%;border:none;background:${NAV_BUTTON_BG_COLOR};cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;color:${NAV_BUTTON_TEXT_COLOR};padding:0;transition:background .15s,transform .15s}
                        #tm-fixed-nav-buttons button:hover{background:${NAV_BUTTON_BG_HOVER_COLOR}}
                        #tm-fixed-nav-buttons button:active{background:${NAV_BUTTON_BG_ACTIVE_COLOR};transform:scale(.92)}
                        .tm-fixed-footer-collapsed{display:none!important}
                    `;
                    document.head.appendChild(styleElement);
                }
            }

            function removeStyles() {
                const mobileStyle = document.getElementById("tm-mobile-fixed-style");
                if (mobileStyle) mobileStyle.remove();
                const desktopStyle = document.getElementById("tm-fixed-nav-style");
                if (desktopStyle) desktopStyle.remove();
            }

            function isForumEditPage() { return location.pathname.includes("/forum-edit"); }

            function createOrGetNavButtons() {
                let buttonsContainer = document.getElementById("tm-fixed-nav-buttons");
                if (buttonsContainer) return buttonsContainer;
                buttonsContainer = document.createElement("div");
                buttonsContainer.id = "tm-fixed-nav-buttons";

                if (isMobileEnvironment) {
                    const toggleCollapseBtn = document.createElement("button");
                    toggleCollapseBtn.type = "button";
                    toggleCollapseBtn.textContent = "👁";
                    toggleCollapseBtn.setAttribute("aria-label", "顯示/隱藏頁尾工具欄");
                    toggleCollapseBtn.onclick = () => { isFooterCollapsed = !isFooterCollapsed; updateUI(); };
                    buttonsContainer.appendChild(toggleCollapseBtn);
                }

                const scrollUpBtn = document.createElement("button");
                scrollUpBtn.type = "button";
                scrollUpBtn.setAttribute("aria-label", "回到頁面最上方");
                scrollUpBtn.textContent = "↑";
                scrollUpBtn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });

                const scrollDownBtn = document.createElement("button");
                scrollDownBtn.type = "button";
                scrollDownBtn.setAttribute("aria-label", "前往頁面最下方");
                scrollDownBtn.textContent = "↓";
                scrollDownBtn.onclick = () => {
                    const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
                    window.scrollTo({ top: scrollHeight, behavior: "smooth" });
                };

                buttonsContainer.appendChild(scrollUpBtn);
                buttonsContainer.appendChild(scrollDownBtn);
                document.body.appendChild(buttonsContainer);
                return buttonsContainer;
            }

            function removeNavButtons() {
                const buttonsContainer = document.getElementById("tm-fixed-nav-buttons");
                if (buttonsContainer) buttonsContainer.remove();
            }

            function positionDesktopNavButtons() {
                if (isMobileEnvironment) return;
                const buttonsContainer = document.getElementById("tm-fixed-nav-buttons");
                const navWrapper = document.querySelector(TABS_NAV_LABEL_SELECTOR);
                if (!buttonsContainer || !navWrapper) return;
                const wrapperRect = navWrapper.getBoundingClientRect();
                if (wrapperRect.width === 0 && wrapperRect.height === 0) return;
                buttonsContainer.style.left = wrapperRect.left - buttonsContainer.offsetWidth - COMMON_BUTTON_GAP + "px";
                buttonsContainer.style.top = wrapperRect.top + wrapperRect.height / 2 + "px";
            }

            function updateUI() {
                if (!isForumEditPage()) {
                    document.querySelectorAll(".tm-fixed-nav-active, .tm-fixed-toolbar-active, .tm-fixed-submit-in-pad, .tm-fixed-submit-active").forEach((element) => {
                        element.classList.remove("tm-fixed-nav-active", "tm-fixed-toolbar-active", "tm-fixed-submit-in-pad", "tm-fixed-submit-active");
                    });
                    removeNavButtons();
                    removeStyles();
                    return;
                }
                injectStyles();

                const navElement = document.querySelector(TABS_NAV_ELEMENT_SELECTOR);
                const submitBtn = document.querySelector(SUBMIT_BUTTON_SELECTOR);

                if (isMobileEnvironment) {
                    if (navElement) navElement.classList.add("tm-fixed-nav-active");

                    const toolbarElement = document.querySelector(TOOLBAR_CONTAINER_SELECTOR);
                    if (toolbarElement) toolbarElement.classList.add("tm-fixed-toolbar-active");

                    const tabsPad = document.querySelector(TABS_PAD_ELEMENT_SELECTOR);
                    if (submitBtn && tabsPad) {
                        if (submitBtn.parentElement !== tabsPad) tabsPad.appendChild(submitBtn);
                        submitBtn.classList.add("tm-fixed-submit-in-pad");
                    }

                    createOrGetNavButtons();
                    [navElement, toolbarElement, submitBtn].forEach((element) => {
                        if (element) element.classList.toggle("tm-fixed-footer-collapsed", isFooterCollapsed);
                    });
                } else {
                    if (navElement) {
                        navElement.classList.add("tm-fixed-nav-active");
                        createOrGetNavButtons();
                        positionDesktopNavButtons();
                    }
                    if (submitBtn) {
                        submitBtn.classList.add("tm-fixed-submit-active");
                    }
                    [navElement, submitBtn, document.getElementById("tm-fixed-nav-buttons")].forEach(
                        (element) => element && element.classList.toggle("tm-fixed-footer-collapsed", isFooterCollapsed)
                    );
                }
            }

            function setupMutationObservation() {
                if (mutationObserverInstance) mutationObserverInstance.disconnect();
                mutationObserverInstance = new MutationObserver(() => {
                    if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
                    mutationDebounceTimer = setTimeout(updateUI, MUTATION_THROTTLE_MS);
                });
                mutationObserverInstance.observe(document.documentElement, { childList: true, subtree: true });
            }

            function handleShortcuts(event) {
                if (isMobileEnvironment) return;
                if (!event.altKey || event.ctrlKey || event.metaKey) return;
                const keyStroke = event.key;
                if (keyStroke === "1") { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
                else if (keyStroke === "2") { event.preventDefault(); const fullHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight); window.scrollTo({ top: fullHeight, behavior: "smooth" }); }
                else if (keyStroke === "3" || keyStroke === "4") {
                    event.preventDefault();
                    const tabs = document.querySelectorAll(".n-tabs-tab");
                    const targetTabLabel = keyStroke === "3" ? "编辑" : "预览";
                    for (const tab of tabs) { if (tab.textContent.includes(targetTabLabel)) { tab.click(); break; } }
                }
                else if (/[567890]/.test(keyStroke)) {
                    event.preventDefault();
                    const navSuffix = document.querySelector(".n-tabs-nav__suffix");
                    if (navSuffix) {
                        const buttons = navSuffix.querySelectorAll("button");
                        const buttonIndex = keyStroke === "0" ? 5 : parseInt(keyStroke) - 5;
                        if (buttons[buttonIndex]) buttons[buttonIndex].click();
                    }
                }
                else if (keyStroke === "`") {
                    event.preventDefault();
                    isFooterCollapsed = !isFooterCollapsed;
                    updateUI();
                }
            }

            function main() {
                window.addEventListener("tm-locationchange", () => {
                    if (location.href === currentWindowLocation) return;
                    currentWindowLocation = location.href;
                    updateUI();
                });
                window.addEventListener("resize", () => { if (isForumEditPage()) positionDesktopNavButtons(); });
                window.addEventListener("keydown", handleShortcuts);
                setInterval(() => { if (location.href !== currentWindowLocation) updateUI(); }, STATE_POLLING_INTERVAL_MS);

                updateUI();
                setupMutationObservation();
            }

            main();
        }
    };

    runModules();

})();
