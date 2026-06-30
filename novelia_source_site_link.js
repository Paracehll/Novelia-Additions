// ==UserScript==
// @name         輕小說機翻站 源站跳轉
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在 syosetu.org 上新增跳轉按鈕
// @author       Parachell
// @match        *://syosetu.org/*
// @match        *://syosetu.com/*
// @match        *://yomou.syosetu.com/*
// @match        *://books.fishhawk.top/*
// @match        *://n.novelia.cc/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const currentHost = location.hostname;

    // 找出所有符合條件的 a 元素
    const links = document.querySelectorAll('a');

    links.forEach(link => {
        const href = link.href;
        const text = link.textContent.trim();
        let type;
        let novelId = '';

        //console.log(href); //
        //console.log(text); //

        if (href.startsWith('https://syosetu.org/novel/')) {
            const match = href.match(/https:\/\/syosetu\.org\/novel\/(\d+)/);
            if (!match) return;

            type = "hameln";
            novelId = match[1];

        } else if (href.startsWith('https://ncode.syosetu.com/')) {
            const match = href.match(/https:\/\/ncode\.syosetu\.com\/([^/]+)/);
            if (!match) return;

            type = "syosetu";
            novelId = match[1];

        } else if (text.startsWith('https://ncode.syosetu.com/')) {
            const match = text.match(/https:\/\/ncode\.syosetu\.com\/([^/]+)/);
            if (!match) return;

            type = "syosetu";
            novelId = match[1];

        } else if (text.startsWith('https://kakuyomu.jp/works/')) {
            const match = text.match(/https:\/\/kakuyomu\.jp\/works\/(\d+)/);
            if (!match) return;

            type = "kakuyomu";
            novelId = match[1];

        } else if (text.startsWith('https://www.pixiv.net/novel/series/')) {
            const match = text.match(/https:\/\/www\.pixiv\.net\/novel\/series\/(\d+)/);
            if (!match) return;

            type = "pixiv";
            novelId = match[1];

        } else {
            return; // 不支援的格式
        }

        // 創建按鈕
        const button = document.createElement('button');
        button.textContent = '↗';
        button.style.marginLeft = '6px';
        button.style.border = 'none';
        button.style.background = 'none';
        button.style.cursor = 'pointer';
        button.style.fontSize = '14px';
        button.style.color = '#007BFF';

        // 點擊按鈕時儲存網址並跳轉
        button.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            window.open(`https://n.novelia.cc/novel/${type}/${novelId}`, '_blank');
        });

        // 插入按鈕
        if (currentHost.includes("syosetu.com")) {
            // 將按鈕加進 <a> 內部
            link.appendChild(button);
        } else {
            // 正常情況，將按鈕放在 <a> 後面
            link.insertAdjacentElement('afterend', button);
        }
    });

})();