// HTML 轉義工具，防範 DOM-based XSS
function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// 初始化日誌
function log(message, type = 'info') {
    const box = document.getElementById('console-log-box');
    if (!box) return;
    const line = document.createElement('div');
    line.className = 'console-line';
    if (type === 'error') line.classList.add('console-error');
    if (type === 'success') line.classList.add('console-success');
    if (type === 'warning') line.classList.add('console-warning');

    const now = new Date();
    const timeStr = `[${now.toTimeString().split(' ')[0]}]`;
    line.innerHTML = `<span class="console-time">${timeStr}</span>${message}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
}

// ── 1. 網址解析與快取管理 ──────────────────────────────────────────
function parseNovelId(url) {
    if (!url) return null;
    const match = url.trim().match(/(?:https?:\/\/syosetu\.org)?\/novel\/(\d+)/);
    return match ? match[1] : null;
}

// ── 2. IndexedDB 資料庫儲存 ──────────────────────────────────────────
const DB_NAME = 'HamelnSeekerDB';
const DB_VERSION = 1;
const STORE_NAME = 'chapters';

const HamelnSeekerDB = {
    open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async saveChapter(novelId, chapterNum, title, content) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const data = {
                id: `${novelId}_${chapterNum}`,
                novelId: String(novelId),
                chapterNum: Number(chapterNum),
                title: title || '',
                content: content || '',
                updatedAt: Date.now()
            };
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async saveDescription(novelId, description) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const data = {
                id: `${novelId}_desc`,
                novelId: String(novelId),
                description: description || '',
                updatedAt: Date.now()
            };
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getDescription(novelId) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(`${novelId}_desc`);
            request.onsuccess = (e) => {
                const res = e.target.result;
                resolve(res ? res.description : '');
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getChapters(novelId) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = (e) => {
                const all = e.target.result;
                const filtered = all.filter(ch => ch.novelId === String(novelId) && ch.chapterNum !== undefined)
                                   .sort((a, b) => a.chapterNum - b.chapterNum);
                resolve(filtered);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteChapters(novelId) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = (e) => {
                const all = e.target.result;
                const toDelete = all.filter(ch => ch.novelId === String(novelId));
                if (toDelete.length === 0) return resolve();
                let completed = 0;
                let aborted = false;
                for (const ch of toDelete) {
                    const req = store.delete(ch.id);
                    req.onsuccess = () => {
                        completed++;
                        if (completed === toDelete.length && !aborted) resolve();
                    };
                    req.onerror = (e) => {
                        aborted = true;
                        reject(e.target.error);
                    };
                }
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async clearAll() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
};

// ── 3. 系統狀態與排程管理器 ──────────────────────────────────────────
const ConfigManager = {
    getNovels() {
        try {
            const raw = localStorage.getItem('hameln_seeker_novels');
            const novels = raw ? JSON.parse(raw) : [];
            return novels.map(n => {
                delete n.description;
                delete n.url;
                return n;
            });
        } catch {
            return [];
        }
    },
    saveNovels(novels) {
        const cleaned = novels.map(n => {
            const copy = { ...n };
            delete copy.description;
            delete copy.url;
            return copy;
        });
        localStorage.setItem('hameln_seeker_novels', JSON.stringify(cleaned));
    },
    getGlobalSettings() {
        return {
            interval: parseInt(localStorage.getItem('hameln_seeker_global_interval') || '10', 10),
            autoCheck: localStorage.getItem('hameln_seeker_auto_check') !== 'false'
        };
    },
    saveGlobalSettings(settings) {
        localStorage.setItem('hameln_seeker_global_interval', settings.interval);
        localStorage.setItem('hameln_seeker_auto_check', settings.autoCheck);
    }
};

const postMessageCallbacks = new Map();
window.addEventListener('message', (e) => {
    const data = e.data;
    if (data && data.type === 'hameln_seeker_html' && data.url) {
        log(`[對接] 收到來自跨域橋樑 (Bridge) 的網頁內容: ${data.url.slice(0, 50)}...`);
        for (const [targetUrl, resolve] of postMessageCallbacks.entries()) {
            if (targetUrl === data.url || targetUrl.replace(/\/$/, '') === data.url.replace(/\/$/, '')) {
                resolve(data.html);
                postMessageCallbacks.delete(targetUrl);
            }
        }
    }
});

const Parser = {
    async fetchPage(url, timeoutMs = 45000) {
        // 如果是 Chrome 插件或具有 host_permissions，直接 fetch，完全避免 XSS 限制與同源 CORS 問題，且不用新開彈窗！
        const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
        if (isExtension) {
            log(`[插件模式] 直接抓取: ${url}`);
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP 錯誤: ${response.status}`);
                }
                const htmlText = await response.text();
                const parser = new DOMParser();
                return parser.parseFromString(htmlText, 'text/html');
            } catch (err) {
                log(`[插件模式] 抓取失敗: ${err.message}，嘗試改用彈出分頁作為備用方案...`, 'warning');
            }
        }

        return new Promise((resolve, reject) => {
            let resolved = false;
            let popup = null;

            const cleanup = () => {
                postMessageCallbacks.delete(url);
                postMessageCallbacks.delete(url.replace(/\/$/, ''));
            };

            const timer = setTimeout(() => {
                if (!resolved) {
                    cleanup();
                    reject(new Error("載入頁面與對接逾時: " + url));
                }
            }, timeoutMs);

            log(`[模式] 彈窗載入: ${url}`);

            const onHtmlReceived = (htmlText) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                cleanup();
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlText, 'text/html');
                    resolve(doc);
                } catch (err) {
                    reject(err);
                }
            };

            postMessageCallbacks.set(url, onHtmlReceived);
            postMessageCallbacks.set(url.replace(/\/$/, ''), onHtmlReceived);

            try {
                popup = window.open('about:blank', "hameln_seeker_crawler");
                if (!popup) {
                    throw new Error("POPUP_BLOCKED");
                }
                try {
                    popup.blur();
                } catch (err) {}
                window.focus();
                popup.location.replace(url);
            } catch (e) {
                resolved = true;
                clearTimeout(timer);
                cleanup();
                reject(e);
            }
        });
    },

    detectMaxPage(doc, novelId) {
        const pattern = new RegExp(`^(?:https?://syosetu\\.org)?/novel/${novelId}/(\\d+)\\.html$`);
        const episodeList = doc.querySelector(".episode-list");
        let searchRoot = episodeList;
        if (!searchRoot) {
            const ssDivs = doc.querySelectorAll("div.ss");
            searchRoot = ssDivs[2] || doc;
        }
        let max = 0;
        searchRoot.querySelectorAll("a[href]").forEach((a) => {
            const href = a.getAttribute("href") || "";
            const rel = href.match(/^\.\/(\d+)\.html$/) || href.match(pattern);
            if (rel) max = Math.max(max, parseInt(rel[1], 10));
        });
        return max;
    },

    extractNovelTitle(doc, novelId) {
        const el = doc.querySelector('span[itemprop="name"]');
        return el ? el.textContent.trim().replace(/[\r\n]+/g, " ").trim() : `syosetu_${novelId}`;
    },

    extractNovelDescription(doc) {
        const maind = doc.getElementById("maind");
        if (!maind) return "";
        const ssDivs = maind.querySelectorAll("div.ss");
        if (ssDivs.length < 2) return "";
        const descDiv = ssDivs[1].cloneNode(true);
        descDiv.querySelectorAll("hr").forEach((hr) => hr.remove());
        descDiv.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
        return descDiv.textContent.trim();
    },

    extractChapterTitle(doc) {
        const bigSpan = Array.from(doc.querySelectorAll("span")).find((el) =>
            /font-size\s*:\s*1[2-9]0%/.test(el.getAttribute("style") || "") &&
            !/novel_title|\.title/.test(el.className) &&
            !el.closest("p")?.querySelector('a[href="./"]')
        );
        if (bigSpan) return bigSpan.textContent.trim();
        const sub = doc.querySelector(".subtitle, .chapter-title, h2");
        return sub ? sub.textContent.trim() : "";
    },

    extractContent(doc) {
        const ss = doc.querySelector("div.ss");
        if (!ss) return "";
        let out = "";
        const maegaki = doc.querySelector("#maegaki");
        if (maegaki && maegaki.textContent.trim()) {
            out += `【前書き】\n${maegaki.textContent.trim()}\n\n${"─".repeat(20)}\n\n`;
        }
        const navi = ss.querySelector("div.novelnavi");
        if (navi) {
            let node = navi;
            const toRemove = [navi];
            while (node.previousSibling) { toRemove.push(node.previousSibling); node = node.previousSibling; }
            toRemove.forEach((n) => n.parentNode && n.parentNode.removeChild(n));
        }
        const honbun = ss.querySelector("div#honbun") || ss;
        const paragraphs = Array.from(honbun.querySelectorAll("p"));
        out += (paragraphs.length > 0 ? paragraphs.map((p) => p.textContent).join("\n") : honbun.textContent || "").trim();
        const atogaki = doc.querySelector("#atogaki");
        if (atogaki && atogaki.textContent.trim()) {
            out += `\n\n${"─".repeat(20)}\n\n【後書き】\n${atogaki.textContent.trim()}`;
        }
        return out;
    }
};

// UI 渲染與事件處理
let globalCountdownInterval = null;
let isSystemRunning = false;

function updateSystemStatus(state, text) {
    const dot = document.getElementById('global-status-dot');
    const statusTxt = document.getElementById('global-status-text');
    if (!dot || !statusTxt) return;
    dot.className = 'status-dot ' + state;
    statusTxt.textContent = text;
}

function renderNovelsTable() {
    const novels = ConfigManager.getNovels();
    const tbody = document.getElementById('novels-table-body');
    if (!tbody) return;

    if (novels.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px 0;">目前無監測中的小說，請在上方輸入網址新增。</td></tr>`;
        return;
    }

    const justCompleted = JSON.parse(localStorage.getItem('hameln_seeker_just_completed') || '[]');

    tbody.innerHTML = novels.map(n => {
        const intervalStr = n.interval === 'global' ? `全域 (${ConfigManager.getGlobalSettings().interval}分)` : `${n.interval}分鐘`;

        let badgeClass = 'idle';
        let badgeText = '監測中';
        if (n.status === 'checking') { badgeClass = 'checking'; badgeText = '檢測中'; }
        else if (n.status === 'scraping') { badgeClass = 'scraping'; badgeText = n.progressText || '爬取中'; }
        else if (n.status === 'error') { badgeClass = 'error'; badgeText = '錯誤'; }
        else if (justCompleted.includes(n.id) || n.localLatest < n.webLatest) { badgeClass = 'updated'; badgeText = '有更新'; }

        const downloadBtn = `<button class="btn btn-green btn-sm btn-download-epub" data-id="${n.id}">📥 EPUB</button>`;

        const rawTitle = n.title || `syosetu_${n.id}`;
        const displayTitle = escHtml(rawTitle);
        const truncatedRaw = rawTitle.length > 25 ? rawTitle.slice(0, 25) + '...' : rawTitle;
        const truncatedTitle = escHtml(truncatedRaw);

        const fromValue = n.fromCh || n.startChapter || 1;
        const toValue = n.toCh || '';

        return `
            <tr id="row-${n.id}">
                <td>
                    <a href="https://syosetu.org/novel/${n.id}/" target="_blank" style="text-decoration: none;" title="${displayTitle}">
                        <code style="color: var(--accent-blue); font-weight: bold; cursor: pointer; text-decoration: underline;">${n.id}</code>
                    </a>
                </td>
                <td class="novel-title-cell" title="${displayTitle}">${truncatedTitle}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="number" min="1" value="${fromValue}" class="input-from-ch" data-id="${n.id}" style="width: 70px; background-color: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-sm); padding: 4px 6px; text-align: center;">
                        <span style="color: var(--text-muted);">~</span>
                        <input type="number" min="1" value="${toValue}" placeholder="最新" class="input-to-ch" data-id="${n.id}" style="width: 70px; background-color: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-sm); padding: 4px 6px; text-align: center;">
                    </div>
                </td>
                <td>${intervalStr}</td>
                <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
                <td>
                    <div class="row-actions">
                        ${downloadBtn}
                        <button class="btn btn-secondary btn-sm btn-check-single" data-id="${n.id}">🔄 檢測</button>
                        <button class="btn btn-red btn-sm btn-delete-novel" data-id="${n.id}">✕</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// 動態綁定範圍變更邏輯
window.updateNovelRange = function(id, value, field) {
    let novels = ConfigManager.getNovels();
    const n = novels.find(x => x.id === String(id));
    if (n) {
        if (field === 'fromCh') {
            n.fromCh = parseInt(value, 10) || 1;
        } else if (field === 'toCh') {
            n.toCh = (value === '' || value === null || value === undefined) ? null : parseInt(value, 10);
        }
        ConfigManager.saveNovels(novels);
        log(`⚙️ 已更新小說 [${n.title || n.id}] 的範圍設定 (${field}): ${value || '最新'}`);
    }
};

// 定時刷新倒數計時與檢查判定
function startCountdownTimers() {
    if (globalCountdownInterval) clearInterval(globalCountdownInterval);

    globalCountdownInterval = setInterval(() => {
        const novels = ConfigManager.getNovels();
        const settings = ConfigManager.getGlobalSettings();

        const now = Date.now();
        let expiredIndividualNovelId = null;

        for (const n of novels) {
            if (n.nextCheckTime) {
                const diff = Math.max(0, Math.round((n.nextCheckTime - now) / 1000));
                if (diff <= 0 && settings.autoCheck && !isSystemRunning) {
                    expiredIndividualNovelId = n.id;
                    break;
                }
            }
        }

        let globalNext = localStorage.getItem('hameln_seeker_global_next_check');
        if (!globalNext) {
            globalNext = now + settings.interval * 60000;
            localStorage.setItem('hameln_seeker_global_next_check', globalNext);
        }
        const globalDiff = Math.max(0, Math.round((parseInt(globalNext, 10) - now) / 1000));
        const gMins = Math.floor(globalDiff / 60);
        const gSecs = globalDiff % 60;
        document.getElementById('global-countdown').textContent = `${String(gMins).padStart(2, '0')}:${String(gSecs).padStart(2, '0')}`;

        if (globalDiff <= 0 && settings.autoCheck && !isSystemRunning) {
            log('全域自動檢測時間已到，啟動全體更新檢測流程...');
            localStorage.setItem('hameln_seeker_global_next_check', Date.now() + settings.interval * 60000);
            checkAndCrawlAll();
        } else if (expiredIndividualNovelId && !isSystemRunning) {
            const matchedNovel = novels.find(n => n.id === expiredIndividualNovelId);
            log(`個別自動檢測時間已到，啟動小說 [${matchedNovel ? (matchedNovel.title || matchedNovel.id) : expiredIndividualNovelId}] 檢測流程...`);
            checkAndCrawlAll(expiredIndividualNovelId);
        }
    }, 1000);
}

// ── 4. 檢測與爬蟲排程核心引擎 ──────────────────────────────────────────
async function checkAndCrawlAll(targetId = null) {
    if (isSystemRunning) return;
    isSystemRunning = true;
    updateSystemStatus('busy', '檢測與爬取中...');

    let novels = ConfigManager.getNovels();
    if (novels.length === 0) {
        log('監測清單為空，取消流程。', 'warning');
        isSystemRunning = false;
        updateSystemStatus('idle', '系統就緒');
        return;
    }

    const targets = targetId ? novels.filter(n => n.id === targetId) : novels;
    const updatedNovels = [];
    const crawlQueue = [];

    log(`📢 開始檢查 ${targets.length} 本小說是否更新...`);

    let popupBlockedDetected = false;

    for (const n of targets) {
        n.status = 'checking';
        renderNovelsTable();
        log(`🔍 正在檢查 [${n.title || n.id}] 目錄資訊...`);

        try {
            const doc = await Parser.fetchPage(`https://syosetu.org/novel/${n.id}/`);
            const maxPage = Parser.detectMaxPage(doc, n.id);
            const title = Parser.extractNovelTitle(doc, n.id);
            const desc = Parser.extractNovelDescription(doc);

            n.title = title;
            n.webLatest = maxPage;

            await HamelnSeekerDB.saveDescription(n.id, desc);

            const existingChs = await HamelnSeekerDB.getChapters(n.id);
            const existingNums = new Set(existingChs.map(c => c.chapterNum));

            const startVal = parseInt(n.fromCh || n.startChapter || 1, 10);
            const endVal = (n.toCh !== null && n.toCh !== undefined && n.toCh !== '') ? Math.min(maxPage, parseInt(n.toCh, 10)) : maxPage;

            let neededChs = [];
            for (let ch = startVal; ch <= endVal; ch++) {
                if (!existingNums.has(ch)) {
                    neededChs.push(ch);
                }
            }

            n.localLatest = existingChs.length > 0 ? Math.max(...existingChs.map(c => c.chapterNum)) : 0;

            if (neededChs.length > 0) {
                log(`⚡ 檢測到更新或範圍內缺失章節！[${title}] 需要爬取的章節：${neededChs.join(', ')} 話`, 'warning');
                updatedNovels.push(n.id);
                for (let ch of neededChs) {
                    crawlQueue.push({ novelId: n.id, chapterNum: ch });
                }
            } else {
                log(`✅ [${title}] 指定範圍 [${startVal} ~ ${endVal}] 內的章節已全部下載。`);
            }
            n.status = 'idle';
        } catch (err) {
            if (err.message === "POPUP_BLOCKED") {
                popupBlockedDetected = true;
                n.status = 'error';
                break;
            }
            log(`❌ 檢查 [${n.id}] 失敗: ${err.message}`, 'error');
            n.status = 'error';
        }
        const intervalMinutes = n.interval === 'global' ? ConfigManager.getGlobalSettings().interval : parseInt(n.interval, 10);
        n.nextCheckTime = Date.now() + intervalMinutes * 60000;
        ConfigManager.saveNovels(novels);
        renderNovelsTable();
        await new Promise(r => setTimeout(r, 500));
    }

    if (popupBlockedDetected) {
        log('🚨 偵測到「已封鎖彈出式視窗」！請於瀏覽器網址列右側允許本網頁彈出視窗與分頁，以開啟背景對接。', 'error');
        log('🔔 本工具已停止檢測，正等待您開啟權限。開啟後可手動點擊「立即檢測全部」或等待下一次排程。', 'warning');
        isSystemRunning = false;
        updateSystemStatus('idle', '等待彈出視窗權限中');

        novels.forEach(n => {
            if (n.status === 'checking' || n.status === 'scraping') n.status = 'idle';
        });
        ConfigManager.saveNovels(novels);
        renderNovelsTable();
        return;
    }

    if (crawlQueue.length > 0) {
        log(`📥 開始爬取更新章節，佇列總計 ${crawlQueue.length} 個章節...`, 'warning');
        let count = 0;
        for (const item of crawlQueue) {
            count++;
            const n = novels.find(x => x.id === item.novelId);
            n.status = 'scraping';
            n.progressText = `爬取中 ${count}/${crawlQueue.length}`;
            renderNovelsTable();

            log(`📥 正在爬取 [${n.title}] 第 ${item.chapterNum} 話 (${count}/${crawlQueue.length})...`);
            try {
                const url = `https://syosetu.org/novel/${item.novelId}/${item.chapterNum}.html`;
                const doc = await Parser.fetchPage(url);
                const chTitle = Parser.extractChapterTitle(doc) || `第 ${item.chapterNum} 話`;
                const chContent = Parser.extractContent(doc);

                await HamelnSeekerDB.saveChapter(item.novelId, item.chapterNum, chTitle, chContent);
                n.localLatest = item.chapterNum;
                ConfigManager.saveNovels(novels);
            } catch (err) {
                if (err.message === "POPUP_BLOCKED") {
                    popupBlockedDetected = true;
                    n.status = 'error';
                    break;
                }
                log(`❌ 爬取 [${n.title}] 第 ${item.chapterNum} 話失敗: ${err.message}`, 'error');
                n.status = 'error';
                break;
            }
            await new Promise(r => setTimeout(r, 500));
        }

        if (popupBlockedDetected) {
            log('🚨 偵測到「已封鎖彈出式視窗」！請於瀏覽器網址列右側允許本網頁彈出視窗與分頁，以開啟背景對接。', 'error');
            log('🔔 本工具已停止檢測，正等待您開啟權限。開啟後可手動點擊「立即檢測全部」或等待下一次排程。', 'warning');
            isSystemRunning = false;
            updateSystemStatus('idle', '等待彈出視窗權限中');

            novels.forEach(n => {
                if (n.status === 'checking' || n.status === 'scraping') n.status = 'idle';
            });
            ConfigManager.saveNovels(novels);
            renderNovelsTable();
            return;
        }

        novels.forEach(n => {
            if (n.status === 'scraping' || n.status === 'checking') n.status = 'idle';
        });
        ConfigManager.saveNovels(novels);
        renderNovelsTable();
    }

    log(`🎉 檢測與爬取任務完成！已將文字內容保存到 IndexedDB。`, 'success');

    localStorage.setItem('hameln_seeker_just_completed', JSON.stringify(updatedNovels));

    const settings = ConfigManager.getGlobalSettings();
    localStorage.setItem('hameln_seeker_global_next_check', Date.now() + settings.interval * 60000);

    isSystemRunning = false;
    updateSystemStatus('idle', '系統就緒');
    renderNovelsTable();
}

// ── 5. EPUB 生成與下載邏輯 ──────────────────────────────────────────
const EpubExporter = {
    toUTF8: (str) => new TextEncoder().encode(str),
    escXml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"),
    textToXhtml(text) {
        return (text || '').split(/\n/).map((line) => `<p>${this.escXml(line) || "&#160;"}</p>`).join("\n");
    },
    zipUint32LE: (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]),
    zipUint16LE: (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]),
    crc32(data) {
        const table = EpubExporter.crc32.table || (EpubExporter.crc32.table = (() => {
            const t = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
                t[i] = c;
            }
            return t;
        })());
        let crc = 0xffffffff;
        for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    },
    concatU8(...arrays) {
        const total = arrays.reduce((s, a) => s + a.length, 0);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const a of arrays) {
            out.set(a, offset);
            offset += a.length;
        }
        return out;
    },
    buildZip(entries) {
        const localHeaders = [], centralDir = [];
        let offset = 0;
        for (const entry of entries) {
            const nameBytes = new TextEncoder().encode(entry.name);
            const data = entry.data, crc = this.crc32(data), size = data.length;
            const local = this.concatU8(
                new Uint8Array([0x50, 0x4b, 0x03, 0x04]), this.zipUint16LE(20), this.zipUint16LE(0), this.zipUint16LE(0), this.zipUint16LE(0), this.zipUint16LE(0),
                this.zipUint32LE(crc), this.zipUint32LE(size), this.zipUint32LE(size), this.zipUint16LE(nameBytes.length), this.zipUint16LE(0),
                nameBytes, data
            );
            localHeaders.push({ local, nameBytes, crc, size, offset });
            offset += local.length;
            centralDir.push(this.concatU8(
                new Uint8Array([0x50, 0x4b, 0x01, 0x02]), this.zipUint16LE(20), this.zipUint16LE(20), this.zipUint16LE(0), this.zipUint16LE(0), this.zipUint16LE(0), this.zipUint16LE(0),
                this.zipUint32LE(crc), this.zipUint32LE(size), this.zipUint32LE(size), this.zipUint16LE(nameBytes.length), this.zipUint16LE(0), this.zipUint16LE(0), this.zipUint16LE(0), this.zipUint16LE(0),
                this.zipUint32LE(0), this.zipUint32LE(localHeaders[localHeaders.length - 1].offset), nameBytes
            ));
        }
        const cdData = this.concatU8(...centralDir), eocd = this.concatU8(
            new Uint8Array([0x50, 0x4b, 0x05, 0x06]), this.zipUint16LE(0), this.zipUint16LE(0), this.zipUint16LE(entries.length), this.zipUint16LE(entries.length),
            this.zipUint32LE(cdData.length), this.zipUint32LE(offset), this.zipUint16LE(0)
        );
        return this.concatU8(...localHeaders.map((h) => h.local), cdData, eocd);
    },
    generateEpub(novel, chapters, description) {
        const title = novel.title || novel.id;
        const novelUrl = `https://syosetu.org/novel/${novel.id}/`;
        const uuid = `urn:uuid:${novel.id}-${Date.now()}`;
        const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

        const entries = [
            { name: "mimetype", data: this.toUTF8("application/epub+zip") },
            { name: "META-INF/container.xml", data: this.toUTF8(`<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`) },
            { name: "OEBPS/style.css", data: this.toUTF8(`body{font-family:'Hiragino Mincho Pro','MS Mincho',serif;line-height:1.9;margin:1.5em;}h1{font-size:1.5em;border-bottom:1px solid #888;padding-bottom:0.4em;margin-bottom:1em;}h2{font-size:1.1em;color:#555;margin-bottom:0.8em;}p{margin:0.3em 0;text-indent:1em;}.chapter-num{color:#888;font-size:0.85em;}`) },
            { name: "OEBPS/cover.xhtml", data: this.toUTF8(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><head><meta charset="utf-8"/><title>${this.escXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body style="text-align:center;padding-top:4em;"><h1>${this.escXml(title)}</h1><p style="color:#888;font-size:0.9em;"><a href="${this.escXml(novelUrl)}">${this.escXml(novelUrl)}</a></p><p style="color:#aaa;font-size:0.8em;margin-top:2em;">第 ${chapters[0].chapterNum} — ${chapters[chapters.length - 1].chapterNum} 話（共 ${chapters.length} 章）</p><p style="color:#ccc;font-size:0.75em;">${this.escXml(now.slice(0, 10))} 生成</p></body></html>`) }
        ];

        if (description) {
            entries.push({
                name: "OEBPS/description.xhtml",
                data: this.toUTF8(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><head><meta charset="utf-8"/><title>作品描述</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>作品描述</h1>${this.textToXhtml(description)}</body></html>`)
            });
        }

        const chapterFiles = [];
        for (const ch of chapters) {
            const chTitle = ch.title ? `第 ${ch.chapterNum} 話　${ch.title}` : `第 ${ch.chapterNum} 話`;
            const xhtml = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><head><meta charset="utf-8"/><title>${this.escXml(chTitle)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1><span class="chapter-num">第 ${ch.chapterNum} 話</span>${ch.title ? `<br/>${this.escXml(ch.title)}` : ""}</h1>${this.textToXhtml(ch.content || "（無內容）")}</body></html>`;
            const fname = `ch${String(ch.chapterNum).padStart(5, "0")}.xhtml`;
            entries.push({ name: `OEBPS/${fname}`, data: this.toUTF8(xhtml) });
            chapterFiles.push({ fname, page: ch.chapterNum, title: chTitle });
        }

        const manifestItems = [
            `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
            description ? `<item id="description" href="description.xhtml" media-type="application/xhtml+xml"/>` : "",
            `<item id="css" href="style.css" media-type="text/css"/>`,
            `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
            ...chapterFiles.map((c) => `<item id="ch${c.page}" href="${c.fname}" media-type="application/xhtml+xml"/>`)
        ].filter(Boolean).join("\n    ");

        const spineItems = [
            `<itemref idref="cover"/>`,
            description ? `<itemref idref="description"/>` : "",
            ...chapterFiles.map((c) => `<itemref idref="ch${c.page}"/>`)
        ].filter(Boolean).join("\n    ");

        entries.push({ name: "OEBPS/content.opf", data: this.toUTF8(`<?xml version="1.0" encoding="utf-8"?><package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title>${this.escXml(title)}</dc:title><dc:language>ja</dc:language><dc:identifier id="BookId">${this.escXml(uuid)}</dc:identifier><dc:source>${this.escXml(novelUrl)}</dc:source><dc:date opf:event="modification">${now}</dc:date></metadata><manifest>${manifestItems}</manifest><spine toc="ncx">${spineItems}</spine></package>`) });

        let playOrder = 1;
        const navPoints = [
            `<navPoint id="cover" playOrder="${playOrder++}"><navLabel><text>表紙</text></navLabel><content src="cover.xhtml"/></navPoint>`,
            description ? `<navPoint id="description" playOrder="${playOrder++}"><navLabel><text>作品描述</text></navLabel><content src="description.xhtml"/></navPoint>` : "",
            ...chapterFiles.map((c) => `<navPoint id="ch${c.page}" playOrder="${playOrder++}"><navLabel><text>${this.escXml(c.title)}</text></navLabel><content src="${c.fname}"/></navPoint>`)
        ].filter(Boolean).join("\n    ");

        entries.push({ name: "OEBPS/toc.ncx", data: this.toUTF8(`<?xml version="1.0" encoding="utf-8"?><ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/"><head><meta name="dtb:uid" content="${this.escXml(uuid)}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${this.escXml(title)}</text></docTitle><navMap>${navPoints}</navMap></ncx>`) });

        return this.buildZip(entries);
    }
};

window.downloadEpub = async function(novelId) {
    log(`📕 正在準備生成小說 [${novelId}] 的 EPUB...`);
    const novels = ConfigManager.getNovels();
    const n = novels.find(x => x.id === String(novelId));
    if (!n) {
        log('❌ 找不到該監測小說設定資訊。', 'error');
        return;
    }

    try {
        let chs = await HamelnSeekerDB.getChapters(novelId);
        if (chs.length === 0) {
            log('❌ 本地快取無任何章節內容，無法生成 EPUB。請先執行檢測爬取！', 'error');
            return;
        }

        const fromCh = parseInt(n.fromCh || n.startChapter || 1, 10);
        const toCh = (n.toCh !== null && n.toCh !== undefined && n.toCh !== '') ? parseInt(n.toCh, 10) : Infinity;

        chs = chs.filter(c => c.chapterNum >= fromCh && c.chapterNum <= toCh);
        if (chs.length === 0) {
            log(`❌ 在指定範圍 [${fromCh} ~ ${toCh === Infinity ? '最新' : toCh}] 內無任何快取章節，無法生成 EPUB。`, 'error');
            return;
        }

        const desc = await HamelnSeekerDB.getDescription(novelId);
        const u8data = EpubExporter.generateEpub(n, chs, desc);
        const blob = new Blob([u8data], { type: "application/epub+zip" });
        const url = URL.createObjectURL(blob);

        const safeTitle = (n.title || n.id).replace(/[\\/:*?"<>|]/g, "_");
        const first = chs[0].chapterNum, last = chs[chs.length - 1].chapterNum;
        const range = (first === last) ? `ch${first}` : `ch${first}-${last}`;
        const filename = `${n.id}_${range}_${safeTitle}.epub`;

        const a = document.createElement("a");
        Object.assign(a, { href: url, download: filename });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        log(`🎉 [${n.title}] EPUB 生成成功並開始下載！檔名：${filename}`, 'success');
    } catch (err) {
        log(`❌ 生成 EPUB 失敗: ${err.message}`, 'error');
    }
};

// ── 6. 單一與全體操作行為 ──────────────────────────────────────────
window.deleteNovel = async function(id) {
    if (!confirm(`是否刪除該監測小說並清除其 IndexedDB 快取章節？`)) return;
    let novels = ConfigManager.getNovels();
    novels = novels.filter(n => n.id !== String(id));
    ConfigManager.saveNovels(novels);
    await HamelnSeekerDB.deleteChapters(id);
    log(`🗑️ 已刪除小說監測 [${id}] 與其本機快取章節。`);
    renderNovelsTable();
};

window.forceCheckSingle = function(id) {
    log(`🔄 手動觸發小說 [${id}] 更新檢測...`);
    checkAndCrawlAll(id);
};

// ── 7. 設定匯出/匯入邏輯 (JSON) ──────────────────────────────────────────
function exportConfig() {
    try {
        const data = {
            novels: ConfigManager.getNovels(),
            settings: ConfigManager.getGlobalSettings()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hameln_seeker_config_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        log('📤 成功匯出設定檔！', 'success');
    } catch (err) {
        log(`❌ 匯出設定檔失敗: ${err.message}`, 'error');
    }
}

function triggerImportInput() {
    document.getElementById('file-import-input').click();
}

async function importConfig(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data && Array.isArray(data.novels)) {
                ConfigManager.saveNovels(data.novels);
                if (data.settings) {
                    ConfigManager.saveGlobalSettings(data.settings);
                    document.getElementById('global-interval').value = data.settings.interval;
                    document.getElementById('auto-check-toggle').checked = data.settings.autoCheck;
                }
                log('📥 設定檔已成功匯入！開始渲染監測清單。', 'success');
                renderNovelsTable();
                startCountdownTimers();
            } else {
                log('❌ 匯入失敗：無效的 JSON 結構！', 'error');
            }
        } catch (err) {
            log(`❌ 匯入設定檔失敗: ${err.message}`, 'error');
        }
    };
    reader.readAsText(file, 'utf-8');
}

// 頁面初始化載入與事件委派綁定
window.addEventListener('DOMContentLoaded', () => {
    const settings = ConfigManager.getGlobalSettings();
    document.getElementById('global-interval').value = settings.interval;
    document.getElementById('auto-check-toggle').checked = settings.autoCheck;

    const justCompleted = JSON.parse(localStorage.getItem('hameln_seeker_just_completed') || '[]');
    if (justCompleted.length > 0) {
        log(`🎉 上次自動更新檢測成功完成！已更新小說：${justCompleted.join(', ')}。`, 'success');
        setTimeout(() => localStorage.removeItem('hameln_seeker_just_completed'), 5000);
    }

    renderNovelsTable();
    startCountdownTimers();

    // 點擊新增按鈕
    document.getElementById('btn-add-novel').onclick = () => {
        const urlInput = document.getElementById('novel-url');
        const startChInput = document.getElementById('novel-start-chapter');
        const intervalSelect = document.getElementById('novel-interval');

        const url = urlInput.value.trim();
        const startCh = parseInt(startChInput.value, 10) || 1;
        const interval = intervalSelect.value;

        const id = parseNovelId(url);
        if (!id) {
            urlInput.classList.add('input-error');
            log('❌ 請輸入正確的哈梅林(syosetu.org)小說連結！', 'error');
            return;
        }
        urlInput.classList.remove('input-error');

        let novels = ConfigManager.getNovels();
        if (novels.some(n => n.id === id)) {
            log(`⚠️ 小說 [ID: ${id}] 已經在監測清單中。`, 'warning');
            return;
        }

        const newNovel = {
            id: id,
            title: `syosetu_${id}`,
            startChapter: startCh,
            fromCh: startCh,
            toCh: null,
            localLatest: 0,
            webLatest: 0,
            interval: interval,
            nextCheckTime: Date.now(),
            status: 'idle'
        };

        novels.push(newNovel);
        ConfigManager.saveNovels(novels);
        log(`📌 成功加入小說 [ID: ${id}] 到監測清單！將立即進行第一次檢測...`, 'success');
        renderNovelsTable();
        urlInput.value = '';
        checkAndCrawlAll(id);
    };

    // 立即檢測全部
    document.getElementById('btn-force-check-all').onclick = () => {
        log('🚀 手動觸發全體更新檢測...');
        checkAndCrawlAll();
    };

    // 清空全部
    document.getElementById('btn-clear-all').onclick = async () => {
        if (!confirm('確定要清除所有小說監測紀錄與所有 IndexedDB 快取章節嗎？此操作不可逆！')) return;
        ConfigManager.saveNovels([]);
        await HamelnSeekerDB.clearAll();
        log('🗑️ 已成功清空所有小說監測資料與資料庫。', 'warning');
        renderNovelsTable();
    };

    // 設定匯出匯入
    document.getElementById('btn-export-config').onclick = exportConfig;
    document.getElementById('btn-import-config').onclick = triggerImportInput;
    document.getElementById('file-import-input').onchange = (e) => {
        importConfig(e.target.files[0]);
        e.target.value = '';
    };

    // 變更全域檢測間隔
    document.getElementById('global-interval').onchange = (e) => {
        const interval = parseInt(e.target.value, 10) || 10;
        const settings = ConfigManager.getGlobalSettings();
        settings.interval = interval;
        ConfigManager.saveGlobalSettings(settings);
        localStorage.setItem('hameln_seeker_global_next_check', Date.now() + interval * 60000);
        log(`⚙️ 已更新全域檢測間隔為 ${interval} 分鐘。`);
        renderNovelsTable();
    };

    // 啟用定時自動檢測
    document.getElementById('auto-check-toggle').onchange = (e) => {
        const autoCheck = e.target.checked;
        const settings = ConfigManager.getGlobalSettings();
        settings.autoCheck = autoCheck;
        ConfigManager.saveGlobalSettings(settings);
        log(`⚙️ 已${autoCheck ? '啟用' : '停用'}自動定時更新檢測。`);
    };

    // 操作表格中的事件委派 (防範 XSS 與 Content Security Policy 無法綁定內聯 JS 函數)
    document.getElementById('novels-table-body').addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('btn-download-epub')) {
            const id = target.getAttribute('data-id');
            window.downloadEpub(id);
        } else if (target.classList.contains('btn-check-single')) {
            const id = target.getAttribute('data-id');
            window.forceCheckSingle(id);
        } else if (target.classList.contains('btn-delete-novel')) {
            const id = target.getAttribute('data-id');
            window.deleteNovel(id);
        }
    });

    document.getElementById('novels-table-body').addEventListener('change', (e) => {
        const target = e.target;
        if (target.classList.contains('input-from-ch')) {
            const id = target.getAttribute('data-id');
            window.updateNovelRange(id, target.value, 'fromCh');
        } else if (target.classList.contains('input-to-ch')) {
            const id = target.getAttribute('data-id');
            window.updateNovelRange(id, target.value, 'toCh');
        }
    });
});

log('網址解析器與 IndexedDB 模組載入完成。');
