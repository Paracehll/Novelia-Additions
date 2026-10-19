// ==UserScript==
// @name         Novelia 體驗優化 綑綁包
// @namespace    novelia-qol-bundle
// @version      2.6.0
// @description  整合"輕小說機翻站"多種優化功能，可自訂模塊載入
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
        { id: 'banner_replace', name: '替換首頁橫幅', default: true },
        { id: 'forum_iframe', name: '內嵌論壇視窗', default: true },

        { id: 'comment_collapse', name: '摺疊評論區回覆', default: true },
        { id: 'comment_notify', name: '評論區更新排序', default: true },     

        { id: 'share_btn', name: '小說分享按鈕', default: true },
        { id: 'source_link', name: '源站跳轉按鈕', default: true },

        { id: 'comment_count', name: 'Web 評論數追蹤', default: true },
        { id: 'forum_shistory', name: '論壇搜尋歷史', default: true },

        // { id: 'collapse_images', name: '預設摺疊圖片', default: true },
        // { id: 'forum_search', name: '論壇搜尋增強', default: true },
        // { id: 'thread_footer', name: '編輯頁面固定頁尾', default: true },
    ];

    const DOMAINS = {
        HOST: 'n.novelia.cc',
        FORUM: 'forum.novelia.cc'
    };

    // Top-level central utilities
    const Utils = {
        gm: {
            addStyle(css, id) {
                if (id && document.getElementById(id)) return document.getElementById(id);
                if (typeof GM_addStyle === 'function') {
                    const style = GM_addStyle(css);
                    if (id && style && style.id !== undefined) style.id = id;
                    return style;
                } else {
                    const style = document.createElement('style');
                    if (id) style.id = id;
                    style.textContent = css;
                    (document.head || document.documentElement).appendChild(style);
                    return style;
                }
            },
            getValue(key, defaultValue) {
                if (typeof GM_getValue === 'function') return GM_getValue(key, defaultValue);
                return defaultValue;
            },
            setValue(key, value) { if (typeof GM_setValue === 'function') GM_setValue(key, value) },
            registerMenuCommand(label, fn) { if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(label, fn) },
            setClipboard(text) {
                if (typeof GM_setClipboard === 'function') {
                    GM_setClipboard(text);
                    return Promise.resolve(true);
                } else if (navigator.clipboard) {
                    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
                }
                return Promise.resolve(false);
            }
        },
        storage: {
            get(key, defaultValue = {}) {
                try {
                    const raw = localStorage.getItem(key);
                    return raw !== null ? JSON.parse(raw) : defaultValue;
                } catch (e) {
                    return defaultValue;
                }
            },
            set(key, value) {
                try {
                    localStorage.setItem(key, JSON.stringify(value));
                    return true;
                } catch (e) {
                    console.error(`[Utils.storage] Failed to set ${key}:`, e);
                    return false;
                }
            }
        },
        dom: {
            isNoveliaOwnNode(node) {
                if (!node) return false;
                if (node.nodeType === Node.TEXT_NODE) return Utils.dom.isNoveliaOwnNode(node.parentElement);
                if (node.nodeType !== Node.ELEMENT_NODE) return false;
                if (typeof node.className === 'string' && /(^|\s)novelia-/.test(node.className)) return true;
                return !!(node.closest && node.closest('[class*="novelia-"]'));
            },
            isSelfCausedMutation(mutation) {
                if (Utils.dom.isNoveliaOwnNode(mutation.target)) return true;
                const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
                return nodes.length > 0 && nodes.every((node) => Utils.dom.isNoveliaOwnNode(node));
            },
            isMobile() {
                if (typeof window === 'undefined') return false;
                const userAgentMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
                const screenMobile = window.innerWidth <= 768;
                return userAgentMobile || screenMobile;
            }
        },
        route: {
            _initDone: false,
            init() {
                if (this._initDone) return;
                this._initDone = true;
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
            },
            getPath() { return window.__noveliaMockPath || location.pathname },
            matchNovelPath(pathname) {
                const pathMatch = pathname.match(/^\/novel\/([^\/?#]+)\/([^\/?#]+)\/?$/i);
                if (pathMatch) return { source: pathMatch[1], id: pathMatch[2] };
                const wenkuMatch = pathname.match(/^\/wenku\/([^\/?#]+)\/?$/i);
                if (wenkuMatch) return { source: 'wenku', id: wenkuMatch[1] };
                return null;
            },
            isForumPage() {
                const path = Utils.route.getPath();
                return path === '/forum' || path.startsWith('/forum/');
            },
            isForumUrl(href) {
                if (!href) return false;
                try {
                    const parsed = new URL(href, location.origin);
                    if (parsed.hostname === DOMAINS.FORUM) return true;
                    if (parsed.hostname === location.hostname && (parsed.pathname === '/forum' || parsed.pathname.startsWith('/forum/'))) return true;
                } catch (e) {
                    if (new RegExp('^https?:\\/\\/' + DOMAINS.FORUM.replace('.', '\\.'), 'i').test(href)) return true;
                    if (href === '/forum' || href.startsWith('/forum/')) return true;
                }
                return false;
            },
            isSharePage() {
                const path = Utils.route.getPath();
                if (/^\/novel\/[^\/]+\/[^\/]+\/[^\/]+/i.test(path)) return false;
                if (/^\/novel\/[^\/]+\/[^\/]+\/?$/.test(path)) return false;
                return path === '/' || path.startsWith('/novel') || path.startsWith('/favorite') || path.startsWith('/wenku') || path.startsWith('/search') || path.startsWith('/read-history');
            },
            isCommentCountPage() {
                const path = Utils.route.getPath();
                if (/^\/novel\/[^\/]+\/[^\/]+\/[^\/]+/i.test(path)) return false;
                return path === '/' || path.startsWith('/novel') || path.startsWith('/favorite') || path.startsWith('/wenku') || path.startsWith('/read-history');
            },
            isCommentNotifyPage() {
                const path = Utils.route.getPath();
                const host = location.hostname;
                if (host === DOMAINS.HOST && /^\/novel\/[^\/]+\/[^\/]+\/?$/i.test(path)) return true;
                if (host === DOMAINS.HOST && /^\/wenku\/[^\/]+\/?$/i.test(path)) return true;
                if ((host === DOMAINS.HOST && /^\/forum\/p\/[^\/]+\/?$/i.test(path)) || (host === DOMAINS.FORUM && /^\/p\/[^\/]+\/?$/i.test(path))) return true;
                return false;
            },
            onChange(callback) {
                this.init();
                window.addEventListener('popstate', callback);
                window.addEventListener('hashchange', callback);
                window.addEventListener('tm-locationchange', callback);
            }
        },
        time: {
            parseToSecondsAgo(text) {
                if (!text) return Infinity;
                const str = text.trim();
                if (!str) return Infinity;
                if (/^(刚刚|剛剛|just now)$/i.test(str)) return 0;
                const patterns = [
                    { regex: /(\d+)\s*秒/, mult: 1 },
                    { regex: /(\d+)\s*(?:分钟|分鐘|分)/, mult: 60 },
                    { regex: /(\d+)\s*(?:小时|小時|時|时)/, mult: 3600 },
                    { regex: /(\d+)\s*(?:天|日)/, mult: 86400 },
                    { regex: /(\d+)\s*(?:个?月|個?月)/, mult: 2592000 },
                    { regex: /(\d+)\s*年/, mult: 31536000 }
                ];
                for (const { regex, mult } of patterns) {
                    const m = str.match(regex);
                    if (m) return parseInt(m[1], 10) * mult;
                }
                const parsedDate = Date.parse(str);
                return !isNaN(parsedDate) ? Math.max(0, (Date.now() - parsedDate) / 1000) : Infinity;
            }
        },
        ui: {
            createHeaderButton({ className = '', title = '', iconSvg = '', iconSize = 20, margin = '0px 4px', marginRight = null, onClick = null } = {}) {
                const btn = document.createElement('button');
                btn.className = `__button-dark-131ezvy-ehllmd n-button n-button--default-type n-button--large-type ${className}`.trim();
                btn.type = 'button';
                if (title) {
                    btn.title = title;
                    btn.setAttribute('aria-label', title);
                }
                btn.style.cssText = `margin: ${margin}; flex-shrink: 0; background: transparent; border: none; cursor: pointer; color: inherit; display: inline-flex; align-items: center; justify-content: center; padding-top: 6px;`;
                if (marginRight) {
                    btn.style.marginRight = marginRight;
                }
                btn.innerHTML = `<span class="n-button__content"><i role="img" class="n-icon __icon-dark-131ezvy-d" style="font-size: ${iconSize}px; display: inline-flex;">${iconSvg}</i></span>`;

                if (typeof onClick === 'function') {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onClick(e);
                    });
                }
                return btn;
            },
            createToastManager(className = 'novelia-toast') {
                let toastEl = document.querySelector(`.${className}`);
                let timer = null;
                if (!toastEl) {
                    toastEl = document.createElement('div');
                    toastEl.className = className;
                    document.body.appendChild(toastEl);
                }
                return {
                    show(message, duration = 2200) {
                        clearTimeout(timer);
                        toastEl.textContent = message;
                        toastEl.classList.add('show');
                        timer = setTimeout(() => toastEl.classList.remove('show'), duration);
                    }
                };
            }
        },
        comments: {
            getNovelCommentPane() {
                const activeTab = document.querySelector('.n-tabs-tab--active, .n-tabs-tab[aria-selected="true"]');
                const activeTabIsComment = activeTab && (activeTab.textContent.includes('评论') || activeTab.textContent.includes('評論'));

                let paneElement = null;
                const h2Elements = document.querySelectorAll('h2');
                for (const h2Element of h2Elements) {
                    const text = h2Element.textContent.trim();
                    if (text.startsWith('评论') || text.startsWith('評論')) {
                        paneElement = h2Element.closest('.n-tab-pane') || h2Element.closest('div[role="none"]')?.parentElement || h2Element.parentElement?.parentElement;
                        if (paneElement) break;
                    }
                }
                if (!paneElement && activeTabIsComment) paneElement = document.querySelector('.n-tab-pane');
                return paneElement;
            },
            getNovelCommentFloors(paneElement = null) {
                const pane = paneElement || Utils.comments.getNovelCommentPane();
                if (!pane) return [];

                const allHeaders = Array.from(pane.querySelectorAll('.n-flex')).filter(flex => {
                    return flex.querySelector('b') && !flex.closest('div[style*="margin-left: 32px"]');
                });
                if (allHeaders.length === 0) return [];

                const commonParent = allHeaders[0].parentElement;
                if (!commonParent) return [];

                const floors = [];
                for (let index = 0; index < allHeaders.length; index++) {
                    const headerFlex = allHeaders[index];
                    if (headerFlex.parentElement !== commonParent) continue;

                    const commentHeader = headerFlex.querySelector('b');
                    const card = headerFlex.nextElementSibling && headerFlex.nextElementSibling.classList.contains('n-card') ? headerFlex.nextElementSibling : null;

                    const nodes = [headerFlex];
                    let curr = headerFlex.nextElementSibling;
                    let repliesArea = null;

                    while (curr) {
                        if (curr.classList.contains('n-pagination') || curr.querySelector('.n-pagination')) break;
                        if (allHeaders.includes(curr)) break;
                        nodes.push(curr);

                        if (!repliesArea && curr !== card) {
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
                                    replySiblings.forEach(sibling => container.appendChild(sibling));
                                    repliesArea = container;
                                } else {
                                    repliesArea = curr;
                                }
                            } else if (curr.querySelector && curr.querySelector('div[style*="margin-left: 32px"]')) {
                                repliesArea = curr;
                            }
                        }

                        if (curr.classList.contains('n-divider')) break;
                        curr = curr.nextElementSibling;
                    }

                    floors.push({
                        originalIndex: index,
                        headerFlex,
                        commentHeader,
                        card,
                        commonParent,
                        nodes,
                        repliesArea
                    });
                }
                return floors;
            },
            getForumCommentFloors() {
                const commentsEl = document.getElementById('comments') || document.querySelector('[id="comments"]');
                if (!commentsEl) return { floorContainer: null, candidateFloors: [], floors: [] };

                const floorContainer = commentsEl.querySelector('.divide-y') || commentsEl.querySelector('.contents') || commentsEl;
                const candidateFloors = Array.from(floorContainer.children).filter(child => {
                    if (child.tagName === 'HEADER' || child.classList.contains('comments-title')) return false;
                    return child.querySelector('article, time, .comment-card') !== null;
                });

                const floors = candidateFloors.map((element, index) => {
                    const rootArticle = element.querySelector('article');
                    let repliesArea = null;
                    if (rootArticle) {
                        let sibling = rootArticle.nextElementSibling;
                        while (sibling && !sibling.querySelector('article')) {
                            sibling = sibling.nextElementSibling;
                        }
                        repliesArea = sibling;
                    }
                    return {
                        originalIndex: index,
                        element,
                        section: element,
                        rootArticle,
                        repliesArea
                    };
                });

                return { floorContainer, candidateFloors, floors };
            }
        },
        hash: {
            hashString(str) {
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                    const char = str.charCodeAt(i);
                    hash = ((hash << 5) - hash) + char;
                    hash = hash & hash;
                }
                return Math.abs(hash).toString(36);
            }
        },
        limiter: {
            createConcurrencyLimiter(limit) {
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
        },
        svg: {
            REFRESH: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="23 4 23 10 18 10"></polyline><polyline points="1 20 1 14 6 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
            BULK: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect></svg>',
            CLEAR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>',
            VIEW: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
            CHEVRON: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"></path></svg>',
            DRAWER: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" fill="currentColor"></path></svg>',
            POPOUT: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83l1.41 1.41L19 6.41V10h2V3h-7z" fill="currentColor"></path></svg>',
            RELOAD_CIRCLE: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"></path></svg>',
            STAR_OUTLINE: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" width="20" height="20"><path d="M22 9.24l-7.19-.62L12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21L12 17.27L18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27l1-4.28l-3.32-2.88l4.38-.38L12 6.1l1.71 4.04l4.38.38l-3.32 2.88l1 4.28L12 15.4z" fill="currentColor"></path></svg>'
        }
    };

    const config = {};

    function initMenu() {
        FEATURES.forEach(feature => {
            const enabled = Utils.gm.getValue(`feature_${feature.id}`, feature.default);
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
        styleElement.id = 'novelia-bundle-global-styles';
        styleElement.textContent = `
            .novelia-bundle-btn { font-weight: 400; line-height: 1; display: inline-flex; align-items: center; justify-content: center; user-select: none; cursor: pointer; text-align: center; border-radius: 3px; padding: 0 10px; height: 28px; font-size: 13px; transition: color .3s, background-color .3s, border-color .3s, opacity .3s; white-space: nowrap; vertical-align: middle; box-sizing: border-box; background-color: transparent; border: 1px solid rgba(0, 0, 0, 0.2); color: #333; gap: 6px; margin-left: 10px; }
            .novelia-bundle-btn:hover { background-color: rgba(99, 226, 183, 0.1); border-color: #63e2b7; color: #63e2b7; }
            .novelia-bundle-btn:disabled { cursor: not-allowed; opacity: 0.5; }
            .novelia-bundle-btn svg { width: 14px; height: 14px; fill: currentColor; }
            @media (prefers-color-scheme: dark) { .novelia-bundle-btn { border-color: rgba(255, 255, 255, 0.24); color: rgba(255, 255, 255, 0.82); } }
            body.dark .novelia-bundle-btn, .n-config-provider .novelia-bundle-btn { border-color: rgba(255, 255, 255, 0.24); color: rgba(255, 255, 255, 0.82); }
        `;
        document.head.appendChild(styleElement);
    }
    injectGlobalStyles();

    Utils.route.init();

    // ==========================================
    // 1. Web 評論數追蹤 (Modules.comment_count)
    // ==========================================
    Modules.comment_count = {
        init: function() {
            if (location.hostname !== DOMAINS.HOST) return;

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
                getFullStorage() { return Utils.storage.get('novelia_comment_count', {}); },
                saveFullStorage(data) { Utils.storage.set('novelia_comment_count', data); },
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
                    const url = `https://${DOMAINS.FORUM}/api/v1/external/comment/novel/${encodeURIComponent(site)}?page=${p}&page_size=${ps}`;
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
                    const pageLimiter = Utils.limiter.createConcurrencyLimiter(PAGE_FETCH_CONCURRENCY);
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
                    const isNewInstall = !localStorage.getItem('novelia_comment_count');
                    if ((isInitial || isNewInstall) && isStale) return this.updateCommentCount(source, id);
                    return this.buildResultFromEntry(cached);
                }
            };

            const taskLimiter = Utils.limiter.createConcurrencyLimiter(CONCURRENCY_LIMIT);

            const CommentUI = {
                parseNovelPath(anchorElement) {
                    try {
                        return Utils.route.matchNovelPath(new URL(anchorElement.getAttribute('href'), location.origin).pathname);
                    } catch (error) {
                        return null;
                    }
                },
                ensureWrapper(targetElement) {
                    const existingWrapper = targetElement.closest('.novelia-comment-wrapper, .novelia-item-wrapper');
                    if (existingWrapper) return existingWrapper;
                    const wrapperElement = document.createElement('span');
                    wrapperElement.className = 'novelia-comment-wrapper';
                    wrapperElement.style.alignItems = BADGE_ALIGN_ITEMS;
                    wrapperElement.style.gap = '6px';
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

                    badgeElement.dataset.noveliaRenderedText = key;
                    badgeElement.dataset.noveliaLocked = '1';
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
                isAllowedPage() { return Utils.route.isCommentCountPage(); },
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
                    buttonElement.className = 'novelia-bundle-btn novelia-update-button';
                    buttonElement.innerHTML = `${Utils.svg.REFRESH}<span>刷新</span>`;
                    buttonElement.dataset.noveliaNovelKey = novelKey;
                    buttonElement.title = '手動更新留言數';
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
                    const novelInfo = Utils.route.matchNovelPath(Utils.route.getPath());
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
                    const novelInfo = Utils.route.matchNovelPath(Utils.route.getPath());
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
                createBulkUpdateButton() {
                    const buttonElement = document.createElement('button');
                    buttonElement.className = 'novelia-bundle-btn novelia-bulk-update-button';
                    buttonElement.innerHTML = `${Utils.svg.BULK}<span>${UPDATE_BUTTON_LABEL}</span>`;
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
                            buttonElement.innerHTML = originalContent;
                        } catch (error) {
                            buttonElement.innerHTML = '<span>⚠️ 失敗</span>';
                            setTimeout(() => { buttonElement.innerHTML = originalContent; }, 1500);
                        } finally {
                            buttonElement.disabled = false;
                        }
                    });
                    return buttonElement;
                },
                injectBulkUpdateButtons() {
                    const h1Element = document.querySelector('h1');
                    if (!h1Element || h1Element.closest('.n-drawer') || h1Element.querySelector(':scope > .novelia-bulk-update-button')) return;

                    Object.assign(h1Element.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap' });
                    const bulkButton = this.createBulkUpdateButton();
                    const lastHeaderButton = Array.from(h1Element.querySelectorAll('.novelia-header-btn')).pop();
                    if (lastHeaderButton) lastHeaderButton.after(bulkButton);
                    else h1Element.appendChild(bulkButton);
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
            const IS_HOST = (location.hostname === DOMAINS.HOST);
            const IS_IFRAME_CONTEXT = (location.hostname === DOMAINS.FORUM);

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
                        .layout-toggle, button[aria-label*="sidebar"], button[aria-label*="侧边栏"] { display: none !important; }
                        header, .forum-header, nav[aria-label="站点导航"], nav[aria-label="站點導航"] { display: flex !important; }
                        main, body, #app { width: 100% !important; max-width: 100% !important; margin-left: 0 !important; padding-left: 0 !important; padding-bottom: 32px !important; }
                        @media (max-width: 768px) { main, body, #app { padding-bottom: 96px !important; } }
                    `, 'novelia-iframe-hide-sidebar-style');
                }

                function injectMobileHeaderButtons() {
                    const forumHeader = document.querySelector('header, .forum-header, nav[aria-label="站点导航"], nav[aria-label="站點導航"], nav');
                    if (!forumHeader) return;

                    let drawerBtn = forumHeader.querySelector('.novelia-host-drawer-btn');
                    if (!drawerBtn) {
                        const targetContainer = forumHeader.querySelector('.layout-toggle') || forumHeader.querySelector('button') || forumHeader.firstElementChild;
                        if (!targetContainer) return;

                        drawerBtn = Utils.ui.createHeaderButton({
                            className: 'novelia-host-drawer-btn',
                            title: '切換側邊欄',
                            iconSize: 24,
                            margin: `0px ${HEADER_BTN_INNER_GAP}`,
                            marginRight: HEADER_BTN_FST_GAP,
                            iconSvg: Utils.svg.DRAWER,
                            onClick: () => window.parent.postMessage({ type: 'NOVELIA_TOGGLE_HOST_SIDEBAR' }, '*')
                        });
                        targetContainer.before(drawerBtn);
                    } else {
                        drawerBtn.style.marginRight = HEADER_BTN_FST_GAP;
                    }

                    let popoutBtn = forumHeader.querySelector('.novelia-forum-popout-btn');
                    if (!popoutBtn && drawerBtn) {
                        popoutBtn = Utils.ui.createHeaderButton({
                            className: 'novelia-forum-popout-btn',
                            title: '前往論壇 (取代當前頁面)',
                            iconSize: 20,
                            margin: `0px ${HEADER_BTN_INNER_GAP}`,
                            iconSvg: Utils.svg.POPOUT,
                            onClick: () => {
                                const targetUrl = location.href;
                                if (window.parent && window.parent !== window) {
                                    window.parent.postMessage({ type: 'NOVELIA_POPOUT_FORUM', url: targetUrl }, '*');
                                } else {
                                    window.location.href = targetUrl;
                                }
                            }
                        });
                        drawerBtn.after(popoutBtn);
                    }

                    let reloadBtn = forumHeader.querySelector('.novelia-forum-reload-btn');
                    if (!reloadBtn) {
                        const anchorEl = popoutBtn || drawerBtn;
                        if (anchorEl) {
                            reloadBtn = Utils.ui.createHeaderButton({
                                className: 'novelia-forum-reload-btn',
                                title: '重新載入',
                                iconSize: 20,
                                margin: `0px ${HEADER_BTN_INNER_GAP}`,
                                iconSvg: Utils.svg.RELOAD_CIRCLE,
                                onClick: () => window.location.reload()
                            });
                            anchorEl.after(reloadBtn);
                        }
                    }

                    const mobile = Utils.dom.isMobile();
                    if (popoutBtn) popoutBtn.style.display = mobile ? 'inline-flex' : 'none';
                    if (reloadBtn) reloadBtn.style.display = mobile ? 'inline-flex' : 'none';
                }

                function injectFavoriteButton() {
                    const forumHeader = document.querySelector('header, .forum-header, nav[aria-label="站点导航"], nav[aria-label="站點導航"], nav');
                    if (!forumHeader || forumHeader.querySelector('.novelia-forum-fav-btn')) return;

                    const themeBtn = forumHeader.querySelector('button[aria-label*="主题"], button[title*="主题"], button[aria-label*="主題"], button[title*="主題"]');
                    const targetContainer = themeBtn ? themeBtn.parentElement : (forumHeader.querySelector('.layout-toggle') || forumHeader.querySelector('button') || forumHeader.firstElementChild);
                    if (!targetContainer) return;

                    const btn = Utils.ui.createHeaderButton({
                        className: 'novelia-forum-fav-btn',
                        title: '我的收藏',
                        iconSize: 20,
                        margin: `0px ${HEADER_BTN_INNER_GAP}`,
                        iconSvg: Utils.svg.STAR_OUTLINE,
                        onClick: () => {
                            if (window.parent !== window) {
                                window.parent.postMessage({ type: 'NOVELIA_NAVIGATE_HOST', path: '/favorite/web' }, '*');
                            } else {
                                window.location.href = `https://${DOMAINS.HOST}/favorite/web`;
                            }
                        }
                    });

                    if (themeBtn) themeBtn.before(btn);
                    else targetContainer.before(btn);
                }

                function notifyHostUrlChange() {
                    if (window.parent !== window) {
                        const path = location.pathname + location.search + location.hash;
                        window.parent.postMessage({ type: 'NOVELIA_URL_CHANGE', path }, '*');
                    }
                }

                Utils.route.onChange(notifyHostUrlChange);
                notifyHostUrlChange();

                injectIframeStyles();
                injectMobileHeaderButtons();
                injectFavoriteButton();

                window.addEventListener('resize', injectMobileHeaderButtons);
                const iframeObserver = new MutationObserver(() => {
                    injectMobileHeaderButtons();
                    injectFavoriteButton();
                });
                iframeObserver.observe(document.body, { childList: true, subtree: true });

                window.addEventListener('message', function(e) {
                    if (!e.data) return;
                    if (e.data.type === 'NOVELIA_NAVIGATE') {
                        const targetPath = e.data.path || '/';
                        const currentPath = location.pathname + location.search + location.hash;
                        if (currentPath !== targetPath && location.pathname !== targetPath) {
                            history.pushState({}, '', targetPath);
                            window.dispatchEvent(new Event('popstate'));
                            window.dispatchEvent(new Event('tm-locationchange'));
                        }
                        return;
                    }

                    if (e.data.type === 'NOVELIA_THEME_CHANGE') {
                        const isDark = !!e.data.isDark;
                        const forumIsDarkBefore = document.documentElement.classList.contains('dark') ||
                                                document.body.classList.contains('dark') ||
                                                document.documentElement.getAttribute('data-theme') === 'dark';

                        if (isDark) {
                            document.documentElement.classList.add('dark');
                            document.body.classList.add('dark');
                            document.documentElement.setAttribute('data-theme', 'dark');
                        } else {
                            document.documentElement.classList.remove('dark');
                            document.body.classList.remove('dark');
                            document.documentElement.removeAttribute('data-theme');
                        }

                        const themeBtn = document.querySelector('button[aria-label*="主题"], button[title*="主题"], button[aria-label*="主題"], button[title*="主題"], button[aria-label*="theme" i], button[title*="theme" i]');
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

            function getIframeTargetUrl() {
                const path = Utils.route.getPath();
                if (path.startsWith('/forum/')) {
                    const sub = path.substring('/forum'.length);
                    return `https://${DOMAINS.FORUM}${sub}`;
                }
                return `https://${DOMAINS.FORUM}/`;
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

            function isHostDarkTheme() {
                if (document.documentElement.classList.contains('dark') ||
                    document.body.classList.contains('dark') ||
                    document.documentElement.getAttribute('data-theme') === 'dark' ||
                    !!document.querySelector('.n-config-provider--dark')) {
                    return true;
                }

                if (document.documentElement.classList.contains('light') ||
                    document.body.classList.contains('light') ||
                    document.documentElement.getAttribute('data-theme') === 'light') {
                    return false;
                }

                try {
                    const targets = [document.body, document.documentElement, document.getElementById('app'), document.querySelector('.n-layout'), document.querySelector('.n-config-provider')].filter(Boolean);
                    for (const el of targets) {
                        const bg = window.getComputedStyle(el).backgroundColor;
                        const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                        if (match) {
                            const r = parseInt(match[1], 10);
                            const g = parseInt(match[2], 10);
                            const b = parseInt(match[3], 10);
                            const isTransparent = bg.includes('rgba(') && bg.endsWith(', 0)');
                            if (!isTransparent) {
                                const luminance = (r * 299 + g * 587 + b * 114) / 1000;
                                if (luminance < 128) return true;
                                if (luminance >= 128) return false;
                            }
                        }
                    }
                } catch (e) {}
                return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            }

            function sendThemeToIframe() {
                const iframe = document.querySelector('iframe.novelia-forum-iframe');
                if (!iframe || !iframe.contentWindow) return;
                iframe.contentWindow.postMessage({ type: 'NOVELIA_THEME_CHANGE', isDark: isHostDarkTheme() }, '*');
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
                const currentPath = Utils.route.getPath();
                const isForum = Utils.route.isForumPage();

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
                    const targetPath = e.data.path || '/favorite/web';
                    window.location.href = location.origin + (targetPath.startsWith('/') ? targetPath : '/' + targetPath);
                }
                if (e.data.type === 'NOVELIA_URL_CHANGE') {
                    const innerPath = e.data.path || '/';
                    const targetHostPath = (innerPath === '/' || innerPath === '') ? '/forum' : '/forum' + (innerPath.startsWith('/') ? innerPath : '/' + innerPath);
                    const currentHostPath = Utils.route.getPath();
                    if (currentHostPath !== targetHostPath && Utils.route.isForumPage()) {
                        if (window.__noveliaMockPath) window.__noveliaMockPath = targetHostPath;
                        else history.replaceState({}, '', targetHostPath);
                        updateSelectedSubmenuItem();
                    }
                }
            });

            function autoCollapseSidebar() {
                if (window.innerWidth <= 768) {
                    const closeBtn = document.querySelector('button[aria-label*="关闭导航菜单"], button[aria-label*="關閉導航菜單"], button[aria-label*="关闭"], button[aria-label*="關閉"]');
                    if (closeBtn) { closeBtn.click(); return; }
                    const drawerMask = document.querySelector('.n-drawer-mask');
                    if (drawerMask) { drawerMask.click(); return; }
                    const openDrawer = document.querySelector('.n-drawer, [role="dialog"][class*="drawer"]');
                    const openToggleBtn = document.querySelector('button.layout-toggle[aria-expanded="true"], button[aria-label*="导航菜单"][aria-expanded="true"], button[aria-label*="導航菜單"][aria-expanded="true"]');
                    if (openDrawer || openToggleBtn) {
                        const drawerBtn = openToggleBtn || document.querySelector('button.layout-toggle, button[aria-label*="导航菜单"], button[aria-label*="導航菜單"], header button, .n-layout-header button, nav.n-layout-header button, .n-layout-sider-toggle-button, .sidebar-collapse');
                        if (drawerBtn) drawerBtn.click();
                    }
                }
            }

            function isSidebarCollapsed() {
                const sider = document.querySelector('.web-kit-sidebar, .sidebar-shell, .n-layout-sider, .n-layout-sidebar, aside');
                if (sider) {
                    if (sider.classList.contains('n-layout-sider--collapsed') || sider.offsetWidth < 120) return true;
                    const collapseBtn = document.querySelector('.sidebar-collapse');
                    if (collapseBtn && (collapseBtn.getAttribute('aria-expanded') === 'false' || collapseBtn.getAttribute('aria-label')?.includes('展开') || collapseBtn.getAttribute('title')?.includes('展开'))) {
                        return true;
                    }
                }
                const menu = document.querySelector('.n-menu');
                if (menu && menu.classList.contains('n-menu--collapsed')) return true;
                return false;
            }

            function syncSidebarCollapsedState() {
                const submenuDiv = document.querySelector('.novelia-forum-submenu');
                if (!submenuDiv) return;

                const collapsed = isSidebarCollapsed();
                if (submenuDiv.classList.contains('n-submenu')) {
                    const contentDiv = submenuDiv.querySelector('.n-menu-item-content');
                    const childrenDiv = submenuDiv.querySelector('.n-submenu-children');
                    if (contentDiv) contentDiv.style.paddingLeft = collapsed ? '21px' : '32px';
                    if (collapsed && childrenDiv) {
                        childrenDiv.classList.remove('expanded');
                        childrenDiv.classList.add('collapsed');
                        submenuDiv.setAttribute('aria-expanded', 'false');
                        const arrow = contentDiv ? contentDiv.querySelector('.n-menu-item-content__arrow') : null;
                        if (arrow) arrow.style.transform = 'rotate(0deg)';
                    }
                } else {
                    const childrenDiv = submenuDiv.querySelector('.sidebar-submenu');
                    const headerBtn = submenuDiv.querySelector('button');
                    if (collapsed && childrenDiv) {
                        childrenDiv.classList.remove('flex');
                        childrenDiv.classList.add('hidden');
                        if (headerBtn) headerBtn.setAttribute('aria-expanded', 'false');
                    }
                }
            }

            function observeSidebarToggle() {
                const sider = document.querySelector('.web-kit-sidebar, .sidebar-shell, .n-layout-sider, .n-layout-sidebar, aside');
                if (sider && !sider.dataset.noveliaSiderObserverAttached) {
                    sider.dataset.noveliaSiderObserverAttached = '1';
                    const observer = new MutationObserver(() => { syncSidebarCollapsedState(); });
                    observer.observe(sider, { attributes: true, attributeFilter: ['class', 'style', 'aria-expanded'] });
                }
            }

            function getOrCreateDropdownPopover(subItems) {
                let popover = document.getElementById('novelia-forum-popover');
                if (popover) return popover;

                popover = document.createElement('div');
                popover.id = 'novelia-forum-popover';
                popover.className = 'novelia-forum-dropdown-popover';

                subItems.forEach(item => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'novelia-forum-dropdown-item';
                    itemDiv.innerHTML = `${item.icon}<span>${item.name}</span>`;

                    itemDiv.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        popover.style.display = 'none';

                        if (location.pathname !== item.path) {
                            history.pushState({}, '', item.path);
                            window.dispatchEvent(new Event("tm-locationchange"));
                        }
                        handleForumPage();
                        updateSelectedSubmenuItem();
                    });

                    popover.appendChild(itemDiv);
                });

                document.body.appendChild(popover);
                return popover;
            }

            function isSidebarMenuItem(a) {
                if (!a) return false;
                const drawer = a.closest('.n-drawer');
                if (!drawer && a.closest('header, .n-layout-header, main, .n-layout-content, .layout-content, .novel-page-content, #banner, .n-card, .n-grid, .n-breadcrumb, [aria-label*="Breadcrumb"], [aria-label*="面包屑"]')) {
                    return false;
                }
                const menuItem = a.closest('.web-kit-sidebar-item, .n-menu-item, [role="menuitem"]');
                const sidebarContainer = a.closest('aside, .web-kit-sidebar, .sidebar-shell, .n-layout-sider, .n-layout-sidebar, .n-menu, .n-drawer, nav[aria-label="站点导航"], nav[aria-label="站點導航"], nav[aria-label="侧边栏"], nav[aria-label="側邊欄"]');

                return !!(menuItem || sidebarContainer);
            }

            function findForumMenuItem() {
                const sidebarContainers = 'aside, .web-kit-sidebar, .sidebar-shell, .n-layout-sider, .n-layout-sidebar, .n-menu, .n-drawer, nav[aria-label="站点导航"], nav[aria-label="站點導航"], nav[aria-label="侧边栏"], nav[aria-label="側邊欄"]';
                const menuItemSelector = '.web-kit-sidebar-item, .n-menu-item, [role="menuitem"]';

                const candidateAnchors = Array.from(document.querySelectorAll(`${sidebarContainers} a[href], ${menuItemSelector} a[href], a${menuItemSelector}`));
                for (const a of candidateAnchors) {
                    if (!isSidebarMenuItem(a)) continue;
                    if (Utils.route.isForumUrl(a.getAttribute('href') || a.href)) {
                        const item = a.closest('.web-kit-sidebar-item, .n-menu-item, [role="menuitem"]') || a;
                        return { element: item, anchor: a, isWebKit: item.classList.contains('web-kit-sidebar-item') || !!item.closest('.web-kit-sidebar') };
                    }
                }

                const textAnchors = Array.from(document.querySelectorAll(`${sidebarContainers} a, ${menuItemSelector} a, a${menuItemSelector}`));
                for (const a of textAnchors) {
                    if (!isSidebarMenuItem(a)) continue;
                    const text = a.textContent.trim();
                    if (text === '论坛' || text === '論壇') {
                        const item = a.closest('.web-kit-sidebar-item, .n-menu-item, [role="menuitem"]') || a;
                        return { element: item, anchor: a, isWebKit: item.classList.contains('web-kit-sidebar-item') || !!item.closest('.web-kit-sidebar') };
                    }
                }

                return null;
            }

            function transformForumSidebarMenu() {
                injectInlineStyles();
                if (document.querySelector('.novelia-forum-submenu')) {
                    updateSelectedSubmenuItem();
                    syncSidebarCollapsedState();
                    return;
                }

                const found = findForumMenuItem();
                if (!found) return;

                const menuItemDiv = found.element;
                if (!menuItemDiv || menuItemDiv.dataset.noveliaSubmenuProcessed) return;

                menuItemDiv.dataset.noveliaSubmenuProcessed = '1';
                let isExpanded = localStorage.getItem('novelia_forum_submenu_expanded') === 'true';

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

                const popover = getOrCreateDropdownPopover(subItems);
                let hidePopoverTimer = null;

                if (found.isWebKit) {
                    const submenuContainer = document.createElement('div');
                    submenuContainer.className = 'novelia-forum-submenu flex flex-col gap-1 w-full';

                    const headerBtn = document.createElement('button');
                    headerBtn.type = 'button';
                    headerBtn.className = 'web-kit-sidebar-item text-ink hover:bg-hover w-full flex items-center justify-between cursor-pointer !pr-1.5';
                    headerBtn.setAttribute('aria-label', '论坛');
                    headerBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

                    const origIcon = menuItemDiv.querySelector('.grid.size-5, svg, i');
                    const iconSpan = document.createElement('span');
                    iconSpan.className = 'grid size-5 flex-none place-items-center';
                    iconSpan.setAttribute('aria-hidden', 'true');
                    iconSpan.innerHTML = origIcon ? origIcon.outerHTML : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="size-5"><path d="M15 4v7H5.17L4 12.17V4h11m1-2H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1zm5 4h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1z" fill="currentColor"></path></svg>`;

                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'web-kit-sidebar-label flex-1 text-left truncate opacity-100';
                    labelSpan.setAttribute('aria-hidden', 'false');
                    labelSpan.textContent = '论坛';

                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'flex items-center gap-1.5 flex-none ml-auto';

                    const popoutBtn = document.createElement('a');
                    popoutBtn.href = getIframeTargetUrl();
                    popoutBtn.target = '_self';
                    popoutBtn.dataset.noveliaPopout = '1';
                    popoutBtn.title = '前往論壇 (取代當前頁面)';
                    popoutBtn.setAttribute('aria-label', '前往論壇');
                    popoutBtn.className = 'novelia-forum-popout-btn grid size-5 place-items-center rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10 text-muted hover:text-ink transition-colors';
                    popoutBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="size-3.5"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83l1.41 1.41L19 6.41V10h2V3h-7z" fill="currentColor"></path></svg>`;

                    popoutBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.location.assign(getIframeTargetUrl());
                    }, true);

                    actionsDiv.appendChild(popoutBtn);
                    headerBtn.appendChild(iconSpan);
                    headerBtn.appendChild(labelSpan);
                    headerBtn.appendChild(actionsDiv);
                    submenuContainer.appendChild(headerBtn);

                    const childrenDiv = document.createElement('div');
                    childrenDiv.className = `sidebar-submenu ${isExpanded ? 'flex' : 'hidden'} flex-col gap-1 mt-0.5`;

                    subItems.forEach(item => {
                        const link = document.createElement('a');
                        link.href = item.path;
                        link.className = 'web-kit-sidebar-item text-ink hover:bg-hover flex items-center gap-2 py-1.5 px-2 rounded-md text-sm';

                        const subIcon = document.createElement('span');
                        subIcon.className = 'grid size-4 flex-none place-items-center';
                        subIcon.setAttribute('aria-hidden', 'true');
                        subIcon.innerHTML = item.icon;

                        const subLabel = document.createElement('span');
                        subLabel.className = 'web-kit-sidebar-label truncate';
                        subLabel.textContent = item.name;

                        link.appendChild(subIcon);
                        link.appendChild(subLabel);

                        link.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (location.pathname !== item.path) {
                                history.pushState({}, '', item.path);
                                window.dispatchEvent(new Event("tm-locationchange"));
                            }
                            handleForumPage();
                            updateSelectedSubmenuItem();
                        });
                        childrenDiv.appendChild(link);
                    });

                    submenuContainer.appendChild(childrenDiv);

                    headerBtn.addEventListener('mouseenter', () => {
                        syncSidebarCollapsedState();
                        if (isSidebarCollapsed()) {
                            clearTimeout(hidePopoverTimer);
                            const rect = headerBtn.getBoundingClientRect();
                            popover.style.top = `${rect.top}px`;
                            popover.style.left = `${rect.right + 6}px`;
                            popover.style.display = 'flex';
                        }
                    });

                    headerBtn.addEventListener('mouseleave', () => {
                        if (isSidebarCollapsed()) {
                            hidePopoverTimer = setTimeout(() => {
                                if (!popover.matches(':hover')) popover.style.display = 'none';
                            }, 150);
                        }
                    });

                    headerBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isSidebarCollapsed()) return;

                        isExpanded = !isExpanded;
                        localStorage.setItem('novelia_forum_submenu_expanded', isExpanded ? 'true' : 'false');
                        headerBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

                        if (isExpanded) {
                            childrenDiv.classList.remove('hidden');
                            childrenDiv.classList.add('flex');
                        } else {
                            childrenDiv.classList.remove('flex');
                            childrenDiv.classList.add('hidden');
                        }
                    });

                    isUpdatingDom = true;
                    try {
                        menuItemDiv.replaceWith(submenuContainer);
                        updateSelectedSubmenuItem();
                    } finally {
                        isUpdatingDom = false;
                    }
                }

                popover.addEventListener('mouseleave', () => { popover.style.display = 'none'; });
                popover.addEventListener('mouseenter', () => { clearTimeout(hidePopoverTimer); });
            }

            function handleForumPage() {
                const currentlyForum = Utils.route.isForumPage();
                if (!currentlyForum) {
                    document.documentElement.classList.remove('novelia-forum-active');
                    document.body.classList.remove('novelia-forum-active');
                    document.querySelectorAll('.novelia-forum-hide').forEach(el => { el.classList.remove('novelia-forum-hide'); });

                    const existing = document.getElementById('novelia-forum-inline-container');
                    if (existing) existing.remove();
                    lastIsForum = false;
                    return;
                }

                if (!lastIsForum) {
                    autoCollapseSidebar();
                }
                lastIsForum = true;

                injectInlineStyles();
                document.documentElement.classList.add('novelia-forum-active');
                document.body.classList.add('novelia-forum-active');

                window.scrollTo(0, 0);
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;

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
                    loader.className = 'novelia-forum-spinner-wrapper';
                    loader.innerHTML = `<img src="https://${DOMAINS.HOST}/assets/mascot-DSVGgW05.webp" class="novelia-forum-mascot" alt="Loading..." /><span style="font-size: 18px; opacity: 0.8;">加载论坛中...</span>`;

                    const iframe = document.createElement('iframe');
                    iframe.className = 'novelia-forum-iframe';
                    iframe.src = getIframeTargetUrl();
                    iframe.allow = 'clipboard-read; clipboard-write; autoplay; fullscreen';

                    iframe.addEventListener('load', () => {
                        iframe.classList.add('novelia-iframe-loaded');
                        if (loader) loader.classList.add('novelia-spinner-hidden');
                        sendThemeToIframe();
                        const currentPath = Utils.route.getPath();
                        const innerPath = currentPath.startsWith('/forum') ? (currentPath.substring('/forum'.length) || '/') : '/';
                        iframe.contentWindow.postMessage({ type: 'NOVELIA_NAVIGATE', path: innerPath }, '*');
                    });
                    wrapper.appendChild(loader);
                    wrapper.appendChild(iframe);
                } else {
                    const iframe = wrapper.querySelector('iframe');
                    if (iframe && iframe.contentWindow) {
                        const currentPath = Utils.route.getPath();
                        const innerPath = currentPath.startsWith('/forum') ? (currentPath.substring('/forum'.length) || '/') : '/';
                        iframe.contentWindow.postMessage({ type: 'NOVELIA_NAVIGATE', path: innerPath }, '*');
                    }
                }

                isUpdatingDom = true;
                try {
                    Array.from(scrollContainer.children).forEach(child => {
                        if (child !== wrapper) child.classList.add('novelia-forum-hide');
                    });
                    if (wrapper.parentElement !== scrollContainer) scrollContainer.appendChild(wrapper); 
                } finally {
                    isUpdatingDom = false;
                }
                sendThemeToIframe();
            }

            // Intercept click on links targeting forum or non-forum host navigation
            window.addEventListener('click', function(e) {
                if (e.target.closest('[data-novelia-popout="1"], .novelia-forum-popout-btn')) return;
                const menuItem = e.target.closest('.n-menu-item, .n-menu-item-content, .web-kit-sidebar-item');
                if (menuItem && !menuItem.closest('.novelia-forum-submenu')) {
                    const anchor = menuItem.tagName === 'A' ? menuItem : menuItem.querySelector('a');
                    if (anchor) {
                        const href = anchor.getAttribute('href') || anchor.href;
                        if (href && !Utils.route.isForumUrl(href)) {
                            let targetPath = href;
                            try {
                                const parsed = new URL(href, location.origin);
                                targetPath = parsed.pathname + parsed.search + parsed.hash;
                            } catch (err) {}

                            setTimeout(() => {
                                if (location.pathname !== targetPath) {
                                    history.pushState({}, '', targetPath);
                                    window.dispatchEvent(new Event("tm-locationchange"));
                                }
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
                    if (Utils.route.isForumUrl(href)) {
                        e.preventDefault();
                        e.stopPropagation();

                        let targetPath = '/forum';
                        try {
                            const parsed = new URL(href, location.origin);
                            if (parsed.hostname === location.hostname) {
                                targetPath = parsed.pathname + parsed.search + parsed.hash;
                            } else if (parsed.hostname === DOMAINS.FORUM) {
                                targetPath = '/forum' + parsed.pathname + parsed.search + parsed.hash;
                            }
                        } catch (err) {
                            if (href.startsWith('/forum')) targetPath = href;
                        }

                        if (location.pathname !== targetPath) {
                            history.pushState({}, '', targetPath);
                            window.dispatchEvent(new Event("tm-locationchange"));
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
                if (typeof url === 'string' && Utils.route.isForumUrl(url)) {
                    let targetPath = '/forum';
                    try {
                        const parsed = new URL(url, location.origin);
                        if (parsed.hostname === location.hostname)          targetPath = parsed.pathname + parsed.search + parsed.hash;
                        else if (parsed.hostname === DOMAINS.FORUM)         targetPath = '/forum' + parsed.pathname + parsed.search + parsed.hash;
                    } catch (err) {
                        if (url.startsWith('/forum')) targetPath = url;
                    }
                    if (location.pathname !== targetPath) {
                        history.pushState({}, '', targetPath);
                        window.dispatchEvent(new Event("tm-locationchange"));
                    }
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

            const observer = new MutationObserver(() => {
                if (isUpdatingDom) return;
                observeSidebarToggle();
                transformForumSidebarMenu();
                syncSidebarCollapsedState();
                if (Utils.route.isForumPage()) {
                    handleForumPage();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            window.addEventListener('click', (e) => {
                if (e.target.closest('.sidebar-collapse, .n-layout-sider-toggle-button, .n-layout-sider-trigger, .n-layout-toggle-button')) {
                    setTimeout(syncSidebarCollapsedState, 10);
                    setTimeout(syncSidebarCollapsedState, 50);
                    setTimeout(syncSidebarCollapsedState, 150);
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
            if (location.hostname !== DOMAINS.FORUM && location.hostname !== DOMAINS.HOST) return;

            const RECORD_LIMIT = 10;

            function loadSearchHistory() { return Utils.storage.get('novelia_forum_search_history', []) }
            function saveSearchHistory(historyList) { Utils.storage.set('novelia_forum_search_history', historyList); }
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
                const currentPathname = Utils.route.getPath();
                const currentSearch = location.search;

                const boardMatch = currentPathname.match(/^\/c\/([^\/]+)/i) || currentPathname.match(/^\/forum\/c\/([^\/]+)/i);
                if (!boardMatch) return;

                const boardName = decodeURIComponent(boardMatch[1]);
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
                    wrapperElement = document.createElement('div');
                    wrapperElement.className = 'novelia-shistory-wrapper';
                    inputElement.parentNode.insertBefore(wrapperElement, inputElement);
                    wrapperElement.appendChild(inputElement);
                    if (wasFocused) { inputElement.focus() }
                }
                return wrapperElement;
            }
            function renderDropdown(inputElement) {
                closeDropdown();

                const historyList = loadSearchHistory();
                if (!Array.isArray(historyList) || historyList.length === 0) return;

                const wrapperElement = ensureInputWrapper(inputElement);
                if (!wrapperElement) return;

                const dropdownElement = document.createElement('div');
                dropdownElement.className = 'novelia-shistory-dropdown';

                historyList.forEach((entryItem, entryIndex) => {
                    const itemElement = document.createElement('div');
                    itemElement.className = 'novelia-shistory-item';
                    itemElement.dataset.index = String(entryIndex);

                    const querySpan = document.createElement('span');
                    querySpan.className = 'novelia-shistory-item-query';
                    querySpan.textContent = entryItem.query;

                    const boardSpan = document.createElement('span');
                    boardSpan.className = 'novelia-shistory-item-board';
                    boardSpan.textContent = entryItem.board;

                    const deleteBtn = document.createElement('button');
                    deleteBtn.type = 'button';
                    deleteBtn.className = 'novelia-shistory-item-del';
                    deleteBtn.textContent = '✕';
                    deleteBtn.title = '刪除此紀錄';
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
                        closeDropdown();
                        if (entryItem.url) { location.href = entryItem.url }
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
                if (inputElement.dataset.noveliaShistoryAttached) return;
                inputElement.dataset.noveliaShistoryAttached = '1';

                ensureInputWrapper(inputElement);

                inputElement.addEventListener('focus', () => { renderDropdown(inputElement) });
                inputElement.addEventListener('click', () => {
                    if (!activeDropdownElement) { renderDropdown(inputElement) }
                });
                inputElement.addEventListener('blur', () => {
                    setTimeout(() => { closeDropdown(true) }, 180);
                });
                inputElement.addEventListener('keydown', (event) => {
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
                                    closeDropdown();
                                    inputElement.blur();
                                    if (selectedEntry.url) { location.href = selectedEntry.url }
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
                const inputs = document.querySelectorAll('input[type="search"], input[enterkeyhint="search"], input[placeholder*="搜索"], input[placeholder*="搜尋"]');
                inputs.forEach(setupSearchInputHandlers);
            }
            injectStyles();
            checkAndRecordCurrentUrl();
            findAndAttachInputs();

            const observer = new MutationObserver(() => { findAndAttachInputs() });
            observer.observe(document.body, { childList: true, subtree: true });

            Utils.route.onChange(() => {
                closeDropdown();
                if (document.activeElement && typeof document.activeElement.blur === 'function') {
                    document.activeElement.blur();
                }
                setTimeout(checkAndRecordCurrentUrl, 200);
            });
        }
    };

    // ==========================================
    // 3. 小說分享按鈕 (Modules.share_btn)
    // ==========================================
    Modules.share_btn = {
        init: function() {
            if (location.hostname !== DOMAINS.HOST) return;

            const CLEAR_CACHE_KEY = { ctrl: true, alt: false, shift: false, key: "q" };
            const VIEW_CACHE_KEY = { ctrl: true, alt: false, shift: false, key: "v" };
            const REFRESH_UI_KEY = { ctrl: false, alt: false, shift: true, key: "r" };
            const BUTTON_WIDTH = "36px";
            const SHOW_HEADER_BTNS = true;

            const CACHE_CHANGE_EVENT_NAME = "novelia-cache-change",
                COPY_BUTTON_CLASS = "novelia-copy-btn",
                HEADER_BUTTON_CLASS = "novelia-header-btn",
                HEADER_INJECTION_MARK = "noveliaHeaderInjected",
                LIST_ITEM_SELECTOR = 'div.n-flex[role="none"]',
                LIST_WRAPPER_CLASS = "novelia-share-wrapper";

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

            const toast = Utils.ui.createToastManager('novelia-toast');

            const LinkCache = {
                items: [],
                add(link) {
                    if (!this.items.includes(link)) {
                        this.items.push(link);
                        this.dispatch();
                        return true;
                    }
                    return false;
                },
                clear() {
                    this.items = [];
                    Utils.gm.setClipboard('');
                    this.dispatch();
                },
                has(link) { return this.items.includes(link); },
                dispatch() {
                    document.dispatchEvent(new CustomEvent(CACHE_CHANGE_EVENT_NAME, { detail: { cache: [...this.items] } }));
                }
            };

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
                buttonElement.style.opacity = "1";
                buttonElement.style.borderColor = "#28a745";
                setTimeout(() => {
                    buttonElement.textContent = "📋";
                    buttonElement.style.opacity = ".6";
                    buttonElement.style.borderColor = "#aaa";
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

            function triggerUIRefresh() {
                removeStaleButtons(true);
                setTimeout(() => {
                    performFullScan();
                    toast.show("🔄 已重新偵測當前頁面並重新注入按鈕！");
                }, 200);
            }

            function createCopyButton(formattedLink) {
                const buttonElement = document.createElement("button");
                buttonElement.className = COPY_BUTTON_CLASS;
                buttonElement.title = "點擊累加複製：" + formattedLink;
                buttonElement.textContent = "📋";
                if (LinkCache.has(formattedLink)) buttonElement.style.display = "none";

                document.addEventListener(CACHE_CHANGE_EVENT_NAME, (event) => {
                    buttonElement.style.display = event.detail.cache.includes(formattedLink) ? "none" : "";
                });

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
                if (!Utils.route.isSharePage()) return;
                parentElement.querySelectorAll(LIST_ITEM_SELECTOR).forEach((itemElement) => {
                    if (itemElement.closest('.n-drawer') || itemElement.querySelector(`.${COPY_BUTTON_CLASS}`)) return;
                    const anchorElement = itemElement.querySelector("a[href^='/novel/']");
                    if (!anchorElement) return;
                    const textSpanElement = itemElement.querySelector("span.n-text");
                    const titleText = textSpanElement ? textSpanElement.textContent.trim() : anchorElement.textContent.trim();
                    const linkHref = anchorElement.getAttribute("href");
                    if (!titleText || !linkHref) return;

                    const formattedLink = `[${titleText}](https://${DOMAINS.HOST}${linkHref})`;
                    const copyBtn = createCopyButton(formattedLink);
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

                parentElement.querySelectorAll(".n-grid a[href*='/wenku/']").forEach((anchorElement) => {
                    if (anchorElement.closest('.n-drawer') || anchorElement.querySelector(`.${COPY_BUTTON_CLASS}`)) return;
                    const textSpanElement = anchorElement.querySelector("span.n-text");
                    if (!textSpanElement) return;
                    const titleText = textSpanElement.textContent.trim();
                    const linkHref = anchorElement.getAttribute("href");
                    if (!titleText || !linkHref) return;

                    const formattedLink = `[${titleText}](https://${DOMAINS.HOST}${linkHref})`;
                    const copyBtn = createCopyButton(formattedLink);

                    const gridWrapperDiv = document.createElement("div");
                    gridWrapperDiv.className = "novelia-grid-wrapper";
                    textSpanElement.replaceWith(gridWrapperDiv);
                    gridWrapperDiv.appendChild(copyBtn);
                    gridWrapperDiv.appendChild(textSpanElement);
                });
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
                const existingButtons = document.querySelectorAll(`.${HEADER_BUTTON_CLASS}`);

                if (!Utils.route.isSharePage()) {
                    existingButtons.forEach(button => button.remove());
                    document.querySelectorAll("h1").forEach((h1) => delete h1.dataset[HEADER_INJECTION_MARK]);
                    return;
                }

                const h1Elements = document.querySelectorAll("h1");
                if (!h1Elements.length) return;

                h1Elements.forEach((h1Element) => {
                    if (h1Element.closest('.n-drawer') || h1Element.dataset[HEADER_INJECTION_MARK] || h1Element.querySelector(`.${HEADER_BUTTON_CLASS}`)) return;

                    h1Element.dataset[HEADER_INJECTION_MARK] = "1";
                    Object.assign(h1Element.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap' });

                    const refreshBtn = document.createElement("button");
                    refreshBtn.className = `novelia-bundle-btn ${HEADER_BUTTON_CLASS}`;
                    refreshBtn.innerHTML = `${Utils.svg.REFRESH}<span>刷新</span>`;
                    refreshBtn.addEventListener("click", (e) => { e.preventDefault(); triggerUIRefresh(); });

                    const clearBtn = document.createElement("button");
                    clearBtn.className = `novelia-bundle-btn ${HEADER_BUTTON_CLASS}`;
                    clearBtn.innerHTML = `${Utils.svg.CLEAR}<span>清除快取</span>`;
                    clearBtn.addEventListener("click", (e) => { e.preventDefault(); clearLinkCache(); });

                    const viewBtn = document.createElement("button");
                    viewBtn.className = `novelia-bundle-btn ${HEADER_BUTTON_CLASS}`;
                    viewBtn.innerHTML = `${Utils.svg.VIEW}<span>查看快取</span>`;
                    viewBtn.addEventListener("click", (e) => { e.preventDefault(); viewLinkCache(); });

                    h1Element.appendChild(refreshBtn);
                    h1Element.appendChild(clearBtn);
                    h1Element.appendChild(viewBtn);
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
                if (checkKeyboardShortcut(event, REFRESH_UI_KEY)) { event.preventDefault(); triggerUIRefresh(); }
            });

            function removeStaleButtons(skipHeaders = false) {
                document.querySelectorAll(`.${LIST_WRAPPER_CLASS}`).forEach((wrapper) => {
                    const anchor = wrapper.querySelector('a');
                    if (anchor) wrapper.replaceWith(anchor);
                    else wrapper.remove();
                });

                document.querySelectorAll('.novelia-grid-wrapper').forEach((wrapper) => {
                    const originalText = wrapper.querySelector("span.n-text");
                    if (originalText) wrapper.replaceWith(originalText);
                    else wrapper.remove();
                });

                document.querySelectorAll(`.${COPY_BUTTON_CLASS}`).forEach((button) => button.remove());

                if (!skipHeaders) {
                    document.querySelectorAll(`.${HEADER_BUTTON_CLASS}`).forEach((button) => button.remove());
                    document.querySelectorAll("h1").forEach((h1Element) => delete h1Element.dataset[HEADER_INJECTION_MARK]);
                }
            }

            function performFullScan() {
                if (!Utils.route.isSharePage()) {
                    removeStaleButtons();
                    return;
                }
                injectLinkButtonsToItems(document);
                injectHeaderActionButtons();
            }

            performFullScan();
            window.addEventListener("tm-locationchange", () => { setTimeout(performFullScan, 200); });

            const mutationObserver = new MutationObserver((mutations) => {
                if (!Utils.route.isSharePage()) {
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
    // 4. 源站跳轉按鈕 (Modules.source_link)
    // ==========================================
    Modules.source_link = {
        init: function() {
            if (location.hostname.includes(DOMAINS.HOST) || location.hostname.includes(DOMAINS.FORUM)) return;
            const currentHostName = location.hostname;

            function parseSourceUrl(url, text) {
                if (!url || url.includes(DOMAINS.HOST)) return null;
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

                const jumpBtn = document.createElement('button');
                jumpBtn.textContent = '↗';
                jumpBtn.style.cssText = 'margin-left:6px;border:none;background:none;cursor:pointer;font-size:14px;color:#007BFF;';
                jumpBtn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(`https://${DOMAINS.HOST}/novel/${parsed.siteType}/${parsed.novelId}`, '_blank');
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
            if (location.hostname !== DOMAINS.HOST && location.hostname !== DOMAINS.FORUM) return;

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
            let collapsedStore = Utils.storage.get(LS_KEY, {});
            function saveStore() { Utils.storage.set(LS_KEY, collapsedStore); }

            const CollapseUI = {
                createCollapseWrapper({ anchorCard, repliesArea, isCollapsedState, replyCount, onToggleState }) {
                    const btnWrapper = document.createElement('div');
                    btnWrapper.className = 'novelia-collapse-btn-wrapper';

                    const btn = document.createElement('button');
                    btn.className = 'novelia-collapse-btn';
                    btn.type = 'button';
                    btn.innerHTML = `
                        <span class="novelia-collapse-icon ${isCollapsedState ? 'collapsed' : 'expanded'}">${Utils.svg.CHEVRON}</span>
                        <span class="novelia-collapse-btn-text">${isCollapsedState ? '展開回覆' : '收起回覆'} (${replyCount})</span>`;
                    btnWrapper.appendChild(btn);
                    anchorCard.after(btnWrapper);

                    const wrapper = document.createElement('div');
                    wrapper.className = `novelia-collapse-replies-wrapper ${isCollapsedState ? 'collapsed' : 'expanded'}`;
                    const inner = document.createElement('div');
                    inner.className = 'novelia-collapse-replies-inner';

                    repliesArea.parentNode.insertBefore(wrapper, repliesArea);
                    inner.appendChild(repliesArea);
                    wrapper.appendChild(inner);

                    btn.addEventListener('click', () => {
                        const currentlyCollapsed = wrapper.classList.contains('collapsed');
                        const newCollapsed = !currentlyCollapsed;

                        wrapper.classList.toggle('collapsed', newCollapsed);
                        wrapper.classList.toggle('expanded', !newCollapsed);

                        const icon = btn.querySelector('.novelia-collapse-icon');
                        if (icon) {
                            icon.classList.toggle('collapsed', newCollapsed);
                            icon.classList.toggle('expanded', !newCollapsed);
                        }

                        const text = btn.querySelector('.novelia-collapse-btn-text');
                        if (text) text.innerText = `${newCollapsed ? '展開回覆' : '收起回覆'} (${replyCount})`;

                        onToggleState(newCollapsed);
                    });
                    btn.addEventListener('mouseup', () => btn.blur());

                    const nativeReplyBtn = Array.from(anchorCard.querySelectorAll('button')).find(b => b.innerText.includes('回复') || b.innerText.includes('回覆'));
                    if (nativeReplyBtn) {
                        nativeReplyBtn.addEventListener('click', () => {
                            if (wrapper.classList.contains('collapsed')) btn.click();
                        });
                    }
                }
            };

            const NovelCommentCollapse = {
                getContext() {
                    const path = Utils.route.getPath();
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
                    const subReplies = repliesArea.querySelectorAll('div[style*="margin-left: 32px"]');
                    if (subReplies.length > 0) return subReplies.length;
                    if (repliesArea.matches('div[style*="margin-left: 32px"]')) return 1;
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
                        const commentId = Utils.hash.hashString(rawId);

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
                scan() {
                    const floors = Utils.comments.getNovelCommentFloors();
                    floors.forEach(NovelCommentCollapse.processFloor);
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
                    const path = Utils.route.getPath();
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
                            commentId = Utils.hash.hashString(rawId);
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
                    const { floors } = Utils.comments.getForumCommentFloors();
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

            if (location.hostname.includes(DOMAINS.FORUM)) ForumCommentCollapse.init();
            else NovelCommentCollapse.init();
        }
    };

    // ==========================================
    // 7. 評論區更新排序 (Modules.comment_notify)
    // ==========================================
    Modules.comment_notify = {
        init: function() {
            if (location.hostname !== DOMAINS.HOST && location.hostname !== DOMAINS.FORUM) return;

            let isUpdatingDom = false;
            let lastUrl = location.href;

            function extractMinAge(nodes) {
                let min = Infinity;
                nodes.forEach(node => {
                    const times = Array.from(node.querySelectorAll('time'));
                    if (node.tagName === 'TIME') times.push(node);
                    times.forEach(timeElement => {
                        const sec = Utils.time.parseToSecondsAgo(timeElement.textContent);
                        if (sec < min) min = sec;
                    });
                });
                return min;
            }

            function clearCurrentComments() {
                isUpdatingDom = true;
                try {
                    const novelFloors = Utils.comments.getNovelCommentFloors();
                    novelFloors.forEach(floor => {
                        floor.nodes.forEach(node => node.remove());
                    });

                    const { candidateFloors } = Utils.comments.getForumCommentFloors();
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
                const floors = Utils.comments.getNovelCommentFloors();
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
                const { floorContainer, candidateFloors, floors } = Utils.comments.getForumCommentFloors();
                if (!floorContainer || candidateFloors.length <= 1) return;

                floors.forEach(floor => {
                    floor.minSeconds = extractMinAge([floor.element]);
                });

                reorderFloorList(floorContainer, floors, candidateFloors[candidateFloors.length - 1].nextElementSibling);
            }

            function runSort() {
                if (isUpdatingDom || !Utils.route.isCommentNotifyPage()) return;
                if (location.hostname.includes(DOMAINS.FORUM) || location.pathname.includes('/forum/p/')) processForumComments();
                else processNovelComments();
            }

            let scanTimer = null;
            function scheduleSort() {
                clearTimeout(scanTimer);
                scanTimer = setTimeout(runSort, 150);
            }

            function setupSpaUrlObserver() {
                Utils.route.onChange(onUrlChange);
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
                if (Utils.route.isCommentNotifyPage()) scheduleSortWithRetries();
            }

            const observer = new MutationObserver(() => { if (!isUpdatingDom && Utils.route.isCommentNotifyPage()) scheduleSort(); });
            observer.observe(document.body, { childList: true, subtree: true });

            setupSpaUrlObserver();
            scheduleSortWithRetries();
        }
    };

    // ==========================================
    // 8 替換首頁橫幅 (Modules.banner_replace)
    // ==========================================
    Modules.banner_replace = {
        init: function() {
            if (location.hostname !== DOMAINS.HOST) return;

            const IMG_URL = 'https://n.novelia.cc/files-extra/banner.v1.webp';
            const IMG_FIT = 'cover';
            const IMG_POSITION = '50% 50%';
            const IMG_SCROLLING = true;
            const IMG_SCROLL_SPD = 20;

            function getBannerUrl() { return Utils.gm.getValue('banner_url', IMG_URL); }
            function getObjectFit() { return Utils.gm.getValue('banner_object_fit', IMG_FIT); }
            function getObjectPosition() { return Utils.gm.getValue('banner_object_position', IMG_POSITION); }
            function getScrolling() { return Utils.gm.getValue('banner_scrolling', IMG_SCROLLING); }
            function getScrollSpd() { return Number(Utils.gm.getValue('banner_scroll_spd', IMG_SCROLL_SPD)) || 0; }

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
                if (Utils.route.getPath() !== '/') { stopScroll(); return; }

                const bannerImg = document.querySelector('img[src*="/banners/"], img[src*="banner"], div.relative.overflow-hidden > img, div[class*="overflow-hidden"] > img');
                if (!bannerImg) return;

                const container = bannerImg.parentElement;
                if (!container) return;

                const targetUrl = getBannerUrl();
                const targetFit = getObjectFit();
                const targetPosition = getObjectPosition();
                const scrolling = getScrolling();

                if (!container.dataset.bannerLocked) {
                    const rect = container.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        container.style.aspectRatio = `${rect.width} / ${rect.height}`;
                        container.style.height = 'auto';
                        container.style.width = '100%';
                        container.dataset.bannerLocked = '1';
                    } else {
                        return;
                    }
                }
                Object.assign(container.style, { position: 'relative', overflow: 'hidden', overflowAnchor: 'none' });
                Object.assign(bannerImg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%'});

                if (!scrolling) {
                    const layer = container.querySelector(':scope > .banner-scroll-layer');
                    if (layer) layer.remove();
                    stopScroll();
                    bannerImg.style.visibility = '';
                    if (bannerImg.getAttribute('src') !== targetUrl) bannerImg.src = targetUrl;
                    if (bannerImg.style.objectFit !== targetFit) bannerImg.style.objectFit = targetFit;
                    if (bannerImg.style.objectPosition !== targetPosition) bannerImg.style.objectPosition = targetPosition;
                    return;
                }
                bannerImg.style.visibility = 'hidden';

                let layer = container.querySelector(':scope > .banner-scroll-layer');
                if (!layer) {
                    layer = document.createElement('div');
                    layer.className = 'banner-scroll-layer';
                    Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', backgroundRepeat: 'repeat-y', willChange: 'background-position', });
                    container.appendChild(layer);
                }

                const cssUrl = `url("${targetUrl}")`;
                if (layer.style.backgroundImage !== cssUrl) layer.style.backgroundImage = cssUrl;

                layer.style.backgroundSize = '100% auto';
                layer.dataset.posX = (targetPosition || '50% 50%').split(/\s+/)[0];

                if (activeLayer !== layer) startScroll(layer);
            }
            replaceBanner();

            const observer = new MutationObserver(() => { replaceBanner() });
            observer.observe(document.body, { childList: true, subtree: true });
            Utils.route.onChange(replaceBanner);
        }
    };

    runModules();
})();
