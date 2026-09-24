// The environment the derivations' Python runs in: where a uv project is,
// what a new one holds, what a lock would install and whether anything in
// it comes from outside PyPI, uv run as a child process, and a program found
// on PATH and never in the folder a run starts in. Then — when this machine
// has uv — the real thing: a project locked, installed from built wheels
// alone, and a lock that no longer matches its project refused.
//
// Plain Node script, no framework — run with: node out/test-uv.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { spawn, spawnSync } = require("child_process");
const uvenv = require("../src/uvenv");
const python = require("../src/python");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

// --- 1. where the project is ---------------------------------------------------
{
  const has = (...files) => (f) => files.includes(f);
  const root = path.resolve("/repo"), af = path.join(root, "aot.files");
  check("project: a repository that is a uv project already is used as it is",
    uvenv.projectDir(root, af, has(path.join(root, "pyproject.toml"), path.join(root, "uv.lock"), path.join(af, "pyproject.toml"))) === root);
  check("project: a pyproject.toml at the root without a uv.lock is the repository's own, not ours",
    uvenv.projectDir(root, af, has(path.join(root, "pyproject.toml"), path.join(af, "pyproject.toml"))) === af);
  check("project: none set up is none", uvenv.projectDir(root, af, has()) === null);
  check("project: the environment's interpreter, per platform",
    uvenv.venvPython(af, "win32") === path.join(af, ".venv", "Scripts", "python.exe")
    && uvenv.venvPython(af, "linux") === path.join(af, ".venv", "bin", "python"));
}

// --- 2. a new project -------------------------------------------------------------
{
  const text = uvenv.pyprojectText(["pandas", "matplotlib"]);
  check("new project: the libraries picked, and Python 3.10 or later — the runtime's floor",
    /requires-python = ">=3\.10"/.test(text) && /dependencies = \[\n {4}"pandas",\n {4}"matplotlib",\n\]/.test(text) && /name = "aot-python"/.test(text));
  check("new project: none picked is an empty list", /dependencies = \[\]/.test(uvenv.pyprojectText([])));
  check("new project: the usual libraries come picked", uvenv.LIBRARIES.filter((l) => l.picked).map((l) => l.name).join() === "pandas,numpy,matplotlib");
}

// --- 3. what a lock would install ------------------------------------------------------
{
  const lock = [
    "version = 1",
    'requires-python = ">=3.10"',
    "",
    "[[package]]",
    'name = "aot-python"',
    'version = "0.1.0"',
    'source = { virtual = "." }',
    "dependencies = [",
    '    { name = "six" },',
    "]",
    "",
    "[package.metadata]",
    'requires-dist = [{ name = "six", specifier = ">=1.17.0" }]',
    "",
    "[[package]]",
    'name = "six"',
    'version = "1.17.0"',
    'source = { registry = "https://pypi.org/simple" }',
    'sdist = { url = "https://files.pythonhosted.org/six.tar.gz", hash = "sha256:ff" }',
    "",
    "[[package]]",
    'name = "helper"',
    'version = "0.2.0"',
    'source = { git = "https://example.com/helper.git?rev=main#abc" }',
    "",
    "[[package]]",
    'name = "mirror-pkg"',
    'version = "1.0"',
    'source = { registry = "https://mirror.example/simple" }',
  ].join("\n");
  const pkgs = uvenv.parseLock(lock);
  check("lock: every package, its version and its source",
    pkgs.map((p) => `${p.name}@${p.version}:${p.source && p.source.kind}`).join(" ") === "aot-python@0.1.0:virtual six@1.17.0:registry helper@0.2.0:git mirror-pkg@1.0:registry");
  const review = uvenv.lockReview(pkgs);
  check("lock: the project itself installs nothing; three packages do", review.count === 3 && review.packages.join() === "six 1.17.0,helper 0.2.0,mirror-pkg 1.0");
  check("lock: a git source and another index are from outside PyPI, and said to be",
    review.outside.map((o) => `${o.name}: ${o.from}`).join(" | ") === "helper: git https://example.com/helper.git?rev=main#abc | mirror-pkg: registry https://mirror.example/simple");
  check("lock: a subtable's names are not packages", !pkgs.some((p) => p.name === "" || p.name === "six" && p.version !== "1.17.0"));
  const a = uvenv.projectDigest("p", "l");
  check("lock: the digest moves with either file", a !== uvenv.projectDigest("p2", "l") && a !== uvenv.projectDigest("p", "l2") && /^[0-9a-f]{64}$/.test(a));
  check("uv: it never downloads a Python on its own", uvenv.uvEnv({}).UV_PYTHON_DOWNLOADS === "never");
  check("install hint: the project's pyproject.toml, then the setup command",
    uvenv.installHint("/r/aot.files", "aot.files") === "add it to aot.files/pyproject.toml, then run AOT: Set Up Python Environment");
}

// --- 4. a program found on PATH, never beside the run --------------------------------------
{
  const win = { platform: "win32", env: { PATH: "C:\\py;relative\\bin;;C:\\tools" } };
  const on = (...files) => (f) => files.includes(f);
  check("path: a bare name is found on PATH's absolute entries",
    python.resolveExecutable("python", { ...win, exists: on("C:\\tools\\python.exe") }) === "C:\\tools\\python.exe");
  check("path: a relative PATH entry is never searched — it would be relative to wherever the run starts",
    python.resolveExecutable("python", { ...win, exists: on("relative\\bin\\python.exe") }) === null);
  check("path: nothing on PATH is nothing — never the working directory's python.exe",
    python.resolveExecutable("python", { ...win, exists: on("python.exe", ".\\python.exe") }) === null);
  check("path: only what Windows launches without a shell (.exe, .com)",
    python.resolveExecutable("uv", { ...win, exists: on("C:\\py\\uv.bat", "C:\\py\\uv.cmd") }) === null
    && python.resolveExecutable("uv", { ...win, exists: on("C:\\py\\uv.exe") }) === "C:\\py\\uv.exe");
  check("path: an absolute path is taken as written, a relative one against the repository",
    python.resolveExecutable("C:\\envs\\py.exe", win) === "C:\\envs\\py.exe"
    && python.resolveExecutable(".venv\\Scripts\\python.exe", { ...win, base: "C:\\repo" }) === "C:\\repo\\.venv\\Scripts\\python.exe");
  check("path: POSIX reads its PATH the same way",
    python.resolveExecutable("python3", { platform: "linux", env: { PATH: "/usr/bin:.:bin" }, exists: on("/usr/bin/python3", "./python3", "bin/python3") }) === "/usr/bin/python3");
}

// --- 5. uv as a child process, against a fake ----------------------------------------------
async function childProcesses() {
  const fake = (code, out, err, fail) => (cmd, args, opts) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = () => {};
    p.seen = { cmd, args, opts };
    fake.last = p.seen;
    setImmediate(() => {
      if (fail) return p.emit("error", Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" }));
      if (out) p.stdout.emit("data", out);
      if (err) p.stderr.emit("data", err);
      p.emit("close", code);
    });
    return p;
  };
  const ok = await uvenv.runUv(fake(0, "uv 0.11.17\n"), "C:\\u\\uv.exe", ["--version"], { cwd: "C:\\r" });
  check("run: the code and what uv wrote come back", ok.code === 0 && ok.stdout === "uv 0.11.17\n" && !ok.missing);
  check("run: uv is started where asked, and never downloads a Python",
    fake.last.cmd === "C:\\u\\uv.exe" && fake.last.opts.cwd === "C:\\r" && fake.last.opts.env.UV_PYTHON_DOWNLOADS === "never");
  const bad = await uvenv.runUv(fake(2, "", "error: no\nerror: the lock is out of date\n"), "uv", ["sync"], {});
  check("run: a failure keeps its code and its last words", bad.code === 2 && uvenv.lastWords(bad) === "error: the lock is out of date");
  const missing = await uvenv.runUv(fake(0, "", "", true), "uv", ["--version"], {});
  check("run: no uv to start says so", missing.missing === true && missing.code === null);
}

// --- 6. the real uv, when this machine has one -------------------------------------------------
async function realUv() {
  const uv = python.resolveExecutable("uv");
  if (!uv || spawnSync(uv, ["--version"], { encoding: "utf8" }).status !== 0) {
    console.log("SKIP real uv (no uv on PATH)");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aot-uv-"));
  try {
    fs.writeFileSync(path.join(dir, "pyproject.toml"), uvenv.pyprojectText(["six"]));
    const run = (args) => uvenv.runUv(spawn, uv, args, { cwd: dir, timeoutMs: 300000 });
    const before = await run(["lock", "--project", dir, "--check"]);
    check("real uv: a project with no lock fails the check", before.code !== 0);
    const locked = await run(["lock", "--project", dir, "--no-build"]);
    if (locked.code !== 0) {
      console.log(`SKIP real uv install (uv could not resolve — offline? ${uvenv.lastWords(locked)})`);
      return;
    }
    check("real uv: locked, the check passes", (await run(["lock", "--project", dir, "--check"])).code === 0);
    const review = uvenv.lockReview(uvenv.parseLock(fs.readFileSync(path.join(dir, "uv.lock"), "utf8")));
    check("real uv: the lock names six, from PyPI", review.count === 1 && /^six /.test(review.packages[0]) && review.outside.length === 0);
    const synced = await run(["sync", "--project", dir, "--locked", "--no-build", "--no-install-project", "--compile-bytecode"]);
    check("real uv: installed exactly as locked, from built wheels", synced.code === 0);
    const exe = uvenv.venvPython(dir, process.platform);
    // -B, as the runtime runs: it reads the bytecode uv compiled, and writes none
    const imported = spawnSync(exe, ["-I", "-B", "-c", "import six, sys; print(six.__version__, six.__cached__)"], { encoding: "utf8" });
    check("real uv: the environment's own interpreter imports what was installed, isolated", imported.status === 0 && /^\d+\.\d+/.test(imported.stdout.trim()));
    const site = spawnSync(exe, ["-I", "-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"], { encoding: "utf8" }).stdout.trim();
    const cache = path.join(site, "__pycache__");
    check("real uv: installed compiled to bytecode, so a session never compiles a library from source",
      fs.existsSync(cache) && fs.readdirSync(cache).some((f) => /^six\..*\.pyc$/.test(f)));
    check("real uv: uv keeps the environment out of git itself", fs.readFileSync(path.join(dir, ".venv", ".gitignore"), "utf8").trim() === "*");
    // the project moves on without its lock: nothing installs until it is locked again
    fs.writeFileSync(path.join(dir, "pyproject.toml"), uvenv.pyprojectText(["six"]).replace('">=3.10"', '">=3.11"'));
    check("real uv: a project changed since its lock fails the check", (await run(["lock", "--project", dir, "--check"])).code !== 0);
    check("real uv: and --locked refuses to install from the stale lock", (await run(["sync", "--project", dir, "--locked", "--no-build", "--no-install-project"])).code !== 0);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a file a moment */ }
  }
}

(async () => {
  await childProcesses();
  await realUv();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
