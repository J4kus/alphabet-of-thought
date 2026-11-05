// URLs inside attribute values and table cells: find their exact spans so
// the editor can make them Ctrl+clickable, and fetch light metadata (status,
// content type, last modified) with a HEAD request for the hover — cached,
// timeout-bounded, and only ever on demand. Pure apart from the network;
// the request function is injectable so the tests never touch the wire.

const { isRowText, splitCell } = require("./table");
const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");

// A URL runs to whitespace, a pipe (it cannot straddle a table cell), or a
// quote; trailing sentence punctuation is peeled off.
const URL_RE = /https?:\/\/[^\s|)"'`]+/g;
const TRAIL = /[.,;:!?]+$/;

// Every URL in the lines: { line (1-based), startCol, endCol, url }.
function findUrls(lines) {
  const out = [];
  lines.forEach((raw, i) => {
    for (const m of raw.matchAll(URL_RE)) {
      const url = m[0].replace(TRAIL, "");
      if (!url) continue;
      out.push({ line: i + 1, startCol: m.index, endCol: m.index + url.length, url });
    }
  });
  return out;
}

// A path-shaped value: an absolute Windows (`C:\...`) or POSIX (`/...`) path,
// a `~`-home path, a relative path with a slash, or a bare `name.ext`. Taken
// from after the colon of a `attribute: value` line, or a whole table cell —
// the value must look like a path, not merely contain a dotted word.
const WIN_ABS = /^[A-Za-z]:[\\/]/;
const looksLikePath = (v) => {
  const s = v.trim();
  if (!s || /^https?:\/\//.test(s)) return false;
  return WIN_ABS.test(s) || s.startsWith("/") || s.startsWith("~/") || s.startsWith("./") || s.startsWith("../")
    || s.includes("/") || s.includes("\\") || /^[^\s]+\.[A-Za-z0-9]{1,8}$/.test(s);
};

// Every file-path value in the lines that `resolve(pathText)` maps to an
// existing file. `resolve` returns an absolute fsPath or null (the extension
// tries: absolute, then relative to the .aot's folder, then the workspace
// root, and fs.existsSync). Returns { line, startCol, endCol, path (raw),
// fsPath (resolved) }. Value region: after the first ': ' on a line, a `- `
// Example's name (an Example may *be* a file, exactly as a table row may),
// or a whole table cell. Here we take the after-colon value, the after-dash
// name, and each pipe cell's trimmed content.
function findFiles(lines, resolve) {
  const out = [];
  lines.forEach((raw, i) => {
    const spans = [];
    const t = raw.trimStart();
    if (t.startsWith("- ")) {
      // an Example line: everything after the marker is the candidate, so
      // `- aot.files/report.csv` links the way a value or a cell does
      const dash = raw.indexOf("- ");
      const after = raw.slice(dash + 2);
      const lead = after.length - after.trimStart().length;
      const text = after.trim();
      if (text) spans.push({ startCol: dash + 2 + lead, text });
    } else if (isRowText(raw)) {
      // table row: each cell's trimmed content is a candidate, the first
      // opening at the line itself
      let start = 0;
      for (let k = 0; k <= raw.length; k++) {
        if (k === raw.length || raw[k] === "|") {
          const seg = raw.slice(start, k);
          const lead = seg.length - seg.trimStart().length;
          const text = seg.trim();
          if (text) spans.push({ startCol: start + lead, text });
          start = k + 1;
        }
      }
    } else {
      const colon = raw.indexOf(":");
      if (colon !== -1) {
        const after = raw.slice(colon + 1);
        const lead = after.length - after.trimStart().length;
        const text = after.trim();
        if (text) spans.push({ startCol: colon + 1 + lead, text });
      }
    }
    for (const s of spans) {
      // a value stands before its derivation — `aot.files/chart.png =plot(@Sales)`
      // — so only the value part can name a file
      const derived = splitCell(s.text);
      if (derived.eq > 0) s.text = derived.value;
      if (!looksLikePath(s.text)) continue;
      const fsPath = resolve(s.text);
      if (!fsPath) continue;
      out.push({ line: i + 1, startCol: s.startCol, endCol: s.startCol + s.text.length, path: s.text, fsPath });
    }
  });
  return out;
}

// Whether a link (URL or file path) points at an image, by extension.
const isImage = (s) => /\.(png|jpe?g|gif|svg|webp|bmp|ico)(\?|#|$)/i.test(String(s));

// --- what a hover may contact ---------------------------------------------------
// A URL in a file is whatever the file's author wrote, so a hover must not be a
// way to knock on this machine or its network. An address counts as internal
// when it is on this machine or a private range, and a name when only a local
// network could answer it. A public name that resolves to an internal address
// is caught at the lookup, and a redirect to one is checked like any other URL.

function isPrivateIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127); // carrier-grade NAT
  }
  if (kind === 6) {
    const low = ip.toLowerCase();
    if (low === "::" || low === "::1") return true;
    // an IPv4 address wearing IPv6: `::ffff:10.0.0.1`, which the URL parser
    // writes in hex, `::ffff:a00:1`
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(low);
    if (mapped) return isPrivateIp(mapped[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(low);
    if (hex) {
      const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^f[cd]/.test(low) || /^fe[89ab]/.test(low); // unique-local, link-local
  }
  return false;
}

const LOCAL_SUFFIX = /\.(localhost|local|internal|intranet|lan|home|corp)$/;
function isInternalHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (net.isIP(h)) return isPrivateIp(h);
  return h === "localhost" || LOCAL_SUFFIX.test(h) || !h.includes(".");
}

// (the URL parser has already read `2130706433` and `0x7f.1` as 127.0.0.1)
function isInternalUrl(url) {
  try { return isInternalHost(new URL(url).hostname); } catch { return true; }
}

// The lookup a request makes, refusing a name that resolves to an internal
// address. Node may ask for every address (`all`), and answers an array then.
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const found = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (found.some(isPrivateIp)) return callback(new Error(`${hostname} is an internal address, so it was not contacted`));
    callback(null, address, family);
  });
}

const TIMEOUT_MS = 3000;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_CAP = 200;
const cache = new Map(); // url -> { at, promise }

// One HEAD request, following a few redirects. Resolves to
// { status, contentType, lastModified } or { error }; never rejects.
function head(url, request, redirects) {
  return new Promise((resolveDone) => {
    let target;
    try { target = new URL(url); } catch { return resolveDone({ error: "not a valid URL" }); }
    if (isInternalHost(target.hostname)) return resolveDone({ error: "an internal address, so it was not contacted" });
    const mod = target.protocol === "http:" ? http : https;
    const doRequest = request || ((opts, cb) => mod.request(opts, cb));
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolveDone(result); } };
    let req;
    try {
      req = doRequest({ method: "HEAD", host: target.hostname, port: target.port || undefined, path: target.pathname + target.search, protocol: target.protocol, lookup: publicLookup }, (res) => {
        const status = res.statusCode;
        if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
          const next = new URL(res.headers.location, target).toString();
          head(next, request, redirects - 1).then(done);
          return;
        }
        done({
          status,
          contentType: res.headers["content-type"] || null,
          lastModified: res.headers["last-modified"] || null,
        });
      });
    } catch (e) {
      return done({ error: e.message });
    }
    req.on("error", (e) => done({ error: e.message }));
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); done({ error: `no answer within ${TIMEOUT_MS / 1000}s` }); });
    req.end();
  });
}

// Metadata for one URL, memoised for a few minutes so a hover never hammers
// a host. `request` (tests) replaces the node http(s) request function.
function metadata(url, request) {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.promise;
  if (cache.size >= CACHE_CAP) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  const promise = head(url, request, MAX_REDIRECTS);
  cache.set(url, { at: now, promise });
  return promise;
}

module.exports = { findUrls, findFiles, metadata, isImage, looksLikePath, URL_RE, isInternalUrl, isInternalHost, isPrivateIp };
