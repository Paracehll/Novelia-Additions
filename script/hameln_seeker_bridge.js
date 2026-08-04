// ==UserScript==
// @name         哈梅林更新檢測 跨域對接橋樑 (Hameln Seeker Bridge)
// @namespace    https://syosetu.org/
// @version      1.1.0
// @description  協助 Hameln Seeker 跨越同源政策 (SOP) 與 file:// 限制，將 iframe 或彈出視窗中的小說目錄與章節 HTML 安全地回傳給父視窗。
// @author       Mr.Claude
// @match        https://syosetu.org/novel/*
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 只有在 iframe 當中或是新開彈出視窗時才執行對接
    const isIframe = window.top !== window.self;
    const isPopup = !!window.opener;

    if (!isIframe && !isPopup) return;

    console.log(`[Hameln Seeker Bridge] 檢測到運行於 ${isIframe ? 'iframe' : 'popup 視窗'}，準備回傳內容...`);

    // 取得當前網頁的完整 HTML 與網址
    const messageData = {
        type: 'hameln_seeker_html',
        url: window.location.href,
        html: document.documentElement.outerHTML
    };

    // 透過 postMessage 安全地傳遞給父視窗 (Seeker)
    const targetWindow = isPopup ? window.opener : window.parent;
    targetWindow.postMessage(messageData, '*');

    console.log('[Hameln Seeker Bridge] 內容已成功傳送！');

    // 若為彈出視窗，在傳送完畢後，重新導向至 about:blank 釋放記憶體並避免重覆執行
    if (isPopup) {
        // 主動嘗試將 focus 回傳給主視窗
        try {
            window.opener.focus();
        } catch (err) {}

        setTimeout(() => {
            try {
                window.opener.focus();
            } catch (err) {}
            window.location.replace('about:blank');
        }, 100);
    }
})();
