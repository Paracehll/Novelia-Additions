// ==UserScript==
// @name         Novelia 論壇搜尋歷史
// @namespace    https://forum.novelia.cc/
// @version      1.0.0
// @description  紀錄與管理 Novelia 論壇搜尋歷史紀錄，支援鍵盤上下鍵選擇
// @match        *://forum.novelia.cc/*
// @match        *://n.novelia.cc/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const RECORD_LIMIT = 10;
    const STORAGE_KEY = 'novelia_forum_search_history';

    function loadSearchHistory() {
        try {
            const rawData = localStorage.getItem(STORAGE_KEY);
            return rawData ? JSON.parse(rawData) : [];
        } catch (error) {
            console.error('[Novelia Search History] Failed to load history:', error);
            return [];
        }
    }

    function saveSearchHistory(historyList) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(historyList));
        } catch (error) {
            console.error('[Novelia Search History] Failed to save history:', error);
        }
    }

    function recordSearchEntry(boardName, queryContent, fullUrl) {
        const trimmedQuery = (queryContent || '').trim();
        if (!trimmedQuery) return;

        let historyList = loadSearchHistory();

        // Remove duplicates with same board and query
        historyList = historyList.filter((item) => {
            return !(item.board === boardName && item.query === trimmedQuery);
        });

        // Prepend new record
        historyList.unshift({
            board: boardName,
            query: trimmedQuery,
            url: fullUrl || `/c/${encodeURIComponent(boardName)}?q=${encodeURIComponent(trimmedQuery)}`,
            timestamp: Date.now()
        });

        // Enforce limit
        if (historyList.length > RECORD_LIMIT) {
            historyList = historyList.slice(0, RECORD_LIMIT);
        }

        saveSearchHistory(historyList);
    }

    function removeSearchEntry(index) {
        const historyList = loadSearchHistory();
        if (index >= 0 && index < historyList.length) {
            historyList.splice(index, 1);
            saveSearchHistory(historyList);
        }
    }

    function clearSearchHistory() {
        saveSearchHistory([]);
    }

    function checkAndRecordCurrentUrl() {
        const currentPathname = location.pathname;
        const currentSearch = location.search;

        // Match /c/{board}?q={query_content}
        const boardMatch = currentPathname.match(/^\/c\/([^\/]+)/i);
        if (!boardMatch) return;

        const boardName = decodeURIComponent(boardMatch[1]);
        const urlParams = new URLSearchParams(currentSearch);
        const queryContent = urlParams.get('q');

        if (queryContent && queryContent.trim()) {
            recordSearchEntry(boardName, queryContent.trim(), location.href);
        }
    }

    function injectStyles() {
        if (document.getElementById('novelia-shistory-styles')) return;

        const styleElement = document.createElement('style');
        styleElement.id = 'novelia-shistory-styles';
        styleElement.textContent = `
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
        `;
        document.head.appendChild(styleElement);
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
                setTimeout(() => {
                    dropdownToClose.remove();
                }, 180);
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
            if (wasFocused) {
                inputElement.focus();
            }
        }
        return wrapperElement;
    }

    function renderDropdown(inputElement) {
        closeDropdown();

        const historyList = loadSearchHistory();
        if (historyList.length === 0) return;

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
                if (entryItem.url) {
                    location.href = entryItem.url;
                }
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
            if (isHighlighted) {
                itemElement.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function setupSearchInputHandlers(inputElement) {
        if (inputElement.dataset.noveliaShistoryAttached) return;
        inputElement.dataset.noveliaShistoryAttached = '1';

        ensureInputWrapper(inputElement);

        inputElement.addEventListener('focus', () => {
            renderDropdown(inputElement);
        });

        inputElement.addEventListener('click', () => {
            if (!activeDropdownElement) {
                renderDropdown(inputElement);
            }
        });

        inputElement.addEventListener('blur', () => {
            setTimeout(() => {
                closeDropdown(true);
            }, 180);
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
                            if (selectedEntry.url) {
                                location.href = selectedEntry.url;
                            }
                            return;
                        }
                    }
                }
                return;
            }

            if (!activeDropdownElement) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    renderDropdown(inputElement);
                }
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

    function init() {
        injectStyles();
        checkAndRecordCurrentUrl();

        findAndAttachInputs();

        const observer = new MutationObserver(() => {
            findAndAttachInputs();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        function handleLocationChange() {
            closeDropdown();
            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }
            setTimeout(checkAndRecordCurrentUrl, 200);
        }

        // Listen to SPA location changes
        window.addEventListener('popstate', handleLocationChange);

        const originalPushState = history.pushState;
        if (originalPushState) {
            history.pushState = function (...args) {
                const result = originalPushState.apply(this, args);
                handleLocationChange();
                return result;
            };
        }

        const originalReplaceState = history.replaceState;
        if (originalReplaceState) {
            history.replaceState = function (...args) {
                const result = originalReplaceState.apply(this, args);
                handleLocationChange();
                return result;
            };
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
