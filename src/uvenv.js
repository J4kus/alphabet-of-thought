// The environment Alpha's Python runs in, set up with uv.
//
// uv (Astral's Python package and project manager) *provisions*; it never
// runs a derivation. Installing a package can run code — a source build runs
// its setup, and an installed package runs whenever Python starts — so an
// install happens only when the writer asks for it, after being shown what
// it will put there, and never as a side effect of a calculation. The run then
// starts the environment's own interpreter directly, exactly as it starts any
// other Python.
//
//   the project    `aot.files/pyproject.toml` beside `uv.lock`, both
//                  committed, the environment in `aot.files/.venv` (uv keeps
//                  it out of git itself). A repository that is already a uv
//                  project — a `uv.lock` beside a `pyproject.toml` at its
//                  root — is used as it is.
//   setting up     `uv lock` when the lock is missing or behind the project,
//                  then `uv sync --locked --no-build --no-install-project
//                  --compile-bytecode`:
//                  exactly what the lock says, only packages that arrive
//                  already built, and never the project itself (a package
//                  would have to be built to install).
//   the review     what the lock would install, and anything it takes from
//                  somewhere other than PyPI, shown before the install.
//
// Pure apart from `path` and `crypto`. The spawn function is injected, as in
// python.js, so every line is tested without uv on the machine.

const path = require("path");
const crypto = require("crypto");

// The libraries a new project is offered, the usual ones picked.
const LIBRARIES = [
  { name: "pandas", why: "DataFrames: a Concept as a table, @Sales.amount.sum()", picked: true },
  { name: "numpy", why: "arrays and numerics", picked: true },
  { name: "matplotlib", why: "charts, written into aot.files as pictures", picked: true },
  { name: "seaborn", why: "statistical charts (sns)" },
  { name: "scipy", why: "statistics (stats)" },
  { name: "pillow", why: "images (Image)" },
  { name: "requests", why: "calling a web API" },
  { name: "python-dateutil", why: "relativedelta" },
  { name: "openpyxl", why: "pd.read_excel" },
  { name: "pyarrow", why: "parquet, faster CSV" },
];

const PYPI = new Set(["https://pypi.org/simple", "https://pypi.org/simple/"]);

// Where the project is: the repository's root when it is a uv project
// already, else aot.files when it holds one, else null (none set up yet).
function projectDir(root, aotFiles, exists) {
  if (root && exists(path.join(root, "pyproject.toml")) && exists(path.join(root, "uv.lock"))) return root;
  if (aotFiles && exists(path.join(aotFiles, "pyproject.toml"))) return aotFiles;
  return null;
}

// The environment's folder, one per operating system: `.venv` on Windows,
// `.venv-linux` / `.venv-darwin` elsewhere. One repository is often opened
// from two — a checkout on C: used from Windows and from WSL — and an
// environment holds one system's binaries: a Windows `.venv` cannot run in
// Linux, and a setup on one side must not replace the other's as foreign.
// uv is pointed at it with UV_PROJECT_ENVIRONMENT (runUv's `environment`).
function venvDir(project, platform) {
  return path.join(project, platform === "win32" ? ".venv" : `.venv-${platform}`);
}

// The environment's own interpreter.
function venvPython(project, platform) {
  return platform === "win32"
    ? path.join(venvDir(project, platform), "Scripts", "python.exe")
    : path.join(venvDir(project, platform), "bin", "python");
}

// A new project: the libraries chosen, and Python 3.10 or later — the
// runtime's floor, not whatever interpreter happens to be newest.
function pyprojectText(libraries) {
  const deps = libraries.map((l) => `    "${l}",`).join("\n");
  return [
    "# The Python the .aot files of this repository run their derivations in.",
    "# Set up with 'AOT: Set Up Python Environment', which installs exactly",
    "# what uv.lock says into .venv here. Commit this file and uv.lock.",
    "[project]",
    'name = "aot-python"',
    'version = "0.1.0"',
    'requires-python = ">=3.10"',
    libraries.length ? `dependencies = [\n${deps}\n]` : "dependencies = []",
    "",
  ].join("\n");
}

// The packages a uv.lock names: [{ name, version, source: { kind, url } }].
// Read line by line — the lock is TOML uv writes in one shape — never run.
function parseLock(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (/^\[\[package\]\]\s*$/.test(line)) {
      cur = { name: "", version: "", source: null };
      out.push(cur);
      continue;
    }
    if (/^\[/.test(line)) { cur = line.startsWith("[[package]]") ? cur : null; continue; }
    if (!cur) continue;
    let m;
    if ((m = /^name\s*=\s*"([^"]*)"/.exec(line))) cur.name = m[1];
    else if ((m = /^version\s*=\s*"([^"]*)"/.exec(line))) cur.version = m[1];
    else if ((m = /^source\s*=\s*\{\s*(\w+)\s*=\s*"([^"]*)"/.exec(line))) cur.source = { kind: m[1], url: m[2] };
  }
  return out;
}

// What an install would do, as the question shows it: every package the
// lock installs, and those it takes from anywhere but PyPI — a git
// repository, a URL, a path, another index — each of which is code from a
// place nobody has reviewed for you.
function lockReview(packages) {
  const installs = packages.filter((p) => !(p.source && p.source.kind === "virtual"));
  const outside = installs.filter((p) => !p.source || p.source.kind !== "registry" || !PYPI.has(p.source.url))
    .map((p) => ({ name: p.name, version: p.version, from: p.source ? `${p.source.kind} ${p.source.url}` : "an unknown source" }));
  return { count: installs.length, packages: installs.map((p) => `${p.name} ${p.version}`.trim()), outside };
}

// The project as it would install: what the question was asked about, so a
// change to either file asks again.
function projectDigest(pyproject, lock) {
  return crypto.createHash("sha256").update(String(pyproject || "")).update("\0").update(String(lock || "")).digest("hex");
}

// uv's environment: it never downloads a Python on its own, and draws no
// progress bars into a log. `environment` (optional) is the folder the
// project's environment lives in (venvDir).
const uvEnv = (base, environment) => Object.assign({}, base || process.env, {
  UV_PYTHON_DOWNLOADS: "never", UV_NO_PROGRESS: "1", NO_COLOR: "1",
}, environment ? { UV_PROJECT_ENVIRONMENT: environment } : {});

// One uv command: { code, stdout, stderr, missing } — missing when there is
// no uv to start.
function runUv(spawnFn, uv, args, options) {
  const o = options || {};
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawnFn(uv || "uv", args, { cwd: o.cwd, env: uvEnv(o.env, o.environment), windowsHide: true });
    } catch (e) {
      return resolve({ code: null, stdout: "", stderr: String(e && e.message), missing: e && e.code === "ENOENT" });
    }
    let stdout = "", stderr = "", done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* already gone */ }
      finish({ code: null, stdout, stderr: stderr + `\nuv did not finish within ${Math.round((o.timeoutMs || 600000) / 1000)} s`, missing: false });
    }, o.timeoutMs || 600000);
    if (timer.unref) timer.unref();
    if (proc.stdout) proc.stdout.on("data", (c) => { stdout += c; if (o.onOutput) o.onOutput(String(c)); });
    if (proc.stderr) proc.stderr.on("data", (c) => { stderr += c; if (o.onOutput) o.onOutput(String(c)); });
    proc.on("error", (e) => finish({ code: null, stdout, stderr: String(e && e.message), missing: e && e.code === "ENOENT" }));
    proc.on("close", (code) => finish({ code, stdout, stderr, missing: false }));
  });
}

// The last line uv wrote that says something, for a message.
const lastWords = (r) => String((r && (r.stderr || r.stdout)) || "").trim().split(/\r?\n/).filter((l) => l.trim()).pop() || "";

// What a missing library's message tells the writer to do.
function installHint(project, relProject) {
  return project
    ? `add it to ${relProject ? relProject + "/" : ""}pyproject.toml, then run AOT: Set Up Python Environment`
    : "";
}

module.exports = {
  LIBRARIES, projectDir, venvDir, venvPython, pyprojectText, parseLock, lockReview, projectDigest, uvEnv, runUv, lastWords, installHint,
};
