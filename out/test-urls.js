// Unit tests for URL detection and metadata (src/urls.js): the spans inside
// values and table cells, and the HEAD metadata with an injected request so
// nothing touches the network.
//
// Plain Node script, no framework — run with: node out/test-urls.js
const { findUrls, findFiles, metadata, isImage, looksLikePath } = require("../src/urls");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// findUrls: spans, table cells, trailing punctuation
// ---------------------------------------------------------------------------
{
  const found = findUrls([
    "Doc",
    "    spec: https://example.com/spec?v=2, reviewed",
    "    name|link",
    "    ----+----------------------",
    "    A   |http://example.org/a",
    "    note: no urls here",
  ]);
  check("findUrls: a URL in a value, trailing punctuation peeled",
    found.some((u) => u.line === 2 && u.url === "https://example.com/spec?v=2"));
  const spec = found.find((u) => u.line === 2);
  check("findUrls: the span covers exactly the URL",
    spec.startCol === 10 && spec.endCol === 10 + "https://example.com/spec?v=2".length);
  check("findUrls: a URL inside a table cell stops at the pipe",
    found.some((u) => u.line === 5 && u.url === "http://example.org/a"));
  check("findUrls: lines without URLs yield nothing",
    !found.some((u) => u.line === 6) && found.length === 2);
}

// ---------------------------------------------------------------------------
// findFiles: path-shaped values that a resolver maps to an existing file
// ---------------------------------------------------------------------------
{
  const win = "C:" + String.fromCharCode(92) + "reports" + String.fromCharCode(92) + "q2.pdf";
  const lines = [
    "Doc",
    "    spec: https://example.com/x.png",  // a URL, not a file
    "    diagram: ./assets/flow.svg",
    "    report: " + win,
    "    note: just some prose here",        // not path-shaped
    "    name|file",
    "    ----+------------",
    "    A   |./data/a.csv",
    "    - aot.files/people.csv",           // an Example that *is* a file
    "    - picture.png",                    // an Example that is an image
    "    - Ada Lovelace",                   // an Example that is just a name
  ];
  const known = new Set(["./assets/flow.svg", win, "./data/a.csv", "aot.files/people.csv", "picture.png"]);
  const files = findFiles(lines, (t) => (known.has(t) ? "/abs/" + t : null));
  check("findFiles: a relative path value resolves and is spanned",
    files.some((f) => f.line === 3 && f.path === "./assets/flow.svg" && f.fsPath === "/abs/./assets/flow.svg"));
  check("findFiles: an absolute Windows path resolves", files.some((f) => f.line === 4 && f.path === win));
  check("findFiles: a path inside a table cell resolves", files.some((f) => f.line === 8 && f.path === "./data/a.csv"));
  check("findFiles: a '- ' Example that is a file resolves, exactly spanned",
    (() => {
      const f = files.find((x) => x.line === 9);
      return f && f.path === "aot.files/people.csv"
        && f.startCol === lines[8].indexOf("aot.files")
        && f.endCol === f.startCol + "aot.files/people.csv".length;
    })());
  check("findFiles: a '- ' Example that is an image resolves (the hover shows it)",
    (() => {
      const f = files.find((x) => x.line === 10);
      return f && f.path === "picture.png" && isImage(f.fsPath);
    })());
  check("findFiles: a URL is not a file, prose and plain Examples are not paths",
    !files.some((f) => f.line === 2) && !files.some((f) => f.line === 5)
    && !files.some((f) => f.line === 11) && files.length === 5);
}

// ---------------------------------------------------------------------------
// isImage / looksLikePath
// ---------------------------------------------------------------------------
{
  check("isImage: image extensions, not others",
    isImage("a.png") && isImage("b.JPG") && isImage("c.svg") && isImage("http://x/y.gif?v=1") && !isImage("d.pdf") && !isImage("e.txt"));
  check("looksLikePath: paths yes, prose no",
    looksLikePath("./a/b.csv") && looksLikePath("/etc/hosts") && looksLikePath("report.pdf")
    && !looksLikePath("just some words") && !looksLikePath("https://x.com/y"));
}

// ---------------------------------------------------------------------------
// metadata: an injected request answers; errors, redirects, and the cache
// ---------------------------------------------------------------------------
const respond = (statusCode, headers) => (opts, cb) => {
  const req = {
    handlers: {},
    on(ev, fn) { this.handlers[ev] = fn; return this; },
    setTimeout() { return this; },
    end() { setImmediate(() => cb({ statusCode, headers })); },
  };
  return req;
};

(async () => {
  const ok = await metadata("https://ok.test/x", respond(200, {
    "content-type": "text/html", "last-modified": "Tue, 01 Jul 2025 10:00:00 GMT",
  }));
  check("metadata: status, content type and last modified come back",
    ok.status === 200 && ok.contentType === "text/html" && /Jul 2025/.test(ok.lastModified));

  // a redirect is followed to its target
  let hop = 0;
  const redirecting = (opts, cb) => {
    hop++;
    return respond(hop === 1 ? 301 : 200, hop === 1
      ? { location: "https://moved.test/final" }
      : { "content-type": "application/json" })(opts, cb);
  };
  const moved = await metadata("https://moved.test/start", redirecting);
  check("metadata: a redirect is followed", moved.status === 200 && moved.contentType === "application/json" && hop === 2);

  // a connection error resolves to { error }, never rejects
  const failing = (opts, cb) => ({
    handlers: {},
    on(ev, fn) { this.handlers[ev] = fn; return this; },
    setTimeout() { return this; },
    end() { setImmediate(() => this.handlers.error(new Error("ECONNREFUSED"))); },
  });
  const down = await metadata("https://down.test/x", failing);
  check("metadata: a connection error reports, never throws", /ECONNREFUSED/.test(down.error));

  // a timeout destroys the request and reports
  const silent = (opts, cb) => ({
    handlers: {},
    destroyed: false,
    on(ev, fn) { this.handlers[ev] = fn; return this; },
    setTimeout(ms, fn) { this.timeoutFn = fn; return this; },
    destroy() { this.destroyed = true; },
    end() { setImmediate(() => this.timeoutFn()); },
  });
  const quiet = await metadata("https://quiet.test/x", silent);
  check("metadata: a silent host times out with a readable error", /no answer within/.test(quiet.error));

  // the cache answers a repeat without a second request
  let calls = 0;
  const counting = (opts, cb) => { calls++; return respond(200, {})(opts, cb); };
  await metadata("https://cached.test/x", counting);
  await metadata("https://cached.test/x", counting);
  check("metadata: a repeat within the TTL is served from the cache", calls === 1);

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
