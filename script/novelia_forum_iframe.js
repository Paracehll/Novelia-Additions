// ==UserScript==
// @name         Novelia Forum Iframe
// @namespace    https://n.novelia.cc/
// @version      1.2.0
// @description  在 https://n.novelia.cc/ 點擊論壇按鈕時，導向到 https://n.novelia.cc/forum 並將 404 容器替換為滿版內嵌 https://forum.novelia.cc/ 的 iframe，移除母頁 scrollbar
// @match        https://n.novelia.cc/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    if (window.top !== window.self) return;

    const originalOpen = window.open;

    function isForumPage() {
        const path = window.__noveliaMockPath || location.pathname;
        return path === '/forum' || path.startsWith('/forum/');
    }

    function getIframeTargetUrl() {
        const path = window.__noveliaMockPath || location.pathname;
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
            html.novelia-forum-active,
            html.novelia-forum-active body,
            html.novelia-forum-active .n-layout-scroll-container,
            html.novelia-forum-active .n-layout {
                overflow: hidden !important;
            }

            html.novelia-forum-active .layout-content,
            html.novelia-forum-active .n-layout-content,
            html.novelia-forum-active .n-layout-scroll-container {
                max-width: 100% !important;
                width: 100% !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
            }

            #novelia-forum-inline-container {
                width: 100% !important;
                max-width: 100% !important;
                display: flex !important;
                flex-direction: column !important;
                margin: 0 !important;
                padding: 0 !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
            }

            #novelia-forum-inline-container iframe {
                width: 100% !important;
                height: 100% !important;
                border: none !important;
                display: block !important;
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

    function getHeaderHeight() {
        const header = document.querySelector('header, .n-layout-header, nav');
        if (header && header.offsetHeight > 0 && header.offsetHeight < 120) {
            return header.offsetHeight;
        }
        return 56;
    }

    function handleForumPage() {
        if (!isForumPage()) {
            document.documentElement.classList.remove('novelia-forum-active');
            document.body.classList.remove('novelia-forum-active');
            const existing = document.getElementById('novelia-forum-inline-container');
            if (existing) existing.remove();
            return;
        }

        injectInlineStyles();
        document.documentElement.classList.add('novelia-forum-active');
        document.body.classList.add('novelia-forum-active');

        const headerHeight = getHeaderHeight();
        let wrapper = document.getElementById('novelia-forum-inline-container');

        if (wrapper) {
            wrapper.style.height = `calc(100vh - ${headerHeight}px)`;
            return;
        }

        const resultElement = document.querySelector('.n-result');
        const targetContainer = resultElement ? resultElement.parentElement : (document.querySelector('.layout-content') || document.querySelector('.n-layout-scroll-container'));

        if (!targetContainer) return;

        wrapper = document.createElement('div');
        wrapper.id = 'novelia-forum-inline-container';
        wrapper.style.height = `calc(100vh - ${headerHeight}px)`;

        const iframe = document.createElement('iframe');
        iframe.className = 'novelia-forum-iframe';
        iframe.src = getIframeTargetUrl();
        iframe.allow = 'clipboard-read; clipboard-write; autoplay; fullscreen';

        wrapper.appendChild(iframe);

        if (resultElement) {
            resultElement.replaceWith(wrapper);
        } else {
            targetContainer.appendChild(wrapper);
        }
    }

    // Intercept click on links targeting forum
    window.addEventListener('click', function(e) {
        const anchor = e.target.closest('a');
        if (anchor) {
            const href = anchor.getAttribute('href') || anchor.href;
            if (isForumUrl(href)) {
                e.preventDefault();
                e.stopPropagation();
                if (location.pathname !== '/forum') {
                    history.pushState({}, '', '/forum');
                    window.dispatchEvent(new Event("tm-locationchange"));
                }
                handleForumPage();
                return;
            }
        }
    }, true);

    // Override window.open for forum links
    window.open = function(url, target, features) {
        if (typeof url === 'string' && isForumUrl(url)) {
            if (location.pathname !== '/forum') {
                history.pushState({}, '', '/forum');
                window.dispatchEvent(new Event("tm-locationchange"));
            }
            handleForumPage();
            return null;
        }
        return originalOpen.apply(this, arguments);
    };

    window.addEventListener("tm-locationchange", () => {
        handleForumPage();
        setTimeout(handleForumPage, 100);
        setTimeout(handleForumPage, 300);
    });

    const observer = new MutationObserver(() => {
        if (isForumPage()) {
            handleForumPage();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handleForumPage);
    } else {
        handleForumPage();
    }

})();
