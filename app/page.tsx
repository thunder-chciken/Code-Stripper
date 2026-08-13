"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";

type Mode = "text" | "newLink" | "image";

type AnchorInfo = {
  key: number;
  value: string;
  valueStart: number | null;
  valueEnd: number | null;
  insertAt: number;
};

type TextRow = {
  id: string;
  order: number;
  type: string;
  tag: string;
  original: string;
  value: string;
  leading: string;
  trailing: string;
  raw: string;
  start: number;
  end: number;
  mode: Mode;
  href: string;
  imageSrc: string;
  imageAlt: string;
  anchor?: AnchorInfo;
  node?: Text;
  protected?: false;
};

type AltRow = {
  id: string;
  order: number;
  type: "Alt Text";
  tag: "IMG";
  original: string;
  value: string;
  protected: true;
};

type EditorRow = TextRow | AltRow;

type RawTag = {
  name: string;
  start: number;
  end: number;
  anchor?: AnchorInfo;
};

type RawText = {
  start: number;
  end: number;
  raw: string;
  decoded: string;
  ancestors: RawTag[];
};

type ModalState =
  | { kind: "link"; rowId: string; text: string; href: string }
  | { kind: "image"; rowId: string; src: string; alt: string }
  | null;

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

const EXCLUDED_TAGS = new Set(["script", "style", "svg", "noscript", "template"]);

const TYPE_NAMES: Record<string, string> = {
  h1: "H1", h2: "H2", h3: "H3", h4: "H4", h5: "H5", h6: "H6",
  p: "Paragraph", span: "Span", a: "Link", button: "Button", li: "List Item",
  label: "Label", blockquote: "Blockquote", td: "Table Cell", th: "Table Header",
  caption: "Caption", figcaption: "Caption", legend: "Legend", option: "Option",
  summary: "Summary", title: "Title", dt: "Term", dd: "Description",
};

function decodeHtml(value: string) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function escapeText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string) {
  return escapeText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("=", "&#61;")
    .replaceAll("`", "&#96;")
    .replaceAll(" ", "&#32;");
}

function findTagEnd(source: string, start: number) {
  let quote = "";
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i + 1;
    }
  }
  return source.length;
}

function anchorFromTag(raw: string, start: number, end: number): AnchorInfo {
  const hrefMatch = /\bhref\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i.exec(raw);
  if (hrefMatch) {
    const whole = hrefMatch[0];
    const quoted = hrefMatch[1];
    const value = quoted ? hrefMatch[2] : hrefMatch[3];
    const relativeValueStart = (hrefMatch.index ?? 0) + whole.lastIndexOf(value);
    return {
      key: start,
      value: decodeHtml(value),
      valueStart: start + relativeValueStart,
      valueEnd: start + relativeValueStart + value.length,
      insertAt: end - 1,
    };
  }
  const closeOffset = raw.endsWith("/>") ? 2 : 1;
  return { key: start, value: "", valueStart: null, valueEnd: null, insertAt: end - closeOffset };
}

function tokenize(source: string) {
  const texts: RawText[] = [];
  const alts: AltRow[] = [];
  const stack: RawTag[] = [];
  let cursor = 0;
  const lowerSource = source.toLowerCase();

  while (cursor < source.length) {
    const rawParent = stack.at(-1)?.name;
    if ((rawParent === "script" || rawParent === "style") && !lowerSource.startsWith(`</${rawParent}`, cursor)) {
      const closeAt = lowerSource.indexOf(`</${rawParent}`, cursor);
      const end = closeAt === -1 ? source.length : closeAt;
      const raw = source.slice(cursor, end);
      texts.push({ start: cursor, end, raw, decoded: raw, ancestors: [...stack] });
      cursor = end;
      continue;
    }
    if (source[cursor] !== "<") {
      const next = source.indexOf("<", cursor);
      const end = next === -1 ? source.length : next;
      const raw = source.slice(cursor, end);
      texts.push({ start: cursor, end, raw, decoded: decodeHtml(raw), ancestors: [...stack] });
      cursor = end;
      continue;
    }

    if (source.startsWith("<!--", cursor)) {
      const end = source.indexOf("-->", cursor + 4);
      cursor = end === -1 ? source.length : end + 3;
      continue;
    }

    const end = findTagEnd(source, cursor);
    const raw = source.slice(cursor, end);
    const closing = /^<\s*\/\s*([\w:-]+)/.exec(raw);
    if (closing) {
      const name = closing[1].toLowerCase();
      const matchIndex = stack.map((tag) => tag.name).lastIndexOf(name);
      if (matchIndex >= 0) stack.splice(matchIndex);
      cursor = end;
      continue;
    }

    const opening = /^<\s*([\w:-]+)/.exec(raw);
    if (!opening || /^<\s*[!?]/.test(raw)) {
      cursor = end;
      continue;
    }

    const name = opening[1].toLowerCase();
    const tag: RawTag = { name, start: cursor, end };
    if (name === "a") tag.anchor = anchorFromTag(raw, cursor, end);

    if (name === "img") {
      const altMatch = /\balt\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i.exec(raw);
      if (altMatch) {
        const alt = decodeHtml(altMatch[2] ?? altMatch[3] ?? "");
        alts.push({
          id: `alt-${cursor}`,
          order: cursor,
          type: "Alt Text",
          tag: "IMG",
          original: alt,
          value: alt,
          protected: true,
        });
      }
    }

    if (!VOID_TAGS.has(name) && !raw.trimEnd().endsWith("/>")) stack.push(tag);
    cursor = end;
  }
  return { texts, alts };
}

function meaningfulNode(node: Text) {
  if (!node.nodeValue?.trim()) return false;
  let element = node.parentElement;
  while (element) {
    if (EXCLUDED_TAGS.has(element.tagName.toLowerCase())) return false;
    element = element.parentElement;
  }
  return true;
}

function semanticElement(node: Text) {
  let element = node.parentElement;
  let fallback = element;
  while (element) {
    const tag = element.tagName.toLowerCase();
    if (["a", "button", "li", "label", "blockquote", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "p"].includes(tag)) {
      return element;
    }
    fallback ??= element;
    element = element.parentElement;
  }
  return fallback;
}

function parseSource(source: string): EditorRow[] {
  if (!source.trim()) return [];
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const walker = parsed.createTreeWalker(parsed, NodeFilter.SHOW_TEXT);
  const domNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    if (meaningfulNode(text)) domNodes.push(text);
    current = walker.nextNode();
  }

  const { texts, alts } = tokenize(source);
  const candidates = texts.filter((token) =>
    token.decoded.trim() && !token.ancestors.some((tag) => EXCLUDED_TAGS.has(tag.name)),
  );
  const rows: TextRow[] = [];
  let rawIndex = 0;

  domNodes.forEach((node) => {
    const normalized = (node.nodeValue ?? "").replaceAll("\r\n", "\n");
    let matchIndex = -1;
    for (let i = rawIndex; i < Math.min(candidates.length, rawIndex + 20); i += 1) {
      if (candidates[i].decoded.replaceAll("\r\n", "\n") === normalized) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex === -1) return;
    rawIndex = matchIndex + 1;
    const token = candidates[matchIndex];
    const leading = token.decoded.match(/^\s*/)?.[0] ?? "";
    const trailing = token.decoded.match(/\s*$/)?.[0] ?? "";
    const value = token.decoded.slice(leading.length, token.decoded.length - trailing.length);
    const semantic = semanticElement(node);
    const tag = semantic?.tagName.toLowerCase() ?? token.ancestors.at(-1)?.name ?? "text";
    const anchor = [...token.ancestors].reverse().find((item) => item.name === "a")?.anchor;
    rows.push({
      id: `text-${token.start}-${token.end}`,
      order: token.start,
      type: anchor ? "Link" : (TYPE_NAMES[tag] ?? tag.toUpperCase()),
      tag: tag.toUpperCase(),
      original: value,
      value,
      leading,
      trailing,
      raw: token.raw,
      start: token.start,
      end: token.end,
      mode: "text",
      href: anchor?.value ?? "",
      imageSrc: "",
      imageAlt: "",
      anchor,
      node,
    });
  });

  return [...rows, ...alts].sort((a, b) => a.order - b.order);
}

type Patch = { start: number; end: number; value: string };

function renderText(row: TextRow) {
  if (row.value === row.original) return row.raw;
  return escapeText(`${row.leading}${row.value}${row.trailing}`);
}

function buildOutput(source: string, rows: EditorRow[], linkHrefs: Record<number, string>) {
  const patches: Patch[] = [];
  rows.forEach((candidate) => {
    if (candidate.protected) return;
    const row = candidate as TextRow;
    if (row.mode === "image") {
      patches.push({
        start: row.start,
        end: row.end,
        value: `<img src="${escapeAttribute(row.imageSrc)}" alt="${escapeAttribute(row.imageAlt)}">`,
      });
    } else if (row.mode === "newLink") {
      patches.push({
        start: row.start,
        end: row.end,
        value: `<a href="${escapeAttribute(row.href)}">${renderText(row)}</a>`,
      });
    } else if (row.value !== row.original) {
      patches.push({ start: row.start, end: row.end, value: renderText(row) });
    }
  });

  const anchors = new Map<number, AnchorInfo>();
  rows.forEach((row) => {
    if (!row.protected && row.anchor) anchors.set(row.anchor.key, row.anchor);
  });
  anchors.forEach((anchor, key) => {
    const next = linkHrefs[key];
    if (next === undefined || next === anchor.value) return;
    if (anchor.valueStart !== null && anchor.valueEnd !== null) {
      patches.push({ start: anchor.valueStart, end: anchor.valueEnd, value: escapeAttribute(next) });
    } else {
      patches.push({ start: anchor.insertAt, end: anchor.insertAt, value: ` href="${escapeAttribute(next)}"` });
    }
  });

  patches.sort((a, b) => b.start - a.start || b.end - a.end);
  return patches.reduce((result, patch) =>
    `${result.slice(0, patch.start)}${patch.value}${result.slice(patch.end)}`, source);
}

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Northstar Studio</title>
  <style>
    body{margin:0;background:#f4f1eb;color:#17211b;font-family:Georgia,serif}
    main{min-height:100vh;display:grid;place-items:center;padding:48px}
    article{max-width:760px} h1{font-size:clamp(48px,9vw,108px);line-height:.9;margin:18px 0}
    p{font:18px/1.6 Arial,sans-serif;max-width:580px} a{color:inherit}
  </style>
</head>
<body>
  <main>
    <article>
      <span>Independent creative practice · Chicago</span>
      <h1>Ideas built to travel.</h1>
      <p>We shape thoughtful identities and digital experiences for ambitious teams.</p>
      <a href="https://example.com">Start a conversation →</a>
    </article>
  </main>
</body>
</html>`;

export default function Home() {
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [linkHrefs, setLinkHrefs] = useState<Record<number, string>>({});
  const [modal, setModal] = useState<ModalState>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const output = useMemo(() => buildOutput(source, rows, linkHrefs), [source, rows, linkHrefs]);
  const editableRows = rows.filter((row) => !row.protected);
  const changedCount = editableRows.filter((candidate) => {
    const row = candidate as TextRow;
    return row.value !== row.original || row.mode !== "text" ||
      (row.anchor && linkHrefs[row.anchor.key] !== undefined && linkHrefs[row.anchor.key] !== row.anchor.value);
  }).length;

  function loadSource(next: string) {
    setSource(next);
    setRows(parseSource(next));
    setLinkHrefs({});
    setCopied(false);
  }

  function updateText(id: string, value: string) {
    setRows((currentRows) => currentRows.map((candidate) => {
      if (candidate.id !== id || candidate.protected) return candidate;
      const row = candidate as TextRow;
      row.node && (row.node.nodeValue = `${row.leading}${value}${row.trailing}`);
      return { ...row, value };
    }));
  }

  function openLink(row: TextRow) {
    const href = row.anchor ? (linkHrefs[row.anchor.key] ?? row.anchor.value) : row.href;
    setModal({ kind: "link", rowId: row.id, text: row.value, href });
  }

  function saveLink() {
    if (!modal || modal.kind !== "link") return;
    const target = rows.find((row) => row.id === modal.rowId);
    if (target && !target.protected && target.anchor) {
      setLinkHrefs((hrefs) => ({ ...hrefs, [target.anchor!.key]: modal.href }));
    }
    setRows((currentRows) => currentRows.map((candidate) => {
      if (candidate.id !== modal.rowId || candidate.protected) return candidate;
      const row = candidate as TextRow;
      if (row.anchor) {
        const anchor = row.node?.parentElement?.closest("a");
        anchor?.setAttribute("href", modal.href);
      } else if (row.mode === "newLink") {
        row.node?.parentElement?.closest("a")?.setAttribute("href", modal.href);
      } else if (row.node?.parentNode) {
        const anchor = row.node.ownerDocument.createElement("a");
        anchor.setAttribute("href", modal.href);
        row.node.parentNode.replaceChild(anchor, row.node);
        anchor.appendChild(row.node);
      }
      if (row.node) row.node.nodeValue = `${row.leading}${modal.text}${row.trailing}`;
      return { ...row, value: modal.text, href: modal.href, mode: row.anchor ? "text" : "newLink" };
    }));
    setModal(null);
  }

  function saveImage() {
    if (!modal || modal.kind !== "image") return;
    setRows((currentRows) => currentRows.map((candidate) => {
      if (candidate.id !== modal.rowId || candidate.protected) return candidate;
      const row = candidate as TextRow;
      if (row.node?.parentNode && row.mode !== "image") {
        const image = row.node.ownerDocument.createElement("img");
        image.setAttribute("src", modal.src);
        image.setAttribute("alt", modal.alt);
        row.node.parentNode.replaceChild(image, row.node);
      }
      return { ...row, mode: "image", imageSrc: modal.src, imageAlt: modal.alt };
    }));
    setModal(null);
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    loadSource(await file.text());
    event.target.value = "";
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      const area = document.createElement("textarea");
      area.value = output;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><i /><i /><i /></div>
          <div>
            <h1>Code Stripper</h1>
            <p>Precision content editing for finished HTML</p>
          </div>
        </div>
        <div className="status-strip" aria-label="Document status">
          <span><b>{editableRows.length}</b> text nodes</span>
          <span className={changedCount ? "status-changed" : ""}><b>{changedCount}</b> changes</span>
        </div>
        <button className="copy-button" onClick={copyOutput} disabled={!source}>
          <span aria-hidden="true">{copied ? "✓" : "▣"}</span>
          {copied ? "Copied to clipboard" : "Copy Updated Code"}
        </button>
      </header>

      <section className="workspace">
        <section className="panel source-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">01 / Source</span><h2>Original HTML</h2></div>
            <div className="heading-actions">
              <button className="text-button" onClick={() => fileRef.current?.click()}>Upload</button>
              <button className="text-button danger" onClick={() => loadSource("")} disabled={!source}>Clear</button>
            </div>
          </div>
          <input ref={fileRef} className="file-input" type="file" accept=".html,.htm,.txt,text/html,text/plain" onChange={uploadFile} />
          <div className="source-wrap">
            <textarea
              aria-label="Paste original HTML"
              value={source}
              onChange={(event) => loadSource(event.target.value)}
              placeholder="Paste your complete HTML document here…"
              spellCheck={false}
            />
            {!source && (
              <div className="source-empty" aria-hidden="true">
                <span className="paste-icon">⌘</span>
                <strong>Paste HTML to begin</strong>
                <small>or upload an .html, .htm, or .txt file</small>
                <button onClick={() => loadSource(SAMPLE_HTML)}>Load sample document</button>
              </div>
            )}
          </div>
          <footer className="panel-footer"><span>Auto-parses on input</span><span>{source.length.toLocaleString()} chars</span></footer>
        </section>

        <section className="panel extraction-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">02 / Extraction</span><h2>Content Layer</h2></div>
            <span className="node-count">{rows.length}</span>
          </div>
          <div className="rows" aria-live="polite">
            {!rows.length ? (
              <div className="empty-state">
                <div className="scan-lines"><i /><i /><i /></div>
                <strong>No content extracted yet</strong>
                <p>Meaningful text nodes will appear here in document order.</p>
              </div>
            ) : rows.map((candidate, index) => {
              if (candidate.protected) {
                return (
                  <article className="node-row protected-row" key={candidate.id}>
                    <div className="row-meta"><span className="type-badge">ALT TEXT</span><span>#{String(index + 1).padStart(2, "0")}</span></div>
                    <input value={candidate.value} readOnly aria-label="Protected image alt text" />
                    <div className="protected-note"><span>◈</span> Protected attribute · unchanged by design</div>
                  </article>
                );
              }
              const row = candidate as TextRow;
              return (
                <article className={`node-row ${row.mode === "image" ? "image-row" : ""}`} key={row.id}>
                  <div className="row-meta">
                    <span className="type-badge">{row.mode === "image" ? "IMAGE" : row.type.toUpperCase()}</span>
                    <span>#{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <input
                    id={`field-${row.id}`}
                    value={row.mode === "image" ? row.imageAlt : row.value}
                    onChange={(event) => updateText(row.id, event.target.value)}
                    readOnly={row.mode === "image"}
                    aria-label={`Edit ${row.type} text`}
                  />
                  <div className="row-actions">
                    <button className="edit-chip" onClick={() => document.getElementById(`field-${row.id}`)?.focus()} tabIndex={-1}>Edit text</button>
                    <button onClick={() => openLink(row)} disabled={row.mode === "image"}>{row.anchor || row.mode === "newLink" ? "Edit link" : "Make link"}</button>
                    <button onClick={() => setModal({ kind: "image", rowId: row.id, src: row.imageSrc, alt: row.imageAlt || row.value })}>
                      {row.mode === "image" ? "Edit image" : "Use image"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <footer className="panel-footer"><span>Document order preserved</span><span>DOM TreeWalker</span></footer>
        </section>

        <section className="panel preview-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">03 / Live View</span><h2>Viewport</h2></div>
            <div className="live-pill"><i /> Live</div>
          </div>
          <div className="browser-frame">
            <div className="browser-bar"><span /><span /><span /><div>preview.local</div></div>
            {source ? (
              <iframe title="Live HTML preview" srcDoc={output} sandbox="allow-scripts allow-forms allow-modals" />
            ) : (
              <div className="preview-empty"><div className="preview-glyph">◫</div><strong>Your page will appear here</strong><span>Paste source code to open the live viewport</span></div>
            )}
          </div>
          <footer className="panel-footer"><span><i className="safe-dot" /> Source integrity active</span><span>Responsive preview</span></footer>
        </section>
      </section>

      <aside className="integrity-bar">
        <span className="integrity-icon">◇</span>
        <div><strong>Structure lock is active</strong><small>Only text nodes and explicit link/image exceptions can change. Everything else remains byte-for-byte intact.</small></div>
        <span className="lock-pill">LOCKED</span>
      </aside>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-head">
              <div><span className="eyebrow">Allowed exception</span><h2 id="modal-title">{modal.kind === "link" ? "Insert / Edit Link" : "Replace with Image"}</h2></div>
              <button className="close-button" onClick={() => setModal(null)} aria-label="Close dialog">×</button>
            </div>
            {modal.kind === "link" ? (
              <div className="modal-fields">
                <label>Visible text<input autoFocus value={modal.text} onChange={(event) => setModal({ ...modal, text: event.target.value })} /></label>
                <label>Destination URL<input type="url" value={modal.href} onChange={(event) => setModal({ ...modal, href: event.target.value })} placeholder="https://example.com" /></label>
              </div>
            ) : (
              <div className="modal-fields">
                <label>Image URL<input autoFocus type="url" value={modal.src} onChange={(event) => setModal({ ...modal, src: event.target.value })} placeholder="https://example.com/image.jpg" /></label>
                <label>Alt text<input value={modal.alt} onChange={(event) => setModal({ ...modal, alt: event.target.value })} placeholder="Describe the image" /></label>
              </div>
            )}
            <div className="modal-note"><span>◇</span><p>The smallest possible DOM change will be applied. No surrounding markup is rewritten.</p></div>
            <div className="modal-actions"><button onClick={() => setModal(null)}>Cancel</button><button className="primary" onClick={modal.kind === "link" ? saveLink : saveImage} disabled={modal.kind === "image" ? !modal.src : !modal.href}>{modal.kind === "link" ? "Apply link" : "Insert image"}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
