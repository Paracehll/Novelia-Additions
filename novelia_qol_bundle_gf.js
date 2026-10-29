// ==UserScript==
// @name         Novelia 體驗優化 綑綁包
// @namespace    novelia-qol-bundle
// @version      3.5.3
// @description  整合"輕小說機翻站"多種優化功能，可自訂模塊載入
// @updateURL    https://raw.githubusercontent.com/Paracehll/Novelia-Additions/refs/heads/master/novelia_qol_bundle.js
// @downloadURL  https://raw.githubusercontent.com/Paracehll/Novelia-Additions/refs/heads/master/novelia_qol_bundle.js
// @require      https://update.greasyfork.org/scripts/601266/1978720/Novelia%20Utils.js
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
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const FEATURES = [
        { id: 'banner_replace', name: '替換首頁橫幅', default: true },
        { id: 'forum_iframe', name: '內嵌論壇視窗', default: true },
        { id: 'forum_shistory', name: '論壇搜尋歷史', default: true },

        { id: 'comment_collapse', name: '摺疊評論區回覆', default: true },
        { id: 'comment_notify', name: '評論區更新排序', default: true },     

        { id: 'share_btn', name: '小說分享按鈕', default: true },
        { id: 'share_compress', name: '連結壓縮與解碼', default: true },
        { id: 'source_link', name: '源站跳轉按鈕', default: true },

        { id: 'comment_count', name: 'Web 評論數追蹤', default: true },
        { id: 'novel_inspect', name: '懸浮作品 Preview', default: true },
    ];


    const config = {};

    function initMenu() {
        FEATURES.forEach(feature => {
            const enabled = GM_getValue(`feature_${feature.id}`, feature.default);
            config[feature.id] = enabled;

            const label = `${enabled ? '✅' : '❌'} ${feature.name}`;
            Utils.gm.registerMenuCommand(label, () => {
                Utils.gm.setValue(`feature_${feature.id}`, !enabled);
                location.reload();
            });
        });
    }

    const Modules = {};

    function runModules() {
        FEATURES.forEach(feature => {
            if (config[feature.id] && Modules[feature.id]) {
                try {
                    console.log(`[Novelia QOL] Initializing ${feature.name}...`);
                    Modules[feature.id].init();
                } catch (error) { 
                    console.error(`[Novelia QOL] Failed to initialize ${feature.name}:`, error)
                }
            }
        });
    }

    initMenu();

    function injectGlobalStyles() {
        if (document.getElementById('novelia-bundle-global-styles')) return;
        const styleElement = document.createElement('style');
        Object.assign(styleElement, { id: 'novelia-bundle-global-styles',
            textContent: `
            .novelia-bundle-btn { font-weight: 400; line-height: 1; display: inline-flex; align-items: center; justify-content: center; user-select: none; cursor: pointer; text-align: center; border-radius: 3px; padding: 0 10px; height: 28px; font-size: 13px; transition: color .3s, background-color .3s, border-color .3s, opacity .3s; white-space: nowrap; vertical-align: middle; box-sizing: border-box; background-color: transparent; border: 1px solid rgba(0, 0, 0, 0.2); color: #333; gap: 6px; margin-left: 10px; }
            .novelia-bundle-btn:hover { background-color: rgba(99, 226, 183, 0.1); border-color: #63e2b7; color: #63e2b7; }
            .novelia-bundle-btn:disabled { cursor: not-allowed; opacity: 0.5; }
            .novelia-bundle-btn svg { width: 14px; height: 14px; fill: currentColor; }
            @media (prefers-color-scheme: dark) { .novelia-bundle-btn { border-color: rgba(255, 255, 255, 0.24); color: rgba(255, 255, 255, 0.82); } }
            body.dark .novelia-bundle-btn, .n-config-provider .novelia-bundle-btn { border-color: rgba(255, 255, 255, 0.24); color: rgba(255, 255, 255, 0.82); }
            .novelia-mascot { width: 80px; height: 80px; object-fit: contain; animation: novelia-float 2s ease-in-out infinite; }
            @keyframes novelia-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-16px); } }
        `});
        document.head.appendChild(styleElement);
    }
    injectGlobalStyles();

    Utils.router.init();

    // ==========================================
    // 1. Web 評論數追蹤 (Modules.comment_count)
    // ==========================================
    Modules.comment_count = {
        init: function() {
            if (location.hostname !== NoveliaConfig.domains.main) return;

            const PAGE_SIZE = 100;
            const CONCURRENCY_LIMIT = 3;
            const PAGE_FETCH_CONCURRENCY = 3;
            const COMMENT_ICON = '💬';
            const BADGE_ALIGN_ITEMS = 'auto';
            const INCREMENT_COLOR = '#63e2b7';
            const UPDATE_BUTTON_LABEL = '批次更新';
            const COUNT_REPLIES = true;
            const CACHE_REFRESH_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

            Utils.gm.addStyle(`
                .novelia-comment-badge, .novelia-h1-comment-badge { opacity: 0.85; white-space: nowrap; }
                .novelia-comment-badge { font-size: 12px; flex: 0 0 auto; margin-right: 8px; }
                .novelia-h1-comment-badge { font-size: 14px; margin-left: 8px; }
            `);

            const CommentService = {
                getFullStorage() { return Utils.localStore.get('novelia_comment_count', {}); },
                saveFullStorage(data) { Utils.localStore.set('novelia_comment_count', data); },
                getStoredEntry(source, id) {
                    const storage = this.getFullStorage();
                    return (storage[source] && storage[source][id]) || null;
                },
                saveCache(source, id, counts, previous) {
                    const { comment_count, all_comment_count } = counts;
                    const storage = this.getFullStorage();
                    if (!storage[source]) storage[source] = {};
                    storage[source][id] = {
                        prev: previous ? (previous.now ?? previous.comment_count) : comment_count,
                        prev_all: previous ? (previous.now_all ?? previous.all_comment_count) : all_comment_count,
                        now: comment_count,
                        now_all: all_comment_count,
                        update: Date.now(),
                    };
                    this.saveFullStorage(storage);
                },
                buildResultFromEntry(entry) {
                    if (!entry) return null;
                    const now = entry.now ?? entry.comment_count;
                    const nowAll = entry.now_all ?? entry.all_comment_count;
                    const prev = entry.prev ?? entry.prev_comment_count ?? now;
                    const prevAll = entry.prev_all ?? entry.prev_all_comment_count ?? nowAll;
                    const count = COUNT_REPLIES ? nowAll : now;
                    const prevCount = COUNT_REPLIES ? prevAll : prev;
                    const diff = Math.max(0, (count ?? 0) - (prevCount ?? 0));
                    return { count, diff, entry };
                },
                async fetchCommentPage(site, page, pageSize = PAGE_SIZE) {
                    const p = Math.max(1, page);
                    const ps = Math.max(1, pageSize);
                    const url = `https://${NoveliaConfig.domains.forum}/api/v1/external/comment/novel/${encodeURIComponent(site)}?page=${p}&page_size=${ps}`;
                    const response = await fetch(url, { credentials: 'same-origin' });
                    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
                    return response.json();
                },
                countItemWithReplies(item) {
                    let total = 1;
                    const repliesArray = item ? item['replies'] : null;
                    if (Array.isArray(repliesArray) && repliesArray.length > 0) {
                        for (const reply of repliesArray) total += this.countItemWithReplies(reply);
                    } else if (item && typeof item['replyCount'] === 'number') {
                        total += item['replyCount'];
                    }
                    return total;
                },
                async fetchAllPagesForReplies(site, totalPages, alreadyFetched) {
                    const results = new Array(totalPages).fill(null);
                    results[0] = alreadyFetched[0];
                    if (alreadyFetched.length > 1) results[totalPages - 1] = alreadyFetched[1];
                    const missingPages = [];
                    for (let index = 0; index < totalPages; index++) if (!results[index]) missingPages.push(index);
                    const pageLimiter = Utils.createLimiter(PAGE_FETCH_CONCURRENCY);
                    await Promise.all(missingPages.map((pageIndex) => pageLimiter(async () => { results[pageIndex] = await this.fetchCommentPage(site, pageIndex + 1); })));
                    return results;
                },
                async fetchCounts(source, id) {
                    const site = source === 'wenku' ? `wenku-${id}` : `web-${source}-${id}`;
                    const firstPage = await this.fetchCommentPage(site, 1, 1);
                    if (typeof firstPage.total === 'number') {
                        return { topCount: firstPage.total, allCount: firstPage.total };
                    }
                    const fullFirstPage = (PAGE_SIZE === 1) ? firstPage : await this.fetchCommentPage(site, 1, PAGE_SIZE);
                    const totalPages = fullFirstPage.pageNumber || fullFirstPage.totalPages || 1;
                    const items = fullFirstPage.items || fullFirstPage.data || [];
                    let topCount;
                    const alreadyFetched = [fullFirstPage];
                    if (totalPages <= 1) {
                        topCount = items.length;
                    } else {
                        const lastPage = await this.fetchCommentPage(site, totalPages, PAGE_SIZE);
                        const lastItems = lastPage.items || lastPage.data || [];
                        topCount = (totalPages - 1) * PAGE_SIZE + lastItems.length;
                        alreadyFetched.push(lastPage);
                    }
                    if (!COUNT_REPLIES) return { topCount, allCount: topCount };
                    const pages = totalPages <= 1 ? [fullFirstPage] : await this.fetchAllPagesForReplies(site, totalPages, alreadyFetched);
                    let allCount = 0;
                    for (const page of pages) if (page) for (const item of (page.items || page.data || [])) allCount += this.countItemWithReplies(item);
                    return { topCount, allCount };
                },
                pendingKeys: new Set(),
                fetchedOnceKeys: new Set(),
                async updateCommentCount(source, id) {
                    const uniqueKey = `${source}/${id}`;
                    if (this.pendingKeys.has(uniqueKey)) return null;
                    this.pendingKeys.add(uniqueKey);
                    try {
                        const previous = this.getStoredEntry(source, id);
                        const { topCount, allCount } = await this.fetchCounts(source, id);
                        this.saveCache(source, id, { comment_count: topCount, all_comment_count: allCount }, previous);
                        return this.buildResultFromEntry(this.getStoredEntry(source, id));
                    } finally {
                        this.pendingKeys.delete(uniqueKey);
                    }
                },
                async getCommentCount(source, id, { force = false, isInitial = false } = {}) {
                    const uniqueKey = `${source}/${id}`;
                    if (force) return this.updateCommentCount(source, id);
                    if (this.fetchedOnceKeys.has(uniqueKey)) return null;
                    this.fetchedOnceKeys.add(uniqueKey);
                    const cached = this.getStoredEntry(source, id);
                    if (!cached) return this.updateCommentCount(source, id);
                    const updatedAt = cached.update ?? cached.updated_at ?? 0;
                    const isStale = (Date.now() - updatedAt >= CACHE_REFRESH_INTERVAL_MS);
                    const isNewInstall = !Utils.localStore.has('novelia_comment_count');
                    if ((isInitial || isNewInstall) && isStale) return this.updateCommentCount(source, id);
                    return this.buildResultFromEntry(cached);
                }
            };
            const taskLimiter = Utils.createLimiter(CONCURRENCY_LIMIT);

            const CommentUI = {
                parseNovelPath(anchorElement) {
                    try {
                        return Utils.router.parseNovelPath(new URL(anchorElement.getAttribute('href'), location.origin).pathname);
                    } catch (error) {
                        return null;
                    }
                },
                ensureWrapper(targetElement) {
                    const existingWrapper = targetElement.closest('.novelia-comment-wrapper, .novelia-item-wrapper');
                    if (existingWrapper) return existingWrapper;
                    const wrapperElement = document.createElement('span');
                    wrapperElement.className = 'novelia-comment-wrapper';
                    Object.assign(wrapperElement.style, { alignItems: BADGE_ALIGN_ITEMS, gap: '6px' });
                    targetElement.replaceWith(wrapperElement);
                    wrapperElement.appendChild(targetElement);
                    return wrapperElement;
                },
                renderBadge(targetElement, { count, diff, text, isError = false, force = false } = {}) {
                    const wrapperElement = this.ensureWrapper(targetElement);
                    let badgeElement = wrapperElement.querySelector(':scope > .novelia-comment-badge');

                    if (badgeElement && badgeElement.dataset.noveliaLocked === '1' && !force) return;
                    if (!badgeElement) {
                        badgeElement = document.createElement('span');
                        badgeElement.className = 'novelia-comment-badge';
                        const shareButton = wrapperElement.querySelector(':scope > .novelia-copy-btn');
                        if (shareButton) shareButton.after(badgeElement);
                        else wrapperElement.prepend(badgeElement);
                    }

                    if (text !== undefined) {
                        badgeElement.textContent = text;
                        badgeElement.style.color = isError ? '#e06c75' : '';
                        delete badgeElement.dataset.noveliaRenderedText;
                        return;
                    }
                    const key = `${count}|${diff}`;
                    if (badgeElement.dataset.noveliaRenderedText === key) return;

                    Object.assign(badgeElement.dataset, { noveliaRenderedText: key, noveliaLocked: '1' });
                    badgeElement.textContent = `${COMMENT_ICON} ${count}`;
                    if (diff > 0) {
                        const incrementSpan = document.createElement('span');
                        incrementSpan.className = 'novelia-comment-diff';
                        incrementSpan.style.color = INCREMENT_COLOR;
                        incrementSpan.textContent = ` (+${diff})`;
                        badgeElement.appendChild(incrementSpan);
                    }
                },
                renderPlainBadge(targetElement, text, opts) { this.renderBadge(targetElement, { text, isError: opts?.isError }); },
                renderCountBadge(targetElement, count, diff) { this.renderBadge(targetElement, { count, diff }); },
                forceRenderCountBadge(targetElement, count, diff) { this.renderBadge(targetElement, { count, diff, force: true }); },
                isAllowedPage() { return Utils.router.isListPage() || Utils.router.isNovelPage() },
                getListTarget(anchorElement) {
                    const flexParent = anchorElement.closest('.n-flex') || anchorElement.closest('.n-grid > div');
                    if (!flexParent) return anchorElement;
                    const targets = flexParent.querySelectorAll(':scope > span, :scope > div.text-2line');
                    return targets[0] || targets[1] || anchorElement;
                },
                collectPendingAnchors() {
                    const anchors = document.querySelectorAll(`a[href]:not([data-novelia-comment-tracked])`);
                    const groupsMap = new Map();
                    anchors.forEach((anchorElement) => {
                        if (anchorElement.closest('.n-drawer')) return;
                        const novelInfo = this.parseNovelPath(anchorElement);
                        if (!novelInfo) return;
                        anchorElement.dataset['noveliaCommentTracked'] = '1';
                        const key = `${novelInfo.source}/${novelInfo.id}`;
                        if (!groupsMap.has(key)) groupsMap.set(key, { source: novelInfo.source, id: novelInfo.id, targets: [] });
                        const targetElement = this.getListTarget(anchorElement);
                        groupsMap.get(key).targets.push(targetElement);
                        const storedEntry = CommentService.getStoredEntry(novelInfo.source, novelInfo.id);
                        const result = CommentService.buildResultFromEntry(storedEntry);
                        if (result) this.renderCountBadge(targetElement, result.count, result.diff);
                        else this.renderPlainBadge(targetElement, `${COMMENT_ICON} …`);
                    });
                    return Array.from(groupsMap.values());
                },
                async processGroup(novelGroup, { isInitial = false } = {}) {
                    if (!this.isAllowedPage()) return;
                    await taskLimiter(async () => {
                        try {
                            const result = await CommentService.getCommentCount(novelGroup.source, novelGroup.id, { isInitial });
                            if (!result) return;
                            novelGroup.targets.forEach((targetElement) => this.renderCountBadge(targetElement, result.count, result.diff));
                        } catch (error) {
                            novelGroup.targets.forEach((targetElement) => this.renderPlainBadge(targetElement, `${COMMENT_ICON} ?`, { isError: true }));
                            console.error('[novelia-comments] 處理失敗:', `${novelGroup.source}/${novelGroup.id}`, error);
                        }
                    });
                },
                createH1Badge(novelKey) {
                    const badgeElement = document.createElement('span');
                    badgeElement.className = 'novelia-h1-comment-badge';
                    badgeElement.dataset.noveliaNovelKey = novelKey;
                    return badgeElement;
                },
                renderH1Badge(badgeElement, entry) {
                    const result = CommentService.buildResultFromEntry(entry);
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
                },
                createUpdateButton(source, id, novelKey, badgeElement) {
                    const buttonElement = document.createElement('button');
                    Object.assign(buttonElement, { className: 'novelia-bundle-btn novelia-update-button', innerHTML: `${Utils.icons.REFRESH}<span>刷新</span>`, title: '手動更新留言數' });
                    buttonElement.dataset.noveliaNovelKey = novelKey;
                    buttonElement.addEventListener('click', async () => {
                        if (buttonElement.disabled) return;
                        buttonElement.disabled = true;
                        const originalContent = buttonElement.innerHTML;
                        buttonElement.innerHTML = `<span>⏳ 刷新中</span>`;
                        try {
                            const result = await CommentService.getCommentCount(source, id, { force: true });
                            if (result) {
                                delete badgeElement.dataset.noveliaRenderedText;
                                this.renderH1Badge(badgeElement, result.entry);
                                this.injectH2CommentCount();
                                document.querySelectorAll('a[href][data-novelia-comment-tracked]').forEach((anchor) => {
                                    const novelInfo = this.parseNovelPath(anchor);
                                    if (novelInfo && novelInfo.source === source && novelInfo.id === id) {
                                        this.forceRenderCountBadge(this.getListTarget(anchor), result.count, result.diff);
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
                },
                injectUpdateButtonsForCurrentNovel() {
                    if (!this.isAllowedPage()) return;
                    const novelInfo = Utils.router.parseNovelPath(Utils.router.getPath());
                    if (!novelInfo) return;
                    const h1Elements = document.querySelectorAll('h1');
                    if (!h1Elements.length) return;
                    const novelKey = `${novelInfo.source}/${novelInfo.id}`;
                    const storedEntry = CommentService.getStoredEntry(novelInfo.source, novelInfo.id);
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
                            badgeElement = this.createH1Badge(novelKey);
                            updateButton = this.createUpdateButton(novelInfo.source, novelInfo.id, novelKey, badgeElement);
                            const lastHeaderButton = Array.from(h1Element.querySelectorAll('.novelia-header-btn')).pop();
                            if (lastHeaderButton) { lastHeaderButton.after(updateButton); updateButton.after(badgeElement); }
                            else { h1Element.prepend(badgeElement); h1Element.prepend(updateButton); }
                        }
                        if (badgeElement) this.renderH1Badge(badgeElement, storedEntry);
                    });
                },
                injectH2CommentCount() {
                    if (!this.isAllowedPage()) return;
                    const novelInfo = Utils.router.parseNovelPath(Utils.router.getPath());
                    if (!novelInfo) return;
                    const h2Elements = Array.from(document.querySelectorAll('h2')).filter((h2) => {
                        const text = h2.textContent.trim();
                        return text === '评论' || text === '評論' || text.startsWith('评论') || text.startsWith('評論');
                    });
                    if (!h2Elements.length) return;
                    const novelKey = `${novelInfo.source}/${novelInfo.id}`;
                    const storedEntry = CommentService.getStoredEntry(novelInfo.source, novelInfo.id);
                    h2Elements.forEach((h2Element) => {
                        if (h2Element.closest('.n-drawer')) return;
                        Object.assign(h2Element.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap' });
                        let badgeElement = h2Element.querySelector('.novelia-h1-comment-badge');
                        if (!badgeElement) {
                            badgeElement = this.createH1Badge(novelKey);
                            h2Element.appendChild(badgeElement);
                        }
                        if (badgeElement) this.renderH1Badge(badgeElement, storedEntry);
                    });
                },
                injectBulkUpdateButtons() {
                    if (!this.isAllowedPage()) {
                        const existing = document.querySelector('.novelia-bulk-update-button');
                        if (existing) existing.remove();
                        return;
                    }

                    Utils.ui.site.injectMainHeaderButton({
                        id: 'novelia-bulk-update-button',
                        title: '手動更新本頁所有留言數',
                        iconSvg: Utils.icons.BULK,
                        position: 'right',
                        onClick: async (e) => {
                            const btnElement = e.currentTarget;
                            if (btnElement.disabled) return;
                            btnElement.disabled = true;
                            const originalContent = btnElement.innerHTML;
                            btnElement.innerHTML = '<span style="font-size:12px;">⏳</span>';
                            try {
                                const anchors = document.querySelectorAll('a[href][data-novelia-comment-tracked]');
                                const groupsMap = new Map();
                                anchors.forEach((anchorElement) => {
                                    const novelInfo = this.parseNovelPath(anchorElement);
                                    if (!novelInfo) return;
                                    const key = `${novelInfo.source}/${novelInfo.id}`;
                                    if (!groupsMap.has(key)) groupsMap.set(key, { source: novelInfo.source, id: novelInfo.id, targets: new Set() });
                                    groupsMap.get(key).targets.add(this.getListTarget(anchorElement));
                                });
                                await Promise.all(Array.from(groupsMap.values()).map((novelGroup) => taskLimiter(async () => {
                                    try {
                                        const result = await CommentService.getCommentCount(novelGroup.source, novelGroup.id, { force: true });
                                        if (result) novelGroup.targets.forEach((targetElement) => this.forceRenderCountBadge(targetElement, result.count, result.diff));
                                    } catch (error) {
                                        novelGroup.targets.forEach((targetElement) => this.renderPlainBadge(targetElement, `${COMMENT_ICON} ?`, { isError: true }));
                                    }
                                })));
                                btnElement.innerHTML = originalContent;
                            } catch (error) {
                                btnElement.innerHTML = '<span style="font-size:12px;">⚠️</span>';
                                setTimeout(() => { btnElement.innerHTML = originalContent; }, 1500);
                            } finally {
                                btnElement.disabled = false;
                            }
                        }
                    });
                },
                scanPage({ isInitial = false } = {}) {
                    if (!this.isAllowedPage()) return;
                    const novelGroups = this.collectPendingAnchors();
                    novelGroups.forEach((group) => this.processGroup(group, { isInitial }));
                    this.injectUpdateButtonsForCurrentNovel();
                    this.injectH2CommentCount();
                    this.injectBulkUpdateButtons();
                }
            };

            let scanTimeoutTimer = null;
            function schedulePageScan({ isInitial = false } = {}) {
                clearTimeout(scanTimeoutTimer);
                scanTimeoutTimer = setTimeout(() => CommentUI.scanPage({ isInitial }), 200);
            }

            function observeDomChanges() {
                const observer = new MutationObserver((mutations) => {
                    if (!CommentUI.isAllowedPage()) return;
                    if (mutations.some((mutation) => mutation.addedNodes && mutation.addedNodes.length > 0 && !Utils.dom.isSelfCausedMutation(mutation))) schedulePageScan({ isInitial: false });
                });
                observer.observe(document.body, { childList: true, subtree: true });
            }

            CommentUI.scanPage({ isInitial: true });
            observeDomChanges();
            window.addEventListener("tm-locationchange", () => {
                schedulePageScan({ isInitial: false });
                setTimeout(() => CommentUI.scanPage({ isInitial: false }), 500);
            });
        }
    };

    // ==========================================
    // 2.5 內嵌論壇視窗 (Modules.forum_iframe)
    // ==========================================
    Modules.forum_iframe = {
        init: function() {
            const IS_HOST = (location.hostname === NoveliaConfig.domains.main);
            const IS_IFRAME_CONTEXT = (location.hostname === NoveliaConfig.domains.forum);
            // =========================================================
            // IFRAME CLIENT CONTEXT (forum.novelia.cc)
            // =========================================================
            if (IS_IFRAME_CONTEXT) {
                if (window.top === window.self) return;

                const HEADER_BTN_FST_GAP = '12px';
                const HEADER_BTN_INNER_GAP = '8px';

                function injectIframeStyles() {
                    Utils.gm.addStyle(`
                        aside, aside[class*="sidebar"], .web-kit-sidebar { display: none !important; }
                        .layout-toggle:not([class*="novelia-"]), button[aria-label*="sidebar"]:not([class*="novelia-"]), button[aria-label*="侧边栏"]:not([class*="novelia-"]), button[aria-label*="側邊欄"]:not([class*="novelia-"]), button[aria-label*="导航菜单"]:not([class*="novelia-"]), button[aria-label*="導航菜單"]:not([class*="novelia-"]) { display: none !important; }
                        header, .forum-header, nav[aria-label="站点导航"], nav[aria-label="站點導航"] { display: flex !important; }
                        main, body, #app { width: 100% !important; max-width: 100% !important; margin-left: 0 !important; padding-left: 0 !important; padding-bottom: 32px !important; }
                        @media (max-width: 768px) { main, body, #app { padding-bottom: 96px !important; } }
                        .novelia-host-drawer-btn { display: inline-flex !important; }
                    `, 'novelia-iframe-hide-sidebar-style');
                }
                function injectDrawerButton(forumHeader) {
                    if (!forumHeader) return null;
                    const existing = forumHeader.querySelectorAll('.novelia-host-drawer-btn');
                    if (existing.length > 1) {
                        for (let i = 1; i < existing.length; i++) existing[i].remove();
                    }
                    let btn = forumHeader.querySelector('.novelia-host-drawer-btn');
                    if (!btn) {
                        const targetContainer = forumHeader.querySelector('.layout-toggle, button[aria-label*="sidebar"], button[aria-label*="侧边栏"], button[aria-label*="側邊欄"], button[aria-label*="导航菜单"], button[aria-label*="導航菜單"]') || forumHeader.querySelector('button:not([class*="novelia-"])') || forumHeader.firstElementChild;
                        if (!targetContainer) return null;

                        btn = Utils.ui.site.createNaiveButton({
                            className: 'novelia-host-drawer-btn',
                            title: '切換側邊欄',
                            iconSize: 24,
                            margin: `0px ${HEADER_BTN_INNER_GAP}`,
                            marginRight: HEADER_BTN_FST_GAP,
                            iconSvg: Utils.icons.DRAWER,
                            onClick: () => window.parent.postMessage({ type: 'NOVELIA_TOGGLE_HOST_SIDEBAR' }, '*')
                        });
                        targetContainer.before(btn);
                    } else {
                        btn.style.marginRight = HEADER_BTN_FST_GAP;
                    }
                    return btn;
                }
                function injectPopoutButton(forumHeader, drawerBtn = null) {
                    if (!forumHeader) return null;
                    const existing = forumHeader.querySelectorAll('.novelia-forum-popout-btn');
                    if (existing.length > 1) {
                        for (let i = 1; i < existing.length; i++) existing[i].remove();
                    }
                    const refBtn = drawerBtn || forumHeader.querySelector('.novelia-host-drawer-btn');
                    let btn = forumHeader.querySelector('.novelia-forum-popout-btn');
                    if (!btn && refBtn) {
                        btn = Utils.ui.site.createNaiveButton({
                            className: 'novelia-forum-popout-btn',
                            title: '前往論壇 (取代當前頁面)',
                            iconSize: 20,
                            margin: `0px ${HEADER_BTN_INNER_GAP}`,
                            iconSvg: Utils.icons.POPOUT,
                            onClick: () => {
                                const targetUrl = location.href;
                                if (window.parent && window.parent !== window) {
                                    window.parent.postMessage({ type: 'NOVELIA_POPOUT_FORUM', url: targetUrl }, '*');
                                } else {
                                    window.location.href = targetUrl;
                                }
                            }
                        });
                        refBtn.after(btn);
                    }
                    if (btn) btn.style.display = Utils.dom.isMobile() ? 'inline-flex' : 'none';

                    return btn;
                }
                function injectFavoriteButton(forumHeader, drawerBtn = null, popoutBtn = null) {
                    if (!forumHeader) return null;
                    const existing = forumHeader.querySelectorAll('.novelia-forum-fav-btn');
                    if (existing.length > 1) {
                        for (let i = 1; i < existing.length; i++) existing[i].remove();
                    }
                    const refBtn = popoutBtn || forumHeader.querySelector('.novelia-forum-popout-btn') || drawerBtn || forumHeader.querySelector('.novelia-host-drawer-btn');
                    let btn = forumHeader.querySelector('.novelia-forum-fav-btn');
                    if (!btn && refBtn) {
                        btn = Utils.ui.site.createNaiveButton({
                            className: 'novelia-forum-fav-btn',
                            title: '我的收藏',
                            iconSize: 20,
                            margin: `0px ${HEADER_BTN_INNER_GAP}`,
                            iconSvg: Utils.icons.STAR_OUTLINE,
                            onClick: () => {
                                if (window.parent !== window) {
                                    window.parent.postMessage({ type: 'NOVELIA_NAVIGATE_HOST', path: '/favorite/web' }, '*');
                                } else {
                                    window.location.href = `https://${NoveliaConfig.domains.main}/favorite/web`;
                                }
                            }
                        });
                        refBtn.after(btn);
                    } else if (!btn) {
                        const themeBtn = Utils.ui.site.getThemeButton(forumHeader);
                        const targetContainer = themeBtn ? themeBtn.parentElement : (forumHeader.querySelector('.layout-toggle, button[aria-label*="sidebar"], button[aria-label*="侧边栏"], button[aria-label*="側邊欄"], button[aria-label*="导航菜单"], button[aria-label*="導航菜單"]') || forumHeader.querySelector('button:not([class*="novelia-"])') || forumHeader.firstElementChild);
                        if (targetContainer) {
                            btn = Utils.ui.site.createNaiveButton({
                                className: 'novelia-forum-fav-btn',
                                title: '我的收藏',
                                iconSize: 20,
                                margin: `0px ${HEADER_BTN_INNER_GAP}`,
                                iconSvg: Utils.icons.STAR_OUTLINE,
                                onClick: () => {
                                    if (window.parent !== window) {
                                        window.parent.postMessage({ type: 'NOVELIA_NAVIGATE_HOST', path: '/favorite/web' }, '*');
                                    } else {
                                        window.location.href = `https://${NoveliaConfig.domains.main}/favorite/web`;
                                    }
                                }
                            });
                            if (themeBtn) themeBtn.before(btn);
                            else targetContainer.before(btn);
                        }
                    }
                    return btn;
                }
                function injectReloadButton(forumHeader, drawerBtn = null, popoutBtn = null, favBtn = null) {
                    if (!forumHeader) return null;
                    const existing = forumHeader.querySelectorAll('.novelia-forum-reload-btn');
                    if (existing.length > 1) {
                        for (let i = 1; i < existing.length; i++) existing[i].remove();
                    }
                    const refBtn = favBtn || forumHeader.querySelector('.novelia-forum-fav-btn') || popoutBtn || forumHeader.querySelector('.novelia-forum-popout-btn') || drawerBtn || forumHeader.querySelector('.novelia-host-drawer-btn');
                    let btn = forumHeader.querySelector('.novelia-forum-reload-btn');
                    if (!btn && refBtn) {
                        btn = Utils.ui.site.createNaiveButton({
                            className: 'novelia-forum-reload-btn',
                            title: '重新載入',
                            iconSize: 20,
                            margin: `0px ${HEADER_BTN_INNER_GAP}`,
                            iconSvg: Utils.icons.RELOAD_CIRCLE,
                            onClick: () => window.location.reload()
                        });
                        refBtn.after(btn);
                    }
                    if (btn) btn.style.display = Utils.dom.isMobile() ? 'inline-flex' : 'none';

                    return btn;
                }
                function injectMobileHeaderButtons() {
                    const forumHeader = Utils.ui.site.getForumHeader();
                    if (!forumHeader) return;

                    ['.novelia-host-drawer-btn', '.novelia-forum-popout-btn', '.novelia-forum-fav-btn', '.novelia-forum-reload-btn'].forEach(selector => {
                        const btns = forumHeader.querySelectorAll(selector);
                        if (btns.length > 1) {
                            for (let i = 1; i < btns.length; i++) btns[i].remove();
                        }
                    });
                    const drawerBtn = injectDrawerButton(forumHeader);
                    const popoutBtn = injectPopoutButton(forumHeader, drawerBtn);
                    const favBtn = injectFavoriteButton(forumHeader, drawerBtn, popoutBtn);
                    const reloadBtn = injectReloadButton(forumHeader, drawerBtn, popoutBtn, favBtn);
                    
                    function placeAfter(ref, node) { if (ref && node && ref.nextElementSibling !== node) ref.after(node) }
                    placeAfter(drawerBtn, popoutBtn);
                    placeAfter(popoutBtn || drawerBtn, favBtn);
                    placeAfter(favBtn || popoutBtn || drawerBtn, reloadBtn);
                }
                let isNavigatingFromHost = false;

                function notifyHostUrlChange() {
                    if (isNavigatingFromHost) return;
                    if (window.parent !== window) {
                        const path = location.pathname + location.search + location.hash;
                        window.parent.postMessage({ type: 'NOVELIA_URL_CHANGE', path }, '*');
                    }
                }
                Utils.router.onChange(notifyHostUrlChange);
                notifyHostUrlChange();

                injectIframeStyles();
                injectMobileHeaderButtons();

                let injectTimer = null;
                let iframeObserver = null;
                function scheduleInject() {
                    if (injectTimer) return;
                    injectTimer = setTimeout(() => {
                        injectTimer = null;
                        injectMobileHeaderButtons();
                        if (iframeObserver) iframeObserver.takeRecords();
                    }, 100);
                }
                window.addEventListener('resize', scheduleInject);
                iframeObserver = new MutationObserver(scheduleInject);
                iframeObserver.observe(document.body, { childList: true, subtree: true });


                window.addEventListener('message', function(messageEvent) {
                    if (!messageEvent.data) return;
                    if (messageEvent.data.type === 'NOVELIA_NAVIGATE') {
                        const targetPath = messageEvent.data.path || '/';
                        const currentPath = location.pathname + location.search + location.hash;
                        const currentCleanPath = location.pathname;
                        const targetCleanPath = targetPath.split('?')[0].split('#')[0];
                        if (currentPath !== targetPath && currentCleanPath !== targetCleanPath) {
                            isNavigatingFromHost = true;
                            try {
                                Utils.router.push(targetPath);
                            } finally {
                                setTimeout(() => { isNavigatingFromHost = false; }, 100);
                            }
                        }
                        return;
                    }
                    if (messageEvent.data.type === 'NOVELIA_THEME_CHANGE') {
                        const isDark = !!messageEvent.data.isDark;
                        const forumIsDarkBefore = Utils.ui.site.theme.isDark();
                        if (isDark) {
                            document.documentElement.classList.add('dark');
                            document.body.classList.add('dark');
                            document.documentElement.setAttribute('data-theme', 'dark');
                        } else {
                            document.documentElement.classList.remove('dark');
                            document.body.classList.remove('dark');
                            document.documentElement.removeAttribute('data-theme');
                        }

                        const themeBtn = Utils.ui.site.getThemeButton();
                        if (themeBtn) {
                            const btnText = ((themeBtn.textContent || '') + ' ' + (themeBtn.getAttribute('aria-label') || '') + ' ' + (themeBtn.getAttribute('title') || '')).toLowerCase();
                            const isCurrentlyDarkInForum = forumIsDarkBefore || btnText.includes('浅色') || btnText.includes('淺色') || btnText.includes('亮色') || btnText.includes('light');
                            if (isDark !== isCurrentlyDarkInForum) themeBtn.click();
                        }
                    }
                });
                return;
            }
            // =========================================================
            // HOST CONTEXT (n.novelia.cc)
            // =========================================================
            if (!IS_HOST || window.top !== window.self) return;

            const originalOpen = window.open;
            let isUpdatingDom = false;
            let lastIsForum = false;
            let hostObserver = null;

            function getIframeTargetUrl() {
                const path = Utils.router.getPath();
                if (path.startsWith('/forum/')) {
                    const sub = path.substring('/forum'.length);
                    return `https://${NoveliaConfig.domains.forum}${sub}`;
                }
                return `https://${NoveliaConfig.domains.forum}/`;
            }
            function injectInlineStyles() {
                Utils.gm.addStyle(`
                    html.novelia-forum-active header, html.novelia-forum-active .n-layout-header, html.novelia-forum-active nav.n-layout-header, html.novelia-forum-active .web-kit-header { display: none !important; }
                    html.novelia-forum-active .n-layout-sider, html.novelia-forum-active .n-layout-sidebar, html.novelia-forum-active aside.n-layout-sider, html.novelia-forum-active aside.web-kit-sidebar, html.novelia-forum-active .sidebar-shell { display: flex !important; height: 100vh !important; top: 0 !important; }
                    html.novelia-forum-active, html.novelia-forum-active body, html.novelia-forum-active #app, html.novelia-forum-active .web-kit-layout, html.novelia-forum-active .n-layout-scroll-container, html.novelia-forum-active .n-layout { height: 100vh !important; overflow: hidden !important; }
                    html.novelia-forum-active main, html.novelia-forum-active .n-layout-content, html.novelia-forum-active .n-layout-content .n-layout-scroll-container, html.novelia-forum-active .n-layout-content .layout-content, html.novelia-forum-active .web-kit-main { max-width: 100% !important; width: 100% !important; height: 100% !important; padding: 0 !important; margin: 0 !important; top: 0 !important; display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; }
                    .novelia-forum-hide { display: none !important; }
                    #novelia-forum-inline-container { width: 100% !important; height: 100% !important; min-height: 100% !important; max-width: 100% !important; display: flex !important; flex-direction: column !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; overflow: hidden !important; position: relative !important; flex: 1 1 auto !important; }
                    #novelia-forum-inline-container iframe { width: 100% !important; height: 100% !important; min-height: 100% !important; border: none !important; display: block !important; opacity: 0; transition: opacity 0.3s ease-in-out; }
                    #novelia-forum-inline-container iframe.novelia-iframe-loaded { opacity: 1 !important; }
                    .novelia-forum-spinner-wrapper { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--n-text-color, #666); transition: opacity 0.3s ease-in-out; pointer-events: none; z-index: 10; }
                    .novelia-forum-spinner-wrapper.novelia-spinner-hidden { opacity: 0 !important; }
                    .novelia-forum-mascot { width: 128px; height: 128px; object-fit: contain; animation: novelia-float 2s ease-in-out infinite; }
                    @keyframes novelia-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-16px); } }
                    .n-layout-sider-toggle-button, .n-layout-sider-trigger, .n-layout-sider-toggle-bar, .n-layout-toggle-button, .sidebar-collapse { display: flex !important; z-index: 1000 !important; }
                    .n-menu--collapsed .n-menu-item-content-header, .n-layout-sider--collapsed .n-menu-item-content-header, .n-menu--collapsed .n-submenu-children, .n-layout-sider--collapsed .n-submenu-children, .n-menu--collapsed .n-menu-item-content__arrow, .n-layout-sider--collapsed .n-menu-item-content__arrow { display: none !important; }
                    .n-submenu-children.collapsed { display: none !important; }
                    .n-submenu-children.expanded { display: block !important; }
                    .n-menu-item-content-header { flex: 1 1 0%; }
                    .n-menu-item-content-header a { color: inherit; text-decoration: none; display: block; width: 100%; }
                    .novelia-forum-submenu .n-menu-item-content__arrow { margin-left: auto !important; }
                    .sidebar-submenu .web-kit-sidebar-item { padding-left: 36px !important; }
                    .novelia-forum-dropdown-popover { position: fixed; z-index: 9999; background-color: rgb(72, 72, 78) !important; border: 1px solid rgb(72, 72, 78) !important; border-radius: 4px; box-shadow: 0 3px 6px -4px rgba(0, 0, 0, .12), 0 6px 16px 0 rgba(0, 0, 0, .08), 0 9px 28px 8px rgba(0, 0, 0, .05); padding: 6px 0; min-width: 160px; display: none; flex-direction: column; }
                    .novelia-forum-dropdown-item { padding: 8px 16px; cursor: pointer; color: #ffffff !important; font-size: 14px; display: flex; align-items: center; gap: 10px; transition: background-color 0.2s, color 0.2s; }
                    .novelia-forum-dropdown-item:hover { background-color: rgba(255, 255, 255, 0.15) !important; color: #63e2b7 !important; }
                    .novelia-forum-dropdown-item svg { width: 18px; height: 18px; fill: currentColor; }
                `, 'novelia-forum-inline-styles');
            }
            function sendThemeToIframe() {
                const iframe = document.querySelector('iframe.novelia-forum-iframe');
                if (!iframe || !iframe.contentWindow) return;
                iframe.contentWindow.postMessage({ type: 'NOVELIA_THEME_CHANGE', isDark: Utils.ui.site.theme.isDark() }, '*');
            }
            function observeThemeChange() {
                const observer = new MutationObserver(() => {
                    sendThemeToIframe();
                    if (typeof queueMicrotask === 'function') queueMicrotask(sendThemeToIframe);
                    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(sendThemeToIframe);
                });

                observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
                observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
                if (document.head) observer.observe(document.head, { childList: true, subtree: true, attributes: true });
                const appEl = document.getElementById('app') || document.body;
                observer.observe(appEl, { childList: true, subtree: true, attributes: true });

                window.addEventListener('click', (e) => {
                    const btn = e.target && e.target.closest && e.target.closest('button, [role="button"], a, .n-menu-item-content, .n-layout-sider, .n-layout-header, .web-kit-sidebar-item, [class*="sider"], [class*="header"]');
                    if (btn) {
                        sendThemeToIframe();
                        if (typeof queueMicrotask === 'function') queueMicrotask(sendThemeToIframe);
                        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(sendThemeToIframe);
                        setTimeout(sendThemeToIframe, 0);
                        setTimeout(sendThemeToIframe, 20);
                        setTimeout(sendThemeToIframe, 80);
                        setTimeout(sendThemeToIframe, 200);
                        setTimeout(sendThemeToIframe, 500);
                    }
                }, true);

                try {
                    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', sendThemeToIframe);
                } catch (e) {}
            }
            function updateSelectedSubmenuItem() {
                const currentPath = Utils.router.getPath();
                const isForum = Utils.router.isForumPage();

                document.querySelectorAll('.novelia-forum-popout-btn').forEach(btn => { btn.setAttribute('href', getIframeTargetUrl()); });

                if (isForum) {
                    document.querySelectorAll('.n-menu > .n-menu-item > .n-menu-item-content, .n-menu > .n-submenu > .n-menu-item > .n-menu-item-content').forEach(content => {
                        if (!content.closest('.novelia-forum-submenu')) {
                            content.classList.remove('n-menu-item-content--selected', 'n-menu-item-content--child-active', 'n-menu-item-content--active');
                        }
                    });

                    document.querySelectorAll('.web-kit-sidebar-item').forEach(item => {
                        if (!item.closest('.novelia-forum-submenu')) {
                            item.classList.remove('bg-primary-soft', 'text-primary');
                            item.classList.add('text-ink', 'hover:bg-hover');
                            item.removeAttribute('aria-current');
                        }
                    });
                }
                document.querySelectorAll('.novelia-forum-submenu a, .novelia-forum-submenu .n-menu-item-content, .novelia-forum-submenu .web-kit-sidebar-item').forEach(item => {
                    const anchor = item.tagName === 'A' ? item : item.querySelector('a');
                    if (anchor) {
                        const href = anchor.getAttribute('href');
                        const isSelected = href && (currentPath === href || (href !== '/forum' && currentPath.startsWith(href)));
                        if (item.classList.contains('web-kit-sidebar-item') || anchor.classList.contains('web-kit-sidebar-item')) {
                            const target = anchor.classList.contains('web-kit-sidebar-item') ? anchor : item;
                            if (isSelected) {
                                target.classList.add('bg-primary-soft', 'text-primary');
                                target.classList.remove('text-ink', 'hover:bg-hover');
                                target.setAttribute('aria-current', 'page');
                            } else {
                                target.classList.remove('bg-primary-soft', 'text-primary');
                                target.classList.add('text-ink', 'hover:bg-hover');
                                target.removeAttribute('aria-current');
                            }
                        } else if (item.classList.contains('n-menu-item-content')) {
                            if (isSelected) item.classList.add('n-menu-item-content--selected');
                            else item.classList.remove('n-menu-item-content--selected');
                        }
                    }
                });
            }
            window.addEventListener('message', function(e) {
                if (!e.data) return;
                if (e.data.type === 'NOVELIA_TOGGLE_HOST_SIDEBAR') {
                    const drawerBtn = document.querySelector('button.layout-toggle, button[aria-label*="导航菜单"], button[aria-label*="導航菜單"], header button, .n-layout-header button, nav.n-layout-header button, .n-layout-sider-toggle-button, .sidebar-collapse');
                    if (drawerBtn) drawerBtn.click();
                }
                if (e.data.type === 'NOVELIA_POPOUT_FORUM') {
                    window.location.assign(e.data.url || getIframeTargetUrl());
                }
                if (e.data.type === 'NOVELIA_NAVIGATE_HOST') {
                    const rawPath = e.data.path || '/favorite/web';
                    const targetHostPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
                    Utils.router.push(targetHostPath);
                    handleForumPage();
                    updateSelectedSubmenuItem();
                }
                if (e.data.type === 'NOVELIA_URL_CHANGE') {
                    const innerPath = e.data.path || '/';
                    const targetHostPath = (innerPath === '/' || innerPath === '') ? '/forum' : '/forum' + (innerPath.startsWith('/') ? innerPath : '/' + innerPath);
                    const currentHostPath = Utils.router.getPath();
                    const iframe = document.querySelector('iframe.novelia-forum-iframe');
                    if (iframe) iframe.dataset.lastSentPath = innerPath;
                    if (currentHostPath !== targetHostPath && Utils.router.isForumPage()) {
                        if (window.__noveliaMockPath) window.__noveliaMockPath = targetHostPath;
                        else history.replaceState({}, '', targetHostPath);
                        updateSelectedSubmenuItem();
                    }
                }
            });
            function transformForumSidebarMenu() {
                injectInlineStyles();
                if (document.querySelector('.novelia-forum-submenu')) {
                    updateSelectedSubmenuItem();
                    Utils.sidebarState.syncSubmenu();
                    return;
                }

                const found = Utils.sidebar.findForumMenuItem();
                if (!found) return;

                const menuItemDiv = found.el;
                if (!menuItemDiv || menuItemDiv.dataset.noveliaSubmenuProcessed) return;

                menuItemDiv.dataset.noveliaSubmenuProcessed = '1';
                let isExpanded = Utils.localStore.getString('novelia_forum_submenu_expanded') === 'true';

                const subItems = [
                    {
                        name: '站务公告',
                        path: '/forum/c/announcements',
                        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="size-4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8zm-5.5-2.5l7.51-3.49L17.5 6.5L9.99 9.99L6.5 17.5zm5.5-6.6c.61 0 1.1.49 1.1 1.1s-.49 1.1-1.1 1.1s-1.1-.49-1.1-1.1s.49-1.1 1.1-1.1z" fill="currentColor"></path></svg>'
                    },
                    {
                        name: '小说讨论',
                        path: '/forum/c/novel',
                        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="size-4"><path d="M21 5c-1.11-.35-2.33-.5-3.5-.5c-1.95 0-4.05.4-5.5 1.5c-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5c.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5c1.35-.85 3.8-1.5 5.5-1.5c1.65 0 3.35.3 4.75 1.05c.1.05.15.05.25.05c.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5c-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5c1.2 0 2.4.15 3.5.5v11.5z" fill="currentColor"></path></svg>'
                    },
                    {
                        name: '意见反馈',
                        path: '/forum/c/feedback',
                        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="size-4"><path d="M15 4v7H5.17L4 12.17V4h11m1-2H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1zm5 4h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1z" fill="currentColor"></path></svg>'
                    },
                    {
                        name: '社区守则',
                        path: '/forum/rules',
                        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="size-4"><path d="M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H4V5h16v14z" fill-rule="evenodd" fill="currentColor"></path><path d="M19.41 10.42L17.99 9l-3.17 3.17l-1.41-1.42L12 12.16L14.82 15zM5 7h5v2H5zm0 4h5v2H5zm0 4h5v2H5z" fill-rule="evenodd" fill="currentColor"></path></svg>'
                    }
                ];
                const popover = Utils.ui.site.getForumDropdown(subItems, (item) => {
                    handleForumPage();
                    updateSelectedSubmenuItem();
                });
                let hidePopoverTimer = null;

                if (found.isWebKit) {
                    const submenuContainer = Object.assign(document.createElement('div'), {
                        className: 'novelia-forum-submenu flex flex-col gap-1 w-full'
                    });

                    const popoutBtn = Utils.ui.site.createSidebarPopoutButton({
                        href: getIframeTargetUrl(),
                        onClick: () => window.location.assign(getIframeTargetUrl())
                    });

                    const origIcon = menuItemDiv.querySelector('.grid.size-5, svg, i');
                    const headerBtn = Utils.ui.site.createSidebarGroupHeader({
                        label: '论坛',
                        isExpanded,
                        origIcon,
                        actionElements: [popoutBtn]
                    });

                    submenuContainer.appendChild(headerBtn);

                    const childrenDiv = Object.assign(document.createElement('div'), {
                        className: `sidebar-submenu ${isExpanded ? 'flex' : 'hidden'} flex-col gap-1 mt-0.5`
                    });

                    subItems.forEach(item => {
                        const link = Utils.ui.site.createSidebarSubmenuItem({
                            name: item.name,
                            path: item.path,
                            icon: item.icon,
                            onClick: () => {
                                handleForumPage();
                                updateSelectedSubmenuItem();
                            }
                        });
                        childrenDiv.appendChild(link);
                    });
                    submenuContainer.appendChild(childrenDiv);

                    headerBtn.addEventListener('mouseenter', () => {
                        Utils.sidebarState.syncSubmenu();
                        if (Utils.sidebarState.isCollapsed()) {
                            clearTimeout(hidePopoverTimer);
                            const rect = headerBtn.getBoundingClientRect();
                            Object.assign(popover.style, { top: `${rect.top}px`, left: `${rect.right + 6}px`, display: 'flex' });
                        }
                    });
                    headerBtn.addEventListener('mouseleave', () => {
                        if (Utils.sidebarState.isCollapsed()) {
                            hidePopoverTimer = setTimeout(() => {
                                if (!popover.matches(':hover')) popover.style.display = 'none';
                            }, 150);
                        }
                    });
                    headerBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (Utils.sidebarState.isCollapsed()) return;

                        isExpanded = Utils.localStore.getString('novelia_forum_submenu_expanded') !== 'true';
                        Utils.localStore.setString('novelia_forum_submenu_expanded', isExpanded ? 'true' : 'false');
                        headerBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

                        childrenDiv.classList.toggle('flex', isExpanded);
                        childrenDiv.classList.toggle('hidden', !isExpanded);
                    });
                    isUpdatingDom = true;
                    try {
                        Utils.sidebar.inject(menuItemDiv, submenuContainer, 'replace');
                        updateSelectedSubmenuItem();
                    } finally {
                        if (hostObserver) hostObserver.takeRecords();
                        isUpdatingDom = false;
                    }
                }
                popover.addEventListener('mouseleave', () => { popover.style.display = 'none'; });
                popover.addEventListener('mouseenter', () => { clearTimeout(hidePopoverTimer); });
            }
            function handleForumPage() {
                const currentlyForum = Utils.router.isForumPage();
                if (!currentlyForum) {
                    document.documentElement.classList.remove('novelia-forum-active');
                    document.body.classList.remove('novelia-forum-active');
                    document.querySelectorAll('.novelia-forum-hide').forEach(el => { el.classList.remove('novelia-forum-hide'); });

                    const existing = document.getElementById('novelia-forum-inline-container');
                    if (existing) existing.remove();
                    lastIsForum = false;
                    return;
                }
                const justEntered = !lastIsForum;
                if (justEntered) Utils.sidebarState.closeOnMobile();
                lastIsForum = true;

                injectInlineStyles();
                document.documentElement.classList.add('novelia-forum-active');
                document.body.classList.add('novelia-forum-active');

                if (justEntered) {
                    window.scrollTo(0, 0);
                    document.documentElement.scrollTop = 0;
                    document.body.scrollTop = 0;
                }

                let wrapper = document.getElementById('novelia-forum-inline-container');
                const scrollContainer = document.querySelector('main') ||
                                        document.querySelector('.n-layout-scroll-container') ||
                                        document.querySelector('.n-layout-content') ||
                                        document.querySelector('.layout-content');

                if (!scrollContainer) return;
                scrollContainer.scrollTop = 0;
                if (!wrapper) {
                    wrapper = document.createElement('div');
                    wrapper.id = 'novelia-forum-inline-container';

                    const loader = document.createElement('div');
                    Object.assign(loader, { className: 'novelia-forum-spinner-wrapper', innerHTML: `<img src="${Utils.assets.mascot.getSyncUrl()}" class="novelia-forum-mascot" alt="Loading..." /><span style="font-size: 18px; opacity: 0.8;">加载论坛中...</span>` });

                    Utils.assets.mascot.getUrl().then(mascotUrl => {
                        const mascotImg = loader.querySelector('.novelia-forum-mascot');
                        if (mascotImg) mascotImg.src = mascotUrl;
                    });

                    const iframe = document.createElement('iframe');
                    Object.assign(iframe, { className: 'novelia-forum-iframe', src: getIframeTargetUrl(), allow: 'clipboard-read; clipboard-write; autoplay; fullscreen' });

                    iframe.addEventListener('load', () => {
                        iframe.classList.add('novelia-iframe-loaded');
                        if (loader) loader.classList.add('novelia-spinner-hidden');
                        sendThemeToIframe();
                        const currentPath = Utils.router.getPath();
                        const innerPath = currentPath.startsWith('/forum') ? (currentPath.substring('/forum'.length) || '/') : '/';
                        iframe.dataset.lastSentPath = innerPath;
                        iframe.contentWindow.postMessage({ type: 'NOVELIA_NAVIGATE', path: innerPath }, '*');
                    });
                    wrapper.appendChild(loader);
                    wrapper.appendChild(iframe);
                } else {
                    const iframe = wrapper.querySelector('iframe');
                    if (iframe && iframe.contentWindow) {
                        const currentPath = Utils.router.getPath();
                        const innerPath = currentPath.startsWith('/forum') ? (currentPath.substring('/forum'.length) || '/') : '/';
                        if (iframe.dataset.lastSentPath !== innerPath) {
                            iframe.dataset.lastSentPath = innerPath;
                            iframe.contentWindow.postMessage({ type: 'NOVELIA_NAVIGATE', path: innerPath }, '*');
                        }
                    }
                }
                isUpdatingDom = true;
                try {
                    Array.from(scrollContainer.children).forEach(child => {
                        if (child !== wrapper) child.classList.add('novelia-forum-hide');
                    });
                    if (wrapper.parentElement !== scrollContainer) scrollContainer.appendChild(wrapper);
                } finally {
                    if (hostObserver) hostObserver.takeRecords();
                    isUpdatingDom = false;
                }
                sendThemeToIframe();
            }
            // Intercept click on links targeting forum or non-forum host navigation
            window.addEventListener('click', function(e) {
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || (e.button !== undefined && e.button !== 0)) return;
                if (e.target.closest('[data-novelia-popout="1"], .novelia-forum-popout-btn')) return;
                const menuItem = e.target.closest('.n-menu-item, .n-menu-item-content, .web-kit-sidebar-item');
                if (menuItem && !menuItem.closest('.novelia-forum-submenu')) {
                    const anchor = menuItem.tagName === 'A' ? menuItem : menuItem.querySelector('a');
                    if (anchor) {
                        const href = anchor.getAttribute('href') || anchor.href;
                        if (href && !Utils.router.isForumUrl(href)) {
                            let targetPath = href;
                            try {
                                const parsed = new URL(href, location.origin);
                                targetPath = parsed.pathname + parsed.search + parsed.hash;
                            } catch (err) {}

                            setTimeout(() => {
                                if (location.pathname !== targetPath) Utils.router.push(targetPath);
                                handleForumPage();
                                updateSelectedSubmenuItem();
                            }, 0);
                            return;
                        }
                    }
                    setTimeout(() => {
                        handleForumPage();
                        updateSelectedSubmenuItem();
                    }, 0);
                    return;
                }
                const anchor = e.target.closest('a');
                if (anchor) {
                    const href = anchor.getAttribute('href') || anchor.href;
                    if (Utils.router.isForumUrl(href)) {
                        e.preventDefault();
                        e.stopPropagation();

                        let targetPath = '/forum';
                        try {
                            const parsed = new URL(href, location.origin);
                            if (parsed.hostname === location.hostname) {
                                targetPath = parsed.pathname + parsed.search + parsed.hash;
                            } else if (parsed.hostname === NoveliaConfig.domains.forum) {
                                targetPath = '/forum' + parsed.pathname + parsed.search + parsed.hash;
                            }
                        } catch (err) {
                            if (href.startsWith('/forum')) targetPath = href;
                        }

                        if (location.pathname !== targetPath) {
                            Utils.router.push(targetPath);
                        }
                        handleForumPage();
                        updateSelectedSubmenuItem();
                        return;
                    } else {
                        setTimeout(() => {
                            handleForumPage();
                            updateSelectedSubmenuItem();
                        }, 0);
                    }
                }
            }, true);

            // Override window.open for forum links
            window.open = function(url, target, features) {
                if (typeof url === 'string' && Utils.router.isForumUrl(url)) {
                    let targetPath = '/forum';
                    try {
                        const parsed = new URL(url, location.origin);
                        if (parsed.hostname === location.hostname)  targetPath = parsed.pathname + parsed.search + parsed.hash;
                        else if (parsed.hostname === NoveliaConfig.domains.forum) targetPath = '/forum' + parsed.pathname + parsed.search + parsed.hash;
                    } catch (err) {
                        if (url.startsWith('/forum')) targetPath = url;
                    }
                    if (location.pathname !== targetPath) Utils.router.push(targetPath);
                    
                    handleForumPage();
                    updateSelectedSubmenuItem();
                    return null;
                }
                return originalOpen.apply(this, arguments);
            };

            window.addEventListener("tm-locationchange", () => {
                handleForumPage();
                updateSelectedSubmenuItem();
                setTimeout(handleForumPage, 100);
                setTimeout(handleForumPage, 300);
            });

            hostObserver = new MutationObserver((mutations) => {
                if (isUpdatingDom) return;
                const hasChildList = mutations.some(m => m.type === 'childList');
                if (hasChildList) {
                    Utils.sidebarState.observeToggle();
                    transformForumSidebarMenu();
                    attachSidebarClassObserver();
                    if (Utils.router.isForumPage()) handleForumPage();
                }
                Utils.sidebarState.syncSubmenu();
            });
            hostObserver.observe(document.body, { childList: true, subtree: true });

            const sidebarClassObserver = new MutationObserver(() => {
                Utils.sidebarState.syncSubmenu();
            });
            function attachSidebarClassObserver() {
                const sider = Utils.sidebar.getElement();
                if (!sider || sider.dataset.noveliaClassObserved) return;
                sider.dataset.noveliaClassObserved = '1';
                sidebarClassObserver.observe(sider, { attributes: true, attributeFilter: ['class'] });
            }
            attachSidebarClassObserver();

            Utils.gm.addStyle(`
                .web-kit-sidebar.is-collapsed .novelia-forum-submenu > .sidebar-submenu {
                    display: none !important;
                }
                .web-kit-sidebar.is-collapsed .novelia-forum-submenu > button > .web-kit-sidebar-label,
                .web-kit-sidebar.is-collapsed .novelia-forum-submenu > button > div {
                    display: none !important;
                }
            `, 'novelia-utils-sidebar-collapse');

            window.addEventListener('click', (e) => {
                if (e.target.closest('.sidebar-collapse, .n-layout-sider-toggle-button, .n-layout-sider-trigger, .n-layout-toggle-button, .web-kit-sidebar button, .brand-header button')) {                    setTimeout(() => Utils.sidebarState.syncSubmenu(), 10);
                    setTimeout(() => Utils.sidebarState.syncSubmenu(), 50);
                    setTimeout(() => Utils.sidebarState.syncSubmenu(), 150);
                }
            }, true);

            observeThemeChange();

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    transformForumSidebarMenu();
                    handleForumPage();
                });
            } else {
                transformForumSidebarMenu();
                handleForumPage();
            }
        }
    };

    // ==========================================
    // 2. 論壇搜尋歷史 (Modules.forum_shistory)
    // ==========================================
    Modules.forum_shistory = {
        init: function() {
            if (location.hostname !== NoveliaConfig.domains.forum && location.hostname !== NoveliaConfig.domains.main) return;

            const RECORD_LIMIT = 10;

            function isForumContext() {
                const hostName = location.hostname;
                if (hostName === NoveliaConfig.domains.forum) return true;
                if (hostName === NoveliaConfig.domains.main) {
                    const cleanPath = Utils.router.getPath().split('?')[0].split('#')[0];
                    if (cleanPath === '/' || !Utils.router.isForumPage()) return false;
                    return true;
                }
                return false;
            }

            function loadSearchHistory() { return Utils.localStore.get('novelia_forum_search_history', []) }
            function saveSearchHistory(historyList) { Utils.localStore.set('novelia_forum_search_history', historyList); }
            function clearSearchHistory() { saveSearchHistory([]) }

            function recordSearchEntry(boardName, queryContent, fullUrl) {
                const trimmedQuery = (queryContent || '').trim();
                if (!trimmedQuery) return;

                let historyList = loadSearchHistory();
                if (!Array.isArray(historyList)) historyList = [];

                historyList = historyList.filter((item) => {
                    return !(item.board === boardName && item.query === trimmedQuery);
                });

                historyList.unshift({
                    board: boardName,
                    query: trimmedQuery,
                    url: fullUrl || `/c/${encodeURIComponent(boardName)}?q=${encodeURIComponent(trimmedQuery)}`,
                    timestamp: Date.now()
                });

                if (historyList.length > RECORD_LIMIT) {
                    historyList = historyList.slice(0, RECORD_LIMIT);
                }

                saveSearchHistory(historyList);
            }
            function removeSearchEntry(targetIndex) {
                const historyList = loadSearchHistory();
                if (Array.isArray(historyList) && targetIndex >= 0 && targetIndex < historyList.length) {
                    historyList.splice(targetIndex, 1);
                    saveSearchHistory(historyList);
                }
            }
            function checkAndRecordCurrentUrl() {
                if (!isForumContext()) return;

                const currentPathname = Utils.router.getPath();
                const currentSearch = location.search;

                const boardMatch = currentPathname.match(/^\/c\/([^\/?#]+)/i) || currentPathname.match(/^\/forum\/c\/([^\/?#]+)/i);
                if (!boardMatch) return;

                const rawBoard = boardMatch[1].split('?')[0].split('#')[0];
                const boardName = decodeURIComponent(rawBoard);
                const urlParams = new URLSearchParams(currentSearch);
                const queryContent = urlParams.get('q');

                if (queryContent && queryContent.trim()) {
                    recordSearchEntry(boardName, queryContent.trim(), location.href);
                }
            }
            function injectStyles() {
                Utils.gm.addStyle(`
                    .novelia-shistory-wrapper { position: relative !important; display: flex !important; flex: 1 1 auto !important; width: 100% !important; }
                    .novelia-shistory-wrapper > input { position: relative !important; z-index: 2 !important; }
                    .novelia-shistory-dropdown { position: absolute !important; top: 100% !important; margin-top: 2px !important; left: 0 !important; right: 0 !important; z-index: 1 !important; background-color: var(--n-color, #ffffff) !important; border: 1px solid rgba(0, 0, 0, 0.15) !important; border-radius: 6px !important; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15) !important; overflow: hidden !important; font-size: 13px !important; max-height: 280px !important; overflow-y: auto !important; animation: novelia-shistory-slide-down 0.2s ease-out !important; transform-origin: top center !important; }
                    .novelia-shistory-dropdown.closing { animation: novelia-shistory-slide-up 0.18s ease-in forwards !important; pointer-events: none !important; }
                    @keyframes novelia-shistory-slide-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
                    @keyframes novelia-shistory-slide-up { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-8px); } }
                    .dark .novelia-shistory-dropdown, [data-theme="dark"] .novelia-shistory-dropdown { background-color: #18181c !important; border-color: rgba(255, 255, 255, 0.2) !important; color: rgba(255, 255, 255, 0.9) !important; }
                    .novelia-shistory-item { display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 8px 12px !important; cursor: pointer !important; transition: background-color 0.15s !important; }
                    .novelia-shistory-item:hover, .novelia-shistory-item.active { background-color: rgba(99, 226, 183, 0.15) !important; }
                    .novelia-shistory-item-query { flex: 1 1 auto !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; margin-right: 8px !important; font-weight: 500 !important; }
                    .novelia-shistory-item-board { font-size: 11px !important; padding: 2px 6px !important; border-radius: 4px !important; background-color: rgba(0, 0, 0, 0.06) !important; color: #666666 !important; flex-shrink: 0 !important; margin-right: 8px !important; }
                    .dark .novelia-shistory-item-board, [data-theme="dark"] .novelia-shistory-item-board { background-color: rgba(255, 255, 255, 0.1) !important; color: #bbb !important; }
                    .novelia-shistory-item-del { background: none !important; border: none !important; cursor: pointer !important; color: #999999 !important; font-size: 12px !important; padding: 2px 4px !important; border-radius: 3px !important; line-height: 1 !important; }
                    .novelia-shistory-item-del:hover { color: #e06c75 !important; background-color: rgba(224, 108, 117, 0.15) !important; }
                `, 'novelia-shistory-styles');
            }
            let activeDropdownElement = null;
            let activeHighlightedIndex = -1;

            function closeDropdown(animated = false) {
                if (activeDropdownElement) {
                    const dropdownToClose = activeDropdownElement;
                    activeDropdownElement = null;
                    activeHighlightedIndex = -1;

                    if (animated) {
                        dropdownToClose.classList.add('closing');
                        setTimeout(() => { dropdownToClose.remove() }, 180);
                    } else {
                        dropdownToClose.remove();
                    }
                }
            }
            function ensureInputWrapper(inputElement) {
                let wrapperElement = inputElement.closest('.novelia-shistory-wrapper');
                if (!wrapperElement && inputElement.parentNode) {
                    const wasFocused = document.activeElement === inputElement;
                    wrapperElement = Object.assign(document.createElement('div'), {
                        className: 'novelia-shistory-wrapper'
                    });
                    inputElement.parentNode.insertBefore(wrapperElement, inputElement);
                    wrapperElement.appendChild(inputElement);
                    if (wasFocused) { inputElement.focus() }
                }
                return wrapperElement;
            }
            function renderDropdown(inputElement) {
                closeDropdown();
                if (!isForumContext()) return;

                const historyList = loadSearchHistory();
                if (!Array.isArray(historyList) || historyList.length === 0) return;

                const wrapperElement = ensureInputWrapper(inputElement);
                if (!wrapperElement) return;

                const dropdownElement = Object.assign(document.createElement('div'), {
                    className: 'novelia-shistory-dropdown'
                });

                historyList.forEach((entryItem, entryIndex) => {
                    const itemElement = Object.assign(document.createElement('div'), {
                        className: 'novelia-shistory-item'
                    });
                    itemElement.dataset.index = String(entryIndex);

                    const querySpan = document.createElement('span');
                    Object.assign(querySpan, { className: 'novelia-shistory-item-query', textContent: entryItem.query });

                    const boardSpan = document.createElement('span');
                    Object.assign(boardSpan, { className: 'novelia-shistory-item-board', textContent: (entryItem.board || '').split('?')[0].split('#')[0] });

                    const deleteBtn = document.createElement('button');
                    Object.assign(deleteBtn, { type: 'button', className: 'novelia-shistory-item-del', textContent: '✕', title: '刪除此紀錄'});
                    deleteBtn.addEventListener('mousedown', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removeSearchEntry(entryIndex);
                        renderDropdown(inputElement);
                    });
                    itemElement.appendChild(querySpan);
                    itemElement.appendChild(boardSpan);
                    itemElement.appendChild(deleteBtn);

                    itemElement.addEventListener('mousedown', (event) => {
                        if (event.target === deleteBtn) return;
                        event.preventDefault();
                        inputElement.value = entryItem.query;
                        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                        closeDropdown();
                        inputElement.focus();
                    });
                    dropdownElement.appendChild(itemElement);
                });
                wrapperElement.appendChild(dropdownElement);
                activeDropdownElement = dropdownElement;
                activeHighlightedIndex = -1;
            }
            function updateHighlighting() {
                if (!activeDropdownElement) return;

                const items = activeDropdownElement.querySelectorAll('.novelia-shistory-item');
                items.forEach((itemElement, index) => {
                    const isHighlighted = index === activeHighlightedIndex;
                    itemElement.classList.toggle('active', isHighlighted);
                    if (isHighlighted) { itemElement.scrollIntoView({ block: 'nearest' }) }
                });
            }
            function setupSearchInputHandlers(inputElement) {
                if (!isForumContext()) return;
                if (inputElement.dataset.noveliaShistoryAttached) return;
                inputElement.dataset.noveliaShistoryAttached = '1';

                ensureInputWrapper(inputElement);

                inputElement.addEventListener('focus', () => {
                    if (!isForumContext()) {
                        closeDropdown();
                        return;
                    }
                    renderDropdown(inputElement);
                });
                inputElement.addEventListener('click', () => {
                    if (!isForumContext()) {
                        closeDropdown();
                        return;
                    }
                    if (!activeDropdownElement) { renderDropdown(inputElement) }
                });
                inputElement.addEventListener('blur', () => {
                    setTimeout(() => { closeDropdown(true) }, 180);
                });
                inputElement.addEventListener('keydown', (event) => {
                    if (!isForumContext()) {
                        closeDropdown();
                        return;
                    }
                    if (event.key === 'Enter') {
                        if (activeDropdownElement) {
                            const items = activeDropdownElement.querySelectorAll('.novelia-shistory-item');
                            const totalItems = items.length;
                            if (activeHighlightedIndex >= 0 && activeHighlightedIndex < totalItems) {
                                event.preventDefault();
                                const historyList = loadSearchHistory();
                                const selectedEntry = historyList[activeHighlightedIndex];
                                if (selectedEntry) {
                                    inputElement.value = selectedEntry.query;
                                    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                                    closeDropdown();
                                    inputElement.focus();
                                    return;
                                }
                            }
                        }
                        return;
                    }
                    if (!activeDropdownElement) {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { renderDropdown(inputElement) }
                        return;
                    }
                    const items = activeDropdownElement.querySelectorAll('.novelia-shistory-item');
                    const totalItems = items.length;
                    if (totalItems === 0) return;

                    if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        activeHighlightedIndex = (activeHighlightedIndex + 1) % totalItems;
                        updateHighlighting();
                    } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        activeHighlightedIndex = (activeHighlightedIndex - 1 + totalItems) % totalItems;
                        updateHighlighting();
                    } else if (event.key === 'Escape') {
                        closeDropdown();
                    }
                });
            }
            function findAndAttachInputs() {
                if (!isForumContext()) return;
                const inputs = document.querySelectorAll('input[type="search"], input[enterkeyhint="search"], input[placeholder*="搜索"], input[placeholder*="搜尋"]');
                inputs.forEach(setupSearchInputHandlers);
            }
            injectStyles();
            checkAndRecordCurrentUrl();
            findAndAttachInputs();

            const observer = new MutationObserver(() => {
                if (isForumContext()) { findAndAttachInputs() }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            Utils.router.onChange(() => {
                closeDropdown();
                if (document.activeElement && typeof document.activeElement.blur === 'function') {
                    document.activeElement.blur();
                }
                if (isForumContext()) {
                    setTimeout(checkAndRecordCurrentUrl, 200);
                    setTimeout(findAndAttachInputs, 200);
                }
            });
        }
    };

    // ==========================================
    // 3. 小說分享按鈕 (Modules.share_btn)
    // ==========================================
    Modules.share_btn = {
        init: function() {
            if (location.hostname !== NoveliaConfig.domains.main) return;

            const CLEAR_CACHE_KEY = { ctrl: true, alt: false, shift: false, key: "q" };
            const VIEW_CACHE_KEY = { ctrl: true, alt: false, shift: false, key: "v" };
            const BUTTON_WIDTH = "36px";
            const SHOW_HEADER_BTNS = true;

            const CACHE_CHANGE_EVENT_NAME = "novelia-cache-change",
                COPY_BUTTON_CLASS = "novelia-copy-btn",
                HEADER_BUTTON_CLASS = "novelia-header-btn",
                LIST_ITEM_SELECTOR = 'div.n-flex[role="none"]',
                LIST_WRAPPER_CLASS = "novelia-share-wrapper";

            const HEADER_BUTTONS = [
                { key: 'view',  title: '查看快取',  icon: Utils.icons.VIEW,     action: viewLinkCache,          pages: ['novel', 'list'] },
                { key: 'clear', title: '清除快取',  icon: Utils.icons.CLEAR,    action: clearLinkCache,         pages: ['novel', 'list'] },
                { key: 'copy',  title: '複製連結',  icon: Utils.icons.COPY,     action: copyCurrentNovelLink,   pages: ['novel'] },
            ];

            Utils.gm.addStyle(`
                .${COPY_BUTTON_CLASS} { position: relative; overflow: hidden; margin-right: 6px; padding: 1px 0; width: ${BUTTON_WIDTH}; font-size: 12px; cursor: pointer; background: transparent; border: 1px solid #aaa; border-radius: 4px; vertical-align: middle; opacity: .6; text-align: center; flex-shrink: 0; line-height: 1.4; transition: opacity .15s, background .15s, border-color .15s; }
                .${COPY_BUTTON_CLASS}:hover { opacity: 1; background: #eee; }
                .${COPY_BUTTON_CLASS}.flashing::after { content: ''; position: absolute; top: 50%; left: 50%; width: 10px; height: 10px; background: rgba(40, 167, 69, .4); border-radius: 50%; transform: translate(-50%, -50%); animation: novelia-ripple .4s ease-out; }
                @keyframes novelia-ripple { 0% { width: 0; height: 0; opacity: 1; } 100% { width: 120px; height: 120px; opacity: 0; } }
                .novelia-toast { position: fixed; top: -50px; left: 50%; transform: translateX(-50%); background: rgba(51, 51, 51, .95); color: #fff; padding: 14px 24px; border-radius: 8px; font-size: 14px; z-index: 99999; opacity: 0; pointer-events: none; box-shadow: 0 4px 16px rgba(0, 0, 0, .25); transition: top .3s, opacity .3s; white-space: pre-wrap; max-width: 90vw; font-family: monospace; line-height: 1.5; }
                .novelia-toast.show { top: 30px; opacity: 1; }
                .${LIST_WRAPPER_CLASS} { display: inline-flex; align-items: center; width: auto; flex-flow: row; margin-bottom: 2px; }
                .novelia-grid-wrapper { display: inline-flex; align-items: flex-start; width: 100%; }
            `);

            const toast = Utils.ui.createToast('novelia-toast');

            const CACHE_KEY = "novelia_share_link_cache";

            const LinkCache = {
                items: Utils.localStore.get(CACHE_KEY, []),
                save() {
                    Utils.localStore.set(CACHE_KEY, this.items);
                },
                add(link) {
                    if (!this.items.includes(link)) {
                        this.items.push(link);
                        this.save();
                        this.dispatch();
                        return true;
                    }
                    return false;
                },
                clear() {
                    this.items = [];
                    this.save();
                    Utils.gm.setClipboard('');
                    this.dispatch();
                },
                has(link) {
                    if (!link) return false;
                    return this.items.includes(link);
                },
                hasPath(pathname) {
                    if (!pathname) return false;
                    return this.items.some((item) => item.includes(pathname));
                },
                dispatch() {
                    document.dispatchEvent(new CustomEvent(CACHE_CHANGE_EVENT_NAME, { detail: { cache: [...this.items] } }));
                }
            };

            window.addEventListener("storage", (event) => {
                if (event.key === CACHE_KEY) {
                    LinkCache.items = Utils.localStore.get(CACHE_KEY, []);
                    LinkCache.dispatch();
                }
            });
            function writeToClipboard(text, buttonElement) {
                Utils.gm.setClipboard(text).then((success) => {
                    if (success) {
                        if (buttonElement) animateCopySuccess(buttonElement);
                    } else if (buttonElement) {
                        buttonElement.textContent = "❌";
                        setTimeout(() => { buttonElement.textContent = "📋"; }, 1550);
                    }
                });
            }

            function animateCopySuccess(buttonElement) {
                buttonElement.textContent = "✅";
                Object.assign(buttonElement.style, { opacity: "1", borderColor: "#28a745" });
                setTimeout(() => {
                    buttonElement.textContent = "📋";
                    Object.assign(buttonElement.style, { opacity: ".6", borderColor: "#aaa" });
                    buttonElement.classList.remove("flashing");
                }, 1500);
            }
            function clearLinkCache() {
                LinkCache.clear();
                toast.show("🧹 快取與剪貼簿已清空！");
            }
            function viewLinkCache() {
                if (LinkCache.items.length === 0) toast.show("ℹ️ 當前快取中沒有任何連結。");
                else toast.show(`📂 當前快取連結 (共 ${LinkCache.items.length} 條)：\n${LinkCache.items.join("\n")}`, 3500);
            }
            function createCopyButton(formattedLink) {
                const buttonElement = document.createElement("button");
                Object.assign(buttonElement, { className: COPY_BUTTON_CLASS, title: "點擊累加複製：" + formattedLink, textContent: "📋" });

                buttonElement.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    buttonElement.classList.remove("flashing");
                    void buttonElement.offsetWidth;
                    buttonElement.classList.add("flashing");
                    if (LinkCache.has(formattedLink)) {
                        toast.show("ℹ️ 此小說連結已在快取清單中！");
                        animateCopySuccess(buttonElement);
                    } else {
                        LinkCache.add(formattedLink);
                        writeToClipboard(LinkCache.items.join("\n"), buttonElement);
                    }
                });
                return buttonElement;
            }
            function injectLinkButtonsToItems(parentElement) {
                if (!Utils.router.isListPageExceptNovelDetail()) return;
                parentElement.querySelectorAll(LIST_ITEM_SELECTOR).forEach((itemElement) => {
                    if (itemElement.closest('.n-drawer') || itemElement.querySelector(`.${COPY_BUTTON_CLASS}`)) return;
                    const anchorElement = itemElement.querySelector("a[href^='/novel/']");
                    if (!anchorElement) return;
                    const textSpanElement = itemElement.querySelector(".n-text");
                    const titleText = textSpanElement ? textSpanElement.textContent.trim() : anchorElement.textContent.trim();
                    const linkHref = anchorElement.getAttribute("href");
                    if (!titleText || !linkHref) return;

                    const formattedLink = `[${titleText}](https://${NoveliaConfig.domains.main}${linkHref})`;
                    if (LinkCache.has(formattedLink)) return;

                    const copyBtn = createCopyButton(formattedLink);
                    let wrapper = anchorElement.closest(`.${LIST_WRAPPER_CLASS}`);
                    if (!wrapper) {
                        wrapper = Object.assign(document.createElement('div'), {
                            className: LIST_WRAPPER_CLASS
                        });
                        anchorElement.replaceWith(wrapper);
                        wrapper.appendChild(copyBtn);
                        wrapper.appendChild(anchorElement);
                    } else if (!wrapper.querySelector(`.${COPY_BUTTON_CLASS}`)) {
                        wrapper.prepend(copyBtn);
                    }
                });

                parentElement.querySelectorAll(".n-grid a[href*='/wenku/']").forEach((anchorElement) => {
                    if (anchorElement.closest('.n-drawer') || anchorElement.querySelector(`.${COPY_BUTTON_CLASS}`)) return;
                    const textSpanElement = anchorElement.querySelector(".n-text");
                    if (!textSpanElement) return;
                    const titleText = textSpanElement.textContent.trim();
                    const linkHref = anchorElement.getAttribute("href");
                    if (!titleText || !linkHref) return;

                    const formattedLink = `[${titleText}](https://${NoveliaConfig.domains.main}${linkHref})`;
                    if (LinkCache.has(formattedLink)) return;

                    const parentPaddingDiv = textSpanElement.parentElement && textSpanElement.parentElement.style.padding ? textSpanElement.parentElement : textSpanElement.closest('div[style*="padding:"]');
                    if (parentPaddingDiv) {
                        parentPaddingDiv.dataset.noveliaOrigPadding = parentPaddingDiv.style.padding;
                        parentPaddingDiv.style.padding = "8px 0px 8px 0px";
                    }

                    const copyBtn = createCopyButton(formattedLink);

                    const gridWrapperDiv = Object.assign(document.createElement('div'), {
                        className: 'novelia-grid-wrapper'
                    });
                    textSpanElement.replaceWith(gridWrapperDiv);
                    gridWrapperDiv.appendChild(copyBtn);
                    gridWrapperDiv.appendChild(textSpanElement);
                });
            }
            function getCurrentNovelFormattedLink() {
                if (!Utils.router.isNovelPage()) return null;
                const pathname = Utils.router.getPathname();
                const isWenku = pathname.startsWith('/wenku/');
                const titleEl = isWenku ? document.querySelector('h2') : document.querySelector('h3');
                const titleText = titleEl ? titleEl.textContent.trim() : '';
                if (!titleText) return null;
                return `[${titleText}](https://${NoveliaConfig.domains.main}${pathname})`;
            }
            function copyCurrentNovelLink() {
                const formattedLink = getCurrentNovelFormattedLink();
                if (!formattedLink) {
                    toast.show("⚠️ 未能找到小說標題！");
                    return;
                }
                if (LinkCache.has(formattedLink)) {
                    toast.show("ℹ️ 此小說連結已在快取清單中！");
                    injectHeaderActionButtons();
                } else {
                    LinkCache.add(formattedLink);
                    writeToClipboard(LinkCache.items.join("\n"));
                    toast.show(`📋 已複製小說連結：\n${formattedLink}`);
                }
            }
            function shouldDisplayHeaderButtons() {
                return (
                    !0 === SHOW_HEADER_BTNS ||
                    (!1 !== SHOW_HEADER_BTNS &&
                        (navigator.maxTouchPoints > 0 || window.matchMedia("(pointer:coarse)").matches))
                );
            }
            function injectHeaderActionButtons() {
                if (!shouldDisplayHeaderButtons()) return;

                const pageType = Utils.router.isNovelPage() ? 'novel'
                    : Utils.router.isListPageExceptNovelDetail() ? 'list'
                    : null;

                const currentPath = Utils.router.getPathname();
                const currentFormattedLink = getCurrentNovelFormattedLink();

                HEADER_BUTTONS.forEach(({ key, title, icon, action, pages }) => {
                    const cls = `novelia-share-${key}-btn`;

                    if (!pages.includes(pageType)) {
                        document.querySelectorAll(`.${cls}`).forEach((el) => el.remove());
                        return;
                    }

                    if (key === 'copy') {
                        const isCached = (currentFormattedLink && LinkCache.has(currentFormattedLink)) || (currentPath && LinkCache.hasPath(currentPath));
                        if (isCached) {
                            document.querySelectorAll(`.${cls}`).forEach((el) => el.remove());
                            return;
                        }
                    }

                    Utils.ui.site.injectMainHeaderButton({
                        id: cls,
                        className: `${HEADER_BUTTON_CLASS} ${cls}`,
                        title,
                        iconSvg: icon,
                        position: 'left',
                        onClick: () => action()
                    });
                });
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
            });
            document.addEventListener(CACHE_CHANGE_EVENT_NAME, () => {
                if (Utils.router.isListPageExceptNovelDetail()) {
                    removeStaleButtons(true);
                }
                performFullScan();
            });

            function removeStaleButtons(skipHeaders = false) {
                document.querySelectorAll(`.${LIST_WRAPPER_CLASS}`).forEach((wrapper) => {
                    const anchor = wrapper.querySelector('a');
                    if (anchor) wrapper.replaceWith(anchor);
                    else wrapper.remove();
                });

                document.querySelectorAll('.novelia-grid-wrapper').forEach((wrapper) => {
                    const originalText = wrapper.querySelector(".n-text");
                    if (originalText) {
                        const parentPaddingDiv = originalText.parentElement && originalText.parentElement.dataset.noveliaOrigPadding !== undefined ? originalText.parentElement : originalText.closest('div[data-novelia-orig-padding]');
                        if (parentPaddingDiv) {
                            parentPaddingDiv.style.padding = parentPaddingDiv.dataset.noveliaOrigPadding;
                            delete parentPaddingDiv.dataset.noveliaOrigPadding;
                        }
                        wrapper.replaceWith(originalText);
                    } else wrapper.remove();
                });

                document.querySelectorAll(`.${COPY_BUTTON_CLASS}`).forEach((button) => button.remove());

                if (!skipHeaders) {
                    document.querySelectorAll(`.${HEADER_BUTTON_CLASS}`).forEach((button) => button.remove());
                }
            }
            function performFullScan() {
                if (Utils.router.isNovelPage()) {
                    removeStaleButtons(true);
                    injectHeaderActionButtons();
                    return;
                }
                if (!Utils.router.isListPageExceptNovelDetail()) {
                    removeStaleButtons();
                    return;
                }
                injectLinkButtonsToItems(document);
                injectHeaderActionButtons();
            }
            performFullScan();
            window.addEventListener("tm-locationchange", () => { setTimeout(performFullScan, 200); });

            const mutationObserver = new MutationObserver((mutations) => {
                if (Utils.router.isNovelPage()) {
                    injectHeaderActionButtons();
                    return;
                }
                if (!Utils.router.isListPageExceptNovelDetail()) {
                    if (document.querySelector(`.${COPY_BUTTON_CLASS}`) || document.querySelector(`.${HEADER_BUTTON_CLASS}`)) removeStaleButtons();
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
    };

    // ==========================================
    // 3.5 連結壓縮與解碼 (Modules.share_compress)
    // ==========================================
    Modules.share_compress = {
        init: function() {
            if (location.hostname !== DOMAINS.HOST) return;

            class ShareCompressModalManager {
                constructor() {
                    this.backdropElement = null;
                    this.modalElement = null;
                    this.stylesInjected = false;
                    this.toast = Utils.ui.createToastManager('novelia-toast');
                    this.URL_PREFIX_MAP = [
                        ['https://n.novelia.cc/novel/', 'N|'],
                        ['https://n.novelia.cc/wenku/', 'W|'],
                        ['https://n.novelia.cc/forum/', 'F|'],
                        ['https://n.novelia.cc/', 'H|'],
                        ['https://forum.novelia.cc/', 'f|'],
                        ['https://', 's|'],
                        ['http://', 'h|']
                    ];
                }

                injectStyles() {
                    if (this.stylesInjected) return;
                    Utils.gm.addStyle(`
                        .novelia-compress-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.4); z-index: 99999; display: none; }
                        .novelia-compress-backdrop.show { display: block; }
                        .novelia-compress-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90vw; max-width: 540px; max-height: 85vh; background-color: #ffffff; color: #333333; border: 1px solid rgba(0, 0, 0, 0.15); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); padding: 18px 20px; font-size: 13px; z-index: 100000; display: none; flex-direction: column; gap: 14px; box-sizing: border-box; overflow-y: auto; }
                        .dark .novelia-compress-modal, [data-theme="dark"] .novelia-compress-modal, body.dark .novelia-compress-modal { background-color: #1e1e22; color: rgba(255, 255, 255, 0.9); border-color: rgba(255, 255, 255, 0.2); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6); }
                        .novelia-compress-modal.show { display: flex; }
                        .novelia-compress-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(0, 0, 0, 0.08); padding-bottom: 10px; }
                        .dark .novelia-compress-header, [data-theme="dark"] .novelia-compress-header, body.dark .novelia-compress-header { border-bottom-color: rgba(255, 255, 255, 0.12); }
                        .novelia-compress-title { font-size: 16px; font-weight: 600; }
                        .novelia-compress-close { background: transparent; border: none; font-size: 20px; line-height: 1; color: #888; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
                        .novelia-compress-close:hover { color: #333; background: rgba(0, 0, 0, 0.05); }
                        .dark .novelia-compress-close:hover, [data-theme="dark"] .novelia-compress-close:hover, body.dark .novelia-compress-close:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
                        .novelia-compress-tabs { display: flex; gap: 8px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); padding-bottom: 8px; }
                        .dark .novelia-compress-tabs, [data-theme="dark"] .novelia-compress-tabs, body.dark .novelia-compress-tabs { border-bottom-color: rgba(255, 255, 255, 0.12); }
                        .novelia-compress-tab { padding: 6px 14px; border-radius: 4px; cursor: pointer; border: none; background: transparent; color: inherit; font-size: 13px; font-weight: 500; transition: background 0.2s, color 0.2s; }
                        .novelia-compress-tab.active { background-color: #63e2b7; color: #18181c !important; font-weight: 600; }
                        .novelia-compress-section { display: flex; flex-direction: column; gap: 10px; }
                        .novelia-compress-section.hidden { display: none !important; }
                        .novelia-compress-textarea { width: 100%; height: 110px; padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(0, 0, 0, 0.2); background: transparent; color: inherit; font-family: monospace; font-size: 12px; resize: vertical; box-sizing: border-box; }
                        .dark .novelia-compress-textarea, [data-theme="dark"] .novelia-compress-textarea, body.dark .novelia-compress-textarea { border-color: rgba(255, 255, 255, 0.2); background: rgba(0, 0, 0, 0.2); }
                        .novelia-compress-textarea:focus { outline: none; border-color: #63e2b7; }
                        .novelia-compress-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
                        .novelia-compress-btn-action { display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 12px; font-size: 12px; font-weight: 500; border-radius: 4px; cursor: pointer; border: 1px solid rgba(0, 0, 0, 0.2); background: transparent; color: inherit; transition: background 0.2s, border-color 0.2s; }
                        .novelia-compress-btn-action:hover { background-color: rgba(99, 226, 183, 0.15); border-color: #63e2b7; color: #63e2b7; }
                        .dark .novelia-compress-btn-action, [data-theme="dark"] .novelia-compress-btn-action, body.dark .novelia-compress-btn-action { border-color: rgba(255, 255, 255, 0.2); }
                        .novelia-compress-primary-btn { background-color: #63e2b7; color: #18181c !important; border: none; font-weight: 600; }
                        .novelia-compress-primary-btn:hover { background-color: #7fe7c4; opacity: 0.9; }
                        .novelia-compress-label { font-size: 12px; font-weight: 600; opacity: 0.85; margin-bottom: 2px; }
                    `, 'novelia-compress-styles');
                    this.stylesInjected = true;
                }

                compactUrl(targetUrl) {
                    for (const [fullPrefix, shortPrefix] of this.URL_PREFIX_MAP) {
                        if (targetUrl.startsWith(fullPrefix)) {
                            return shortPrefix + targetUrl.slice(fullPrefix.length);
                        }
                    }
                    return targetUrl;
                }

                expandUrl(compactedUrl) {
                    for (const [fullPrefix, shortPrefix] of this.URL_PREFIX_MAP) {
                        if (compactedUrl.startsWith(shortPrefix)) {
                            return fullPrefix + compactedUrl.slice(shortPrefix.length);
                        }
                    }
                    return compactedUrl;
                }

                async compressText(inputStr) {
                    const lines = inputStr.split('\n').map((line) => this.compactUrl(line.trim())).filter(Boolean);
                    const compactedStr = lines.join('\n');
                    const stream = new Blob([compactedStr]).stream().pipeThrough(new CompressionStream('deflate-raw'));
                    const buffer = await new Response(stream).arrayBuffer();
                    const bytes = new Uint8Array(buffer);
                    let binary = '';
                    for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
                    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                }

                async decompressCode(compressedCode) {
                    let base64 = compressedCode.trim().replace(/-/g, '+').replace(/_/g, '/');
                    while (base64.length % 4) base64 += '=';
                    const binary = atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
                    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                    const buffer = await new Response(stream).arrayBuffer();
                    const decompressedStr = new TextDecoder().decode(buffer);
                    return decompressedStr.split('\n').map((line) => this.expandUrl(line.trim())).join('\n');
                }

                extractAndDeduplicateLinks(textContent) {
                    if (!textContent) return [];
                    const matches = [];
                    const mdRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
                    let mdMatch;
                    while ((mdMatch = mdRegex.exec(textContent)) !== null) {
                        matches.push({
                            type: 'md',
                            index: mdMatch.index,
                            length: mdMatch[0].length,
                            url: mdMatch[2].trim()
                        });
                    }

                    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
                    let urlMatch;
                    while ((urlMatch = urlRegex.exec(textContent)) !== null) {
                        const urlIndex = urlMatch.index;
                        const urlStr = urlMatch[1].trim();
                        const isInsideMd = matches.some((existing) => existing.type === 'md' && urlIndex >= existing.index && urlIndex < (existing.index + existing.length));
                        if (!isInsideMd) {
                            matches.push({
                                type: 'url',
                                index: urlIndex,
                                length: urlMatch[0].length,
                                url: urlStr
                            });
                        }
                    }

                    matches.sort((first, second) => first.index - second.index);

                    const items = [];
                    const seenUrls = new Set();
                    for (const item of matches) {
                        const normalizedUrl = item.url.toLowerCase().replace(/\/$/, '');
                        if (!seenUrls.has(normalizedUrl)) {
                            seenUrls.add(normalizedUrl);
                            items.push(item.url);
                        }
                    }
                    return items;
                }

                createModal() {
                    if (this.modalElement) return;

                    this.backdropElement = document.createElement('div');
                    this.backdropElement.className = 'novelia-compress-backdrop';
                    this.backdropElement.addEventListener('click', () => this.close());

                    this.modalElement = document.createElement('div');
                    this.modalElement.className = 'novelia-compress-modal';

                    this.modalElement.innerHTML = `
                        <div class="novelia-compress-header">
                            <span class="novelia-compress-title">📦 連結壓縮 / 解碼</span>
                            <button type="button" class="novelia-compress-close" aria-label="Close">&times;</button>
                        </div>
                        <div class="novelia-compress-section">
                            <div class="novelia-compress-label">小說連結列表 (URLs)：</div>
                            <textarea class="novelia-compress-textarea novelia-compress-urls" placeholder="請貼上小說網址（每行一個，如 https://n.novelia.cc/novel/...）..."></textarea>

                            <div class="novelia-compress-actions">
                                <button type="button" class="novelia-compress-btn-action novelia-compress-load-cache">載入 Share 快取</button>
                                <button type="button" class="novelia-compress-btn-action novelia-compress-primary-btn novelia-compress-btn-down" title="將上方的連結壓縮為下方代碼">⬇ 壓縮 (上➔下)</button>
                                <button type="button" class="novelia-compress-btn-action novelia-compress-primary-btn novelia-compress-btn-up" title="將下方的代碼解碼為上方連結">⬆ 解碼 (下➔上)</button>
                            </div>

                            <div class="novelia-compress-label">壓縮碼 (Code)：</div>
                            <textarea class="novelia-compress-textarea novelia-compress-code" placeholder="請貼上壓縮碼..."></textarea>

                            <div class="novelia-compress-actions">
                                <button type="button" class="novelia-compress-btn-action novelia-compress-copy-urls">複製網址列表</button>
                                <button type="button" class="novelia-compress-btn-action novelia-compress-copy-code">複製壓縮碼</button>
                            </div>
                        </div>
                    `;

                    document.body.appendChild(this.backdropElement);
                    document.body.appendChild(this.modalElement);

                    this.modalElement.querySelector('.novelia-compress-close').addEventListener('click', () => this.close());

                    const urlsInput = this.modalElement.querySelector('.novelia-compress-urls');
                    const codeInput = this.modalElement.querySelector('.novelia-compress-code');

                    const handleCompressDown = async () => {
                        const rawUrls = urlsInput.value.trim();
                        if (!rawUrls) {
                            this.toast.show("⚠️ 請先在上方框貼上小說連結。");
                            return;
                        }
                        const extracted = this.extractAndDeduplicateLinks(rawUrls);
                        if (extracted.length === 0) {
                            this.toast.show("⚠️ 未偵測到有效的小說連結。");
                            return;
                        }
                        urlsInput.value = extracted.join('\n');
                        try {
                            const compressedCode = await this.compressText(extracted.join('\n'));
                            codeInput.value = compressedCode;
                            await Utils.gm.setClipboard(compressedCode);
                            this.toast.show(`✅ 已成功壓縮 (${extracted.length} 條) 並複製壓縮碼！`);
                        } catch (error) {
                            this.toast.show("❌ 壓縮失敗: " + error.message);
                        }
                    };

                    const handleDecodeUp = async () => {
                        let sourceCode = codeInput.value.trim();
                        if (!sourceCode) {
                            sourceCode = urlsInput.value.trim();
                        }
                        if (!sourceCode) {
                            this.toast.show("⚠️ 請先貼上壓縮碼。");
                            return;
                        }
                        try {
                            const restoredUrls = await this.decompressCode(sourceCode);
                            urlsInput.value = restoredUrls;
                            await Utils.gm.setClipboard(restoredUrls);
                            this.toast.show("✅ 已成功解碼並複製網址列表！");
                        } catch (error) {
                            this.toast.show("⚠️ 無法解碼，請確認壓縮碼格式是否正確。");
                        }
                    };

                    this.modalElement.querySelector('.novelia-compress-btn-down').addEventListener('click', handleCompressDown);
                    this.modalElement.querySelector('.novelia-compress-btn-up').addEventListener('click', handleDecodeUp);

                    this.modalElement.querySelector('.novelia-compress-copy-urls').addEventListener('click', async () => {
                        const content = urlsInput.value.trim();
                        if (!content) {
                            this.toast.show("⚠️ 沒有可複製的網址列表。");
                            return;
                        }
                        await Utils.gm.setClipboard(content);
                        this.toast.show("📋 網址列表已複製到剪貼簿！");
                    });

                    this.modalElement.querySelector('.novelia-compress-copy-code').addEventListener('click', async () => {
                        const content = codeInput.value.trim();
                        if (!content) {
                            this.toast.show("⚠️ 沒有可複製的壓縮碼。");
                            return;
                        }
                        await Utils.gm.setClipboard(content);
                        this.toast.show("📋 壓縮碼已複製到剪貼簿！");
                    });

                    this.modalElement.querySelector('.novelia-compress-load-cache').addEventListener('click', async () => {
                        const cacheItems = window.noveliaShareCache || [];
                        if (!Array.isArray(cacheItems) || cacheItems.length === 0) {
                            this.toast.show("ℹ️ 目前沒有可載入的快取連結。");
                            return;
                        }
                        const extractedUrls = this.extractAndDeduplicateLinks(cacheItems.join('\n'));
                        urlsInput.value = extractedUrls.join('\n');
                        this.toast.show(`✅ 已載入 ${extractedUrls.length} 條快取連結！`);
                    });
                }

                open() {
                    this.injectStyles();
                    this.createModal();
                    if (this.backdropElement) this.backdropElement.classList.add('show');
                    if (this.modalElement) this.modalElement.classList.add('show');
                }

                close() {
                    if (this.backdropElement) this.backdropElement.classList.remove('show');
                    if (this.modalElement) this.modalElement.classList.remove('show');
                }
            }

            const shareCompressModal = new ShareCompressModalManager();

            function injectHeaderButton() {
                Utils.ui.site.injectMainHeaderButton({
                    id: 'novelia-top-compress-btn',
                    title: '連結壓縮 / 解碼',
                    iconSvg: Utils.icons.ZIP,
                    position: 'right',
                    onClick: () => shareCompressModal.open()
                });
            }

            document.addEventListener('novelia-cache-change', (event) => {
                if (event.detail && Array.isArray(event.detail.cache)) {
                    window.noveliaShareCache = event.detail.cache;
                }
            });

            function scanAndInject() {
                injectHeaderButton();
            }

            scanAndInject();
            window.addEventListener("tm-locationchange", () => { setTimeout(scanAndInject, 200); });

            const observer = new MutationObserver(scanAndInject);
            observer.observe(document.body, { childList: true, subtree: true });
        }
    };

    // ==========================================
    // 4. 源站跳轉按鈕 (Modules.source_link)
    // ==========================================
    Modules.source_link = {
        init: function() {
            if (location.hostname.includes(NoveliaConfig.domains.main) || location.hostname.includes(NoveliaConfig.domains.forum)) return;
            const currentHostName = location.hostname;

            function parseSourceUrl(url, text) {
                if (!url || url.includes(NoveliaConfig.domains.main)) return null;
                const syosetuRegex = /https?:\/\/(ncode|novel18)\.syosetu\.com\/([^/]+)/;
                const hamelnRegex = /https?:\/\/syosetu\.org\/novel\/(\d+)/;

                let match = url.match(syosetuRegex) || text.match(syosetuRegex);
                if (match) return { siteType: 'syosetu', novelId: match[2] };

                match = url.match(hamelnRegex) || text.match(hamelnRegex);
                if (match) return { siteType: 'hameln', novelId: match[1] };

                return null;
            }

            function processAnchor(anchorLink) {
                if (anchorLink.dataset.noveliaSourceLinkProcessed) return;
                const parsed = parseSourceUrl(anchorLink.href, anchorLink.textContent.trim());
                if (!parsed) return;
                anchorLink.dataset.noveliaSourceLinkProcessed = "1";

                const jumpBtn = Object.assign(document.createElement('button'), {
                    textContent: '↗'
                });
                jumpBtn.style.cssText = 'margin-left:6px;border:none;background:none;cursor:pointer;font-size:14px;color:#007BFF;';
                jumpBtn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(`https://${NoveliaConfig.domains.main}/novel/${parsed.siteType}/${parsed.novelId}`, '_blank');
                });

                if (currentHostName.includes('syosetu.com')) anchorLink.appendChild(jumpBtn);
                else anchorLink.insertAdjacentElement('afterend', jumpBtn);
            }

            function scanAllAnchors(rootElement = document) {
                rootElement.querySelectorAll('a').forEach(processAnchor);
            }
            scanAllAnchors();

            const observer = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.tagName === 'A') processAnchor(node);
                            else scanAllAnchors(node);
                        }
                    });
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    };

    // ==========================================
    // 6. 摺疊評論區回覆 (Modules.comment_collapse)
    // ==========================================
    Modules.comment_collapse = {
        init: function() {
            if (location.hostname !== NoveliaConfig.domains.main && location.hostname !== NoveliaConfig.domains.forum) return;

            Utils.gm.addStyle(`
                .novelia-collapse-btn-wrapper { margin-top: 8px; display: flex; align-items: center; }
                .novelia-collapse-btn { background: transparent; border: none; cursor: pointer; padding: 0 6px 0 0; font-size: 12px; display: flex; align-items: center; color: var(--n-text-color); opacity: 0.8; transition: opacity 0.2s, background-color 0.2s; border-radius: 2px; }
                .novelia-collapse-btn:hover { opacity: 1; background-color: rgba(0, 0, 0, 0.05); }
                .dark .novelia-collapse-btn:hover { background-color: rgba(255, 255, 255, 0.1); }
                .novelia-collapse-icon { transition: transform 0.3s ease; margin-right: 4px; display: flex; align-items: center; }
                .novelia-collapse-icon.collapsed { transform: rotate(0deg); }
                .novelia-collapse-icon.expanded { transform: rotate(90deg); }
                .novelia-collapse-replies-wrapper { display: grid; transition: grid-template-rows 0.3s ease-in-out; overflow: hidden; }
                .novelia-collapse-replies-wrapper.collapsed { grid-template-rows: 0fr; }
                .novelia-collapse-replies-wrapper.expanded { grid-template-rows: 1fr; }
                .novelia-collapse-replies-inner { overflow: hidden; display: flow-root; }
            `);

            const LS_KEY = 'novelia_collapsed_comments';
            let collapsedStore = Utils.localStore.get(LS_KEY, {});
            function saveStore() { Utils.localStore.set(LS_KEY, collapsedStore); }

            const CollapseUI = {
                createCollapseWrapper: Utils.comments.createCollapsibleReplies
            };

            const NovelCommentCollapse = {
                getContext() {
                    const path = Utils.router.getPath();
                    const matchNovel = path.match(/^\/novel\/([^\/?#]+)\/([^\/?#]+)/i);
                    if (matchNovel) return { provider: matchNovel[1], id: matchNovel[2] };

                    const matchWenku = path.match(/^\/wenku\/([^\/?#]+)/i);
                    if (matchWenku) return { provider: 'wenku', id: matchWenku[1] };

                    return null;
                },
                isCollapsed(context, hash) {
                    if (!hash || !context) return false;
                    const list = collapsedStore[context.provider]?.[context.id];
                    return Array.isArray(list) && list.includes(hash);
                },
                setCollapsed(context, hash, collapsedState) {
                    if (!hash || !context) return;
                    if (collapsedState) {
                        if (!collapsedStore[context.provider]) collapsedStore[context.provider] = {};
                        if (!Array.isArray(collapsedStore[context.provider][context.id])) { collapsedStore[context.provider][context.id] = []; }
                        const list = collapsedStore[context.provider][context.id];
                        if (!list.includes(hash)) list.push(hash);
                    } else {
                        if (collapsedStore[context.provider] && Array.isArray(collapsedStore[context.provider][context.id])) {
                            const list = collapsedStore[context.provider][context.id];
                            const index = list.indexOf(hash);
                            if (index !== -1) list.splice(index, 1);
                            if (list.length === 0) delete collapsedStore[context.provider][context.id];
                            if (Object.keys(collapsedStore[context.provider]).length === 0) delete collapsedStore[context.provider];
                        }
                    }
                    saveStore();
                },
                getReplyCount(repliesArea) {
                    if (!repliesArea) return 0;
                    const subReplies = repliesArea.querySelectorAll('div[style*="margin-left: 32px"], article.ml-8, article[class*="ml-"]');
                    if (subReplies.length > 0) return subReplies.length;
                    if (repliesArea.matches('div[style*="margin-left: 32px"], article.ml-8, article[class*="ml-"]')) return 1;
                    const articles = repliesArea.querySelectorAll('article');
                    if (articles.length > 0) return articles.length;
                    return repliesArea.querySelectorAll('.n-flex').length;
                },
                processFloor(floor) {
                    try {
                        const headerFlex = floor.headerFlex;
                        const commentHeader = floor.commentHeader;
                        const card = floor.card;
                        const repliesArea = floor.repliesArea;
                        if (!headerFlex || !commentHeader || !card) return;

                        if (headerFlex.dataset.noveliaCollapseProcessed) {
                            const btnWrapper = card.nextElementSibling;
                            if (!btnWrapper || !btnWrapper.classList.contains('novelia-collapse-btn-wrapper')) return;

                            const wrapper = btnWrapper.nextElementSibling;
                            if (!wrapper || !wrapper.classList.contains('novelia-collapse-replies-wrapper')) return;

                            const inner = wrapper.querySelector('.novelia-collapse-replies-inner');
                            const currentRepliesArea = inner ? inner.firstElementChild : null;
                            if (!currentRepliesArea) return;

                            const replyCount = NovelCommentCollapse.getReplyCount(currentRepliesArea);
                            if (replyCount === 0) {
                                wrapper.parentNode.insertBefore(currentRepliesArea, wrapper);
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

                        if (!repliesArea) return;

                        const replyCount = NovelCommentCollapse.getReplyCount(repliesArea);
                        if (replyCount === 0) return;

                        headerFlex.dataset.noveliaCollapseProcessed = "true";

                        const author = commentHeader.innerText.trim();
                        const time = headerFlex.querySelector('time')?.innerText || "";
                        const rawId = author + time;
                        const commentId = Utils.text.hash(rawId);

                        const context = NovelCommentCollapse.getContext();
                        const isCollapsedState = NovelCommentCollapse.isCollapsed(context, commentId);

                        CollapseUI.createCollapseWrapper({
                            anchorCard: card,
                            repliesArea,
                            isCollapsedState,
                            replyCount,
                            onToggleState: (newCollapsed) => NovelCommentCollapse.setCollapsed(context, commentId, newCollapsed)
                        });
                    } catch (error) {
                        console.error('[Novelia Bundle] Error processing novel comment thread:', error);
                    }
                },
                processSectionFloor(floor) {
                    try {
                        const rootArticle = floor.rootArticle;
                        if (!rootArticle) return;
                        if (rootArticle.classList.contains('ml-6') || rootArticle.className.includes('ml-') || rootArticle.classList.contains('ml-8')) return;

                        if (rootArticle.dataset.noveliaCollapseProcessed) {
                            const btnWrapper = rootArticle.nextElementSibling;
                            if (!btnWrapper || !btnWrapper.classList.contains('novelia-collapse-btn-wrapper')) return;

                            const wrapper = btnWrapper.nextElementSibling;
                            if (!wrapper || !wrapper.classList.contains('novelia-collapse-replies-wrapper')) return;

                            const inner = wrapper.querySelector('.novelia-collapse-replies-inner');
                            const currentRepliesArea = inner ? inner.firstElementChild : null;
                            if (!currentRepliesArea) return;

                            const replyCount = NovelCommentCollapse.getReplyCount(currentRepliesArea);
                            if (replyCount === 0) {
                                wrapper.parentNode.insertBefore(currentRepliesArea, wrapper);
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

                        const repliesArea = floor.repliesArea;
                        if (!repliesArea) return;

                        const replyCount = NovelCommentCollapse.getReplyCount(repliesArea);
                        if (replyCount === 0) return;
                        rootArticle.dataset.noveliaCollapseProcessed = "true";

                        let commentId = rootArticle.id ? rootArticle.id.replace(/^comment-/, '') : '';
                        if (!commentId) {
                            const author = rootArticle.querySelector('header span')?.innerText.trim() || "";
                            const time = rootArticle.querySelector('time')?.innerText.trim() || "";
                            const rawId = author + time;
                            commentId = Utils.text.hash(rawId);
                        }
                        const context = NovelCommentCollapse.getContext();
                        const isCollapsedState = NovelCommentCollapse.isCollapsed(context, commentId);

                        CollapseUI.createCollapseWrapper({
                            anchorCard: rootArticle,
                            repliesArea,
                            isCollapsedState,
                            replyCount,
                            onToggleState: (newCollapsed) => NovelCommentCollapse.setCollapsed(context, commentId, newCollapsed)
                        });
                    } catch (error) {
                        console.error('[Novelia Bundle] Error processing novel section comment thread:', error);
                    }
                },
                scan() {
                    const floors = Utils.comments.novel.getFloors();
                    floors.forEach(NovelCommentCollapse.processFloor);

                    const { floors: sectionFloors } = Utils.comments.forum.getFloors();
                    sectionFloors.forEach(NovelCommentCollapse.processSectionFloor);
                },
                init() {
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

            const ForumCommentCollapse = {
                getContext() {
                    const path = Utils.router.getPath();
                    const match = path.match(/^\/p\/([^\/?#]+)/i);
                    if (match) return { id: match[1] };
                    return null;
                },
                isCollapsed(context, hash) {
                    if (!hash || !context) return false;
                    const list = collapsedStore[context.id];
                    return Array.isArray(list) && list.includes(hash);
                },
                setCollapsed(context, hash, collapsedState) {
                    if (!hash || !context) return;
                    if (collapsedState) {
                        if (!Array.isArray(collapsedStore[context.id])) collapsedStore[context.id] = [];
                        const list = collapsedStore[context.id];
                        if (!list.includes(hash)) list.push(hash);
                    } else {
                        if (Array.isArray(collapsedStore[context.id])) {
                            const list = collapsedStore[context.id];
                            const index = list.indexOf(hash);
                            if (index !== -1) list.splice(index, 1);
                            if (list.length === 0) delete collapsedStore[context.id];
                        }
                    }
                    saveStore();
                },
                processFloor(floor) {
                    try {
                        const rootArticle = floor.rootArticle;
                        if (!rootArticle) return;
                        if (rootArticle.classList.contains('ml-6') || rootArticle.className.includes('ml-')) return;
                        if (rootArticle.dataset.noveliaCollapseProcessed) {
                            const btnWrapper = rootArticle.nextElementSibling;
                            if (!btnWrapper || !btnWrapper.classList.contains('novelia-collapse-btn-wrapper')) return;

                            const wrapper = btnWrapper.nextElementSibling;
                            if (!wrapper || !wrapper.classList.contains('novelia-collapse-replies-wrapper')) return;

                            const inner = wrapper.querySelector('.novelia-collapse-replies-inner');
                            const currentRepliesArea = inner ? inner.firstElementChild : null;
                            if (!currentRepliesArea) return;

                            const replyCount = currentRepliesArea.querySelectorAll('article').length;
                            if (replyCount === 0) {
                                wrapper.parentNode.insertBefore(currentRepliesArea, wrapper);
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

                        const repliesArea = floor.repliesArea;
                        if (!repliesArea) return;

                        const replyCount = repliesArea.querySelectorAll('article').length;
                        if (replyCount === 0) return;
                        rootArticle.dataset.noveliaCollapseProcessed = "true";

                        let commentId = rootArticle.id ? rootArticle.id.replace(/^comment-/, '') : '';
                        if (!commentId) {
                            const author = rootArticle.querySelector('header span')?.innerText.trim() || "";
                            const time = rootArticle.querySelector('time')?.innerText.trim() || "";
                            const rawId = author + time;
                            commentId = Utils.text.hash(rawId);
                        }
                        const context = ForumCommentCollapse.getContext();
                        const isCollapsedState = ForumCommentCollapse.isCollapsed(context, commentId);

                        CollapseUI.createCollapseWrapper({
                            anchorCard: rootArticle,
                            repliesArea,
                            isCollapsedState,
                            replyCount,
                            onToggleState: (newCollapsed) => ForumCommentCollapse.setCollapsed(context, commentId, newCollapsed)
                        });
                    } catch (error) {
                        console.error('[Novelia Bundle] Error processing forum section:', error);
                    }
                },
                scan() {
                    const { floors } = Utils.comments.forum.getFloors();
                    floors.forEach(ForumCommentCollapse.processFloor);
                },
                init() {
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

            if (location.hostname.includes(NoveliaConfig.domains.forum)) ForumCommentCollapse.init();
            else NovelCommentCollapse.init();
        }
    };

    // ==========================================
    // 7. 評論區更新排序 (Modules.comment_notify)
    // ==========================================
    Modules.comment_notify = {
        init: function() {
            if (location.hostname !== NoveliaConfig.domains.main && location.hostname !== NoveliaConfig.domains.forum) return;

            let isUpdatingDom = false;
            let lastUrl = location.href;

            function extractMinAge(nodes) {
                let min = Infinity;
                nodes.forEach(node => {
                    const times = Array.from(node.querySelectorAll('time'));
                    if (node.tagName === 'TIME') times.push(node);
                    times.forEach(timeElement => {
                        const sec = Utils.time.parseRelativeToSeconds(timeElement.textContent);
                        if (sec < min) min = sec;
                    });
                });
                return min;
            }

            function clearCurrentComments() {
                isUpdatingDom = true;
                try {
                    const novelFloors = Utils.comments.novel.getFloors();
                    novelFloors.forEach(floor => {
                        floor.nodes.forEach(node => node.remove());
                    });

                    const { candidateFloors } = Utils.comments.forum.getFloors();
                    candidateFloors.forEach(floor => floor.remove());
                } finally {
                    isUpdatingDom = false;
                }
            }

            function reorderFloorList(container, floors, refNode) {
                if (floors.length <= 1) return;
                const sorted = [...floors].sort((floorA, floorB) => {
                    if (floorA.minSeconds !== floorB.minSeconds) return floorA.minSeconds - floorB.minSeconds;
                    return floorA.originalIndex - floorB.originalIndex;
                });
                if (!floors.some((floor, index) => floor !== sorted[index])) return;

                isUpdatingDom = true;
                try {
                    sorted.forEach(floor => {
                        const nodes = floor.nodes || [floor.element];
                        nodes.forEach(node => {
                            if (refNode) container.insertBefore(node, refNode);
                            else container.appendChild(node);
                        });
                    });
                } finally {
                    isUpdatingDom = false;
                }
            }

            function processNovelComments() {
                const floors = Utils.comments.novel.getFloors();
                if (floors.length <= 1) return;

                const commonParent = floors[0].commonParent;
                if (!commonParent) return;

                floors.forEach(floor => {
                    floor.minSeconds = extractMinAge(floor.nodes);
                });

                const lastFloor = floors[floors.length - 1];
                const lastNode = lastFloor.nodes[lastFloor.nodes.length - 1];
                reorderFloorList(commonParent, floors, lastNode ? lastNode.nextElementSibling : null);
            }

            function processForumComments() {
                const { floorContainer, candidateFloors, floors } = Utils.comments.forum.getFloors();
                if (!floorContainer || candidateFloors.length <= 1) return;

                floors.forEach(floor => {
                    floor.minSeconds = extractMinAge([floor.element]);
                });

                reorderFloorList(floorContainer, floors, candidateFloors[candidateFloors.length - 1].nextElementSibling);
            }

            function runSort() {
                if (isUpdatingDom || !Utils.router.isCommentableDetailPage()) return;
                const { candidateFloors } = Utils.comments.forum.getFloors();
                if (candidateFloors && candidateFloors.length > 0) processForumComments();
                else processNovelComments();
            }

            let scanTimer = null;
            function scheduleSort() {
                clearTimeout(scanTimer);
                scanTimer = setTimeout(runSort, 150);
            }

            function setupSpaUrlObserver() {
                Utils.router.onChange(onUrlChange);
                window.addEventListener('message', event => {
                    if (event.data && (event.data.type === 'NOVELIA_URL_CHANGE' || event.data.type === 'NOVELIA_NAVIGATE')) onUrlChange();
                });
                window.addEventListener('click', event => {
                    if (event.target.closest && event.target.closest('.n-tabs-tab, [class*="tab"]')) scheduleSortWithRetries();
                    if (event.target.closest && event.target.closest('.n-pagination, [class*="pagination"]')) {
                        clearCurrentComments();
                        scheduleSortWithRetries();
                    }
                }, true);

                setInterval(() => { if (location.href !== lastUrl) onUrlChange(); }, 300);
            }

            function scheduleSortWithRetries() {
                scheduleSort();
                setTimeout(scheduleSort, 300);
                setTimeout(scheduleSort, 600);
                setTimeout(scheduleSort, 1200);
            }

            function onUrlChange() {
                lastUrl = location.href;
                if (Utils.router.isCommentableDetailPage()) scheduleSortWithRetries();
            }

            const observer = new MutationObserver(() => { if (!isUpdatingDom && Utils.router.isCommentableDetailPage()) scheduleSort(); });
            observer.observe(document.body, { childList: true, subtree: true });

            setupSpaUrlObserver();
            scheduleSortWithRetries();
        }
    };

    // ==========================================
    // 8. 替換首頁橫幅 (Modules.banner_replace)
    // ==========================================
    Modules.banner_replace = {
        init: function() {
            // block og banner image request to avoid loading the original banner
            if (Utils && Utils.network && typeof Utils.network.block === 'function') {
                Utils.network.block({ domain: (typeof NoveliaConfig !== 'undefined' && NoveliaConfig.domains.cdn) || 'n-cdn.novelia.cc', key: '/banners/', isImage: true });
            }
            if (location.hostname !== NoveliaConfig.domains.main) return;

            const IMG_URL = 'https://n.novelia.cc/files-extra/banner.v1.webp';
            // const IMG_FIT = 'cover';
            const IMG_POSITION = '50% 50%';
            const IMG_SIZE = '100%';    // 可接受 'cover'、'contain'
            const IMG_SIZE_MOBILE = '200%';
            const IMG_SCROLLING = true;
            const IMG_SCROLL_SPD = 20;
            const REMOVE_CYCLE_IMG_BTN = true;
            const FADEIN_ANIMATION = true;

            function getBannerUrl() { return GM_getValue('banner_url', IMG_URL); }
            // function getObjectFit() { return GM_getValue('banner_object_fit', IMG_FIT); }
            function getObjectPosition() { return GM_getValue('banner_object_position', IMG_POSITION); }
            function getBannerSize() { return GM_getValue('banner_size', IMG_SIZE); }
            function getBannerSizeMobile() { return GM_getValue('banner_size_mobile', IMG_SIZE_MOBILE); }
            function getScrolling() { return GM_getValue('banner_scrolling', IMG_SCROLLING); }
            function getScrollSpd() { return Number(GM_getValue('banner_scroll_spd', IMG_SCROLL_SPD)) || 0; }
            function getRemoveCycleImgBtn() { return GM_getValue('banner_remove_cycle_btn', REMOVE_CYCLE_IMG_BTN); }
            function getFadeInAnimation() { return GM_getValue('banner_fadein_animation', FADEIN_ANIMATION); }

            let offsetY = 0;
            let lastTime = 0;
            let rafId = 0;
            let activeLayer = null;

            function tick(now) {
                rafId = 0;
                if (!activeLayer || !activeLayer.isConnected) { activeLayer = null; return; }
                if (!lastTime) lastTime = now;
                const dt = Math.min((now - lastTime) / 1000, 0.1);
                lastTime = now;
                offsetY -= getScrollSpd() * dt;

                if (Math.abs(offsetY) > 1e6) offsetY = 0;
                const x = activeLayer.dataset.posX || '50%';
                activeLayer.style.backgroundPosition = `${x} ${offsetY}px`;
                rafId = requestAnimationFrame(tick);
            }

            function startScroll(layer) {
                activeLayer = layer;
                if (!rafId) { lastTime = 0; rafId = requestAnimationFrame(tick); }
            }

            function stopScroll() {
                activeLayer = null;
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            }

            function replaceBanner() {
                const cleanPath = Utils.router.getPath().split('?')[0].split('#')[0];
                if (cleanPath !== '/') { stopScroll(); return; }

                const bannerImg = document.querySelector('img[src*="/banners/"], img[src*="banner"], div.relative.overflow-hidden > img, div[class*="overflow-hidden"] > img');
                if (bannerImg) bannerImg.src = "";
                let container = bannerImg ? bannerImg.parentElement : document.querySelector('div[data-banner-locked="1"]');
                if (!container) return;

                if (!container.dataset.bannerLocked) {
                    const containerRect = container.getBoundingClientRect();
                    if (containerRect.width > 0 && containerRect.height > 0) {
                        Object.assign(container.style, { aspectRatio: `${containerRect.width} / ${containerRect.height}`, height: 'auto', width: '100%' });
                        container.dataset.bannerLocked = '1';
                    } else {
                        return;
                    }
                }
                if (bannerImg) bannerImg.remove();
                
                // 移除原本的橫幅輪轉按鈕，可能會加回來，並新增自訂橫幅列表
                if (getRemoveCycleImgBtn()) {
                    const cycleButton = container.querySelector('button[title*="切换下一张"], button[aria-label*="切换下一张"], button[title*="切換下一張"], button[aria-label*="切換下一張"]') || document.querySelector('button[title*="切换下一张"], button[aria-label*="切换下一张"], button[title*="切換下一張"], button[aria-label*="切換下一張"]');
                    if (cycleButton) cycleButton.remove();
                }
                Object.assign(container.style, { position: 'relative', overflow: 'hidden', overflowAnchor: 'none' });
                
                // const targetFit = getObjectFit();
                const targetPosition = getObjectPosition();
                const targetSize = Utils.dom.isMobile() ? getBannerSizeMobile() : getBannerSize();
                const scrolling = getScrolling();

                let layer = container.querySelector(':scope > .banner-scroll-layer');
                if (!layer) {
                    layer = Object.assign(document.createElement('div'), {
                        className: 'banner-scroll-layer'
                    });
                    Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', willChange: 'background-position' });
                    container.appendChild(layer);
                }
                const bannerUrl = getBannerUrl();
                const cssUrl = `url("${bannerUrl}")`;
                if (layer.style.backgroundImage !== cssUrl) {
                    layer.style.backgroundImage = cssUrl;

                    if (getFadeInAnimation()) {
                        Object.assign(layer.style, { transition: 'none', opacity: '0' });
                        layer.dataset.bannerSrc = bannerUrl;

                        const reveal = () => {
                            if (!layer.isConnected || layer.dataset.bannerSrc !== bannerUrl) return;
                            void layer.offsetWidth;
                            Object.assign(layer.style, { transition: 'opacity 0.1s ease', opacity: '1' });
                        };
                        const preload = new Image();
                        Object.assign(preload, { onload: reveal, onerror: reveal, src: bannerUrl });
                    } else {
                        Object.assign(layer.style, { transition: '', opacity: '1' });
                    }
                }
                const computedBackgroundSize = (targetSize === 'cover' || targetSize === 'contain' || targetSize.includes(' ')) ? targetSize : `${targetSize} auto`;
                layer.style.backgroundSize = computedBackgroundSize;

                if (!scrolling) {
                    stopScroll();
                    layer.style.backgroundRepeat = 'no-repeat';
                    layer.style.backgroundPosition = targetPosition || '50% 50%';
                    return;
                }
                layer.style.backgroundRepeat = 'repeat-y';
                layer.dataset.posX = (targetPosition || '50% 50%').split(/\s+/)[0];

                if (activeLayer !== layer) startScroll(layer);
            }
            replaceBanner();

            const observer = new MutationObserver(() => { replaceBanner() });
            observer.observe(document.body, { childList: true, subtree: true });
            Utils.router.onChange(replaceBanner);
        }
    };

    // ==========================================
    // 9. 懸浮 Preview (Modules.novel_inspect)
    // ==========================================
    Modules.novel_inspect = {
        _initialized: false,
        _hostListenerSet: false,
        _iframeListenerSet: false,
        init: function() {
            if (this._initialized) return;
            if (location.hostname !== NoveliaConfig.domains.main && location.hostname !== NoveliaConfig.domains.forum) return;
            this._initialized = true;

            const self = this;
            const cache = new Map();
            let panelElement = null;
            let backdropElement = null;
            let currentAnchorElement = null;

            const DB_NAME = 'novelia_qol_db';
            const DB_VERSION = 1;
            const STORE_NAME = 'preview_cache';
            const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

            async function getIndexedDbCache(cacheKey) {
                return await Utils.cache.idb.get(cacheKey, { dbName: DB_NAME, version: DB_VERSION, storeName: STORE_NAME, ttlMs: CACHE_TTL_MS });
            }
            async function setIndexedDbCache(cacheKey, data) {
                return await Utils.cache.idb.set(cacheKey, data, { dbName: DB_NAME, version: DB_VERSION, storeName: STORE_NAME, keyPath: 'key' });
            }
            function injectStyles() {
                Utils.gm.addStyle(`
                    .novelia-inspect-panel { position: fixed; z-index: 99999; width: 360px; max-width: 90vw; background-color: #ffffff; color: #333333; border: 1px solid rgba(0, 0, 0, 0.15); border-radius: 8px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15); padding: 12px 14px; font-size: 13px; line-height: 1.5; pointer-events: none; transition: opacity 0.05s ease-out; opacity: 0; box-sizing: border-box; }
                    .dark .novelia-inspect-panel, [data-theme="dark"] .novelia-inspect-panel, body.dark .novelia-inspect-panel { background-color: #1e1e22; color: rgba(255, 255, 255, 0.9); border-color: rgba(255, 255, 255, 0.2); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5); }
                    .novelia-inspect-panel.show { opacity: 1; pointer-events: auto; }
                    .novelia-inspect-panel.mobile-mode { position: fixed; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) !important; width: 88vw !important; max-width: 380px !important; max-height: 85vh !important; overflow-y: auto !important; z-index: 100000 !important; }
                    .novelia-inspect-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.4); z-index: 99999; display: none; }
                    .novelia-inspect-backdrop.show { display: block; }
                    .novelia-inspect-close-btn { position: absolute; top: 8px; right: 10px; background: transparent; border: none; font-size: 20px; line-height: 1; color: #888888; cursor: pointer; padding: 4px; z-index: 10; }
                    .dark .novelia-inspect-close-btn, [data-theme="dark"] .novelia-inspect-close-btn, body.dark .novelia-inspect-close-btn { color: #aaaaaa; }
                    .novelia-inspect-action-bar { display: flex; gap: 8px; margin-top: 14px; width: 100%; box-sizing: border-box; }
                    .novelia-inspect-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex: 1; padding: 8px 12px; font-weight: 600; font-size: 13px; border-radius: 6px; text-decoration: none !important; box-sizing: border-box; text-align: center; transition: background-color 0.2s, opacity 0.2s; cursor: pointer; }
                    .novelia-inspect-open-btn { background-color: rgba(0, 0, 0, 0.08); color: #333333 !important; }
                    .dark .novelia-inspect-open-btn, [data-theme="dark"] .novelia-inspect-open-btn, body.dark .novelia-inspect-open-btn { background-color: rgba(255, 255, 255, 0.12); color: #ffffff !important; }
                    .novelia-inspect-goto-btn { background-color: #63e2b7; color: #18181c !important; }
                    .novelia-inspect-goto-btn:hover, .novelia-inspect-goto-btn:active { background-color: #7fe7c4; opacity: 0.9; }
                    .dark .novelia-inspect-goto-btn, [data-theme="dark"] .novelia-inspect-goto-btn, body.dark .novelia-inspect-goto-btn { background-color: #63e2b7; color: #18181c !important; }
                    .novelia-inspect-panel .n-h, .novelia-inspect-panel .n-h3 { font-size: 15px; font-weight: 600; margin: 0 0 4px 0; color: #111111; word-break: break-word; line-height: 1.4; }
                    .dark .novelia-inspect-panel .n-h, .dark .novelia-inspect-panel .n-h3, [data-theme="dark"] .novelia-inspect-panel .n-h, body.dark .novelia-inspect-panel .n-h { color: #ffffff; }
                    .novelia-inspect-panel .n-a { color: inherit; text-decoration: none; }
                    .novelia-inspect-panel .n-a:hover { text-decoration: underline; color: #63e2b7; }
                    .novelia-inspect-panel .n-divider { margin: 8px 0; border: none; border-top: 1px solid rgba(0, 0, 0, 0.08); }
                    .dark .novelia-inspect-panel .n-divider, [data-theme="dark"] .novelia-inspect-panel .n-divider, body.dark .novelia-inspect-panel .n-divider { border-top-color: rgba(255, 255, 255, 0.12); }
                    .novelia-inspect-panel .metadata-stat { font-size: 12px; color: #666666; margin-bottom: 8px; }
                    .dark .novelia-inspect-panel .metadata-stat, [data-theme="dark"] .novelia-inspect-panel .metadata-stat, body.dark .novelia-inspect-panel .metadata-stat { color: #aaaaaa; }
                    .novelia-inspect-panel .n-p { font-size: 12px; color: #444444; line-height: 1.5; margin-top: 12px; white-space: pre-wrap; }
                    .dark .novelia-inspect-panel .n-p, [data-theme="dark"] .novelia-inspect-panel .n-p, body.dark .novelia-inspect-panel .n-p { color: #bbbbbb; }
                    .novelia-inspect-panel .n-tag { display: inline-flex; align-items: center; font-size: 11px; padding: 2px 6px; border-radius: 3px; background-color: rgba(0, 0, 0, 0.06); color: #333333; line-height: 1.2; text-decoration: none; }
                    .dark .novelia-inspect-panel .n-tag, [data-theme="dark"] .novelia-inspect-panel .n-tag, body.dark .novelia-inspect-panel .n-tag { background-color: rgba(99, 226, 183, 0.15); color: #63e2b7; }
                    .novelia-inspect-panel .n-tag b { font-weight: 600; }
                    .novelia-inspect-loading { color: #888888; font-style: italic; }
                    .novelia-inspect-mascot-wrapper { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px; padding: 16px 0; }
                `, 'novelia-inspect-styles');
            }
            function getOrCreateBackdrop() {
                if (!backdropElement) {
                    backdropElement = document.querySelector('.novelia-inspect-backdrop');
                    if (!backdropElement) {
                        backdropElement = Object.assign(document.createElement('div'), {
                            className: 'novelia-inspect-backdrop'
                        });
                        document.body.appendChild(backdropElement);
                    }
                    backdropElement.addEventListener('click', hidePanel);
                }
                return backdropElement;
            }
            function getOrCreatePanel() {
                if (!panelElement) {
                    panelElement = document.querySelector('.novelia-inspect-panel');
                    if (!panelElement) {
                        panelElement = Object.assign(document.createElement('div'), {
                            className: 'novelia-inspect-panel'
                        });
                        document.body.appendChild(panelElement);
                    }
                }
                return panelElement;
            }
            function updatePosition(clientX, clientY) {
                if (!panelElement) return;
                const offsetDistance = 15;
                const panelWidth = panelElement.offsetWidth || 340;
                const panelHeight = panelElement.offsetHeight || 150;
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;

                let leftPos = clientX + offsetDistance;
                let topPos = clientY + offsetDistance;

                if (leftPos + panelWidth > viewportWidth - 10) {
                    leftPos = clientX - panelWidth - offsetDistance;
                    if (leftPos < 10) leftPos = 10;
                }
                if (topPos + panelHeight > viewportHeight - 10) {
                    topPos = clientY - panelHeight - offsetDistance;
                    if (topPos < 10) topPos = 10;
                }
                Object.assign(panelElement.style, { left: `${leftPos}px`, top: `${topPos}px` });
            }
            function hidePanel() {
                if (panelElement) {
                    panelElement.classList.remove('show');
                    panelElement.classList.remove('mobile-mode');
                }
                if (backdropElement) {
                    backdropElement.classList.remove('show');
                }
                currentAnchorElement = null;
            }
            function parseTargetUrl(href) {
                if (!href) return null;
                try {
                    const parsedUrl = new URL(href, location.origin);
                    if (parsedUrl.hostname !== NoveliaConfig.domains.main && parsedUrl.hostname !== location.hostname) return null;

                    const novelMatch = parsedUrl.pathname.match(/^\/novel\/([^\/?#]+)\/([^\/?#]+)/i);
                    if (novelMatch) {
                        return { type: 'novel', provider: novelMatch[1], id: novelMatch[2], cacheKey: `novel/${novelMatch[1]}/${novelMatch[2]}` };
                    }

                    const wenkuMatch = parsedUrl.pathname.match(/^\/wenku\/([^\/?#]+)/i);
                    if (wenkuMatch) {
                        return { type: 'wenku', id: wenkuMatch[1], cacheKey: `wenku/${wenkuMatch[1]}` };
                    }
                } catch (error) {}
                return null;
            }
            const pendingFetchCallbacks = new Map();
            let requestIdCounter = 0;

            function getApiUrl(targetInfo) {
                if (targetInfo.type === 'novel') {
                    return `https://${NoveliaConfig.domains.main}/api/novel/${encodeURIComponent(targetInfo.provider)}/${encodeURIComponent(targetInfo.id)}`;
                }
                return `https://${NoveliaConfig.domains.main}/api/wenku/${encodeURIComponent(targetInfo.id)}`;
            }

            async function requestApi(apiUrl) {
                if (typeof GM_xmlhttpRequest === 'function') {
                    return new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: apiUrl,
                            onload: (res) => {
                                if (res.status >= 200 && res.status < 300) {
                                    try { resolve(JSON.parse(res.responseText)); } catch (error) { reject(error); }
                                } else {
                                    reject(new Error(`HTTP ${res.status}`));
                                }
                            },
                            onerror: (err) => reject(err)
                        });
                    });
                }
                const response = await fetch(apiUrl, { credentials: 'same-origin' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            }
            function setupHostFetchListener() {
                if (location.hostname !== NoveliaConfig.domains.main || window.top !== window.self || self._hostListenerSet) return;
                self._hostListenerSet = true;

                window.addEventListener('message', async (event) => {
                    if (!event.data) return;

                    if (event.data.type === 'NOVELIA_INSPECT_GOTO') {
                        const path = event.data.path;
                        if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return;
                        hidePanel();
                        if (Utils.router && typeof Utils.router.push === 'function') {
                            Utils.router.push(path);
                            window.dispatchEvent(new Event('tm-locationchange'));
                        } else {
                            window.location.assign(location.origin + path);
                        }
                        return;
                    }

                    if (event.data.type !== 'NOVELIA_INSPECT_FETCH') return;

                    const { requestId, targetInfo } = event.data;
                    if (!requestId || !targetInfo) return;

                    try {
                        let data = await getIndexedDbCache(targetInfo.cacheKey);
                        if (!data) {
                            data = await requestApi(getApiUrl(targetInfo));
                            await setIndexedDbCache(targetInfo.cacheKey, data);
                        }
                        if (event.source && typeof event.source.postMessage === 'function') {
                            event.source.postMessage({ type: 'NOVELIA_INSPECT_RESPONSE', requestId, success: true, data }, '*');
                        }
                    } catch (error) {
                        if (event.source && typeof event.source.postMessage === 'function') {
                            event.source.postMessage({ type: 'NOVELIA_INSPECT_RESPONSE', requestId, success: false, error: error.message }, '*');
                        }
                    }
                });
            }
            function setupIframeResponseListener() {
                if (self._iframeListenerSet) return;
                self._iframeListenerSet = true;

                window.addEventListener('message', (event) => {
                    if (!event.data || event.data.type !== 'NOVELIA_INSPECT_RESPONSE') return;
                    const { requestId, success, data, error } = event.data;
                    const callbacks = pendingFetchCallbacks.get(requestId);
                    if (callbacks) {
                        pendingFetchCallbacks.delete(requestId);
                        if (success) callbacks.resolve(data);
                        else callbacks.reject(new Error(error || 'Fetch failed'));
                    }
                });
            }
            async function fetchInspectData(targetInfo) {
                if (cache.has(targetInfo.cacheKey)) return cache.get(targetInfo.cacheKey);

                let data = await getIndexedDbCache(targetInfo.cacheKey);
                if (data) {
                    cache.set(targetInfo.cacheKey, data);
                    return data;
                }

                if (window.top !== window.self) {
                    data = await new Promise((resolve, reject) => {
                        const requestId = `req_${Date.now()}_${++requestIdCounter}`;
                        pendingFetchCallbacks.set(requestId, { resolve, reject });
                        window.parent.postMessage({ type: 'NOVELIA_INSPECT_FETCH', requestId, targetInfo }, '*');

                        setTimeout(() => {
                            if (pendingFetchCallbacks.has(requestId)) {
                                pendingFetchCallbacks.delete(requestId);
                                reject(new Error('Fetch timeout'));
                            }
                        }, 10000);
                    });
                } else {
                    data = await requestApi(getApiUrl(targetInfo));
                    await setIndexedDbCache(targetInfo.cacheKey, data);
                }
                cache.set(targetInfo.cacheKey, data);
                return data;
            }
            const escHtml = Utils.text.escapeHtml;
            function toHostPath(href) {
                try {
                    const u = new URL(href, `https://${NoveliaConfig.domains.main}`);
                    return u.pathname + u.search + u.hash;
                } catch (error) {
                    return null;
                }
            }
            function getNovelUrl(targetInfo, data) {
                if (data && data.sourceUrl) return data.sourceUrl;
                if (targetInfo && targetInfo.type === 'novel') {
                    if (targetInfo.provider === 'hameln') return `https://syosetu.org/novel/${targetInfo.id}`;
                    if (targetInfo.provider === 'syosetu' || targetInfo.provider === 'ncode') return `https://ncode.syosetu.com/${targetInfo.id}`;
                    return `https://${NoveliaConfig.domains.main}/novel/${encodeURIComponent(targetInfo.provider)}/${encodeURIComponent(targetInfo.id)}`;
                } else if (targetInfo && targetInfo.type === 'wenku') {
                    return `https://${NoveliaConfig.domains.main}/wenku/${encodeURIComponent(targetInfo.id)}`;
                }
                return '#';
            }
            const formatRelativeTime = Utils.time.formatRelativeTime;
            function renderPanelWrapper(innerHtml) {
                return `
                    <div role="none" class="n-flex" style="display: flex; flex-flow: row; justify-content: start; gap: 20px;">
                        <div style="flex: 1 1 auto; overflow: auto;">${innerHtml}</div>
                    </div>`;
            }
            function formatInspectContent(targetInfo, data, originalHref) {
                const titleZh = data.titleZh || data.title || '';
                const titleJp = data.titleJp || '';
                const displayTitle = titleZh || titleJp || '未知作品';

                const openUrl = originalHref || (targetInfo.type === 'novel' ? `https://${NoveliaConfig.domains.main}/novel/${encodeURIComponent(targetInfo.provider)}/${encodeURIComponent(targetInfo.id)}` : `https://${NoveliaConfig.domains.main}/wenku/${encodeURIComponent(targetInfo.id)}`);
                const sourceUrl = (data && data.sourceUrl) ? data.sourceUrl : getNovelUrl(targetInfo, data);

                let titleHtml = `<h3 class="n-h n-h3 __h3-dark-1ynum3r-d n-h--prefix-bar" style="margin-bottom: 4px;"><a class="n-a __a-dark-1ynum3r" href="${escHtml(openUrl)}">${escHtml(displayTitle)}</a></h3>`;
                if (titleJp && titleJp !== displayTitle) {
                    titleHtml += `<span class="n-text __text-dark-1ynum3r-d3" style="display: block; font-size: 14px; line-height: 1.6;">${escHtml(titleJp)}</span>`;
                }

                const statItems = [];
                if (data.type) {
                    statItems.push(`<span class="n-text __text-dark-1ynum3r-d">${escHtml(data.type)}</span>`);
                }
                if (typeof data.totalCharacters === 'number') {
                    const totalChars = data.totalCharacters;
                    const wordsFormatted = totalChars >= 10000 ? `${(totalChars / 10000).toFixed(1)} 万字` : `${totalChars.toLocaleString()} 字`;
                    statItems.push(`<span class="n-text __text-dark-1ynum3r-d">${escHtml(wordsFormatted)}</span>`);
                }
                const rawTimestamp = data.syncAt || data.updateAt || data.createAt;
                if (rawTimestamp) {
                    const timeFormatted = formatRelativeTime(rawTimestamp);
                    if (timeFormatted) {
                        statItems.push(`<time>${escHtml(timeFormatted)}</time>`);
                    }
                }
                if (typeof data.visited === 'number') {
                    statItems.push(`<span class="n-text __text-dark-1ynum3r-d">${data.visited.toLocaleString()} 次浏览</span>`);
                }

                const metadataHtml = statItems.length > 0
                    ? `<div role="none" class="n-flex metadata-stat" style="display: flex; flex-flow: wrap; justify-content: start; align-items: center; gap: 8px;">${statItems.join('<span>/</span>')}</div>`
                    : '';

                const introText = data.introductionZh || data.introductionJp || data.introduction || '無簡介';
                const introHtml = `<p class="n-p __p-dark-1ynum3r" style="word-break: break-all; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; overflow: hidden; margin-top: 16px;">${escHtml(introText)}</p>`;

                const tagElements = [];
                if (data.points !== undefined && data.points !== null) {
                    tagElements.push(`<div class="n-tag __tag-dark-1ynum3r-ss" style="cursor: pointer;"><span class="n-tag__content"><b>${escHtml(String(data.points))} PT</b></span></div>`);
                }
                if (Array.isArray(data.attentions)) {
                    data.attentions.forEach((attentionItem) => {
                        if (attentionItem) tagElements.push(`<a href="/novel?query=${encodeURIComponent(attentionItem)}$" class=""><div class="n-tag __tag-dark-1ynum3r-ds" style="cursor: pointer;"><span class="n-tag__content"><b>${escHtml(attentionItem)}</b></span></div></a>`);
                    });
                }
                if (Array.isArray(data.keywords)) {
                    data.keywords.forEach((keywordItem) => {
                        if (keywordItem) tagElements.push(`<a href="/novel?query=${encodeURIComponent(keywordItem)}$" class=""><div class="n-tag __tag-dark-1ynum3r-ds" style="cursor: pointer;"><span class="n-tag__content">${escHtml(keywordItem)}</span></div></a>`);
                    });
                }
                const tagsContainerHtml = tagElements.length > 0
                    ? `<div role="none" class="n-flex" style="display: flex; flex-flow: wrap; justify-content: start; gap: 4px; margin-top: 12px;">${tagElements.join('')}</div>`
                    : '';
                const buildActionBar = () => {
                    const hostPath = toHostPath(openUrl) || '/';
                    const hostAbsUrl = `https://${NoveliaConfig.domains.main}${hostPath}`;
                    return `
                        <div class="novelia-inspect-action-bar">
                            <a href="${escHtml(hostAbsUrl)}" data-novelia-goto-host="${escHtml(hostPath)}" class="novelia-inspect-btn novelia-inspect-open-btn" target="_self">前往</a>
                            <a href="${escHtml(hostAbsUrl)}" class="novelia-inspect-btn novelia-inspect-goto-btn" target="_blank" rel="noopener noreferrer">打開 ${Utils.icons.POPOUT}</a>
                        </div>
                    `;
                };
                const actionBarHtml = Utils.dom.isMobile() === false ? '' : buildActionBar();
                return renderPanelWrapper(`
                    <div style="margin: 18px 0px;">
                        ${titleHtml}
                    </div>
                    <div role="separator" class="n-divider __divider-dark-1ynum3r n-divider--no-title"><div class="n-divider__line n-divider__line--left"></div></div>
                    ${metadataHtml}
                    ${introHtml}
                    ${tagsContainerHtml}
                    ${actionBarHtml}
                `);
            }
            function isAllowedHostPage() {
                if (location.hostname !== NoveliaConfig.domains.main) return true;
                const currentPath = Utils.router.getPath();
                return currentPath.startsWith('/novel/') || currentPath.startsWith('/wenku/') || currentPath.startsWith('/forum');
            }
            function isTargetContainer(anchorElement) {
                if (!anchorElement) return false;
                if (!isAllowedHostPage()) return false;
                return !!anchorElement.closest('article, .prose, .markdown-body, #comments, .n-tab-pane, [class*="comment"], .comment-card, .topic-detail, .post-content');
            }
            function showMobilePanel(btnElement, originalHref, targetInfo) {
                currentAnchorElement = btnElement;
                const backdrop = getOrCreateBackdrop();
                backdrop.classList.add('show');

                const panel = getOrCreatePanel();
                panel.classList.add('mobile-mode');

                panel.innerHTML = renderPanelWrapper(`
                    <button type="button" class="novelia-inspect-close-btn" aria-label="Close">&times;</button>
                    <div class="novelia-inspect-mascot-wrapper">
                        <img src="${Utils.assets.mascot.getSyncUrl()}" class="novelia-mascot" alt="Loading..." />
                        <span style="font-size: 14px; opacity: 0.8;">Loading...</span>
                    </div>`);
                const closeBtnInPanel = panel.querySelector('.novelia-inspect-close-btn');
                if (closeBtnInPanel) closeBtnInPanel.addEventListener('click', hidePanel);

                Utils.assets.mascot.getUrl().then(mascotUrl => {
                    const mascotImg = panel.querySelector('.novelia-mascot');
                    if (mascotImg) mascotImg.src = mascotUrl;
                });
                panel.classList.add('show');

                fetchInspectData(targetInfo).then(data => {
                    if (currentAnchorElement === btnElement && panel) {
                        panel.innerHTML = renderPanelWrapper(`
                            <button type="button" class="novelia-inspect-close-btn" aria-label="Close">&times;</button>
                            ${formatInspectContent(targetInfo, data, originalHref)}
                        `);
                        const cb = panel.querySelector('.novelia-inspect-close-btn');
                        if (cb) cb.addEventListener('click', hidePanel);
                    }
                }).catch(error => {
                    if (currentAnchorElement === btnElement && panel) {
                        panel.innerHTML = renderPanelWrapper(`
                            <button type="button" class="novelia-inspect-close-btn" aria-label="Close">&times;</button>
                            <div class="novelia-inspect-loading">⚠️ 無法載入作品資訊</div>
                        `);
                        const cb = panel.querySelector('.novelia-inspect-close-btn');
                        if (cb) cb.addEventListener('click', hidePanel);
                    }
                });
            }
            function processMobileLinks() {
                if (!Utils.dom.isMobile() || !isAllowedHostPage()) return;
                
                const containers  = document.querySelectorAll('article, .prose, .markdown-body, #comments, .n-tab-pane, [class*="comment"], .comment-card, .topic-detail, .post-content');
                containers.forEach(container => {
                    const links = container.querySelectorAll('a[href]:not([data-novelia-preview-processed])');
                    links.forEach(a => {
                        const href = a.getAttribute('href') || a.href;
                        const targetInfo = parseTargetUrl(href);
                        if (!targetInfo) return;

                        a.dataset.noveliaPreviewProcessed = 'true';

                        const btn = document.createElement('button');
                        Object.assign(btn, { type: 'button', className: a.className });
                        if (a.getAttribute('style')) btn.setAttribute('style', a.getAttribute('style'));

                        btn.innerHTML = a.innerHTML;
                        Object.assign(btn.dataset, { originalHref: href, noveliaPreviewBtn: 'true' });
                        Object.assign(btn.style, { background: 'transparent', border: 'none', padding: '0', font: 'inherit', color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer', textAlign: 'inherit', display: 'inline' });

                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            showMobilePanel(btn, href, targetInfo);
                        });
                        if (a.parentNode) a.parentNode.replaceChild(btn, a);
                    });
                });
            }

            function handleMouseOver(event) {
                const anchorElement = event.target.closest('a');
                if (!anchorElement) return;

                if (!isTargetContainer(anchorElement)) return;

                const targetInfo = parseTargetUrl(anchorElement.getAttribute('href') || anchorElement.href);
                if (!targetInfo) return;

                currentAnchorElement = anchorElement;
                const panel = getOrCreatePanel();
                panel.innerHTML = renderPanelWrapper(`
                    <div class="novelia-inspect-mascot-wrapper">
                        <img src="${Utils.assets.mascot.getSyncUrl()}" class="novelia-mascot" alt="Loading..." />
                        <span style="font-size: 14px; opacity: 0.8;">Loading...</span>
                    </div>
                `);
                Utils.assets.mascot.getUrl().then(mascotUrl => {
                    const mascotImg = panel.querySelector('.novelia-mascot');
                    if (mascotImg) mascotImg.src = mascotUrl;
                });
                panel.classList.add('show');
                updatePosition(event.clientX, event.clientY);

                fetchInspectData(targetInfo).then(data => {
                    if (currentAnchorElement === anchorElement && panel) {
                        panel.innerHTML = formatInspectContent(targetInfo, data, anchorElement.getAttribute('href') || anchorElement.href);
                        updatePosition(event.clientX, event.clientY);
                    }
                }).catch(error => {
                    if (currentAnchorElement === anchorElement && panel) {
                        panel.innerHTML = renderPanelWrapper('<div class="novelia-inspect-loading">⚠️ 無法載入作品資訊</div>');
                    }
                });
            }
            function handleMouseMove(event) {
                if (currentAnchorElement && panelElement && panelElement.classList.contains('show')) {
                    updatePosition(event.clientX, event.clientY);
                }
            }
            function handleMouseOut(event) {
                if (!currentAnchorElement) return;
                const anchorElement = event.target.closest('a');
                if (anchorElement && anchorElement === currentAnchorElement) hidePanel();
            }
            injectStyles();
            setupHostFetchListener();
            setupIframeResponseListener();

            if (window.top !== window.self) {
                document.addEventListener('click', (event) => {
                    const btn = event.target.closest && event.target.closest('[data-novelia-goto-host]');
                    if (!btn) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const path = btn.getAttribute('data-novelia-goto-host');
                    hidePanel();
                    window.parent.postMessage({ type: 'NOVELIA_INSPECT_GOTO', path }, '*');
                }, true);
            }

            if (Utils.dom.isMobile()) {
                processMobileLinks();
                let scanTimeout = null;
                const observer = new MutationObserver(() => {
                    if (scanTimeout) clearTimeout(scanTimeout);
                    scanTimeout = setTimeout(processMobileLinks, 150);
                });
                observer.observe(document.body, { childList: true, subtree: true });
            } else {
                document.addEventListener('mouseover', handleMouseOver, true);
                document.addEventListener('mousemove', handleMouseMove, true);
                document.addEventListener('mouseout', handleMouseOut, true);
            }
            Utils.router.onChange(() => {
                hidePanel();
                if (Utils.dom.isMobile()) {
                    setTimeout(processMobileLinks, 100);
                }
            });
        }
    };

    runModules();
})();
