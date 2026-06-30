// ==UserScript==
// @name         Novelia Forum Search
// @namespace    https://n.novelia.cc/
// @version      1.1.1
// @description  为 n.novelia.cc 论坛新增搜索框（仅支持"小说交流"版块）。支持标题关键词、a:"作者"、f:"YYYYMMDD"/t:"YYYYMMDD" 更新时间范围过滤；可折叠面板；自动建立快取并定时增量扫描；作者自动补全；自动补全引号。
// @match        https://n.novelia.cc/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 实现说明
    // ------------------------------------------------------------
    // 论坛列表页是 SPA（Vue + Naive UI），没有公开稳定的"列表查询 API"
    // 可以直接调用。为了不依赖随时可能变动的内部接口，本脚本用一个
    // 隐藏 <iframe> 依次加载 /forum?page=1、/forum?page=2 ...（和手动
    // 翻页效果一样），直接读取渲染后的 DOM 抓数据，再用 localStorage
    // 缓存结果。只要列表页 DOM 结构不变，脚本就不会因为后端
    // API 变化而失效。
    //
    // 快取策略：
    //   - 首次注入且本地无快取时，立即在背景做一次「完整扫描」（不等
    //     待用户点击搜索）。
    //   - 之后每隔 N 分钟（可设定，预设 30）自动扫描前 M 页（可设定，
    //     预设 3），将结果合并进快取（依帖子 id 更新/新增，不影响其
    //     余页面已缓存的帖子）。
    //   - 搜索时直接使用本地快取（无论新旧），不会因为快取「过期」而
    //     强制重新整理；如需强制完整重新扫描，可点击「完整重新扫描」。
    //
    // ⚠️ 唯一的假设：翻页地址形如 /forum?page=2。如果实测发现网站翻
    // 页时地址栏并非此格式，把下面 FS_PAGE_URL 改成正确格式即可，其
    // 余逻辑无需改动。
    // ============================================================

    const FS_CACHE_KEY = 'novelia_forum_search_cache_v1';
    const FS_AUTHORS_KEY = 'novelia_forum_search_authors_v1';
    const FS_SETTINGS_KEY = 'novelia_forum_search_settings_v1';
    const FS_COLLAPSED_KEY = 'novelia_forum_search_collapsed_v1';
    const FS_TARGET_BOARD_LABEL = '小说交流';
    const FS_PAGE_URL = (p) => `/forum?page=${p}`;
    const FS_RELATIVE_UNIT_MS = { '分钟前': 6e4, '小时前': 36e5, '天前': 864e5, '个月前': 2592e6, '年前': 31536e6 };
    const FS_DEFAULT_SETTINGS = {
        refreshIntervalMin: 30,
        refreshPages: 3,
        authorFromStart: false,
        authorCaseInsensitive: true,
        authorFuzzy: false,
    };
    // ------------------------------------------------------------
    // 基础工具函数
    // ------------------------------------------------------------
    function fsGetPostId(url) {
        const m = (url || '').match(/\/forum\/([a-f0-9]{24})/i);
        return m ? m[1] : null;
    }

    function fsGetRelTimeFromNow(ts) {
        if (!ts) return '未知';
        const mins = Math.floor((Date.now() - ts) / 60000);
        const hrs = Math.floor(mins / 60), days = Math.floor(hrs / 24);
        if (mins < 1) return '刚刚';
        if (hrs < 1) return `${mins} 分钟前`;
        if (days < 1) return `${hrs} 小时前`;
        if (days < 30) return `${days} 天前`;
        if (days < 365) return `${Math.floor(days / 30)} 个月前`;
        return `${Math.floor(days / 365)} 年前`;
    }

    function fsParseRelTime(text, baseTs) {
        text = (text || '').trim();
        if (text === '刚刚') return baseTs;
        const m = text.match(/^(\d+)\s*(分钟前|小时前|天前|个月前|年前)$/);
        if (!m) return null;
        return baseTs - parseInt(m[1], 10) * (FS_RELATIVE_UNIT_MS[m[2]] || 0);
    }

    // 尋找游標是否位於 f:"..." 或 t:"..." 之內
    function fsFindActiveDateToken(value, cursorPos, type) {
        const re = new RegExp(`${type}:"([^"]*)"`, 'gi');
        let m;
        while ((m = re.exec(value))) {
            const g1 = m.index + 3; // "f:\"" 或 "t:\"" 之後
            const g2 = g1 + m[1].length; // 閉合引號的位置
            if (cursorPos >= g1 && cursorPos <= g2) {
                return { start: g1, end: g2, partial: value.slice(g1, cursorPos), type: type };
            }
        }
        return null;
    }

    // 取得過去 7 天的 YYYYMMDD 日期陣列 (reverse = true 代表由新到舊)
    function fsGetPast7Days(reverse = false) {
        const dates = [];
        const tzoffset = (new Date()).getTimezoneOffset() * 60000;
        for (let i = 0; i <= 7; i++) {
            const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
            const localISOTime = (new Date(d - tzoffset)).toISOString();
            const yyyymmdd = localISOTime.slice(0, 10).replace(/-/g, '');
            dates.push(yyyymmdd);
        }
        return reverse ? dates : dates.reverse();
    }

    function fsLoadCache() {
        try { return JSON.parse(localStorage.getItem(FS_CACHE_KEY) || 'null');
        } catch { return null; }
    }
    function fsSaveCache(data) {
        try { localStorage.setItem(FS_CACHE_KEY, JSON.stringify(data));
        }
        catch (e) { console.warn('[Novelia Forum Search] 缓存写入失败（可能超出 localStorage 容量）', e);
        }
    }

    // 尋找游標是否位於 a:"..." 之內
    function fsFindActiveAuthorToken(value, cursorPos) {
        const re = /a:"([^"]*)"/gi;
        let m;
        while ((m = re.exec(value))) {
            const g1 = m.index + 3; // "a:\"" 之后
            const g2 = g1 + m[1].length; // 闭合引号的位置
            if (cursorPos >= g1 && cursorPos <= g2) {
                return { start: g1, end: g2, partial: value.slice(g1, cursorPos) };
            }
        }
        return null;
    }

    // 載入作者緩存
    function fsLoadAuthors() {
        try { return JSON.parse(localStorage.getItem(FS_AUTHORS_KEY) || '[]');
        } catch { return []; }
    }
    function fsSaveAuthors(arr) {
        try { localStorage.setItem(FS_AUTHORS_KEY, JSON.stringify(arr));
        } catch (e) { /* ignore */ }
    }
    function fsUpdateAuthorsCache(posts) {
        const existing = new Set(fsLoadAuthors());
        let changed = false;
        (posts || []).forEach(p => {
            if (p.author && !existing.has(p.author)) { existing.add(p.author); changed = true; }
        });
        if (changed) fsSaveAuthors(Array.from(existing).sort());
    }

    function fsLoadSettings() {
        try { return Object.assign({}, FS_DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(FS_SETTINGS_KEY) || '{}'));
        }
        catch { return Object.assign({}, FS_DEFAULT_SETTINGS);
        }
    }
    function fsSaveSettings(s) {
        try { localStorage.setItem(FS_SETTINGS_KEY, JSON.stringify(s));
        } catch (e) { /* ignore */ }
    }

    // 載入折疊狀態
    function fsLoadCollapsed() {
        try { return localStorage.getItem(FS_COLLAPSED_KEY) === '1';
        } catch { return false; }
    }
    function fsSaveCollapsed(v) {
        try { localStorage.setItem(FS_COLLAPSED_KEY, v ? '1' : '0');
        } catch (e) { /* ignore */ }
    }

    function fsShowToast(msg) {
        const t = document.createElement('div');
        t.className = 'fs-toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2500);
    }

    // ------------------------------------------------------------
    // 字串相似度（供作者自动补全使用）
    // ------------------------------------------------------------
    function fsLevenshtein(a, b) {
        const al = a.length, bl = b.length;
        if (al === 0) return bl;
        if (bl === 0) return al;
        const dp = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
        for (let i = 0; i <= al; i++) dp[i][0] = i;
        for (let j = 0; j <= bl; j++) dp[0][j] = j;
        for (let i = 1; i <= al; i++) {
            for (let j = 1; j <= bl; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
            }
        }
        return dp[al][bl];
    }
    function fsSimilarity(a, b) {
        if (!a.length && !b.length) return 1;
        const dist = fsLevenshtein(a, b);
        return 1 - dist / Math.max(a.length, b.length);
    }

    function fsMatchAuthors(partial, settings) {
        const authors = fsLoadAuthors();
        if (!authors.length) return [];
        const ci = settings.authorCaseInsensitive;
        const norm = s => ci ? s.toLowerCase() : s;
        const p = norm(partial || '');
        if (!p) return authors.slice(0, 8);
        if (settings.authorFuzzy) {
            return authors
                .map(a => ({ a, score: Math.max(fsSimilarity(norm(a), p), norm(a).includes(p) ? 0.5 : 0) }))
                .filter(x => x.score > 0.3)
                .sort((x, y) => y.score - x.score)
                .slice(0, 8)
                .map(x => x.a);
        }
        const filtered = authors.filter(a => settings.authorFromStart ? norm(a).startsWith(p) : norm(a).includes(p));
        return filtered.slice(0, 8);
    }

    // ------------------------------------------------------------
    // 样式
    // ------------------------------------------------------------
    // 将 overflow: hidden 移出 #fs-search-wrap，并改到折叠状态才裁剪，确保下拉面板能超出显示
    GM_addStyle(`
        :root {
            --fs-primary: #63e2b7;
            --fs-primary-bg: rgba(99,226,183,0.12);
            --fs-danger: #e88080;
        }
        #fs-search-wrap { margin: 4px 0 20px 0; border-radius: 8px; font-family: "PingFang SC", sans-serif; font-size: 14px; transition: background-color 0.2s, color 0.2s, border-color 0.2s; }
        #fs-search-wrap.fs-dark { background: #18181c; color: rgba(255,255,255,0.9); border: 1px solid #333; }
        #fs-search-wrap.fs-light { background: #fff; color: #333; border: 1px solid #eee; }

        #fs-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; cursor: pointer; user-select: none; }
        #fs-header .fs-title { font-weight: 600; display: flex; align-items: center; gap: 8px; }
        #fs-header .fs-header-status { font-size: 11.5px; opacity: 0.6; font-weight: 400; }
        #fs-header .fs-header-actions { display: flex; align-items: center; gap: 4px; }
        .fs-icon-btn { width: 24px; height: 24px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer; font-size: 14px; opacity: 0.7; transition: 0.15s; }
        .fs-icon-btn:hover { opacity: 1; background: var(--fs-primary-bg); color: var(--fs-primary); }
        #fs-settings-btn { color: #fff; opacity: 0.95; background: rgba(0,0,0,0.45); }
        #fs-settings-btn:hover { color: #fff; opacity: 1; background: rgba(0,0,0,0.6); }
        .fs-collapse-icon { display: inline-flex; align-items: center; justify-content: center; transition: transform 0.2s; }
        .fs-collapse-icon svg { display: block; }
        #fs-search-wrap.fs-collapsed { overflow: hidden; } /* 只有折叠时才截断内容 */
        #fs-search-wrap.fs-collapsed .fs-collapse-icon { transform: rotate(-90deg); }
        #fs-search-wrap.fs-collapsed #fs-body { display: none; }

        #fs-body { padding: 0 14px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
        #fs-search-wrap .fs-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        #fs-search-wrap .fs-hint { font-size: 11px; opacity: 0.55; }
        #fs-search-wrap .fs-input { padding: 0 10px; height: 28px; border-radius: 3px; font-size: 13px; outline: none; transition: border-color 0.2s; }
        #fs-search-wrap.fs-dark .fs-input { background: #26262a; border: 1px solid #444; color: #fff; }
        #fs-search-wrap.fs-light .fs-input { background: #fff; border: 1px solid #ccc; color: #333; }
        #fs-search-wrap #fs-query:not(:placeholder-shown) { border-color: var(--fs-primary); }
        #fs-search-wrap .fs-btn { display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; height: 28px; border-radius: 3px; cursor: pointer; font-size: 13px; background: transparent; transition: 0.2s; white-space: nowrap; }
        #fs-search-wrap .fs-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        #fs-search-wrap.fs-dark .fs-btn { border: 1px solid rgba(255,255,255,0.24); color: rgba(255,255,255,0.82); }
        #fs-search-wrap.fs-dark .fs-btn:hover { border-color: var(--fs-primary); color: var(--fs-primary); }
        #fs-search-wrap.fs-light .fs-btn { border: 1px solid rgba(0,0,0,0.2); color: #444; }
        #fs-search-wrap.fs-light .fs-btn:hover { border-color: #38b28a; color: #38b28a; }
        #fs-search-wrap .fs-btn-primary { background: var(--fs-primary-bg); border-color: var(--fs-primary) !important; color: var(--fs-primary) !important; }
        #fs-search-wrap .fs-range-input { width: 64px; text-align: center; }
        #fs-search-wrap .fs-range-sep { opacity: 0.5; }
        #fs-status { font-size: 12px; opacity: 0.75; min-height: 16px; }

        .fs-query-wrap { position: relative; flex: 1; min-width: 260px; }
        .fs-query-wrap #fs-query { width: 100%; box-sizing: border-box; padding-right: 30px; }
        .fs-query-icon { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; opacity: 0.5; display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; }
        .fs-suggest-box { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20; border-radius: 4px; overflow: hidden; max-height: 220px; overflow-y: auto; box-shadow: 0 4px 14px rgba(0,0,0,0.25); }
        #fs-search-wrap.fs-dark .fs-suggest-box { background: #26262a; border: 1px solid #444; }
        #fs-search-wrap.fs-light .fs-suggest-box { background: #fff; border: 1px solid #ccc; }
        .fs-suggest-item { padding: 6px 10px; font-size: 13px; cursor: pointer; }
        #fs-search-wrap.fs-dark .fs-suggest-item:hover, #fs-search-wrap.fs-dark .fs-suggest-item.fs-suggest-active { background: rgba(99,226,183,0.15); }
        #fs-search-wrap.fs-light .fs-suggest-item:hover, #fs-search-wrap.fs-light .fs-suggest-item.fs-suggest-active { background: rgba(56,178,138,0.12); }

        #fs-settings-panel { margin: 0 14px 12px 14px; padding: 10px 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 10px; font-size: 12.5px; }
        #fs-search-wrap.fs-dark #fs-settings-panel { background: #202024; border: 1px solid #333; }
        #fs-search-wrap.fs-light #fs-settings-panel { background: #f7f7f7; border: 1px solid #e5e5e5; }
        #fs-settings-panel .fs-settings-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        #fs-settings-panel .fs-settings-group { font-weight: 600; opacity: 0.7; margin-top: 2px; }
        #fs-settings-panel label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
        #fs-settings-panel input[type="number"] { width: 64px; }
        #fs-settings-panel input[type="checkbox"] { cursor: pointer; }

        #fs-results table.fs-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        #fs-results table.fs-table th, #fs-results table.fs-table td { padding: 8px 6px; text-align: left; vertical-align: top; }
        #fs-search-wrap.fs-dark #fs-results table.fs-table th, #fs-search-wrap.fs-dark #fs-results table.fs-table td { border-bottom: 1px solid #333; }
        #fs-search-wrap.fs-light #fs-results table.fs-table th, #fs-search-wrap.fs-light #fs-results table.fs-table td { border-bottom: 1px solid #eee; }
        #fs-results .fs-col-title { width: 65%; }
        #fs-results .fs-col-time, #fs-results .fs-col-stats { width: 17.5%; white-space: nowrap; }
        #fs-results .fs-title-wrap { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal; line-height: 1.5; font-weight: 500; }
        #fs-results a { color: var(--fs-primary); text-decoration: none; }
        #fs-results a:hover { text-decoration: underline; }
        .fs-toast { position: fixed; bottom: 24px; right: 24px; padding: 10px 18px; border-radius: 4px; font-size: 13px; z-index: 99999; pointer-events: none; background: rgba(99,226,183,0.2); color: #63e2b7; border: 1px solid rgba(99,226,183,0.3); animation: fs-toast-in 0.2s ease; }
        @keyframes fs-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    `);
    // ------------------------------------------------------------
    // 抓取与解析
    // ------------------------------------------------------------
    function fsParseListDoc(doc, fetchedTs) {
        const rows = doc.querySelectorAll('table.n-table tbody tr');
        const list = [];
        rows.forEach(row => {
            const linkEl = row.querySelector('a.n-a');
            if (!linkEl) return;
            const href = linkEl.getAttribute('href') || '';
            const id = fsGetPostId(href);
            if (!id) return;
            const title = (linkEl.textContent || '').trim();

            let author = '', relText = '', ts = null;
            const infoSpan = row.querySelector('span.n-text');
            if (infoSpan) {
                const infoText = infoSpan.textContent || '';
                const byMatch = infoText.match(/by\s*(.+?)\s*$/);
                if (byMatch) author = byMatch[1].trim();
                const timeEl = infoSpan.querySelector('time');
                if (timeEl) {
                    relText = timeEl.textContent.trim();
                    ts = fsParseRelTime(relText, fetchedTs);
                }
            }

            const statText = row.querySelector('.article-number')?.textContent || '0/0';
            const parts = statText.split('/');
            const views = parseInt(parts[0], 10) || 0;
            const replies = parseInt(parts[1], 10) || 0;
            list.push({ id, title, url: href, author, relText, ts, views, replies });
        });
        return list;
    }

    function fsParseMaxPage(doc) {
        let max = 1;
        doc.querySelectorAll('.n-pagination-item').forEach(it => {
            const t = it.textContent.trim();
            if (/^\d+$/.test(t)) max = Math.max(max, parseInt(t, 10));
        });
        return max;
    }

    function fsMakePageLoader() {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(iframe);

        const waitForRender = (doc) => new Promise((res) => {
            const start = Date.now();
            const tick = () => {
                if (!doc) { res(); return; }
                const rows = doc.querySelectorAll('table.n-table tbody tr');
                const pag = doc.querySelectorAll('.n-pagination-item');
                if (rows.length > 0 || pag.length > 0 || Date.now() - start > 8000) res();
                else setTimeout(tick, 200);
            };
            tick();
        });
        const loadPage = (p) => new Promise((res) => {
            const onLoad = () => {
                iframe.removeEventListener('load', onLoad);
                setTimeout(async () => {
                    try {
                        const doc = iframe.contentDocument;
                        await waitForRender(doc);
                        res(doc);
                    } catch (e) { res(null); }
                }, 250);
            };
            iframe.addEventListener('load', onLoad);
            iframe.src = FS_PAGE_URL(p);
        });
        return { loadPage, cleanup: () => iframe.remove() };
    }

    function fsCrawlAllPages(onProgress, maxPagesLimit) {
        return new Promise((resolve) => {
            const { loadPage, cleanup } = fsMakePageLoader();
            const allPosts = [];
            let totalPages = null;

            (async () => {
                let p = 1;
                while (true) {
                    const doc = await loadPage(p);
                    if (!doc) break;
                    if (totalPages === null) {
                        totalPages = fsParseMaxPage(doc);
                        if (maxPagesLimit) totalPages = Math.min(totalPages, maxPagesLimit);
                    }
                    const ts = Date.now();
                    const posts = fsParseListDoc(doc, ts);
                    if (posts.length === 0 && p > 1) break;
                    allPosts.push(...posts);
                    if (onProgress) onProgress(p, totalPages || p);
                    if (p >= (totalPages || p)) break;
                    p++;
                    await new Promise(r => setTimeout(r, 150));
                }
                cleanup();
                resolve(allPosts);
            })();
        });
    }

    function fsCrawlPageRange(onProgress, startPage, endPage) {
        return new Promise((resolve) => {
            const { loadPage, cleanup } = fsMakePageLoader();
            const allPosts = [];
            const total = Math.max(1, endPage - startPage + 1);

            (async () => {
                for (let p = startPage; p <= endPage; p++) {
                    const doc = await loadPage(p);
                    if (!doc) break;
                    const ts = Date.now();
                    const posts = fsParseListDoc(doc, ts);
                    if (onProgress) onProgress(p - startPage + 1, total);
                    if (posts.length === 0) break;
                    allPosts.push(...posts);
                    if (p < endPage) await new Promise(r => setTimeout(r, 150));
                }
                cleanup();
                resolve(allPosts);
            })();
        });
    }

    let fsCacheBuildPromise = null;
    function fsEnsureCache(force, onProgress) {
        if (!force) {
            const c = fsLoadCache();
            if (c && Array.isArray(c.posts) && c.posts.length) return Promise.resolve(c);
        }
        if (fsCacheBuildPromise) return fsCacheBuildPromise;
        fsCacheBuildPromise = (async () => {
            const posts = await fsCrawlAllPages(onProgress, null);
            const cache = { fetchedAt: Date.now(), posts };
            fsSaveCache(cache);
            fsUpdateAuthorsCache(posts);
            fsShowToast(`抓取完成，共 ${posts.length} 篇帖子`);
            fsUpdateHeaderStatus();
            fsCacheBuildPromise = null;
            return cache;
        })();
        return fsCacheBuildPromise;
    }

    function fsMergeCache(scannedPosts) {
        let cache = fsLoadCache();
        if (!cache || !Array.isArray(cache.posts)) cache = { fetchedAt: Date.now(), posts: [] };
        const map = new Map(cache.posts.map(p => [p.id, p]));
        scannedPosts.forEach(p => map.set(p.id, p));
        cache.posts = Array.from(map.values());
        cache.fetchedAt = Date.now();
        fsSaveCache(cache);
        fsUpdateAuthorsCache(scannedPosts);
        fsUpdateHeaderStatus();
        return cache;
    }

    async function fsIncrementalRefresh() {
        if (fsCacheBuildPromise) return;
        const settings = fsLoadSettings();
        try {
            const posts = await fsCrawlAllPages(null, settings.refreshPages);
            if (posts.length) fsMergeCache(posts);
        } catch (e) {
            console.error('[Novelia Forum Search] 自动扫描失败', e);
        }
    }

    let fsAutoRefreshTimer = null;
    function fsSetupAutoRefresh() {
        if (fsAutoRefreshTimer) clearInterval(fsAutoRefreshTimer);
        const settings = fsLoadSettings();
        const ms = Math.max(1, settings.refreshIntervalMin || 1) * 60000;
        fsAutoRefreshTimer = setInterval(fsIncrementalRefresh, ms);
    }

    function fsUpdateHeaderStatus() {
        const el = document.getElementById('fs-header-status');
        if (!el) return;
        const cache = fsLoadCache();
        const authors = fsLoadAuthors();
        if (!cache || !cache.posts || !cache.posts.length) {
            el.textContent = '尚未建立快取';
            return;
        }
        el.textContent = `共 ${cache.posts.length} 篇 · 更新于 ${fsGetRelTimeFromNow(cache.fetchedAt)} · 作者 ${authors.length} 位`;
    }

    function fsParseQuery(raw) {
        let text = raw;
        let author = null, from = null, to = null;
        const aM = text.match(/a:"([^"]*)"/i);
        if (aM) { author = aM[1]; text = text.replace(aM[0], ''); }

        const fM = text.match(/f:"(\d{8})"/i);
        if (fM) { from = fsDateFromYYYYMMDD(fM[1], false); text = text.replace(fM[0], ''); }

        const tM = text.match(/t:"(\d{8})"/i);
        if (tM) { to = fsDateFromYYYYMMDD(tM[1], true); text = text.replace(tM[0], ''); }

        return { keyword: text.trim(), author, from, to };
    }
    function fsDateFromYYYYMMDD(s, endOfDay) {
        const y = +s.slice(0, 4), m = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
        const dt = endOfDay ? new Date(y, m, d, 23, 59, 59, 999) : new Date(y, m, d, 0, 0, 0, 0);
        return dt.getTime();
    }

    function fsFilterPosts(posts, rawQuery) {
        const { keyword, author, from, to } = fsParseQuery(rawQuery);
        const kw = keyword.toLowerCase();
        return posts.filter(p => {
            if (kw && !p.title.toLowerCase().includes(kw)) return false;
            if (author && p.author !== author) return false;
            if (from !== null && (p.ts === null || p.ts < from)) return false;
            if (to !== null && (p.ts === null || p.ts > to)) return false;
            return true;
        });
    }

    async function fsRunSearch(rawQuery, statusEl, resultsEl, btnEl, forceRescan) {
        if (btnEl) { btnEl.disabled = true;
        btnEl.textContent = forceRescan ? '扫描中...' : '搜索中...'; }
        try {
            const hasCache = !!fsLoadCache();
            statusEl.textContent = forceRescan
                ? '正在完整重新扫描...'
                : (hasCache ? '搜索中...' : '本地快取尚未建立，正在建立（首次扫描可能需要较长时间）...');
            const cache = await fsEnsureCache(forceRescan, (p, total) => {
                statusEl.textContent = `正在扫描「${FS_TARGET_BOARD_LABEL}」第 ${p}/${total} 页...`;
            });
            const filtered = fsFilterPosts(cache.posts, rawQuery);

            statusEl.textContent = `匹配到 ${filtered.length} 条结果`;
            fsRenderResults(filtered, resultsEl);
            fsUpdateHeaderStatus();
        } finally {
            if (btnEl) { btnEl.disabled = false;
            btnEl.textContent = forceRescan ? '完整重新扫描' : '搜索'; }
        }
    }

    async function fsRunRangeScan(rawQuery, statusEl, resultsEl, btnEl, startPage, endPage) {
        if (btnEl) { btnEl.disabled = true;
        btnEl.textContent = '扫描中...'; }
        try {
            statusEl.textContent = `正在扫描第 ${startPage}-${endPage} 页...`;
            const posts = await fsCrawlPageRange((p, total) => {
                statusEl.textContent = `正在扫描第 ${startPage}-${endPage} 页（${p}/${total}）...`;
            }, startPage, endPage);
            const cache = fsMergeCache(posts);
            fsShowToast(`扫描完成，本次更新 ${posts.length} 篇帖子`);

            const filtered = fsFilterPosts(cache.posts, rawQuery);
            statusEl.textContent = `匹配到 ${filtered.length} 条结果`;
            fsRenderResults(filtered, resultsEl);
            fsUpdateHeaderStatus();
        }
        catch (e) {
            statusEl.textContent = '扫描失败，请重试';
            console.error('[Novelia Forum Search] 自订范围扫描失败', e);
        } finally {
            if (btnEl) { btnEl.disabled = false;
            btnEl.textContent = '扫描'; }
        }
    }

    function fsRenderResults(list, container) {
        if (!list.length) {
            container.innerHTML = '<div style="padding:30px;text-align:center;opacity:0.6;">没有找到匹配的帖子</div>';
            return;
        }
        list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        container.innerHTML = `<table class="fs-table"><thead><tr><th class="fs-col-title">标题</th><th class="fs-col-time">更新</th><th class="fs-col-stats">查看/回复</th></tr></thead><tbody>${
            list.map(p => `<tr>
                <td class="fs-col-title"><div class="fs-title-wrap"><a href="${p.url}" target="_blank">${p.title}</a></div><div style="font-size:11px;opacity:0.6;margin-top:2px;">by ${p.author || '未知'}</div></td>
                <td class="fs-col-time">${p.relText || '未知'}</td>
                <td class="fs-col-stats">${p.views}/${p.replies}</td>
            </tr>`).join('')
        }</tbody></table>`;
    }

    function fsDetectTheme() {
        const rgb = window.getComputedStyle(document.body).backgroundColor;
        const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return (match && ((parseInt(match[1]) * 299 + parseInt(match[2]) * 587 + parseInt(match[3]) * 114) / 1000) < 128) ? 'dark' : 'light';
    }

    function fsIsCursorOutsideQuotes(value, cursorPos) {
        const before = value.slice(0, cursorPos);
        const quoteCount = (before.match(/"/g) || []).length;
        return quoteCount % 2 === 0;
    }

    const FS_TOKEN_DEFS = [
        { key: 'a', label: 'a:""' },
        { key: 'f', label: 'f:""' },
        { key: 't', label: 't:""' },
    ];
    function fsMissingTokens(value) {
        return FS_TOKEN_DEFS.filter(d => !new RegExp(`(^|[^A-Za-z0-9_])${d.key}:"`, 'i').test(value));
    }

    function fsSetupQueryInputBehaviors(queryInput, suggestEl) {
        let currentSuggestions = [];
        let suggestIndex = -1;

        function hideSuggestions() {
            suggestEl.style.display = 'none';
            suggestEl.innerHTML = '';
            currentSuggestions = [];
            suggestIndex = -1;
        }

        function highlight() {
            suggestEl.querySelectorAll('.fs-suggest-item').forEach((el, i) => {
                const isActive = i === suggestIndex;
                el.classList.toggle('fs-suggest-active', isActive);
                if (isActive) {
                    el.scrollIntoView({ block: 'nearest' });
                }
            });
        }

        function applySuggestion(s) {
            if (s.type === 'token') {
                const pos = queryInput.selectionStart;
                const value = queryInput.value;
                const before = value.slice(0, pos);
                const after = value.slice(pos);
                const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
                const insertText = (needsSpaceBefore ? ' ' : '') + s.prefixChar + ':""';
                queryInput.value = before + insertText + after;
                const cursorPos = before.length + insertText.length - 1;
                queryInput.setSelectionRange(cursorPos, cursorPos);
                hideSuggestions();
                queryInput.focus();
                updateSuggestions();
                return;
            }
            if (s.type === 'date') {
                const v = queryInput.value;
                const newVal = v.slice(0, s.token.start) + s.value + v.slice(s.token.end);
                queryInput.value = newVal;
                const newPos = s.token.start + s.value.length + 1;
                queryInput.setSelectionRange(newPos, newPos);
                hideSuggestions();
                queryInput.focus();
                return;
            }
            const { token } = s;
            const v = queryInput.value;
            const newVal = v.slice(0, token.start) + s.author + v.slice(token.end);
            queryInput.value = newVal;
            const newPos = token.start + s.author.length + 1;
            queryInput.setSelectionRange(newPos, newPos);
            hideSuggestions();
            queryInput.focus();
        }

        function renderSuggestions() {
            suggestEl.innerHTML = currentSuggestions.map((s, i) => {
                let labelText = '';
                if (s.type === 'token') labelText = s.label;
                else if (s.type === 'date') labelText = s.label;
                else labelText = s.author;
                return `<div class="fs-suggest-item" data-i="${i}">${labelText}</div>`;
            }).join('');
            suggestEl.style.display = 'block';
            suggestEl.querySelectorAll('.fs-suggest-item').forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const i = +el.dataset.i;
                    applySuggestion(currentSuggestions[i]);
                });
            });
        }

        function updateSuggestions() {
            const pos = queryInput.selectionStart;
            const value = queryInput.value;

            // 1) 游标位于 a:"..." 之内 → 提示作者
            const authorToken = fsFindActiveAuthorToken(value, pos);
            if (authorToken) {
                const settings = fsLoadSettings();
                const matches = fsMatchAuthors(authorToken.partial, settings);
                if (!matches.length) { hideSuggestions(); return; }
                currentSuggestions = matches.map(a => ({ type: 'author', author: a, token: authorToken }));
                suggestIndex = -1;
                renderSuggestions();
                return;
            }

            // 2) 游标位于 f:"..." 之内 → 提示 7 天前到今天（正序）
            const fromToken = fsFindActiveDateToken(value, pos, 'f');
            if (fromToken) {
                const dates = fsGetPast7Days(false).filter(d => d.includes(fromToken.partial));
                if (!dates.length) { hideSuggestions(); return; }
                currentSuggestions = dates.map(d => ({ type: 'date', value: d, label: d, token: fromToken }));
                suggestIndex = -1;
                renderSuggestions();
                return;
            }

            // 3) 游标位于 t:"..." 之内 → 提示今天到 7 天前（倒序）
            const toToken = fsFindActiveDateToken(value, pos, 't');
            if (toToken) {
                const dates = fsGetPast7Days(true).filter(d => d.includes(toToken.partial));
                if (!dates.length) { hideSuggestions(); return; }
                currentSuggestions = dates.map(d => ({ type: 'date', value: d, label: d, token: toToken }));
                suggestIndex = -1;
                renderSuggestions();
                return;
            }

            // 4) 游标不在任何引号内 → 提示尚未使用的 a:""/f:""/t:"" 语法
            if (fsIsCursorOutsideQuotes(value, pos)) {
                const missing = fsMissingTokens(value);
                if (missing.length) {
                    currentSuggestions = missing.map(d => ({ type: 'token', prefixChar: d.key, label: d.label }));
                    suggestIndex = -1;
                    renderSuggestions();
                    return;
                }
            }

            hideSuggestions();
        }

        queryInput.addEventListener('keydown', (e) => {
            if (e.key === '"') {
                const pos = queryInput.selectionStart;
                const before = queryInput.value.slice(0, pos);
                if (/(^|[^A-Za-z0-9_])[aft]:$/i.test(before)) {
                    e.preventDefault();
                    const after = queryInput.value.slice(pos);
                    queryInput.value = before + '""' + after;
                    const newPos = pos + 1;
                    queryInput.setSelectionRange(newPos, newPos);
                    updateSuggestions();
                    return;
                }
            }
            if (suggestEl.style.display !== 'none' && currentSuggestions.length) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    suggestIndex = (suggestIndex + 1) % currentSuggestions.length;
                    highlight();
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    suggestIndex = (suggestIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
                    highlight();
                    return;
                }
                if (e.key === 'Enter' && suggestIndex >= 0) {
                    e.preventDefault();
                    applySuggestion(currentSuggestions[suggestIndex]);
                    return;
                }
                if (e.key === 'Escape') {
                    hideSuggestions();
                    return;
                }
            }
        });
        queryInput.addEventListener('input', updateSuggestions);
        queryInput.addEventListener('click', updateSuggestions);
        queryInput.addEventListener('focus', updateSuggestions);
        queryInput.addEventListener('blur', () => setTimeout(hideSuggestions, 150));
    }

    // 设定面板
    function fsBuildSettingsPanelHTML() {
        const s = fsLoadSettings();
        return `
            <div class="fs-settings-row">
                <span class="fs-settings-group">定时扫描</span>
                <label>间隔（分钟）<input type="number" min="1" id="fs-set-interval" class="fs-input" value="${s.refreshIntervalMin}" style="width:64px;"></label>
                <label>扫描页数<input type="number" min="1" id="fs-set-pages" class="fs-input" value="${s.refreshPages}" style="width:64px;"></label>
            </div>
            <div class="fs-settings-row">
                <span class="fs-settings-group">作者自动补全</span>
                <label><input type="checkbox" id="fs-set-fromstart" ${s.authorFromStart ? 'checked' : ''}>从头比对</label>
                <label><input type="checkbox" id="fs-set-ci" ${s.authorCaseInsensitive ? 'checked' : ''}>不分大小写</label>
                <label><input type="checkbox" id="fs-set-fuzzy" ${s.authorFuzzy ? 'checked' : ''}>字串相似度比对</label>
            </div>
            <div class="fs-settings-row">
                <span class="fs-settings-group">快取维护</span>
                <button id="fs-rescan-btn" class="fs-btn">完整重新扫描</button>
                <span class="fs-hint" style="margin:0;">重新扫描全部页面并完全覆盖本地快取</span>
            </div>
        `;
    }

    function fsBindSettingsPanel(panel) {
        const intervalInput = panel.querySelector('#fs-set-interval');
        const pagesInput = panel.querySelector('#fs-set-pages');
        const fromStartInput = panel.querySelector('#fs-set-fromstart');
        const ciInput = panel.querySelector('#fs-set-ci');
        const fuzzyInput = panel.querySelector('#fs-set-fuzzy');
        function persist(restartTimer) {
            const settings = {
                refreshIntervalMin: Math.max(1, parseInt(intervalInput.value, 10) || FS_DEFAULT_SETTINGS.refreshIntervalMin),
                refreshPages: Math.max(1, parseInt(pagesInput.value, 10) || FS_DEFAULT_SETTINGS.refreshPages),
                authorFromStart: fromStartInput.checked,
                authorCaseInsensitive: ciInput.checked,
                authorFuzzy: fuzzyInput.checked,
            };
            fsSaveSettings(settings);
            if (restartTimer) fsSetupAutoRefresh();
            fsShowToast('设定已保存');
        }

        intervalInput.addEventListener('change', () => persist(true));
        pagesInput.addEventListener('change', () => persist(false));
        fromStartInput.addEventListener('change', () => persist(false));
        ciInput.addEventListener('change', () => persist(false));
        fuzzyInput.addEventListener('change', () => persist(false));
    }

    function fsInjectSearchBar() {
        if (!/^\/forum\/?(\?|$)/.test(location.pathname)) { const old = document.getElementById('fs-search-wrap');
        if (old) old.remove(); return; }

        const boardLabel = Array.from(document.querySelectorAll('.n-text')).find(l => l.textContent.trim() === '版块');
        const filterRow = boardLabel ? boardLabel.closest('.n-flex') : null;
        if (!filterRow) return;

        const checkedRadio = filterRow.querySelector('.n-radio-button--checked .n-radio__label');
        const isTargetBoard = checkedRadio && checkedRadio.textContent.trim() === FS_TARGET_BOARD_LABEL;

        let wrap = document.getElementById('fs-search-wrap');
        if (!isTargetBoard) { if (wrap) wrap.style.display = 'none';
        return; }

        if (wrap) {
            wrap.style.display = 'block';
            wrap.className = 'fs-search-wrap ' + (fsDetectTheme() === 'dark' ? 'fs-dark' : 'fs-light') + (fsLoadCollapsed() ? ' fs-collapsed' : '');
            fsUpdateHeaderStatus();
            return;
        }

        wrap = document.createElement('div');
        wrap.id = 'fs-search-wrap';
        wrap.className = 'fs-search-wrap ' + (fsDetectTheme() === 'dark' ? 'fs-dark' : 'fs-light') + (fsLoadCollapsed() ? ' fs-collapsed' : '');
        wrap.innerHTML = `
            <div id="fs-header">
                <span class="fs-title">🔍 ${FS_TARGET_BOARD_LABEL} 搜索 <span id="fs-header-status" class="fs-header-status"></span></span>
                <span class="fs-header-actions">
                    <button id="fs-settings-btn" class="fs-icon-btn" title="设定">⚙</button>
                    <span class="fs-icon-btn fs-collapse-icon" title="折叠/展开"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
                </span>
            </div>
            <div id="fs-settings-panel" style="display:none;">${fsBuildSettingsPanelHTML()}</div>
            <div id="fs-body">
                <div class="fs-row">
                    <div class="fs-query-wrap">
                        <input id="fs-query" type="text" class="fs-input" placeholder='搜索标题... 例：恋爱 a:"frank3215" f:"20260101" t:"20260630"' autocomplete="off">
                        <span class="fs-query-icon"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14z" fill="currentColor"></path></svg></span>
                        <div id="fs-author-suggest" class="fs-suggest-box" style="display:none;"></div>
                    </div>
                    <button id="fs-search-btn" class="fs-btn fs-btn-primary">搜索</button>
                    <input id="fs-range-start" type="number" min="1" class="fs-input fs-range-input" placeholder="起始页">
                    <span class="fs-range-sep">-</span>
                    <input id="fs-range-end" type="number" min="1" class="fs-input fs-range-input" placeholder="结束页">
                    <button id="fs-scan-btn" class="fs-btn">扫描</button>
                </div>
                <div class="fs-hint">仅支持「${FS_TARGET_BOARD_LABEL}」版块；a:"作者名"，f:"YYYYMMDD" / t:"YYYYMMDD" 时间范围(from~to)；输入 a:" f:" t:" 后会自动补上闭合引号</div>
                <div id="fs-status"></div>
                <div id="fs-results"></div>
            </div>
        `;
        filterRow.insertAdjacentElement('afterend', wrap);

        const header = wrap.querySelector('#fs-header');
        const settingsBtn = wrap.querySelector('#fs-settings-btn');
        const settingsPanel = wrap.querySelector('#fs-settings-panel');
        const queryInput = wrap.querySelector('#fs-query');
        const suggestEl = wrap.querySelector('#fs-author-suggest');
        const statusEl = wrap.querySelector('#fs-status');
        const resultsEl = wrap.querySelector('#fs-results');
        const searchBtn = wrap.querySelector('#fs-search-btn');
        const scanBtn = wrap.querySelector('#fs-scan-btn');
        const rangeStartInput = wrap.querySelector('#fs-range-start');
        const rangeEndInput = wrap.querySelector('#fs-range-end');

        header.addEventListener('click', (e) => {
            if (e.target.closest('#fs-settings-btn')) return;
            wrap.classList.toggle('fs-collapsed');
            fsSaveCollapsed(wrap.classList.contains('fs-collapsed'));
        });

        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'flex' : 'none';
        });
        fsBindSettingsPanel(settingsPanel);
        const rescanBtn = settingsPanel.querySelector('#fs-rescan-btn');

        fsSetupQueryInputBehaviors(queryInput, suggestEl);
        const doSearch = (force) => {
            if (!queryInput.value.trim() && !force) { resultsEl.innerHTML = '';
            statusEl.textContent = ''; return; }
            fsRunSearch(queryInput.value, statusEl, resultsEl, force ? rescanBtn : searchBtn, !!force);
        };
        searchBtn.onclick = () => doSearch(false);
        rescanBtn.onclick = (e) => { e.stopPropagation(); doSearch(true); };
        scanBtn.onclick = () => {
            const settings = fsLoadSettings();
            let start = parseInt(rangeStartInput.value, 10);
            let end = parseInt(rangeEndInput.value, 10);
            if (!start || start < 1) start = 1;
            if (!end || end < start) end = start + Math.max(0, settings.refreshPages - 1);
            fsRunRangeScan(queryInput.value, statusEl, resultsEl, scanBtn, start, end);
        };
        queryInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && suggestEl.style.display === 'none') doSearch(false);
        });
        const existingCache = fsLoadCache();
        if (existingCache && existingCache.posts && existingCache.posts.length) {
        } else {
            statusEl.textContent = '本地快取尚未建立，正在背景建立（首次扫描可能需要较长时间）...';
            fsEnsureCache(false, (p, total) => {
                statusEl.textContent = `正在扫描「${FS_TARGET_BOARD_LABEL}」第 ${p}/${total} 页...`;
            }).then(cache => {
            }).catch(e => {
                statusEl.textContent = '快取建立失败，请稍后点击「完整重新扫描」重试';
                console.error('[Novelia Forum Search] 背景建立快取失败', e);
            });
        }

        fsUpdateHeaderStatus();
    }

    let fsDebounceTimer = null;
    function fsScheduleInject() {
        clearTimeout(fsDebounceTimer);
        fsDebounceTimer = setTimeout(() => {
            try { fsInjectSearchBar(); } catch (e) { console.error('[Novelia Forum Search] 注入失败', e); }
        }, 250);
    }

    function init() {
        new MutationObserver(fsScheduleInject).observe(document.body, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class']
        });
        fsScheduleInject();
        fsSetupAutoRefresh();
        setInterval(fsUpdateHeaderStatus, 60000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();