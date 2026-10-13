// ==UserScript==
// @name         Novelia Forum Iframe
// @namespace    https://n.novelia.cc/
// @version      2.3.0
// @description  移除 forum-iframe 的 sidebar，將三個板塊與社區守則併入原頁面 sidebar 的論壇按鈕 (改為 collapse submenu)，原頁面主題感染 forum-iframe
// @match        https://n.novelia.cc/*
// @match        https://forum.novelia.cc/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const IS_HOST = (location.hostname === 'n.novelia.cc');
    const IS_IFRAME_CONTEXT = (location.hostname === 'forum.novelia.cc');

    // =========================================================
    // IFRAME CONTEXT (forum.novelia.cc)
    // =========================================================
    if (IS_IFRAME_CONTEXT) {
        if (window.top === window.self) return;

        function injectIframeStyles() {
            if (document.getElementById('novelia-iframe-hide-sidebar-style')) return;
            const css = `
                /* Hide ONLY forum left sidebar, PRESERVE forum top header/navbar */
                aside,
                aside[class*="sidebar"],
                .web-kit-sidebar,
                nav[aria-label="站点导航"],
                nav[aria-label="站點導航"],
                nav[aria-label="章節導航"],
                nav[aria-label="章节导航"],
                div[data-v-491796e2] {
                    display: none !important;
                }
                /* Hide sidebar toggle button in forum header */
                .layout-toggle,
                button[aria-label*="sidebar"],
                button[aria-label*="侧边栏"] {
                    display: none !important;
                }
                /* Explicitly preserve top header & nav bar */
                header,
                .forum-header {
                    display: flex !important;
                }
                /* Ensure main body takes full width and extends downward */
                main, body, #app {
                    width: 100% !important;
                    max-width: 100% !important;
                    margin-left: 0 !important;
                    padding-left: 0 !important;
                    padding-bottom: 32px !important;
                }
                @media (max-width: 768px) {
                    main, body, #app {
                        padding-bottom: 96px !important;
                    }
                }
            `;
            if (typeof GM_addStyle === 'function') {
                GM_addStyle(css);
            } else {
                const style = document.createElement('style');
                style.id = 'novelia-iframe-hide-sidebar-style';
                style.textContent = css;
                (document.head || document.documentElement).appendChild(style);
            }
        }

        function injectMobileDrawerButton() {
            const forumHeader = document.querySelector('header, .forum-header, nav');
            if (!forumHeader || forumHeader.querySelector('.novelia-host-drawer-btn')) return;

            const targetContainer = forumHeader.querySelector('.layout-toggle') || forumHeader.querySelector('button') || forumHeader.firstElementChild;
            if (!targetContainer) return;

            const btn = document.createElement('button');
            btn.className = '__button-dark-131ezvy-ehllmd n-button n-button--default-type n-button--large-type novelia-host-drawer-btn';
            btn.type = 'button';
            btn.style.cssText = 'margin: 0px 8px; flex-shrink: 0; background: transparent; border: none; cursor: pointer; color: inherit; display: inline-flex; align-items: center; justify-content: center;';
            btn.innerHTML = `
                <span class="n-button__content">
                    <i role="img" class="n-icon __icon-dark-131ezvy-d" style="font-size: 24px; display: inline-flex;">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" fill="currentColor"></path>
                        </svg>
                    </i>
                </span>
            `;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.parent.postMessage({ type: 'NOVELIA_TOGGLE_HOST_SIDEBAR' }, '*');
            });

            targetContainer.before(btn);
        }

        function notifyHostUrlChange() {
            if (window.parent !== window) {
                const path = location.pathname + location.search + location.hash;
                window.parent.postMessage({
                    type: 'NOVELIA_URL_CHANGE',
                    path: path
                }, '*');
            }
        }

        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function(...args) {
            const result = originalPushState.apply(this, args);
            notifyHostUrlChange();
            return result;
        };

        history.replaceState = function(...args) {
            const result = originalReplaceState.apply(this, args);
            notifyHostUrlChange();
            return result;
        };

        window.addEventListener('popstate', notifyHostUrlChange);
        window.addEventListener('hashchange', notifyHostUrlChange);
        window.addEventListener('tm-locationchange', notifyHostUrlChange);

        notifyHostUrlChange();

        injectIframeStyles();
        injectMobileDrawerButton();

        const iframeObserver = new MutationObserver(() => {
            injectMobileDrawerButton();
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
                    if (isDark !== isCurrentlyDarkInForum) {
                        themeBtn.click();
                    }
                }
            }
        });

        return;
    }

    // =========================================================
    // HOST CONTEXT (n.novelia.cc)
    // =========================================================
    if (!IS_HOST) return;
    if (window.top !== window.self) return;

    const originalOpen = window.open;
    let isUpdatingDom = false;

    function isForumPage() {
        const path = window.__noveliaMockPath || location.pathname;
        return path === '/forum' || path.startsWith('/forum/');
    }

    function getIframeTargetUrl() {
        const path = window.__noveliaMockPath || (location.pathname + location.search + location.hash);
        if (path.startsWith('/forum/')) {
            const sub = path.substring('/forum'.length);
            return 'https://forum.novelia.cc' + sub;
        }
        return 'https://forum.novelia.cc/';
    }

    function isForumUrl(href) {
        if (!href) return false;
        try {
            const parsed = new URL(href, location.origin);
            if (parsed.hostname === 'forum.novelia.cc') return true;
            if (parsed.hostname === location.hostname && (parsed.pathname === '/forum' || parsed.pathname.startsWith('/forum/'))) return true;
        } catch (e) {
            if (/^https?:\/\/forum\.novelia\.cc/i.test(href)) return true;
            if (href === '/forum' || href.startsWith('/forum/')) return true;
        }
        return false;
    }

    function injectInlineStyles() {
        if (document.getElementById('novelia-forum-inline-styles')) return;

        const css = `
            /* Hide host page navbar when on forum page */
            html.novelia-forum-active header,
            html.novelia-forum-active .n-layout-header,
            html.novelia-forum-active nav.n-layout-header {
                display: none !important;
            }

            /* Preserve host sidebar full height when host navbar is hidden */
            html.novelia-forum-active .n-layout-sider,
            html.novelia-forum-active .n-layout-sidebar,
            html.novelia-forum-active aside.n-layout-sider,
            html.novelia-forum-active aside.web-kit-sidebar,
            html.novelia-forum-active .sidebar-shell {
                display: flex !important;
                height: 100vh !important;
                top: 0 !important;
            }

            html.novelia-forum-active,
            html.novelia-forum-active body,
            html.novelia-forum-active #app,
            html.novelia-forum-active .web-kit-layout,
            html.novelia-forum-active .n-layout-scroll-container,
            html.novelia-forum-active .n-layout {
                height: 100vh !important;
                overflow: hidden !important;
            }

            html.novelia-forum-active main,
            html.novelia-forum-active .n-layout-content,
            html.novelia-forum-active .n-layout-content .n-layout-scroll-container,
            html.novelia-forum-active .n-layout-content .layout-content {
                max-width: 100% !important;
                width: 100% !important;
                height: 100% !important;
                padding: 0 !important;
                margin: 0 !important;
                display: flex !important;
                flex-direction: column !important;
                flex: 1 1 auto !important;
            }

            .novelia-forum-hide {
                display: none !important;
            }

            #novelia-forum-inline-container {
                width: 100% !important;
                height: 100% !important;
                min-height: 100% !important;
                max-width: 100% !important;
                display: flex !important;
                flex-direction: column !important;
                margin: 0 !important;
                padding: 0 !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
                position: relative !important;
                flex: 1 1 auto !important;
            }

            #novelia-forum-inline-container iframe {
                width: 100% !important;
                height: 100% !important;
                min-height: 100% !important;
                border: none !important;
                display: block !important;
                opacity: 0;
                transition: opacity 0.3s ease-in-out;
            }

            #novelia-forum-inline-container iframe.novelia-iframe-loaded {
                opacity: 1 !important;
            }

            .novelia-forum-spinner-wrapper {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 12px;
                color: var(--n-text-color, #666);
                transition: opacity 0.3s ease-in-out;
                pointer-events: none;
                z-index: 10;
            }

            .novelia-forum-spinner-wrapper.novelia-spinner-hidden {
                opacity: 0 !important;
            }

            .novelia-forum-spinner {
                width: 36px;
                height: 36px;
                border: 3px solid rgba(99, 226, 183, 0.2);
                border-top-color: #63e2b7;
                border-radius: 50%;
                animation: novelia-spin 0.8s linear infinite;
            }

            @keyframes novelia-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            /* Preserve Naive UI sider collapse button & trigger */
            .n-layout-sider-toggle-button,
            .n-layout-sider-trigger,
            .n-layout-sider-toggle-bar,
            .n-layout-toggle-button,
            .sidebar-collapse {
                display: flex !important;
                z-index: 1000 !important;
            }

            /* Naive UI Submenu & Collapsed Sidebar Utility */
            .n-menu--collapsed .n-menu-item-content-header,
            .n-layout-sider--collapsed .n-menu-item-content-header,
            .n-menu--collapsed .n-submenu-children,
            .n-layout-sider--collapsed .n-submenu-children,
            .n-menu--collapsed .n-menu-item-content__arrow,
            .n-layout-sider--collapsed .n-menu-item-content__arrow {
                display: none !important;
            }

            .n-submenu-children.collapsed {
                display: none !important;
            }
            .n-submenu-children.expanded {
                display: block !important;
            }
            .n-menu-item-content-header {
                flex: 1 1 0%;
            }
            .n-menu-item-content-header a {
                color: inherit;
                text-decoration: none;
                display: block;
                width: 100%;
            }
            .novelia-forum-submenu .n-menu-item-content__arrow {
                margin-left: auto !important;
            }
            .sidebar-submenu .web-kit-sidebar-item {
                padding-left: 36px !important;
            }

            /* Forum Collapsed Popover Menu */
            .novelia-forum-dropdown-popover {
                position: fixed;
                z-index: 9999;
                background-color: rgb(72, 72, 78) !important;
                border: 1px solid rgb(72, 72, 78) !important;
                border-radius: 4px;
                box-shadow: 0 3px 6px -4px rgba(0, 0, 0, .12), 0 6px 16px 0 rgba(0, 0, 0, .08), 0 9px 28px 8px rgba(0, 0, 0, .05);
                padding: 6px 0;
                min-width: 160px;
                display: none;
                flex-direction: column;
            }
            .novelia-forum-dropdown-item {
                padding: 8px 16px;
                cursor: pointer;
                color: #ffffff !important;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 10px;
                transition: background-color 0.2s, color 0.2s;
            }
            .novelia-forum-dropdown-item:hover {
                background-color: rgba(255, 255, 255, 0.15) !important;
                color: #63e2b7 !important;
            }
            .novelia-forum-dropdown-item svg {
                width: 18px;
                height: 18px;
                fill: currentColor;
            }
        `;

        if (typeof GM_addStyle === 'function') {
            GM_addStyle(css);
        } else {
            const style = document.createElement('style');
            style.id = 'novelia-forum-inline-styles';
            style.textContent = css;
            document.head.appendChild(style);
        }
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
        const isDark = isHostDarkTheme();
        iframe.contentWindow.postMessage({
            type: 'NOVELIA_THEME_CHANGE',
            isDark: isDark
        }, '*');
    }

    function observeThemeChange() {
        const observer = new MutationObserver(() => {
            sendThemeToIframe();
            if (typeof queueMicrotask === 'function') queueMicrotask(sendThemeToIframe);
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(sendThemeToIframe);
        });

        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });

        if (document.head) {
            observer.observe(document.head, { childList: true, subtree: true, attributes: true });
        }

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
            if (mediaQuery.addEventListener) {
                mediaQuery.addEventListener('change', () => sendThemeToIframe());
            } else if (mediaQuery.addListener) {
                mediaQuery.addListener(() => sendThemeToIframe());
            }
        } catch (e) {}
    }

    function updateSelectedSubmenuItem() {
        const currentPath = window.__noveliaMockPath || location.pathname;
        const isForum = isForumPage();

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
                    if (isSelected) {
                        item.classList.add('n-menu-item-content--selected');
                    } else {
                        item.classList.remove('n-menu-item-content--selected');
                    }
                }
            }
        });
    }

    window.addEventListener('message', function(e) {
        if (!e.data) return;

        if (e.data.type === 'NOVELIA_TOGGLE_HOST_SIDEBAR') {
            const drawerBtn = document.querySelector('header button, .n-layout-header button, nav.n-layout-header button, .n-layout-sider-toggle-button, .sidebar-collapse');
            if (drawerBtn) drawerBtn.click();
        }
        if (e.data.type === 'NOVELIA_NAVIGATE_HOST') {
            const targetPath = e.data.path || '/favorite/web';
            if (location.pathname !== targetPath) {
                history.pushState({}, '', targetPath);
                window.dispatchEvent(new Event("tm-locationchange"));
            }
            handleForumPage();
            updateSelectedSubmenuItem();
        }
        if (e.data.type === 'NOVELIA_URL_CHANGE') {
            const innerPath = e.data.path || '/';
            const targetHostPath = (innerPath === '/' || innerPath === '') ? '/forum' : '/forum' + (innerPath.startsWith('/') ? innerPath : '/' + innerPath);
            const currentHostPath = window.__noveliaMockPath || (location.pathname + location.search + location.hash);
            if (currentHostPath !== targetHostPath && isForumPage()) {
                if (window.__noveliaMockPath) {
                    window.__noveliaMockPath = targetHostPath;
                } else {
                    history.replaceState({}, '', targetHostPath);
                }
                updateSelectedSubmenuItem();
            }
        }
    });

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
            if (contentDiv) {
                contentDiv.style.paddingLeft = collapsed ? '21px' : '32px';
            }
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
            const observer = new MutationObserver(() => {
                syncSidebarCollapsedState();
            });
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

    function findForumMenuItem() {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
            if (isForumUrl(a.getAttribute('href') || a.href)) {
                const item = a.closest('.web-kit-sidebar-item, .n-menu-item, [role="menuitem"]') || a;
                return { element: item, anchor: a, isWebKit: item.classList.contains('web-kit-sidebar-item') || !!item.closest('.web-kit-sidebar') };
            }
        }
        const textAnchors = Array.from(document.querySelectorAll('aside a, nav a, .web-kit-sidebar a, .n-menu a'));
        for (const a of textAnchors) {
            const text = a.textContent.trim();
            if (text === '论坛' || text === '論壇') {
                const item = a.closest('.web-kit-sidebar-item, .n-menu-item, [role="menuitem"]') || a;
                return { element: item, anchor: a, isWebKit: item.classList.contains('web-kit-sidebar-item') || !!item.closest('.web-kit-sidebar') };
            }
        }
        return null;
    }

    // Converts the "论坛" single menuitem into a collapse submenu with 4 items:
    // 站务公告 (/forum/c/announcements), 小说讨论 (/forum/c/novel), 意见反馈 (/forum/c/feedback), 社区守则 (/forum/rules)
    // - Header has NO hyperlink, ONLY toggles collapse, and defaults to collapsed state
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
            headerBtn.className = 'web-kit-sidebar-item text-ink hover:bg-hover w-full flex items-center justify-between cursor-pointer';
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

            const arrowSvg = document.createElement('svg');
            arrowSvg.className = `size-4 flex-none transition-[transform,opacity] duration-150 opacity-100`;
            arrowSvg.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
            arrowSvg.style.transition = 'transform 0.2s ease';
            arrowSvg.setAttribute('aria-hidden', 'true');
            arrowSvg.setAttribute('viewBox', '0 0 24 24');
            arrowSvg.innerHTML = `<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6l-6-6l1.41-1.41z" fill="currentColor"></path>`;

            headerBtn.appendChild(iconSpan);
            headerBtn.appendChild(labelSpan);
            headerBtn.appendChild(arrowSvg);
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
                        if (!popover.matches(':hover')) {
                            popover.style.display = 'none';
                        }
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
                arrowSvg.className = `size-4 flex-none transition-[transform,opacity] duration-150 opacity-100`;
            arrowSvg.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
            arrowSvg.style.transition = 'transform 0.2s ease';

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
        } else {
            // Create exact Naive UI submenu structure
            const submenuDiv = document.createElement('div');
            submenuDiv.className = 'n-submenu novelia-forum-submenu';
            submenuDiv.setAttribute('role', 'menu');
            submenuDiv.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

            const headerMenuItem = document.createElement('div');
            headerMenuItem.className = 'n-menu-item';
            headerMenuItem.setAttribute('role', 'menuitem');

            const contentDiv = document.createElement('div');
            contentDiv.setAttribute('role', 'none');
            contentDiv.className = `n-menu-item-content ${isExpanded ? '' : 'n-menu-item-content--collapsed'}`;
            contentDiv.style.paddingLeft = isSidebarCollapsed() ? '21px' : '32px';
            contentDiv.style.cursor = 'pointer';

            const origIcon = menuItemDiv.querySelector('.n-menu-item-content__icon');
            const iconHtml = origIcon ? origIcon.outerHTML : `
                <div class="n-menu-item-content__icon" role="none" style="width: 22px; height: 22px; font-size: 22px; margin-right: 19px;">
                    <i role="img" class="n-icon __icon-dark-131ezvy-d">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M15 4v7H5.17L4 12.17V4h11m1-2H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1zm5 4h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1z" fill="currentColor"></path></svg>
                    </i>
                </div>
            `;

            const titleHeader = `<div class="n-menu-item-content-header" role="none">论坛</div>`;
            const arrowIcon = `
                <i class="n-base-icon n-menu-item-content__arrow" aria-hidden="true" style="margin-left: auto; transition: transform 0.2s ease; transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'}">
                    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3.20041 5.73966C3.48226 5.43613 3.95681 5.41856 4.26034 5.70041L8 9.22652L11.7397 5.70041C12.0432 5.41856 12.5177 5.43613 12.7996 5.73966C13.0815 6.0432 13.0639 6.51775 12.7603 6.7996L8.51034 10.7996C8.22258 11.0668 7.77743 11.0668 7.48967 10.7996L3.23966 6.7996C2.93613 6.51775 2.91856 6.0432 3.20041 5.73966Z" fill="currentColor"></path>
                    </svg>
                </i>
            `;

            contentDiv.innerHTML = iconHtml + titleHeader + arrowIcon;
            headerMenuItem.appendChild(contentDiv);
            submenuDiv.appendChild(headerMenuItem);

            const childrenDiv = document.createElement('div');
            childrenDiv.className = `n-submenu-children ${isExpanded ? 'expanded' : 'collapsed'}`;
            childrenDiv.setAttribute('role', 'menu');

            subItems.forEach(item => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'n-menu-item';
                itemDiv.setAttribute('role', 'menuitem');

                const itemContent = document.createElement('div');
                itemContent.setAttribute('role', 'none');
                itemContent.className = 'n-menu-item-content';
                itemContent.style.paddingLeft = '53px';

                const itemIcon = document.createElement('div');
                itemIcon.className = 'n-menu-item-content__icon';
                itemIcon.setAttribute('role', 'none');
                itemIcon.style.cssText = 'width: 22px; height: 22px; font-size: 22px; margin-right: 19px; display: inline-flex; align-items: center;';
                itemIcon.innerHTML = `<i role="img" class="n-icon __icon-dark-131ezvy-d">${item.icon}</i>`;

                const itemHeader = document.createElement('div');
                itemHeader.className = 'n-menu-item-content-header';
                itemHeader.setAttribute('role', 'none');

                const link = document.createElement('a');
                link.href = item.path;
                link.textContent = item.name;

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

                itemHeader.appendChild(link);
                itemContent.appendChild(itemIcon);
                itemContent.appendChild(itemHeader);
                itemDiv.appendChild(itemContent);
                childrenDiv.appendChild(itemDiv);
            });

            submenuDiv.appendChild(childrenDiv);

            contentDiv.addEventListener('mouseenter', () => {
                syncSidebarCollapsedState();
                if (isSidebarCollapsed()) {
                    clearTimeout(hidePopoverTimer);
                    const rect = contentDiv.getBoundingClientRect();
                    popover.style.top = `${rect.top}px`;
                    popover.style.left = `${rect.right + 6}px`;
                    popover.style.display = 'flex';
                }
            });

            contentDiv.addEventListener('mouseleave', () => {
                if (isSidebarCollapsed()) {
                    hidePopoverTimer = setTimeout(() => {
                        if (!popover.matches(':hover')) {
                            popover.style.display = 'none';
                        }
                    }, 150);
                }
            });

            contentDiv.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (isSidebarCollapsed()) return;

                isExpanded = !isExpanded;
                localStorage.setItem('novelia_forum_submenu_expanded', isExpanded ? 'true' : 'false');

                submenuDiv.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
                const arrow = contentDiv.querySelector('.n-menu-item-content__arrow');
                if (arrow) arrow.style.transform = isExpanded ? 'rotate(180deg)' : 'rotate(0deg)';

                if (isExpanded) {
                    childrenDiv.classList.remove('collapsed');
                    childrenDiv.classList.add('expanded');
                    contentDiv.classList.remove('n-menu-item-content--collapsed');
                } else {
                    childrenDiv.classList.remove('expanded');
                    childrenDiv.classList.add('collapsed');
                    contentDiv.classList.add('n-menu-item-content--collapsed');
                }
            });

            isUpdatingDom = true;
            try {
                menuItemDiv.replaceWith(submenuDiv);
                updateSelectedSubmenuItem();
            } finally {
                isUpdatingDom = false;
            }
        }

        popover.addEventListener('mouseleave', () => {
            popover.style.display = 'none';
        });

        popover.addEventListener('mouseenter', () => {
            clearTimeout(hidePopoverTimer);
        });
    }

    function handleForumPage() {
        if (!isForumPage()) {
            document.documentElement.classList.remove('novelia-forum-active');
            document.body.classList.remove('novelia-forum-active');

            document.querySelectorAll('.novelia-forum-hide').forEach(el => {
                el.classList.remove('novelia-forum-hide');
            });

            const existing = document.getElementById('novelia-forum-inline-container');
            if (existing) existing.remove();
            return;
        }

        injectInlineStyles();
        document.documentElement.classList.add('novelia-forum-active');
        document.body.classList.add('novelia-forum-active');

        let wrapper = document.getElementById('novelia-forum-inline-container');

        const scrollContainer = document.querySelector('main') ||
                                document.querySelector('.n-layout-scroll-container') ||
                                document.querySelector('.n-layout-content') ||
                                document.querySelector('.layout-content');

        if (!scrollContainer) return;

        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.id = 'novelia-forum-inline-container';

            const loader = document.createElement('div');
            loader.className = 'novelia-forum-spinner-wrapper';
            loader.innerHTML = `
                <div class="novelia-forum-spinner"></div>
                <span style="font-size: 13px; opacity: 0.8;">加载论坛中...</span>
            `;

            const iframe = document.createElement('iframe');
            iframe.className = 'novelia-forum-iframe';
            iframe.src = getIframeTargetUrl();
            iframe.allow = 'clipboard-read; clipboard-write; autoplay; fullscreen';

            iframe.addEventListener('load', () => {
                iframe.classList.add('novelia-iframe-loaded');
                if (loader) loader.classList.add('novelia-spinner-hidden');
                sendThemeToIframe();
                const currentPath = window.__noveliaMockPath || (location.pathname + location.search + location.hash);
                const innerPath = currentPath.startsWith('/forum') ? (currentPath.substring('/forum'.length) || '/') : '/';
                iframe.contentWindow.postMessage({
                    type: 'NOVELIA_NAVIGATE',
                    path: innerPath
                }, '*');
            });

            wrapper.appendChild(loader);
            wrapper.appendChild(iframe);
        } else {
            const iframe = wrapper.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
                const currentPath = window.__noveliaMockPath || (location.pathname + location.search + location.hash);
                const innerPath = currentPath.startsWith('/forum') ? (currentPath.substring('/forum'.length) || '/') : '/';
                iframe.contentWindow.postMessage({
                    type: 'NOVELIA_NAVIGATE',
                    path: innerPath
                }, '*');
            }
        }

        isUpdatingDom = true;
        try {
            Array.from(scrollContainer.children).forEach(child => {
                if (child !== wrapper) {
                    child.classList.add('novelia-forum-hide');
                }
            });

            if (wrapper.parentElement !== scrollContainer) {
                scrollContainer.appendChild(wrapper);
            }
        } finally {
            isUpdatingDom = false;
        }

        sendThemeToIframe();
    }

    // Intercept click on links targeting forum or non-forum host navigation
    window.addEventListener('click', function(e) {
        const menuItem = e.target.closest('.n-menu-item, .n-menu-item-content, .web-kit-sidebar-item');
        if (menuItem && !menuItem.closest('.novelia-forum-submenu')) {
            const anchor = menuItem.tagName === 'A' ? menuItem : menuItem.querySelector('a');
            if (anchor) {
                const href = anchor.getAttribute('href') || anchor.href;
                if (href && !isForumUrl(href)) {
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
            if (isForumUrl(href)) {
                e.preventDefault();
                e.stopPropagation();

                let targetPath = '/forum';
                try {
                    const parsed = new URL(href, location.origin);
                    if (parsed.hostname === location.hostname) {
                        targetPath = parsed.pathname + parsed.search + parsed.hash;
                    } else if (parsed.hostname === 'forum.novelia.cc') {
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
        if (typeof url === 'string' && isForumUrl(url)) {
            let targetPath = '/forum';
            try {
                const parsed = new URL(url, location.origin);
                if (parsed.hostname === location.hostname) {
                    targetPath = parsed.pathname + parsed.search + parsed.hash;
                } else if (parsed.hostname === 'forum.novelia.cc') {
                    targetPath = '/forum' + parsed.pathname + parsed.search + parsed.hash;
                }
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
        if (isForumPage()) {
            handleForumPage();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Listen for sider toggle clicks
    window.addEventListener('click', (e) => {
        if (e.target.closest('.sidebar-collapse, .n-layout-sider-toggle-button, .n-layout-sider-trigger, .n-layout-toggle-button')) {
            setTimeout(syncSidebarCollapsedState, 10);
            setTimeout(syncSidebarCollapsedState, 50);
            setTimeout(syncSidebarCollapsedState, 150);
        }
    }, true);

    observeThemeChange();

    // Initial check
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            transformForumSidebarMenu();
            handleForumPage();
        });
    } else {
        transformForumSidebarMenu();
        handleForumPage();
    }

})();
