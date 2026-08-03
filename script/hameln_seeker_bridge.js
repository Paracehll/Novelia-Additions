// ==UserScript==
// @name         哈梅林更新檢測 跨域對接橋樑 (Hameln Seeker Bridge)
// @namespace    https://syosetu.org/
// @version      1.0.0
// @description  協助 Hameln Seeker 跨越同源政策 (SOP) 限制，將 iframe 中的小說目錄與章節 HTML 安全地回傳給父視窗。
// @author       Mr.Claude
// @match        https://syosetu.org/novel/*
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 只有在 iframe 當中運作時才執行對接
    if (window.top === window.self) return;

    console.log('[Hameln Seeker Bridge] 檢測到運行於 iframe，準備回傳內容...');

    // 取得當前網頁的完整 HTML 與網址
    const messageData = {
        type: 'hameln_seeker_html',
        url: window.location.href,
        html: document.documentElement.outerHTML
    };

    // 透過 postMessage 安全地傳遞給父視窗 (Seeker)
    window.parent.postMessage(messageData, '*');

    console.log('[Hameln Seeker Bridge] 內容已成功傳送！');
})();
