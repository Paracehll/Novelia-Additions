// ==UserScript==
// @name         Novelia Utils
// @namespace    novelia-utils
// @version      1.0.0
// @description  Novelia 工具函式庫 (DOMAINS & Utils)
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

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
            getRouter() {
                try {
                    const appEl = document.querySelector('#app') || document.querySelector('[data-v-app]');
                    if (appEl) {
                        if (appEl.__vue_app__?.config?.globalProperties?.$router) return appEl.__vue_app__.config.globalProperties.$router;
                        if (appEl._vnode?.component?.proxy?.$router) return appEl._vnode.component.proxy.$router;
                        if (appEl.__vue_app__?._instance?.proxy?.$router) return appEl.__vue_app__._instance.proxy.$router;
                        if (appEl.__vue_app__?._context?.provides) {
                            const provides = appEl.__vue_app__._context.provides;
                            const keys = [...Object.getOwnPropertySymbols(provides), ...Object.keys(provides)];
                            for (const key of keys) {
                                const val = provides[key];
                                if (val && typeof val.push === 'function' && (val.currentRoute || val.options)) {
                                    return val;
                                }
                            }
                        }
                    }
                    if (window.__vue_app__?.config?.globalProperties?.$router) return window.__vue_app__.config.globalProperties.$router;
                    if (window.router && typeof window.router.push === 'function') return window.router;
                } catch (e) {}
                return null;
            },
            push(path) {
                if (!path) return;
                const isCurrentlyForum = Utils.route.isForumPage();
                const isTargetForum = Utils.route.isForumUrl(path);

                if (isCurrentlyForum && isTargetForum) {
                    if (Utils.route.getPath() !== path) history.pushState({}, '', path);
                    window.dispatchEvent(new Event('tm-locationchange'));
                    return;
                }

                const router = this.getRouter();
                if (router && typeof router.push === 'function') {
                    try {
                        const res = router.push(path);
                        if (res && typeof res.catch === 'function') {
                            res.catch(() => {
                                if (Utils.route.getPath() !== path) {
                                    history.pushState({}, '', path);
                                    window.dispatchEvent(new Event('popstate'));
                                }
                            });
                        }
                    } catch (e) {
                        history.pushState({}, '', path);
                        window.dispatchEvent(new Event('popstate'));
                    }
                } else {
                    history.pushState({}, '', path);
                    window.dispatchEvent(new Event('popstate'));
                }
                window.dispatchEvent(new Event('tm-locationchange'));
            },
            getPath() { return window.__noveliaMockPath || (location.pathname + location.search + location.hash) },
            matchNovelPath(pathname) {
                const pathMatch = pathname.match(/^\/novel\/([^\/?#]+)\/([^\/?#]+)\/?$/i);
                if (pathMatch) return { source: pathMatch[1], id: pathMatch[2] };
                const wenkuMatch = pathname.match(/^\/wenku\/([^\/?#]+)\/?$/i);
                if (wenkuMatch) return { source: 'wenku', id: wenkuMatch[1] };
                return null;
            },
            isForumPage() {
                const path = Utils.route.getPath();
                return path === '/forum' || path.startsWith('/forum/') || path.startsWith('/forum?');
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
                const cleanPath = Utils.route.getPath().split('?')[0].split('#')[0];
                if (/^\/novel\/[^\/]+\/[^\/]+\/[^\/]+/i.test(cleanPath)) return false;
                if (/^\/novel\/[^\/]+\/[^\/]+\/?$/.test(cleanPath)) return false;
                return cleanPath === '/' || cleanPath.startsWith('/novel') || cleanPath.startsWith('/favorite') || cleanPath.startsWith('/wenku') || cleanPath.startsWith('/search') || cleanPath.startsWith('/read-history');
            },
            isCommentCountPage() {
                const cleanPath = Utils.route.getPath().split('?')[0].split('#')[0];
                if (/^\/novel\/[^\/]+\/[^\/]+\/[^\/]+/i.test(cleanPath)) return false;
                return cleanPath === '/' || cleanPath.startsWith('/novel') || cleanPath.startsWith('/favorite') || cleanPath.startsWith('/wenku') || cleanPath.startsWith('/search') || cleanPath.startsWith('/read-history');
            },
            isCommentNotifyPage() {
                const cleanPath = Utils.route.getPath().split('?')[0].split('#')[0];
                const host = location.hostname;
                if (host === DOMAINS.HOST && /^\/novel\/[^\/]+\/[^\/]+\/?$/i.test(cleanPath)) return true;
                if (host === DOMAINS.HOST && /^\/wenku\/[^\/]+\/?$/i.test(cleanPath)) return true;
                if ((host === DOMAINS.HOST && /^\/forum\/p\/[^\/]+\/?$/i.test(cleanPath)) || (host === DOMAINS.FORUM && /^\/p\/[^\/]+\/?$/i.test(cleanPath))) return true;
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
        mascot: {
            url: `https://${DOMAINS.HOST}/assets/mascot-DSVGgW05.webp`,
            _blobUrl: null,
            _promise: null,
            getUrl() {
                if (this._blobUrl) return Promise.resolve(this._blobUrl);
                if (!this._promise) {
                    this._promise = new Promise((resolve) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: this.url,
                            responseType: 'blob',
                            headers: { 'Cache-Control': 'max-age=3600' },
                            onload: (response) => {
                                if (response.status >= 200 && response.status < 300 && response.response) {
                                    this._blobUrl = URL.createObjectURL(response.response);
                                    resolve(this._blobUrl);
                                } else {
                                    console.error('[Utils.mascot] Failed to fetch mascot image:', `HTTP ${response.status}`);
                                    this._promise = null;
                                    resolve(this.url);
                                }
                            },
                            onerror: (error) => {
                                console.error('[Utils.mascot] Failed to fetch mascot image:', error);
                                this._promise = null;
                                resolve(this.url);
                            },
                            ontimeout: () => {
                                console.error('[Utils.mascot] Request timed out');
                                this._promise = null;
                                resolve(this.url);
                            },
                            timeout: 15000
                        });
                    });
                }
                return this._promise;
            },
            getSyncUrl() { return this._blobUrl || this.url }
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

    if (typeof window !== 'undefined') {
        window.DOMAINS = DOMAINS;
        window.Utils = Utils;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.DOMAINS = DOMAINS;
        globalThis.Utils = Utils;
    }
})();
