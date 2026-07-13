// URLs inside attribute values and table cells: find their exact spans so
// the editor can make them Ctrl+clickable, and fetch light metadata (status,
// content type, last modified) with a HEAD request for the hover — cached,
// timeout-bounded, and only ever on demand. Pure apart from the network;
// the request function is injectable so the tests never touch the wire.

const http = require("http");
const https = require("https");

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
    const mod = target.protocol === "http:" ? http : https;
    const doRequest = request || ((opts, cb) => mod.request(opts, cb));
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolveDone(result); } };
    let req;
    try {
      req = doRequest({ method: "HEAD", host: target.hostname, port: target.port || undefined, path: target.pathname + target.search, protocol: target.protocol }, (res) => {
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

module.exports = { findUrls, metadata, URL_RE };
