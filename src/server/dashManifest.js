const XML_TAG = /<!--[^]*?-->|<!\[CDATA\[[^]*?\]\]>|<\?[^]*?\?>|<\/?[\w:.-]+(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
const XML_ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(text) {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, name) => {
    if (Object.hasOwn(entities, name)) return entities[name];
    if (!name.startsWith("#")) return entity;
    const code = name[1] === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

function escapeXml(text) {
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[char]);
}

function parseManifest(text) {
  const stack = [];
  let root;
  let cursor = 0;
  for (const token of text.matchAll(XML_TAG)) {
    const [tag] = token;
    const between = text.slice(cursor, token.index);
    if (between.includes("<") || (!stack.length && between.trim())) return null;
    cursor = token.index + tag.length;
    if (tag.startsWith("<!") || tag.startsWith("<?")) continue;
    const [, closing, qualifiedName] = /^<(\/?)([\w:.-]+)/.exec(tag);
    if (closing) {
      const node = stack.pop();
      if (node?.qualifiedName !== qualifiedName) return null;
      node.close = token.index;
      continue;
    }
    const node = {
      qualifiedName, name: qualifiedName.split(":").at(-1), tag, start: token.index,
      openEnd: cursor, close: cursor, children: [],
      attrs: Object.fromEntries([...tag.matchAll(XML_ATTRIBUTE)].map(([, name, double, single]) =>
        [name, unescapeXml(double ?? single)])),
    };
    if (stack.length) stack.at(-1).children.push(node);
    else if (root) return null;
    else root = node;
    if (!tag.endsWith("/>")) {
      if (stack.length >= 128) return null;
      stack.push(node);
    }
  }
  return stack.length || text.slice(cursor).trim() || root?.name !== "MPD" ? null : root;
}

function containsElement(node, name) {
  return node.name === name || node.children.some((child) => containsElement(child, name));
}

function inspectRoot(root) {
  if (!root) return { ok: false, reason: "no stream found" };
  if (root.attrs.type && root.attrs.type !== "static") return { ok: false, reason: "live stream, not supported" };
  if (containsElement(root, "ContentProtection")) return { ok: false, reason: "protected stream, not supported" };
  return { ok: true };
}

function inspectManifest(text) {
  return inspectRoot(parseManifest(text));
}

const child = (node, name) => node?.children.find((entry) => entry.name === name);
const baseValue = (text, node) => unescapeXml(text.slice(node.openEnd, node.close).trim());

function resolveUrl(value, base) {
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid DASH resource");
  }
  return url;
}

function proxyAddress(url, baseFor) {
  const path = url.pathname;
  const template = path.indexOf("$");
  const split = path.lastIndexOf("/", template < 0 ? path.length : template) + 1;
  return baseFor(url.origin + path.slice(0, split)) + path.slice(split) + url.search;
}

const urlAttributes = {
  SegmentTemplate: new Set(["media", "initialization", "index", "bitstreamSwitching"]),
  SegmentURL: new Set(["media", "index"]),
  Initialization: new Set(["sourceURL"]),
  RepresentationIndex: new Set(["sourceURL"]),
};

function rewriteManifest(text, manifestUrl, baseFor) {
  const root = parseManifest(text);
  const inspection = inspectRoot(root);
  if (!inspection.ok) throw new Error(inspection.reason);

  const changes = [];
  if (!child(root, "BaseURL")) {
    if (root.tag.endsWith("/>")) throw new Error("Empty DASH manifest");
    const name = root.qualifiedName.replace(/MPD$/, "BaseURL");
    const base = escapeXml(proxyAddress(new URL(".", manifestUrl), baseFor));
    changes.push([root.openEnd, root.openEnd, `<${name}>${base}</${name}>`]);
  }

  function visit(node, parentBase) {
    let base = parentBase;
    for (const entry of node.children.filter(({ name }) => name === "BaseURL")) {
      const resolved = resolveUrl(baseValue(text, entry), parentBase);
      if (base === parentBase) base = resolved;
      changes.push([entry.openEnd, entry.close, escapeXml(proxyAddress(resolved, baseFor))]);
    }
    const attrs = Object.hasOwn(urlAttributes, node.name) ? urlAttributes[node.name] : null;
    if (attrs) {
      const tag = node.tag.replace(XML_ATTRIBUTE, (attribute, name, double, single) => {
        if (!attrs.has(name)) return attribute;
        const value = unescapeXml(double ?? single).trim();
        const path = value.split(/[?#]/, 1)[0];
        if (path && !/^(?:[a-z][\w+.-]*:|\/)|(?:^|\/)(?:\.|%2e){2}(?:\/|$)|\\/i.test(path)) return attribute;
        return `${name}="${escapeXml(proxyAddress(resolveUrl(value, base), baseFor))}"`;
      });
      if (tag !== node.tag) changes.push([node.start, node.openEnd, tag]);
    }
    for (const entry of node.children) visit(entry, base);
  }

  visit(root, new URL(manifestUrl));
  changes.sort(([a], [b]) => a - b);
  let cursor = 0;
  const output = [];
  for (const [start, end, replacement] of changes) {
    output.push(text.slice(cursor, start), replacement);
    cursor = end;
  }
  output.push(text.slice(cursor));
  return output.join("");
}

function firstSegmentUrls(text, manifestUrl) {
  const root = parseManifest(text);
  if (!root) return null;
  const period = child(root, "Period");
  const adaptations = period?.children.filter(({ name }) => name === "AdaptationSet");
  const video = ({ attrs }) => attrs.contentType === "video" || attrs.mimeType?.startsWith("video/");
  const adaptation = adaptations?.find((entry) => video(entry) ||
    entry.children.some((item) => item.name === "Representation" && video(item))) ?? adaptations?.[0];
  const representation = child(adaptation, "Representation");
  if (!representation) return null;

  try {
    let base = new URL(manifestUrl);
    const hierarchy = [root, period, adaptation, representation];
    for (const node of hierarchy) {
      const entry = child(node, "BaseURL");
      if (entry) base = resolveUrl(baseValue(text, entry), base);
    }
    const resolve = (value) => resolveUrl(value, base).href;
    const levels = hierarchy.slice(1);
    const templates = levels.map((node) => child(node, "SegmentTemplate")).filter(Boolean);
    const lists = levels.map((node) => child(node, "SegmentList")).filter(Boolean);
    const segmentBase = levels.map((node) => child(node, "SegmentBase")).filter(Boolean).at(-1);
    const addressing = levels.flatMap((node) => node.children.filter(({ name }) =>
      ["SegmentTemplate", "SegmentList", "SegmentBase"].includes(name))).at(-1);
    if (addressing?.name === "SegmentTemplate") {
      const attrs = Object.assign({}, ...templates.map((node) => node.attrs));
      if (!attrs.media) return null;
      const timeline = templates.map((node) => child(node, "SegmentTimeline")).filter(Boolean).at(-1);
      const values = {
        RepresentationID: representation.attrs.id,
        Bandwidth: representation.attrs.bandwidth,
        Number: attrs.startNumber ?? "1",
        Time: child(timeline, "S")?.attrs.t ?? "0",
      };
      const expand = (uri) => uri.replace(/\$\$|\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$/g,
        (token, key, width) => token === "$$" ? "$" : String(values[key] ?? "").padStart(Math.min(Number(width) || 0, 100), "0"));
      return { init: attrs.initialization ? resolve(expand(attrs.initialization)) : null, media: resolve(expand(attrs.media)) };
    }
    if (addressing?.name === "SegmentList") {
      const segment = lists.map((node) => child(node, "SegmentURL")).filter(Boolean).at(-1);
      const init = lists.map((node) => child(node, "Initialization")).filter(Boolean).at(-1);
      return segment ? { init: init ? resolve(init.attrs.sourceURL ?? "") : null, media: resolve(segment.attrs.media ?? "") } : null;
    }
    const init = child(segmentBase, "Initialization");
    return base.pathname.endsWith("/") || (!init && base.href === new URL(manifestUrl).href)
      ? null : { init: init ? resolve(init.attrs.sourceURL ?? "") : null, media: base.href };
  } catch {
    return null;
  }
}

module.exports = { inspectManifest, rewriteManifest, firstSegmentUrls };
