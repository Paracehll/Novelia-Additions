// ==UserScript==
// @name         哈梅林爬取器 v2.0
// @namespace    https://syosetu.org/
// @version      2.0.0
// @description  爬取 syosetu.org 小說全文並合併為 TXT/EPUB 下載；支援章節範圍、快取（v2 緊湊格式）、匯入/匯出；一(兩)鍵加入 Novelia 本地書架
// @author       Mr.Claude
// @match        https://syosetu.org/novel/*
// @match        https://syosetu.org/novel/*/
// @match        https://n.novelia.cc/workspace/sakura*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      syosetu.org
// ==/UserScript==

(function () {
  "use strict";

  const fetchPageDelay = 500;

  if (window.top !== window.self) return;

  // ══════════════════════════════════════════════════════════════════
  // ── Novelia 端 ──────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════
  if (location.hostname === "n.novelia.cc") {
    const NoveliaHandler = {
      SIGNAL_KEY: "syo_novelia_trigger",

      waitForDrawerContent(timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error("等待側邊欄內容逾時"));
          }, timeoutMs);
          function check() {
            const drawer = document.querySelector(".n-drawer-container");
            return drawer && [...drawer.childNodes].some((n) => n.nodeType === 1);
          }
          if (check()) {
            clearTimeout(timer);
            resolve();
            return;
          }
          const observer = new MutationObserver(() => {
            if (check()) {
              clearTimeout(timer);
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
      },

      findButton(labelText, svgPathPrefix = null) {
        return [...document.querySelectorAll("button")].find((btn) => {
          const textMatch = btn.textContent
            .replace(/\s+/g, "")
            .includes(labelText.replace(/\s+/g, ""));
          if (!textMatch) return false;
          if (!svgPathPrefix) return true;
          const paths = btn.querySelectorAll("path");
          return [...paths].some((p) =>
            (p.getAttribute("d") || "").startsWith(svgPathPrefix),
          );
        });
      },

      waitForButton(labelText, svgPathPrefix, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
          const found = this.findButton(labelText, svgPathPrefix);
          if (found) return resolve(found);
          const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error(`等待按鈕逾時：${labelText}`));
          }, timeoutMs);
          const observer = new MutationObserver(() => {
            const btn = this.findButton(labelText, svgPathPrefix);
            if (btn) {
              clearTimeout(timer);
              observer.disconnect();
              resolve(btn);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
      },

      waitForSelector(selector, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
          const el = document.querySelector(selector);
          if (el) return resolve(el);
          const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error(`等待 Selector 逾時：${selector}`));
          }, timeoutMs);
          const observer = new MutationObserver(() => {
            const target = document.querySelector(selector);
            if (target) {
              clearTimeout(timer);
              observer.disconnect();
              resolve(target);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
      },

      delay: (ms) => new Promise((r) => setTimeout(r, ms)),

      async run() {
        try {
          const shelfBtn = await this.waitForButton("本地书架", "M18 2H6");
          shelfBtn.click();
          await this.waitForDrawerContent(15000);
          await this.delay(500);
          const addBtn = await this.waitForSelector(".n-upload-trigger button", 8000);
          addBtn.click();
        } catch (err) {
          console.error("[novelia auto-add]", err.message);
        }
      },

      showToast(msg) {
        let toast = document.getElementById("syo-novelia-toast");
        if (!toast) {
          toast = document.createElement("div");
          toast.id = "syo-novelia-toast";
          Object.assign(toast.style, {
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#4a9a6f",
            color: "white",
            padding: "12px 24px",
            borderRadius: "8px",
            zIndex: "100000",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            pointerEvents: "none",
          });
          document.body.appendChild(toast);
        }
        toast.textContent = msg;
        setTimeout(() => toast.remove(), 5000);
      },

      checkAndRun() {
        const params = new URLSearchParams(window.location.search);
        if (params.get("syo_auto") !== "1") return;
        console.log("[novelia] 準備就緒，請點擊頁面以開始自動上傳...");
        if (this._triggerOnce) window.removeEventListener("click", this._triggerOnce);
        this._triggerOnce = async () => {
          window.removeEventListener("click", this._triggerOnce);
          await this.run();
        };
        window.addEventListener("click", this._triggerOnce);
        this.showToast("請點擊頁面任意處以繼續自動加入書架");
      },

      init() {
        this.checkAndRun();
        window.addEventListener("storage", (e) => {
          if (e.key === this.SIGNAL_KEY) {
            console.log("[novelia] 收到來自哈梅林端的重新喚醒訊號");
            this.checkAndRun();
          }
        });
      }
    };

    NoveliaHandler.init();
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // ── 哈梅林端 ────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  if (/\/novel\/[^/]+\/\d+\.html/.test(location.pathname)) return;

  // ── 配置與工具 ──────────────────────────────────────────────────
  const Config = {
    getNovelId() {
      const m = location.pathname.match(/\/novel\/([^/]+)\/?$/);
      return m ? m[1] : null;
    },
    NOVEL_ID: null,
    CACHE_KEY: null,
    NOVELIA_URL: "https://n.novelia.cc/workspace/sakura",
    NOVELIA_SIGNAL_KEY: "syo_novelia_trigger",
    init() {
      this.NOVEL_ID = this.getNovelId();
      if (this.NOVEL_ID) {
        this.CACHE_KEY = `syo_cache_${this.NOVEL_ID}`;
      }
    }
  };
  Config.init();
  if (!Config.NOVEL_ID) return;

  const Utils = {
    delay: (ms) => new Promise((r) => setTimeout(r, ms)),
    toUTF8: (str) => new TextEncoder().encode(str),
    escXml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"),
    textToXhtml: (text) => text.split(/\n/).map((line) => `<p>${Utils.escXml(line) || "&#160;"}</p>`).join("\n"),
    zipUint32LE: (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]),
    zipUint16LE: (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]),
    crc32(data) {
      const table = Utils.crc32.table || (Utils.crc32.table = (() => {
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
    }
  };

  // ── 快取管理 (Store) ─────────────────────────────────────────────
  const Store = {
    load() {
      try {
        const raw = localStorage.getItem(Config.CACHE_KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (d.v === 2) {
          const chapters = {};
          for (const [p, t, content] of (d.c || [])) {
            chapters[String(p)] = { title: t, content };
          }
          return { title: d.t || "", chapters };
        }
        return d;
      } catch {
        return null;
      }
    },
    save(c) {
      try {
        const arr = Object.entries(c.chapters || {}).map(([p, ch]) => [
          Number(p), ch.title || "", ch.content || ""
        ]);
        const serialized = JSON.stringify({ v: 2, t: c.title || "", c: arr });
        localStorage.setItem(Config.CACHE_KEY, serialized);
        return true;
      } catch (e) {
        console.error("[syosetu] 快取寫入失敗", e);
        return false;
      }
    },
    clear() {
      localStorage.removeItem(Config.CACHE_KEY);
    },
    getStats() {
      const c = this.load();
      if (!c) return null;
      const pages = Object.keys(c.chapters || {}).map(Number).sort((a, b) => a - b);
      return { title: c.title || "", pages, count: pages.length };
    }
  };

  // ── 解析器 (Parser) ─────────────────────────────────────────────
  const Parser = {
    fetchPage(url) {
      return new Promise((resolve, reject) => {
        const ifr = UI.iframe;
        if (!ifr) return reject(new Error("瀏覽器爬取環境尚未就緒"));
        const timer = setTimeout(() => { ifr.onload = null; reject(new Error("載入頁面逾時")); }, 30000);
        ifr.onload = () => {
          clearTimeout(timer);
          ifr.onload = null;
          // 給予一點時間讓頁面腳本或跳轉執行
          setTimeout(() => {
            try {
              const doc = ifr.contentDocument || ifr.contentWindow.document;
              if (!doc) return reject(new Error("無法取得 iframe 內容"));
              resolve(doc);
            } catch (e) {
              reject(new Error("存取 iframe 內容受阻: " + e.message));
            }
          }, 500);
        };
        ifr.src = url;
      });
    },
    extractContent(htmlOrDoc) {
      const doc = (typeof htmlOrDoc === "string") ? new DOMParser().parseFromString(htmlOrDoc, "text/html") : htmlOrDoc;
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
    },
    extractChapterTitle(htmlOrDoc) {
      const doc = (typeof htmlOrDoc === "string") ? new DOMParser().parseFromString(htmlOrDoc, "text/html") : htmlOrDoc;
      const bigSpan = Array.from(doc.querySelectorAll("span")).find((el) =>
        /font-size\s*:\s*1[2-9]0%/.test(el.getAttribute("style") || "") &&
        !/novel_title|\.title/.test(el.className) &&
        !el.closest("p")?.querySelector('a[href="./"]')
      );
      if (bigSpan) return bigSpan.textContent.trim();
      const sub = doc.querySelector(".subtitle, .chapter-title, h2");
      return sub ? sub.textContent.trim() : "";
    },
    detectMaxPage(htmlOrDoc) {
      const doc = (typeof htmlOrDoc === "string") ? new DOMParser().parseFromString(htmlOrDoc, "text/html") : htmlOrDoc;
      const ssDivs = doc.querySelectorAll("div.ss");
      const searchRoot = ssDivs[2] || doc;
      const pattern = new RegExp(`^(?:https?://syosetu\\.org)?/novel/${Config.NOVEL_ID}/(\\d+)\\.html$`);
      let max = 0;
      searchRoot.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href") || "";
        const rel = href.match(/^\.\/(\d+)\.html$/) || href.match(pattern);
        if (rel) max = Math.max(max, parseInt(rel[1], 10));
      });
      return max;
    },
    extractNovelTitle() {
      const el = document.querySelector('span[itemprop="name"]');
      return el ? el.textContent.trim().replace(/[\r\n]+/g, " ").trim() : `syosetu_${Config.NOVEL_ID}`;
    },
    extractNovelDescription() {
      const maind = document.getElementById("maind");
      if (!maind) return "";
      const ssDivs = maind.querySelectorAll("div.ss");
      if (ssDivs.length < 2) return "";
      const descDiv = ssDivs[1].cloneNode(true);
      descDiv.querySelectorAll("hr").forEach((hr) => hr.remove());
      descDiv.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      return descDiv.textContent.trim();
    }
  };

  // ── 匯出器 (Exporter) ─────────────────────────────────────────────
  const Exporter = {
    buildFileName(cache, pages, ext) {
      const title = (cache.title || "").replace(/[\r\n]+/g, " ").trim();
      const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_") || Config.NOVEL_ID;
      const first = pages[0], last = pages[pages.length - 1];
      const range = (first === last) ? `ch${first}` : (first === 1 ? `ch-${last}` : `ch${first}-${last}`);
      return `${Config.NOVEL_ID}_${range}_${safeTitle}.${ext}`;
    },
    buildText(cache, pages) {
      const title = cache.title || Config.NOVEL_ID;
      let out = `${title}\nhttps://syosetu.org/novel/${Config.NOVEL_ID}/\n`;
      out += `包含章節：第 ${pages[0]} — ${pages[pages.length - 1]} 話（共 ${pages.length} 章）\n`;

      const desc = Parser.extractNovelDescription();
      if (desc) {
        out += "\n作品描述：\n" + desc + "\n";
      }

      out += "\n" + "═".repeat(40) + "\n";
      for (const page of pages) {
        const ch = cache.chapters[String(page)];
        if (!ch) continue;
        out += `\n${"═".repeat(40)}\n第 ${page} 話`;
        if (ch.title && ch.title.length < 120) out += `　${ch.title}`;
        out += `\n${"═".repeat(40)}\n\n${ch.content || "（無內容）"}\n`;
      }
      return out;
    },
    downloadText(text, filename) {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      Object.assign(a, { href: url, download: filename.replace(/[\\/:*?"<>|]/g, "_") });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
    buildZip(entries) {
      const localHeaders = [], centralDir = [];
      let offset = 0;
      for (const entry of entries) {
        const nameBytes = new TextEncoder().encode(entry.name);
        const data = entry.data, crc = Utils.crc32(data), size = data.length;
        const local = Utils.concatU8(
          new Uint8Array([0x50, 0x4b, 0x03, 0x04]), Utils.zipUint16LE(20), Utils.zipUint16LE(0), Utils.zipUint16LE(0), Utils.zipUint16LE(0), Utils.zipUint16LE(0),
          Utils.zipUint32LE(crc), Utils.zipUint32LE(size), Utils.zipUint32LE(size), Utils.zipUint16LE(nameBytes.length), Utils.zipUint16LE(0),
          nameBytes, data
        );
        localHeaders.push({ local, nameBytes, crc, size, offset });
        offset += local.length;
        centralDir.push(Utils.concatU8(
          new Uint8Array([0x50, 0x4b, 0x01, 0x02]), Utils.zipUint16LE(20), Utils.zipUint16LE(20), Utils.zipUint16LE(0), Utils.zipUint16LE(0), Utils.zipUint16LE(0), Utils.zipUint16LE(0),
          Utils.zipUint32LE(crc), Utils.zipUint32LE(size), Utils.zipUint32LE(size), Utils.zipUint16LE(nameBytes.length), Utils.zipUint16LE(0), Utils.zipUint16LE(0), Utils.zipUint16LE(0), Utils.zipUint16LE(0),
          Utils.zipUint32LE(0), Utils.zipUint32LE(localHeaders[localHeaders.length - 1].offset), nameBytes
        ));
      }
      const cdData = Utils.concatU8(...centralDir), eocd = Utils.concatU8(
        new Uint8Array([0x50, 0x4b, 0x05, 0x06]), Utils.zipUint16LE(0), Utils.zipUint16LE(0), Utils.zipUint16LE(entries.length), Utils.zipUint16LE(entries.length),
        Utils.zipUint32LE(cdData.length), Utils.zipUint32LE(offset), Utils.zipUint16LE(0)
      );
      return Utils.concatU8(...localHeaders.map((h) => h.local), cdData, eocd);
    },
    buildEpub(cache, pages) {
      const title = cache.title || Config.NOVEL_ID;
      const novelUrl = `https://syosetu.org/novel/${Config.NOVEL_ID}/`;
      const uuid = `urn:uuid:${Config.NOVEL_ID}-${Date.now()}`;
      const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      const entries = [
        { name: "mimetype", data: Utils.toUTF8("application/epub+zip") },
        { name: "META-INF/container.xml", data: Utils.toUTF8(`<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`) },
        { name: "OEBPS/style.css", data: Utils.toUTF8(`body{font-family:'Hiragino Mincho Pro','MS Mincho',serif;line-height:1.9;margin:1.5em;}h1{font-size:1.5em;border-bottom:1px solid #888;padding-bottom:0.4em;margin-bottom:1em;}h2{font-size:1.1em;color:#555;margin-bottom:0.8em;}p{margin:0.3em 0;text-indent:1em;}.chapter-num{color:#888;font-size:0.85em;}`) },
        { name: "OEBPS/cover.xhtml", data: Utils.toUTF8(`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><head><meta charset="utf-8"/><title>${Utils.escXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body style="text-align:center;padding-top:4em;"><h1>${Utils.escXml(title)}</h1><p style="color:#888;font-size:0.9em;"><a href="${Utils.escXml(novelUrl)}">${Utils.escXml(novelUrl)}</a></p><p style="color:#aaa;font-size:0.8em;margin-top:2em;">第 ${pages[0]} — ${pages[pages.length - 1]} 話（共 ${pages.length} 章）</p><p style="color:#ccc;font-size:0.75em;">${Utils.escXml(now.slice(0, 10))} 匯出</p></body></html>`) }
      ];

      const desc = Parser.extractNovelDescription();
      if (desc) {
        entries.push({
          name: "OEBPS/description.xhtml",
          data: Utils.toUTF8(`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><head><meta charset="utf-8"/><title>作品描述</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>作品描述</h1>${Utils.textToXhtml(desc)}</body></html>`)
        });
      }

      const chapterFiles = [];
      for (const page of pages) {
        const ch = cache.chapters[String(page)];
        if (!ch) continue;
        const chTitle = ch.title ? `第 ${page} 話　${ch.title}` : `第 ${page} 話`;
        const xhtml = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><head><meta charset="utf-8"/><title>${Utils.escXml(chTitle)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1><span class="chapter-num">第 ${page} 話</span>${ch.title ? `<br/>${Utils.escXml(ch.title)}` : ""}</h1>${Utils.textToXhtml(ch.content || "（無內容）")}</body></html>`;
        const fname = `ch${String(page).padStart(5, "0")}.xhtml`;
        entries.push({ name: `OEBPS/${fname}`, data: Utils.toUTF8(xhtml) });
        chapterFiles.push({ fname, page, title: chTitle });
      }
      const manifestItems = [
        `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
        desc ? `<item id="description" href="description.xhtml" media-type="application/xhtml+xml"/>` : "",
        `<item id="css" href="style.css" media-type="text/css"/>`,
        `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
        ...chapterFiles.map((c) => `<item id="ch${c.page}" href="${c.fname}" media-type="application/xhtml+xml"/>`)
      ].filter(Boolean).join("\n    ");
      const spineItems = [
        `<itemref idref="cover"/>`,
        desc ? `<itemref idref="description"/>` : "",
        ...chapterFiles.map((c) => `<itemref idref="ch${c.page}"/>`)
      ].filter(Boolean).join("\n    ");
      entries.push({ name: "OEBPS/content.opf", data: Utils.toUTF8(`<?xml version="1.0" encoding="utf-8"?><package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title>${Utils.escXml(title)}</dc:title><dc:language>ja</dc:language><dc:identifier id="BookId">${Utils.escXml(uuid)}</dc:identifier><dc:source>${Utils.escXml(novelUrl)}</dc:source><dc:date opf:event="modification">${now}</dc:date></metadata><manifest>${manifestItems}</manifest><spine toc="ncx">${spineItems}</spine></package>`) });

      let playOrder = 1;
      const navPoints = [
        `<navPoint id="cover" playOrder="${playOrder++}"><navLabel><text>表紙</text></navLabel><content src="cover.xhtml"/></navPoint>`,
        desc ? `<navPoint id="description" playOrder="${playOrder++}"><navLabel><text>作品描述</text></navLabel><content src="description.xhtml"/></navPoint>` : "",
        ...chapterFiles.map((c) => `<navPoint id="ch${c.page}" playOrder="${playOrder++}"><navLabel><text>${Utils.escXml(c.title)}</text></navLabel><content src="${c.fname}"/></navPoint>`)
      ].filter(Boolean).join("\n    ");
      entries.push({ name: "OEBPS/toc.ncx", data: Utils.toUTF8(`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd"><ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/"><head><meta name="dtb:uid" content="${Utils.escXml(uuid)}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${Utils.escXml(title)}</text></docTitle><navMap>${navPoints}</navMap></ncx>`) });
      return this.buildZip(entries);
    },
    downloadEpub(cache, pages) {
      const blob = new Blob([this.buildEpub(cache, pages)], { type: "application/epub+zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      Object.assign(a, { href: url, download: this.buildFileName(cache, pages, "epub") });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    }
  };

  // ── UI 管理 (UI) ────────────────────────────────────────────────
  const UI = {
    panel: null, mainBox: null,
    iframe: null,
    refs: {},
    init() {
      const style = document.createElement("style");
      style.textContent = `#syo-scraper-panel{position:fixed;bottom:24px;right:24px;z-index:999999;font-family:'Hiragino Kaku Gothic Pro','Meiryo',sans-serif;user-select:none;width:300px;}#syo-scraper-btn{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);color:#e2b96f;border:1.5px solid #e2b96f;border-radius:12px;padding:12px 22px;font-size:14px;font-weight:bold;cursor:pointer;box-shadow:0 4px 20px rgba(226,185,111,0.25);letter-spacing:0.05em;transition:all 0.2s;display:flex;align-items:center;gap:8px;width:100%;justify-content:center;}#syo-scraper-btn:hover:not(:disabled){background:linear-gradient(135deg,#16213e 0%,#0f3460 50%,#1a1a2e 100%);box-shadow:0 6px 28px rgba(226,185,111,0.4);transform:translateY(-1px);}#syo-scraper-btn:disabled{opacity:0.6;cursor:not-allowed;}#syo-scraper-main{margin-top:8px;background:rgba(10,10,20,0.95);border:1px solid #2a3a5c;border-radius:12px;padding:12px 14px;font-size:12px;color:#a8c4e0;display:none;}#syo-scraper-main.visible{display:block;}.syo-section-label{color:#e2b96f;font-size:11px;font-weight:bold;letter-spacing:0.08em;margin-bottom:6px;margin-top:10px;opacity:0.85;}.syo-section-label:first-child{margin-top:0;}.syo-range-row{display:flex;align-items:center;gap:6px;margin-bottom:8px;}.syo-range-input{background:#0d1a2e;border:1px solid #2a3a5c;border-radius:6px;color:#e2b96f;font-size:12px;padding:4px 8px;width:70px;outline:none;transition:border 0.2s;}.syo-range-input:focus{border-color:#e2b96f;}#syo-status-text{margin-bottom:6px;line-height:1.55;min-height:18px;}#syo-progress-bar-wrap{width:100%;height:4px;background:#1e2d42;border-radius:2px;overflow:hidden;margin-bottom:10px;}#syo-progress-bar{height:100%;background:linear-gradient(90deg,#e2b96f,#f5daa0);width:0%;transition:width 0.4s ease;border-radius:2px;}#syo-cache-info{background:#0d1a2e;border:1px solid #1e3050;border-radius:8px;padding:7px 10px;margin-bottom:8px;font-size:11px;color:#7090b0;line-height:1.6;}#syo-cache-info .syo-cache-title{color:#a8c4e0;font-weight:bold;margin-bottom:2px;}.syo-btn-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}.syo-action-btn{background:#0d1a2e;border:1px solid #2a3a5c;border-radius:7px;color:#a8c4e0;font-size:11px;padding:5px 10px;cursor:pointer;transition:all 0.15s;display:flex;align-items:center;gap:4px;white-space:nowrap;}.syo-action-btn:hover{border-color:#e2b96f;color:#e2b96f;}.syo-action-btn.danger:hover{border-color:#e25555;color:#e25555;}.syo-action-btn:disabled{opacity:0.4;cursor:not-allowed;}.syo-action-btn.primary{background:linear-gradient(135deg,#1a1a2e 0%,#0f3460 100%);border-color:#e2b96f;color:#e2b96f;font-weight:bold;}.syo-action-btn.epub{border-color:#7b5ea7;color:#c8a8f0;}.syo-action-btn.novelia{border-color:#4a9a6f;color:#7dcfa0;}.syo-divider{border:none;border-top:1px solid #1e2d42;margin:10px 0;}.syo-icon{font-size:14px;line-height:1;}`;
      document.head.appendChild(style);

      this.panel = document.createElement("div");
      this.panel.id = "syo-scraper-panel";
      this.panel.innerHTML = `<button id="syo-scraper-btn"><span class="syo-icon">📖</span> 小說爬取器</button>
        <div id="syo-scraper-main">
          <div id="syo-iframe-wrap" style="display:none; margin-bottom: 8px; border: 1px solid #2a3a5c; border-radius: 8px; overflow: hidden; height: 120px; background: #000;">
            <iframe id="syo-scraper-iframe" style="width: 100%; height: 100%; border: none; transform: scale(0.8); transform-origin: top left; width: 125%; height: 125%;"></iframe>
          </div>
          <div id="syo-cache-info"></div><hr class="syo-divider">
          <div class="syo-section-label">▸ 爬取章節範圍</div>
          <div class="syo-range-row"><label>從第</label><input class="syo-range-input" id="syo-range-from" type="number" min="1" value="1"><span style="color:#4a6a8a">—</span><label>第</label><input class="syo-range-input" id="syo-range-to" type="number" min="1" placeholder="末章"><label>話</label></div>
          <div id="syo-status-text">就緒</div><div id="syo-progress-bar-wrap"><div id="syo-progress-bar"></div></div>
          <div class="syo-section-label">▸ 爬取 & 下載</div>
          <div class="syo-btn-row">
            <button class="syo-action-btn primary" id="syo-btn-scrape">開爬</button><button class="syo-action-btn" id="syo-btn-export-range">TXT（範圍）</button><button class="syo-action-btn" id="syo-btn-export-all">TXT（全部）</button>
            <button class="syo-action-btn epub" id="syo-btn-epub-range">EPUB（範圍）</button><button class="syo-action-btn epub" id="syo-btn-epub-all">EPUB（全部）</button>
          </div><hr class="syo-divider">
          <div class="syo-section-label">▸ 快取管理</div>
          <div class="syo-btn-row"><button class="syo-action-btn" id="syo-btn-import">📥 匯入 TXT / EPUB</button><input type="file" id="syo-import-input" accept=".txt,.epub" style="display:none;"><button class="syo-action-btn danger" id="syo-btn-clear-cache">🗑 清除快取</button></div><hr class="syo-divider">
          <div class="syo-section-label">▸ Novelia 書架</div>
          <div class="syo-btn-row"><button class="syo-action-btn novelia" id="syo-btn-novelia" style="width:100%;justify-content:center;">📚 加入 Novelia 本地書架</button></div>
        </div>`;
      document.body.appendChild(this.panel);

      this.mainBox = document.getElementById("syo-scraper-main");
      this.iframe = document.getElementById("syo-scraper-iframe");
      const ids = ["scrape", "export-range", "export-all", "epub-range", "epub-all", "import", "clear-cache", "novelia"];
      ids.forEach(id => this.refs[id] = document.getElementById(`syo-btn-${id}`));
      this.refs.status = document.getElementById("syo-status-text");
      this.refs.progress = document.getElementById("syo-progress-bar");
      this.refs.cacheInfo = document.getElementById("syo-cache-info");
      this.refs.rangeFrom = document.getElementById("syo-range-from");
      this.refs.rangeTo = document.getElementById("syo-range-to");
      this.refs.importInput = document.getElementById("syo-import-input");

      document.getElementById("syo-scraper-btn").onclick = () => {
        this.mainBox.classList.toggle("visible");
        if (this.mainBox.classList.contains("visible")) this.refreshCacheInfo();
      };

      this.bindEvents();
      this.refreshCacheInfo();
      this.injectToCButtons();
    },

    injectToCButtons() {
      const links = document.querySelectorAll('#maind div.ss table a[href*=".html"]');
      links.forEach(link => {
        const m = link.getAttribute("href").match(/\/?(\d+)\.html$/);
        if (!m) return;
        const pageNum = m[1];
        const btn = document.createElement("button");
        btn.innerHTML = "🚀";
        Object.assign(btn.style, {
          marginLeft: "6px", border: "none", background: "none", cursor: "pointer", fontSize: "14px", color: "#007bff"
        });
        btn.title = `從第 ${pageNum} 話開始爬取`;
        btn.onclick = (e) => {
          e.preventDefault();
          this.refs.rangeFrom.value = pageNum;
          this.refs.scrape.click();
          if (!this.mainBox.classList.contains("visible")) {
            this.mainBox.classList.add("visible");
          }
          this.mainBox.scrollIntoView({ behavior: "smooth", block: "end" });
        };
        link.parentNode.insertBefore(btn, link.nextSibling);
      });
    },

    setStatus(msg, progress = null) {
      this.refs.status.textContent = msg;
      if (progress !== null) this.refs.progress.style.width = Math.min(100, Math.round(progress)) + "%";
    },

    setAllDisabled(val) {
      Object.values(this.refs).forEach(el => { if (el && el.tagName === "BUTTON") el.disabled = val; });
    },

    refreshCacheInfo() {
      const stats = Store.getStats();
      if (!stats) {
        this.refs.cacheInfo.innerHTML = `<div class="syo-cache-title">快取：無</div><div>尚未有任何快取資料</div>`;
        return;
      }
      const rangeStr = stats.pages.length > 0 ? `第 ${stats.pages[0]} — ${stats.pages[stats.pages.length - 1]} 話（共 ${stats.count} 章已快取）` : "無章節";
      this.refs.cacheInfo.innerHTML = `<div class="syo-cache-title">📚 ${stats.title || Config.NOVEL_ID}</div><div>${rangeStr}</div><div style="color:#4a6a8a;font-size:10px;margin-top:2px;">KEY: ${Config.CACHE_KEY}</div>`;
    },

    bindEvents() {
      this.refs.scrape.onclick = async () => {
        const ifrWrap = document.getElementById("syo-iframe-wrap");
        if (ifrWrap) ifrWrap.style.display = "block";
        this.setAllDisabled(true);
        this.setStatus("正在讀取目錄頁...", 0);
        try {
          const maxPage = Parser.detectMaxPage(document);
          if (maxPage === 0) return this.setStatus("❌ 找不到任何章節連結");
          const f = parseInt(this.refs.rangeFrom.value, 10) || 1;
          const t = parseInt(this.refs.rangeTo.value, 10) || maxPage;
          const pFrom = Math.max(1, f), pTo = Math.min(maxPage, t);
          if (pFrom > pTo) return this.setStatus("❌ 起始章節不可大於結束章節");
          this.setStatus(`共 ${maxPage} 章，爬取第 ${pFrom}～${pTo} 話...`, 0);
          let cache = Store.load() || { title: Parser.extractNovelTitle(), chapters: {} };
          cache.title = Parser.extractNovelTitle();
          for (let p = pFrom, fetched = 0, total = pTo - pFrom + 1; p <= pTo; p++, fetched++) {
            this.setStatus(`爬取第 ${p} 話 (${fetched + 1}/${total})...`, (fetched / total) * 100);
            try {
              const doc = await Parser.fetchPage(`https://syosetu.org/novel/${Config.NOVEL_ID}/${p}.html`);
              cache.chapters[String(p)] = { title: Parser.extractChapterTitle(doc), content: Parser.extractContent(doc).trim() };
            } catch (err) {
              cache.chapters[String(p)] = { title: "", content: `（爬取失敗：${err.message}）` };
            }
            if (fetched % 5 === 0) Store.save(cache);
            if (p < pTo) await Utils.delay(fetchPageDelay);
          }
          Store.save(cache);
          this.setStatus(`✅ 爬取完成！第 ${pFrom}～${pTo} 話已存入快取`, 100);
          this.refreshCacheInfo();
        } catch (err) { this.setStatus(`❌ 錯誤：${err.message}`); console.error(err); }
        finally {
          this.setAllDisabled(false);
          if (this.iframe) { try { this.iframe.src = 'about:blank'; } catch (e) {} }
          if (ifrWrap) ifrWrap.style.display = "none";
        }
      };

      const getRangePages = (cache) => {
        const all = Object.keys(cache.chapters).map(Number).sort((a, b) => a - b);
        const f = parseInt(this.refs.rangeFrom.value, 10), t = parseInt(this.refs.rangeTo.value, 10);
        return all.filter(p => (isNaN(f) || p >= f) && (isNaN(t) || p <= t));
      };

      this.refs["export-range"].onclick = () => {
        const cache = Store.load();
        if (!cache) return this.setStatus("❌ 快取為空");
        const pages = getRangePages(cache);
        if (pages.length === 0) return this.setStatus("❌ 指定範圍內無快取章節");
        Exporter.downloadText(Exporter.buildText(cache, pages), Exporter.buildFileName(cache, pages, "txt"));
        this.setStatus(`💾 已下載第 ${pages[0]}～${pages[pages.length - 1]} 話`, 100);
      };

      this.refs["export-all"].onclick = () => {
        const cache = Store.load();
        if (!cache) return this.setStatus("❌ 快取為空");
        const pages = Object.keys(cache.chapters).map(Number).sort((a, b) => a - b);
        Exporter.downloadText(Exporter.buildText(cache, pages), Exporter.buildFileName(cache, pages, "txt"));
        this.setStatus(`📦 已下載全快取`, 100);
      };

      this.refs["epub-range"].onclick = () => {
        const cache = Store.load();
        if (!cache) return this.setStatus("❌ 快取為空");
        const pages = getRangePages(cache);
        if (pages.length === 0) return this.setStatus("❌ 指定範圍內無快取章節");
        this.setStatus("⏳ 正在生成 EPUB...");
        setTimeout(() => {
          try { Exporter.downloadEpub(cache, pages); this.setStatus(`📕 已下載 EPUB：第 ${pages[0]}～${pages[pages.length - 1]} 話`, 100); }
          catch (e) { this.setStatus(`❌ EPUB 生成失敗：${e.message}`); }
        }, 50);
      };

      this.refs["epub-all"].onclick = () => {
        const cache = Store.load();
        if (!cache) return this.setStatus("❌ 快取為空");
        const pages = Object.keys(cache.chapters).map(Number).sort((a, b) => a - b);
        this.setStatus("⏳ 正在生成 EPUB...");
        setTimeout(() => {
          try { Exporter.downloadEpub(cache, pages); this.setStatus(`📚 已下載全文 EPUB`, 100); }
          catch (e) { this.setStatus(`❌ EPUB 生成失敗：${e.message}`); }
        }, 50);
      };

      this.refs.import.onclick = () => this.refs.importInput.click();
      this.refs.importInput.onchange = () => {
        const file = this.refs.importInput.files[0];
        if (!file) return;
        this.refs.importInput.value = "";
        const reader = new FileReader();
        if (file.name.toLowerCase().endsWith(".epub")) {
          reader.onload = (e) => this.importEpub(e.target.result, file.name);
          reader.readAsArrayBuffer(file);
        } else {
          reader.onload = (e) => this.importTxt(e.target.result, file.name);
          reader.readAsText(file, "utf-8");
        }
      };

      this.refs["clear-cache"].onclick = () => {
        const stats = Store.getStats();
        if (!stats || !confirm(`確定要清除「${stats.title || Config.NOVEL_ID}」的快取嗎？`)) return;
        Store.clear(); this.refreshCacheInfo(); this.setStatus("🗑 快取已清除", 0);
      };

      this.refs.novelia.onclick = () => {
        const w = window.open(`${Config.NOVELIA_URL}?syo_auto=1&id=${Config.NOVEL_ID}&t=${Date.now()}`, "novelia_sakura_tab");
        if (w) { w.focus(); localStorage.setItem(Config.NOVELIA_SIGNAL_KEY, Date.now().toString()); this.setStatus("📚 已切換至 Novelia"); }
        else this.setStatus("⚠️ 無法開啟分頁");
      };
    },

    importTxt(text, filename) {
      const blocks = text.split("═".repeat(40)).map(s => s.trim()).filter(Boolean);
      const chapterBlocks = blocks.slice(1);
      let cache = Store.load() || { title: `syosetu_${Config.NOVEL_ID}`, chapters: {} };
      let imported = 0;
      const firstLine = text.split("\n")[0].trim();
      if (firstLine && firstLine.length < 200) cache.title = firstLine;
      for (let i = 0; i < chapterBlocks.length - 1; i += 2) {
        const m = chapterBlocks[i].match(/第\s*(\d+)\s*話/);
        if (m) {
          cache.chapters[String(m[1])] = { title: chapterBlocks[i].replace(/第\s*\d+\s*話\s*/, "").trim(), content: chapterBlocks[i + 1].trim() };
          imported++;
        }
      }
      if (imported === 0) return this.setStatus(`❌ 無法解析「${filename}」`);
      Store.save(cache); this.refreshCacheInfo(); this.setStatus(`📥 TXT 匯入完成：${imported} 章`);
    },

    async importEpub(buffer, filename) {
      this.setStatus("⏳ 正在解析 EPUB...");
      try {
        const decompress = async (entry) => {
          if (entry.compression === 0) return entry.compData;
          const ds = new DecompressionStream("deflate-raw"), writer = ds.writable.getWriter();
          writer.write(entry.compData); writer.close();
          const chunks = [], reader = ds.readable.getReader();
          while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
          const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
          let off = 0; for (const c of chunks) { out.set(c, off); off += c.length; }
          return out;
        };
        const view = new DataView(buffer), bytes = new Uint8Array(buffer), dec = new TextDecoder();
        let eocd = -1; for (let i = bytes.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        if (eocd === -1) throw new Error("ZIP EOCD not found");
        const cdOff = view.getUint32(eocd + 16, true), cdCount = view.getUint16(eocd + 8, true), entries = {};
        for (let i = 0, pos = cdOff; i < cdCount; i++) {
          const compression = view.getUint16(pos + 10, true), compSize = view.getUint32(pos + 20, true), nameLen = view.getUint16(pos + 28, true), extraLen = view.getUint16(pos + 30, true), commLen = view.getUint16(pos + 32, true), localOff = view.getUint32(pos + 42, true);
          const name = dec.decode(bytes.slice(pos + 46, pos + 46 + nameLen));
          pos += 46 + nameLen + extraLen + commLen;
          const localNameLen = view.getUint16(localOff + 26, true), localExtraLen = view.getUint16(localOff + 28, true);
          entries[name] = { compression, compData: bytes.slice(localOff + 30 + localNameLen + localExtraLen, localOff + 30 + localNameLen + localExtraLen + compSize) };
        }
        const containerXml = dec.decode(await decompress(entries["META-INF/container.xml"]));
        const opfPath = containerXml.match(/full-path="([^"]+\.opf)"/)[1], opfXml = dec.decode(await decompress(entries[opfPath]));
        const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/);
        let cache = Store.load() || { title: `syosetu_${Config.NOVEL_ID}`, chapters: {} };
        if (titleMatch) cache.title = titleMatch[1].trim();
        const manifest = {}, itemRe = /<item\s[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*media-type="([^"]+)"/g;
        let m; while ((m = itemRe.exec(opfXml))) manifest[m[1]] = { href: m[2], type: m[3] };
        const spine = [], spineRe = /<itemref\s[^>]*idref="([^"]+)"/g;
        while ((m = spineRe.exec(opfXml))) spine.push(m[1]);
        const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
        let imported = 0;
        for (const id of spine) {
          const item = manifest[id]; if (!item || !item.type.includes("html")) continue;
          const xhtml = dec.decode(await decompress(entries[opfDir + item.href] || entries[item.href]));
          const doc = new DOMParser().parseFromString(xhtml, "application/xhtml+xml"), h1 = doc.querySelector("h1");
          if (!h1) continue;
          const numMatch = h1.textContent.match(/第\s*(\d+)\s*話/);
          if (numMatch) {
            cache.chapters[numMatch[1]] = { title: h1.textContent.replace(/第\s*\d+\s*話\s*/, "").trim(), content: Array.from(doc.querySelectorAll("p")).map(p => p.textContent).join("\n").trim() };
            imported++;
          }
        }
        if (imported === 0) throw new Error("No chapters found");
        Store.save(cache); this.refreshCacheInfo(); this.setStatus(`📥 EPUB 匯入完成：${imported} 章`);
      } catch (e) { this.setStatus(`❌ EPUB 匯入失敗：${e.message}`); console.error(e); }
    }
  };

  UI.init();
})();
