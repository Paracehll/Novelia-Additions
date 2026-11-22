    Modules.wenku_dl_org = {
        init: function() {
            if (location.hostname !== NoveliaConfig.domains.main) return;

            const JP_STYLE = 'opacity:0.4;';             // 日文段落的 style
            const FETCH_MODES = ['zh-jp', 'mix'];        // 取得中日對照 epub 的 mode，依序嘗試
            const FETCH_TIMEOUT = 90000;                 // 單次下載逾時 (ms)
            const BTN_CLASS = 'novelia-wenku-org-btn';
            const PAGE_RE = /^\/wenku\/[^\/]+\/?$/i;
            const XHTML_RE = /\.(xhtml|html|htm)$/i;
            const STORED_RE = /\.(jpe?g|png|gif|webp|avif|mp3|mp4|m4a|woff2?)$/i;   // 已壓縮格式不再壓縮

            Utils.gm.addStyle(`
                a:has(+ .${BTN_CLASS}) { margin-left: auto; }
                .${BTN_CLASS} { flex: none; }
            `, 'novelia-wenku-dl-org-styles');

            // <clean>
            const normStyle = (s) => String(s || '').replace(/\s+/g, '').replace(/;+$/, '').toLowerCase();
            const JP_STYLE_NORM = normStyle(JP_STYLE);
            const P_RE = /([ \t]*)<p\b([^>]*?)(?<!\/)>([\s\S]*?)<\/p>([ \t]*\r?\n)?/gi;
            const STYLE_RE = /\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
            const MEDIA_RE = /<(?:img|svg|image|video|audio|object)\b/i;
            const isBlank = (inner) => !MEDIA_RE.test(inner)
                && inner.replace(/<br\s*\/?>|&nbsp;|&#160;|&#xa0;|<[^>]+>/gi, '').trim() === '';
            const styleOf = (attrs) => {
                const m = attrs.match(STYLE_RE);
                return m ? (m[1] ?? m[2] ?? '') : null;
            };
            function cleanXhtml(html) {
                // 整份檔案完全沒有日文段落時不動，避免誤刪未對照的內容
                let jpCount = 0;
                html.replace(P_RE, (m, lead, attrs) => {
                    const st = styleOf(attrs);
                    if (st !== null && normStyle(st) === JP_STYLE_NORM) jpCount++;
                    return m;
                });
                if (!jpCount) return { html, removed: 0, converted: 0 };

                let removed = 0, converted = 0;
                const out = html.replace(P_RE, (m, lead, attrs, inner, tail = '') => {
                    const st = styleOf(attrs);
                    if (st !== null) {
                        if (normStyle(st) !== JP_STYLE_NORM) return m;      // 其他 style：保留原樣
                        converted++;
                        return `${lead}<p${attrs.replace(STYLE_RE, '')}>${inner}</p>${tail}`;
                    }
                    if (isBlank(inner) || MEDIA_RE.test(inner)) return m;   // 空行與插圖段落保留
                    removed++;
                    return '';                                              // 無 style 的譯文段落移除
                });
                return { html: out, removed, converted };
            }
            const getFflate = () => (typeof fflate !== 'undefined' ? fflate
                : (typeof unsafeWindow !== 'undefined' ? unsafeWindow.fflate : undefined));

            // 讀取 response，有 Content-Length 時回報 0~1 的下載進度
            async function readBody(res, onFrac) {
                const total = Number(res.headers.get('content-length')) || 0;
                if (!res.body || !res.body.getReader || !total) {
                    const buf = new Uint8Array(await res.arrayBuffer());
                    onFrac(1);
                    return buf;
                }
                const reader = res.body.getReader();
                const chunks = [];
                let got = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    got += value.length;
                    onFrac(Math.min(1, got / total));
                }
                const buf = new Uint8Array(got);
                let off = 0;
                for (const c of chunks) { buf.set(c, off); off += c.length; }
                return buf;
            }
            const tick = () => new Promise((r) => setTimeout(r, 0));   // 讓出執行緒，讓按鈕文字有機會重繪

            async function fetchEpub(href, onFrac = () => {}) {
                let lastErr = null;
                for (const mode of FETCH_MODES) {
                    const url = new URL(href, location.origin);
                    url.searchParams.set('mode', mode);
                    const ctrl = new AbortController();
                    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
                    try {
                        console.info(`[Novelia QOL] wenku_dl_org: fetching (mode=${mode})`);
                        const res = await fetch(url.href, { credentials: 'same-origin', signal: ctrl.signal });
                        if (!res.ok) { lastErr = new Error(`HTTP ${res.status} (mode=${mode})`); continue; }
                        return await readBody(res, onFrac);
                    } catch (e) {
                        lastErr = e && e.name === 'AbortError' ? new Error(`timeout (mode=${mode})`) : e;
                    } finally {
                        clearTimeout(timer);
                    }
                }
                throw lastErr || new Error('fetch failed');
            }
            // 進度分配：下載 0~60%、解壓 60~65%、逐檔清理 65~95%、打包 95~100%
            async function buildOriginalEpub(href, onProgress = () => {}) {
                const F = getFflate();
                if (!F) throw new Error('fflate 未載入，請確認 @require');

                let last = -1;
                const report = (p) => {                                // 只增不減，且整數變動才回報
                    const n = Math.max(last, Math.min(100, Math.floor(p)));
                    if (n !== last) { last = n; onProgress(n); }
                };
                report(0);
                const raw = await fetchEpub(href, (f) => report(f * 60));
                report(60);
                await tick();

                const files = F.unzipSync(raw);                        // 同步版：不依賴 setImmediate / Worker
                report(65);
                const names = Object.keys(files).filter((n) => !n.endsWith('/'));
                // epub 規範：mimetype 必須是第一個檔案且不壓縮
                names.sort((a, b) => (a === 'mimetype' ? -1 : 0) - (b === 'mimetype' ? -1 : 0));

                let removed = 0, converted = 0;
                const out = {};
                for (let i = 0; i < names.length; i++) {
                    const name = names[i];
                    report(65 + (i / names.length) * 30);
                    if (i % 5 === 0) await tick();
                    let data = files[name];
                    if (XHTML_RE.test(name)) {
                        const r = cleanXhtml(F.strFromU8(data));
                        if (r.removed || r.converted) {
                            removed += r.removed;
                            converted += r.converted;
                            data = F.strToU8(r.html);
                        }
                    }
                    out[name] = [data, { level: (name === 'mimetype' || STORED_RE.test(name)) ? 0 : 6 }];
                }
                console.info(`[Novelia QOL] wenku_dl_org: 移除 ${removed} 段譯文，轉換 ${converted} 段原文`);

                report(95);
                await tick();
                const blob = new Blob([F.zipSync(out)], { type: 'application/epub+zip' });
                report(100);
                return blob;
            }
            function saveBlob(blob, filename) {
                const url = URL.createObjectURL(blob);
                const a = Object.assign(document.createElement('a'), { href: url, download: filename });
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            }
            function getFilename(anchor) {
                const raw = anchor.getAttribute('download') || 'novel.epub';
                return 'jp.' + raw.replace(/^zh\.(?:[A-Za-z]+\.)?/, '');
            }
            function createOrgButton(anchor) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `${anchor.className} ${BTN_CLASS}`;
                btn.title = '下載原文（移除譯文，只保留日文）';

                const svg = anchor.querySelector('svg');
                if (svg) btn.appendChild(svg.cloneNode(true));
                const label = document.createElement('span');
                label.textContent = '原文';
                btn.appendChild(label);

                btn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (btn.disabled) return;
                    btn.disabled = true;
                    label.textContent = '0%';
                    try {
                        const blob = await buildOriginalEpub(anchor.getAttribute('href'), (n) => { label.textContent = `${n}%`; });
                        saveBlob(blob, getFilename(anchor));
                        label.textContent = '原文';
                    } catch (err) {
                        console.error('[Novelia QOL] wenku_dl_org failed:', err);
                        label.textContent = '⚠️ 失敗';
                        setTimeout(() => { label.textContent = '原文'; }, 2000);
                    } finally {
                        btn.disabled = false;
                    }
                });
                return btn;
            }
            function scan() {
                if (!PAGE_RE.test(Utils.router.getPathname())) {
                    document.querySelectorAll(`.${BTN_CLASS}`).forEach((b) => b.remove());
                    return;
                }
                document.querySelectorAll('a[download][href*="/api/wenku/"][href*="/file/"]').forEach((a) => {
                    if (a.nextElementSibling && a.nextElementSibling.classList.contains(BTN_CLASS)) return;
                    a.after(createOrgButton(a));
                });
            }

            let timer = null;
            const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 150); };
            new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
            Utils.router.onChange(() => setTimeout(schedule, 200));
            scan();
        }
    };