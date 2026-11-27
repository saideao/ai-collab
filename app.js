/* ==========================================================================
   高质量 AI 协作指南 — GitBook App Logic
   ========================================================================== */
(function () {
  const DATA = window.PSTACK_BOOK;
  if (!DATA) return;

  const STORAGE_KEYS = {
    theme: "pstack_book_theme",
    fontSize: "pstack_book_fontsize",
    read: "pstack_book_read",
    checks: "pstack_book_checks",
  };

  // Ordered flat route list for Prev / Next navigation
  const ROUTES = [
    { id: "home", hash: "#/", title: "全书概览" },
    ...DATA.chapters.map((c) => ({ id: c.id, hash: `#/${c.id}`, title: c.shortTitle })),
    { id: "skills", hash: "#/skills", title: "技能卡原文库（中英对照 · 22 份）" },
    { id: "tools", hash: "#/tools", title: "附录 A：多工具安装与调用速查" },
    { id: "reference", hash: "#/reference", title: "附录 B：技能卡索引与安全说明" },
  ];

  // Persistent state helpers
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  const state = {
    theme: localStorage.getItem(STORAGE_KEYS.theme) || "light",
    fontSize: parseInt(localStorage.getItem(STORAGE_KEYS.fontSize) || "16", 10),
    readMap: loadJSON(STORAGE_KEYS.read, {}),
    checkMap: loadJSON(STORAGE_KEYS.checks, {}),
    searchIndex: [],
    searchSelected: 0,
    refFilter: "全部",
    skillViewMode: "split",
    observer: null,
  };

  // Escape HTML safely
  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Format chapter inline text: ==highlight== (读书荧光笔底纹), **bold**, `code`
  function formatParagraph(text) {
    let s = esc(text);
    const codeSpans = [];
    s = s.replace(/`([^`]+)`/g, (_, code) => {
      const idx = codeSpans.length;
      codeSpans.push(`<code>${code}</code>`);
      return `\u0000CODE${idx}\u0000`;
    });
    s = s.replace(/==([\s\S]+?)==/g, '<span class="orig-highlight">$1</span>');
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
    return s;
  }

  function stripMarkup(text) {
    return String(text || "").replace(/==/g, "").replace(/\*\*/g, "").replace(/`/g, "");
  }

  // Zero-dependency Markdown renderer for SKILL.md originals & Chinese translations
  function renderInlineMd(raw) {
    let s = esc(raw);
    // Inline code first (protect content inside backticks)
    const codeSpans = [];
    s = s.replace(/`([^`]+)`/g, (_, code) => {
      const idx = codeSpans.length;
      codeSpans.push(`<code>${code}</code>`);
      return `\u0000CODE${idx}\u0000`;
    });
    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      if (url.startsWith("http")) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
      // Internal relative skill link like ../benchmark-checklist/SKILL.md
      const m = url.match(/\.\.\/([a-z0-9-]+)\/SKILL\.md/i);
      if (m && DATA.skillDocs && DATA.skillDocs[m[1]]) {
        return `<a href="#/skill/${m[1]}">${label}</a>`;
      }
      return `<code>${label}</code>`;
    });
    // Bold **...**
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // Italic *...*
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    // Restore code spans
    s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
    return s;
  }

  function renderMiniMd(mdText) {
    const lines = String(mdText || "").replace(/\r\n/g, "\n").split("\n");
    let out = [];
    let inCode = false;
    let codeBuf = [];
    let listType = null; // "ul" | "ol"
    let quoteBuf = [];

    function flushList() {
      if (listType) {
        out.push(`</${listType}>`);
        listType = null;
      }
    }

    function flushQuote() {
      if (quoteBuf.length) {
        out.push(`<blockquote>${quoteBuf.map((q) => `<p>${renderInlineMd(q)}</p>`).join("")}</blockquote>`);
        quoteBuf = [];
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("```")) {
        flushList();
        flushQuote();
        if (!inCode) {
          inCode = true;
          codeBuf = [];
        } else {
          out.push(`<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`);
          inCode = false;
          codeBuf = [];
        }
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        flushQuote();
        continue;
      }

      // Blockquote
      if (trimmed.startsWith(">")) {
        flushList();
        quoteBuf.push(trimmed.replace(/^>\s?/, ""));
        continue;
      } else {
        flushQuote();
      }

      // Headings
      const hm = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (hm) {
        flushList();
        const lvl = hm[1].length;
        out.push(`<h${lvl}>${renderInlineMd(hm[2])}</h${lvl}>`);
        continue;
      }

      // Unordered list
      const ulm = trimmed.match(/^[-*]\s+(.+)$/);
      if (ulm) {
        if (listType !== "ul") {
          flushList();
          out.push("<ul>");
          listType = "ul";
        }
        out.push(`<li>${renderInlineMd(ulm[1])}</li>`);
        continue;
      }

      // Ordered list
      const olm = trimmed.match(/^\d+\.\s+(.+)$/);
      if (olm) {
        if (listType !== "ol") {
          flushList();
          out.push("<ol>");
          listType = "ol";
        }
        out.push(`<li>${renderInlineMd(olm[1])}</li>`);
        continue;
      }

      flushList();
      out.push(`<p>${renderInlineMd(trimmed)}</p>`);
    }

    flushList();
    flushQuote();
    if (inCode && codeBuf.length) {
      out.push(`<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`);
    }
    return out.join("\n");
  }

  // Apply theme & font size
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(STORAGE_KEYS.theme, theme); } catch (_) {}
    document.querySelectorAll("[data-theme-set]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-theme-set") === theme);
    });
  }

  function applyFontSize(px) {
    const clamped = Math.max(14, Math.min(20, px));
    state.fontSize = clamped;
    document.documentElement.style.setProperty("--font-size-base", `${clamped}px`);
    try { localStorage.setItem(STORAGE_KEYS.fontSize, String(clamped)); } catch (_) {}
  }

  // Build search corpus
  function buildSearchIndex() {
    const docs = [];
    DATA.chapters.forEach((ch) => {
      const textParts = [
        ch.shortTitle,
        ch.title,
        ch.tagline,
        ch.skills.join(" "),
        ch.howThink,
        ch.howUse,
        ...ch.waves.flatMap((w) => [w.heading, ...w.paragraphs]),
        ...ch.quotes.flatMap((q) => [q.original, q.meaning, q.why]),
        ...ch.checklist.flatMap((i) => [i.step, i.action, i.why]),
      ].filter(Boolean);
      docs.push({
        id: ch.id,
        hash: `#/${ch.id}`,
        title: ch.shortTitle,
        part: ch.partTitle,
        text: stripMarkup(textParts.join(" ")),
      });
    });

    docs.push({
      id: "tools",
      hash: "#/tools",
      title: "附录 A：多工具安装与调用速查",
      part: "附录与速查",
      text: DATA.tools.map((t) => `${t.name} ${t.installAll} ${t.installOne} ${t.invoke} ${t.note}`).join(" "),
    });

    docs.push({
      id: "reference",
      hash: "#/reference",
      title: "附录 B：技能卡索引与安全说明",
      part: "附录与速查",
      text:
        DATA.skillIndex.map((s) => `${s.name} ${s.group} ${s.role} ${s.codingRequired}`).join(" ") +
        " " +
        DATA.securityNotes.map((n) => `${n.title} ${n.body || ""} ${(n.items || []).join(" ")}`).join(" "),
    });

    if (DATA.skillDocs) {
      Object.values(DATA.skillDocs).forEach((sd) => {
        docs.push({
          id: `skill/${sd.name}`,
          hash: `#/skill/${sd.name}`,
          title: `原文与翻译：${sd.name}`,
          part: `技能卡原文 · ${String(sd.epNum).padStart(2, "0")}`,
          text: `${sd.name} ${sd.zhTitle} ${sd.descEn} ${sd.zhMd} ${sd.bodyEn}`,
        });
      });
    }

    state.searchIndex = docs;
  }

  // Update sidebar progress bar & active link
  function updateProgress() {
    const total = DATA.chapters.length;
    const doneCount = DATA.chapters.filter((c) => !!state.readMap[c.id]).length;
    const pct = Math.round((doneCount / total) * 100);
    const label = document.getElementById("progress-label");
    const fill = document.getElementById("progress-fill");
    if (label) label.textContent = `${doneCount} / ${total} 章`;
    if (fill) fill.style.width = `${pct}%`;
  }

  function renderSidebar(currentId) {
    const nav = document.getElementById("sidebar-nav");
    if (!nav) return;

    const groups = [
      {
        title: "导览",
        items: [
          { id: "home", hash: "#/", label: "全书概览" },
          ...DATA.chapters.filter((c) => c.part === "intro").map((c) => ({
            id: c.id,
            hash: `#/${c.id}`,
            num: String(c.num).padStart(2, "0"),
            label: c.shortTitle.replace(/^\d{2}\s+/, ""),
            fullLabel: c.shortTitle,
          })),
        ],
      },
      ...DATA.parts
        .filter((p) => p.id !== "intro")
        .map((p) => ({
          title: p.title,
          items: DATA.chapters
            .filter((c) => c.part === p.id)
            .map((c) => ({
              id: c.id,
              hash: `#/${c.id}`,
              num: String(c.num).padStart(2, "0"),
              label: c.shortTitle.replace(/^\d{2}\s+/, ""),
              fullLabel: c.shortTitle,
            })),
        })),
      {
        title: "附录与原文库",
        items: [
          { id: "skills", hash: "#/skills", label: "技能卡原文库（中英对照）" },
          { id: "tools", hash: "#/tools", label: "多工具安装与调用" },
          { id: "reference", hash: "#/reference", label: "技能卡索引与安全说明" },
        ],
      },
    ];

    nav.innerHTML = groups
      .map(
        (g) => `
      <div class="nav-group">
        <div class="nav-group-title">${esc(g.title)}</div>
        ${g.items
          .map((item) => {
            const isActive = item.id === currentId;
            const isDone = !!state.readMap[item.id];
            return `
            <a class="nav-item ${isActive ? "active" : ""}" href="${item.hash}" data-nav-id="${item.id}">
              ${item.num ? `<span class="nav-num">${esc(item.num)}</span>` : ""}
              <span class="nav-item-label" title="${esc(item.fullLabel || item.label)}">${esc(item.label)}</span>
              ${isDone ? `<span class="nav-badge-done" title="已读">✓</span>` : ""}
            </a>`;
          })
          .join("")}
      </div>`
      )
      .join("");

    updateProgress();
  }

  // Prev / Next Pager
  function renderPager(currentId) {
    const idx = ROUTES.findIndex((r) => r.id === currentId);
    const prev = idx > 0 ? ROUTES[idx - 1] : null;
    const next = idx >= 0 && idx < ROUTES.length - 1 ? ROUTES[idx + 1] : null;

    return `
      <nav class="pager" aria-label="章节导航">
        ${
          prev
            ? `<a class="pager-card prev" href="${prev.hash}">
                <span class="pager-dir">← 上一页</span>
                <span class="pager-title">${esc(prev.title)}</span>
              </a>`
            : `<div></div>`
        }
        ${
          next
            ? `<a class="pager-card next" href="${next.hash}">
                <span class="pager-dir">下一页 →</span>
                <span class="pager-title">${esc(next.title)}</span>
              </a>`
            : `<div></div>`
        }
      </nav>`;
  }

  // Page: Home
  function renderHome() {
    const partCards = DATA.parts
      .filter((p) => p.id !== "intro")
      .map((p) => {
        const chs = DATA.chapters.filter((c) => c.part === p.id);
        return `
        <div class="part-card">
          <h3>${esc(p.title)}</h3>
          <p>${esc(p.desc)}</p>
          <div class="part-links">
            ${chs
              .map(
                (c) => `
              <a class="part-link" href="#/${c.id}">
                <span><span class="part-link-num">${String(c.num).padStart(2, "0")}</span>${esc(c.shortTitle.replace(/^\d{2}\s+/, "").replace(/（[^）]+）$/, ""))}</span>
                <code>${esc(c.skills[0])}</code>
              </a>`
              )
              .join("")}
          </div>
        </div>`;
      })
      .join("");

    return `
      <section class="hero">
        <div class="hero-eyebrow">开源在线指南 · 12 个 AI 协作习惯</div>
        <h1>${esc(DATA.book.title)}：${esc(DATA.book.subtitle)}</h1>
        <p class="hero-desc">${esc(DATA.book.tagline)}</p>
        <blockquote class="hero-quote">
          “给 AI 一个目标，再给一个检验它的方法，用你自己的话说。”
          <span>— Lauren Tan (poteto), pstack Guide: If you only remember one thing</span>
        </blockquote>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/ep00">从序章开始阅读 →</a>
          <a class="btn btn-secondary" href="#/skills">22 份技能卡原文与中文翻译</a>
          <a class="btn btn-secondary" href="#/tools">多工具安装速查</a>
        </div>
        ${
          DATA.book.author
            ? `<div class="author-bar">
                <span class="author-label">作者：<strong>${esc(DATA.book.author)}</strong></span>
                <div class="social-links">
                  ${
                    DATA.book.socials && DATA.book.socials.douyin
                      ? `<a class="social-icon-link" href="${esc(DATA.book.socials.douyin)}" target="_blank" rel="noopener noreferrer" aria-label="抖音主页" title="抖音：赛德奥SD">
                          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <rect width="24" height="24" rx="6" fill="#161823"/>
                            <path d="M16.6 8.2c-1.1-.6-1.9-1.7-2.1-3h-2.1v9.4c0 1.2-1 2.2-2.2 2.2s-2.2-1-2.2-2.2 1-2.2 2.2-2.2c.2 0 .5 0 .7.1V10.3c-.2 0-.5-.1-.7-.1-2.4 0-4.3 1.9-4.3 4.3s1.9 4.3 4.3 4.3 4.3-1.9 4.3-4.3V9.7c.9.7 2 1.1 3.2 1.1V8.7c-.4 0-.8-.2-1.1-.5z" fill="#25F4EE" transform="translate(-0.7,-0.5)"/>
                            <path d="M16.6 8.2c-1.1-.6-1.9-1.7-2.1-3h-2.1v9.4c0 1.2-1 2.2-2.2 2.2s-2.2-1-2.2-2.2 1-2.2 2.2-2.2c.2 0 .5 0 .7.1V10.3c-.2 0-.5-.1-.7-.1-2.4 0-4.3 1.9-4.3 4.3s1.9 4.3 4.3 4.3 4.3-1.9 4.3-4.3V9.7c.9.7 2 1.1 3.2 1.1V8.7c-.4 0-.8-.2-1.1-.5z" fill="#FE2C55" transform="translate(0.7,0.5)"/>
                            <path d="M16.6 8.2c-1.1-.6-1.9-1.7-2.1-3h-2.1v9.4c0 1.2-1 2.2-2.2 2.2s-2.2-1-2.2-2.2 1-2.2 2.2-2.2c.2 0 .5 0 .7.1V10.3c-.2 0-.5-.1-.7-.1-2.4 0-4.3 1.9-4.3 4.3s1.9 4.3 4.3 4.3 4.3-1.9 4.3-4.3V9.7c.9.7 2 1.1 3.2 1.1V8.7c-.4 0-.8-.2-1.1-.5z" fill="#FFFFFF"/>
                          </svg>
                        </a>`
                      : ""
                  }
                  ${
                    DATA.book.socials && DATA.book.socials.xiaohongshu
                      ? `<a class="social-icon-link" href="${esc(DATA.book.socials.xiaohongshu)}" target="_blank" rel="noopener noreferrer" aria-label="小红书主页" title="小红书：赛德奥SD">
                          <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                            <rect width="32" height="32" rx="8" fill="#FF2442"/>
                            <text x="16" y="19.3" text-anchor="middle" fill="#FFFFFF" font-size="8.6" font-weight="800" letter-spacing="-0.2" font-family="-apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif">小红书</text>
                          </svg>
                        </a>`
                      : ""
                  }
                </div>
              </div>`
            : ""
        }
      </section>

      <section class="section-block">
        <h2 class="section-heading" id="sec-origin">这本指南从哪来</h2>
        <p>本在线指南核心方法源自 SpaceX Principal Engineer <strong>Lauren Tan</strong>（网名 <code>poteto</code>）开源的 AI 协作方法库 <a href="${esc(DATA.book.sourceRepo)}" target="_blank" rel="noopener noreferrer"><strong>pstack</strong></a>（${esc(DATA.book.sourceLicense)}）。</p>
        <p>Lauren 把自己每天和 AI 搭档干活的习惯，写成了 60 多份简短的英文说明（技能卡与原则）。啃完这套库之后，最让人触动的并不是什么写代码的黑科技，而是一整套能让人变得更靠谱的工作习惯——说清目标、只信证据、先找根因、把教训写进规则。</p>
        <p>本指南从中挑出不写代码也能直接用的部分，整理成序章与 12 个专题章节，并附上全部 22 份官方 <code>SKILL.md</code> 的英文原文、中文对照翻译与可勾选实操清单，开源放到网上，方便大家随时查阅、直接上手。</p>
      </section>

      <section class="section-block">
        <h2 class="section-heading" id="sec-map">四组核心习惯地图</h2>
        <p>pstack 原库共有 60 多张技能卡，其中一大半面向纯软件工程。本指南精选出 12 组最通用的协作习惯——不限于写代码，日常学习、工作和做研究都能直接用，按“说清目标 → 证据验证 → 读懂与调试 → 复盘定制”四个阶段展开：</p>
        <div class="parts-grid">${partCards}</div>
      </section>

      <section class="section-block">
        <h2 class="section-heading" id="sec-howto">怎么读这本指南</h2>
        <div class="callout callout-tip">
          <h4>三分钟上手建议</h4>
          <ul>
            <li><strong>先看序章（00）建立全局观</strong>：理解为什么“技能卡”只是写下来的好习惯，以及为什么一次只拿一张卡效果最好。</li>
            <li><strong>按需挑一张卡马上试</strong>：每一章底部都配有<strong>可勾选的实操清单</strong>（勾选进度会自动保存在本地浏览器），每一步都写清了“为什么”。</li>
            <li><strong>不写代码也能用</strong>：01–03、06、08 章的思维和提示词完全不依赖写代码；普通聊天工具可以直接复制 <code>SKILL.md</code> 正文到对话开头使用。</li>
          </ul>
        </div>
      </section>

      <section class="section-block">
        <h2 class="section-heading" id="sec-source">出处与许可</h2>
        <p>本指南所讲解、收录与翻译的技能卡均源自 SpaceX Principal Engineer <strong>${esc(DATA.book.sourceAuthor)}</strong> 开源的 <strong>pstack</strong>（${esc(DATA.book.sourceLicense)}），原仓库地址：<a href="${esc(DATA.book.sourceRepo)}" target="_blank" rel="noopener noreferrer">${esc(DATA.book.sourceRepo)}</a>；本指南源码与 Markdown 章节同步开源在 <a href="https://github.com/saideao/ai-collab" target="_blank" rel="noopener noreferrer">github.com/saideao/ai-collab</a>。</p>
      </section>

      ${renderPager("home")}
    `;
  }

  // Page: Episode Chapter
  function renderChapter(ch) {
    const isRead = !!state.readMap[ch.id];

    // Special block for Ep 1 reframe real test
    let reframeDemoHTML = "";
    if (ch.reframeDemo) {
      const d = ch.reframeDemo;
      reframeDemoHTML = `
        <details class="demo-details">
          <summary>展开查看：reframe 实测完整拆解（作文自动打分示例）</summary>
          <div class="demo-details-body">
            <div class="prompt-compare">
              <div class="prompt-card">
                <h4>改前（大白话原描述）</h4>
                <div>${esc(d.beforePrompt)}</div>
              </div>
              <div class="prompt-card">
                <h4>改后（用新词重写的描述）</h4>
                <div>${esc(d.afterPrompt)}</div>
              </div>
            </div>
            ${
              d.problems && d.problems.length
                ? `<h4>第 0 步：先拆出 3 个可能的问题</h4>
                   <div class="table-wrap"><table>
                     <thead><tr><th>可能的问题</th><th>叫什么</th><th>怎么区分</th></tr></thead>
                     <tbody>${d.problems
                       .map(
                         (r) => `<tr><td>${esc(r["可能的问题"])}</td><td><strong>${esc(r["叫什么"])}</strong></td><td>${esc(r["怎么区分"])}</td></tr>`
                       )
                       .join("")}</tbody>
                   </table></div>`
                : ""
            }
            ${
              d.terms && d.terms.length
                ? `<h4>第 1 步：按“对最终结果影响多大”排序的 10 个术语</h4>
                   <div class="table-wrap"><table>
                     <thead><tr><th>#</th><th>术语</th><th>一句白话</th><th>知道后能向 AI 要什么</th></tr></thead>
                     <tbody>${d.terms
                       .map(
                         (r) => `<tr>
                           <td>${esc(r["#"])}</td>
                           <td><strong>${esc(r["术语"])}</strong></td>
                           <td>${esc(r["一句白话"])}</td>
                           <td>${esc(r["知道这个词以后能向 agent 要什么"])}</td>
                         </tr>`
                       )
                       .join("")}</tbody>
                   </table></div>`
                : ""
            }
          </div>
        </details>`;
    }

    // Special block for Ep 5 seven questions
    let sevenHTML = "";
    if (ch.extraList && ch.extraList.length) {
      sevenHTML = `
        <section class="section-block">
          <h2 class="section-heading" id="sec-seven">benchmark-checklist 完整七问速览</h2>
          <div class="seven-grid">
            ${ch.extraList
              .map(
                (item, idx) => `
              <div class="seven-card">
                <span class="seven-num">${idx + 1}</span>${esc(item)}
              </div>`
              )
              .join("")}
          </div>
        </section>`;
    }

    // Main reading waves
    const wavesHTML = ch.waves
      .map((w, idx) => {
        const cls =
          w.tag === "before"
            ? "is-before"
            : w.tag === "after"
            ? "is-after"
            : w.tag === "summary"
            ? "is-summary"
            : "";
        const badge =
          w.tag === "before"
            ? `<span class="wave-badge wave-before">改前对比</span>`
            : w.tag === "after"
            ? `<span class="wave-badge wave-after">改后效果</span>`
            : w.tag === "summary"
            ? `<span class="wave-badge wave-summary">小结</span>`
            : "";
        const bodyHTML = w.blocks
          ? w.blocks
              .map((b) => {
                if (b.type === "ol") {
                  return `<ol class="wave-list">${b.items.map((it) => `<li>${formatParagraph(it)}</li>`).join("")}</ol>`;
                }
                if (b.type === "ul") {
                  return `<ul class="wave-list">${b.items.map((it) => `<li>${formatParagraph(it)}</li>`).join("")}</ul>`;
                }
                return `<p>${formatParagraph(b.text)}</p>`;
              })
              .join("")
          : w.paragraphs.map((p) => `<p>${formatParagraph(p)}</p>`).join("");
        return `
          <section class="section-block ${cls}">
            <h2 class="section-heading" id="wave-${idx}">${esc(w.heading)} ${badge}</h2>
            ${bodyHTML}
          </section>`;
      })
      .join("");

    // Quotes section
    const quotesHTML =
      ch.quotes && ch.quotes.length
        ? `
        <section class="section-block">
          <h2 class="section-heading" id="sec-quotes">原文精要：为什么这么写</h2>
          <div class="quotes-list">
            ${ch.quotes
              .map(
                (q) => `
              <div class="quote-card">
                <div class="quote-en">${esc(q.original)}${q.source ? `<span class="quote-src">${esc(q.source)}</span>` : ""}</div>
                <div class="quote-meta">
                  <div><strong>意思：</strong>${esc(q.meaning)}</div>
                  <div><strong>为什么：</strong>${esc(q.why)}</div>
                </div>
              </div>`
              )
              .join("")}
          </div>
        </section>`
        : "";

    // Interactive checklist section
    const checkedCount = ch.checklist.filter((_, idx) => !!state.checkMap[`${ch.id}_${idx}`]).length;
    const checklistHTML =
      ch.checklist && ch.checklist.length
        ? `
        <section class="section-block">
          <div class="section-heading checklist-header" id="sec-checklist">
            <span>实操清单（可勾选）</span>
            <span class="checklist-counter" id="checklist-counter">已完成 ${checkedCount} / ${ch.checklist.length}</span>
          </div>
          <div class="checklist">
            ${ch.checklist
              .map((item, idx) => {
                const key = `${ch.id}_${idx}`;
                const isChecked = !!state.checkMap[key];
                return `
                <label class="check-item ${isChecked ? "checked" : ""}" data-check-key="${key}">
                  <input type="checkbox" ${isChecked ? "checked" : ""} data-check-input="${key}" />
                  <div class="check-body">
                    <div class="check-step">${esc(item.step)}</div>
                    <div class="check-action">${esc(item.action)}</div>
                    ${item.why ? `<div class="check-why"><strong>为什么：</strong>${esc(item.why)}</div>` : ""}
                  </div>
                </label>`;
              })
              .join("")}
          </div>
        </section>`
        : "";

    const reflectionHTML = ch.question
      ? `
      <div class="reflection-box">
        <div class="reflection-title">留给自己想一想</div>
        <p>${esc(ch.question)}</p>
      </div>`
      : "";

    const attachedSkills = (ch.skills || [])
      .map((name) => DATA.skillDocs && DATA.skillDocs[name])
      .filter(Boolean);

    const skillAttachHTML = attachedSkills.length
      ? `
      <section class="section-block">
        <h2 class="section-heading" id="sec-skills">本章技能卡原文与中文翻译</h2>
        <p>点击进入二级对照页可并排阅读英文原版 <code>SKILL.md</code> 与完整中文翻译，也可以直接复制英文原文粘贴到聊天工具里使用。</p>
        <div class="skill-attach-grid">
          ${attachedSkills
            .map(
              (sd) => `
            <div class="skill-attach-card">
              <div class="skill-attach-head">
                <span class="skill-attach-name">/${esc(sd.name)}</span>
                <span class="skill-attach-lines">原文 ${sd.lines} 行</span>
              </div>
              <div class="skill-attach-title">${esc(sd.zhTitle)}</div>
              <div class="skill-attach-actions">
                <a class="btn-sm primary" href="#/skill/${esc(sd.name)}">阅读原文与中文翻译 →</a>
                <button class="btn-sm" data-copy-skill-en="${esc(sd.name)}" type="button">复制英文原文</button>
              </div>
            </div>`
            )
            .join("")}
        </div>
      </section>`
      : "";

    return `
      <div class="chapter-meta-top">
        <div class="breadcrumb">${esc(ch.partTitle)} / ${ch.num === 0 ? "00 序章" : String(ch.num).padStart(2, "0")}</div>
        <button id="read-toggle-btn" class="read-toggle ${isRead ? "is-read" : ""}" data-read-id="${ch.id}" type="button">
          ${isRead ? "✓ 已读本章" : "○ 标为已读"}
        </button>
      </div>

      <h1 class="chapter-title">${esc(ch.title)}</h1>
      <p class="chapter-tagline">${esc(ch.tagline)}</p>

      <div class="skill-pills">
        ${ch.skills
          .map((s) =>
            DATA.skillDocs && DATA.skillDocs[s]
              ? `<a href="#/skill/${esc(s)}" class="pill pill-skill" title="查看 ${esc(s)} 原文与中文翻译">/${esc(s)} 原文与翻译 ↗</a>`
              : `<span class="pill pill-skill">/${esc(s)}</span>`
          )
          .join("")}
        <span class="pill pill-muted">${esc(ch.duration)}</span>
      </div>

      <div class="summary-grid">
        <div class="summary-box summary-box-think">
          <div class="summary-label">怎么想 · 核心思维</div>
          <p>${esc(ch.howThink)}</p>
        </div>
        <div class="summary-box summary-box-use">
          <div class="summary-label">怎么用 · 实操抓手</div>
          <p>${esc(ch.howUse)}</p>
        </div>
      </div>

      ${wavesHTML}
      ${reframeDemoHTML}
      ${sevenHTML}
      ${quotesHTML}
      ${checklistHTML}
      ${skillAttachHTML}
      ${reflectionHTML}
      ${renderPager(ch.id)}
    `;
  }

  // Page: All 22 Skills Library (#/skills)
  function renderSkillsLibrary() {
    const sections = DATA.chapters
      .map((ch) => {
        const list = (ch.skills || [])
          .map((name) => DATA.skillDocs && DATA.skillDocs[name])
          .filter(Boolean);
        if (!list.length) return "";
        return `
        <section class="section-block">
          <h2 class="section-heading" id="lib-${ch.id}">
            <span>${esc(ch.shortTitle)}</span>
            <a href="#/${ch.id}" style="font-size:13px; font-weight:500; margin-left:auto;">看本章内容 →</a>
          </h2>
          <div class="skill-attach-grid">
            ${list
              .map(
                (sd) => `
              <div class="skill-attach-card">
                <div class="skill-attach-head">
                  <span class="skill-attach-name">/${esc(sd.name)}</span>
                  <span class="skill-attach-lines">原文 ${sd.lines} 行</span>
                </div>
                <div class="skill-attach-title">${esc(sd.zhTitle)}</div>
                <div class="skill-attach-actions">
                  <a class="btn-sm primary" href="#/skill/${esc(sd.name)}">中英对照阅读 →</a>
                  <button class="btn-sm" data-copy-skill-en="${esc(sd.name)}" type="button">复制英文原文</button>
                </div>
              </div>`
              )
              .join("")}
          </div>
        </section>`;
      })
      .join("");

    return `
      <div class="chapter-meta-top">
        <div class="breadcrumb">附录与原文库 / 全部技能卡原文</div>
        <span class="pill pill-muted">共 ${Object.keys(DATA.skillDocs || {}).length} 份 SKILL.md</span>
      </div>
      <h1 class="chapter-title">pstack 技能卡原文库（中英双栏对照）</h1>
      <p class="chapter-tagline">完整收录本系列涉及的全部 22 份官方原版 SKILL.md 英文原文与中文翻译，支持一键复制英文原文直接粘贴使用。</p>
      ${sections}
      <details class="mit-box">
        <summary>版权与开源许可声明：pstack · Copyright (c) 2026 Lauren Tan · MIT License（点击展开完整许可）</summary>
        <pre>${esc(DATA.mitLicense || "")}</pre>
      </details>
      ${renderPager("skills")}
    `;
  }

  // Page: Skill Detail Subpage (#/skill/<name>)
  function renderSkillPage(skillName) {
    const sd = DATA.skillDocs && DATA.skillDocs[skillName];
    if (!sd) return renderHome();

    const parentCh = DATA.chapters.find((c) => c.id === sd.epId);
    const peerSkills = parentCh
      ? parentCh.skills.filter((s) => DATA.skillDocs && DATA.skillDocs[s])
      : [skillName];

    const mode = state.skillViewMode || "split";
    const showEn = mode === "split" || mode === "en";
    const showZh = mode === "split" || mode === "zh";

    const peerHTML =
      peerSkills.length > 1
        ? `<div class="skill-pills" style="margin-bottom:8px;">
            <span class="pill pill-muted">同章技能卡：</span>
            ${peerSkills
              .map(
                (s) =>
                  `<a href="#/skill/${esc(s)}" class="pill ${s === skillName ? "pill-skill" : "pill-muted"}">/${esc(s)}</a>`
              )
              .join("")}
          </div>`
        : "";

    return `
      <a class="skill-back-link" href="#/${esc(sd.epId)}">← 返回 ${esc(sd.epTitle)}</a>

      <div class="chapter-meta-top">
        <div class="breadcrumb">技能卡原文与中文翻译 / pstack/skills/${esc(sd.name)}/SKILL.md</div>
        <span class="pill pill-muted">原文共 ${sd.lines} 行</span>
      </div>

      <h1 class="chapter-title">${esc(sd.zhTitle)}</h1>
      ${sd.descEn ? `<p class="chapter-tagline">${esc(sd.descEn)}</p>` : ""}
      ${peerHTML}

      <div class="skill-toolbar">
        <div class="view-tabs" role="tablist" aria-label="视图切换">
          <button class="view-tab ${mode === "split" ? "active" : ""}" data-skill-view="split" type="button">中英双栏对照</button>
          <button class="view-tab ${mode === "zh" ? "active" : ""}" data-skill-view="zh" type="button">仅看中文翻译</button>
          <button class="view-tab ${mode === "en" ? "active" : ""}" data-skill-view="en" type="button">仅看英文原文</button>
        </div>
        <div class="skill-toolbar-actions">
          <button class="btn-sm primary" data-copy-skill-en="${esc(sd.name)}" type="button">复制英文原文 (SKILL.md)</button>
          <button class="btn-sm" data-copy-skill-zh="${esc(sd.name)}" type="button">复制中文翻译</button>
          <a class="btn-sm" href="${esc(sd.githubUrl)}" target="_blank" rel="noopener noreferrer">GitHub 原文件 ↗</a>
        </div>
      </div>

      <div class="bilingual-grid ${mode !== "split" ? "single-col" : ""}">
        ${
          showZh
            ? `<div class="md-pane">
                <div class="md-pane-head">
                  <span>中文翻译（供理解与参考）</span>
                  <span>${esc(sd.name)}</span>
                </div>
                <div class="md-body">${renderMiniMd(sd.zhMd)}</div>
              </div>`
            : ""
        }
        ${
          showEn
            ? `<div class="md-pane">
                <div class="md-pane-head">
                  <span>英文原文（pstack/skills/${esc(sd.name)}/SKILL.md）</span>
                  <span>${sd.lines} lines</span>
                </div>
                <div class="md-body is-en">${renderMiniMd(sd.bodyEn)}</div>
              </div>`
            : ""
        }
      </div>

      <details class="mit-box">
        <summary>版权与开源许可声明：pstack · Copyright (c) 2026 Lauren Tan · MIT License（点击展开完整许可）</summary>
        <p style="margin:10px 0 0;">原文件出处：<a href="${esc(sd.githubUrl)}" target="_blank" rel="noopener noreferrer">${esc(sd.githubUrl)}</a>。依据 MIT 许可证条款，完整收录并翻译原文须附上原始版权声明及下方许可全文。</p>
        <pre>${esc(DATA.mitLicense || "")}</pre>
      </details>

      <nav class="pager" aria-label="返回章节">
        <a class="pager-card prev" href="#/${esc(sd.epId)}">
          <span class="pager-dir">← 返回所属章节</span>
          <span class="pager-title">${esc(sd.epTitle)}</span>
        </a>
        <a class="pager-card next" href="#/reference">
          <span class="pager-dir">全部技能卡 →</span>
          <span class="pager-title">附录 B：技能卡索引与安全说明</span>
        </a>
      </nav>
    `;
  }

  // Page: Appendix A (Tools)
  function renderTools() {
    return `
      <div class="chapter-meta-top">
        <div class="breadcrumb">附录与速查 / 附录 A</div>
      </div>
      <h1 class="chapter-title">在不同工具里怎么装、怎么用</h1>
      <p class="chapter-tagline">pstack 的本质是写给 AI 看的英文 Markdown 说明文件（SKILL.md），不绑定某一款工具。</p>

      <div class="callout callout-info">
        <h4>新手起步原则：一次只拿一张卡</h4>
        <p style="margin:0;">先去 GitHub 挑 1–2 张技能卡读一遍原文，放进单个技能目录或直接复制到对话开头。整套 60 多张一起装时，不仅分不清哪张起作用，而且部分多模型评审卡会成倍消耗 Token。</p>
      </div>

      ${DATA.tools
        .map(
          (t, i) => `
        <section class="tool-card">
          <h3 id="tool-${i}">${esc(t.name)}</h3>
          <div style="font-size:13px; color:var(--text-muted); font-weight:600;">安装整套：</div>
          <div class="code-block"><span>${esc(t.installAll)}</span><button class="copy-btn" data-copy="${esc(t.installAll)}" type="button">复制</button></div>
          <div style="font-size:13px; color:var(--text-muted); font-weight:600;">只拿单张技能卡：</div>
          <div class="code-block"><span>${esc(t.installOne)}</span><button class="copy-btn" data-copy="${esc(t.installOne)}" type="button">复制</button></div>
          <p style="margin:6px 0 4px; font-size:14px;"><strong>调用方式：</strong>${esc(t.invoke)}</p>
          <p style="margin:0; font-size:13.5px; color:var(--text-muted);">${esc(t.note)}</p>
        </section>`
        )
        .join("")}

      ${renderPager("tools")}
    `;
  }

  // Page: Appendix B (Reference & Security)
  function renderReference() {
    const groups = ["全部", "对齐目标", "挑刺验证", "读懂调试", "长任务留痕", "复盘演进", "无需写代码"];
    const filtered = DATA.skillIndex.filter((s) => {
      if (state.refFilter === "全部") return true;
      if (state.refFilter === "无需写代码") return s.codingRequired.includes("否");
      return s.group === state.refFilter;
    });

    return `
      <div class="chapter-meta-top">
        <div class="breadcrumb">附录与速查 / 附录 B</div>
      </div>
      <h1 class="chapter-title">技能卡速查索引与安全核实</h1>
      <p class="chapter-tagline">一屏检索全系列涉及的技能卡与原则，并核实许可证与安全注意事项。</p>

      <section class="section-block">
        <h2 class="section-heading" id="sec-index">技能卡速查表</h2>
        <div class="filter-bar">
          ${groups
            .map(
              (g) => `<button class="filter-chip ${state.refFilter === g ? "active" : ""}" data-ref-filter="${esc(g)}" type="button">${esc(g)}</button>`
            )
            .join("")}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>技能卡 / 原则</th>
                <th>所属阶段</th>
                <th>核心作用</th>
                <th>是否需要写代码</th>
                <th>对应章节</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map((s) => {
                  const slugs = s.name
                    .split("/")
                    .map((x) => x.trim())
                    .map((x) => (DATA.skillDocs && DATA.skillDocs[x] ? x : DATA.skillDocs && DATA.skillDocs[`principle-${x}`] ? `principle-${x}` : null))
                    .filter(Boolean);
                  const origLinks = slugs
                    .map((slug) => `<a href="#/skill/${esc(slug)}" style="margin-right:8px; white-space:nowrap;">${esc(slug.replace(/^principle-/, ""))} ↗</a>`)
                    .join("");
                  return `
                <tr>
                  <td><code>${esc(s.name)}</code></td>
                  <td>${esc(s.group)}</td>
                  <td>${esc(s.role)}</td>
                  <td>${esc(s.codingRequired)}</td>
                  <td><a href="#/${s.ep}" style="display:block; margin-bottom:4px;">去章节 →</a>${origLinks ? `<span style="font-size:12px;">原文：${origLinks}</span>` : ""}</td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="section-block">
        <h2 class="section-heading" id="sec-security">安全核实与许可证说明</h2>
        ${DATA.securityNotes
          .map(
            (n) => `
          <div class="callout callout-${n.type}">
            <h4>${esc(n.title)}</h4>
            ${n.body ? `<p style="margin:0;">${esc(n.body)}</p>` : ""}
            ${n.items ? `<ul>${n.items.map((it) => `<li>${esc(it)}</li>`).join("")}</ul>` : ""}
          </div>`
          )
          .join("")}
      </section>

      ${renderPager("reference")}
    `;
  }

  // Right-hand TOC builder & scroll-spy
  function buildTOC() {
    const tocList = document.getElementById("toc-list");
    if (!tocList) return;
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    const headings = Array.from(document.querySelectorAll("#page-root h2[id], #page-root h3[id], #page-root .checklist-header[id]"));
    if (!headings.length) {
      tocList.innerHTML = `<li style="font-size:12px; color:var(--text-faint);">本页无子标题</li>`;
      return;
    }

    tocList.innerHTML = headings
      .map((el) => {
        const text = el.querySelector("span") ? el.querySelector("span").textContent : el.textContent;
        const clean = text.replace(/(改前对比|改后效果|小结)$/, "").trim();
        return `<li><a class="toc-link" href="javascript:void(0)" data-toc-target="${el.id}">${esc(clean)}</a></li>`;
      })
      .join("");

    tocList.querySelectorAll(".toc-link").forEach((a) => {
      a.addEventListener("click", () => {
        const target = document.getElementById(a.getAttribute("data-toc-target"));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    const links = Array.from(tocList.querySelectorAll(".toc-link"));
    if (links.length) links[0].classList.add("active");

    state.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            links.forEach((l) => l.classList.toggle("active", l.getAttribute("data-toc-target") === id));
          }
        });
      },
      { rootMargin: "-70px 0px -70% 0px", threshold: 0.1 }
    );

    headings.forEach((h) => state.observer.observe(h));
  }

  // Bind interactive controls inside rendered page
  function bindPageInteractions(currentId) {
    // Mark as read toggle
    const readBtn = document.getElementById("read-toggle-btn");
    if (readBtn) {
      readBtn.addEventListener("click", () => {
        const id = readBtn.getAttribute("data-read-id");
        state.readMap[id] = !state.readMap[id];
        saveJSON(STORAGE_KEYS.read, state.readMap);
        readBtn.classList.toggle("is-read", state.readMap[id]);
        readBtn.textContent = state.readMap[id] ? "✓ 已读本章" : "○ 标为已读";
        renderSidebar(currentId);
      });
    }

    // Checklists
    document.querySelectorAll("[data-check-input]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const key = cb.getAttribute("data-check-input");
        state.checkMap[key] = cb.checked;
        saveJSON(STORAGE_KEYS.checks, state.checkMap);
        const label = cb.closest(".check-item");
        if (label) label.classList.toggle("checked", cb.checked);

        const ch = DATA.chapters.find((c) => c.id === currentId);
        if (ch) {
          const total = ch.checklist.length;
          const done = ch.checklist.filter((_, idx) => !!state.checkMap[`${ch.id}_${idx}`]).length;
          const counter = document.getElementById("checklist-counter");
          if (counter) counter.textContent = `已完成 ${done} / ${total}`;
          if (done === total && !state.readMap[ch.id]) {
            state.readMap[ch.id] = true;
            saveJSON(STORAGE_KEYS.read, state.readMap);
            if (readBtn) {
              readBtn.classList.add("is-read");
              readBtn.textContent = "✓ 已读本章";
            }
            renderSidebar(currentId);
          }
        }
      });
    });

    // Copy helper
    function copyText(txt, btn) {
      const origLabel = btn.textContent;
      const done = () => {
        btn.textContent = "已复制 ✓";
        setTimeout(() => (btn.textContent = origLabel), 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done).catch(() => {
          const ta = document.createElement("textarea");
          ta.value = txt;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          done();
        });
      } else {
        const ta = document.createElement("textarea");
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      }
    }

    // Copy buttons
    document.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", () => copyText(btn.getAttribute("data-copy"), btn));
    });

    // Copy skill raw EN or ZH buttons
    document.querySelectorAll("[data-copy-skill-en]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sd = DATA.skillDocs && DATA.skillDocs[btn.getAttribute("data-copy-skill-en")];
        if (sd) copyText(sd.rawEn, btn);
      });
    });

    document.querySelectorAll("[data-copy-skill-zh]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sd = DATA.skillDocs && DATA.skillDocs[btn.getAttribute("data-copy-skill-zh")];
        if (sd) copyText(sd.zhMd, btn);
      });
    });

    // Skill view switcher (split / zh / en)
    document.querySelectorAll("[data-skill-view]").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.skillViewMode = tab.getAttribute("data-skill-view");
        renderRoute();
      });
    });

    // Reference filter chips
    document.querySelectorAll("[data-ref-filter]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.refFilter = chip.getAttribute("data-ref-filter");
        renderRoute();
      });
    });
  }

  // Router
  function getRouteId() {
    const raw = (location.hash || "#/").replace(/^#\/?/, "").trim();
    if (!raw) return "home";
    if (raw === "tools" || raw === "reference" || raw === "skills") return raw;
    if (raw.startsWith("skill/")) {
      const sName = raw.slice("skill/".length);
      if (DATA.skillDocs && DATA.skillDocs[sName]) return raw;
    }
    if (DATA.chapters.some((c) => c.id === raw)) return raw;
    return "home";
  }

  function renderRoute() {
    const id = getRouteId();
    const root = document.getElementById("page-root");
    const mainEl = document.getElementById("main-content");
    const tocEl = document.getElementById("toc-sidebar");
    if (!root) return;

    const isSkillPage = id.startsWith("skill/");
    if (mainEl) mainEl.classList.toggle("is-wide", isSkillPage);
    if (tocEl) tocEl.classList.toggle("is-hidden", isSkillPage);

    let sidebarActiveId = id;

    if (id === "home") {
      root.innerHTML = renderHome();
      document.title = `${DATA.book.title} · ${DATA.book.subtitle}`;
    } else if (id === "skills") {
      root.innerHTML = renderSkillsLibrary();
      document.title = `技能卡原文库（中英对照） · ${DATA.book.title}`;
    } else if (id === "tools") {
      root.innerHTML = renderTools();
      document.title = `多工具安装与调用 · ${DATA.book.title}`;
    } else if (id === "reference") {
      root.innerHTML = renderReference();
      document.title = `技能卡索引与安全说明 · ${DATA.book.title}`;
    } else if (isSkillPage) {
      const sName = id.slice("skill/".length);
      const sd = DATA.skillDocs[sName];
      root.innerHTML = renderSkillPage(sName);
      document.title = `${sd.name} 原文与翻译 · ${DATA.book.title}`;
      sidebarActiveId = sd.epId;
    } else {
      const ch = DATA.chapters.find((c) => c.id === id);
      root.innerHTML = renderChapter(ch);
      document.title = `${ch.shortTitle} · ${DATA.book.title}`;
    }

    renderSidebar(sidebarActiveId);
    if (!isSkillPage) buildTOC();
    bindPageInteractions(id);
    closeMobileSidebar();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  // Mobile sidebar drawer
  function openMobileSidebar() {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sidebar-backdrop").hidden = false;
  }

  function closeMobileSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-backdrop").hidden = true;
  }

  // Search Modal
  function openSearch() {
    const modal = document.getElementById("search-modal");
    const input = document.getElementById("search-input");
    modal.hidden = false;
    input.value = "";
    renderSearchResults("");
    setTimeout(() => input.focus(), 20);
  }

  function closeSearch() {
    document.getElementById("search-modal").hidden = true;
  }

  function highlightSnippet(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return esc(text.slice(0, 95)) + "…";
    const start = Math.max(0, idx - 32);
    const end = Math.min(text.length, idx + query.length + 58);
    const slice = text.slice(start, end);
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    return (start > 0 ? "…" : "") + esc(slice).replace(re, "<mark>$1</mark>") + (end < text.length ? "…" : "");
  }

  function renderSearchResults(q) {
    const box = document.getElementById("search-results");
    const query = q.trim();
    let matches = [];
    if (!query) {
      matches = state.searchIndex.slice(0, 7).map((d) => ({ ...d, snippet: d.text.slice(0, 80) + "…" }));
    } else {
      const ql = query.toLowerCase();
      matches = state.searchIndex
        .filter((d) => d.title.toLowerCase().includes(ql) || d.text.toLowerCase().includes(ql))
        .map((d) => ({ ...d, snippet: highlightSnippet(d.text, query) }));
    }

    state.searchSelected = 0;

    if (!matches.length) {
      box.innerHTML = `<div class="search-empty">没有找到包含 “${esc(query)}” 的内容，试试搜索技能卡英文名或核心词（如 reframe、测试集、不确定）。</div>`;
      return;
    }

    box.innerHTML = matches
      .map(
        (m, idx) => `
      <a class="search-item ${idx === 0 ? "selected" : ""}" href="${m.hash}" data-search-idx="${idx}">
        <div class="search-item-head">
          <span class="search-item-title">${esc(m.title)}</span>
          <span class="search-item-part">${esc(m.part)}</span>
        </div>
        <div class="search-item-snippet">${m.snippet}</div>
      </a>`
      )
      .join("");

    box.querySelectorAll(".search-item").forEach((el) => {
      el.addEventListener("click", () => closeSearch());
    });
  }

  function moveSearchSelection(delta) {
    const items = Array.from(document.querySelectorAll("#search-results .search-item"));
    if (!items.length) return;
    state.searchSelected = (state.searchSelected + delta + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle("selected", i === state.searchSelected));
    items[state.searchSelected].scrollIntoView({ block: "nearest" });
  }

  // Init
  function init() {
    applyTheme(state.theme);
    applyFontSize(state.fontSize);
    buildSearchIndex();

    document.querySelectorAll("[data-theme-set]").forEach((btn) => {
      btn.addEventListener("click", () => applyTheme(btn.getAttribute("data-theme-set")));
    });

    document.getElementById("font-dec").addEventListener("click", () => applyFontSize(state.fontSize - 1));
    document.getElementById("font-inc").addEventListener("click", () => applyFontSize(state.fontSize + 1));

    document.getElementById("menu-toggle").addEventListener("click", () => {
      const sb = document.getElementById("sidebar");
      sb.classList.contains("open") ? closeMobileSidebar() : openMobileSidebar();
    });
    document.getElementById("sidebar-backdrop").addEventListener("click", closeMobileSidebar);

    document.getElementById("search-trigger").addEventListener("click", openSearch);
    document.getElementById("search-close").addEventListener("click", closeSearch);
    document.getElementById("search-modal").addEventListener("click", (e) => {
      if (e.target.id === "search-modal") closeSearch();
    });
    document.getElementById("search-input").addEventListener("input", (e) => renderSearchResults(e.target.value));

    document.addEventListener("keydown", (e) => {
      const modal = document.getElementById("search-modal");
      const isOpen = !modal.hidden;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        isOpen ? closeSearch() : openSearch();
        return;
      }

      if (isOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeSearch();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          moveSearchSelection(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          moveSearchSelection(-1);
        } else if (e.key === "Enter") {
          const sel = document.querySelector("#search-results .search-item.selected");
          if (sel) {
            e.preventDefault();
            location.hash = sel.getAttribute("href");
            closeSearch();
          }
        }
        return;
      }

      // Quick slash search when not typing in an input
      if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault();
        openSearch();
      }
    });

    window.addEventListener("hashchange", renderRoute);
    renderRoute();
  }

  init();
})();
