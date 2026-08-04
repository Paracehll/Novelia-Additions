// ==UserScript==
// @name         Novelia EPUB 合併工具 側邊欄
// @namespace    https://n.novelia.cc/
// @version      2.0.0
// @match        https://n.novelia.cc/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.9.1/jszip.min.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const debugLogging = false;

    const TARGET_PATH = '/workspace/sakura';
    const HOST_ID = 'epub-merger-shadow-host';
    const TOGGLE_ID = 'epub-merger-toggle-btn';
    const PANEL_WIDTH = 380;
    let panelBuilt = false;
    let shadowRoot = null;
    let currentY = 150;

    function isTargetPage() {
        return location.pathname.indexOf(TARGET_PATH) === 0;
    }

    function patchHistoryForRouteEvents() {
        const rawPush = history.pushState;
        const rawReplace = history.replaceState;

        history.pushState = function (...args) {
            const ret = rawPush.apply(this, args);
            window.dispatchEvent(new Event('epub-merger:locationchange'));
            return ret;
        };
        history.replaceState = function (...args) {
            const ret = rawReplace.apply(this, args);
            window.dispatchEvent(new Event('epub-merger:locationchange'));
            return ret;
        };
        window.addEventListener('popstate', () => {
            window.dispatchEvent(new Event('epub-merger:locationchange'));
        });

        let lastPath = location.pathname;
        setInterval(() => {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                window.dispatchEvent(new Event('epub-merger:locationchange'));
            }
        }, 500);
    }

    function onRouteChange() {
        if (isTargetPage()) {
            ensureToggleButton();
        } else {
            removeToggleButton();
            removePanel();
        }
    }

    function ensureToggleButton() {
        if (document.getElementById(TOGGLE_ID)) return;

        const btn = document.createElement('button');
        btn.id = TOGGLE_ID;
        btn.type = 'button';
        btn.title = 'EPUB 合併工具';
        btn.innerHTML = '‹';

        Object.assign(btn.style, {
            position: 'fixed',
            right: '0px',
            top: `${currentY}px`,
            zIndex: 2147483000,
            width: '24px',
            height: '48px',
            borderTopLeftRadius: '8px',
            borderBottomLeftRadius: '8px',
            borderTopRightRadius: '0px',
            borderBottomRightRadius: '0px',
            border: 'none',
            background: 'rgb(24, 24, 28)',
            borderLeft: '1px solid #63e2b7',
            borderTop: '1px solid #63e2b7',
            borderBottom: '1px solid #63e2b7',
            color: '#63e2b7',
            fontSize: '18px',
            fontWeight: 'bold',
            lineHeight: '48px',
            textAlign: 'center',
            padding: '0',
            cursor: 'grab',
            userSelect: 'none',
            boxShadow: '-2px 0 10px rgba(0, 0, 0, 0.5)',
            transition: 'right 0.3s cubic-bezier(.4,0,.2,1), background 0.2s',
        });

        let isDragging = false;
        let startY = 0;
        let startTop = 0;
        let hasMoved = false;

        btn.addEventListener('mousedown', (e) => {
            isDragging = true;
            hasMoved = false;
            startY = e.clientY;
            startTop = btn.offsetTop;
            btn.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const deltaY = e.clientY - startY;
            if (Math.abs(deltaY) > 3) hasMoved = true;

            let newTop = startTop + deltaY;
            newTop = Math.max(10, Math.min(window.innerHeight - 58, newTop));
            currentY = newTop;
            btn.style.top = `${newTop}px`;
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                btn.style.cursor = 'grab';
                document.body.style.userSelect = '';
            }
        });

        btn.addEventListener('click', (e) => {
            if (hasMoved) return;
            togglePanel();
        });

        document.body.appendChild(btn);
    }

    function removeToggleButton() {
        const btn = document.getElementById(TOGGLE_ID);
        if (btn) btn.remove();
    }

    function removePanel() {
        const host = document.getElementById(HOST_ID);
        if (host) host.remove();
        panelBuilt = false;
        shadowRoot = null;
    }

    function togglePanel() {
        if (!isTargetPage()) return;

        if (!panelBuilt) {
            buildPanel();
            const panel = shadowRoot.querySelector('.epub-panel');
            void panel.offsetHeight;
        }

        const panel = shadowRoot.querySelector('.epub-panel');
        const btn = document.getElementById(TOGGLE_ID);
        const isOpen = panel.classList.toggle('open');

        if (isOpen) {
            btn.style.right = `${PANEL_WIDTH}px`;
            btn.innerHTML = '›';
        } else {
            btn.style.right = '0px';
            btn.innerHTML = '‹';
        }
    }

    function buildPanel() {
        panelBuilt = true;

        const host = document.createElement('div');
        host.id = HOST_ID;
        document.body.appendChild(host);
        shadowRoot = host.attachShadow({ mode: 'open' });

        const styleEl = document.createElement('style');
        styleEl.textContent = PANEL_CSS;
        shadowRoot.appendChild(styleEl);

        const wrapper = document.createElement('div');
        wrapper.innerHTML = PANEL_HTML;
        shadowRoot.appendChild(wrapper);

        wireUpEvents(shadowRoot);
    }

    const PANEL_CSS = `
        :host, * { box-sizing: border-box; }

        .epub-panel {
            --n-primary: #63e2b7;
            --n-primary-dark: #42b38c;
            --n-bg: rgb(16, 16, 20);
            --n-surface: rgb(24, 24, 28);
            --n-border: #2d2d30;
            --n-text: #ffffff;
            --n-text-muted: #a0a0a8;
            --n-danger: #e88080;
            --n-radius-lg: 12px;
            --n-radius-md: 8px;

            position: fixed;
            top: 0;
            right: 0;
            width: ${PANEL_WIDTH}px;
            max-width: 92vw;
            height: 100vh;
            background: var(--n-bg);
            box-shadow: -8px 0 32px rgba(0, 0, 0, 0.7);
            z-index: 2147483000;
            transform: translateX(100%);
            transition: transform 0.3s cubic-bezier(.4,0,.2,1);
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: var(--n-text);
            border-left: 1px solid var(--n-border);
        }
        .epub-panel.open { transform: translateX(0); }

        .epub-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1.1rem 1.3rem;
            background: var(--n-surface);
            border-bottom: 1px solid var(--n-border);
            color: var(--n-primary);
            flex-shrink: 0;
        }
        .epub-header h1 { font-size: 1.05rem; margin: 0; font-weight: 600; letter-spacing: 0.5px; color: var(--n-text); }
        .epub-close {
            background: transparent;
            border: none;
            color: var(--n-text-muted);
            font-size: 1.1rem;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s;
        }
        .epub-close:hover { color: var(--n-primary); }

        .epub-body {
            padding: 1.2rem;
            overflow-y: auto;
            flex: 1;
        }

        .drop-zone {
            border: 1px dashed var(--n-border);
            border-radius: var(--n-radius-lg);
            padding: 2rem 1rem;
            text-align: center;
            transition: all 0.25s;
            cursor: pointer;
            margin-bottom: 1rem;
            background: var(--n-surface);
        }
        .drop-zone:hover, .drop-zone.dragover {
            border-color: var(--n-primary);
            background-color: rgba(99, 226, 183, 0.05);
        }
        .drop-zone p { font-size: 0.9rem; color: var(--n-text-muted); margin: 0 0 4px; }
        .drop-zone .drop-icon { font-size: 1.8rem; margin-bottom: 0.4rem; color: var(--n-primary); }

        .options-panel {
            margin-bottom: 1rem;
            padding: 0.8rem 1rem;
            background-color: var(--n-surface);
            border: 1px solid var(--n-border);
            border-radius: var(--n-radius-md);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .option-label { font-size: 0.85rem; color: var(--n-text); font-weight: 500; }

        .switch { position: relative; display: inline-block; width: 42px; height: 22px; flex-shrink: 0; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider {
            position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
            background-color: #3f3f46; transition: .3s; border-radius: 22px;
        }
        .slider:before {
            position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px;
            background-color: white; transition: .3s; border-radius: 50%;
        }
        input:checked + .slider { background-color: var(--n-primary); }
        input:checked + .slider:before { transform: translateX(20px); }

        .file-list-container {
            border: 1px solid var(--n-border); border-radius: var(--n-radius-md); max-height: 160px;
            overflow-y: auto; margin-bottom: 1rem; background: var(--n-surface);
        }
        .file-item {
            padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--n-border);
            display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; color: var(--n-text);
        }
        .file-item:last-child { border-bottom: none; }
        .remove-btn { color: var(--n-danger); cursor: pointer; font-weight: bold; padding: 2px 6px; }

        .btn {
            display: block; width: 100%; padding: 0.75rem; background-color: var(--n-primary);
            color: rgb(16, 16, 20); border: none; border-radius: var(--n-radius-md); font-size: 0.95rem;
            font-weight: bold; cursor: pointer; transition: background 0.2s, opacity 0.2s;
        }
        .btn:hover { background-color: var(--n-primary-dark); }
        .btn:disabled { background-color: #3f3f46; color: #71717a; cursor: not-allowed; }
        .secondary-btn { background-color: transparent; color: var(--n-text-muted); border: 1px solid var(--n-border); margin-top: 0.5rem; }
        .secondary-btn:hover { background-color: var(--n-surface); color: var(--n-text); }

        #status { margin-top: 1rem; text-align: center; font-size: 0.88rem; color: var(--n-primary); }

        .result-panel {
            margin-top: 1.2rem; padding: 1rem; background-color: var(--n-surface);
            border: 1px solid var(--n-primary); border-radius: var(--n-radius-lg); font-size: 0.82rem; line-height: 1.6;
        }
        .result-title {
            color: var(--n-primary); font-weight: bold; margin-bottom: 0.5rem; font-size: 0.95rem;
            border-bottom: 1px solid var(--n-border); padding-bottom: 0.3rem;
        }
        .stats-row { display: flex; margin-bottom: 0.2rem; }
        .stats-label { color: var(--n-text-muted); width: 78px; flex-shrink: 0; }
        .stats-value { color: var(--n-text); font-weight: 500; word-break: break-all; }

        .hidden { display: none; }
        input[type="file"] { display: none; }
    `;

    const PANEL_HTML = `
        <div class="epub-panel">
            <div class="epub-header">
                <h1>EPUB 合併工具</h1>
                <button class="epub-close" id="epub-close-btn" title="關閉">✕</button>
            </div>
            <div class="epub-body">
                <div id="drop-zone" class="drop-zone">
                    <div class="drop-icon">📥</div>
                    <p style="color: #ffffff;">點擊或拖入 EPUB/ZIP 檔案</p>
                    <input type="file" id="file-input" accept=".epub,.zip" multiple>
                </div>

                <div id="file-list" class="file-list-container hidden"></div>

                <div class="options-panel">
                    <span class="option-label">合併已翻譯文件<small style="font-size: 0.78rem; color: #a0a0a8;"> (+前綴)</small></span>
                    <label class="switch">
                        <input type="checkbox" id="translated-toggle" checked>
                        <span class="slider"></span>
                    </label>
                </div>

                <button id="merge-btn" class="btn" disabled>開始合併</button>
                <button id="clear-btn" class="btn secondary-btn hidden">清空列表</button>

                <div id="status"></div>

                <div id="result-panel" class="result-panel hidden">
                    <div class="result-title">✅ 合併完成資料</div>
                    <div class="stats-row"><span class="stats-label">作品 ID:</span> <span id="res-id" class="stats-value"></span></div>
                    <div class="stats-row"><span class="stats-label">作品名稱:</span> <span id="res-title" class="stats-value"></span></div>
                    <div class="stats-row"><span class="stats-label">章節範圍:</span> <span id="res-range" class="stats-value"></span></div>
                    <div class="stats-row"><span class="stats-label">章節總數:</span> <span id="res-count" class="stats-value"></span></div>
                </div>
            </div>
        </div>
    `;

    function decodeHtml(html) {
        const txt = document.createElement("textarea");
        txt.innerHTML = html;
        return txt.value;
    }

    function escapeXml(unsafe) {
        return unsafe.replace(/[<>&"']/g, function (m) {
            switch (m) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '"': return '&quot;';
                case "'": return '&apos;';
                default: return m;
            }
        });
    }

    function basename(path) {
        return path.split('/').pop();
    }

    class EPUBMerger {
        constructor() {
            this.OPF_NS = "http://www.idpf.org/2007/opf";
            this.CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";
        }

        log(...args) {
            if (typeof debugLogging !== "undefined" && debugLogging) {
                console.log(...args);
            }
        }

        async getOpfPath(zip) {
            this.log("[EPUBMerger] Getting OPF path...");
            try {
                const containerFile = zip.file("META-INF/container.xml");
                if (!containerFile) {
                    console.warn("[EPUBMerger] META-INF/container.xml not found, falling back to default path.");
                    return "OEBPS/content.opf";
                }
                const containerXml = await containerFile.async("string");
                
                // Deterministic regex first
                const match = containerXml.match(/<rootfile[^>]+full-path=["']([^"']+)["']/);
                if (match) {
                    this.log("[EPUBMerger] OPF path found via regex: " + match[1]);
                    return match[1];
                }

                // Fallback to DOMParser
                if (typeof DOMParser !== "undefined") {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(containerXml, "text/xml");
                    const rootfile = doc.getElementsByTagNameNS(this.CONTAINER_NS, "rootfile")[0] || doc.getElementsByTagName("rootfile")[0];
                    if (rootfile && rootfile.getAttribute("full-path")) {
                        const path = rootfile.getAttribute("full-path");
                        this.log("[EPUBMerger] OPF path found via DOMParser: " + path);
                        return path;
                    }
                }
            } catch (e) {
                console.error("[EPUBMerger] Error in getOpfPath:", e);
            }
            console.warn("[EPUBMerger] OPF path detection failed, using fallback 'OEBPS/content.opf'");
            return "OEBPS/content.opf";
        }

        async extractMetadata(zip) {
            this.log("[EPUBMerger] Extracting metadata from EPUB...");
            let title = "";
            let novelId = "";
            try {
                const opfPath = await this.getOpfPath(zip);
                const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : "";
                const opfContent = await zip.file(opfPath).async("string");

                const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]*?)<\/dc:title>/);
                if (titleMatch) title = this.decodeHtml(titleMatch[1].trim());

                const sourceMatch = opfContent.match(/<dc:source[^>]*>([^<]*?)<\/dc:source>/);
                if (sourceMatch) {
                    const url = sourceMatch[1];
                    const idM = url.match(/\/novel\/([^/]+)\//);
                    if (idM) novelId = idM[1];
                }

                if (!novelId) {
                    const idMatch = opfContent.match(/<dc:identifier[^>]*>([^<]*?)<\/dc:identifier>/);
                    if (idMatch) {
                        const val = idMatch[1];
                        const idM = val.match(/uuid:(\d+)-/);
                        if (idM) novelId = idM[1];
                    }
                }

                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(opfContent, "text/xml");
                    const manifest = doc.getElementsByTagNameNS(this.OPF_NS, "manifest")[0] || doc.getElementsByTagName("manifest")[0];
                    if (manifest) {
                        const items = manifest.getElementsByTagNameNS(this.OPF_NS, "item") || manifest.getElementsByTagName("item");
                        let coverHref = "";
                        for (let i = 0; i < items.length; i++) {
                            if (items[i].getAttribute("id") === "cover") {
                                coverHref = items[i].getAttribute("href");
                                break;
                            }
                        }
                        if (coverHref) {
                            const fullCoverHref = opfDir ? `${opfDir}/${coverHref}` : coverHref;
                            const coverFile = zip.file(fullCoverHref);
                            if (coverFile) {
                                const coverContent = await coverFile.async("string");
                                const h1Match = coverContent.match(/<h1>([^<]*?)<\/h1>/);
                                if (h1Match) {
                                    const extractedTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
                                    if (extractedTitle) title = this.decodeHtml(extractedTitle);
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("[EPUBMerger] Metadata extraction internal error:", e);
                }
            } catch (e) {
                console.error("[EPUBMerger] Metadata extraction outer error:", e);
            }

            this.log("[EPUBMerger] Extracted metadata - Title:", title, "| Novel ID:", novelId);
            return { novelId, title };
        }

        async extractChapters(zip) {
            this.log("[EPUBMerger] Extracting chapters from EPUB...");
            const chapters = {};
            try {
                const opfPath = await this.getOpfPath(zip);
                const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : "";
                const opfContent = await zip.file(opfPath).async("string");

                const manifest = {};
                const spine = [];

                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(opfContent, "text/xml");

                    const manifestEl = doc.getElementsByTagNameNS(this.OPF_NS, "manifest")[0] || doc.getElementsByTagName("manifest")[0];
                    if (manifestEl) {
                        const items = manifestEl.getElementsByTagNameNS(this.OPF_NS, "item") || manifestEl.getElementsByTagName("item");
                        if (items) {
                            for (let i = 0; i < items.length; i++) {
                                const id = items[i].getAttribute("id");
                                const href = items[i].getAttribute("href");
                                if (id && href) manifest[id] = href;
                            }
                        }
                    }

                    const spineEl = doc.getElementsByTagNameNS(this.OPF_NS, "spine")[0] || doc.getElementsByTagName("spine")[0];
                    if (spineEl) {
                        const itemrefs = spineEl.getElementsByTagNameNS(this.OPF_NS, "itemref") || spineEl.getElementsByTagName("itemref");
                        if (itemrefs) {
                            for (let i = 0; i < itemrefs.length; i++) {
                                const idref = itemrefs[i].getAttribute("idref");
                                if (idref) spine.push(idref);
                            }
                        }
                    }
                } catch (e) {
                    console.error("[EPUBMerger] DOMParser error on content.opf, falling back to regex parsing:", e);
                }

                // Regex backup parser for manifest items if DOMParser failed or returned empty manifest
                if (Object.keys(manifest).length === 0) {
                    this.log("[EPUBMerger] manifest is empty, running backup regex manifest parser...");
                    const itemMatches = opfContent.matchAll(/<item\s+([^>]+)>/g);
                    for (const match of itemMatches) {
                        const attrs = match[1];
                        const idM = attrs.match(/id=["']([^"']+)["']/);
                        const hrefM = attrs.match(/href=["']([^"']+)["']/);
                        if (idM && hrefM) {
                            manifest[idM[1]] = hrefM[1];
                        }
                    }
                }

                // Regex backup parser for spine itemrefs
                if (spine.length === 0) {
                    this.log("[EPUBMerger] spine is empty, running backup regex spine parser...");
                    const itemrefMatches = opfContent.matchAll(/<itemref\s+([^>]+)>/g);
                    for (const match of itemrefMatches) {
                        const attrs = match[1];
                        const idrefM = attrs.match(/idref=["']([^"']+)["']/);
                        if (idrefM) {
                            spine.push(idrefM[1]);
                        }
                    }
                }

                for (let itemId of spine) {
                const href = manifest[itemId];
                if (!href) continue;

                if (href.endsWith('.xhtml') && href.includes('ch')) {
                    const fullHref = opfDir ? `${opfDir}/${href}` : href;
                    this.log("[EPUBMerger] Processing chapter file: " + fullHref);
                    try {
                        const chapterFile = zip.file(fullHref);
                        if (!chapterFile) {
                            console.warn("[EPUBMerger] Chapter file not found in ZIP: " + fullHref);
                            continue;
                        }
                        this.log("[EPUBMerger] Reading content of chapter: " + fullHref);
                        const content = await chapterFile.async("string");
                        this.log("[EPUBMerger] Finished reading content (length: " + content.length + ") for: " + fullHref);
                        const numMatch = content.match(/第\s*(\d+)\s*[話话]/);
                        if (numMatch) {
                            const chNum = parseInt(numMatch[1]);
                            let title = "";
                            const titleMatch = content.match(/<h1>(?:<[^>]+>|[^<])*<br\s*\/?>\s*([^<]+)<\/h1>/);
                            if (titleMatch) {
                                title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
                            } else {
                                const titleTagMatch = content.match(/<title>([^<]*?)<\/title>/);
                                if (titleTagMatch) {
                                    title = titleTagMatch[1].replace(/第\s*\d+\s*[話话]\s*/, '').trim();
                                }
                            }
                            this.log("[EPUBMerger] Matched chapter " + chNum + " | Title: " + title);
                            chapters[chNum] = { title: this.decodeHtml(title), content, href };
                        } else {
                            this.log("[EPUBMerger] No chapter number found in: " + fullHref);
                        }
                    } catch (e) {
                        console.error("[EPUBMerger] Error reading chapter file:", fullHref, e);
                    }
                }
                }
            } catch (e) {
                console.error("[EPUBMerger] Outer error in extractChapters:", e);
            }
            this.log("[EPUBMerger] Chapters extracted. Found " + Object.keys(chapters).length + " standard chapters.");
            return chapters;
        }

        decodeHtml(html) {
            const txt = document.createElement("textarea");
            txt.innerHTML = html;
            return txt.value;
        }

        escapeXml(unsafe) {
            return unsafe.replace(/[<>&"']/g, function (m) {
                switch (m) {
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '&': return '&amp;';
                    case '"': return '&quot;';
                    case "'": return '&apos;';
                    default: return m;
                }
            });
        }

        async mergeAll(fileObjects, isTranslated) {
            this.log("[EPUBMerger] Starting EPUB merge operation for " + fileObjects.length + " files...");
            if (fileObjects.length === 0) {
                console.warn("[EPUBMerger] No files to merge.");
                return null;
            }

            const allEpubData = [];
            for (let f of fileObjects) {
                try {
                    this.log("[EPUBMerger] Reading and loading EPUB file: " + f.name);
                    const zip = await JSZip.loadAsync(f);
                    const chaps = await this.extractChapters(zip);
                    const meta = await this.extractMetadata(zip);
                    allEpubData.push({
                        zip,
                        chapters: chaps,
                        meta: meta,
                        count: Object.keys(chaps).length
                    });
                } catch (e) {
                    console.error("[EPUBMerger] Error loading EPUB: " + f.name, e);
                }
            }

            if (allEpubData.length === 0) {
                console.error("[EPUBMerger] Failed to parse any valid EPUB files.");
                return null;
            }

            allEpubData.sort((a, b) => b.count - a.count);
            const baseData = allEpubData[0];
            const { novelId, title } = baseData.meta;
            this.log("[EPUBMerger] Selected Base EPUB: " + title + " (Novel ID: " + novelId + ")");

            const allChapters = {};
            for (let data of allEpubData) {
                Object.assign(allChapters, data.chapters);
            }

            const sortedChNums = Object.keys(allChapters).map(Number).sort((a, b) => a - b);
            if (sortedChNums.length === 0) {
                console.error("[EPUBMerger] No chapters found across any input EPUB files.");
                return null;
            }

            const n = sortedChNums[0];
            const m = sortedChNums[sortedChNums.length - 1];
            const count = sortedChNums.length;
            this.log("[EPUBMerger] Merging a total of " + count + " chapters, ranging from Chapter " + n + " to " + m);

            const rangeStr = n === 1 ? `ch-${m}` : `ch${n}-${m}`;
            const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
            const prefix = isTranslated ? "zh-jp.Ysgyb." : "";
            const outputFilename = `${prefix}${novelId}_${rangeStr}_${safeTitle}.epub`;
            this.log("[EPUBMerger] Target output filename: " + outputFilename);

            const outZip = new JSZip();
            // mimetype MUST be first and uncompressed
            outZip.file("mimetype", "application/epub+zip", { compression: "STORE" });
            outZip.file("META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');

            const baseZip = baseData.zip;
            const opfPath = await this.getOpfPath(baseZip);
            const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : "";

            const opfContent = await baseZip.file(opfPath).async("string");
            const parser = new DOMParser();
            const doc = parser.parseFromString(opfContent, "text/xml");
            const manifestEl = doc.getElementsByTagNameNS(this.OPF_NS, "manifest")[0] || doc.getElementsByTagName("manifest")[0];

            let coverHref = "";
            const items = manifestEl.getElementsByTagNameNS(this.OPF_NS, "item");
            for(let i=0; i<items.length; i++) {
                if (items[i].getAttribute("id") === "cover") {
                    coverHref = items[i].getAttribute("href");
                    break;
                }
            }
            const fullCoverHref = opfDir ? `${opfDir}/${coverHref}` : coverHref;

            const hasDescription = opfContent.includes('id="description"');

            // Copy other files from baseZip
            const baseFiles = Object.keys(baseZip.files);
            for (let fname of baseFiles) {
                const file = baseZip.file(fname);
                if (!file) continue; // Skip directories
                if (fname === 'mimetype' || fname === 'META-INF/container.xml' ||
                    fname.startsWith('OEBPS/ch') ||
                    fname === 'OEBPS/content.opf' || fname === 'OEBPS/toc.ncx') {
                    continue;
                }

                let content = await file.async("uint8array");
                if (fname === fullCoverHref) {
                    let text = new TextDecoder().decode(content);
                    const newRangeText = `第 ${n} — ${m} 話（共 ${count} 章）`;
                    text = text.replace(/第\s*\d+\s*[—\-\s]+\s*\d+\s*[話话]（共\s*\d+\s*章）/, newRangeText);
                    content = new TextEncoder().encode(text);
                }
                outZip.file(fname, content);
            }

            const chapterFiles = [];
            for (let chNum of sortedChNums) {
                const ch = allChapters[chNum];
                const fname = `ch${chNum.toString().padStart(5, '0')}.xhtml`;
                outZip.file(`OEBPS/${fname}`, ch.content);
                chapterFiles.push({
                    id: `ch${chNum}`,
                    href: fname,
                    title: `第 ${chNum} 話${ch.title ? '　' + ch.title : ''}`,
                    num: chNum
                });
            }

            const newOpf = this.generateOpf(novelId, title, chapterFiles, hasDescription);
            outZip.file("OEBPS/content.opf", newOpf);

            const newNcx = this.generateNcx(novelId, title, chapterFiles, hasDescription);
            outZip.file("OEBPS/toc.ncx", newNcx);

            this.log("[EPUBMerger] Generating EPUB ZIP blob...");
            const blob = await outZip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });

            const result = {
                blob,
                filename: outputFilename,
                stats: {
                    id: novelId,
                    title: title,
                    range: `${n} - ${m}`,
                    count: count
                }
            };
            this.log("[EPUBMerger] Merge completed successfully! Output filename: " + result.filename);
            return result;
        }

        generateOpf(novelId, title, chapters, hasDescription) {
            const now = new Date().toISOString().split('.')[0] + 'Z';
            const uuid = `urn:uuid:${novelId}-${Date.now()}`;

            const manifestItems = [
                '    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
                '    <item id="css" href="style.css" media-type="text/css"/>',
                '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
            ];
            if (hasDescription) {
                manifestItems.splice(1, 0, '    <item id="description" href="description.xhtml" media-type="application/xhtml+xml"/>');
            }

            for (let ch of chapters) {
                manifestItems.push(`    <item id="${this.escapeXml(ch.id)}" href="${this.escapeXml(ch.href)}" media-type="application/xhtml+xml"/>`);
            }

            const spineItems = [
                '    <itemref idref="cover"/>'
            ];
            if (hasDescription) {
                spineItems.push('    <itemref idref="description"/>');
            }
            for (let ch of chapters) {
                spineItems.push(`    <itemref idref="${this.escapeXml(ch.id)}"/>`);
            }

            return `<?xml version="1.0" encoding="utf-8"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${this.escapeXml(title)}</dc:title>
    <dc:language>ja</dc:language>
    <dc:identifier id="BookId">${this.escapeXml(uuid)}</dc:identifier>
    <dc:source>https://syosetu.org/novel/${this.escapeXml(novelId)}/</dc:source>
    <dc:date opf:event="modification">${this.escapeXml(now)}</dc:date>
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItems.join('\n')}
  </spine>
</package>`;
        }

        generateNcx(novelId, title, chapters, hasDescription) {
            const uuid = `urn:uuid:${novelId}`;

            const navPoints = [
                '    <navPoint id="cover" playOrder="1"><navLabel><text>表紙</text></navLabel><content src="cover.xhtml"/></navPoint>'
            ];
            let playOrder = 2;
            if (hasDescription) {
                navPoints.push(`    <navPoint id="description" playOrder="${playOrder}"><navLabel><text>作品描述</text></navLabel><content src="description.xhtml"/></navPoint>`);
                playOrder++;
            }

            for (let ch of chapters) {
                navPoints.push(`    <navPoint id="${this.escapeXml(ch.id)}" playOrder="${playOrder}"><navLabel><text>${this.escapeXml(ch.title)}</text></navLabel><content src="${this.escapeXml(ch.href)}"/></navPoint>`);
                playOrder++;
            }

            return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="${this.escapeXml(uuid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${this.escapeXml(title)}</text></docTitle>
  <navMap>
${navPoints.join('\n')}
  </navMap>
</ncx>`;
        }
    }

    function wireUpEvents(root) {
        const dropZone = root.getElementById('drop-zone');
        const fileInput = root.getElementById('file-input');
        const fileList = root.getElementById('file-list');
        const mergeBtn = root.getElementById('merge-btn');
        const clearBtn = root.getElementById('clear-btn');
        const transToggle = root.getElementById('translated-toggle');
        const status = root.getElementById('status');
        const resultPanel = root.getElementById('result-panel');
        const closeBtn = root.getElementById('epub-close-btn');

        let files = [];

        closeBtn.addEventListener('click', togglePanel);

        function updateUI() {
            if (files.length > 0) {
                fileList.classList.remove('hidden');
                clearBtn.classList.remove('hidden');
                mergeBtn.disabled = false;

                fileList.innerHTML = '';
                files.forEach((f, i) => {
                    const item = document.createElement('div');
                    item.className = 'file-item';
                    item.innerHTML = `<span>📄 ${f.name}</span><span class="remove-btn">✕</span>`;
                    item.querySelector('.remove-btn').addEventListener('click', () => removeFile(i));
                    fileList.appendChild(item);
                });
            } else {
                fileList.classList.add('hidden');
                clearBtn.classList.add('hidden');
                mergeBtn.disabled = true;
                fileList.innerHTML = '';
            }
        }

        function removeFile(index) {
            files.splice(index, 1);
            updateUI();
        }

        clearBtn.addEventListener('click', () => {
            files = [];
            updateUI();
            status.textContent = '';
            resultPanel.classList.add('hidden');
        });

        dropZone.addEventListener('dragover', e => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            handleFiles(e.dataTransfer.files);
        });
        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', e => handleFiles(e.target.files));

        async function handleFiles(newFiles) {
            for (let f of newFiles) {
                if (f.name.toLowerCase().endsWith('.epub')) {
                    if (!files.some(existing => existing.name === f.name && existing.size === f.size)) {
                        files.push(f);
                    }
                } else if (f.name.toLowerCase().endsWith('.zip')) {
                    try {
                        status.textContent = '⏳ 正在解壓 ZIP 檔案...';
                        status.style.color = '#a0a0a8';
                        const zip = await JSZip.loadAsync(f);
                        const entries = Object.keys(zip.files);
                        for (let entryName of entries) {
                            if (entryName.toLowerCase().endsWith('.epub')) {
                                const entryFile = zip.file(entryName);
                                if (!entryFile) continue; // skip directories
                                const epubBlob = await entryFile.async("blob");
                                epubBlob.name = entryName.split('/').pop();
                                if (!files.some(existing => existing.name === epubBlob.name)) {
                                    files.push(epubBlob);
                                }
                            }
                        }
                        status.textContent = '✅ ZIP 檔案解壓完成！';
                        status.style.color = '#63e2b7';
                    } catch (err) {
                        console.error("Error reading ZIP file:", err);
                        status.textContent = '❌ 解壓 ZIP 發生錯誤: ' + err.message;
                        status.style.color = '#e88080';
                    }
                }
            }
            updateUI();
            resultPanel.classList.add('hidden');
        }

        mergeBtn.addEventListener('click', async () => {
            if (files.length === 0) return;

            mergeBtn.disabled = true;
            status.textContent = '⏳ 自動解析與合併中...';
            status.style.color = '#a0a0a8';
            resultPanel.classList.add('hidden');

            try {
                const merger = new EPUBMerger();
                const result = await merger.mergeAll(files, transToggle.checked);

                if (result) {
                    const { blob, filename, stats } = result;

                    root.getElementById('res-id').textContent = stats.id;
                    root.getElementById('res-title').textContent = stats.title;
                    root.getElementById('res-range').textContent = stats.range;
                    root.getElementById('res-count').textContent = stats.count + ' 章';
                    resultPanel.classList.remove('hidden');

                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);

                    status.textContent = '✅ 合併成功！';
                    status.style.color = '#63e2b7';
                } else {
                    status.textContent = '❌ 合併失敗 - 未找到章節或解析錯誤';
                    status.style.color = '#e88080';
                }
            } catch (e) {
                console.error(e);
                status.textContent = '❌ 發生錯誤: ' + e.message;
                status.style.color = '#e88080';
            } finally {
                mergeBtn.disabled = false;
            }
        });
    }

    patchHistoryForRouteEvents();
    window.addEventListener('epub-merger:locationchange', onRouteChange);
    onRouteChange();
})();