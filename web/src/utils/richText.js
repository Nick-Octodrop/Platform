function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInline(value) {
  let escaped = escapeHtml(value ?? "");
  escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
    return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
  });
  escaped = escaped.replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>");
  return escaped;
}

export function renderRichTextToHtml(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return "";

  const blocks = [];
  let paragraphLines = [];
  let listKind = null;
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const content = paragraphLines.map((line) => formatInline(line)).join("<br>");
    blocks.push(`<p>${content}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listKind || !listItems.length) {
      listKind = null;
      listItems = [];
      return;
    }
    blocks.push(`<${listKind}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${listKind}>`);
    listKind = null;
    listItems = [];
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    const stripped = line.trim();
    if (!stripped) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(headingMatch[1].length, 3);
      blocks.push(`<h${level}>${formatInline(headingMatch[2].trim())}</h${level}>`);
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listKind && listKind !== "ul") flushList();
      listKind = "ul";
      listItems.push(formatInline(unorderedMatch[1].trim()));
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listKind && listKind !== "ol") flushList();
      listKind = "ol";
      listItems.push(formatInline(orderedMatch[1].trim()));
      continue;
    }

    if (listKind && listItems.length && (/^\s{2,}/.test(line) || /^\t/.test(line))) {
      listItems[listItems.length - 1] = `${listItems[listItems.length - 1]}<br>${formatInline(stripped)}`;
      continue;
    }

    if (listKind) flushList();
    paragraphLines.push(stripped);
  }

  flushParagraph();
  flushList();
  return blocks.join("");
}

function normalizeText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ");
}

function serializeInline(node) {
  if (!node) return "";
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeText(node.textContent || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  const content = Array.from(node.childNodes || []).map((child) => serializeInline(child)).join("");
  if (tag === "strong" || tag === "b") return `**${content}**`;
  if (tag === "a") {
    const href = node.getAttribute("href");
    return href ? `[${content}](${href})` : content;
  }
  return content;
}

function serializeList(node, ordered) {
  return Array.from(node.children || [])
    .filter((child) => child.tagName && child.tagName.toLowerCase() === "li")
    .map((child, index) => {
      const content = serializeInline(child).trim();
      if (!content) return "";
      return ordered ? `${index + 1}. ${content}` : `- ${content}`;
    })
    .filter(Boolean)
    .join("\n");
}

function isBlockElement(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  return ["div", "h1", "h2", "h3", "ol", "p", "ul"].includes(node.tagName.toLowerCase());
}

function serializeChildBlocks(node) {
  const blocks = Array.from(node.childNodes || [])
    .map((child) => {
      if (child.nodeType === Node.TEXT_NODE) return normalizeText(child.textContent || "").trim();
      if (isBlockElement(child)) return serializeBlock(child);
      return serializeInline(child).trim();
    })
    .filter((entry) => entry && entry.trim());
  return blocks.join("\n\n");
}

function serializeBlock(node) {
  if (!node) return "";
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeText(node.textContent || "").trim();
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  if (tag === "h1") return `# ${serializeInline(node).trim()}`;
  if (tag === "h2") return `## ${serializeInline(node).trim()}`;
  if (tag === "h3") return `### ${serializeInline(node).trim()}`;
  if (tag === "ul") return serializeList(node, false);
  if (tag === "ol") return serializeList(node, true);
  if (tag === "p" || tag === "div") {
    if (Array.from(node.childNodes || []).some(isBlockElement)) {
      return serializeChildBlocks(node);
    }
    return serializeInline(node).trim();
  }
  return serializeInline(node).trim();
}

export function renderHtmlToRichText(value) {
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return String(value ?? "").trim();
  }
  const parser = new window.DOMParser();
  const doc = parser.parseFromString(`<div>${value || ""}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  const blocks = Array.from(root.childNodes || [])
    .map((node) => serializeBlock(node))
    .filter((entry) => entry && entry.trim());
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const RICH_TEXT_HELP = "Markdown: # Heading, ## Subheading, **bold**, - bullet list, 1. numbered list";
