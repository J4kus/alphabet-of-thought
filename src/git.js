// The two git calls the command line makes: a file as it stood at a revision
// (verify.js --diff-rev) and git's own three-way line merge (verify.js
// --merge, before the semantic one). Kept apart from verify.js, which starts
// no process of its own — and nothing here reaches the Python half: git is
// asked about text, and runs nothing a repository wrote.

const { spawnSync } = require("child_process");

// `git` (optional) is the program to run, for the tests; git on PATH else.

// The file at `rel` (a repository-relative path, forward slashes) as it stood
// at `rev`: { text } or { error }.
function show(root, rev, rel, git) {
  const r = spawnSync(git || "git", ["show", `${rev}:${rel}`], { cwd: root, encoding: "utf8", windowsHide: true });
  if (r.error) return { error: r.error.message };
  if (r.status !== 0) return { error: String(r.stderr || "").trim() || `git exited ${r.status}` };
  return { text: r.stdout };
}

// git merge-file -p over ours, base and theirs: { text, clean } — clean when
// git merged without a conflict — or { error } when git could not run.
function mergeFile(oursPath, basePath, theirsPath, git) {
  const r = spawnSync(git || "git", ["merge-file", "-p", "-L", "ours", "-L", "base", "-L", "theirs", oursPath, basePath, theirsPath],
    { encoding: "utf8", windowsHide: true });
  if (r.error) return { error: r.error.message };
  if (r.status < 0 || r.status > 127) return { error: String(r.stderr || "").trim() || `git exited ${r.status}` };
  return { text: r.stdout, clean: r.status === 0 };
}

module.exports = { show, mergeFile };
