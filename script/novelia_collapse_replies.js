// ==UserScript==
// @name         Novelia 摺疊評論區回覆
// @version      1.0
// @description  Collapse comment replies with animation and persistence. Matches the native implementation.
// @match        *://n.novelia.cc/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // CSS for smooth transitions and button styling
    GM_addStyle(`
        .tm-collapse-btn-wrapper {
            margin-top: 8px;
            display: flex;
            align-items: center;
        }
        .tm-collapse-btn {
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
        .tm-collapse-btn:hover {
            opacity: 1;
            background-color: rgba(0, 0, 0, 0.05);
        }
        .dark .tm-collapse-btn:hover {
            background-color: rgba(255, 255, 255, 0.1);
        }
        .tm-collapse-icon {
            transition: transform 0.3s ease;
            margin-right: 4px;
            display: flex;
            align-items: center;
        }
        .tm-collapse-icon.collapsed {
            transform: rotate(0deg);
        }
        .tm-collapse-icon.expanded {
            transform: rotate(90deg);
        }
        .tm-replies-wrapper {
            display: grid;
            transition: grid-template-rows 0.3s ease-in-out;
            overflow: hidden;
        }
        .tm-replies-wrapper.collapsed {
            grid-template-rows: 0fr;
        }
        .tm-replies-wrapper.expanded {
            grid-template-rows: 1fr;
        }
        .tm-replies-inner {
            overflow: hidden;
            display: flow-root;
        }
    `);

    const LS_KEY = 'collapsed-comments';
    let collapsedStore = JSON.parse(localStorage.getItem(LS_KEY) || '{}');

    function saveStore() {
        localStorage.setItem(LS_KEY, JSON.stringify(collapsedStore));
    }

    const chevronSvg = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"></path>
        </svg>
    `;

    function processCommentThread(commentHeader) {
        // A comment header is the <b> tag containing the username.
        // It's inside an .n-flex container.
        const headerFlex = commentHeader.closest('.n-flex');
        if (!headerFlex) return;

        // Ensure this is a root comment (not indented by 32px)
        const isRoot = !headerFlex.parentElement.closest('div[style*="margin-left: 32px"]');
        if (!isRoot) return;

        if (headerFlex.dataset.tmProcessed) return;
        headerFlex.dataset.tmProcessed = "true";

        // Find the card content
        const card = headerFlex.nextElementSibling;
        if (!card || !card.classList.contains('n-card')) return;

        // Find the replies area - it's a div with margin-left: 32px that follows
        let repliesArea = card.nextElementSibling;
        while (repliesArea && !repliesArea.matches('div[style*="margin-left: 32px"]')) {
            repliesArea = repliesArea.nextElementSibling;
        }

        if (!repliesArea) return;

        // Persistence key (Unicode safe)
        const author = commentHeader.innerText.trim();
        const time = headerFlex.querySelector('time')?.innerText || "";
        const rawId = author + time;
        // Simple hash function for Unicode strings
        let hash = 0;
        for (let i = 0; i < rawId.length; i++) {
            const char = rawId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        const commentId = 'c' + Math.abs(hash).toString(36);

        // Get reply count from the UI if possible, or count elements
        const replyCount = repliesArea.querySelectorAll('.n-flex').length;

        const isCollapsed = !!collapsedStore[commentId];

        // Create toggle button
        const btnWrapper = document.createElement('div');
        btnWrapper.className = 'tm-collapse-btn-wrapper';

        const btn = document.createElement('button');
        btn.className = 'tm-collapse-btn';
        btn.innerHTML = `
            <span class="tm-collapse-icon ${isCollapsed ? 'collapsed' : 'expanded'}">${chevronSvg}</span>
            <span class="tm-btn-text">${isCollapsed ? '展开回复' : '收起回复'} (${replyCount})</span>
        `;

        btnWrapper.appendChild(btn);
        card.after(btnWrapper);

        // Create animation wrapper
        const wrapper = document.createElement('div');
        wrapper.className = `tm-replies-wrapper ${isCollapsed ? 'collapsed' : 'expanded'}`;
        const inner = document.createElement('div');
        inner.className = 'tm-replies-inner';

        // Move repliesArea into wrapper
        repliesArea.parentNode.insertBefore(wrapper, repliesArea);
        inner.appendChild(repliesArea);
        wrapper.appendChild(inner);

        btn.addEventListener('click', () => {
            const currentlyCollapsed = wrapper.classList.contains('collapsed');
            if (currentlyCollapsed) {
                wrapper.classList.remove('collapsed');
                wrapper.classList.add('expanded');
                btn.querySelector('.tm-collapse-icon').classList.replace('collapsed', 'expanded');
                btn.querySelector('.tm-btn-text').innerText = `收起回复 (${replyCount})`;
                delete collapsedStore[commentId];
            } else {
                wrapper.classList.remove('expanded');
                wrapper.classList.add('collapsed');
                btn.querySelector('.tm-collapse-icon').classList.replace('expanded', 'collapsed');
                btn.querySelector('.tm-btn-text').innerText = `展开回复 (${replyCount})`;
                collapsedStore[commentId] = true;
            }
            saveStore();
        });

        // Mobile hover fix
        btn.addEventListener('mouseup', () => btn.blur());

        // Handle native Reply button
        const nativeReplyBtn = Array.from(headerFlex.querySelectorAll('button')).find(b => b.innerText.includes('回复'));
        if (nativeReplyBtn) {
            nativeReplyBtn.addEventListener('click', () => {
                if (wrapper.classList.contains('collapsed')) {
                    btn.click();
                }
            });
        }
    }

    // Use a MutationObserver to handle dynamically loaded comments
    const observer = new MutationObserver(() => {
        document.querySelectorAll('.n-flex b').forEach(processCommentThread);
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
