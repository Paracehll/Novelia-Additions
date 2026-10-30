// ==UserScript==
// @name         Novelia Utils
// @namespace    novelia-utils
// @version      2.2.0
// @description  Novelia 工具函式庫 (NoveliaConfig & Utils)
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

    const root = typeof unsafeWindow !== 'undefined' ? unsafeWindow : (typeof window !== 'undefined' ? window : globalThis);

    const DAY = 24 * 60 * 60 * 1000;

    const defaultConfig = {
        domains: { main: 'n.novelia.cc', forum: 'forum.novelia.cc', cdn: 'n-cdn.novelia.cc' },
        db: { name: 'novelia_qol_db', version: 1, stores: ['assets_cache', 'capture_cache', 'network_cache'], keyPath: 'key' },
        keys: { forumSubmenuExpanded: 'novelia_forum_submenu_expanded', mascotBlob: 'mascot_image_blob' },
        assets: { mascotPath: '/assets/mascot-DSVGgW05.webp' },
        events: { locationChange: 'tm-locationchange' },
        ttl: { default: DAY, image: 7 * DAY },
        cssPrefix: 'novelia-'
    };

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

    const createAbortError = (msg = 'Aborted') => {
        const e = new Error(msg);
        e.name = 'AbortError';
        return e;
    };

    const isPlainClick = (e) => !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || (e.button !== undefined && e.button !== 0));

    const fireWindowEvent = (name) => {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event(name));
        }
    };

    const makeEscaper = (aposEntity) => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": aposEntity };
        return (str) => (str ? String(str).replace(/[&<>"']/g, (c) => map[c]) : '');
    };

    const hashString = (s) => {
        let h = 0;
        const strVal = String(s || '');
        for (let i = 0; i < strVal.length; i++) h = (((h << 5) - h) + strVal.charCodeAt(i)) | 0;
        return Math.abs(h).toString(36);
    };

    const utrimmer = (urlStr, matchStr, query = false) => {
        if (!urlStr) return '';
        const urlObj = attempt(() => new URL(urlStr, typeof location !== 'undefined' ? location.origin : 'https://n.novelia.cc'), null);
        let target = urlObj ? (urlObj.pathname + urlObj.search + urlObj.hash) : String(urlStr);

        if (matchStr) {
            const idx = target.indexOf(matchStr);
            if (idx !== -1) target = target.slice(idx + matchStr.length);
        }
        if (target.startsWith('/')) target = target.slice(1);
        if (!query) target = target.split('?')[0].split('#')[0];
        return target;
    };

    const text = {
        escapeHtml: makeEscaper('&#039;'),
        escapeXml: makeEscaper('&apos;'),
        truncate(s, length, suffix = '...') {
            if (!s) return '';
            const v = String(s);
            return v.length <= length ? v : v.slice(0, length) + suffix;
        },
        hash: hashString,
        utrimmer
    };

    const createLimiter = (limit) => {
        let active = 0;
        const queue = [];
        const next = () => {
            if (active >= limit || !queue.length) return;
            active++;
            const { task, resolve, reject } = queue.shift();
            task().then(resolve, reject).finally(() => { active--; next(); });
        };
        return (task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); });
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
        parseRelativeToSeconds(rawText) {
            const s = rawText?.trim();
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

    const createGm = (g = globalThis) => ({
        addStyle(css, id) {
            if (typeof document === 'undefined') return null;
            const existing = id && document.getElementById(id);
            if (existing) return existing;
            if (typeof g.GM_addStyle === 'function') {
                const style = g.GM_addStyle(css);
                if (id && style && style.id !== undefined) style.id = id;
                return style;
            }
            const style = document.createElement('style');
            if (id) style.id = id;
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
            return style;
        },
        setClipboard(clipboardText) {
            if (typeof g.GM_setClipboard === 'function') {
                g.GM_setClipboard(clipboardText);
                return Promise.resolve(true);
            }
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                return navigator.clipboard.writeText(clipboardText).then(() => true, () => false);
            }
            return Promise.resolve(false);
        },
        downloadBlob(url, { mimeType, timeout = 15000, signal } = {}) {
            return new Promise((resolve, reject) => {
                if (signal?.aborted) return reject(createAbortError());

                let handle = null;
                const cleanup = () => signal?.removeEventListener('abort', onAbort);
                const onAbort = () => {
                    attempt(() => handle?.abort?.());
                    reject(createAbortError());
                };
                const ok = (v) => { cleanup(); resolve(v); };
                const fail = (e) => { cleanup(); reject(e); };
                signal?.addEventListener('abort', onAbort, { once: true });

                if (typeof g.GM_xmlhttpRequest === 'function') {
                    handle = g.GM_xmlhttpRequest({
                        method: 'GET', url, responseType: 'blob', timeout,
                        headers: { 'Cache-Control': 'max-age=3600' },
                        onload: (r) => {
                            if (r.status >= 200 && r.status < 300 && r.response) {
                                ok(r.response instanceof Blob ? r.response : new Blob([r.response], { type: mimeType || 'image/webp' }));
                            } else fail(new Error(`HTTP ${r.status}`));
                        },
                        onerror: fail,
                        ontimeout: () => fail(new Error('Request timed out'))
                    });
                } else if (typeof fetch === 'function') {
                    fetch(url, { signal })
                        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
                        .then(ok, fail);
                } else {
                    fail(new Error('No network request method available'));
                }
            });
        },
        hasXhr: typeof g.GM_xmlhttpRequest === 'function'
    });

    const createLocalStore = () => ({
        get(key, defaultValue = {}) {
            return attempt(() => {
                const raw = localStorage.getItem(key);
                return raw !== null ? JSON.parse(raw) : defaultValue;
            }, defaultValue);
        },
        set(key, value) {
            return attempt(() => { localStorage.setItem(key, JSON.stringify(value)); return true; }, false, `[Utils.localStore] Failed to set ${key}:`);
        },
        getString(key, defaultValue = null) {
            return attempt(() => {
                const raw = localStorage.getItem(key);
                return raw !== null ? raw : defaultValue;
            }, defaultValue);
        },
        setString(key, value) {
            return attempt(() => { localStorage.setItem(key, String(value)); return true; }, false, `[Utils.localStore] Failed to setString ${key}:`);
        },
        remove(key) {
            return attempt(() => { localStorage.removeItem(key); return true; }, false, `[Utils.localStore] Failed to remove ${key}:`);
        },
        clear() {
            return attempt(() => { localStorage.clear(); return true; }, false, '[Utils.localStore] Failed to clear localStore:');
        },
        has(key) {
            return attempt(() => localStorage.getItem(key) !== null, false);
        },
        keys() {
            return attempt(() => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) => k !== null), []);
        }
    });

    const createIdb = (cfgDb) => {
        const conns = new Map();

        const open = (dbName = cfgDb.name, version = cfgDb.version, storeNames = cfgDb.stores, keyPath = cfgDb.keyPath) => {
            return new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB not supported'));
                const stores = new Set([...(cfgDb.stores || []), ...(Array.isArray(storeNames) ? storeNames : [storeNames])]);
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
        };

        const connect = (o) => {
            const id = `${o.dbName}@${o.version}`;
            if (!conns.has(id)) {
                const p = open(o.dbName, o.version, [o.storeName], o.keyPath).then((db) => {
                    db.onversionchange = () => { db.close(); conns.delete(id); };
                    return db;
                });
                p.catch(() => conns.delete(id));
                conns.set(id, p);
            }
            return conns.get(id);
        };

        const run = async (mode, action, opts, fallback) => {
            const o = { dbName: cfgDb.name, version: cfgDb.version, storeName: cfgDb.stores[0], keyPath: cfgDb.keyPath, ...opts };
            try {
                const db = await connect(o);
                return await new Promise((resolve) => {
                    action(db.transaction(o.storeName, mode).objectStore(o.storeName), resolve, o);
                });
            } catch (e) {
                conns.delete(`${o.dbName}@${o.version}`);
                return fallback;
            }
        };

        const req = (request, resolve, onOk, onFail) => {
            request.onsuccess = () => resolve(onOk(request.result));
            request.onerror = () => resolve(onFail);
        };

        const get = (key, opts) => run('readonly', (s, res) => req(s.get(key), res, (r) => r || null, null), opts, null);
        const set = (record, opts) => run('readwrite', (s, res) => req(s.put(record), res, () => true, false), opts, false);
        const del = (key, opts) => run('readwrite', (s, res) => req(s.delete(key), res, () => true, false), opts, false);
        const clear = (opts) => run('readwrite', (s, res) => req(s.clear(), res, () => true, false), opts, false);
        const getAll = (opts) => run('readonly', (s, res) => req(s.getAll(), res, (r) => r || [], []), opts, []);

        const getWithExpiry = (key, { ttlMs = DAY, ...opts } = {}) => {
            const EXPIRED = { expired: true, record: null };
            return run('readwrite', (store, resolve) => {
                const request = store.get(key);
                request.onerror = () => resolve(EXPIRED);
                request.onsuccess = () => {
                    const record = request.result;
                    if (!record) return resolve(EXPIRED);
                    const ts = record.timestamp || record.updatedAt || record.createAt || 0;
                    if (Date.now() - ts >= ttlMs) {
                        store.delete(key);
                        return resolve(EXPIRED);
                    }
                    resolve({ expired: false, record });
                };
            }, opts, EXPIRED);
        };

        const getValid = async (key, opts = {}) => {
            const { expired, record } = await getWithExpiry(key, opts);
            if (expired || !record) return null;
            return record.data !== undefined ? record.data : record;
        };

        return { open, get, set, delete: del, clear, getAll, getWithExpiry, getValid };
    };

    const createCache = ({ ls, idb }) => ({
        get: (key, defaultValue = null) => ls.get(key, defaultValue),
        set: (key, value) => ls.set(key, value),
        remove: (key) => ls.remove(key),
        clear: () => ls.clear(),
        idb: {
            get: (key, opts = {}) => idb.getValid(key, opts),
            set(key, data, opts = {}) {
                const { keyPath = defaultConfig.db.keyPath } = opts;
                return idb.set({ [keyPath]: key, data, timestamp: Date.now() }, opts);
            },
            remove: (key, opts = {}) => idb.delete(key, opts),
            clear: (opts = {}) => idb.clear(opts)
        }
    });

    const HOOK_KEYS = ['before', 'after', 'around', 'instead', 'getter', 'setter'];

    const callHook = (hook, kind, thisArg, ctx, prop) => {
        try { hook[kind].call(thisArg, ctx); } catch (e) {
            console.error(`[Utils.patcher] Error in ${kind} hook for ${String(prop)}:`, e);
        }
    };

    const createPatcher = () => {
        const patches = new Map();

        const getOrCreateState = (target, prop) => {
            let targetMap = patches.get(target);
            if (!targetMap) patches.set(target, (targetMap = new Map()));
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
        };

        const unpatch = (target, prop, hookIdOrFn) => {
            const state = patches.get(target)?.get(prop);
            if (!state) return false;
            if (!hookIdOrFn) return restore(target, prop);

            const beforeCount = state.hooks.length;
            state.hooks = state.hooks.filter((h) => h.id !== hookIdOrFn && !HOOK_KEYS.some((k) => h[k] === hookIdOrFn));
            if (state.hooks.length === 0) restore(target, prop);
            return state.hooks.length < beforeCount;
        };

        const restore = (target, prop) => {
            const targetMap = patches.get(target);
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
            if (targetMap.size === 0) patches.delete(target);
            return true;
        };

        const restoreAll = () => {
            for (const [target, map] of Array.from(patches)) {
                for (const prop of Array.from(map.keys())) restore(target, prop);
            }
            patches.clear();
        };

        const wrapMethod = (target, prop, state) => {
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
                    if (h.once) unpatch(target, prop, h.id);
                    if (ctx.cancelled) break;
                }
                if (!ctx.cancelled) {
                    const instead = lastOf(hooks, 'instead');
                    const around = lastOf(hooks, 'around');
                    try {
                        if (instead) {
                            ctx.result = instead.instead.call(this, ctx, origFn ? origFn.bind(this) : null);
                            if (instead.once) unpatch(target, prop, instead.id);
                        } else if (around) {
                            const proceed = (...a) => (origFn ? origFn.apply(this, a.length ? a : ctx.args) : undefined);
                            ctx.result = around.around.call(this, ctx, proceed);
                            if (around.once) unpatch(target, prop, around.id);
                        } else if (origFn) {
                            ctx.result = origFn.apply(this, ctx.args);
                        }
                    } catch (err) { ctx.error = err; }
                }
                for (const h of hooks) {
                    if (!h.after) continue;
                    callHook(h, 'after', this, ctx, prop);
                    if (h.once) unpatch(target, prop, h.id);
                }
                if (ctx.error) throw ctx.error;
                return ctx.result;
            };

            wrapper.__isPatched = true;
            wrapper.__original = origFn;
            state.wrapper = wrapper;
            target[prop] = wrapper;
        };

        const applyPropertyPatch = (target, prop, state) => {
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
        };

        const patch = (target, prop, optionsOrFn) => {
            if (!target || !prop) return null;
            const opts = typeof optionsOrFn === 'function' ? { instead: optionsOrFn } : (optionsOrFn || {});
            const state = getOrCreateState(target, prop);

            const hook = { id: Symbol('patch_hook'), once: !!opts.once };
            HOOK_KEYS.forEach((k) => { hook[k] = typeof opts[k] === 'function' ? opts[k] : null; });
            state.hooks.push(hook);

            if (state.type === 'method' && target[prop] !== state.wrapper) {
                wrapMethod(target, prop, state);
            } else if (state.type === 'property' || opts.getter || opts.setter) {
                applyPropertyPatch(target, prop, state);
            }

            const unpatchFn = () => unpatch(target, prop, hook.id);
            unpatchFn.unpatch = unpatchFn;
            unpatchFn.restore = unpatchFn;
            return unpatchFn;
        };

        const before = (t, p, fn, o = {}) => patch(t, p, { before: fn, ...o });
        const after = (t, p, fn, o = {}) => patch(t, p, { after: fn, ...o });
        const around = (t, p, fn, o = {}) => patch(t, p, { around: fn, ...o });
        const instead = (t, p, fn, o = {}) => patch(t, p, { instead: fn, ...o });
        const getter = (t, p, fn, o = {}) => patch(t, p, { getter: fn, ...o });
        const setter = (t, p, fn, o = {}) => patch(t, p, { setter: fn, ...o });
        const property = (t, p, o = {}) => patch(t, p, o);

        const isPatched = (target, prop) => {
            const state = patches.get(target)?.get(prop);
            return !!(state && state.hooks.length > 0);
        };

        const getOriginal = (target, prop) => {
            const state = patches.get(target)?.get(prop);
            if (state) return state.original;
            if (target?.[prop]?.__original) return target[prop].__original;
            return target ? target[prop] : undefined;
        };

        return { patch, before, after, around, instead, getter, setter, property, unpatch, restore, restoreAll, isPatched, getOriginal };
    };

    const createNodeWatcher = ({ patcher }) => {
        let rules = [];
        let installed = false;
        const d = createDisposer();

        const testEl = (el) => {
            if (!el || el.nodeType !== 1 || typeof el.matches !== 'function') return;
            for (const r of rules) attempt(() => { if (el.matches(r.selector)) r.onMatch(el); });
        };

        const scanNode = (node) => {
            if (!node) return;
            if (node.nodeType === 11) { node.childNodes?.forEach((c) => scanNode(c)); return; }
            if (node.nodeType !== 1) return;
            testEl(node);
            if (!node.firstElementChild || typeof node.querySelectorAll !== 'function') return;
            for (const r of rules) {
                attempt(() => node.querySelectorAll(r.selector).forEach((el) => attempt(() => r.onMatch(el))));
            }
        };

        const enable = () => {
            if (installed) return;
            installed = true;
            const add = (un) => d.add(un);
            const rescan = function () {
                const el = this;
                if (typeof queueMicrotask === 'function') {
                    queueMicrotask(() => scanNode(el.parentNode || el));
                } else {
                    setTimeout(() => scanNode(el.parentNode || el), 0);
                }
            };
            const nodeProto = root?.Node?.prototype;
            if (nodeProto) {
                ['appendChild', 'insertBefore', 'replaceChild'].forEach((m) => {
                    add(patcher.before(nodeProto, m, function (ctx) {
                        if (this && !this.isConnected) return;
                        scanNode(ctx.args[0]);
                    }));
                });
            }
            const elProto = root?.Element?.prototype;
            if (elProto) {
                ['append', 'prepend', 'before', 'after', 'replaceWith'].forEach((m) => {
                    add(patcher.before(elProto, m, function (ctx) {
                        if (this && !this.isConnected) return;
                        ctx.args.forEach((a) => scanNode(a));
                    }));
                });
                add(patcher.before(elProto, 'insertAdjacentElement', function (ctx) {
                    if (this && !this.isConnected) return;
                    scanNode(ctx.args[1]);
                }));
                add(patcher.before(elProto, 'insertAdjacentHTML', rescan));
                ['innerHTML', 'outerHTML'].forEach((p) => add(patcher.setter(elProto, p, rescan)));
            }
            if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document?.documentElement) {
                const observer = new MutationObserver((ms) => {
                    for (const m of ms) {
                        if (m.type === 'attributes') testEl(m.target);
                        else m.addedNodes?.forEach((n) => scanNode(n));
                    }
                });
                observer.observe(document.documentElement, {
                    childList: true, subtree: true, attributes: true,
                    attributeFilter: ['src', 'class', 'href', 'style']
                });
                add(() => observer.disconnect());
            }
        };

        const addRule = (rule) => {
            if (!rule?.selector || typeof rule.onMatch !== 'function') return null;
            rules.push(rule);
            enable();
            return () => { rules = rules.filter((r) => r !== rule); };
        };

        const destroy = () => {
            d.run();
            rules = [];
            installed = false;
        };

        return { enable, add: addRule, destroy };
    };

    const createNetwork = ({ root: envRoot, patcher, idb, domains, db, ttlMs, gm }) => {
        let intercepted = false;
        const rules = [];
        const d = createDisposer();
        const xhrUrls = new WeakMap();
        const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        const IMG_EXT_RE = /\.(webp|png|jpe?g|gif|svg|avif|bmp|ico)$/i;

        const resolveDomain = (domainStr) => {
            if (!domainStr) return '';
            const s = String(domainStr);
            const key = s.toUpperCase();
            return domains[key] || domains[s.toLowerCase()] || s;
        };

        const parseUrl = (urlStr) => attempt(() => new URL(urlStr, typeof location !== 'undefined' ? location.origin : 'https://n.novelia.cc'), null);
        const dbOpts = () => ({ dbName: db.name, version: db.version, storeName: 'network_cache', ttlMs });
        const unwrap = (record) => (record.data !== undefined ? record.data : record);

        const saveToCache = (cacheKey, data, meta = {}) => {
            return idb.set({ key: cacheKey, data, timestamp: Date.now(), ...meta }, dbOpts());
        };

        const findByPrefix = async (queryKey) => {
            if (!queryKey) return null;
            const opts = dbOpts();
            const direct = await idb.getWithExpiry(queryKey, opts);
            if (!direct.expired && direct.record) return unwrap(direct.record);

            for (const r of await idb.getAll(opts)) {
                const k = r.key || '';
                const hit = k.includes(queryKey) || (k && queryKey.includes(k)) || r.capturedPrefix?.includes(queryKey);
                if (!hit) continue;
                const res = await idb.getWithExpiry(k, opts);
                if (!res.expired && res.record) return unwrap(res.record);
            }
            return null;
        };

        const getRightAnchorEl = (container) => {
            if (!container) return null;
            const favEl = container.querySelector('a[href*="/favorite"], button[aria-label*="收藏"], a[aria-label*="收藏"], [aria-label*="我的收藏"]');
            if (favEl) return favEl.closest('.flex.flex-none, div') || favEl;
            const accountEl = container.querySelector('.account-trigger, [class*="account-trigger"], button[aria-label*="账号"], button[aria-label*="帳號"], button[aria-label*="account" i]');
            if (accountEl) return accountEl.closest('.relative, div') || accountEl;
            return null;
        };

        const ensureStore = async (storeName, safe) => {
            if (safe) {
                return attempt(async () => {
                    const req = indexedDB.open(db.name);
                    return new Promise((resolve) => {
                        req.onsuccess = () => {
                            const dbInst = req.result;
                            const exists = dbInst.objectStoreNames.contains(storeName);
                            dbInst.close();
                            resolve(exists);
                        };
                        req.onerror = () => resolve(false);
                    });
                }, false);
            }
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(db.name);
                req.onupgradeneeded = (e) => {
                    const dbInst = e.target.result;
                    if (!dbInst.objectStoreNames.contains(storeName)) {
                        dbInst.createObjectStore(storeName, { keyPath: db.keyPath || 'key' });
                    }
                };
                req.onsuccess = () => { req.result.close(); resolve(true); };
                req.onerror = () => reject(req.error);
            });
        };

        const capture = ({ url, key, domain, as = 'json', save = 'capture_cache', safe = true, onCapture } = {}) => {
            const targetUrl = url || key;
            if (!targetUrl) return;
            rules.push({
                action: 'capture',
                url: targetUrl,
                key: key || targetUrl,
                domain: resolveDomain(domain),
                as,
                save,
                safe,
                onCapture
            });
            initInterception();
        };

        const isBlocked = (urlStr, ctx) => {
            const u = parseUrl(urlStr);
            if (!u) return false;
            for (const rule of rules) {
                if (rule.action !== 'reject') continue;
                if (rule.domain && u.hostname !== rule.domain) continue;
                const matchPattern = rule.url || rule.key;
                if (matchPattern && !u.href.includes(matchPattern) && !(u.origin + u.pathname).includes(matchPattern)) continue;
                if (rule.isImage) {
                    const isImg = IMG_EXT_RE.test(u.pathname)
                        || ctx?.destination === 'image'
                        || String(ctx?.headers?.accept || '').includes('image')
                        || u.pathname.includes('/banners/');
                    if (!isImg) continue;
                }
                attempt(() => rule.onReject?.({ url: urlStr, rule }));
                return true;
            }
            return false;
        };

        const block = (opts = {}) => {
            const options = typeof opts === 'string' ? { url: opts } : opts;
            const rule = { isImage: true, ...options, action: 'reject' };
            let targetUrl = rule.url || rule.key || '';
            let host = resolveDomain(rule.domain);
            if (!host && /^https?:/i.test(targetUrl)) {
                const u = parseUrl(targetUrl);
                if (u) { host = u.hostname; targetUrl = u.pathname + u.search; }
            }
            rule.domain = host;
            rule.url = targetUrl.replace(/\*+$/, '');
            rules.push(rule);
            initInterception();
            return rule;
        };

        const matchCaptures = (urlStr) => {
            const u = parseUrl(urlStr);
            if (!u) return [];
            const hits = [];
            for (const rule of rules) {
                if (rule.action !== 'capture') continue;
                if (rule.domain && u.hostname !== rule.domain) continue;
                const pattern = rule.url;
                if (!pattern) continue;
                if (!u.href.includes(pattern) && !(u.origin + u.pathname).includes(pattern)) continue;

                const cacheKey = typeof rule.key === 'function'
                    ? rule.key(utrimmer(u.href, pattern), u)   // rest = pattern 之後、去掉 query/hash 的字串
                    : rule.key;
                if (!cacheKey) continue;
                hits.push({ rule, cacheKey, url: u.href });
            }
            return hits;
        };

        const storeCaptures = async (hits, responseObj) => {
            for (const { rule, cacheKey, url } of hits) {
                let formattedData = responseObj;
                if (rule.as === 'json') {
                    if (typeof responseObj === 'string') {
                        formattedData = attempt(() => JSON.parse(responseObj), responseObj);
                    } else if (responseObj instanceof Blob) {
                        const txt = await responseObj.text();
                        formattedData = attempt(() => JSON.parse(txt), txt);
                    }
                } else if (rule.as === 'blob') {
                    if (typeof responseObj === 'string') {
                        formattedData = new Blob([responseObj], { type: 'application/octet-stream' });
                    }
                }

                const exists = await ensureStore(rule.save, rule.safe);
                if (rule.safe && !exists) {
                    attempt(() => rule.onCapture?.({ cacheKey, data: formattedData, url }));
                    continue;
                }

                await idb.set(
                    { key: cacheKey, data: formattedData, timestamp: Date.now(), url, domain: rule.domain },
                    { dbName: db.name, version: db.version, storeName: rule.save, ttlMs }
                );
                attempt(() => rule.onCapture?.({ cacheKey, data: formattedData, url }));
            }
        };

        const patchFetch = () => {
            if (!envRoot || typeof envRoot.fetch !== 'function') return;
            const urlOf = (input) => input?.url || String(input ?? '');

            d.add(patcher.before(envRoot, 'fetch', function (ctx) {
                const [input, init] = ctx.args;
                const url = urlOf(input);
                const h = init?.headers || input?.headers;
                const accept = h && typeof h.get === 'function' ? h.get('accept') : (h?.accept || h?.Accept);
                if (isBlocked(url, { destination: input?.destination, headers: { accept } })) {
                    ctx.cancel(Promise.reject(new TypeError(`Failed to fetch: blocked by Utils.network (${url})`)));
                }
            }));

            d.add(patcher.after(envRoot, 'fetch', function (ctx) {
                if (ctx.cancelled || typeof ctx.result?.then !== 'function') return;
                const hits = matchCaptures(urlOf(ctx.args[0]));
                if (!hits.length) return;
                ctx.result
                    .then(async (res) => {
                        if (!res.ok) return null;
                        const hasBlobRule = hits.some((h) => h.rule.as === 'blob');
                        return hasBlobRule ? res.clone().blob() : res.clone().text();
                    })
                    .then((raw) => (raw !== null ? storeCaptures(hits, raw) : undefined))
                    .catch(() => {});
            }));
        };

        const patchXhr = () => {
            const proto = envRoot?.XMLHttpRequest?.prototype;
            if (!proto) return;

            d.add(patcher.before(proto, 'open', function (ctx) {
                xhrUrls.set(this, String(ctx.args[1]));
            }));

            d.add(patcher.before(proto, 'send', function (ctx) {
                const url = xhrUrls.get(this);
                if (!url) return;
                if (isBlocked(url)) {
                    ctx.cancel();
                    setTimeout(() => {
                        this.dispatchEvent(new ProgressEvent('error'));
                        this.dispatchEvent(new ProgressEvent('loadend'));
                    }, 0);
                    return;
                }
                const hits = matchCaptures(url);
                if (hits.length) {
                    this.addEventListener('load', () => attempt(() => {
                        const resData = this.responseType === 'blob' ? this.response : this.responseText;
                        storeCaptures(hits, resData);
                    }), { once: true });
                }
            }));
        };

        const patchGM = () => {
            const candidates = [envRoot, typeof globalThis !== 'undefined' ? globalThis : null, typeof window !== 'undefined' ? window : null];
            const target = candidates.find((t) => attempt(() => t && typeof t.GM_xmlhttpRequest === 'function', false));
            if (!target) return;

            d.add(patcher.before(target, 'GM_xmlhttpRequest', function (ctx) {
                const details = ctx.args[0];
                if (details?.url && isBlocked(details.url)) {
                    ctx.cancel({ abort() {} });
                    setTimeout(() => details.onerror?.({ status: 0, statusText: 'Blocked by Utils.network' }), 0);
                }
            }));
        };

        const patchImage = () => {
            const imgProto = envRoot?.HTMLImageElement?.prototype;
            if (imgProto) {
                d.add(patcher.setter(imgProto, 'src', function (ctx) {
                    if (ctx.value && isBlocked(String(ctx.value))) ctx.value = BLANK_GIF;
                }));
            }
            const elProto = envRoot?.Element?.prototype;
            if (elProto) {
                d.add(patcher.before(elProto, 'setAttribute', function (ctx) {
                    if (this.tagName !== 'IMG' || String(ctx.args[0]).toLowerCase() !== 'src') return;
                    if (isBlocked(String(ctx.args[1]))) ctx.args[1] = BLANK_GIF;
                }));
            }
        };

        const observeImages = () => {
            if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document?.documentElement) return;
            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    const imgs = n.tagName === 'IMG' ? [n] : n.querySelectorAll('img[src]');
                    for (const img of imgs) {
                        if (img.src && isBlocked(img.src)) img.removeAttribute('src');
                    }
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            d.add(() => observer.disconnect());
        };

        const initInterception = () => {
            if (intercepted) return;
            intercepted = true;
            [patchFetch, patchXhr, patchGM, patchImage, observeImages].forEach((fn) => {
                attempt(() => fn(), null, '[Utils.network] Patch failed:');
            });
        };

        const destroy = () => {
            d.run();
            intercepted = false;
        };

        return { capture, block, isBlocked, getCached: findByPrefix, destroy };
    };

    const createFetchRaceCache = () => {
        const inflight = new Map();

        const safeRead = async (readCache, enabled) => {
            if (!enabled || typeof readCache !== 'function') return null;
            try {
                const v = await readCache();
                return v === undefined ? null : v;
            } catch (e) {
                console.warn('[Utils.fetchRaceCache] readCache failed:', e);
                return null;
            }
        };

        const safeWrite = async (writeCache, enabled, data) => {
            if (!enabled || typeof writeCache !== 'function') return;
            try { await writeCache(data); } catch (e) {
                console.warn('[Utils.fetchRaceCache] writeCache failed:', e);
            }
        };

        /**
         * @param {string} key
         * @param {object} opts
         * @param {() => Promise<any|null>} [opts.readCache]   命中回傳資料，未命中回傳 null
         * @param {({signal}) => Promise<any>} opts.fetcher    實際請求，需支援 signal
         * @param {(data) => Promise<any>} [opts.writeCache]
         * @param {boolean|(() => boolean)} [opts.enabled=true] 是否使用快取
         */
        return (key, { readCache, fetcher, writeCache, enabled = true } = {}) => {
            if (!key || typeof fetcher !== 'function') {
                return Promise.reject(new Error('fetchRaceCache: key and fetcher are required'));
            }
            const useCache = typeof enabled === 'function' ? !!enabled() : !!enabled;
            const existing = inflight.get(key);
            if (existing) {
                return safeRead(readCache, useCache).then((cached) => {
                    if (cached !== null && existing.settle(cached, 'cache')) return cached;
                    return existing.promise;
                });
            }
            const controller = new AbortController();
            let settled = false;
            let resolve, reject;
            const promise = new Promise((res, rej) => { resolve = res; reject = rej; });

            const release = () => { if (inflight.get(key) === entry) inflight.delete(key); };
            const entry = {
                promise,
                settle(value, source) {
                    if (settled) return false;
                    settled = true;
                    release();
                    if (source === 'cache') controller.abort();
                    resolve(value);
                    return true;
                },
                fail(err) {
                    if (settled) return false;
                    settled = true;
                    release();
                    reject(err);
                    return true;
                }
            };
            inflight.set(key, entry);

            (async () => {
                const cached = await safeRead(readCache, useCache);
                if (settled) return;
                if (cached !== null) { entry.settle(cached, 'cache'); return; }
                try {
                    const data = await fetcher({ signal: controller.signal });
                    if (entry.settle(data, 'network')) await safeWrite(writeCache, useCache, data);
                } catch (e) {
                    entry.fail(e);
                }
            })();

            return promise;
        };
    };

    const createBlobFetcher = ({ fetchRaceCache, cache, download, isBlocked, ttlMs, useCache = () => typeof window !== 'undefined' && window.top === window.self }) => {
        const toBlob = (v, mimeType) => {
            if (v instanceof Blob) return v;
            if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return new Blob([v], { type: mimeType || 'image/webp' });
            return null;
        };

        return (url, { ttlMs: customTtl = ttlMs, cacheKey = null, mimeType = null } = {}) => {
            if (!url) return Promise.reject(new Error('URL is required'));
            if (isBlocked?.(url)) return Promise.reject(new Error(`Blocked by network (${url})`));

            const key = cacheKey || `img_blob_${url}`;
            return fetchRaceCache(key, {
                enabled: useCache,
                readCache: async () => toBlob(await cache.idb.get(key, { ttlMs: customTtl }), mimeType),
                fetcher: ({ signal }) => download(url, { mimeType, signal }),
                writeCache: (blob) => cache.idb.set(key, blob)
            });
        };
    };

    const createBlobUrlStore = (getBlob, label = 'Utils.blobUrl') => {
        const blobUrls = {};
        const promises = {};

        const getUrl = (url, options = {}) => {
            if (!url) return Promise.resolve('');
            if (blobUrls[url]) return Promise.resolve(blobUrls[url]);
            if (!promises[url]) {
                promises[url] = (async () => {
                    try {
                        const objUrl = URL.createObjectURL(await getBlob(url, options));
                        blobUrls[url] = objUrl;
                        return objUrl;
                    } catch (e) {
                        console.error(`[${label}] Failed to fetch or load (${url}):`, e);
                        blobUrls[url] = url;
                        return url;
                    }
                })();
            }
            return promises[url];
        };
        const getSyncUrl = (url) => (url ? (blobUrls[url] || url) : '');
        return { getUrl, getSyncUrl };
    };

    const createImageCache = ({ getBlob, ttlMs }) => {
        const urls = createBlobUrlStore(getBlob, 'Utils.imageCache');
        return { getBlob, getUrl: urls.getUrl, getSyncUrl: urls.getSyncUrl, DEFAULT_TTL: ttlMs };
    };

    const mascot = (cfg, { getBlob }) => {
        const url = `https://${cfg.domains.main}${cfg.assets.mascotPath}`;
        const opts = { cacheKey: cfg.keys.mascotBlob, ttlMs: cfg.ttl.image };
        const urls = createBlobUrlStore(getBlob, 'Utils.mascot');
        return {
            url,
            CACHE_KEY: cfg.keys.mascotBlob,
            CACHE_TTL: cfg.ttl.image,
            getBlob: () => getBlob(url, opts),
            getUrl: () => urls.getUrl(url, opts),
            getSyncUrl: () => urls.getSyncUrl(url)
        };
    };

    const icon14 = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;">${inner}</svg>`;
    const mdIcon = (size, path) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${path}" fill="currentColor"></path></svg>`;
    const POPOUT_PATH = 'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83l1.41 1.41L19 6.41V10h2V3h-7z';

    const icons = {
        REFRESH: icon14('<polyline points="23 4 23 10 18 10"></polyline><polyline points="1 20 1 14 6 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>'),
        BULK: icon14('<rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>'),
        CLEAR: icon14('<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>'),
        VIEW: icon14('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>'),
        COPY: icon14('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>'),
        CHEVRON: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"></path></svg>',
        DRAWER: mdIcon(24, 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z'),
        POPOUT: mdIcon(20, POPOUT_PATH),
        RELOAD_CIRCLE: mdIcon(20, 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z'),
        STAR_OUTLINE: mdIcon(20, 'M22 9.24l-7.19-.62L12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21L12 17.27L18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27l1-4.28l-3.32-2.88l4.38-.38L12 6.1l1.71 4.04l4.38.38l-3.32 2.88l1 4.28L12 15.4z')
    };

    const LIST_PREFIXES = ['/novel', '/favorite', '/wenku', '/search', '/read-history'];

    const createRouter = ({ root: envRoot, patcher, domains, events }) => {
        let initDone = false;

        const init = () => {
            if (initDone) return;
            initDone = true;
            if (envRoot?.history) {
                ['pushState', 'replaceState'].forEach((m) => patcher.after(envRoot.history, m, () => fireWindowEvent(events.locationChange)));
            }
            if (typeof window !== 'undefined') {
                window.addEventListener('popstate', () => fireWindowEvent(events.locationChange));
            }
        };

        const getPath = () => {
            if (envRoot?.__noveliaMockPath) return envRoot.__noveliaMockPath;
            if (typeof location !== 'undefined') return location.pathname + location.search + location.hash;
            return '/';
        };

        const getPathname = () => getPath().split('?')[0].split('#')[0];

        const getRouter = () => attempt(() => {
            if (typeof document === 'undefined') return null;
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
            return envRoot.__vue_app__?.config?.globalProperties?.$router
                || (typeof envRoot.router?.push === 'function' ? envRoot.router : null);
        }, null);

        const parseNovelPath = (pathname) => {
            const novel = pathname.match(/^\/novel\/([^\/?#]+)\/([^\/?#]+)\/?$/i);
            if (novel) return { source: novel[1], id: novel[2] };
            const wenku = pathname.match(/^\/wenku\/([^\/?#]+)\/?$/i);
            return wenku ? { source: 'wenku', id: wenku[1] } : null;
        };

        const isForumPage = () => {
            const p = getPath();
            return p === '/forum' || p.startsWith('/forum/') || p.startsWith('/forum?');
        };

        const isForumUrl = (href) => {
            if (!href) return false;
            try {
                const u = new URL(href, typeof location !== 'undefined' ? location.origin : 'https://n.novelia.cc');
                return u.hostname === domains.forum
                    || (typeof location !== 'undefined' && u.hostname === location.hostname && (u.pathname === '/forum' || u.pathname.startsWith('/forum/')));
            } catch (e) {
                return new RegExp('^https?:\\/\\/' + domains.forum.replace(/\./g, '\\.'), 'i').test(href)
                    || href === '/forum' || href.startsWith('/forum/');
            }
        };

        const isNovelPage = () => {
            const p = getPathname();
            return /^\/novel\/[^\/]+\/[^\/]+\/?$/i.test(p) || /^\/wenku\/[^\/]+\/?$/i.test(p);
        };

        const isListPage = () => {
            const p = getPathname();
            if (/^\/novel\/[^\/]+\/[^\/]+\/[^\/]+/i.test(p)) return false;
            return p === '/' || LIST_PREFIXES.some((pre) => p.startsWith(pre));
        };

        const isListPageExceptNovelDetail = () => {
            return isListPage() && !/^\/novel\/[^\/]+\/[^\/]+\/?$/.test(getPathname());
        };

        const isCommentableDetailPage = () => {
            const p = getPathname();
            const host = typeof location !== 'undefined' ? location.hostname : '';
            if (host === domains.main) {
                return /^\/novel\/[^\/]+\/[^\/]+\/?$/i.test(p)
                    || /^\/wenku\/[^\/]+\/?$/i.test(p)
                    || /^\/forum\/p\/[^\/]+\/?$/i.test(p);
            }
            return host === domains.forum && /^\/p\/[^\/]+\/?$/i.test(p);
        };

        const push = (path) => {
            if (!path) return;
            const fallback = () => {
                if (getPath() !== path) {
                    history.pushState({}, '', path);
                    fireWindowEvent('popstate');
                }
            };
            if (isForumPage() && isForumUrl(path)) {
                if (getPath() !== path) history.pushState({}, '', path);
                fireWindowEvent(events.locationChange);
                return;
            }
            const r = getRouter();
            if (r && typeof r.push === 'function') {
                try {
                    const res = r.push(path);
                    if (res && typeof res.catch === 'function') res.catch(fallback);
                } catch (e) { history.pushState({}, '', path); fireWindowEvent('popstate'); }
            } else {
                history.pushState({}, '', path);
                fireWindowEvent('popstate');
            }
            fireWindowEvent(events.locationChange);
        };
        const onChange = (callback) => {
            init();
            if (typeof window !== 'undefined') {
                ['popstate', 'hashchange', events.locationChange].forEach((ev) => window.addEventListener(ev, callback));
            }
        };
        return { onChange, getRouter, parseNovelPath, isNovelPage, isForumPage, isForumUrl, isListPage, isListPageExceptNovelDetail, isCommentableDetailPage, push, getPath, getPathname, init, utrimmer };
    };

    const SIDEBAR_SEL = '.web-kit-sidebar, .sidebar-shell, .n-layout-sider, .n-layout-sidebar, aside';
    const MENU_ITEM_SEL = '.web-kit-sidebar-item, .n-menu-item, [role="menuitem"]';
    const NON_SIDEBAR_SEL = 'header, .n-layout-header, main, .n-layout-content, .layout-content, .novel-page-content, #banner, .n-card, .n-grid, .n-breadcrumb, [aria-label*="Breadcrumb"], [aria-label*="面包屑"]';
    const SIDEBAR_CONTAINER_SEL = 'aside, .web-kit-sidebar, .sidebar-shell, .n-layout-sider, .n-layout-sidebar, .n-menu, .n-drawer, nav[aria-label="站点导航"], nav[aria-label="站點導航"], nav[aria-label="侧边栏"], nav[aria-label="側邊欄"]';
    const INJECT_MODES = { replace: 'replaceWith', before: 'before', after: 'after', append: 'appendChild', prepend: 'prepend' };

    const createSidebar = ({ isForumUrl }) => {
        const getElement = () => (typeof document !== 'undefined' ? document.querySelector(SIDEBAR_SEL) : null);

        const isMenuItem = (a) => {
            if (!a) return false;
            if (!a.closest('.n-drawer') && a.closest(NON_SIDEBAR_SEL)) return false;
            return !!(a.closest(MENU_ITEM_SEL) || a.closest(SIDEBAR_CONTAINER_SEL));
        };

        const getMenuItems = (container = null) => {
            const rootEl = container || getElement() || (typeof document !== 'undefined' ? document.querySelector('.n-drawer') : null);
            if (!rootEl) return [];

            const items = [];
            const seen = new Set();
            for (const rawEl of rootEl.querySelectorAll(`${MENU_ITEM_SEL}, a[href], button`)) {
                if (!container && !isMenuItem(rawEl)) continue;
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
        };

        const findForumMenuItem = () => {
            const buttons = getMenuItems();
            return buttons.find((i) => isForumUrl(i.href))
                || buttons.find((i) => i.name.includes('论坛') || i.name.includes('論壇'))
                || null;
        };

        const findMenuItem = (target = null) => {
            if (!target) return findForumMenuItem();
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
            return matcher ? (getMenuItems().find(matcher) || null) : findForumMenuItem();
        };

        const inject = (targetElement, contentElement, mode = 'replace') => {
            if (!targetElement || !contentElement) return false;
            return attempt(() => {
                targetElement[INJECT_MODES[mode] || INJECT_MODES.replace](contentElement);
                return true;
            }, false, '[Utils.sidebar.inject] Injection failed:');
        };

        const isAvailable = () => {
            const el = getElement();
            if (!el || !el.isConnected) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && (rect.width > 0 || rect.height > 0);
        };

        const observeAvailability = (callback) => {
            if (typeof callback !== 'function' || typeof document === 'undefined') return () => {};
            let last = isAvailable();
            callback(last, getElement());
            const observer = new MutationObserver(() => {
                const now = isAvailable();
                if (now !== last) { last = now; callback(now, getElement()); }
            });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
            return () => observer.disconnect();
        };

        return { getElement, isMenuItem, getMenuItems, findForumMenuItem, findMenuItem, inject, isAvailable, observeAvailability };
    };

    const CLOSE_BTN_SEL = 'button[aria-label*="关闭导航菜单"], button[aria-label*="關閉導航菜單"], button[aria-label*="关闭"], button[aria-label*="關閉"]';
    const OPEN_TOGGLE_SEL = 'button.layout-toggle[aria-expanded="true"], button[aria-label*="导航菜单"][aria-expanded="true"], button[aria-label*="導航菜單"][aria-expanded="true"]';
    const ANY_TOGGLE_SEL = 'button.layout-toggle, button[aria-label*="导航菜单"], button[aria-label*="導航菜單"], header button, .n-layout-header button, nav.n-layout-header button, .n-layout-sider-toggle-button, .sidebar-collapse';

    const createSidebarState = ({ sidebar, store, key }) => {
        const isCollapsed = (sider = null) => {
            const el = sider || sidebar.getElement();
            if (el) {
                if (el.classList.contains('web-kit-sidebar')) return el.classList.contains('is-collapsed');
                if (el.classList.contains('n-layout-sider--collapsed') || el.offsetWidth < 120) return true;
                const btn = document.querySelector('.sidebar-collapse');
                if (btn && (btn.getAttribute('aria-expanded') === 'false'
                    || btn.getAttribute('aria-label')?.includes('展开')
                    || btn.getAttribute('title')?.includes('展开'))) return true;
            }
            return !!document.querySelector('.n-menu.n-menu--collapsed');
        };

        const closeOnMobile = () => {
            if (typeof window === 'undefined' || window.innerWidth > 768) return;
            const closeBtn = document.querySelector(CLOSE_BTN_SEL);
            if (closeBtn) return closeBtn.click();
            const mask = document.querySelector('.n-drawer-mask');
            if (mask) return mask.click();

            const openDrawer = document.querySelector('.n-drawer, [role="dialog"][class*="drawer"]');
            const openToggle = document.querySelector(OPEN_TOGGLE_SEL);
            if (openDrawer || openToggle) (openToggle || document.querySelector(ANY_TOGGLE_SEL))?.click();
        };

        const syncSubmenu = (submenuDiv = null) => {
            const submenu = submenuDiv || document.querySelector('.novelia-forum-submenu');
            if (!submenu) return;
            const collapsed = isCollapsed();

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
            const wantExpanded = !collapsed && store.getString(key) === 'true';
            children.classList.toggle('flex', wantExpanded);
            children.classList.toggle('hidden', !wantExpanded);
            submenu.querySelector('button')?.setAttribute('aria-expanded', String(wantExpanded));
        };

        const observeToggle = (sider = null, callback = null) => {
            const target = sider || sidebar.getElement();
            if (!target || target.dataset.noveliaSiderObserverAttached) return;
            target.dataset.noveliaSiderObserverAttached = '1';
            new MutationObserver(() => {
                syncSubmenu();
                if (typeof callback === 'function') callback(isCollapsed(target));
            }).observe(target, { attributes: true, attributeFilter: ['class', 'style', 'aria-expanded'] });
        };

        return { isCollapsed, closeOnMobile, syncSubmenu, observeToggle };
    };

    const COMMENT_SECTION_SEL = 'section.comment-list, section[aria-label*="评论"], section[aria-label*="評論"]';
    const REPLY_INDENT_SEL = 'div[style*="margin-left: 32px"]';

    const createComments = ({ icons }) => {
        const getNovelPane = () => {
            if (typeof document === 'undefined') return null;
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
        };

        const getNovelFloors = (paneElement = null) => {
            const pane = paneElement || getNovelPane();
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
        };

        const getForumFloors = () => {
            if (typeof document === 'undefined') return { floorContainer: null, candidateFloors: [], floors: [] };
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
        };

        const createCollapsibleReplies = ({ anchorCard, repliesArea, isCollapsedState, replyCount, onToggleState }) => {
            if (!anchorCard || !repliesArea) return null;
            const label = (c) => `${c ? '展開回覆' : '收起回覆'} (${replyCount})`;
            const stateCls = (c) => (c ? 'collapsed' : 'expanded');

            const btnWrapper = document.createElement('div');
            btnWrapper.className = 'novelia-collapse-btn-wrapper';
            const btn = Object.assign(document.createElement('button'), {
                className: 'novelia-collapse-btn',
                type: 'button',
                innerHTML: `<span class="novelia-collapse-icon ${stateCls(isCollapsedState)}">${icons.CHEVRON}</span>
                             <span class="novelia-collapse-btn-text">${label(isCollapsedState)}</span>`
            });
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
                const txt = btn.querySelector('.novelia-collapse-btn-text');
                if (txt) txt.innerText = label(next);
                if (typeof onToggleState === 'function') onToggleState(next);
            });
            btn.addEventListener('mouseup', () => btn.blur());

            const nativeReplyBtn = Array.from(anchorCard.querySelectorAll('button'))
                .find((b) => b.innerText.includes('回复') || b.innerText.includes('回覆'));
            nativeReplyBtn?.addEventListener('click', () => {
                if (wrapper.classList.contains('collapsed')) btn.click();
            });
            return { btnWrapper, wrapper, inner };
        };

        return {
            novel: { getPane: getNovelPane, getFloors: getNovelFloors },
            forum: { getFloors: getForumFloors },
            createCollapsibleReplies
        };
    };

    const initModalStyles = (gm) => {
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
    };

    const createGenericUi = (gm) => {
        let modalStylesInitialized = false;

        const createToast = (className = 'novelia-toast') => {
            if (typeof document === 'undefined') return { show() {} };
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
        };

        const createModal = ({ id = '', title = '', tabs = [], onClose = null } = {}) => {
            if (typeof document === 'undefined') return null;
            if (!modalStylesInitialized) {
                initModalStyles(gm);
                modalStylesInitialized = true;
            }

            const backdrop = document.createElement('div');
            backdrop.className = `novelia-modal-backdrop ${id}`.trim();

            let tabsHtml = '';
            if (Array.isArray(tabs) && tabs.length > 0) {
                tabsHtml = `<div class="novelia-modal-tabs">` + tabs.map((t, idx) => `
                    <div class="novelia-modal-tab ${idx === 0 ? 'active' : ''}" data-tab="${t.id}">${text.escapeHtml(t.label)}</div>
                `).join('') + `</div>`;
            }

            backdrop.innerHTML = `
                <div class="novelia-modal-dialog">
                    <div class="novelia-modal-header">
                        <div class="novelia-modal-title"><span>${text.escapeHtml(title)}</span></div>
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
        };

        return { createToast, createModal };
    };

    const createSiteUi = ({ domains, router }) => {
        const isDark = () => {
            if (typeof document === 'undefined') return false;
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
        };

        const theme = { isDark };

        const getForumHeader = () => (typeof document !== 'undefined' ? document.querySelector('header, .forum-header, nav[aria-label="站点导航"], nav[aria-label="站點導航"], nav') : null);

        const getThemeButton = (container = null) => {
            if (typeof document === 'undefined') return null;
            return (container || document).querySelector('button[aria-label*="主题"], button[title*="主题"], button[aria-label*="主題"], button[title*="主題"], button[aria-label*="theme" i], button[title*="theme" i]');
        };

        const getElementOrder = (el) => {
            if (!el) return Infinity;
            if (el.dataset && el.dataset.order !== undefined) {
                const parsed = parseFloat(el.dataset.order);
                if (!isNaN(parsed)) return parsed;
            }
            return Infinity;
        };

        const findNextOrderedHeaderButton = (container, targetOrder) => {
            if (!container || targetOrder === undefined || targetOrder === null) return null;
            const existingButtons = Array.from(container.querySelectorAll('[data-order]'));
            for (const existingBtn of existingButtons) {
                if (existingBtn.parentElement !== container) continue;
                const existingOrder = getElementOrder(existingBtn);
                if (existingOrder > targetOrder) {
                    return existingBtn;
                }
            }
            return null;
        };

        const getRightAnchorEl = (container) => {
            if (!container) return null;
            const favEl = container.querySelector('a[href*="/favorite"], button[aria-label*="收藏"], a[aria-label*="收藏"], [aria-label*="我的收藏"]');
            if (favEl) {
                return favEl.closest('.flex.flex-none, div') || favEl;
            }
            const accountEl = container.querySelector('.account-trigger, [class*="account-trigger"], button[aria-label*="账号"], button[aria-label*="帳號"], button[aria-label*="account" i]');
            if (accountEl) {
                return accountEl.closest('.relative, div') || accountEl;
            }
            return null;
        };

        const createNaiveButton = ({ id = '', className = '', title = '', iconSvg = '', iconSize = 20, margin = '0px 4px', marginRight = null, position = 'right', order = 0, onClick = null } = {}) => {
            if (typeof document === 'undefined') return null;
            const btn = document.createElement('button');
            if (id) btn.id = id;
            btn.className = `${id} __button-dark-131ezvy-ehllmd n-button n-button--default-type n-button--large-type ${className}`.trim();
            btn.type = 'button';
            btn.dataset.position = position;
            if (order !== undefined && order !== null) {
                btn.dataset.order = String(order);
            }
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
        };

        const injectNaiveHeaderButton = (buttonOrOptions, position = 'right', order = 0) => {
            if (typeof document === 'undefined') return null;
            const forumHeader = getForumHeader();
            if (!forumHeader) return null;

            let btnElement = null;
            let btnId = '';

            if (buttonOrOptions instanceof Element) {
                btnElement = buttonOrOptions;
                btnId = btnElement.id || (typeof btnElement.className === 'string' ? btnElement.className.split(/\s+/)[0] : '');
                if (btnElement.dataset.position) position = btnElement.dataset.position;
                if (btnElement.dataset.order !== undefined) {
                    const parsed = parseFloat(btnElement.dataset.order);
                    if (!isNaN(parsed)) order = parsed;
                }
            } else if (typeof buttonOrOptions === 'object' && buttonOrOptions !== null) {
                btnId = buttonOrOptions.id || (buttonOrOptions.className ? buttonOrOptions.className.split(/\s+/)[0] : '');
                if (buttonOrOptions.position) position = buttonOrOptions.position;
                if (buttonOrOptions.order !== undefined) {
                    const parsed = parseFloat(buttonOrOptions.order);
                    if (!isNaN(parsed)) order = parsed;
                }
                btnElement = createNaiveButton(buttonOrOptions);
            }

            if (!btnElement) return null;

            if (position !== 'left' && position !== 'center' && position !== 'right') {
                position = 'right';
            }
            btnElement.dataset.position = position;
            btnElement.dataset.order = String(order);

            if (btnId) {
                const existing = forumHeader.querySelector(`#${btnId}, .${btnId}`);
                if (existing) return existing;
            }

            if (position === 'left') {
                let leftContainer = forumHeader.querySelector('.novelia-header-left');
                if (!leftContainer) {
                    leftContainer = document.createElement('div');
                    leftContainer.className = 'novelia-header-left';
                    leftContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';
                    forumHeader.prepend(leftContainer);
                }
                const nextOrderedBtn = findNextOrderedHeaderButton(leftContainer, order);
                if (nextOrderedBtn) {
                    leftContainer.insertBefore(btnElement, nextOrderedBtn);
                } else {
                    leftContainer.appendChild(btnElement);
                }
            } else if (position === 'center') {
                let centerContainer = forumHeader.querySelector('.novelia-header-center');
                if (!centerContainer) {
                    centerContainer = document.createElement('div');
                    centerContainer.className = 'novelia-header-center';
                    centerContainer.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 4px; margin: 0 auto;';
                    const accountEl = forumHeader.querySelector('.account-trigger, [class*="account-trigger"], .n-avatar, [class*="user-menu"]')?.closest('.relative, div') || forumHeader.querySelector('.account-trigger, [class*="account-trigger"], .n-avatar');
                    if (accountEl) forumHeader.insertBefore(centerContainer, accountEl);
                    else forumHeader.appendChild(centerContainer);
                }
                const nextOrderedBtn = findNextOrderedHeaderButton(centerContainer, order);
                if (nextOrderedBtn) {
                    centerContainer.insertBefore(btnElement, nextOrderedBtn);
                } else {
                    centerContainer.appendChild(btnElement);
                }
            } else {
                const rightAnchorEl = getRightAnchorEl(forumHeader);
                const nextOrderedBtn = findNextOrderedHeaderButton(forumHeader, order);

                if (nextOrderedBtn) {
                    forumHeader.insertBefore(btnElement, nextOrderedBtn);
                } else if (rightAnchorEl && rightAnchorEl.parentElement === forumHeader) {
                    forumHeader.insertBefore(btnElement, rightAnchorEl);
                } else if (rightAnchorEl && rightAnchorEl.closest('header, nav') === forumHeader) {
                    rightAnchorEl.before(btnElement);
                } else {
                    const themeBtn = getThemeButton(forumHeader);
                    if (themeBtn) themeBtn.before(btnElement);
                    else forumHeader.appendChild(btnElement);
                }
            }
            return btnElement;
        };

        const createMainHeaderButton = ({ id = '', className = '', title = '', iconSvg = '', position = 'right', order = 0, onClick = null } = {}) => {
            if (typeof document === 'undefined') return null;
            const btn = Object.assign(document.createElement('button'), {
                type: 'button',
                id,
                className: `${id} grid size-8 flex-none place-items-center rounded p-1.5 hover:bg-hover hover:text-ink transition-colors ${className}`.trim(),
                title,
                innerHTML: iconSvg || ''
            });
            btn.dataset.position = position;
            if (order !== undefined && order !== null) {
                btn.dataset.order = String(order);
            }
            if (title) {
                btn.setAttribute('aria-label', title);
            }
            if (typeof onClick === 'function') {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onClick(e);
                });
            }
            return btn;
        };

        const createMainHeaderCollapser = ({ id = '', className = '', title = '', iconSvg = '', position = 'right', order = 0, onClick = null, buttons = [] } = {}) => {
            if (typeof document === 'undefined') return null;

            gm.addStyle(`
                .novelia-header-collapser-panel { position: fixed; z-index: 9999; min-width: 150px; padding: 4px; border-radius: 8px; background-color: var(--color-bg-popover, #ffffff); color: var(--color-text, #333333); border: 1px solid rgba(0, 0, 0, 0.12); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15); display: none; flex-direction: column; gap: 2px; }
                .dark .novelia-header-collapser-panel, [data-theme="dark"] .novelia-header-collapser-panel, body.dark .novelia-header-collapser-panel { background-color: var(--color-bg-popover, #242428); color: rgba(255, 255, 255, 0.9); border-color: rgba(255, 255, 255, 0.15); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); }
                .novelia-header-collapser-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; cursor: pointer; user-select: none; transition: background-color 0.15s ease, color 0.15s ease; font-size: 13px; }
                .novelia-header-collapser-item:hover { background-color: rgba(0, 0, 0, 0.06); }
                .dark .novelia-header-collapser-item:hover, [data-theme="dark"] .novelia-header-collapser-item:hover, body.dark .novelia-header-collapser-item:hover { background-color: rgba(255, 255, 255, 0.1); }
            `, 'novelia-collapser-styles');

            const mountedButtons = [];

            const isElement = (el) => (typeof Element !== 'undefined' && el instanceof Element) || (el && typeof el === 'object' && el.nodeType === 1);

            const normalizeButton = (btnOrOpts) => {
                if (!btnOrOpts) return null;
                if (isElement(btnOrOpts)) {
                    const iconEl = btnOrOpts.querySelector('i, svg');
                    const iconSvgStr = iconEl ? iconEl.outerHTML : (btnOrOpts.innerHTML || '');
                    const titleStr = btnOrOpts.title || btnOrOpts.getAttribute('aria-label') || btnOrOpts.textContent.trim() || '';
                    const parsedOrder = parseFloat(btnOrOpts.dataset?.order);
                    return {
                        id: btnOrOpts.id || '',
                        title: titleStr,
                        iconSvg: iconSvgStr,
                        order: !isNaN(parsedOrder) ? parsedOrder : 0,
                        onClick: (e) => btnOrOpts.click(),
                        rawElement: btnOrOpts
                    };
                }
                if (typeof btnOrOpts === 'object') {
                    return {
                        id: btnOrOpts.id || '',
                        title: btnOrOpts.title || '',
                        iconSvg: btnOrOpts.iconSvg || '',
                        order: btnOrOpts.order !== undefined && btnOrOpts.order !== null ? Number(btnOrOpts.order) : 0,
                        onClick: typeof btnOrOpts.onClick === 'function' ? btnOrOpts.onClick : null,
                        rawElement: null
                    };
                }
                return null;
            };

            const panel = Object.assign(document.createElement('div'), {
                className: 'novelia-header-collapser-panel',
                id: id ? `${id}-panel` : ''
            });
            document.body.appendChild(panel);

            const renderPanel = () => {
                panel.innerHTML = '';
                const sorted = [...mountedButtons].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                sorted.forEach((item) => {
                    const row = Object.assign(document.createElement('div'), {
                        className: 'novelia-header-collapser-item'
                    });
                    if (item.id) row.dataset.itemId = item.id;

                    if (item.iconSvg) {
                        const iconSpan = Object.assign(document.createElement('span'), {
                            className: 'grid size-5 flex-none place-items-center',
                            innerHTML: item.iconSvg
                        });
                        row.appendChild(iconSpan);
                    }

                    if (item.title) {
                        const titleSpan = Object.assign(document.createElement('span'), {
                            className: 'truncate flex-1',
                            textContent: item.title
                        });
                        row.appendChild(titleSpan);
                    }

                    row.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        closePanel();
                        if (typeof item.onClick === 'function') {
                            item.onClick(e);
                        } else if (isElement(item.rawElement)) {
                            item.rawElement.click();
                        }
                    });
                    panel.appendChild(row);
                });
            };

            const openPanel = () => {
                renderPanel();
                panel.style.display = 'flex';
                const rect = btn.getBoundingClientRect();
                const panelWidth = panel.offsetWidth || 150;
                let left = rect.right - panelWidth;
                if (left < 10) left = rect.left;
                const top = rect.bottom + 6;
                panel.style.top = `${top}px`;
                panel.style.left = `${Math.max(10, left)}px`;
            };

            const closePanel = () => {
                panel.style.display = 'none';
            };

            const togglePanel = () => {
                if (panel.style.display === 'flex') {
                    closePanel();
                } else {
                    openPanel();
                }
            };

            const btn = createMainHeaderButton({
                id,
                className,
                title,
                iconSvg,
                position,
                order,
                onClick: (e) => {
                    if (typeof onClick === 'function') onClick(e);
                    togglePanel();
                }
            });

            if (!btn) {
                panel.remove();
                return null;
            }

            const addButton = (btnOrOpts) => {
                const normalized = normalizeButton(btnOrOpts);
                if (normalized) {
                    mountedButtons.push(normalized);
                    if (panel.style.display === 'flex') renderPanel();
                }
                return collapser;
            };

            const removeButton = (idOrBtn) => {
                const targetId = typeof idOrBtn === 'string' ? idOrBtn : (idOrBtn?.id || '');
                const idx = mountedButtons.findIndex((b) => (targetId && b.id === targetId) || b.rawElement === idOrBtn);
                if (idx !== -1) {
                    mountedButtons.splice(idx, 1);
                    if (panel.style.display === 'flex') renderPanel();
                }
                return collapser;
            };

            const clearButtons = () => {
                mountedButtons.length = 0;
                if (panel.style.display === 'flex') renderPanel();
                return collapser;
            };

            const handleOutsideClick = (e) => {
                if (panel.style.display === 'flex' && !btn.contains(e.target) && !panel.contains(e.target)) {
                    closePanel();
                }
            };
            document.addEventListener('click', handleOutsideClick, true);

            const collapser = Object.assign(btn, {
                panel,
                addButton,
                add: addButton,
                mount: addButton,
                removeButton,
                remove: removeButton,
                clearButtons,
                clear: clearButtons,
                open: openPanel,
                close: closePanel,
                toggle: togglePanel,
                getButtons: () => [...mountedButtons]
            });

            if (Array.isArray(buttons)) {
                buttons.forEach((b) => addButton(b));
            }

            return collapser;
        };

        const injectMainHeaderButton = (buttonOrOptions, position = 'right', order = 0) => {
            if (typeof location === 'undefined' || location.hostname !== domains.main) return null;
            const headerEl = document.querySelector('header');
            if (!headerEl) return null;

            let btnElement = null;
            let btnId = '';

            if (buttonOrOptions instanceof Element) {
                btnElement = buttonOrOptions;
                btnId = btnElement.id || (typeof btnElement.className === 'string' ? btnElement.className.split(/\s+/)[0] : '');
                if (btnElement.dataset.position) position = btnElement.dataset.position;
                if (btnElement.dataset.order !== undefined) {
                    const parsed = parseFloat(btnElement.dataset.order);
                    if (!isNaN(parsed)) order = parsed;
                }
            } else if (typeof buttonOrOptions === 'object' && buttonOrOptions !== null) {
                btnId = buttonOrOptions.id || (buttonOrOptions.className ? buttonOrOptions.className.split(/\s+/)[0] : '');
                if (buttonOrOptions.position) position = buttonOrOptions.position;
                if (buttonOrOptions.order !== undefined) {
                    const parsed = parseFloat(buttonOrOptions.order);
                    if (!isNaN(parsed)) order = parsed;
                }
                btnElement = createMainHeaderButton(buttonOrOptions);
            }
            if (!btnElement) return null;
            if (position !== 'left' && position !== 'center' && position !== 'right') position = 'right';
            btnElement.dataset.position = position;
            btnElement.dataset.order = String(order);

            if (btnId) {
                const existing = headerEl.querySelector(`#${btnId}, .${btnId}`);
                if (existing) return existing;
            }

            if (position === 'left') {
                let leftContainer = headerEl.querySelector('.novelia-header-left');
                if (!leftContainer) {
                    leftContainer = document.createElement('div');
                    leftContainer.className = 'novelia-header-left flex items-center gap-1 flex-none';
                    const rightContainer = headerEl.querySelector('.ml-auto.flex, .ml-auto');
                    if (rightContainer) headerEl.insertBefore(leftContainer, rightContainer);
                    else headerEl.prepend(leftContainer);
                }
                const nextOrderedBtn = findNextOrderedHeaderButton(leftContainer, order);
                if (nextOrderedBtn) leftContainer.insertBefore(btnElement, nextOrderedBtn);
                else leftContainer.appendChild(btnElement);

            } else if (position === 'center') {
                let centerContainer = headerEl.querySelector('.novelia-header-center');
                if (!centerContainer) {
                    centerContainer = document.createElement('div');
                    centerContainer.className = 'novelia-header-center flex items-center justify-center gap-1 mx-auto flex-1';
                    const rightContainer = headerEl.querySelector('.ml-auto.flex, .ml-auto');
                    if (rightContainer) headerEl.insertBefore(centerContainer, rightContainer);
                    else headerEl.appendChild(centerContainer);
                }
                const nextOrderedBtn = findNextOrderedHeaderButton(centerContainer, order);
                if (nextOrderedBtn) centerContainer.insertBefore(btnElement, nextOrderedBtn);
                else centerContainer.appendChild(btnElement);
            } else {
                const rightContainer = headerEl.querySelector('.ml-auto.flex, .ml-auto') || headerEl;
                const nextOrderedBtn = findNextOrderedHeaderButton(rightContainer, order);
                const rightAnchorEl = getRightAnchorEl(rightContainer);

                if (nextOrderedBtn) {
                    rightContainer.insertBefore(btnElement, nextOrderedBtn);
                } else if (rightAnchorEl && rightAnchorEl.parentElement === rightContainer) {
                    rightContainer.insertBefore(btnElement, rightAnchorEl);
                } else if (rightAnchorEl) {
                    rightAnchorEl.before(btnElement);
                } else {
                    rightContainer.appendChild(btnElement);
                }
            }
            return btnElement;
        };

        const getForumDropdown = (subItems, onItemClick = null) => {
            if (typeof document === 'undefined') return null;
            let popover = document.getElementById('novelia-forum-popover');
            if (popover) return popover;

            popover = Object.assign(document.createElement('div'), {
                id: 'novelia-forum-popover',
                className: 'novelia-forum-dropdown-popover'
            });

            subItems.forEach((item) => {
                const div = Object.assign(document.createElement('div'), {
                    className: 'novelia-forum-dropdown-item',
                    innerHTML: `${item.icon}<span>${item.name}</span>`
                });
                div.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    popover.style.display = 'none';
                    if (item.path && location.pathname !== item.path) router.push(item.path);
                    if (typeof onItemClick === 'function') onItemClick(item, e);
                });
                popover.appendChild(div);
            });
            document.body.appendChild(popover);
            return popover;
        };

        const createSidebarPopoutButton = ({ href = '', onClick = null, title = '前往論壇 (取代當前頁面)', ariaLabel = '前往論壇' } = {}) => {
            if (typeof document === 'undefined') return null;
            const btn = Object.assign(document.createElement('a'), {
                href,
                target: '_self',
                title,
                className: 'novelia-forum-popout-btn grid size-5 place-items-center rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10 text-muted hover:text-ink transition-colors',
                innerHTML: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="size-3.5"><path d="${POPOUT_PATH}" fill="currentColor"></path></svg>`
            });
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
        };

        const createSidebarGroupHeader = ({ label = '论坛', isExpanded = false, origIcon = null, actionElements = [] } = {}) => {
            if (typeof document === 'undefined') return null;
            const headerBtn = Object.assign(document.createElement('button'), {
                type: 'button',
                className: 'web-kit-sidebar-item text-ink hover:bg-hover w-full flex items-center justify-between cursor-pointer !pr-1.5'
            });
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
        };

        const createSidebarSubmenuItem = ({ name = '', path = '', icon = '', onClick = null } = {}) => {
            if (typeof document === 'undefined') return null;
            const link = Object.assign(document.createElement('a'), {
                href: path,
                className: 'web-kit-sidebar-item text-ink hover:bg-hover flex items-center gap-2 py-1.5 px-2 rounded-md text-sm'
            });

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
                if (path && location.pathname !== path) router.push(path);
                if (typeof onClick === 'function') onClick(e);
            });
            return link;
        };

        return {
            theme,
            getForumHeader,
            getThemeButton,
            createNaiveButton,
            injectNaiveHeaderButton,
            createMainHeaderButton,
            createMainHeaderCollapser,
            injectMainHeaderButton,
            getForumDropdown,
            createSidebarPopoutButton,
            createSidebarGroupHeader,
            createSidebarSubmenuItem
        };
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
            if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '')
                || window.innerWidth <= 768;
        }
    };

    const gmEnv = {
        GM_addStyle: typeof GM_addStyle !== 'undefined' ? GM_addStyle : undefined,
        GM_setClipboard: typeof GM_setClipboard !== 'undefined' ? GM_setClipboard : undefined,
        GM_xmlhttpRequest: typeof GM_xmlhttpRequest !== 'undefined' ? GM_xmlhttpRequest : undefined
    };

    const cfg = { ...defaultConfig };
    const gm = createGm(gmEnv);
    const patcher = createPatcher();
    const idb = createIdb(cfg.db);
    const localStore = createLocalStore();
    const cache = createCache({ ls: localStore, idb });
    const network = createNetwork({ root, patcher, idb, gm, domains: cfg.domains, db: cfg.db, ttlMs: cfg.ttl.default });
    const fetchRaceCache = createFetchRaceCache();
    const fetchBlob = createBlobFetcher({ fetchRaceCache, cache, download: gm.downloadBlob, isBlocked: network.isBlocked, ttlMs: cfg.ttl.image });
    const imageCache = createImageCache({ getBlob: fetchBlob, ttlMs: cfg.ttl.image });
    const mascotAsset = mascot(cfg, { getBlob: fetchBlob });
    const nodeWatcher = createNodeWatcher({ patcher });
    const router = createRouter({ root, patcher, domains: cfg.domains, events: cfg.events });
    const sidebar = createSidebar({ isForumUrl: router.isForumUrl });
    const sidebarState = createSidebarState({ sidebar, store: localStore, key: cfg.keys.forumSubmenuExpanded });
    const comments = createComments({ icons });
    const genericUi = createGenericUi(gm);
    const siteUi = createSiteUi({ domains: cfg.domains, router });

    const Utils = Object.freeze({
        text,
        fireWindowEvent,
        isPlainClick,
        attempt,
        createDisposer,
        gm,
        localStore,
        idb,
        cache,
        patcher,
        nodeWatcher,
        network,
        imageCache,
        fetchRaceCache,
        fetchBlob,
        icons,
        router,
        sidebar,
        sidebarState,
        comments,
        time,
        createLimiter,
        utrimmer,
        ui: Object.freeze({
            ...genericUi,
            site: siteUi
        }),
        dom: Object.freeze({
            ...dom,
            nodeWatcher
        }),
        assets: Object.freeze({
            mascot: mascotAsset
        })
    });

    if (typeof window !== 'undefined' && root !== window) {
        attempt(() => { window.NoveliaConfig = cfg; window.Utils = Utils; });
    }
    root.NoveliaConfig = cfg;
    root.Utils = Utils;
})();
