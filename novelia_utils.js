// ==UserScript==
// @name         Novelia Utils
// @namespace    novelia-utils
// @version      1.8.0
// @description  Novelia 工具函式庫 (DOMAINS & Utils)
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    const root = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    const DOMAINS = {
        HOST: 'n.novelia.cc',
        FORUM: 'forum.novelia.cc',
        CDN: 'n-cdn.novelia.cc'
    };

    const DAY = 24 * 60 * 60 * 1000;

    const attempt = (fn, fallback, label) => {
        try { return fn(); } catch (e) {
            if (label) console.error(label, e);
            return fallback;
        }
    };

    const createDisposer = () => {
        const fns = [];
        return {
            add(un) { if (un) fns.push(un); return un; },
            run() { fns.splice(0).forEach((un) => attempt(un)); }
        };
    };

    const isPlainClick = (e) => !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || (e.button !== undefined && e.button !== 0));

    const emit = (name) => window.dispatchEvent(new Event(name));

    const gm = {
        addStyle(css, id) {
            const existing = id && document.getElementById(id);
            if (existing) return existing;
            if (typeof GM_addStyle === 'function') {
                const style = GM_addStyle(css);
                if (id && style && style.id !== undefined) style.id = id;
                return style;
            }
            const style = document.createElement('style');
            if (id) style.id = id;
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
            return style;
        },
        getValue(key, defaultValue) {
            return typeof GM_getValue === 'function' ? GM_getValue(key, defaultValue) : defaultValue;
        },
        setValue(key, value) { if (typeof GM_setValue === 'function') GM_setValue(key, value); },
        registerMenuCommand(label, fn) { if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(label, fn); },
        setClipboard(text) {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text);
                return Promise.resolve(true);
            }
            if (navigator.clipboard) {
                return navigator.clipboard.writeText(text).then(() => true, () => false);
            }
            return Promise.resolve(false);
        }
    };

    const makeEscaper = (aposEntity) => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": aposEntity };
        return (str) => (str ? String(str).replace(/[&<>"']/g, (c) => map[c]) : '');
    };

    const str = {
        escapeHtml: makeEscaper('&#039;'),
        escapeXml: makeEscaper('&apos;'),
        truncate(s, length, suffix = '...') {
            if (!s) return '';
            const v = String(s);
            return v.length <= length ? v : v.slice(0, length) + suffix;
        }
    };

    const ls = {
        get(key, defaultValue = {}) {
            return attempt(() => {
                const raw = localStorage.getItem(key);
                return raw !== null ? JSON.parse(raw) : defaultValue;
            }, defaultValue);
        },
        set(key, value) {
            return attempt(() => { localStorage.setItem(key, JSON.stringify(value)); return true; }, false, `[Utils.ls] Failed to set ${key}:`);
        },
        getRaw(key, defaultValue = null) {
            return attempt(() => {
                const raw = localStorage.getItem(key);
                return raw !== null ? raw : defaultValue;
            }, defaultValue);
        },
        setRaw(key, value) {
            return attempt(() => { localStorage.setItem(key, String(value)); return true; }, false, `[Utils.ls] Failed to setRaw ${key}:`);
        },
        remove(key) {
            return attempt(() => { localStorage.removeItem(key); return true; }, false, `[Utils.ls] Failed to remove ${key}:`);
        },
        clear() {
            return attempt(() => { localStorage.clear(); return true; }, false, '[Utils.ls] Failed to clear ls:');
        },
        has(key) {
            return attempt(() => localStorage.getItem(key) !== null, false);
        },
        keys() {
            return attempt(() => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) => k !== null), []);
        }
    };

    const IDB_DEFAULTS = { dbName: 'novelia_qol_db', version: 1, storeName: 'cache_store', keyPath: 'key' };
    const IDB_DEFAULT_STORES = ['cache_store', 'preview_cache', 'network_cache'];

    const idb = {
        _conns: new Map(),

        openDatabase(dbName = IDB_DEFAULTS.dbName, version = 1, storeNames = IDB_DEFAULT_STORES, keyPath = 'key') {
            return new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB not supported'));
                const stores = new Set([...IDB_DEFAULT_STORES, ...(Array.isArray(storeNames) ? storeNames : [storeNames])]);
                const request = indexedDB.open(dbName, version);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    stores.forEach((name) => {
                        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
                    });
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        },

        _connect(o) {
            const id = `${o.dbName}@${o.version}`;
            if (!idb._conns.has(id)) {
                const p = idb.openDatabase(o.dbName, o.version, [o.storeName], o.keyPath).then((db) => {
                    db.onversionchange = () => { db.close(); idb._conns.delete(id); };
                    return db;
                });
                p.catch(() => idb._conns.delete(id));
                idb._conns.set(id, p);
            }
            return idb._conns.get(id);
        },
        async _run(mode, action, opts, fallback) {
            const o = { ...IDB_DEFAULTS, ...opts };
            try {
                const db = await idb._connect(o);
                return await new Promise((resolve) => {
                    action(db.transaction(o.storeName, mode).objectStore(o.storeName), resolve, o);
                });
            } catch (e) {
                idb._conns.delete(`${o.dbName}@${o.version}`);
                return fallback;
            }
        },
        _req(req, resolve, onOk, onFail) {
            req.onsuccess = () => resolve(onOk(req.result));
            req.onerror = () => resolve(onFail);
        },
        get(key, opts) { return idb._run('readonly', (s, res) => idb._req(s.get(key), res, (r) => r || null, null), opts, null) },
        set(record, opts) { return idb._run('readwrite', (s, res) => idb._req(s.put(record), res, () => true, false), opts, false) },
        delete(key, opts) { return idb._run('readwrite', (s, res) => idb._req(s.delete(key), res, () => true, false), opts, false) },
        clear(opts) { return idb._run('readwrite', (s, res) => idb._req(s.clear(), res, () => true, false), opts, false) },
        getAll(opts) { return idb._run('readonly', (s, res) => idb._req(s.getAll(), res, (r) => r || [], []), opts, []) },
        checkIDbExpire(key, { ttlMs = DAY, ...opts } = {}) {
            const EXPIRED = { expired: true, record: null };
            return idb._run('readwrite', (store, resolve) => {
                const req = store.get(key);
                req.onerror = () => resolve(EXPIRED);
                req.onsuccess = () => {
                    const record = req.result;
                    if (!record) return resolve(EXPIRED);
                    const ts = record.timestamp || record.updatedAt || record.createAt || 0;
                    if (Date.now() - ts >= ttlMs) {
                        store.delete(key);
                        return resolve(EXPIRED);
                    }
                    resolve({ expired: false, record });
                };
            }, opts, EXPIRED);
        },
        async checkIDbExpireAndGet(key, opts = {}) {
            const { expired, record } = await idb.checkIDbExpire(key, opts);
            if (expired || !record) return null;
            return record.data !== undefined ? record.data : record;
        }
    };

    const cache = {
        get: (key, defaultValue = null) => ls.get(key, defaultValue),
        set: (key, value) => ls.set(key, value),
        remove: (key) => ls.remove(key),
        clear: () => ls.clear(),
        getIDB: (key, opts = {}) => idb.checkIDbExpireAndGet(key, opts),
        setIDB(key, data, opts = {}) {
            const { keyPath = IDB_DEFAULTS.keyPath } = opts;
            return idb.set({ [keyPath]: key, data, timestamp: Date.now() }, opts);
        },
        removeIDB: (key, opts = {}) => idb.delete(key, opts),
        clearIDB: (opts = {}) => idb.clear(opts)
    };

    const HOOK_KEYS = ['before', 'after', 'around', 'instead', 'getter', 'setter'];

    const callHook = (hook, kind, thisArg, ctx, prop) => {
        try { hook[kind].call(thisArg, ctx); } catch (e) {
            console.error(`[Utils.patcher] Error in ${kind} hook for ${String(prop)}:`, e);
        }
    };

    const patcher = {
        _patches: new Map(),

        _getOrCreateState(target, prop) {
            let targetMap = this._patches.get(target);
            if (!targetMap) this._patches.set(target, (targetMap = new Map()));
            let state = targetMap.get(prop);
            if (!state) {
                const desc = attempt(() => Object.getOwnPropertyDescriptor(target, prop), null) || {};
                const isAccessor = !!(desc.get || desc.set);
                const raw = isAccessor ? undefined : attempt(() => (desc.value !== undefined ? desc.value : target[prop]));
                const isMethod = typeof raw === 'function';
                state = {
                    target, prop,
                    original: isMethod ? raw : undefined,
                    originalDesc: desc,
                    hooks: [],
                    type: isMethod ? 'method' : 'property',
                    propertyPatched: false,
                    wrapper: undefined
                };
                targetMap.set(prop, state);
            }
            return state;
        },
        patch(target, prop, optionsOrFn) {
            if (!target || !prop) return null;
            const opts = typeof optionsOrFn === 'function' ? { instead: optionsOrFn } : (optionsOrFn || {});
            const state = this._getOrCreateState(target, prop);

            const hook = { id: Symbol('patch_hook'), once: !!opts.once };
            HOOK_KEYS.forEach((k) => { hook[k] = typeof opts[k] === 'function' ? opts[k] : null; });
            state.hooks.push(hook);

            if (state.type === 'method' && target[prop] !== state.wrapper) {
                this._wrapMethod(target, prop, state);
            } else if (state.type === 'property' || opts.getter || opts.setter) {
                this._applyPropertyPatch(target, prop, state);
            }

            const unpatchFn = () => this.unpatch(target, prop, hook.id);
            unpatchFn.unpatch = unpatchFn;
            unpatchFn.restore = unpatchFn;
            return unpatchFn;
        },
        _wrapMethod(target, prop, state) {
            const self = this;
            const origFn = state.original;
            const lastOf = (hooks, k) => hooks.slice().reverse().find((h) => h[k]);

            const wrapper = function (...args) {
                const ctx = {
                    target, prop, thisArg: this,
                    args: [...args], result: undefined, cancelled: false, error: null,
                    cancel(val) { this.cancelled = true; if (val !== undefined) this.result = val; }
                };
                const hooks = [...state.hooks];

                for (const h of hooks) {
                    if (!h.before) continue;
                    callHook(h, 'before', this, ctx, prop);
                    if (h.once) self.unpatch(target, prop, h.id);
                    if (ctx.cancelled) break;
                }
                if (!ctx.cancelled) {
                    const instead = lastOf(hooks, 'instead');
                    const around = lastOf(hooks, 'around');
                    try {
                        if (instead) {
                            ctx.result = instead.instead.call(this, ctx, origFn ? origFn.bind(this) : null);
                            if (instead.once) self.unpatch(target, prop, instead.id);
                        } else if (around) {
                            const proceed = (...a) => (origFn ? origFn.apply(this, a.length ? a : ctx.args) : undefined);
                            ctx.result = around.around.call(this, ctx, proceed);
                            if (around.once) self.unpatch(target, prop, around.id);
                        } else if (origFn) {
                            ctx.result = origFn.apply(this, ctx.args);
                        }
                    } catch (err) { ctx.error = err; }
                }
                for (const h of hooks) {
                    if (!h.after) continue;
                    callHook(h, 'after', this, ctx, prop);
                    if (h.once) self.unpatch(target, prop, h.id);
                }
                if (ctx.error) throw ctx.error;
                return ctx.result;
            };

            wrapper.__isPatched = true;
            wrapper.__original = origFn;
            state.wrapper = wrapper;
            target[prop] = wrapper;
        },
        _applyPropertyPatch(target, prop, state) {
            if (state.propertyPatched) return;
            state.propertyPatched = true;

            let origDesc = state.originalDesc;
            if (!origDesc || (!origDesc.get && !origDesc.set && !('value' in origDesc))) {
                origDesc = attempt(() => Object.getOwnPropertyDescriptor(target, prop), null)
                    || { configurable: true, writable: true, value: attempt(() => target[prop]) };
            }
            let currentValue = origDesc.value;

            Object.defineProperty(target, prop, {
                configurable: true,
                enumerable: origDesc.enumerable !== undefined ? origDesc.enumerable : true,
                get() {
                    const value = origDesc.get ? origDesc.get.call(this) : currentValue;
                    const ctx = {
                        target, prop, thisArg: this, value, result: value, cancelled: false,
                        cancel(val) { this.cancelled = true; if (val !== undefined) this.result = val; }
                    };
                    [...state.hooks].forEach((h) => { if (h.getter) callHook(h, 'getter', this, ctx, prop); });
                    return ctx.result;
                },
                set(val) {
                    const ctx = { target, prop, thisArg: this, value: val, cancelled: false, cancel() { this.cancelled = true; } };
                    [...state.hooks].forEach((h) => { if (h.setter) callHook(h, 'setter', this, ctx, prop); });
                    if (ctx.cancelled) return;
                    if (origDesc.set) origDesc.set.call(this, ctx.value);
                    else currentValue = ctx.value;
                }
            });
        },

        before: (t, p, fn, o = {}) => patcher.patch(t, p, { before: fn, ...o }),
        after: (t, p, fn, o = {}) => patcher.patch(t, p, { after: fn, ...o }),
        around: (t, p, fn, o = {}) => patcher.patch(t, p, { around: fn, ...o }),
        instead: (t, p, fn, o = {}) => patcher.patch(t, p, { instead: fn, ...o }),
        patchGetter: (t, p, fn, o = {}) => patcher.patch(t, p, { getter: fn, ...o }),
        patchSetter: (t, p, fn, o = {}) => patcher.patch(t, p, { setter: fn, ...o }),
        patchProperty: (t, p, o = {}) => patcher.patch(t, p, o),

        unpatch(target, prop, hookIdOrFn) {
            const state = this._patches.get(target)?.get(prop);
            if (!state) return false;
            if (!hookIdOrFn) return this.restore(target, prop);

            const before = state.hooks.length;
            state.hooks = state.hooks.filter((h) => h.id !== hookIdOrFn && !HOOK_KEYS.some((k) => h[k] === hookIdOrFn));
            if (state.hooks.length === 0) this.restore(target, prop);
            return state.hooks.length < before;
        },
        restore(target, prop) {
            const targetMap = this._patches.get(target);
            const state = targetMap?.get(prop);
            if (!state) return false;

            if (state.type === 'method' && state.original) {
                target[prop] = state.original;
            } else if (state.originalDesc && Object.keys(state.originalDesc).length) {
                attempt(() => Object.defineProperty(target, prop, state.originalDesc), null)
                    ?? attempt(() => { target[prop] = state.originalDesc.value; });
            } else {
                attempt(() => { delete target[prop]; });
            }

            targetMap.delete(prop);
            if (targetMap.size === 0) this._patches.delete(target);
            return true;
        },
        restoreAll() {
            for (const [target, map] of Array.from(this._patches)) {
                for (const prop of Array.from(map.keys())) this.restore(target, prop);
            }
            this._patches.clear();
        },
        isPatched(target, prop) {
            const state = this._patches.get(target)?.get(prop);
            return !!(state && state.hooks.length > 0);
        },
        getOriginal(target, prop) {
            const state = this._patches.get(target)?.get(prop);
            if (state) return state.original;
            if (target?.[prop]?.__original) return target[prop].__original;
            return target ? target[prop] : undefined;
        }
    };

    const network = {
        _intercepted: false,
        _rules: [],
        _d: createDisposer(),
        _xhrUrls: new WeakMap(),
        DB_NAME: 'novelia_qol_db',
        DB_VERSION: 1,
        STORE_NAME: 'network_cache',
        TTL_MS: DAY,
        BLANK_GIF: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        IMG_EXT_RE: /\.(webp|png|jpe?g|gif|svg|avif|bmp|ico)$/i,

        _resolveDomain(domain) {
            if (!domain) return '';
            const s = String(domain);
            return DOMAINS[s.toUpperCase()] || s;
        },
        _parseUrl(urlStr) { return attempt(() => new URL(urlStr, location.origin), null); },
        _dbOpts() { return { dbName: this.DB_NAME, version: this.DB_VERSION, storeName: this.STORE_NAME, ttlMs: this.TTL_MS }; },
        _unwrap(record) { return record.data !== undefined ? record.data : record; },
        _saveToCache(cacheKey, data, meta = {}) {
            return idb.set({ key: cacheKey, data, timestamp: Date.now(), ...meta }, this._dbOpts());
        },
        async getCached(queryKey) {
            if (!queryKey) return null;
            const opts = this._dbOpts();
            const direct = await idb.checkIDbExpire(queryKey, opts);
            if (!direct.expired && direct.record) return this._unwrap(direct.record);

            for (const r of await idb.getAll(opts)) {
                const k = r.key || '';
                const hit = k.includes(queryKey) || (k && queryKey.includes(k)) || r.capturedPrefix?.includes(queryKey);
                if (!hit) continue;
                const res = await idb.checkIDbExpire(k, opts);
                if (!res.expired && res.record) return this._unwrap(res.record);
            }
            return null;
        },
        capture({ key, domain, onCapture } = {}) {
            if (!key) return;
            this._rules.push({ action: 'capture', key, domain: this._resolveDomain(domain), onCapture });
            this.initInterception();
        },
        intercept(opts) { return this.capture(opts); },

        reject(keyOrOptions, domain) {
            const opts = typeof keyOrOptions === 'string' ? { key: keyOrOptions, domain } : (keyOrOptions || {});
            const rule = { isImage: true, ...opts, action: 'reject' };
            let key = rule.key || rule.url || '';
            let host = this._resolveDomain(rule.domain);
            if (!host && /^https?:/i.test(key)) {
                const u = this._parseUrl(key);
                if (u) { host = u.hostname; key = u.pathname + u.search; }
            }
            rule.domain = host;
            rule.key = key.replace(/\*+$/, ''); // '' 代表全部符合
            this._rules.push(rule);
            this.initInterception();
            return rule;
        },
        _matchCaptures(urlStr) {
            const u = this._parseUrl(urlStr);
            if (!u) return [];
            const base = u.origin + u.pathname;
            const hits = [];
            for (const rule of this._rules) {
                if (rule.action !== 'capture') continue;
                if (rule.domain && u.hostname !== rule.domain) continue;
                const idx = base.indexOf(rule.key);
                if (idx === -1) continue;
                const prefix = base.slice(0, idx + rule.key.length);
                hits.push({ rule, cacheKey: prefix, capturedPrefix: prefix, url: u.href });
            }
            return hits;
        },
        async _storeCaptures(hits, rawText) {
            const data = attempt(() => JSON.parse(rawText), rawText);
            for (const { rule, cacheKey, capturedPrefix, url } of hits) {
                await this._saveToCache(cacheKey, data, { url, capturedPrefix, key: rule.key, domain: rule.domain });
                attempt(() => rule.onCapture?.({ cacheKey, data, url, capturedPrefix }));
            }
        },
        _isRejected(urlStr, ctx) {
            const u = this._parseUrl(urlStr);
            if (!u) return false;
            for (const rule of this._rules) {
                if (rule.action !== 'reject') continue;
                if (rule.domain && u.hostname !== rule.domain) continue;
                if (rule.key && !(u.origin + u.pathname).includes(rule.key)) continue;
                if (rule.isImage) {
                    const isImg = this.IMG_EXT_RE.test(u.pathname)
                        || ctx?.destination === 'image'
                        || String(ctx?.headers?.accept || '').includes('image')
                        || u.pathname.includes('/banners/');
                    if (!isImg) continue;
                }
                attempt(() => rule.onReject?.({ url: urlStr, rule }));
                return true;
            }
            return false;
        },
        initInterception() {
            if (this._intercepted) return;
            this._intercepted = true;
            ['_patchFetch', '_patchXhr', '_patchGM', '_patchImage', '_observeImages'].forEach((name) => {
                attempt(() => this[name](), null, `[Utils.network] ${name} failed:`);
            });
        },
        destroy() {
            this._d.run();
            this._intercepted = false;
        },
        _fetchCtx(input, init) {
            const h = init?.headers || input?.headers;
            const accept = h && typeof h.get === 'function' ? h.get('accept') : (h?.accept || h?.Accept);
            return { destination: input?.destination, headers: { accept } };
        },
        _patchFetch() {
            if (!root || typeof root.fetch !== 'function') return;
            const self = this;
            const urlOf = (input) => input?.url || String(input ?? '');

            this._d.add(patcher.before(root, 'fetch', function (ctx) {
                const [input, init] = ctx.args;
                const url = urlOf(input);
                if (self._isRejected(url, self._fetchCtx(input, init))) {
                    ctx.cancel(Promise.reject(new TypeError(`Failed to fetch: blocked by Utils.network (${url})`)));
                }
            }));

            this._d.add(patcher.after(root, 'fetch', function (ctx) {
                if (ctx.cancelled || typeof ctx.result?.then !== 'function') return;
                const hits = self._matchCaptures(urlOf(ctx.args[0]));
                if (!hits.length) return;
                ctx.result
                    .then((res) => (res.ok ? res.clone().text() : null))
                    .then((text) => (text !== null ? self._storeCaptures(hits, text) : undefined))
                    .catch(() => {});
            }));
        },
        _patchXhr() {
            const proto = root?.XMLHttpRequest?.prototype;
            if (!proto) return;
            const self = this;

            this._d.add(patcher.before(proto, 'open', function (ctx) {
                self._xhrUrls.set(this, String(ctx.args[1]));
            }));

            this._d.add(patcher.before(proto, 'send', function (ctx) {
                const url = self._xhrUrls.get(this);
                if (!url) return;
                if (self._isRejected(url)) {
                    ctx.cancel();
                    setTimeout(() => {
                        this.dispatchEvent(new ProgressEvent('error'));
                        this.dispatchEvent(new ProgressEvent('loadend'));
                    }, 0);
                    return;
                }
                const hits = self._matchCaptures(url);
                if (hits.length) {
                    this.addEventListener('load', () => attempt(() => self._storeCaptures(hits, this.responseText)), { once: true });
                }
            }));
        },
        _patchGM() {
            if (typeof GM_xmlhttpRequest !== 'function') return;
            const self = this;
            const candidates = [root, typeof globalThis !== 'undefined' ? globalThis : null, typeof window !== 'undefined' ? window : null];
            const target = candidates.find((t) => attempt(() => t && typeof t.GM_xmlhttpRequest === 'function', false));
            if (!target) return;

            this._d.add(patcher.before(target, 'GM_xmlhttpRequest', function (ctx) {
                const details = ctx.args[0];
                if (details?.url && self._isRejected(details.url)) {
                    ctx.cancel({ abort() {} });
                    setTimeout(() => details.onerror?.({ status: 0, statusText: 'Blocked by Utils.network' }), 0);
                }
            }));
        },
        _patchImage() {
            const self = this;
            const imgProto = root?.HTMLImageElement?.prototype;
            if (imgProto) {
                this._d.add(patcher.patchSetter(imgProto, 'src', function (ctx) {
                    if (ctx.value && self._isRejected(String(ctx.value))) ctx.value = self.BLANK_GIF;
                }));
            }
            const elProto = root?.Element?.prototype;
            if (elProto) {
                this._d.add(patcher.before(elProto, 'setAttribute', function (ctx) {
                    if (this.tagName !== 'IMG' || String(ctx.args[0]).toLowerCase() !== 'src') return;
                    if (self._isRejected(String(ctx.args[1]))) ctx.args[1] = self.BLANK_GIF;
                }));
            }
        },
        _observeImages() {
            if (typeof MutationObserver === 'undefined' || !document?.documentElement) return;
            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    const imgs = n.tagName === 'IMG' ? [n] : n.querySelectorAll('img[src]');
                    for (const img of imgs) {
                        if (img.src && this._isRejected(img.src)) img.removeAttribute('src');
                    }
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            this._d.add(() => observer.disconnect());
        }
    };

    const icon14 = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;">${inner}</svg>`;
    const mdIcon = (size, path) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${path}" fill="currentColor"></path></svg>`;
    const POPOUT_PATH = 'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83l1.41 1.41L19 6.41V10h2V3h-7z';

    const svg = {
        REFRESH: icon14('<polyline points="23 4 23 10 18 10"></polyline><polyline points="1 20 1 14 6 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>'),
        BULK: icon14('<rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>'),
        CLEAR: icon14('<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>'),
        VIEW: icon14('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>'),
        CHEVRON: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"></path></svg>',
        DRAWER: mdIcon(24, 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z'),
        POPOUT: mdIcon(20, POPOUT_PATH),
        RELOAD_CIRCLE: mdIcon(20, 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z'),
        STAR_OUTLINE: mdIcon(20, 'M22 9.24l-7.19-.62L12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21L12 17.27L18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27l1-4.28l-3.32-2.88l4.38-.38L12 6.1l1.71 4.04l4.38.38l-3.32 2.88l1 4.28L12 15.4z')
    };

    const LIST_PREFIXES = ['/novel', '/favorite', '/wenku', '/search', '/read-history'];

    const route = {
        _initDone: false,

        init() {
            if (this._initDone) return;
            this._initDone = true;
            ['pushState', 'replaceState'].forEach((m) => patcher.after(root.history, m, () => emit('tm-locationchange')));
            window.addEventListener('popstate', () => emit('tm-locationchange'));
        },

        getRouter() {
            return attempt(() => {
                const appEl = document.querySelector('#app') || document.querySelector('[data-v-app]');
                const app = appEl?.__vue_app__;
                const direct = [
                    app?.config?.globalProperties?.$router,
                    appEl?._vnode?.component?.proxy?.$router,
                    app?._instance?.proxy?.$router
                ].find(Boolean);
                if (direct) return direct;

                const provides = app?._context?.provides;
                if (provides) {
                    for (const key of [...Object.getOwnPropertySymbols(provides), ...Object.keys(provides)]) {
                        const val = provides[key];
                        if (val && typeof val.push === 'function' && (val.currentRoute || val.options)) return val;
                    }
                }
                return root.__vue_app__?.config?.globalProperties?.$router
                    || (typeof root.router?.push === 'function' ? root.router : null);
            }, null);
        },

        push(path) {
            if (!path) return;
            const fallback = () => {
                if (route.getPath() !== path) {
                    history.pushState({}, '', path);
                    emit('popstate');
                }
            };

            if (route.isForumPage() && route.isForumUrl(path)) {
                if (route.getPath() !== path) history.pushState({}, '', path);
                emit('tm-locationchange');
                return;
            }

            const router = this.getRouter();
            if (router && typeof router.push === 'function') {
                try {
                    const res = router.push(path);
                    if (res && typeof res.catch === 'function') res.catch(fallback);
                } catch (e) { history.pushState({}, '', path); emit('popstate'); }
            } else {
                history.pushState({}, '', path);
                emit('popstate');
            }
            emit('tm-locationchange');
        },

        getPath() { return root.__noveliaMockPath || (location.pathname + location.search + location.hash); },
        _cleanPath() { return route.getPath().split('?')[0].split('#')[0]; },

        matchNovelPath(pathname) {
            const novel = pathname.match(/^\/novel\/([^\/?#]+)\/([^\/?#]+)\/?$/i);
            if (novel) return { source: novel[1], id: novel[2] };
            const wenku = pathname.match(/^\/wenku\/([^\/?#]+)\/?$/i);
            return wenku ? { source: 'wenku', id: wenku[1] } : null;
        },
        isForumPage() {
            const p = route.getPath();
            return p === '/forum' || p.startsWith('/forum/') || p.startsWith('/forum?');
        },
        isForumUrl(href) {
            if (!href) return false;
            try {
                const u = new URL(href, location.origin);
                return u.hostname === DOMAINS.FORUM
                    || (u.hostname === location.hostname && (u.pathname === '/forum' || u.pathname.startsWith('/forum/')));
            } catch (e) {
                return new RegExp('^https?:\\/\\/' + DOMAINS.FORUM.replace(/\./g, '\\.'), 'i').test(href)
                    || href === '/forum' || href.startsWith('/forum/');
            }
        },
        /** 列表型頁面（排除 /novel/:src/:id/:chapter 等 3 段以上路徑） */
        isCommentCountPage() {
            const p = route._cleanPath();
            if (/^\/novel\/[^\/]+\/[^\/]+\/[^\/]+/i.test(p)) return false;
            return p === '/' || LIST_PREFIXES.some((pre) => p.startsWith(pre));
        },
        /** 同上，但再排除小說詳情頁 /novel/:src/:id */
        isSharePage() {
            return route.isCommentCountPage() && !/^\/novel\/[^\/]+\/[^\/]+\/?$/.test(route._cleanPath());
        },
        isCommentNotifyPage() {
            const p = route._cleanPath();
            const host = location.hostname;
            if (host === DOMAINS.HOST) {
                return /^\/novel\/[^\/]+\/[^\/]+\/?$/i.test(p)
                    || /^\/wenku\/[^\/]+\/?$/i.test(p)
                    || /^\/forum\/p\/[^\/]+\/?$/i.test(p);
            }
            return host === DOMAINS.FORUM && /^\/p\/[^\/]+\/?$/i.test(p);
        },
        onChange(callback) {
            this.init();
            ['popstate', 'hashchange', 'tm-locationchange'].forEach((ev) => window.addEventListener(ev, callback));
        }
    };

    const SIDEBAR_SEL = '.web-kit-sidebar, .sidebar-shell, .n-layout-sider, .n-layout-sidebar, aside';
    const MENU_ITEM_SEL = '.web-kit-sidebar-item, .n-menu-item, [role="menuitem"]';
    const NON_SIDEBAR_SEL = 'header, .n-layout-header, main, .n-layout-content, .layout-content, .novel-page-content, #banner, .n-card, .n-grid, .n-breadcrumb, [aria-label*="Breadcrumb"], [aria-label*="面包屑"]';
    const SIDEBAR_CONTAINER_SEL = 'aside, .web-kit-sidebar, .sidebar-shell, .n-layout-sider, .n-layout-sidebar, .n-menu, .n-drawer, nav[aria-label="站点导航"], nav[aria-label="站點導航"], nav[aria-label="侧边栏"], nav[aria-label="側邊欄"]';
    const INJECT_MODES = { replace: 'replaceWith', before: 'before', after: 'after', append: 'appendChild', prepend: 'prepend' };

    const sidebar = {
        get() { return document.querySelector(SIDEBAR_SEL); },

        isMenuItem(a) {
            if (!a) return false;
            if (!a.closest('.n-drawer') && a.closest(NON_SIDEBAR_SEL)) return false;
            return !!(a.closest(MENU_ITEM_SEL) || a.closest(SIDEBAR_CONTAINER_SEL));
        },
        getButtons(container = null) {
            const rootEl = container || sidebar.get() || document.querySelector('.n-drawer');
            if (!rootEl) return [];

            const items = [];
            const seen = new Set();
            for (const rawEl of rootEl.querySelectorAll(`${MENU_ITEM_SEL}, a[href], button`)) {
                if (!container && !sidebar.isMenuItem(rawEl)) continue;
                const menuEl = rawEl.closest(MENU_ITEM_SEL) || rawEl;
                if (seen.has(menuEl)) continue;
                seen.add(menuEl);

                const anchor = menuEl.tagName === 'A' ? menuEl : menuEl.querySelector('a[href]');
                items.push({
                    name: menuEl.textContent.trim(),
                    href: anchor ? (anchor.getAttribute('href') || anchor.href || '') : (menuEl.getAttribute('href') || ''),
                    el: menuEl,
                    anchor: anchor || menuEl,
                    isWebKit: menuEl.classList.contains('web-kit-sidebar-item') || !!menuEl.closest('.web-kit-sidebar')
                });
            }
            return items;
        },
        findForumMenuItem() {
            const buttons = sidebar.getButtons();
            return buttons.find((i) => route.isForumUrl(i.href))
                || buttons.find((i) => i.name.includes('论坛') || i.name.includes('論壇'))
                || null;
        },
        findMenuItem(target = null) {
            if (!target) return sidebar.findForumMenuItem();
            const has = (v, q) => v.toLowerCase().includes(String(q).toLowerCase());
            let matcher = null;
            if (typeof target === 'function') matcher = target;
            else if (typeof target === 'string') matcher = (i) => has(i.name, target) || has(i.href, target);
            else if (target instanceof RegExp) matcher = (i) => target.test(i.name) || target.test(i.href);
            else if (typeof target === 'object') {
                matcher = (i) => !(target.name && !has(i.name, target.name))
                    && !(target.href && !has(i.href, target.href))
                    && !(target.el && i.el !== target.el);
            }
            return matcher ? (sidebar.getButtons().find(matcher) || null) : sidebar.findForumMenuItem();
        },
        inject(targetElement, contentElement, mode = 'replace') {
            if (!targetElement || !contentElement) return false;
            return attempt(() => {
                targetElement[INJECT_MODES[mode] || INJECT_MODES.replace](contentElement);
                return true;
            }, false, '[Utils.sidebar.inject] Injection failed:');
        },
        isAvailable() {
            const el = sidebar.get();
            if (!el || !el.isConnected) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && (rect.width > 0 || rect.height > 0);
        },
        observeAvailability(callback) {
            if (typeof callback !== 'function') return () => {};
            let last = sidebar.isAvailable();
            callback(last, sidebar.get());
            const observer = new MutationObserver(() => {
                const now = sidebar.isAvailable();
                if (now !== last) { last = now; callback(now, sidebar.get()); }
            });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
            return () => observer.disconnect();
        }
    };
    const CLOSE_BTN_SEL = 'button[aria-label*="关闭导航菜单"], button[aria-label*="關閉導航菜單"], button[aria-label*="关闭"], button[aria-label*="關閉"]';
    const OPEN_TOGGLE_SEL = 'button.layout-toggle[aria-expanded="true"], button[aria-label*="导航菜单"][aria-expanded="true"], button[aria-label*="導航菜單"][aria-expanded="true"]';
    const ANY_TOGGLE_SEL = 'button.layout-toggle, button[aria-label*="导航菜单"], button[aria-label*="導航菜單"], header button, .n-layout-header button, nav.n-layout-header button, .n-layout-sider-toggle-button, .sidebar-collapse';

    const collapse = {
        isSidebarCollapsed(sider = null) {
            const el = sider || sidebar.get();
            if (el) {
                if (el.classList.contains('web-kit-sidebar')) return el.classList.contains('is-collapsed');
                if (el.classList.contains('n-layout-sider--collapsed') || el.offsetWidth < 120) return true;
                const btn = document.querySelector('.sidebar-collapse');
                if (btn && (btn.getAttribute('aria-expanded') === 'false'
                    || btn.getAttribute('aria-label')?.includes('展开')
                    || btn.getAttribute('title')?.includes('展开'))) return true;
            }
            return !!document.querySelector('.n-menu.n-menu--collapsed');
        },
        autoCollapseSidebar() {
            if (typeof window === 'undefined' || window.innerWidth > 768) return;
            const closeBtn = document.querySelector(CLOSE_BTN_SEL);
            if (closeBtn) return closeBtn.click();
            const mask = document.querySelector('.n-drawer-mask');
            if (mask) return mask.click();

            const openDrawer = document.querySelector('.n-drawer, [role="dialog"][class*="drawer"]');
            const openToggle = document.querySelector(OPEN_TOGGLE_SEL);
            if (openDrawer || openToggle) (openToggle || document.querySelector(ANY_TOGGLE_SEL))?.click();
        },
        syncSidebarCollapsedState(submenuDiv = null) {
            const submenu = submenuDiv || document.querySelector('.novelia-forum-submenu');
            if (!submenu) return;
            const collapsed = collapse.isSidebarCollapsed();

            if (submenu.classList.contains('n-submenu')) {
                const content = submenu.querySelector('.n-menu-item-content');
                const children = submenu.querySelector('.n-submenu-children');
                if (content) content.style.paddingLeft = collapsed ? '21px' : '32px';
                if (collapsed && children) {
                    children.classList.remove('expanded');
                    children.classList.add('collapsed');
                    submenu.setAttribute('aria-expanded', 'false');
                    const arrow = content?.querySelector('.n-menu-item-content__arrow');
                    if (arrow) arrow.style.transform = 'rotate(0deg)';
                }
                return;
            }
            const children = submenu.querySelector('.sidebar-submenu');
            if (!children) return;
            const wantExpanded = !collapsed && ls.getRaw('novelia_forum_submenu_expanded') === 'true';
            children.classList.toggle('flex', wantExpanded);
            children.classList.toggle('hidden', !wantExpanded);
            submenu.querySelector('button')?.setAttribute('aria-expanded', String(wantExpanded));
        },
        observeSidebarToggle(sider = null, callback = null) {
            const target = sider || sidebar.get();
            if (!target || target.dataset.noveliaSiderObserverAttached) return;
            target.dataset.noveliaSiderObserverAttached = '1';
            new MutationObserver(() => {
                collapse.syncSidebarCollapsedState();
                if (typeof callback === 'function') callback(collapse.isSidebarCollapsed(target));
            }).observe(target, { attributes: true, attributeFilter: ['class', 'style', 'aria-expanded'] });
        },
        createWrapper({ anchorCard, repliesArea, isCollapsedState, replyCount, onToggleState }) {
            if (!anchorCard || !repliesArea) return null;
            const label = (c) => `${c ? '展開回覆' : '收起回覆'} (${replyCount})`;
            const stateCls = (c) => (c ? 'collapsed' : 'expanded');

            const btnWrapper = document.createElement('div');
            btnWrapper.className = 'novelia-collapse-btn-wrapper';
            const btn = document.createElement('button');
            btn.className = 'novelia-collapse-btn';
            btn.type = 'button';
            btn.innerHTML = `<span class="novelia-collapse-icon ${stateCls(isCollapsedState)}">${svg.CHEVRON}</span>
                             <span class="novelia-collapse-btn-text">${label(isCollapsedState)}</span>`;
            btnWrapper.appendChild(btn);
            anchorCard.after(btnWrapper);

            const wrapper = document.createElement('div');
            wrapper.className = `novelia-collapse-replies-wrapper ${stateCls(isCollapsedState)}`;
            const inner = document.createElement('div');
            inner.className = 'novelia-collapse-replies-inner';
            repliesArea.parentNode.insertBefore(wrapper, repliesArea);
            inner.appendChild(repliesArea);
            wrapper.appendChild(inner);

            btn.addEventListener('click', () => {
                const next = !wrapper.classList.contains('collapsed');
                wrapper.classList.toggle('collapsed', next);
                wrapper.classList.toggle('expanded', !next);
                const icon = btn.querySelector('.novelia-collapse-icon');
                icon?.classList.toggle('collapsed', next);
                icon?.classList.toggle('expanded', !next);
                const text = btn.querySelector('.novelia-collapse-btn-text');
                if (text) text.innerText = label(next);
                if (typeof onToggleState === 'function') onToggleState(next);
            });
            btn.addEventListener('mouseup', () => btn.blur());

            const nativeReplyBtn = Array.from(anchorCard.querySelectorAll('button'))
                .find((b) => b.innerText.includes('回复') || b.innerText.includes('回覆'));
            nativeReplyBtn?.addEventListener('click', () => {
                if (wrapper.classList.contains('collapsed')) btn.click();
            });
            return { btnWrapper, wrapper, inner };
        }
    };

    const guard = {
        _rules: [],
        _installed: false,
        _d: createDisposer(),

        add(rule) {
            if (!rule?.selector || typeof rule.onMatch !== 'function') return null;
            guard._rules.push(rule);
            guard._install();
            return () => { guard._rules = guard._rules.filter((r) => r !== rule); };
        },
        _test(el) {
            if (!el || el.nodeType !== 1 || typeof el.matches !== 'function') return;
            for (const r of guard._rules) attempt(() => { if (el.matches(r.selector)) r.onMatch(el); });
        },
        _scan(node) {
            if (!node) return;
            if (node.nodeType === 11) { node.childNodes?.forEach((c) => guard._scan(c)); return; }
            if (node.nodeType !== 1) return;
            guard._test(node);
            if (!node.firstElementChild || typeof node.querySelectorAll !== 'function') return;
            for (const r of guard._rules) {
                attempt(() => node.querySelectorAll(r.selector).forEach((el) => attempt(() => r.onMatch(el))));
            }
        },
        _install() {
            if (guard._installed) return;
            guard._installed = true;
            const add = (un) => guard._d.add(un);
            const rescan = function () {
                const el = this;
                queueMicrotask(() => guard._scan(el.parentNode || el));
            };
            const nodeProto = root?.Node?.prototype;
            if (nodeProto) {
                ['appendChild', 'insertBefore', 'replaceChild'].forEach((m) => {
                    add(patcher.before(nodeProto, m, function (ctx) {
                        if (this && !this.isConnected) return;
                        guard._scan(ctx.args[0]);
                    }));
                });
            }
            const elProto = root?.Element?.prototype;
            if (elProto) {
                ['append', 'prepend', 'before', 'after', 'replaceWith'].forEach((m) => {
                    add(patcher.before(elProto, m, function (ctx) {
                        if (this && !this.isConnected) return;
                        ctx.args.forEach((a) => guard._scan(a));
                    }));
                });
                add(patcher.before(elProto, 'insertAdjacentElement', function (ctx) {
                    if (this && !this.isConnected) return;
                    guard._scan(ctx.args[1]);
                }));
                add(patcher.before(elProto, 'insertAdjacentHTML', rescan));
                ['innerHTML', 'outerHTML'].forEach((p) => add(patcher.patchSetter(elProto, p, rescan)));
            }
            if (typeof MutationObserver !== 'undefined' && document?.documentElement) {
                const observer = new MutationObserver((ms) => {
                    for (const m of ms) {
                        if (m.type === 'attributes') guard._test(m.target);
                        else m.addedNodes?.forEach((n) => guard._scan(n));
                    }
                });
                observer.observe(document.documentElement, {
                    childList: true, subtree: true, attributes: true,
                    attributeFilter: ['src', 'class', 'href', 'style']
                });
                add(() => observer.disconnect());
            }
        },
        destroy() {
            guard._d.run();
            guard._rules = [];
            guard._installed = false;
        }
    };

    const dom = {
        isNoveliaOwnNode(node) {
            if (!node) return false;
            if (node.nodeType === Node.TEXT_NODE) return dom.isNoveliaOwnNode(node.parentElement);
            if (node.nodeType !== Node.ELEMENT_NODE) return false;
            if (typeof node.className === 'string' && /(^|\s)novelia-/.test(node.className)) return true;
            return !!node.closest?.('[class*="novelia-"]');
        },
        isSelfCausedMutation(mutation) {
            if (dom.isNoveliaOwnNode(mutation.target)) return true;
            const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
            return nodes.length > 0 && nodes.every(dom.isNoveliaOwnNode);
        },
        isMobile() {
            if (typeof window === 'undefined') return false;
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '')
                || window.innerWidth <= 768;
        },
        guard
    };

    const TIME_PATTERNS = [
        { regex: /(\d+)\s*秒/, mult: 1 },
        { regex: /(\d+)\s*(?:分钟|分鐘|分)/, mult: 60 },
        { regex: /(\d+)\s*(?:小时|小時|時|时)/, mult: 3600 },
        { regex: /(\d+)\s*(?:天|日)/, mult: 86400 },
        { regex: /(\d+)\s*(?:个?月|個?月)/, mult: 2592000 },
        { regex: /(\d+)\s*年/, mult: 31536000 }
    ];

    const time = {
        parseToSecondsAgo(text) {
            const s = text?.trim();
            if (!s) return Infinity;
            if (/^(刚刚|剛剛|just now)$/i.test(s)) return 0;
            for (const { regex, mult } of TIME_PATTERNS) {
                const m = s.match(regex);
                if (m) return parseInt(m[1], 10) * mult;
            }
            const parsed = Date.parse(s);
            return isNaN(parsed) ? Infinity : Math.max(0, (Date.now() - parsed) / 1000);
        },
        formatRelativeTime(timestamp) {
            if (!timestamp) return '';
            let ms = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
            if (isNaN(ms)) return '';
            if (ms < 1e11) ms *= 1000;

            const date = new Date(ms);
            const diff = Math.floor((Date.now() - ms) / 1000);
            if (diff < 60) return '剛剛';
            if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
            if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
            if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
            const pad = (n) => String(n).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        }
    };

    const hash = {
        hashString(s) {
            let h = 0;
            for (let i = 0; i < s.length; i++) h = (((h << 5) - h) + s.charCodeAt(i)) | 0;
            return Math.abs(h).toString(36);
        }
    };

    const limiter = {
        createConcurrencyLimiter(limit) {
            let active = 0;
            const queue = [];
            const next = () => {
                if (active >= limit || !queue.length) return;
                active++;
                const { task, resolve, reject } = queue.shift();
                task().then(resolve, reject).finally(() => { active--; next(); });
            };
            return (task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); });
        }
    };

    const ui = {};
    Object.assign(ui, {
        getSidebar: () => sidebar.get(),
        getSidebarButtons: (container = null) => sidebar.getButtons(container),
        isSidebarMenuItem: (a) => sidebar.isMenuItem(a),
        findForumMenuItem: () => sidebar.findForumMenuItem(),

        getForumHeader() {
            return document.querySelector('header, .forum-header, nav[aria-label="站点导航"], nav[aria-label="站點導航"], nav');
        },
        getThemeButton(container = null) {
            return (container || document).querySelector('button[aria-label*="主题"], button[title*="主题"], button[aria-label*="主題"], button[title*="主題"], button[aria-label*="theme" i], button[title*="theme" i]');
        },
        createForumHeaderButton({ className = '', title = '', iconSvg = '', iconSize = 20, margin = '0px 4px', marginRight = null, onClick = null } = {}) {
            const btn = document.createElement('button');
            btn.className = `__button-dark-131ezvy-ehllmd n-button n-button--default-type n-button--large-type ${className}`.trim();
            btn.type = 'button';
            if (title) {
                btn.title = title;
                btn.setAttribute('aria-label', title);
            }
            btn.style.cssText = `margin: ${margin}; flex-shrink: 0; background: transparent; border: none; cursor: pointer; color: inherit; display: inline-flex; align-items: center; justify-content: center; padding-top: 6px;`;
            if (marginRight) btn.style.marginRight = marginRight;
            btn.innerHTML = `<span class="n-button__content"><i role="img" class="n-icon __icon-dark-131ezvy-d" style="font-size: ${iconSize}px; display: inline-flex;">${iconSvg}</i></span>`;
            if (typeof onClick === 'function') {
                btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(e); });
            }
            return btn;
        },
        createToastManager(className = 'novelia-toast') {
            let toastEl = document.querySelector(`.${className}`);
            let timer = null;
            if (!toastEl) {
                toastEl = document.createElement('div');
                toastEl.className = className;
                document.body.appendChild(toastEl);
            }
            return {
                show(message, duration = 2200) {
                    clearTimeout(timer);
                    toastEl.textContent = message;
                    toastEl.classList.add('show');
                    timer = setTimeout(() => toastEl.classList.remove('show'), duration);
                }
            };
        },
        isDark() { return ui.isHostDarkTheme(); },
        isHostDarkTheme() {
            const de = document.documentElement, body = document.body;
            if (de.classList.contains('dark') || body.classList.contains('dark')
                || de.getAttribute('data-theme') === 'dark' || document.querySelector('.n-config-provider--dark')) return true;
            if (de.classList.contains('light') || body.classList.contains('light')
                || de.getAttribute('data-theme') === 'light') return false;

            const darkByBg = attempt(() => {
                const targets = [body, de, document.getElementById('app'), document.querySelector('.n-layout'), document.querySelector('.n-config-provider')].filter(Boolean);
                for (const el of targets) {
                    const bg = window.getComputedStyle(el).backgroundColor;
                    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                    if (!m || (bg.includes('rgba(') && bg.endsWith(', 0)'))) continue;
                    return (m[1] * 299 + m[2] * 587 + m[3] * 114) / 1000 < 128;
                }
                return null;
            }, null);
            if (darkByBg !== null) return darkByBg;
            return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        },
        getOrCreateDropdownPopover(subItems, onItemClick = null) {
            let popover = document.getElementById('novelia-forum-popover');
            if (popover) return popover;

            popover = document.createElement('div');
            popover.id = 'novelia-forum-popover';
            popover.className = 'novelia-forum-dropdown-popover';

            subItems.forEach((item) => {
                const div = document.createElement('div');
                div.className = 'novelia-forum-dropdown-item';
                div.innerHTML = `${item.icon}<span>${item.name}</span>`;
                div.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    popover.style.display = 'none';
                    if (item.path && location.pathname !== item.path) route.push(item.path);
                    if (typeof onItemClick === 'function') onItemClick(item, e);
                });
                popover.appendChild(div);
            });
            document.body.appendChild(popover);
            return popover;
        },
        createWebKitPopoutButton({ href = '', onClick = null, title = '前往論壇 (取代當前頁面)', ariaLabel = '前往論壇' } = {}) {
            const btn = document.createElement('a');
            btn.href = href;
            btn.target = '_self';
            btn.title = title;
            btn.className = 'novelia-forum-popout-btn grid size-5 place-items-center rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10 text-muted hover:text-ink transition-colors';
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="size-3.5"><path d="${POPOUT_PATH}" fill="currentColor"></path></svg>`;
            btn.dataset.noveliaPopout = '1';
            btn.setAttribute('aria-label', ariaLabel);
            btn.addEventListener('click', (e) => {
                if (!isPlainClick(e)) return;
                e.preventDefault();
                e.stopPropagation();
                if (typeof onClick === 'function') onClick(e);
                else if (href) window.location.assign(href);
            }, true);
            return btn;
        },
        createWebKitSidebarHeader({ label = '论坛', isExpanded = false, origIcon = null, actionElements = [] } = {}) {
            const headerBtn = document.createElement('button');
            headerBtn.type = 'button';
            headerBtn.className = 'web-kit-sidebar-item text-ink hover:bg-hover w-full flex items-center justify-between cursor-pointer !pr-1.5';
            headerBtn.setAttribute('aria-label', label);
            headerBtn.setAttribute('aria-expanded', String(!!isExpanded));

            const iconSpan = document.createElement('span');
            iconSpan.className = 'grid size-5 flex-none place-items-center';
            iconSpan.setAttribute('aria-hidden', 'true');
            iconSpan.innerHTML = origIcon
                ? (typeof origIcon === 'string' ? origIcon : origIcon.outerHTML)
                : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="size-5"><path d="M15 4v7H5.17L4 12.17V4h11m1-2H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1zm5 4h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1z" fill="currentColor"></path></svg>';

            const labelSpan = document.createElement('span');
            labelSpan.className = 'web-kit-sidebar-label flex-1 text-left truncate opacity-100';
            labelSpan.setAttribute('aria-hidden', 'false');
            labelSpan.textContent = label;

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'flex items-center gap-1.5 flex-none ml-auto';
            [].concat(actionElements).forEach((el) => el && actionsDiv.appendChild(el));

            headerBtn.append(iconSpan, labelSpan, actionsDiv);
            return headerBtn;
        },
        createWebKitSubmenuItem({ name = '', path = '', icon = '', onClick = null } = {}) {
            const link = document.createElement('a');
            link.href = path;
            link.className = 'web-kit-sidebar-item text-ink hover:bg-hover flex items-center gap-2 py-1.5 px-2 rounded-md text-sm';

            const subIcon = document.createElement('span');
            subIcon.className = 'grid size-4 flex-none place-items-center';
            subIcon.setAttribute('aria-hidden', 'true');
            subIcon.innerHTML = icon;

            const subLabel = document.createElement('span');
            subLabel.className = 'web-kit-sidebar-label truncate';
            subLabel.textContent = name;

            link.append(subIcon, subLabel);
            link.addEventListener('click', (e) => {
                if (!isPlainClick(e)) return;
                e.preventDefault();
                e.stopPropagation();
                if (path && location.pathname !== path) route.push(path);
                if (typeof onClick === 'function') onClick(e);
            });
            return link;
        },
        createHostHeaderButton({ id = '', className = '', title = '', iconSvg = '', onClick = null } = {}) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `${id} grid size-8 flex-none place-items-center rounded p-1.5 hover:bg-hover text-muted hover:text-ink transition-colors ${className}`.trim();
            if (title) {
                btn.title = title;
                btn.setAttribute('aria-label', title);
            }
            btn.innerHTML = iconSvg || '';
            if (typeof onClick === 'function') {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onClick(e);
                });
            }
            return btn;
        },
        injectHostHeaderButton(buttonOrOptions, position = 'prepend') {
            if (location.hostname !== DOMAINS.HOST) return null;
            const headerEl = document.querySelector('header');
            if (!headerEl) return null;
            const rightContainer = headerEl.querySelector('.ml-auto.flex, .ml-auto') || headerEl;
            if (!rightContainer) return null;

            let btnElement = null;
            let btnId = '';

            if (buttonOrOptions instanceof Element) {
                btnElement = buttonOrOptions;
                btnId = btnElement.className ? btnElement.className.split(/\s+/)[0] : '';
            } else if (typeof buttonOrOptions === 'object' && buttonOrOptions !== null) {
                btnId = buttonOrOptions.id || '';
                const pos = buttonOrOptions.position || position;
                position = pos;
                btnElement = ui.createHostHeaderButton(buttonOrOptions);
            }

            if (!btnElement) return null;

            if (btnId) {
                const existing = rightContainer.querySelector(`.${btnId}`);
                if (existing) return existing;
            }

            if (position === 'append') rightContainer.appendChild(btnElement);
            else rightContainer.prepend(btnElement);
            return btnElement;
        },
        createModal({ id = '', title = '', tabs = [], onClose = null } = {}) {
            gm.addStyle(`
                .novelia-modal-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.4); z-index: 99999; display: none; align-items: center; justify-content: center; }
                .novelia-modal-backdrop.show { display: flex; }
                .novelia-modal-dialog { background: #fff; color: #333; border-radius: 8px; width: 480px; max-width: 92vw; max-height: 85vh; overflow-y: auto; padding: 20px; box-sizing: border-box; box-shadow: 0 8px 30px rgba(0,0,0,0.3); font-size: 13px; font-family: system-ui, -apple-system, sans-serif; position: relative; }
                .dark .novelia-modal-dialog, [data-theme="dark"] .novelia-modal-dialog, body.dark .novelia-modal-dialog { background: #1e1e22; color: rgba(255,255,255,0.9); border: 1px solid rgba(255,255,255,0.15); }
                .novelia-modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 10px; }
                .dark .novelia-modal-header, [data-theme="dark"] .novelia-modal-header, body.dark .novelia-modal-header { border-bottom-color: rgba(255,255,255,0.15); }
                .novelia-modal-title { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
                .novelia-modal-close { cursor: pointer; background: transparent; border: none; font-size: 20px; line-height: 1; color: #888; }
                .dark .novelia-modal-close, [data-theme="dark"] .novelia-modal-close, body.dark .novelia-modal-close { color: #aaa; }
                .novelia-modal-tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid rgba(0,0,0,0.1); }
                .dark .novelia-modal-tabs, [data-theme="dark"] .novelia-modal-tabs, body.dark .novelia-modal-tabs { border-bottom-color: rgba(255,255,255,0.15); }
                .novelia-modal-tab { padding: 6px 12px; cursor: pointer; border-bottom: 2px solid transparent; font-weight: 500; }
                .novelia-modal-tab.active { border-bottom-color: #63e2b7; color: #63e2b7; }
            `, 'novelia-utils-modal-styles');

            const backdrop = document.createElement('div');
            backdrop.className = `novelia-modal-backdrop ${id}`.trim();

            let tabsHtml = '';
            if (Array.isArray(tabs) && tabs.length > 0) {
                tabsHtml = `<div class="novelia-modal-tabs">` + tabs.map((t, idx) => `
                    <div class="novelia-modal-tab ${idx === 0 ? 'active' : ''}" data-tab="${t.id}">${str.escapeHtml(t.label)}</div>
                `).join('') + `</div>`;
            }

            backdrop.innerHTML = `
                <div class="novelia-modal-dialog">
                    <div class="novelia-modal-header">
                        <div class="novelia-modal-title"><span>${str.escapeHtml(title)}</span></div>
                        <button type="button" class="novelia-modal-close">&times;</button>
                    </div>
                    ${tabsHtml}
                    <div class="novelia-modal-content"></div>
                </div>
            `;

            document.body.appendChild(backdrop);

            const closeBtn = backdrop.querySelector('.novelia-modal-close');
            const close = () => {
                backdrop.classList.remove('show');
                if (typeof onClose === 'function') onClose();
            };

            if (closeBtn) closeBtn.addEventListener('click', close);
            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) close();
            });

            return {
                backdrop,
                container: backdrop.querySelector('.novelia-modal-content'),
                show(activeTabId) {
                    backdrop.classList.add('show');
                    if (activeTabId && tabs.length > 0) {
                        backdrop.querySelectorAll('.novelia-modal-tab').forEach((t) => {
                            t.classList.toggle('active', t.dataset.tab === activeTabId);
                        });
                    }
                },
                close,
                onTabClick(fn) {
                    backdrop.querySelectorAll('.novelia-modal-tab').forEach((t) => {
                        t.addEventListener('click', () => {
                            backdrop.querySelectorAll('.novelia-modal-tab').forEach((el) => el.classList.remove('active'));
                            t.classList.add('active');
                            fn(t.dataset.tab);
                        });
                    });
                }
            };
        }
    });

    const COMMENT_SECTION_SEL = 'section.comment-list, section[aria-label*="评论"], section[aria-label*="評論"]';
    const REPLY_INDENT_SEL = 'div[style*="margin-left: 32px"]';

    const comments = {
        getNovelCommentPane() {
            const section = document.querySelector(COMMENT_SECTION_SEL);
            if (section) return section;

            const activeTab = document.querySelector('.n-tabs-tab--active, .n-tabs-tab[aria-selected="true"]');
            const activeTabIsComment = !!activeTab && (activeTab.textContent.includes('评论') || activeTab.textContent.includes('評論'));

            for (const h2 of document.querySelectorAll('h2')) {
                const text = h2.textContent.trim();
                if (!(text.startsWith('评论') || text.startsWith('評論'))) continue;
                const pane = h2.closest(COMMENT_SECTION_SEL) || h2.closest('.n-tab-pane')
                    || h2.closest('div[role="none"]')?.parentElement || h2.parentElement?.parentElement;
                if (pane) return pane;
            }
            return activeTabIsComment ? document.querySelector('.n-tab-pane') : null;
        },
        getNovelCommentFloors(paneElement = null) {
            const pane = paneElement || comments.getNovelCommentPane();
            if (!pane) return [];

            const allHeaders = Array.from(pane.querySelectorAll('.n-flex'))
                .filter((flex) => flex.querySelector('b') && !flex.closest(REPLY_INDENT_SEL));
            if (!allHeaders.length) return [];

            const commonParent = allHeaders[0].parentElement;
            if (!commonParent) return [];

            const floors = [];
            allHeaders.forEach((headerFlex, index) => {
                if (headerFlex.parentElement !== commonParent) return;

                const next = headerFlex.nextElementSibling;
                const card = next && next.classList.contains('n-card') ? next : null;
                const nodes = [headerFlex];
                let repliesArea = null;

                for (let curr = next; curr; curr = curr.nextElementSibling) {
                    if (curr.classList.contains('n-pagination') || curr.querySelector('.n-pagination')) break;
                    if (allHeaders.includes(curr)) break;
                    nodes.push(curr);

                    if (!repliesArea && curr !== card) {
                        if (curr.matches(REPLY_INDENT_SEL)) {
                            const siblings = [curr];
                            for (let s = curr.nextElementSibling; s && s.matches(REPLY_INDENT_SEL); s = s.nextElementSibling) siblings.push(s);
                            if (siblings.length > 1) {
                                const container = document.createElement('div');
                                curr.parentNode.insertBefore(container, curr);
                                siblings.forEach((s) => container.appendChild(s));
                                repliesArea = container;
                            } else {
                                repliesArea = curr;
                            }
                        } else if (curr.querySelector?.(REPLY_INDENT_SEL)) {
                            repliesArea = curr;
                        }
                    }
                    if (curr.classList.contains('n-divider')) break;
                }
                floors.push({ originalIndex: index, headerFlex, commentHeader: headerFlex.querySelector('b'), card, commonParent, nodes, repliesArea });
            });
            return floors;
        },
        getForumCommentFloors() {
            const commentsEl = document.getElementById('comments') || document.querySelector(COMMENT_SECTION_SEL);
            if (!commentsEl) return { floorContainer: null, candidateFloors: [], floors: [] };

            const floorContainer = commentsEl.querySelector('.divide-y') || commentsEl.querySelector('.contents') || commentsEl;
            const candidateFloors = Array.from(floorContainer.children).filter((child) =>
                child.tagName !== 'HEADER' && !child.classList.contains('comments-title')
                && child.querySelector('article, time, .comment-card') !== null);

            const floors = candidateFloors.map((element, index) => {
                const rootArticle = element.querySelector('article');
                let repliesArea = null;
                if (rootArticle) {
                    repliesArea = rootArticle.nextElementSibling;
                    while (repliesArea && !repliesArea.querySelector('article')) repliesArea = repliesArea.nextElementSibling;
                }
                return { originalIndex: index, element, section: element, rootArticle, repliesArea };
            });
            return { floorContainer, candidateFloors, floors };
        }
    };

    const IMG_TTL = 7 * DAY;
    const MASCOT_KEY = 'mascot_image_blob';

    const gmDownloadBlob = (url, mimeType) => new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'GET', url, responseType: 'blob', timeout: 15000,
                headers: { 'Cache-Control': 'max-age=3600' },
                onload: (r) => {
                    if (r.status >= 200 && r.status < 300 && r.response) {
                        resolve(r.response instanceof Blob ? r.response : new Blob([r.response], { type: mimeType || 'image/webp' }));
                    } else reject(new Error(`HTTP ${r.status}`));
                },
                onerror: reject,
                ontimeout: () => reject(new Error('Request timed out'))
            });
        } else if (typeof fetch === 'function') {
            fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); }).then(resolve, reject);
        } else {
            reject(new Error('No network request method available'));
        }
    });

    const img = {
        _blobUrls: {},
        _promises: {},
        DEFAULT_TTL: IMG_TTL,

        async getBlob(imageUrl, { ttlMs = IMG_TTL, cacheKey = null, mimeType = null } = {}) {
            if (!imageUrl) throw new Error('Image URL is required');
            if (network._isRejected(imageUrl)) throw new Error(`Blocked by Utils.network (${imageUrl})`);

            const key = cacheKey || `img_blob_${imageUrl}`;
            const useCache = !(typeof window !== 'undefined' && window.top !== window.self); // iframe 不讀寫快取

            if (useCache) {
                try {
                    const cached = await cache.getIDB(key, { ttlMs });
                    if (cached instanceof Blob) return cached;
                    if (cached instanceof ArrayBuffer || ArrayBuffer.isView(cached)) {
                        return new Blob([cached], { type: mimeType || 'image/webp' });
                    }
                } catch (e) { console.warn(`[Utils.img] Error reading image cache from IDB (${key}):`, e); }
            }
            const blob = await gmDownloadBlob(imageUrl, mimeType);
            if (useCache) {
                try { await cache.setIDB(key, blob); } catch (e) { console.warn(`[Utils.img] Error saving image cache to IDB (${key}):`, e); }
            }
            return blob;
        },
        getUrl(imageUrl, options = {}) {
            if (!imageUrl) return Promise.resolve('');
            if (img._blobUrls[imageUrl]) return Promise.resolve(img._blobUrls[imageUrl]);
            if (!img._promises[imageUrl]) {
                img._promises[imageUrl] = (async () => {
                    try {
                        const url = URL.createObjectURL(await img.getBlob(imageUrl, options));
                        img._blobUrls[imageUrl] = url;
                        return url;
                    } catch (e) {
                        console.error(`[Utils.img] Failed to fetch or load image (${imageUrl}):`, e);
                        delete img._promises[imageUrl];
                        return imageUrl;
                    }
                })();
            }
            return img._promises[imageUrl];
        },
        getSyncUrl(imageUrl) { return imageUrl ? (img._blobUrls[imageUrl] || imageUrl) : ''; },
        getMascot() {
            const url = `https://${DOMAINS.HOST}/assets/mascot-DSVGgW05.webp`;
            const opts = { cacheKey: MASCOT_KEY, ttlMs: IMG_TTL };
            return {
                url,
                CACHE_KEY: MASCOT_KEY,
                CACHE_TTL: IMG_TTL,
                getBlob: () => img.getBlob(url, opts),
                getUrl: () => img.getUrl(url, opts),
                getSyncUrl: () => img.getSyncUrl(url)
            };
        },
        getMascotUrl() { return img.getMascot().getUrl(); },
        getMascotSyncUrl() { return img.getMascot().getSyncUrl(); }
    };

    const Utils = {
        gm, str, ls, idb, cache, network, dom, collapse, sidebar, route, time, ui,
        comments, hash, limiter, img, patcher, svg,
        get mascot() { return img.getMascot(); },
        hook: patcher,
        patch: patcher
    };

    if (root !== window) { attempt(() => { window.DOMAINS = DOMAINS; window.Utils = Utils; }); } // Debug
    root.DOMAINS = DOMAINS;
    root.Utils = Utils;
    // Firefox Alt.
    // root.Utils = cloneInto(Utils, root, { cloneFunctions: true });
})();