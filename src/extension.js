// VS Code entry point for .aot documents: publishes the arithmetic
// linter's errors (including the FCA audit and content-identical Gödel clash)
// and warnings (including the inferred functional dependencies) as diagnostics
// (squiggles + Problems panel), spelling as hints, paints the inline
// crosslinks as links, serves go-to-definition for them, and shows a
// Concept's dependency chains on hover.

const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const childProcess = require("child_process");
const { lint, KIND } = require("./linter");
const {
  resolve, owningConcept, externalIndex, unlistedValues,
  index: crosslinkIndex, conceptType, listedExamples,
} = require("./crosslinks");
const table = require("./table");
const { suggest } = require("./fca");
const godel = require("./godel");
const { clashes } = godel;
const armstrong = require("./armstrong");
const spelling = require("./spelling");
const synonyms = require("./synonyms");
const park = require("./park");
const derive = require("./derive");
const repo = require("./repo");
const urls = require("./urls");
const hold = require("./hold");
const lineform = require("./lineform");
const python = require("./python");
const uvenv = require("./uvenv");
const { upgradeEdits } = require("./upgrade");
const csvsync = require("./csvsync");

const DEBOUNCE_MS = 300;
// past this many Examples the lattice is no longer keystroke-cheap
const MAX_FCA_OBJECTS = 200;

// uri string -> { links, root, nodes } from the last analysis of that document
const analysisByDoc = new Map();
// uri string -> { baseline, edited, lastLine, family, held } while an edit
// burst is live (see hold.js): a new finding off the lines being edited waits
// until the cursor leaves what is being edited; everything else publishes at
// once
const holdState = new Map();
// set in activate(): ends a document's burst, and publishes what waited
let releaseHold = () => {};

// The status item that says what waits — nothing is held silently. Set up
// in activate(); shown while the active document holds findings back.
let holdStatus = null;
function updateHoldStatus() {
  if (!holdStatus) return;
  const editor = vscode.window.activeTextEditor;
  const state = editor && editor.document && holdState.get(editor.document.uri.toString());
  const held = state && state.held ? state.held : [];
  if (!held.length) { holdStatus.hide(); return; }
  holdStatus.text = `$(clock) ${held.length} waiting — leave '${state.family ? state.family.name : "this"}' to see ${held.length === 1 ? "it" : "them"}`;
  holdStatus.tooltip = `Findings waiting while you write here — they show when the cursor leaves '${state.family ? state.family.name : "this"}', on save, or now on a click:\n`
    + held.slice(0, 10).map((d) => `• line ${d.range.start.line + 1}: ${d.message}`).join("\n")
    + (held.length > 10 ? `\n• and ${held.length - 10} more` : "");
  holdStatus.show();
}

// The user's accepted words (aot.acceptedWords, lowercased): the spelling
// hints skip them and a Concept ending in one is not read as plural. The
// Quick Fix on either finding appends to the list.
function acceptedWords() {
  const config = vscode.workspace.getConfiguration("aot");
  return new Set((config.get("acceptedWords", []) || []).map((w) => String(w).toLowerCase()));
}

// The pairs of Concept names the writer has declared genuinely different
// (aot.distinctConcepts), as synonyms.pairKey strings. The Quick Fix on a
// synonym warning appends to the list, and the pair is never asked about
// again — in any file, because the question is repo-wide.
function distinctConcepts() {
  const config = vscode.workspace.getConfiguration("aot");
  const out = new Set();
  for (const entry of config.get("distinctConcepts", []) || []) {
    const [a, b] = String(entry).split("|");
    if (a && b) out.add(synonyms.pairKey(a.trim(), b.trim()));
  }
  return out;
}

// Two names for one idea, over this file and every peer that is indexed.
//
// Advisory and repo-wide: 'Client' here and 'Customer' in the file next door
// is exactly the collision worth catching, and it is invisible to a file
// reading only itself. Only *this* file's side is reported (the other file
// reports its own when it is open), and the peer rides along as a related
// location so Ctrl+click reaches it. Off with aot.synonymWarnings.
function synonymWarnings(doc, root, nodes) {
  const config = vscode.workspace.getConfiguration("aot");
  if (!config.get("synonymWarnings", true)) return [];
  const here = doc.fileName || "";
  const concepts = [];
  const add = (list, file) => {
    for (const n of list) {
      if (n.kind === KIND.CONCEPT && n.name) concepts.push({ name: n.name, line: n.line, file, alias: n.alias });
    }
  };
  // the root is the file name, and it carries no line to squiggle: renaming
  // a file is not a Quick Fix, so the roots stay out of the comparison
  add(nodes, here);
  if (underWorkspace(doc)) {
    for (const other of repoOthers(doc)) add(other.nodes, other.file);
  }
  return synonyms.findings(concepts, distinctConcepts())
    .filter((f) => fileKey(f.file) === fileKey(here))
    .map((f) => ({ line: f.line, message: f.message, related: f.related }));
}

// --- stable Gödel numbers: aot.files/godel.tsv ---------------------------------
// One prime per attribute and one code per value, kept in the repository so
// the numbers a reader sees (the hover, `verify.js --godel`) stay put when an
// unrelated attribute is added, and mean the same in every file and branch.
// Read here, cached by mtime; extended and written on save (aot.godelRegistry).

const godelRegistryCache = new Map(); // path -> { mtimeMs, registry }
const godelRegistryPath = (doc) => path.join(aotFilesDir(doc), "godel.tsv");
function godelRegistry(doc) {
  const file = godelRegistryPath(doc);
  let stat;
  try { stat = fs.statSync(file); } catch { return godel.parseRegistry(""); }
  const hit = godelRegistryCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.registry;
  let registry;
  try { registry = godel.parseRegistry(fs.readFileSync(file, "utf8")); } catch { registry = godel.parseRegistry(""); }
  godelRegistryCache.set(file, { mtimeMs: stat.mtimeMs, registry });
  return registry;
}

// This document and every other in the repo, numbered as one — what the
// hover reads a node's content from.
function godelPooled(doc, root, nodes) {
  const docs = [{ root, nodes }, ...(underWorkspace(doc) ? repoOthers(doc) : [])];
  return godel.pool(docs, godelRegistry(doc));
}

// On save: a registry the repo's attributes have outgrown is written again,
// so the numbers it gave out are the ones every later reader gets.
function saveGodelRegistry(doc) {
  if (!vscode.workspace.getConfiguration("aot").get("godelRegistry", true)) return;
  if (!underWorkspace(doc) || doc.languageId !== "aot") return;
  try {
    const { root, nodes } = parsedDoc(doc);
    const pooled = godelPooled(doc, root, nodes);
    if (!pooled.grown) return;
    const file = godelRegistryPath(doc);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, godel.formatRegistry(pooled.registry));
    godelRegistryCache.delete(file);
  } catch { /* an unwritable aot.files keeps the numbers it had */ }
}

// One idea under two names in two files: the other half of univocity, which
// the content clash covers within a file. Advisory, this file's side only,
// and under the same switch as the synonyms, since it asks the same question.
function twinWarnings(doc, root, nodes) {
  if (!underWorkspace(doc) || !vscode.workspace.getConfiguration("aot").get("synonymWarnings", true)) return [];
  const docs = [{ file: doc.fileName, root, nodes }, ...repoOthers(doc)];
  return godel.twins(docs, doc.fileName, { dismissed: distinctConcepts(), registry: godelRegistry(doc) })
    .map((t) => ({ line: t.line, message: t.message, related: t.related }));
}

// --- the workspace index ----------------------------------------------------
// Every .aot file in the repo, parsed, so crosslinks resolve across files
// and the same Concept defined in two files can be flagged. Built at
// activation, refreshed per-file on save and by a watcher; the current
// document's own live edits are re-linted in analyse, so it stays fresh.
// Keyed by fileKey (the case-folded path), but every entry carries the
// file's real `fsPath` — the key identifies, the fsPath is what a link
// opens and what a message names, and folding the two would open
// 'people.aot' on a disk that spells it 'People.aot'.
// Each entry keeps the file's text as well as its tree: reconciling a Concept
// across files copies a peer's lines verbatim, so aliases, constraints and
// formulas survive the trip (src/repo.js).
const workspaceIndex = new Map(); // fileKey -> { fsPath, text, root, nodes, tables, concepts }
let workspaceExternal = null;     // cached externalIndex over the whole repo

// Whether the platform's file system holds names case-blind. Windows and
// macOS do, Linux does not — every path comparison below follows it rather
// than assuming, so the same repo behaves the same on all three.
const CASE_BLIND_FS = process.platform === "win32" || process.platform === "darwin";

// One key for a file, whatever case it arrives in. On Windows the same file
// reaches us as 'C:\repo\a.aot' from one source and 'c:\repo\a.aot' from
// another (VS Code's URIs and Node's globs disagree about the drive letter),
// and two keys for one file would have that file flagged as its own
// duplicate Concept, and merged into its own formula registry twice.
const fileKey = (p) => (CASE_BLIND_FS ? path.normalize(p).toLowerCase() : path.normalize(p));

// Whether `file` sits inside `dir`, compared as resolved paths so no amount
// of '..' can smuggle a path out of one, and so a sibling whose name merely
// starts the same ('/repo-two' against '/repo') is never mistaken for a child.
function isInside(dir, file) {
  const norm = (p) => (CASE_BLIND_FS ? path.resolve(p).toLowerCase() : path.resolve(p));
  const rel = path.relative(norm(dir), norm(file));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const docRootName = (doc) => path.basename(doc.fileName || "").replace(/\.[^.]*$/, "");

function reindexAot(fsPath, text) {
  try {
    const rootName = path.basename(fsPath).replace(/\.[^.]*$/, "");
    const { root, nodes } = lint(text, rootName);
    const concepts = derive.conceptRegistry(root, nodes);
    workspaceIndex.set(fileKey(fsPath), { fsPath, text, root, nodes, concepts });
  } catch { workspaceIndex.delete(fileKey(fsPath)); }
  workspaceExternal = null; // invalidate; rebuilt lazily
  indexGeneration++;
}

// The registry a formula in `doc` resolves its cross-Concept references
// against: every scope in the repo (the workspace index), with the current
// document's own — parsed from its live, possibly-unsaved text — overlaid
// last, so a same-named scope here shadows one elsewhere. A lone file (no
// workspace) simply sees its own. One scope kind covers both notations: a
// Concept's Examples answer whether they are table rows or '- ' lines
// (derive.conceptRegistry, unified in 1.6).
// `parsed` (optional) is the caller's already-linted { root, nodes }, so the
// paths that just parsed do not parse the document twice.
// One parse per document version, shared by everything that needs the tree.
// The tree lint() returns depends only on the text and the root name — the
// accepted words and the repo option feed the *findings*, never the nodes —
// so there is no reason for one keystroke to parse the same text several
// times, which is what it used to do: the semantic tokens parsed it twice,
// the cursor's recompute twice more on every line change, a save four times,
// and every table keystroke once again just to build a registry.
//
// Keyed on doc.version, so an entry is unusable the moment the text changes
// and there is nothing to invalidate by hand. A document that cannot report a
// version is parsed every time rather than risking a stale tree.
const parsedByDoc = new Map(); // uri string -> { version, root, nodes }

// A tree already parsed for this version, from a caller that had to lint for
// its findings anyway.
function seedParse(doc, root, nodes) {
  if (typeof doc.version !== "number") return;
  parsedByDoc.set(doc.uri.toString(), { version: doc.version, root, nodes });
}

function parsedDoc(doc) {
  if (typeof doc.version !== "number") return lint(doc.getText(), docRootName(doc));
  const key = doc.uri.toString();
  const hit = parsedByDoc.get(key);
  if (hit && hit.version === doc.version) return hit;
  const { root, nodes } = lint(doc.getText(), docRootName(doc));
  const entry = { version: doc.version, root, nodes };
  parsedByDoc.set(key, entry);
  return entry;
}

// Bumped whenever the workspace index changes, so a registry cached against
// the repo as it stood is dropped when another file moves under it.
let indexGeneration = 0;
const registryByDoc = new Map(); // uri string -> { version, generation, registry }

// `swap` (optional): { key, concepts } — one indexed file read another way, as
// a rename reads the file it renames in as it stood before the name was typed
// over, which is what every other file's references still resolve against.
function formulaRegistry(doc, parsed, swap) {
  // a caller passing its own tree gets a registry built on that tree; only
  // the shared parse is cached, so a caller's older tree can never be served
  const cacheable = !parsed && !swap && typeof doc.version === "number";
  const key = doc.uri.toString();
  if (cacheable) {
    const hit = registryByDoc.get(key);
    if (hit && hit.version === doc.version && hit.generation === indexGeneration) return hit.registry;
  }
  const here = fileKey(doc.fileName || "");
  const maps = [];
  for (const [fsPath, v] of workspaceIndex) {
    if (fsPath === here) continue;
    if (swap && fsPath === swap.key) maps.push(swap.concepts);
    else if (v.concepts) maps.push(v.concepts);
  }
  try {
    const { root, nodes } = parsed || parsedDoc(doc);
    maps.push(derive.conceptRegistry(root, nodes));
  } catch { /* an unparseable document still resolves against the repo */ }
  const registry = table.mergeRegistries(...maps);
  if (cacheable) registryByDoc.set(key, { version: doc.version, generation: indexGeneration, registry });
  return registry;
}

function externalFor() {
  if (!workspaceExternal) {
    workspaceExternal = externalIndex(
      [...workspaceIndex.values()].map((v) => ({ file: v.fsPath, root: v.root, nodes: v.nodes })));
  }
  return workspaceExternal;
}

// Whether a document lives inside an open workspace folder — cross-file
// resolution and repo-wide duplicates apply only there.
function underWorkspace(doc) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length || !doc.fileName) return false;
  return folders.some((w) => isInside(w.uri.fsPath, doc.fileName));
}

// Whether the editor keeps a shared Concept in step for you, rather than
// only reporting where it drifted (aot.autoReconcile).
const autoReconcile = () => vscode.workspace.getConfiguration("aot").get("autoReconcile", true);

// Every *other* .aot in the repo, in the shape src/repo.js takes. The current
// file is left out on purpose: its own occurrences are read from the tree
// just parsed, so an unsaved edit is judged as it stands rather than as the
// index last saw it.
function repoOthers(doc) {
  const here = fileKey(doc.fileName || "");
  const out = [];
  for (const [key, v] of workspaceIndex) {
    if (key === here || v.text === undefined) continue;
    out.push({ file: v.fsPath, text: v.text, root: v.root, nodes: v.nodes });
  }
  return out;
}

// The repo option for lint, or undefined outside a workspace — where there
// are no other files, there is nothing cross-file to say.
const repoOptionFor = (doc) => (underWorkspace(doc)
  ? { file: doc.fileName, others: repoOthers(doc), autoReconcile: autoReconcile() }
  : undefined);

// The real path of the peer a maintained `...` line names by base name. The
// note carries the base name because that is what reads well in the file; the
// index knows which path on disk it stands for.
function peerPathFor(doc, base) {
  const here = fileKey(doc.fileName || "");
  const want = base.toLowerCase();
  for (const [key, v] of workspaceIndex) {
    if (key !== here && path.basename(v.fsPath).toLowerCase() === want) return v.fsPath;
  }
  return null;
}

// The line a Concept stands on in an indexed file as it reads now (its name
// numbering and case aside), or null when the index has no such Concept.
function conceptLineIn(fsPath, name) {
  const entry = workspaceIndex.get(fileKey(fsPath));
  if (!entry || !name) return null;
  const want = table.numberless(name).trim().toLowerCase();
  const hit = entry.nodes.find((n) => n.kind === KIND.CONCEPT && table.numberless(n.name).trim().toLowerCase() === want);
  return hit ? hit.line : null;
}

// The tree and its crosslinks, without any of the findings: the tree, the
// links, and the usages read back off them. It is all a rename or a renumber
// needs, and analyse() builds its findings on top of it — so the paths that
// only move names around no longer pay for the deep audits, the spelling and
// the repo-wide synonym pass that analyse() runs (renumberEdits used to call
// analyse in full, on every Format Document and on every save).
function linkAnalysis(doc) {
  const { root, nodes } = parsedDoc(doc);
  const inWs = underWorkspace(doc);
  // keep this file's entry current so other files resolve against its edits.
  // Only when the text has actually moved, though: the entry is what the
  // repo-wide external index and every merged formula registry are built
  // from, and rebuilding those on an analysis that changed nothing threw
  // away caches the rest of the repo had not invalidated.
  if (inWs) {
    const key = fileKey(doc.fileName);
    const prev = workspaceIndex.get(key);
    const text = doc.getText();
    if (!prev || prev.text !== text) {
      const concepts = derive.conceptRegistry(root, nodes);
      workspaceIndex.set(key, { fsPath: doc.fileName, text, root, nodes, concepts });
      workspaceExternal = null;
      indexGeneration++;
    }
  }
  const links = resolve(doc.getText(), root, nodes, inWs ? externalFor() : undefined);
  // the links reversed: every place a node is referenced, for the "used at"
  // hover sections and Find All References
  const usagesOf = new Map();
  for (const link of links) {
    const list = usagesOf.get(link.target);
    if (list) list.push(link); else usagesOf.set(link.target, [link]);
  }
  const analysis = { links, root, nodes, usagesOf, version: doc.version };
  analysisByDoc.set(doc.uri.toString(), analysis);
  return analysis;
}

// The last analysis of this document, but only when it was made from the text
// the document now holds. A tree from an earlier version places names on
// lines that have since moved, which is what the outline — and so sticky
// scroll and the breadcrumbs — would then draw. A document that reports no
// version answers as it always did, with whatever was last analysed.
function currentAnalysis(doc) {
  const hit = analysisByDoc.get(doc.uri.toString());
  if (!hit) return null;
  if (typeof doc.version !== "number" || hit.version === undefined) return hit;
  return hit.version === doc.version ? hit : null;
}

function analyse(doc) {
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const accepted = acceptedWords();
  // the repo option is read before the lint so this file's own entry, which
  // the lint is about to refresh, can never be mistaken for one of its peers
  const repoOption = repoOptionFor(doc);
  const linted = lint(doc.getText(), rootName, accepted, repoOption);
  const { errors, warnings } = linted;
  // the tree a lint returns is the tree a plain lint returns — the accepted
  // words and the repo option feed the findings, never the nodes — so this
  // one serves every other reader of this version rather than being thrown
  // away and parsed again
  seedParse(doc, linted.root, linted.nodes);
  const { root, nodes, links, usagesOf } = linkAnalysis(doc);
  const inWs = underWorkspace(doc);
  // a lattice over a broken tree means nothing, so suggest only on V = 0.
  // Gödel clash hints share the same advisory channel (no squiggle) and the
  // same V = 0 gate.
  // The FCA audit (drift / exhaustion) and the content-identical Gödel clash are
  // errors (counted in V); the inferred functional dependencies are warnings
  // (not counted in V). All of them mean nothing over a tree that does not yet
  // verify, so they run only once the syntactic/subsumption pass is clean.
  let deepErrors = [];
  let depWarnings = [];
  const objects = nodes.filter((n) => n.kind === KIND.INDIVIDUAL).length;
  if (!errors.length) {
    if (objects >= 2 && objects <= MAX_FCA_OBJECTS) {
      deepErrors = suggest(root, nodes).findings;
      // inferred functional dependencies (derivable / equivalent attributes).
      // Correlated attributes are allowed, so these squiggles are opt-in via
      // aot.dependencyFindings (verify.js --fd always shows the full set).
      // When on, only confident, witnessed dependencies are flagged: a bare
      // one-to-one covariation (confidence 0) could be coincidence, and a
      // finding over an ellipsis-marked (intentionally incomplete) Example
      // set is provisional — both stay held back, like the same-name clash
      // split below. An FD other FDs already imply by transitivity (the
      // minimal cover) is held back too.
      depWarnings = vscode.workspace.getConfiguration("aot").get("dependencyFindings", false)
        ? armstrong.findings(root, nodes).filter((f) => f.confidence >= armstrong.MIN_CONFIDENCE && !f.incomplete && !f.implied)
        : [];
    }
    // only the strong, content-identical clashes are flagged in the editor;
    // the weaker same-name clashes are not surfaced
    deepErrors = deepErrors.concat(clashes(root, nodes).findings.filter((f) => f.kind === "content"));
    // a value every child states belongs on the parent, and a default every
    // child overrides is in force for nothing: warnings, never in V
    depWarnings = depWarnings.concat(godel.hoists(root, nodes).map((h) => ({ line: h.line, message: h.message, related: h.related })));
  }
  // the derivations and the constraints are Python: code, not prose, so
  // spelling leaves them alone. What they find when they run is Python's
  // own business, in a collection of its own (pythonFindings) — never in V
  const pythonSpans = codeSpans(doc.getText().split(/\r?\n/), root, nodes, rootName);
  const inPython = (h) => pythonSpans.some((s) => s.line === h.line && h.startCol >= s.startCol && h.endCol <= s.endCol);
  // spelling is advisory prose-hygiene, independent of the tree's verdict:
  // words longer than four characters that no English dialect (nor the
  // user's accepted words) knows, off with aot.spellingHints
  const config = vscode.workspace.getConfiguration("aot");
  const hints = config.get("spellingHints", true)
    ? spelling.check(doc.getText(), accepted).filter((h) => !inPython(h))
    : [];
  // a value naming no Example of the Concept typing its attribute is a gap
  // in the model rather than a contradiction in it, so it hints exactly as
  // spelling does — on its span, never in the Problems panel, never in V —
  // and its Quick Fix lists the Example. Off with aot.exampleHints.
  if (config.get("exampleHints", true)) {
    hints.push(...unlistedValues(doc.getText(), root, nodes, inWs ? externalFor() : undefined));
  }
  // one idea under two names across files — asked only of a file that is
  // itself clean, since a broken tree's content means nothing yet
  const twins = !errors.length ? twinWarnings(doc, root, nodes) : [];
  return {
    errors: errors.concat(deepErrors),
    warnings: warnings.concat(depWarnings, synonymWarnings(doc, root, nodes), twins),
    hints,
    links,
    root,
    nodes,
    usagesOf,
  };
}

// Every span of Python in a document — each derivation from its '=' to its
// end (a value's, a cell's, a Concept's) and each constraint's bound — for
// the colouring, and to keep spelling out of code.
function codeSpans(lines, root, nodes, rootName) {
  const spans = [];
  try {
    for (const h of python.hostsOf(nodes, lines, rootName)) {
      spans.push({ line: h.line, startCol: h.startCol, endCol: h.endCol });
    }
  } catch { /* an unparseable grid colours nothing */ }
  for (const s of derive.derivationSpans(root, nodes, lines)) {
    if (s.constraint) spans.push({ line: s.line, startCol: s.startCol, endCol: s.endCol });
  }
  return spans.sort((a, b) => (a.line - b.line) || (a.startCol - b.startCol));
}

function linkRange(link) {
  return new vscode.Range(link.line - 1, link.startCol, link.line - 1, link.endCol);
}

function decorate(editor, decorationTypes) {
  if (editor.document.languageId !== "aot") return;
  const { links = [] } = analysisByDoc.get(editor.document.uri.toString()) || {};
  const concepts = [];
  const individuals = [];
  for (const link of links) {
    // dotted underline for links to an Example — or to the default a value
    // names, which is a value too — solid for links to a Concept
    const isConcept = link.target.kind !== KIND.INDIVIDUAL && !link.asValue;
    const where = link.target.line ? `line ${link.target.line}` : "the file name";
    (isConcept ? concepts : individuals).push({
      range: linkRange(link),
      hoverMessage: link.asValue
        ? `${link.connection}: the default of Concept '${link.target.name}' (${where})`
        : `${link.connection}: ${isConcept ? "Concept" : "Example"} '${link.target.name}' (${where})`,
    });
  }
  editor.setDecorations(decorationTypes.concept, concepts);
  editor.setDecorations(decorationTypes.individual, individuals);
  editor.setDecorations(decorationTypes.parked, [...parkedMarks(editor.document), ...pythonMarks(editor.document)]);
  if (decorationTypes.stale) editor.setDecorations(decorationTypes.stale, pyDims.get(editor.document.uri.toString()) || []);
  // a function a derivation calls that a Python file here defines: underlined
  // as the crosslinks are, since Ctrl+click opens it too
  if (decorationTypes.pyLink) {
    let calls = [];
    try { calls = pythonCallLinks(editor.document); } catch { /* an unparseable file links nothing */ }
    editor.setDecorations(decorationTypes.pyLink, calls.map((c) => ({ range: c.range })));
  }
}

// A derivation may hold a backtick — in a Python string, `` =f("`A`") `` —
// so the markdown code span showing it is fenced with one more backtick than
// the derivation holds, and padded, which is exactly what CommonMark asks
// for. Fencing it in a bare pair would end the span at its first backtick.
function codeSpan(text) {
  const s = String(text);
  const longest = (s.match(/`+/g) || []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = "`".repeat(longest + 1);
  return longest ? `${fence} ${s} ${fence}` : `${fence}${s}${fence}`;
}

// A parked file reads as plain values — which is what makes it safe to lint,
// and what makes it easy to overwrite by hand. Every value whose derivation
// is sitting in the `.formulas` store is marked where it stands and says, on
// hover, what computes it and how to get at that. The mark is a *background*
// rather than an underline: the two underline styles already mean "this is a
// crosslink", and a decoration that added text would push a grid's cells out
// of alignment on the one line it marked.
function parkedMarks(doc) {
  if (doc.languageId !== "aot") return [];
  if (!vscode.workspace.getConfiguration("aot").get("parkedValueMarks", true)) return [];
  const parked = parkedFormulas(doc);
  if (!parked.length) return [];
  const analysis = analysisByDoc.get(doc.uri.toString());
  const lines = doc.getText().split(/\r?\n/);
  let spans;
  try {
    const nodes = (analysis && analysis.nodes) || parsedDoc(doc).nodes;
    spans = park.parkedSpans(lines, nodes, docRootName(doc), parked);
  } catch { return []; } // an unparseable file marks nothing rather than guessing
  const store = path.basename(parkPath(doc));
  return spans.map((s) => {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    if (s.constraint) {
      // a parked constraint marks the name it was written on, and still holds
      md.appendMarkdown(`**Constrained** — ${codeSpan(s.formula)}\n\n`);
      md.appendMarkdown(`Parked as ${codeSpan(s.address)} in \`${store}\`, and still checked when Python runs: `
        + "a value that breaks it is flagged exactly as if it were written here. "
        + "[Put the derivations back](command:aot.toggleFormulaPark) (``Ctrl+Shift+` ``) to see or change it.");
      return {
        range: new vscode.Range(s.line - 1, s.startCol, s.line - 1, s.endCol),
        hoverMessage: md,
      };
    }
    md.appendMarkdown(`**${s.concept ? "Written by Python" : "Computed by Python"}** — ${codeSpan(s.formula)}\n\n`);
    if (s.concept) md.appendMarkdown("Every row of this table is the derivation's. ");
    md.appendMarkdown(`Parked as ${codeSpan(s.address)} in \`${store}\`. `);
    md.appendMarkdown("A value typed over this one stands only until the derivation comes home and runs again "
      + "— change the derivation instead: "
      + "[put the derivations back](command:aot.toggleFormulaPark) (``Ctrl+Shift+` ``).");
    return {
      range: new vscode.Range(s.line - 1, s.startCol, s.line - 1, s.endCol),
      hoverMessage: md,
    };
  });
}

// A { line, text } edit from table.align may instead span a
// whole block ({ line, to }, both 1-based, inclusive) when cell wrapping
// changed the block's line count; text then holds the block's lines joined
// with '\n'. One range/text pair serves either shape, the text's newlines
// following the document's EOL.
function lineEditRange(doc, e) {
  const last = (e.to || e.line) - 1;
  return new vscode.Range(e.line - 1, 0, last, doc.lineAt(last).text.length);
}
function lineEditText(doc, e) {
  return doc.eol === vscode.EndOfLine.CRLF ? e.text.replace(/\n/g, "\r\n") : e.text;
}

function refresh(diagnostics, decorationTypes, doc) {
  if (doc.languageId !== "aot") return;
  if (doc.fileName) watchAotRoot(aotRoot(doc));
  // the text a first edit will be read against, should it type over a name
  if (!textBefore.has(doc.uri.toString())) textBefore.set(doc.uri.toString(), doc.getText());
  const { errors, warnings, hints, root, nodes } = analyse(doc);
  const toDiagnostic = (severity) => ({ line, message, startCol, endCol, related }) => {
    // lines are 1-based; a finding that carries columns (a table cell)
    // squiggles just that span, otherwise the whole line's content
    const at = Math.min(Math.max(line - 1, 0), doc.lineCount - 1);
    const range = startCol !== undefined
      ? new vscode.Range(at, startCol, at, endCol)
      : doc.lineAt(at).range;
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = "aot";
    // a finding naming partner locations (the other half of a duplicate)
    // carries them as clickable related information — in this file when the
    // partner has no file, else in the named one (whole-line: another file's
    // line length is unknown here, and the editor clamps the range)
    if (related && related.length) {
      diagnostic.relatedInformation = related.map((r) => {
        const rAt = Math.max(r.line - 1, 0);
        const rRange = r.startCol !== undefined
          ? new vscode.Range(rAt, r.startCol, rAt, r.endCol)
          : !r.file && rAt < doc.lineCount
            ? doc.lineAt(rAt).range
            : new vscode.Range(rAt, 0, rAt, 400);
        const uri = r.file ? vscode.Uri.file(r.file) : doc.uri;
        return new vscode.DiagnosticRelatedInformation(new vscode.Location(uri, rRange), r.message);
      });
    }
    return diagnostic;
  };
  // the linter's verdict is a problem: errors (V != 0) squiggle red and
  // warnings squiggle yellow, both reaching the Problems panel. The FCA audit
  // and the content-identical clash are folded into errors; the inferred
  // functional dependencies into warnings (see analyse). Spelling maps to
  // Hint: visible on its exact span and on hover, never in the Problems
  // panel — a word the dictionaries don't know is a nudge, not a verdict.
  let publish = [
    ...errors.map(toDiagnostic(vscode.DiagnosticSeverity.Error)),
    ...warnings.map(toDiagnostic(vscode.DiagnosticSeverity.Warning)),
    ...hints.map(toDiagnostic(vscode.DiagnosticSeverity.Hint)),
  ];
  // While an edit burst is live, a finding that is new and not on a line
  // being edited waits until the cursor leaves what is being edited (hold.js)
  // — so a parent is never nagged the instant its first child is typed —
  // while one already on screen, and every one on an edited line, publishes
  // at once. The family is re-read off this fresh tree, since lines move as
  // you type. Decorations and colours are not diagnostics and never wait.
  const state = holdState.get(doc.uri.toString());
  if (state) {
    const { show, held } = hold.partition(publish, state.baseline, state.edited);
    publish = show;
    state.held = held;
    const family = hold.familyOf(root, nodes, state.lastLine + 1);
    if (family) {
      // the line being written is in it, whatever stands there yet
      family.from = Math.min(family.from, state.lastLine + 1);
      family.to = Math.max(family.to, state.lastLine + 1);
      state.family = family;
    }
  }
  diagnostics.set(doc.uri, publish);
  updateHoldStatus();
  // the Python findings live apart from the linter's: none of them is a
  // verdict on the model, so none of them is in V
  try { pythonFindings(doc); } catch { /* the linter's findings stand regardless */ }
  pythonWarm(doc, pythonHostsIn(doc));
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document === doc) decorate(editor, decorationTypes);
  }
  chainHintsChanged.fire(); // the inlay chains track the fresh analysis
}

// Ctrl+click on a crosslink jumps to the defining node's line.
const definitionProvider = {
  provideDefinition(doc, position) {
    // a sidecar function called in a Python derivation opens its `def`
    const def = pythonDefinition(doc, position);
    if (def) return def;
    const { links } = analysisByDoc.get(doc.uri.toString()) || analyse(doc);
    for (const link of links) {
      if (!linkRange(link).contains(position)) continue;
      const line = Math.max(link.target.line - 1, 0);
      // a cross-file target opens the other file at the target's line
      if (link.file) {
        return new vscode.Location(vscode.Uri.file(link.file), new vscode.Range(line, 0, line, 0));
      }
      const at = Math.min(line, doc.lineCount - 1);
      return new vscode.Location(doc.uri, doc.lineAt(at).range);
    }
    return null;
  },
};

// The defining Concept or Example whose name sits under the cursor, or null.
function definingNodeAt(analysis, doc, position) {
  for (const node of analysis.nodes) {
    if (node.line - 1 !== position.line) continue;
    if (node.kind !== KIND.CONCEPT && node.kind !== KIND.INDIVIDUAL) continue;
    const raw = doc.lineAt(node.line - 1).text;
    let start = node.nameCol;
    if (start === undefined) {
      const indent = raw.length - raw.trimStart().length;
      start = node.kind === KIND.INDIVIDUAL ? indent + 2 : indent; // past '- '
    }
    if (position.character >= start && position.character <= start + node.name.length) return node;
  }
  return null;
}

// The markdown lines for where a node is referenced, capped to stay readable.
const MAX_USAGES = 8;
function appendUsages(md, doc, analysis, node) {
  const usages = analysis.usagesOf ? analysis.usagesOf.get(node) || [] : [];
  if (!usages.length) return false;
  md.appendMarkdown(`\n**used at**\n\n`);
  for (const link of usages.slice(0, MAX_USAGES)) {
    const at = Math.min(Math.max(link.line - 1, 0), doc.lineCount - 1);
    md.appendMarkdown(`- line ${link.line}: \`${doc.lineAt(at).text.trim()}\`\n`);
  }
  if (usages.length > MAX_USAGES) md.appendMarkdown(`- +${usages.length - MAX_USAGES} more\n`);
  return true;
}

// The markdown for one Example's full details: what it is an Example of,
// where it is defined, and the values it carries.
function exampleMarkdown(doc, analysis, ex, withUsages) {
  const md = new vscode.MarkdownString();
  const owner = owningConcept(ex);
  md.appendMarkdown(`**'- ${ex.name}'**${owner && owner.name !== ex.name ? ` — Example of '${owner.name}'` : ""} (line ${ex.line})\n\n`);
  for (const c of ex.children) {
    if (c.kind === KIND.DEFAULT) md.appendMarkdown(`- ${c.name}: ${c.value}\n`);
    else if (c.kind === KIND.ATTRIBUTE) md.appendMarkdown(`- ${c.name}\n`);
    else if (c.kind === KIND.INDIVIDUAL) md.appendMarkdown(`- \\- ${c.name}\n`);
  }
  if (withUsages) appendUsages(md, doc, analysis, ex);
  return md;
}

// The '@'-separated parts of the reference ending at the cursor. A part may
// hold spaces but never an operator or paren, so the reference is the
// trailing run of `@part`s. Returns the parts after each '@' (the last is
// the fragment being typed), or null when the cursor is not in a reference.
function refSegments(before) {
  const m = /(?:@[^@()+\-*/&,`]*)+$/.exec(before);
  if (!m) return null;
  return m[0].split("@").slice(1); // drop the empty piece before the first '@'
}

// Typing '@' in a formula (a table cell or a line-form value) offers the
// references you can name: this table's columns/attributes first (best
// practice is @column), then its Examples/rows, then — last — the repo's
// tables by the Concept/Example/Attribute each sits under. A table always
// leads a reference (`@Order@…`), so its columns/Examples are offered once
// one has been picked. In a table the local names come from the block's
// header and first column; on a line-form value, from the sibling
// attributes and Examples.
const referenceCompletion = {
  provideCompletionItems(doc, position) {
    const before = doc.lineAt(position.line).text.slice(0, position.character);
    // only when an '@' reference is being typed (the trigger, or continuing one)
    if (!/@[^@]*$/.test(before)) return [];
    const segs = refSegments(before) || [""];
    const lines = doc.getText().split(/\r?\n/);
    const registry = formulaRegistry(doc);
    const items = [];
    const pushCols = (cols) => cols.forEach((c, i) => {
      const it = new vscode.CompletionItem(c, vscode.CompletionItemKind.Field);
      it.detail = "column"; it.sortText = "0" + String(i).padStart(3, "0");
      items.push(it);
    });
    const pushRows = (rs) => rs.forEach((r, i) => {
      const it = new vscode.CompletionItem(r, vscode.CompletionItemKind.EnumMember);
      it.detail = "Example"; it.sortText = "1" + String(i).padStart(3, "0");
      items.push(it);
    });

    // a part after a foreign table selector (@Table@…): offer that table's
    // own columns and Examples, nothing else
    if (segs.length >= 2) {
      const foreign = registry.scopes.get(segs[0].toLowerCase());
      if (foreign) { pushCols(foreign.columns); pushRows(foreign.rows); return items; }
    }

    // the first part (or a local column paired with an Example): the current
    // table's columns and Examples, exactly as before
    let columns = [], rows = [], hasContext = false;
    const block = table.blockAt(lines, position.line);
    if (block) {
      ({ columns, rows } = table.referenceNames(block));
      hasContext = true;
    } else {
      const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
      const { nodes } = lint(doc.getText(), rootName);
      const refs = derive.referencesAt(nodes, position.line + 1);
      if (refs) { columns = refs.columns; rows = refs.rows; hasContext = true; }
    }
    if (!hasContext) return items; // not on a formula-bearing line
    pushCols(columns); pushRows(rows);

    // the tables come last, and only while the very first part is typed — a
    // table selector always leads. Picking one inserts `Name@` and reopens
    // the suggestions on its columns.
    if (segs.length <= 1) {
      const seen = new Set();
      let i = 0;
      for (const s of registry.scopes.values()) {
        const name = s.name;
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const it = new vscode.CompletionItem(name, vscode.CompletionItemKind.Struct);
        it.detail = "table"; it.sortText = "2" + String(i++).padStart(3, "0");
        it.insertText = name + "@";
        it.command = { command: "editor.action.triggerSuggest", title: "" };
        items.push(it);
      }
    }
    return items;
  },
};

// The Example names an archived `_<Concept>.csv` still remembers — its first
// column. A CSV is archived when no Concept claims it any more, and it is
// never folded back: that would silently undo the archiving. Reading it,
// though, costs nothing and is worth everything — those values were real
// once, and are exactly what someone re-typing the attribute is reaching for.
function archivedValues(doc, conceptName) {
  let csv;
  try { csv = fs.readFileSync(path.join(aotFilesDir(doc), "_" + csvName(conceptName)), "utf8"); }
  catch { return []; }
  return table.fromCsv(csv).slice(1).map((r) => (r[0] || "").trim()).filter(Boolean);
}

// The values an attribute can take, offered where its value is typed. An
// attribute that names a Concept is answerable to that Concept's Examples —
// the same rule the unlisted-value hint applies — so those are the
// suggestions, with the Concept's archived CSV folded in beside them and
// marked as such.
// The dropdown a Concept-typed attribute offers: the Concept's default
// first, then its Examples, its archived CSV values after — shared by the
// line form and the table cells, so the two spellings behave identically.
function valueItemsFor(doc, type) {
  const items = [];
  const seen = new Set();
  const push = (text, detail, kind, group, i) => {
    if (seen.has(text.toLowerCase())) return;
    seen.add(text.toLowerCase());
    const it = new vscode.CompletionItem(text, kind);
    it.detail = detail;
    it.sortText = group + String(i).padStart(3, "0");
    items.push(it);
  };
  // the value the attribute already reads when nothing is written
  if (type.value) push(String(type.value), `the default of ${type.name}`, vscode.CompletionItemKind.Constant, "0", 0);
  listedExamples(type).forEach((ex, i) =>
    push(ex.name, `Example of ${type.name}`, vscode.CompletionItemKind.EnumMember, "0", i + 1));
  // the archive comes second: a value that was real once, but is not now
  archivedValues(doc, type.name).forEach((v, i) =>
    push(v, `archived in _${csvName(type.name)}`, vscode.CompletionItemKind.Value, "1", i));
  return items;
}

// The same dropdown inside a table cell: the cursor's column may be typed by
// a Concept (its header cell names one, or carries one as an (alias)), and
// then the cell's value is one of that Concept's Examples. A value the list
// lacks still hints once written (unlistedValues), and its Quick Fix lists
// it under the Concept — so picking from the dropdown and coining a fresh
// Example both keep the model whole.
function tableCellItems(doc, position, line, parsed) {
  if (table.isSeparator(line.trim())) return [];
  const lines = doc.getText().split(/\r?\n/);
  const block = table.blockAt(lines, position.line);
  if (!block || position.line === block.start) return []; // no block, or the header row itself
  if (table.headerIndex(block) === -1) return []; // nothing but a leftover rule
  const col = table.colAt(line, position.character);
  if (col === 0) return []; // the name column declares Examples, not values
  const cell = table.cells(line)[col];
  if (cell && cell.text.slice(0, Math.max(0, position.character - cell.col)).includes("=")) return []; // a formula
  const span = table.cells(lines[block.start])[col];
  if (!span) return [];
  const attr = parsed.nodes.find((n) => n.kind === KIND.ATTRIBUTE && n.cell
    && n.line === block.start + 1
    && n.nameCol >= span.col && n.nameCol <= span.col + span.text.length);
  if (!attr) return [];
  const type = conceptType(attr, crosslinkIndex(parsed.root, parsed.nodes).concepts);
  if (!type) return [];
  return valueItemsFor(doc, type);
}

const valueCompletion = {
  provideCompletionItems(doc, position) {
    // the cheap guards first: this runs on every keystroke, and only a value
    // being typed (never a formula) has values to offer
    const line = doc.lineAt(position.line).text;
    // the last analysis, as the hover and the inlay chains do: completion
    // fires on every keystroke, and re-linting the document each time to
    // suggest a value would be paying the linter's price for the editor's
    let parsed;
    if (table.isRowText(line)) {
      try { parsed = analysisByDoc.get(doc.uri.toString()) || analyse(doc); } catch { return []; }
      return tableCellItems(doc, position, line, parsed);
    }
    const colon = line.indexOf(":");
    if (colon === -1 || position.character <= colon) return [];
    const typed = line.slice(colon + 1, position.character);
    if (typed.includes("=")) return [];

    try { parsed = analysisByDoc.get(doc.uri.toString()) || analyse(doc); } catch { return []; }
    const node = parsed.nodes.find((n) => n.line === position.line + 1
      && (n.kind === KIND.DEFAULT || n.kind === KIND.ATTRIBUTE) && !n.cell);
    if (!node) return [];
    const type = conceptType(node, crosslinkIndex(parsed.root, parsed.nodes).concepts);
    if (!type) return [];
    return valueItemsFor(doc, type);
  },
};

// Resolve a path-shaped value to an existing file's absolute path, or null:
// an absolute path as written, else relative to the .aot's folder, else to
// the workspace root; `~/` expands to the home directory.
function resolveFilePath(doc, text) {
  let raw = text.trim();
  if (raw.startsWith("~/") || raw === "~") {
    raw = path.join(process.env.USERPROFILE || process.env.HOME || "", raw.slice(1));
  }
  const candidates = [];
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) candidates.push(raw);
  else {
    if (doc.fileName) candidates.push(path.join(path.dirname(doc.fileName), raw));
    const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (ws) candidates.push(path.join(ws.uri.fsPath, raw));
    // `aot.files/…` is written from the repository's root — where a picture
    // or text Python wrote is — even when the folder open is below it
    if (doc.fileName) candidates.push(path.join(aotRoot(doc), raw));
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch { /* keep trying */ }
  }
  return null;
}

// Every file-path value in the document that resolves to a real file.
function fileLinksIn(doc) {
  return urls.findFiles(doc.getText().split(/\r?\n/), (t) => resolveFilePath(doc, t));
}

// The repo's own copy of a cited file, or null: the value points outside
// aot.files, but a file of the same name is held there. Ctrl+click and the
// hover answer with the copy — the file that travels with the repo — while
// the written value, and the lightbulb that offers to rewrite it, keep
// seeing the path as typed.
function repoCopyOf(doc, fsPath) {
  const dir = aotFilesDir(doc);
  if (isInside(dir, fsPath)) return null;
  const copy = path.join(dir, path.basename(fsPath));
  try { if (fs.existsSync(copy) && fs.statSync(copy).isFile()) return copy; } catch { /* unreadable: no copy */ }
  return null;
}

// A free name in `dir` for `base`: the name itself when nothing holds it,
// else 'name (2).ext', 'name (3).ext', … — the convention every desktop uses.
function freeName(dir, base) {
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${stem} (${n})${ext}`;
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
}

// The file link under a position, or the only one on its line.
function fileLinkAt(doc, position) {
  const here = fileLinksIn(doc).filter((f) => f.line === position.line + 1);
  return here.find((f) => position.character >= f.startCol && position.character <= f.endCol) || here[0] || null;
}

// AOT: Copy File into aot.files — the lightbulb on a file-path value that
// points outside the repo's own file store. The file is copied in and the
// value rewritten to name the copy, so a model travels with its evidence:
// clone the repo and everything it cites comes too, instead of a path into
// somebody's Desktop that means nothing on any other machine.
//
// Never silently destructive. A file already there with the same bytes is
// simply relinked — no write at all — and one that differs asks first,
// offering to keep both under a numbered name. The copy is written with
// forward slashes whatever the platform, so the .aot reads the same on
// Windows, Linux and macOS.
async function copyFileIntoRepo() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "aot") return;
  const doc = editor.document;
  const link = fileLinkAt(doc, editor.selection.active);
  if (!link) {
    vscode.window.showInformationMessage("AOT: put the cursor on a file path to copy it into aot.files.");
    return;
  }
  const dir = aotFilesDir(doc);
  const base = path.basename(link.fsPath);
  if (isInside(dir, link.fsPath)) {
    vscode.window.showInformationMessage(`AOT: '${base}' already lives in aot.files.`);
    return;
  }
  let name = base;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const source = fs.readFileSync(link.fsPath);
    const target = path.join(dir, base);
    let write = true;
    if (fs.existsSync(target)) {
      if (fs.readFileSync(target).equals(source)) {
        write = false; // the very same file is already here: just point at it
      } else {
        const choice = await vscode.window.showWarningMessage(
          `'${base}' is already in aot.files, holding something different.`,
          { modal: true, detail: "Keep both, and the copy is named '" + freeName(dir, base) + "'." },
          "Keep Both", "Replace");
        if (!choice) return;
        if (choice === "Keep Both") name = freeName(dir, base);
      }
    }
    if (write) fs.writeFileSync(path.join(dir, name), source);
  } catch (e) {
    vscode.window.showErrorMessage(`AOT: could not copy '${base}' into aot.files — ${e.message}`);
    return;
  }
  const rel = `aot.files/${name}`;
  await editor.edit((b) => b.replace(
    new vscode.Range(link.line - 1, link.startCol, link.line - 1, link.endCol), rel));
  vscode.window.showInformationMessage(`AOT: '${base}' is in aot.files; the value now reads ${rel}.`);
}

// A URL or file path under the cursor answers on hover: a URL with light
// metadata (a HEAD request, cached, off with aot.urlMetadata), and an image
// URL or image file with the picture itself. A non-image file just confirms
// the resolved path. Ctrl+click (the DocumentLinkProvider) opens either.
// Both answer with the aot.files copy of an outside file when one is there,
// so the hover always names exactly what the click will open.
function linkHoverAt(doc, position) {
  if (position.line >= doc.lineCount) return null;
  const lineText = doc.lineAt(position.line).text;
  const at = (s) => position.character >= s.startCol && position.character <= s.endCol;
  const rangeOf = (s) => new vscode.Range(position.line, s.startCol, position.line, s.endCol);

  // a file path: show the picture for an image, else the resolved path —
  // the aot.files copy where one exists, matching what Ctrl+click opens
  const file = fileLinksIn(doc).find((f) => f.line === position.line + 1 && at(f));
  if (file) {
    const target = repoCopyOf(doc, file.fsPath) || file.fsPath;
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    const uri = vscode.Uri.file(target);
    if (urls.isImage(target)) md.appendMarkdown(`![](${uri.toString()}|width=320)\n\n`);
    md.appendMarkdown(`\`${target}\``);
    return new vscode.Hover(md, rangeOf(file));
  }

  const span = urls.findUrls([lineText]).find(at);
  if (!span) return null;
  const range = rangeOf(span);
  const wantMeta = vscode.workspace.getConfiguration("aot").get("urlMetadata", true);
  if (urls.isImage(span.url)) {
    // an image URL: show the picture (plus metadata beneath when enabled)
    if (!wantMeta) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`![](${span.url})`);
      return new vscode.Hover(md, range);
    }
    return urls.metadata(span.url).then((m) => {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`![](${span.url})\n\n` + (m.error ? `unreachable: ${m.error}`
        : [`status ${m.status}`, m.contentType && `type ${m.contentType}`, m.lastModified && `last modified ${m.lastModified}`].filter(Boolean).join(" · ")));
      return new vscode.Hover(md, range);
    });
  }
  if (!wantMeta) return null;
  return urls.metadata(span.url).then((m) => {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(m.error
      ? `**${span.url}** — unreachable: ${m.error}`
      : `**${span.url}**\n\n` + [
          `status ${m.status}`,
          m.contentType && `type ${m.contentType}`,
          m.lastModified && `last modified ${m.lastModified}`,
        ].filter(Boolean).join(" · "));
    return new vscode.Hover(md, range);
  });
}

// Hovering shows what the cursor rests on:
//   - a URL -> its metadata, fetched on demand;
//   - a crosslink to an Example -> that Example's full details (its owner,
//     defining line, and every value it carries);
//   - a Concept's defining name, or a crosslink to a Concept -> its
//     dependency chains — `Trip ─driver person→ Person ─home address→
//     Address (3 Concepts)`, one chain per crosslinked attribute — plus
//     where it is used;
//   - an Example's defining name -> its details plus where it is used as a
//     value.
// The hover on a maintained `...` line answers the part of it under the
// cursor. Over `N more`: those N Examples — the ones written elsewhere and
// not here — grouped by the file each is written in. Over a file name: that
// file's Examples of the Concept. Anywhere else: the whole extension, this
// file's share and every peer's. Every Example is a link to where it is
// written, and a long list is cut short with how many more it holds.
const NOTE_HOVER_CAP = 12;
const mdText = (s) => String(s).replace(/[\\`*_{}[\]()#+!|<>]/g, "\\$&");
function crossFileHover(doc, analysis, position) {
  if (!underWorkspace(doc)) return null;
  const node = (analysis.nodes || []).find((n) =>
    n.kind === KIND.MAP && repo.NOTE_RE.test(n.name) && n.line - 1 === position.line);
  if (!node || !node.parent) return null;
  const concept = node.parent;
  const all = repo.occurrences([
    ...repoOthers(doc),
    { file: doc.fileName, text: doc.getText(), root: analysis.root, nodes: analysis.nodes },
  ]);
  const fold = (name) => table.numberless(name).trim().toLowerCase();
  const list = all.get(fold(concept.name)) || [];
  if (list.length < 2) return null;
  const isHere = (occ) => fileKey(occ.file) === fileKey(doc.fileName);
  const examplesOf = (occ) => occ.node.children.filter((c) => c.kind === KIND.INDIVIDUAL);
  const linkTo = (file, line, label) => `[${label}](${vscode.Uri.file(file).with({ fragment: `L${line}` })})`;
  const where = (occ) => linkTo(occ.file, occ.node.line, isHere(occ) ? "here" : mdText(path.basename(occ.file)));
  const listed = (occ, exs) => {
    const shown = exs.slice(0, NOTE_HOVER_CAP).map((e) => linkTo(occ.file, e.line, mdText(e.name)));
    if (exs.length > NOTE_HOVER_CAP) shown.push(`… and ${exs.length - NOTE_HOVER_CAP} more`);
    return shown.length ? shown.join(", ") : "_none_";
  };
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  const parts = repo.noteParts(doc.lineAt(position.line).text);
  const ch = position.character;
  const over = (s) => s && ch >= s.startCol && ch <= s.endCol;
  const spanOf = (s) => new vscode.Range(position.line, s.startCol, position.line, s.endCol);
  if (parts && over(parts.count)) {
    const seen = new Set(list.filter(isHere).flatMap((o) => examplesOf(o).map((e) => fold(e.name))));
    md.appendMarkdown(`**${parts.count.n} more ${mdText(concept.name)}** — written elsewhere, and not here\n\n`);
    for (const occ of list) {
      if (isHere(occ)) continue;
      const exs = examplesOf(occ).filter((e) => !seen.has(fold(e.name)));
      for (const e of exs) seen.add(fold(e.name));
      if (exs.length) md.appendMarkdown(`- ${where(occ)} (${exs.length}): ${listed(occ, exs)}\n`);
    }
    return new vscode.Hover(md, spanOf(parts.count));
  }
  const file = parts && parts.files.find(over);
  const named = file && list.find((o) => !isHere(o) && path.basename(o.file).toLowerCase() === file.file.toLowerCase());
  if (named) {
    const exs = examplesOf(named);
    md.appendMarkdown(`**${mdText(concept.name)}** in ${where(named)} — ${exs.length} Example${exs.length === 1 ? "" : "s"}\n\n${listed(named, exs)}`);
    return new vscode.Hover(md, spanOf(file));
  }
  const total = new Set(list.flatMap((o) => examplesOf(o).map((e) => fold(e.name)))).size;
  md.appendMarkdown(`**${mdText(concept.name)}** — ${total} Example${total === 1 ? "" : "s"} across ${list.length} files\n\n`);
  for (const occ of [...list.filter(isHere), ...list.filter((o) => !isHere(o))]) {
    md.appendMarkdown(`- ${where(occ)} (${examplesOf(occ).length}): ${listed(occ, examplesOf(occ))}\n`);
  }
  return new vscode.Hover(md, doc.lineAt(position.line).range);
}

// A node's content, as its Gödel number says it: G as a factorisation, a
// line per attribute with where an inherited one came from, what it
// overrides, and the nearest sibling of its kind and how it differs. The
// numbers come from the whole repository numbered as one, with the registry,
// so they are the ones `verify.js --godel` prints. False when there is
// nothing to say.
function appendContent(md, doc, analysis, node) {
  let profile;
  try {
    const tables = godelPooled(doc, analysis.root, analysis.nodes);
    profile = godel.profile(analysis.root, analysis.nodes, node, tables);
  } catch { return false; }
  if (!profile || (!profile.slots.length && !profile.nearest)) return false;
  const name = (n) => (n.kind === KIND.INDIVIDUAL ? `- ${n.name}` : n.name);
  // how long G is comes from its logarithm: the integer is made only when it
  // is short enough to read, and a longer one is given to three figures
  const whole = !profile.slots.length ? ""
    : profile.digits <= 30 ? ` = ${profile.number}`
      : ` ≈ ${godel.approx(profile.vec)} (${profile.digits.toLocaleString("en-US")} digits)`;
  if (md.value.trim()) md.appendMarkdown("\n\n---\n\n");
  md.appendMarkdown(`**Content** — G = ${profile.factors}${whole}\n\n`);
  for (const s of profile.slots) {
    const value = s.value === "(unvalued)" ? "*(declared, no value)*" : codeSpan(s.value);
    const where = s.own ? ""
      : s.typeDefault ? ` — the default of '${name(s.from)}'${s.fromLine ? ` (line ${s.fromLine})` : ""}`
        : s.from ? ` — from '${name(s.from)}'${s.fromLine ? ` (line ${s.fromLine})` : ""}` : "";
    const through = s.via ? ` — through '${s.via}'` : "";
    md.appendMarkdown(`- \`${s.attr}\`: ${value}${where}${through}\n`);
  }
  for (const o of profile.overrides) {
    md.appendMarkdown(`- overrides \`${o.attr}\`: ${codeSpan(o.replaces)} from '${name(o.from)}' with ${codeSpan(o.value)}\n`);
  }
  const near = profile.nearest;
  if (near) {
    md.appendMarkdown(near.dist === 0
      ? `\nIdentical in content to '${name(near.node)}' (line ${near.node.line}).`
      : `\nNearest sibling: '${name(near.node)}' (line ${near.node.line}), ${near.dist} slot${near.dist === 1 ? "" : "s"} apart — ${near.diff.map(codeSpan).join(", ")}.`);
  }
  return true;
}

const hoverProvider = {
  provideHover(doc, position) {
    // a URL or file path answers (metadata / picture) before anything else
    const link = linkHoverAt(doc, position);
    if (link) return link;
    // inside a Python derivation: the function it calls, or what computed its value
    const py = pythonHover(doc, position);
    if (py) return py;
    const analysis = analysisByDoc.get(doc.uri.toString()) || analyse(doc);
    // a maintained `...` line answers with the whole extension: what this
    // file lists and what every peer lists, each one a place you can go
    const spread = crossFileHover(doc, analysis, position);
    if (spread) return spread;
    // a link to an Example: show the Example itself
    for (const link of analysis.links) {
      if (link.target.kind === KIND.INDIVIDUAL && linkRange(link).contains(position)) {
        return new vscode.Hover(exampleMarkdown(doc, analysis, link.target, false), linkRange(link));
      }
    }
    let concept = null;
    let range = null;
    for (const link of analysis.links) {
      if (link.target.kind !== KIND.INDIVIDUAL && linkRange(link).contains(position)) {
        concept = link.target;
        range = linkRange(link);
        break;
      }
    }
    if (!concept) {
      const node = definingNodeAt(analysis, doc, position);
      if (node && node.kind === KIND.INDIVIDUAL) {
        // an Example's defining name: details plus its usages, and its content
        const md = exampleMarkdown(doc, analysis, node, true);
        appendContent(md, doc, analysis, node);
        return md.value.trim() ? new vscode.Hover(md) : null;
      }
      if (node && node.kind === KIND.CONCEPT) {
        concept = node;
        const raw = doc.lineAt(node.line - 1).text;
        const start = raw.length - raw.trimStart().length;
        range = new vscode.Range(node.line - 1, start, node.line - 1, start + node.name.length);
      }
    }
    if (!concept) return null;
    const found = armstrong.chains(analysis.root, analysis.nodes, concept);
    const md = new vscode.MarkdownString();
    if (found.length) {
      md.appendMarkdown(`**'${concept.name}' dependency chains**\n\n`);
      for (const chain of found) {
        let s = chain.path[0].name;
        for (let i = 1; i < chain.path.length; i++) {
          s += ` ─${chain.via[i - 1]}→ ${chain.path[i].name}`;
        }
        md.appendMarkdown(`- ${s}${chain.cycle ? " ↩ (cycle)" : ""} — ${new Set(chain.path).size} Concepts\n`);
      }
    }
    const hadUsages = appendUsages(md, doc, analysis, concept);
    // its content, when the Concept is this file's own
    const hadContent = analysis.nodes.includes(concept) && appendContent(md, doc, analysis, concept);
    if (!found.length && !hadUsages && !hadContent) return null;
    return new vscode.Hover(md, range);
  },
};

// Find All References (Shift+F12): the declaration plus every crosslink
// that resolves to the Concept or Example under the cursor.
const referenceProvider = {
  provideReferences(doc, position, context) {
    const analysis = analysisByDoc.get(doc.uri.toString()) || analyse(doc);
    let node = null;
    for (const link of analysis.links) {
      if (linkRange(link).contains(position)) { node = link.target; break; }
    }
    if (!node) node = definingNodeAt(analysis, doc, position);
    if (!node) return null;
    const locations = (analysis.usagesOf.get(node) || [])
      .map((link) => new vscode.Location(doc.uri, linkRange(link)));
    if ((!context || context.includeDeclaration) && node.line) {
      const at = Math.min(Math.max(node.line - 1, 0), doc.lineCount - 1);
      locations.unshift(new vscode.Location(doc.uri, doc.lineAt(at).range));
    }
    return locations;
  },
};

// F2 renames a name everywhere it is meant: the declaration — a Concept,
// an Example, an attribute, line-form or a table's header or first-column
// cell — every crosslink that resolves to it, and every `@` reference in a
// derivation or a constraint that resolves to it (python.resolveHost, the
// resolution a run uses), so a rename never leaves Python pointing at
// yesterday's name. An attribute renames with
// its whole scope: the same-named copies its host's Examples carry, and
// the ancestor declaration whose constraint governs it. An attribute
// wearing a renamed Concept's name (the crosslink) follows it, and the
// formulas reading that attribute follow in turn. Spans that resolve by
// another text — an alias, a plural — keep their own spelling. Current
// file only: a reference from another file keeps its name and shows its
// own finding there.
const nameStartOf = (doc, node) => {
  if (node.nameCol !== undefined) return node.nameCol;
  const raw = doc.lineAt(node.line - 1).text;
  const indent = raw.length - raw.trimStart().length;
  return node.kind === KIND.INDIVIDUAL ? indent + 2 : indent; // past '- '
};
const isAttrDecl = (n) => n.kind === KIND.ATTRIBUTE || (n.kind === KIND.DEFAULT && !n.cell);
const isValueCell = (n) => n.kind === KIND.DEFAULT && n.cell; // a cell's value, named by its column
const underConcept = (n, c) => n.parent === c
  || (n.parent && n.parent.kind === KIND.INDIVIDUAL && n.parent.parent === c);

function renameRecords(doc, analysis, registry) {
  const lines = doc.getText().split(/\r?\n/);
  const rootName = docRootName(doc);
  const out = [];
  let hosts;
  try { hosts = python.hostsOf(analysis.nodes, lines, rootName); } catch { return out; }
  const ctx = { lines, registry, rootName, index: pyHostIndex(doc, hosts) };
  // where the source begins on its line: past the '=' (or the operator) and
  // the spaces after it — the resolver counts from there
  const from = (raw, col) => { while (raw[col] === " ") col++; return col; };
  const push = (line, at, r) => {
    for (const n of r.names || []) out.push(Object.assign({}, n, { line, startCol: at + n.start, endCol: at + n.start + n.length }));
  };
  for (const h of hosts) {
    let r;
    try { r = python.resolveHost(h, ctx); } catch { continue; }
    push(h.line, from(lines[h.line - 1] || "", h.startCol + 1), r);
  }
  // a constraint's bound reads the names its declaration's scope holds
  for (const a of analysis.nodes) {
    if (a.kind !== KIND.ATTRIBUTE || !a.constraints) continue;
    const anchor = { kind: KIND.DEFAULT, name: a.name, parent: a.parent, children: [] };
    for (const con of a.constraints) {
      let r;
      try { r = python.resolveHost({ kind: "value", node: anchor, line: a.line, source: con.formula }, ctx); } catch { continue; }
      push(a.line, from(lines[a.line - 1] || "", con.opCol + (con.opText || con.op).length), r);
    }
  }
  return out;
}

// The declared name at `position`: its node and the exact range of the
// name on its line — a Concept, an Example, an attribute, a header or
// first-column cell; never a cell's value.
function declarationAt(doc, position, analysis) {
  for (const node of analysis.nodes) {
    if (node.line - 1 !== position.line || !node.name || isValueCell(node)) continue;
    const start = nameStartOf(doc, node);
    if (position.character >= start && position.character <= start + node.name.length) {
      return { node, range: new vscode.Range(node.line - 1, start, node.line - 1, start + node.name.length) };
    }
  }
  return null;
}

// The node a rename at `position` means, with the exact range under the
// cursor: a crosslink names its target, a declaration itself, a formula
// reference the declaration it resolves to.
function renameContext(doc, position, analysis, registry, records) {
  for (const link of analysis.links) {
    if (!link.file && linkRange(link).contains(position)) return { node: link.target, range: linkRange(link) };
  }
  const decl = declarationAt(doc, position, analysis);
  if (decl) return decl;
  const site = (r) => nodeAtSite(analysis, doc, r.site, r.text);
  for (const r of records) {
    if (r.line - 1 !== position.line || position.character < r.startCol || position.character > r.endCol) continue;
    const node = r.nodes ? r.nodes.find((n) => !isValueCell(n))
      : r.conceptNode ? r.conceptNode.children.concat(...r.conceptNode.children.map((c) => c.children))
        .find((n) => isAttrDecl(n) && n.name.toLowerCase() === r.attrKey)
      : r.kind === "table" ? tableNode(analysis, doc, registry, r)
      : r.site ? site(r) : null;
    if (node) return { node, range: new vscode.Range(r.line - 1, r.startCol, r.line - 1, r.endCol) };
  }
  return null;
}

// The declaring node a walker's `site` (line + name column) points at.
function nodeAtSite(analysis, doc, site, text) {
  if (!site || !site.line) return null;
  return analysis.nodes.find((n) => n.line === site.line && n.name && !isValueCell(n)
    && (site.col === null ? n.name.toLowerCase() === text.toLowerCase() : nameStartOf(doc, n) === site.col)) || null;
}

// The node a table-name reference declares from: a line-form Concept's own
// node, or the Concept/Example/Attribute line a grid sits under.
function tableNode(analysis, doc, registry, r) {
  const sc = registry.scopes.get(r.id);
  if (!sc) return null;
  if (sc.node) return analysis.nodes.includes(sc.node) ? sc.node : null;
  return sc.nameLine ? nodeAtSite(analysis, doc, { line: sc.nameLine, col: null }, r.text) : null;
}

// Every span a rename of `target` edits: `decl` — the declarations the
// name means (the target, an attribute's same-named copies across its
// host's Examples, and the ancestor constraint that governs it by name) —
// and `uses` — the crosslinks and the formula references, exactly as
// evaluation resolves them. One collection, shared by F2 and the ghost
// nudge, so the nudge counts exactly what F2 would edit.
function renameSpans(doc, analysis, registry, records, target) {
  const lower = target.name.toLowerCase();
  const set = new Set([target]);
  // an attribute (line or header cell) or a value cell gathers its
  // same-named copies; a Concept named in a header cell (1.9) renames like
  // any Concept — through its crosslinks — so it stays out of this branch
  if (isAttrDecl(target) || (target.cell && target.kind !== KIND.CONCEPT)) {
    const host = target.parent && target.parent.kind === KIND.INDIVIDUAL ? target.parent.parent : target.parent;
    const owners = host ? [host, ...host.children.filter((c) => c.kind === KIND.INDIVIDUAL)] : [];
    for (const o of owners) for (const c of o.children) {
      if ((isAttrDecl(c) || (c.cell && c.kind === KIND.ATTRIBUTE)) && c.name.toLowerCase() === lower) set.add(c);
    }
    for (let p = target.parent; p; p = p.parent) {
      for (const c of p.children) {
        if (c.kind === KIND.ATTRIBUTE && c.name.toLowerCase() === lower && c.constraints) set.add(c);
      }
    }
  }

  const decl = [], uses = [];
  const seen = new Set();
  const push = (list, line, startCol, endCol) => {
    const key = line + ":" + startCol;
    if (!seen.has(key)) { seen.add(key); list.push({ line, startCol, endCol }); }
  };
  for (const n of set) {
    const start = nameStartOf(doc, n);
    push(decl, n.line, start, start + n.name.length);
  }
  // crosslinks follow — and an attribute wearing the renamed name is
  // renamed with it, so the formulas reading that attribute follow too
  for (const n of [...set]) {
    for (const link of analysis.usagesOf.get(n) || []) {
      const raw = doc.lineAt(link.line - 1).text.slice(link.startCol, link.endCol);
      if (raw.toLowerCase() !== lower) continue; // resolved by alias or plural: its text is its own
      push(uses, link.line, link.startCol, link.endCol);
      const wearer = analysis.nodes.find((nn) => nn.line === link.line && !isValueCell(nn) && nn.name
        && (nn.kind === KIND.ATTRIBUTE || nn.kind === KIND.DEFAULT)
        && nameStartOf(doc, nn) === link.startCol && nn.name.toLowerCase() === lower);
      if (wearer) set.add(wearer);
    }
  }
  // formula references, exactly as evaluation resolves them
  const resolvesToSet = (r) => {
    if (r.nodes) return r.nodes.some((n) => set.has(n));
    if (r.conceptNode) return [...set].some((n) =>
      (n.kind === KIND.ATTRIBUTE || n.kind === KIND.DEFAULT)
      && n.name.toLowerCase() === r.attrKey && underConcept(n, r.conceptNode));
    if (r.kind === "table") { const n = tableNode(analysis, doc, registry, r); return n ? set.has(n) : false; }
    if (r.site) { const n = nodeAtSite(analysis, doc, r.site, r.text); return n ? set.has(n) : false; }
    return false;
  };
  for (const r of records) {
    if (r.text.toLowerCase() !== lower) continue;
    if (!resolvesToSet(r)) continue;
    push(uses, r.line, r.startCol, r.endCol);
  }
  return { decl, uses };
}

// Numbered Examples renumber themselves on save and on Format Document:
// once any Example under a Concept starts `N. `, all of that Concept's
// Examples take the sequential prefix, and every same-file reference to a
// renamed Example — crosslinks, formula references, table name cells —
// follows through the rename engine, the exact spans F2 would edit.
// Returns whole-line rewrites ({ line, text }, 1-based) against the
// document as it stands; the caller folds them in with the align and
// recompute edits (dropping those on lines renumbering rewrites, since a
// renumbered line makes them stale — the next save re-aligns).
function renumberEdits(doc) {
  let analysis;
  try { analysis = linkAnalysis(doc); } catch { return []; }
  const pairs = [];
  for (const c of [analysis.root, ...analysis.nodes]) {
    if (!c || c.kind !== KIND.CONCEPT) continue;
    const changes = derive.renumberExamples(c);
    if (changes) pairs.push(...changes);
  }
  // Concept numbering (`1. ` / `1.1 ` / `1.1.1 `) renames declarations
  // only: resolution strips the prefix (table.numberless), so crosslinks,
  // typed attributes and derivations keep working without a rename cascade.
  const conceptPairs = derive.renumberConcepts(analysis.root, analysis.nodes);
  if (!pairs.length && !conceptPairs.length) return [];
  const registry = formulaRegistry(doc, analysis);
  const records = renameRecords(doc, analysis, registry);
  const byLine = new Map(); // 1-based line -> its spans with replacements
  for (const { node, newName } of pairs) {
    const { decl, uses } = renameSpans(doc, analysis, registry, records, node);
    for (const s of [...decl, ...uses]) {
      const old = doc.lineAt(s.line - 1).text.slice(s.startCol, s.endCol);
      // case follows the span, exactly as F2 renames (renameProvider)
      const text = old === old.toLowerCase() ? newName.toLowerCase() : newName;
      if (old === text) continue;
      if (!byLine.has(s.line)) byLine.set(s.line, []);
      byLine.get(s.line).push({ startCol: s.startCol, endCol: s.endCol, text });
    }
  }
  for (const { node, newName } of conceptPairs) {
    const start = nameStartOf(doc, node);
    if (!byLine.has(node.line)) byLine.set(node.line, []);
    byLine.get(node.line).push({ startCol: start, endCol: start + node.name.length, text: newName });
  }
  const out = [];
  for (const [line, spans] of byLine) {
    let text = doc.lineAt(line - 1).text;
    for (const s of spans.sort((a, b) => b.startCol - a.startCol)) {
      text = text.slice(0, s.startCol) + s.text + text.slice(s.endCol);
    }
    out.push({ line, text });
  }
  return out;
}

// --- a name typed over ------------------------------------------------------------
// Typing over a declared name renames that one declaration, and leaves every
// use of the old name pointing at nothing. So the edit is followed: while the
// cursor stays in the name it is a rename in progress; when it leaves — or the
// file is saved, or another editor takes over — the uses the old name still
// has across the workspace are found (workspaceRenameSpans, against the text
// as it stood before), and one notice offers to update them: one edit, one
// undo, other files left unsaved for review. The offer stays on the
// declaration's lightbulb until it is taken, dismissed, or moot. Undo and
// redo never start one, nor does an edit the extension makes itself or a
// save's own edits.
const typedRenames = new Map(); // uri -> { before, oldName, line, start, length }
const textBefore = new Map();   // uri -> the text before its latest change
const renameOffers = new Map(); // uri -> [{ line, oldName, newName, here, files, count }]
let ownEdits = 0;               // > 0 while the extension applies an edit of its own
const savingDocs = new Set();   // uri while a save's own edits land

// A name a rename may be typed over: a Concept, an Example, an attribute
// declaration (a line, or a header cell) — never a cell's value.
const typedRenameable = (n) => n.name && !isValueCell(n)
  && (n.kind === KIND.CONCEPT || n.kind === KIND.INDIVIDUAL || n.kind === KIND.ATTRIBUTE || isAttrDecl(n));

function trackTypedRename(event) {
  const doc = event.document;
  if (doc.languageId !== "aot") return;
  const key = doc.uri.toString();
  const before = textBefore.get(key);
  textBefore.set(key, doc.getText());
  const session = typedRenames.get(key);
  if (ownEdits > 0 || savingDocs.has(key) || before === undefined) {
    if (session) typedRenames.delete(key);
    return;
  }
  const c = event.contentChanges.length === 1 ? event.contentChanges[0] : null;
  const single = !!c && c.range.start.line === c.range.end.line && !/[\r\n]/.test(c.text);
  if (session) {
    // inside the name being typed, the rename goes on
    if (single && c.range.start.line === session.line && c.range.start.character >= session.start
      && c.range.end.character <= session.start + session.length) {
      session.length += c.text.length - (c.range.end.character - c.range.start.character);
      return;
    }
    closeTypedRename(doc); // an edit anywhere else ends it
  }
  // undo and redo bring names back, they do not rename
  const undoing = event.reason === 1 || event.reason === 2;
  const active = vscode.window.activeTextEditor;
  if (!single || undoing || !active || active.document !== doc) return;
  let parsed;
  try { parsed = lint(before, docRootName(doc)); } catch { return; }
  const pre = textDoc(doc.fileName, before);
  for (const node of parsed.nodes) {
    if (node.line - 1 !== c.range.start.line || !typedRenameable(node)) continue;
    const start = nameStartOf(pre, node);
    if (c.range.start.character < start || c.range.end.character > start + node.name.length) continue;
    typedRenames.set(key, {
      before, oldName: node.name, line: c.range.start.line, start,
      length: node.name.length + c.text.length - (c.range.end.character - c.range.start.character),
    });
    return;
  }
}

// The cursor left the name, the file saved, or another editor took over:
// the rename is done, and its uses are counted.
function closeTypedRename(doc) {
  const key = doc.uri.toString();
  const s = typedRenames.get(key);
  if (!s) return null;
  typedRenames.delete(key);
  let now;
  try { now = lint(doc.getText(), docRootName(doc)); } catch { return null; }
  // the name now standing where the old one stood — a different name, not
  // just a different case (names resolve case-insensitively)
  const node = now.nodes.find((n) => n.line - 1 === s.line && typedRenameable(n) && nameStartOf(doc, n) === s.start);
  if (!node || node.name.toLowerCase() === s.oldName.toLowerCase()) return null;
  return offerTypedRename(doc, s, node, now);
}

async function offerTypedRename(doc, s, renamed, now) {
  const key = doc.uri.toString();
  let analysis, target;
  try {
    analysis = textAnalysis(doc.fileName, s.before);
    const pre = textDoc(doc.fileName, s.before);
    target = analysis.nodes.find((n) => n.line - 1 === s.line && n.name === s.oldName && nameStartOf(pre, n) === s.start);
  } catch { return null; }
  if (!target) return null;
  const found = workspaceRenameSpans(doc, analysis, s.before, target);
  // the declaration typed over is done; every other span is on a line the
  // typing did not touch, but for those after the name on its own line
  const delta = renamed.name.length - s.oldName.length;
  const here = found.here
    .filter((x) => !(x.line - 1 === s.line && x.startCol === s.start))
    .map((x) => (x.line - 1 === s.line && x.startCol > s.start ? { ...x, startCol: x.startCol + delta, endCol: x.endCol + delta } : x));
  const { count } = renameEdit(doc, here, found.files, s.oldName, renamed.name);
  if (!count) return null;
  const offer = { line: s.line, oldName: s.oldName, newName: renamed.name, here, files: found.files, count };
  renameOffers.set(key, [...(renameOffers.get(key) || []).filter((o) => o.line !== s.line), offer]);
  const inFiles = found.files.map((f) => `${f.spans.length} in ${path.basename(f.fsPath)}`);
  const where = here.length && inFiles.length ? ` — ${[`${here.length} here`, ...inFiles].join(", ")}` : inFiles.length ? ` — ${inFiles.join(", ")}` : "";
  // a name that already names another of its kind: the update would make the two one
  const lower = renamed.name.toLowerCase();
  const twin = now.nodes.find((n) => n !== renamed && n.kind === renamed.kind && n.name && n.name.toLowerCase() === lower
    && (renamed.kind === KIND.CONCEPT || n.parent === renamed.parent));
  const merge = twin ? `; '${renamed.name}' already names another ${renamed.kind === KIND.CONCEPT ? "Concept" : renamed.kind === KIND.INDIVIDUAL ? "Example" : "attribute"} (line ${twin.line}), so updating them would merge the two into it` : "";
  const update = `Update ${count} Use${count === 1 ? "" : "s"}`;
  const answer = await vscode.window.showWarningMessage(
    `AOT: '${s.oldName}' is now '${renamed.name}' — ${count} use${count === 1 ? " still says" : "s still say"} '${s.oldName}'${where}${merge}.`,
    ...(twin ? ["Dismiss", update] : [update, "Dismiss"]));
  if (answer === update) await applyTypedRename(key, s.line);
  else if (answer === "Dismiss") dropRenameOffer(key, s.line);
  return answer;
}

function dropRenameOffer(key, line) {
  const left = (renameOffers.get(key) || []).filter((o) => o.line !== line);
  if (left.length) renameOffers.set(key, left); else renameOffers.delete(key);
}

// AOT: the offer taken — from the notice or the lightbulb. Only spans that
// still say the old name are edited; one undo takes it all back.
async function applyTypedRename(key, line) {
  const offer = (renameOffers.get(key) || []).find((o) => o.line === line);
  dropRenameOffer(key, line);
  if (!offer) return false;
  const doc = (vscode.workspace.textDocuments || []).find((d) => d.uri.toString() === key)
    || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.toString() === key ? vscode.window.activeTextEditor.document : null);
  if (!doc) return false;
  const { edit, count } = renameEdit(doc, offer.here, offer.files, offer.oldName, offer.newName);
  if (!count) return false;
  ownEdits++;
  try { await vscode.workspace.applyEdit(edit); } finally { ownEdits--; }
  return true;
}

// A text read as a document — what renameSpans and renameRecords read off
// one: its lines, its file name, a uri. For a file no editor has open, and
// for a file's text as it stood before a name was typed over. No version:
// nothing caches a parse of it.
function textDoc(fsPath, text) {
  const lines = String(text).split(/\r?\n/);
  return {
    fileName: fsPath, languageId: "aot", uri: vscode.Uri.file(fsPath),
    lineCount: lines.length,
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ text: lines[i] || "", range: new vscode.Range(i, 0, i, (lines[i] || "").length) }),
  };
}

// The tree and its crosslinks for a text, read against every other indexed
// file — and, when `swapIn` is given ({ file, root, nodes }), against that
// file read as `swapIn` has it rather than as the index does.
function textAnalysis(fsPath, text, swapIn) {
  const { root, nodes } = lint(text, path.basename(fsPath).replace(/\.[^.]*$/, ""));
  const here = fileKey(fsPath);
  const entries = [];
  for (const [key, v] of workspaceIndex) {
    if (key === here) continue;
    if (swapIn && key === fileKey(swapIn.file)) entries.push(swapIn);
    else entries.push({ file: v.fsPath, root: v.root, nodes: v.nodes });
  }
  const links = resolve(text, root, nodes, externalIndex(entries));
  const usagesOf = new Map();
  for (const l of links) {
    if (!usagesOf.has(l.target)) usagesOf.set(l.target, []);
    usagesOf.get(l.target).push(l);
  }
  return { root, nodes, links, usagesOf };
}

// One rename, the whole workspace: every span a rename of `target` edits —
// shared by F2 and by the offer that follows a name typed over by hand.
//
//   this file    renameSpans: the declarations the name means, and every
//                crosslink and `@` reference resolving to them;
//   peer files   a Concept written there too — one idea in two places — its
//                declaration and its own uses there;
//   other files  every crosslink and `@` reference resolving to `target`.
//
// `analysis` is the tree `target` is a node of, read over `text` — this
// file as it reads now (F2), or as it read before a name was typed over
// (the offer), which is what every other file still resolves against. A
// span is found only where it says the old name (an alias or a plural keeps
// its own words). Answers { here: [span], files: [{ fsPath, spans }] },
// spans { line, startCol, endCol } with 1-based lines on the text read.
function workspaceRenameSpans(doc, analysis, text, target) {
  const lower = target.name.toLowerCase();
  const hereDoc = textDoc(doc.fileName, text);
  const registry = formulaRegistry(hereDoc, { root: analysis.root, nodes: analysis.nodes });
  const { decl, uses } = renameSpans(hereDoc, analysis, registry, renameRecords(hereDoc, analysis, registry), target);
  const files = [];
  if (!underWorkspace(doc) || (target.kind !== KIND.CONCEPT && target.kind !== KIND.INDIVIDUAL)) {
    return { here: [...decl, ...uses], files };
  }
  const mine = { file: doc.fileName, root: analysis.root, nodes: analysis.nodes };
  const swap = { key: fileKey(doc.fileName), concepts: derive.conceptRegistry(analysis.root, analysis.nodes) };
  const fold = (name) => table.numberless(name).trim().toLowerCase();
  for (const [key, entry] of workspaceIndex) {
    if (key === swap.key || entry.text === undefined) continue;
    let other;
    try { other = textAnalysis(entry.fsPath, entry.text, mine); } catch { continue; }
    const otherDoc = textDoc(entry.fsPath, entry.text);
    const otherRegistry = formulaRegistry(otherDoc, { root: other.root, nodes: other.nodes }, swap);
    const records = renameRecords(otherDoc, other, otherRegistry);
    const spans = [];
    const seen = new Set();
    const push = (s) => {
      const k = `${s.line}:${s.startCol}`;
      if (!seen.has(k)) { seen.add(k); spans.push({ line: s.line, startCol: s.startCol, endCol: s.endCol }); }
    };
    if (target.kind === KIND.CONCEPT) {
      for (const peer of other.nodes) {
        if (peer.kind !== KIND.CONCEPT || fold(peer.name) !== fold(target.name)) continue;
        const s = renameSpans(otherDoc, other, otherRegistry, records, peer);
        for (const x of [...s.decl, ...s.uses]) {
          if (otherDoc.lineAt(x.line - 1).text.slice(x.startCol, x.endCol).toLowerCase() === lower) push(x);
        }
      }
    }
    // a reference to it — or to any file's spelling of the same idea,
    // whichever the workspace index resolved the name to: a Concept is one
    // idea in every file that writes it (repo.js), and an Example of one
    // name under it is one individual
    const conceptAbove = (n) => { for (let p = n.parent; p; p = p.parent) if (p.kind === KIND.CONCEPT) return p; return null; };
    const sameIdea = (n) => {
      if (n === target) return true;
      if (!n || n.kind !== target.kind || fold(n.name) !== fold(target.name)) return false;
      if (target.kind === KIND.CONCEPT) return true;
      const a = conceptAbove(n), b = conceptAbove(target);
      return !!a && !!b && fold(a.name) === fold(b.name);
    };
    for (const l of other.links) {
      if (sameIdea(l.target) && otherDoc.lineAt(l.line - 1).text.slice(l.startCol, l.endCol).toLowerCase() === lower) push(l);
    }
    for (const r of records) {
      if (String(r.text).toLowerCase() !== lower) continue;
      const scope = r.kind === "table" && r.id ? otherRegistry.scopes.get(r.id) : null;
      if ((scope && sameIdea(scope.node)) || (r.nodes && r.nodes.some(sameIdea))) push(r);
    }
    if (spans.length) files.push({ fsPath: entry.fsPath, spans });
  }
  return { here: [...decl, ...uses], files };
}

// The text a rename edits in another file: its open buffer, else the disk.
function liveTextOf(fsPath) {
  const open = (vscode.workspace.textDocuments || []).find((d) => d.fileName && fileKey(d.fileName) === fileKey(fsPath));
  if (open) return open.getText();
  try { return fs.readFileSync(fsPath, "utf8"); } catch { return null; }
}

// Case follows the span, not the typist: Concepts are capitalised and
// attributes lowercase by convention, and every link resolves
// case-insensitively — so a span that is all lowercase today (an attribute
// name, its alias, a lowercase reference) takes the new name lowercased, and
// every other span takes it exactly as typed.
const renamedAs = (old, name) => (old === old.toLowerCase() ? name.toLowerCase() : name);

// The edit renaming `oldName` to `newName` over spans found by
// workspaceRenameSpans — this file's on `doc` as it reads now, the rest on
// each file's live text. A span that no longer says the old name is passed
// over. Answers { edit, count }.
function renameEdit(doc, here, files, oldName, newName) {
  const edit = new vscode.WorkspaceEdit();
  let count = 0;
  const lower = oldName.toLowerCase();
  const add = (uri, lineText, s) => {
    const old = String(lineText || "").slice(s.startCol, s.endCol);
    if (old.toLowerCase() !== lower) return;
    edit.replace(uri, new vscode.Range(s.line - 1, s.startCol, s.line - 1, s.endCol), renamedAs(old, newName));
    count++;
  };
  for (const s of here) add(doc.uri, s.line - 1 < doc.lineCount ? doc.lineAt(s.line - 1).text : "", s);
  for (const f of files) {
    const text = liveTextOf(f.fsPath);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (const s of f.spans) add(vscode.Uri.file(f.fsPath), lines[s.line - 1], s);
  }
  return { edit, count };
}

const renameProvider = {
  prepareRename(doc, position) {
    const analysis = analysisByDoc.get(doc.uri.toString()) || analyse(doc);
    const registry = formulaRegistry(doc, analysis);
    const found = renameContext(doc, position, analysis, registry, renameRecords(doc, analysis, registry));
    if (!found || !found.node.line) throw new Error("nothing renameable here — put the cursor on a Concept, Example or attribute name");
    return { range: found.range, placeholder: found.node.name };
  },
  provideRenameEdits(doc, position, newName) {
    const name = newName.trim();
    if (!name || /[@|:()=`\\]/.test(name) || name.startsWith("-")) {
      throw new Error("a name cannot be empty, start with '-', or hold @ | : ( ) = ` \\");
    }
    const analysis = currentAnalysis(doc) || linkAnalysis(doc);
    const registry = formulaRegistry(doc, analysis);
    const records = renameRecords(doc, analysis, registry);
    const found = renameContext(doc, position, analysis, registry, records);
    if (!found || !found.node.line) throw new Error("nothing renameable here — put the cursor on a Concept, Example or attribute name");
    // the whole workspace: a Concept's peers in other files, and every
    // reference to it there; other files are edited and left unsaved
    const { here, files } = workspaceRenameSpans(doc, analysis, doc.getText(), found.node);
    return renameEdit(doc, here, files, found.node.name, name).edit;
  },
};

// A note in faint ghost text at the end of the cursor's line. Standing in a
// declared name that is used elsewhere says how many uses it has: type over
// it, and once the cursor leaves the name the extension offers to update
// them (a name typed over). Standing in a usage — an attribute wearing a
// Concept's name, a value naming an Example — names what it points at, and
// that typing over it changes just this one reference. It reuses the
// rename's own span collection for this file, so the count is what a rename
// edits here; a name nothing uses shows nothing. Read off the analysis of
// the text as it is now, never an older one whose lines have moved; cached
// per cursor-name and document version, so resting costs one walk.
let renameHintType = null; // created on activation
let renameHintLast = null; // { key, count } for the name the cursor is in
function renameHint(editor) {
  if (!renameHintType) return;
  const doc = editor.document;
  const sel = editor.selections && editor.selections.length === 1 ? editor.selections[0] : null;
  const clear = () => editor.setDecorations(renameHintType, []);
  if (!sel || !sel.active) return clear();
  const analysis = currentAnalysis(doc) || linkAnalysis(doc);
  // a usage first, exactly as F2 reads the cursor (renameContext)
  const link = analysis.links.find((l) => !l.file && l.target.line && linkRange(l).contains(sel.active));
  const found = link ? { node: link.target, usage: true } : declarationAt(doc, sel.active, analysis);
  if (!found || !found.node.line) return clear();
  const key = `${doc.uri.toString()}:${doc.version}:${found.usage ? "u" : "d"}:${found.node.line}:${found.node.name}`;
  if (!renameHintLast || renameHintLast.key !== key) {
    const registry = formulaRegistry(doc, analysis);
    const { uses } = renameSpans(doc, analysis, registry, renameRecords(doc, analysis, registry), found.node);
    renameHintLast = { key, count: uses.length };
  }
  const n = renameHintLast.count;
  if (!n) return clear();
  const text = found.usage
    ? `names '${found.node.name}' — typing changes just this one`
    : `${n} use${n === 1 ? "" : "s"} elsewhere`;
  const end = doc.lineAt(sel.active.line).range.end;
  editor.setDecorations(renameHintType, [{
    range: new vscode.Range(end.line, end.character, end.line, end.character),
    renderOptions: { after: { contentText: text } },
  }]);
}

// Dependency chains in small print: an inlay hint at the end of every line
// that carries a dependency-forming crosslink shows where the link's
// Concept leads onward — `→Address` on a `person` crosslink when Person
// rests on Address — in the editor's native faint inline style. The linked
// Concept itself is left out: the line already names it. One hint per line,
// at most MAX_HOPS Concepts, `…` when the chain runs on; the full chains
// stay on hover. Off with aot.chainHints.
const chainHintsChanged = new vscode.EventEmitter();
const MAX_HOPS = 3;
const inlayProvider = {
  onDidChangeInlayHints: chainHintsChanged.event,
  provideInlayHints(doc, range) {
    // how each Python derivation last ran, at the end of its line
    let py = [];
    try { py = pythonInlays(doc, range); } catch { /* a chain hint still shows */ }
    if (!vscode.workspace.getConfiguration("aot").get("chainHints", true)) return py;
    const analysis = analysisByDoc.get(doc.uri.toString());
    if (!analysis) return py;
    const chainCache = new Map();
    const chainsOf = (concept) => {
      if (!chainCache.has(concept)) {
        chainCache.set(concept, armstrong.chains(analysis.root, analysis.nodes, concept));
      }
      return chainCache.get(concept);
    };
    const hinted = new Set();
    const out = [];
    for (const link of analysis.links) {
      // only an attribute typed by a Concept *depends* on it — a Concept
      // crosslinking another (contained name, alias) names a kind and
      // inherits nothing, so no dependency arrow rides those lines
      if (link.connection !== "attribute-is-a-Concept") continue;
      const line = link.line - 1;
      if (line < range.start.line || line > range.end.line || hinted.has(line)) continue;
      if (line >= doc.lineCount) continue;
      const start = link.target;
      if (!start) continue;
      const found = chainsOf(start);
      if (!found.length) continue;
      const path = found[0].path;
      const shown = path.slice(1, 1 + MAX_HOPS);
      const label = "→" + shown.map((n) => n.name).join("→") + (path.length > 1 + shown.length ? "…" : "");
      const hint = new vscode.InlayHint(doc.lineAt(line).range.end, label);
      hint.paddingLeft = true;
      hint.tooltip = "dependency chain — hover the link for all chains";
      out.push(hint);
      hinted.add(line);
    }
    return out.concat(py);
  },
};

// The lightbulb on a spelling hint or an appears-plural warning accepts the
// word: it joins aot.acceptedWords in the user settings, the spelling hints
// skip it and a Concept ending in it is no longer read as plural. The word
// is read back out of the message (both formats are this extension's own).
const ACCEPT_SPELLING = /^'(.+)' is not in the dictionary/;
const ACCEPT_PLURAL = /^Concept '(.+)' appears plural/;
// A spelling hint also offers to *apply* a correction. The candidates are
// not in the message: computing them is the expensive half of spelling
// (spelling.js), so they are fetched for the one word the lightbulb is open
// on, off the typing path. With a single candidate the fix is preferred, so
// Auto Fix / Ctrl+. Enter applies it in one stroke.
// the lightbulb on an unlisted value lists it as an Example of the Concept
// that types its attribute; both names are read back out of the message,
// which is this extension's own (crosslinks.unlistedValues)
const UNLISTED_VALUE = /^'(.+)' is not an Example of Concept '(.+)' —/;
// the lightbulb on a synonym warning records that the two names are two
// ideas, not one, and the pair is never raised again (src/synonyms.js)
const SYNONYM_PAIR = /^'(.+?)' and '(.+?)' \((?:line \d+|[^)]+)\) are (?:two words for one idea|one word with two endings)/;
// the same two ways out for one content under two names in two files
// (godel.twins): rename one to the other, or keep them apart
const TWIN_PAIR = /^'(.+?)' and '(.+?)' \([^)]+\) carry exactly the same attributes and values/;
// a value every child states belongs on the parent, and a default no child
// keeps comes off (godel.hoists, derive.hoistOps)
const HOIST = /^every child of '(.+?)' sets '(.+?): (.*?)' \(lines [\d, ]+\)/;
const DEAD_DEFAULT = /^'(.+?)' sets '(.+?): (.*?)' but every child overrides it/;
// The repo-wide findings (src/repo.js). Everything a shared Concept can be
// made to agree on is already agreed by the time these show — save does it —
// so each lightbulb here offers the decision a tool may not take for you:
// which of two values is the right one, and whether two ideas that collided
// on a word are really the same idea at all.
const REPO_VALUE_CLASH = /^'(.+?)' sets '(.+?)' to '(.+?)' here but '(.+?)' in /;
const REPO_GENUS_CLASH = /^'(.+?)' is filed under '.+?' here but '.+?' in /;
const REPO_STALE_NOTE = /^'.+?' (lists \d+ of its Examples here and the rest live elsewhere|keeps a '\.\.\.' note saying where the rest of its Examples live)/;
const codeActionProvider = {
  provideCodeActions(doc, range, context) {
    const actions = [];
    // a name typed over whose uses still say the old one: the offer the
    // notice made, kept on the declaration until taken, dismissed or moot
    for (const offer of renameOffers.get(doc.uri.toString()) || []) {
      if (offer.line !== range.start.line) continue;
      const fix = new vscode.CodeAction(`Update ${offer.count} use${offer.count === 1 ? "" : "s"} of '${offer.oldName}' to '${offer.newName}'`, vscode.CodeActionKind.QuickFix);
      fix.command = { command: "aot.applyTypedRename", title: fix.title, arguments: [doc.uri.toString(), offer.line] };
      actions.push(fix);
    }
    for (const diagnostic of context.diagnostics || []) {
      if (diagnostic.source !== "aot") continue;
      const misspelt = ACCEPT_SPELLING.exec(diagnostic.message);
      if (!misspelt) continue;
      const words = spelling.suggestionsFor(misspelt[1]);
      words.forEach((word) => {
        const fix = new vscode.CodeAction(`Replace with '${word}'`, vscode.CodeActionKind.QuickFix);
        fix.diagnostics = [diagnostic];
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(doc.uri, diagnostic.range, word);
        fix.isPreferred = words.length === 1;
        actions.push(fix);
      });
    }
    for (const diagnostic of context.diagnostics || []) {
      if (diagnostic.source !== "aot") continue;
      const spelt = ACCEPT_SPELLING.exec(diagnostic.message);
      const plural = ACCEPT_PLURAL.exec(diagnostic.message);
      // a plural finding is about the Concept's last word, which carries the number
      const word = spelt ? spelt[1] : plural ? plural[1].split(/\s+/).pop() : null;
      if (!word) continue;
      const action = new vscode.CodeAction(
        `Accept '${word}' (add to aot.acceptedWords)`, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.command = { command: "aot.acceptWord", title: `Accept '${word}'`, arguments: [word] };
      actions.push(action);
    }
    for (const diagnostic of context.diagnostics || []) {
      if (diagnostic.source !== "aot") continue;
      const unlisted = UNLISTED_VALUE.exec(diagnostic.message);
      if (!unlisted) continue;
      const [, value, concept] = unlisted;
      const action = new vscode.CodeAction(
        `Add '${value}' as an Example of '${concept}'`, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.command = {
        command: "aot.addExample",
        title: `Add '${value}' as an Example of '${concept}'`,
        arguments: [value, concept],
      };
      actions.push(action);
    }
    for (const diagnostic of context.diagnostics || []) {
      if (diagnostic.source !== "aot") continue;
      const pair = SYNONYM_PAIR.exec(diagnostic.message) || TWIN_PAIR.exec(diagnostic.message);
      if (!pair) continue;
      const [, mine, other] = pair;
      // the two ways out. Renaming is the usual one, so it comes first and is
      // preferred; declaring them distinct is the dismissal, and it is
      // remembered rather than repeated.
      const rename = new vscode.CodeAction(
        `Rename '${mine}' to '${other}'`, vscode.CodeActionKind.QuickFix);
      rename.diagnostics = [diagnostic];
      rename.isPreferred = true;
      rename.command = {
        command: "aot.renameConcept",
        title: `Rename '${mine}' to '${other}'`,
        arguments: [mine, other],
      };
      actions.push(rename);
      const distinct = new vscode.CodeAction(
        `Keep '${mine}' and '${other}' as different ideas (add to aot.distinctConcepts)`,
        vscode.CodeActionKind.QuickFix);
      distinct.diagnostics = [diagnostic];
      distinct.command = {
        command: "aot.acceptDistinct",
        title: `Keep '${mine}' and '${other}' apart`,
        arguments: [mine, other],
      };
      actions.push(distinct);
    }
    for (const diagnostic of context.diagnostics || []) {
      if (diagnostic.source !== "aot") continue;
      const hoist = HOIST.exec(diagnostic.message);
      const dead = hoist ? null : DEAD_DEFAULT.exec(diagnostic.message);
      if (!hoist && !dead) continue;
      // the finding names its parent by name; the parent's line is read back
      // off the same finding, found again on the line the squiggle stands on
      let found = null;
      try {
        const { root, nodes } = parsedDoc(doc);
        found = godel.hoists(root, nodes).find((h) => h.line === diagnostic.range.start.line + 1
          && h.kind === (hoist ? "hoist" : "dead") && h.attr === (hoist || dead)[2]);
      } catch { /* an unparseable document offers nothing */ }
      if (!found) continue;
      const parentLine = found.parent.line;
      const title = hoist ? `Move '${found.attr}: ${found.value}' up to '${hoist[1]}'` : `Keep just '${found.attr}'`;
      const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.isPreferred = !!hoist;
      action.command = {
        command: "aot.hoistValue", title,
        arguments: [parentLine, found.attr, hoist ? found.value : "", hoist ? "hoist" : "bare"],
      };
      actions.push(action);
    }
    for (const diagnostic of context.diagnostics || []) {
      if (diagnostic.source !== "aot") continue;
      const clash = REPO_VALUE_CLASH.exec(diagnostic.message);
      if (clash) {
        const [, concept, attr, ours, theirs] = clash;
        // one action per candidate, this file's own first: the value you are
        // looking at is the likelier keeper, and picking either settles it
        // for every file at once
        for (const value of [ours, theirs]) {
          const action = new vscode.CodeAction(
            `Set '${attr}' to '${value}' everywhere`, vscode.CodeActionKind.QuickFix);
          action.diagnostics = [diagnostic];
          action.command = {
            command: "aot.setValueEverywhere",
            title: `Set '${attr}' to '${value}' everywhere`,
            arguments: [concept, attr, value],
          };
          actions.push(action);
        }
        continue;
      }
      const genus = REPO_GENUS_CLASH.exec(diagnostic.message);
      if (genus) {
        const action = new vscode.CodeAction(
          `Qualify this '${genus[1]}' (rename, so the two names stop colliding)`,
          vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.command = { command: "editor.action.rename", title: `Rename '${genus[1]}'` };
        actions.push(action);
        continue;
      }
      if (REPO_STALE_NOTE.test(diagnostic.message)) {
        const action = new vscode.CodeAction(
          "Reconcile Concepts across files", vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.command = {
          command: "aot.reconcileAcrossFiles", title: "Reconcile Concepts across files",
        };
        actions.push(action);
      }
    }
    // a file-path value pointing outside the repo's own file store offers to
    // bring the file in, so the model carries what it cites
    const cursor = range && range.start;
    if (cursor) {
      const link = fileLinkAt(doc, cursor);
      if (link && !isInside(aotFilesDir(doc), link.fsPath)) {
        const action = new vscode.CodeAction(
          `Copy '${path.basename(link.fsPath)}' into aot.files`, vscode.CodeActionKind.QuickFix);
        action.command = { command: "aot.copyFileIntoRepo", title: "Copy into aot.files" };
        actions.push(action);
      }
    }
    // a derivation under the cursor offers the copy-down: onto the same
    // column's other rows (table), or the same attribute of every sibling
    // Example (line form)
    const at = range && range.start;
    const lineText = at && at.line < doc.lineCount ? doc.lineAt(at.line).text : "";
    if (table.isRowText(lineText)) {
      const cs = table.cells(lineText);
      const cell = cs.find((c) => at.character >= c.col && at.character <= c.col + Math.max(c.text.length, 1));
      if (cell && table.splitCell(cell.text).eq !== -1) {
        const down = new vscode.CodeAction("Copy formula down the column", vscode.CodeActionKind.QuickFix);
        down.command = { command: "aot.table.copyFormulaDown", title: "Copy formula down the column" };
        actions.push(down);
        const across = new vscode.CodeAction("Copy formula across the row", vscode.CodeActionKind.QuickFix);
        across.command = { command: "aot.table.copyFormulaAcross", title: "Copy formula across the row" };
        actions.push(across);
        // every row derives this column the same way: the derivation is the
        // column's definition, and belongs on its header
        const block = table.blockAt(doc.getText().split(/\r?\n/), at.line);
        const def = block && table.columnDefinition(block, cs.indexOf(cell));
        if (def) {
          const title = `Define '${def.name}' for the whole column (${def.name} =${def.source})`;
          const define = new vscode.CodeAction(title, vscode.CodeActionKind.RefactorRewrite);
          define.command = { command: "aot.table.defineColumn", title };
          actions.push(define);
        }
      }
    } else {
      const colon = lineText.indexOf(":");
      if (colon !== -1 && table.splitCell(lineText.slice(colon + 1).trim()).eq !== -1) {
        const action = new vscode.CodeAction("Copy formula to all sibling Examples", vscode.CodeActionKind.QuickFix);
        action.command = { command: "aot.copyFormulaToSiblings", title: "Copy formula to all sibling Examples" };
        actions.push(action);
      }
    }
    // No flip here: offered on every line of every Concept with Examples, it
    // lit the lightbulb everywhere. The flip lives on its keys (Ctrl+Alt+T,
    // Ctrl+K T), the right-click menu and the Command Palette.
    // a Python derivation: run it, stub what it calls, or move it out
    try { actions.push(...pythonActions(doc, range)); } catch { /* none offered */ }
    return actions;
  },
};

// AOT: Add Example — the lightbulb on an unlisted value. `value` joins the
// Concept named by `conceptName` as an Example, in whichever form that
// Concept is already written: a row on its table, or a `- value` line under
// its last Example. The cursor lands on the new Example so the writer can
// carry straight on filling it in — the point of the fix is to get the idea
// into the model, not to leave them hunting for where it went.
async function addExample(value, conceptName) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "aot") return;
  const doc = editor.document;
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const { root, nodes } = lint(doc.getText(), rootName);
  const key = conceptName.toLowerCase();
  const concept = [root, ...nodes].find((n) => n && n.kind === KIND.CONCEPT
    && (n.name.toLowerCase() === key || (n.alias && n.alias.toLowerCase() === key)));
  if (!concept) {
    vscode.window.showWarningMessage(`AOT: this file no longer defines the Concept '${conceptName}'.`);
    return;
  }
  const lines = doc.getText().split(/\r?\n/);
  const edit = derive.addExample(
    root, nodes, lines, concept, value, rootName, formulaRegistry(doc, { root, nodes }));
  if (!edit) {
    vscode.window.showWarningMessage(`AOT: could not find where to list '${value}' under '${conceptName}'.`);
    return;
  }
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const { from, to, block } = edit;
  await editor.edit((b) => {
    if (to < from) {
      // a pure insert: on the line below `from - 1`, or appended when the
      // Concept's last Example ends the file
      if (from >= doc.lineCount) {
        const last = doc.lineCount - 1;
        b.insert(new vscode.Position(last, doc.lineAt(last).text.length), eol + block.join(eol));
      } else {
        b.insert(new vscode.Position(from, 0), block.join(eol) + eol);
      }
    } else {
      b.replace(new vscode.Range(from, 0, to, doc.lineAt(to).text.length), block.join(eol));
    }
  });
  // the cursor stays on the value the Fix was invoked from — the editor
  // carries the selection through the edit — because the user is
  // mid-thought at the usage, not at the Concept; the hint clearing is the
  // confirmation, and the status bar names the line the Example landed on
  // for when they want to go build on it
  const at = to < from ? Math.min(from, doc.lineCount - 1) : from + block.length - 1;
  vscode.window.setStatusBarMessage(
    `AOT: '${value}' listed as an Example of '${concept.name}' (line ${at + 1})`, 5000);
}

// --- reconciling a Concept across files -------------------------------------
// A Concept in two files is one idea seen twice, so the two are held to one
// definition and the editor closes the gap for you rather than reporting it:
// on save, an attribute a peer declares and this file does not have in force
// is written in, and the `...` line saying how many Examples live elsewhere
// is kept true. Nothing you wrote is ever deleted and no peer's file is ever
// touched — saving a file reconciles that file. The disagreements no tool may
// settle (one attribute with two values, one Concept under two kinds) stay
// put, as errors with their own lightbulbs. See src/repo.js.

// repo ops as edits on `doc`. An insert lands at the start of the line below
// its anchor, a delete takes the whole line with it, so applying these and
// applying them through repo.applyOps come to the same text.
function opsToTextEdits(doc, ops) {
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const out = [];
  for (const op of ops) {
    if (op.type === "block") {
      out.push(vscode.TextEdit.replace(
        new vscode.Range(op.from, 0, op.to, doc.lineAt(op.to).text.length), op.block.join(eol)));
    } else if (op.type === "replace") {
      out.push(vscode.TextEdit.replace(doc.lineAt(op.line - 1).range, op.text));
    } else if (op.type === "delete") {
      const at = op.line - 1;
      out.push(vscode.TextEdit.delete(at + 1 < doc.lineCount
        ? new vscode.Range(at, 0, at + 1, 0)
        : new vscode.Range(at > 0 ? at - 1 : at, at > 0 ? doc.lineAt(at - 1).text.length : 0,
          at, doc.lineAt(at).text.length)));
    } else if (op.afterLine >= doc.lineCount) {
      const last = doc.lineCount - 1;
      out.push(vscode.TextEdit.insert(
        new vscode.Position(last, doc.lineAt(last).text.length), eol + op.text));
    } else {
      out.push(vscode.TextEdit.insert(new vscode.Position(op.afterLine, 0), op.text + eol));
    }
  }
  return out;
}

// AOT: Set Up Git Merge for .aot Files. git merges an .aot by meaning with
// verify.js as its merge driver: `*.aot merge=aot` and the stable Gödel
// numbers merged by union go into .gitattributes (committed, so the
// repository says how its files merge), and the driver itself — a program
// on this machine — into the repository's local git config, which is never
// committed. Nothing is set up without this command.
const GIT_ATTRIBUTES = ["*.aot merge=aot", "aot.files/godel.tsv merge=union"];
const verifyScript = () => path.join(__dirname, "..", "verify.js");
const mergeDriver = () => `node "${verifyScript().split(path.sep).join("/")}" --merge %O %A %B %P`;
// git is started by the absolute path PATH's own entries give it, never by
// its bare name with a repository as the working directory — where Windows
// would run a git.exe the repository itself planted (the README's rule for
// python and uv). No git on PATH is an error the caller reports.
const defaultGitRun = (root, args) => {
  const git = python.resolveExecutable("git");
  if (!git) throw new Error("git was not found on PATH");
  return childProcess.execFileSync(git, args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
};
let gitRun = defaultGitRun;

async function setUpGitMerge() {
  const editor = vscode.window.activeTextEditor;
  const folders = vscode.workspace.workspaceFolders || [];
  const start = editor && editor.document && editor.document.fileName
    ? path.dirname(editor.document.fileName) : folders[0] && folders[0].uri.fsPath;
  const root = start && repoRootOf(start);
  if (!root) {
    vscode.window.showInformationMessage("AOT: open a file in a git repository to set up how its .aot files merge.");
    return { ok: false };
  }
  const attrFile = path.join(root, ".gitattributes");
  let text = "";
  try { text = fs.readFileSync(attrFile, "utf8"); } catch { /* none yet */ }
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = GIT_ATTRIBUTES.filter((l) => !have.has(l));
  if (missing.length) fs.writeFileSync(attrFile, text + (text && !/\n$/.test(text) ? "\n" : "") + missing.join("\n") + "\n");
  try {
    gitRun(root, ["config", "--local", "merge.aot.name", "AOT: merge .aot files by meaning (verify.js --merge)"]);
    gitRun(root, ["config", "--local", "merge.aot.driver", mergeDriver()]);
  } catch (e) {
    vscode.window.showErrorMessage(`AOT: git could not be configured — ${String(e.stderr || e.message).trim()}`);
    return { ok: false, root };
  }
  vscode.window.showInformationMessage(`AOT: .aot files in ${path.basename(root)} now merge by meaning — `
    + `${missing.length ? "commit .gitattributes; " : ""}the driver runs Node.js ('node' on PATH), and falls back to git's own merge whenever it cannot vouch for its result.`);
  return { ok: true, root };
}

// On activation: a driver set up earlier that points at a verify.js no longer
// there — an older copy of this extension — is pointed at this one. Only
// then: a repository that never ran the setup is never touched.
function repairGitMerge() {
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const root = repoRootOf(folder.uri.fsPath);
    if (!root) continue;
    let config = "";
    try { config = fs.readFileSync(path.join(root, ".git", "config"), "utf8"); } catch { continue; }
    const m = /\[merge "aot"\][^[]*?driver\s*=\s*(.*)/.exec(config);
    const script = m && /"([^"]*verify\.js)"/.exec(m[1].replace(/\\"/g, "\""));
    if (!script || fs.existsSync(script[1]) || path.resolve(script[1]) === path.resolve(verifyScript())) continue;
    try { gitRun(root, ["config", "--local", "merge.aot.driver", mergeDriver()]); } catch { /* left as it was */ }
  }
}

// The lightbulb on a hoist or a dead default (godel.hoists): the fact moves
// onto the parent once and off every child — or the dead value comes off,
// the attribute kept — as one undoable edit (derive.hoistOps).
async function hoistValue(parentLine, attr, value, mode) {
  const editor = vscode.window.activeTextEditor;
  const doc = editor && editor.document;
  if (!doc || doc.languageId !== "aot") return;
  const rootName = docRootName(doc);
  const { root, nodes } = lint(doc.getText(), rootName);
  const ops = derive.hoistOps(doc.getText().split(/\r?\n/), root, nodes, parentLine, attr, value, rootName, formulaRegistry(doc), mode);
  if (!ops || !ops.length) {
    vscode.window.setStatusBarMessage("AOT: nothing to move — the file changed since the warning was found.", 4000);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.set(doc.uri, opsToTextEdits(doc, ops));
  await vscode.workspace.applyEdit(edit);
}

// The reconcile ops for one document, or [] when there is nothing to do —
// outside a workspace, with aot.autoReconcile off, or in a file whose text
// will not parse.
function reconcileOpsFor(doc) {
  if (!underWorkspace(doc) || !autoReconcile()) return [];
  try {
    const rootName = docRootName(doc);
    const text = doc.getText();
    const { root, nodes } = lint(text, rootName);
    const all = repo.occurrences([...repoOthers(doc), { file: doc.fileName, text, root, nodes }]);
    return repo.reconcileFile(
      doc.fileName, all, text.split(/\r?\n/), rootName, formulaRegistry(doc, { root, nodes }), root);
  } catch { return []; }
}

// AOT: Reconcile Concepts Across Files — the repo-wide sweep, for the files
// that were never open when a peer changed. Every .aot is re-read from disk,
// reconciled against the whole repo and saved. The same additive ops a save
// applies, so a file already in step is left untouched.
async function reconcileAcrossFiles() {
  if (!(vscode.workspace.workspaceFolders || []).length) {
    vscode.window.showInformationMessage("AOT: reconciling across files needs an open workspace.");
    return;
  }
  buildWorkspaceIndex(); // from disk, so a closed file is judged as it stands
  const entries = [...workspaceIndex.values()]
    .filter((v) => v.text !== undefined)
    .map((v) => ({ file: v.fsPath, text: v.text, root: v.root, nodes: v.nodes }));
  const all = repo.occurrences(entries);
  const registry = table.mergeRegistries(
    ...entries.map((e) => derive.conceptRegistry(e.root, e.nodes)));
  let changed = 0;
  for (const entry of entries) {
    const rootName = path.basename(entry.file).replace(/\.[^.]*$/, "");
    const ops = repo.reconcileFile(
      entry.file, all, entry.text.split(/\r?\n/), rootName, registry, entry.root);
    if (!ops.length) continue;
    // a file gone since it was indexed is skipped, never the end of the sweep
    let doc;
    try { doc = await vscode.workspace.openTextDocument(entry.file); } catch { continue; }
    const edit = new vscode.WorkspaceEdit();
    edit.set(doc.uri, opsToTextEdits(doc, ops));
    const beforeText = doc.getText();
    if (await vscode.workspace.applyEdit(edit)) {
      markBroughtIn(doc, beforeText); // what a peer file says, not what was written here
      await doc.save();
      changed++;
    }
  }
  vscode.window.setStatusBarMessage(changed
    ? `AOT: reconciled ${changed} file${changed === 1 ? "" : "s"} across the repo`
    : "AOT: every shared Concept is already in step", 5000);
}

// AOT: Upgrade Files to 1.13 Syntax — every .aot in the workspace written for
// 1.12, respelled (src/upgrade.js): a literal '=' in a value doubled rather
// than escaped `\=`, a definition `=` rather than `==`. Nothing a file means
// changes, and a file already in the 1.13 spelling is left alone. Each file's
// edits are its own, one undo apiece; a file with no unsaved edits of yours
// is saved after, one with them is left for you to save.
async function upgradeWorkspaceSyntax() {
  if (!(vscode.workspace.workspaceFolders || []).length) {
    vscode.window.showInformationMessage("AOT: upgrading the files needs an open workspace.");
    return 0;
  }
  buildWorkspaceIndex();
  let changed = 0;
  for (const entry of [...workspaceIndex.values()]) {
    if (entry.text === undefined) continue;
    let doc;
    try { doc = await vscode.workspace.openTextDocument(entry.fsPath); } catch { continue; }
    const edits = upgradeEdits(doc.getText(), path.basename(entry.fsPath).replace(/\.[^.]*$/, ""));
    if (!edits.length) continue;
    const wasDirty = doc.isDirty;
    const edit = new vscode.WorkspaceEdit();
    edit.set(doc.uri, edits.map((e) => vscode.TextEdit.replace(new vscode.Range(e.line, e.from, e.line, e.to), e.text)));
    if (await vscode.workspace.applyEdit(edit)) {
      if (!wasDirty) await doc.save();
      changed++;
    }
  }
  vscode.window.setStatusBarMessage(changed
    ? `AOT: ${changed} file${changed === 1 ? "" : "s"} upgraded to the 1.13 spelling`
    : "AOT: every file already uses the 1.13 spelling", 5000);
  return changed;
}

// Asked once per workspace, when 1.13 first meets files written for 1.12: the
// command does the work, and saying no is remembered too.
async function offerSyntaxUpgrade() {
  const memo = pyMemento();
  const KEY = "aot.upgrade.1.13.asked";
  if (memo.get(KEY, false) || !(vscode.workspace.workspaceFolders || []).length) return;
  buildWorkspaceIndex();
  const old = [...workspaceIndex.values()].filter((e) => e.text !== undefined
    && upgradeEdits(e.text, path.basename(e.fsPath).replace(/\.[^.]*$/, "")).length);
  if (!old.length) return;
  await memo.update(KEY, true);
  const answer = await vscode.window.showInformationMessage(
    `AOT 1.13 doubles a literal '=' in a value (it was '\\='), and writes an attribute's definition with '=' (it was '=='). ${old.length} .aot file${old.length === 1 ? "" : "s"} here still use${old.length === 1 ? "s" : ""} the older spelling.`,
    "Upgrade Them", "Not Now");
  if (answer === "Upgrade Them") await upgradeWorkspaceSyntax();
}

// AOT: Set Value Everywhere — the lightbulb on a value two files disagree
// about. One name means one thing, so once you say which value is right it
// is written to every file that names the attribute on that Concept.
async function setValueEverywhere(conceptName, attr, value) {
  const key = table.numberless(String(conceptName)).trim().toLowerCase();
  const want = String(attr).toLowerCase();
  buildWorkspaceIndex();
  let changed = 0;
  for (const entry of [...workspaceIndex.values()]) {
    if (entry.text === undefined) continue;
    const targets = entry.nodes.filter((n) =>
      n.kind === KIND.CONCEPT && table.numberless(n.name).trim().toLowerCase() === key);
    if (!targets.length) continue;
    const doc = await vscode.workspace.openTextDocument(entry.fsPath);
    const edits = [];
    for (const node of targets) {
      const hit = repo.declared(node).get(want);
      // a table cell is the grid's business, not a line's; those follow from
      // the CSV mirror and the table editor rather than a line rewrite
      if (!hit || hit.cell || (hit.value != null && String(hit.value) === String(value))) continue;
      const raw = doc.lineAt(hit.line - 1).text;
      const colon = raw.indexOf(":");
      // the value as read, written the way the file holds it: an '=' in it
      // must never open a derivation where it lands
      const written = table.writtenValue(value);
      edits.push(vscode.TextEdit.replace(
        doc.lineAt(hit.line - 1).range,
        colon === -1 ? `${raw.trimEnd()}: ${written}` : `${raw.slice(0, colon + 1)} ${written}`));
    }
    if (!edits.length) continue;
    const edit = new vscode.WorkspaceEdit();
    edit.set(doc.uri, edits);
    const beforeText = doc.getText();
    if (await vscode.workspace.applyEdit(edit)) {
      markBroughtIn(doc, beforeText);
      await doc.save();
      changed++;
    }
  }
  vscode.window.setStatusBarMessage(
    `AOT: '${attr}' set to '${value}' in ${changed} file${changed === 1 ? "" : "s"}`, 5000);
}

// Every table in the document re-aligned. Nothing is computed: a derivation
// runs only when asked.
function alignTables(editor) {
  const doc = editor.document;
  if (doc.languageId !== "aot") return;
  const edits = table.align(doc.getText(), formulaRegistry(doc), docRootName(doc));
  if (!edits.length) return;
  return editor.edit((b) => {
    for (const e of edits) b.replace(lineEditRange(doc, e), lineEditText(doc, e));
  });
}

// AOT: Recompute (F9) — every stale Python derivation and every constraint,
// run in place: what Ctrl+Enter does anywhere off a derivation.
function recomputeFormulas(editor) {
  if (editor.document.languageId !== "aot") return;
  return runPython(editor, { mode: "here", line: -1 });
}

// --- parking the derivations (Ctrl+Shift+`) ----------------------------------
// One key takes every '=' derivation — and every constraint on an attribute
// declaration — out of the data and puts it in a store beside the file; the
// same key puts them back.
//
// The order is the whole design. **The recompute runs first**, so every
// derived value is materialised in the data, and only then do the formulas
// leave. What is left in the .aot is a complete set of values that still says
// exactly what it said. The derivations are done with; the constraints are
// not, because a bound computes nothing that could stand in its place — so
// the editor and `node verify.js` read the parked constraints back out of the
// store and hold every value to them (park.parkedConstraints). A parked file
// is not a file with holes in it; it is a file whose arithmetic has already
// been done, with its rules still in force.
//
// The store is `aot.files/<file>.formulas`, beside the CSV mirror. Its
// existence is the state: a file is parked when it has one.

const parkPath = (doc) =>
  path.join(aotFilesDir(doc), path.basename(doc.fileName).replace(/\.aot$/i, "") + ".formulas");

// The derivations parked out of a document, or []. Read from the store and
// remembered until the store itself changes, because the mark on a parked
// value is recomputed on every keystroke and the file system should not be
// asked twice for an answer that has not moved.
const parkCache = new Map(); // store path -> { mtimeMs, size, parked }
function parkedFormulas(doc) {
  if (!doc.fileName) return [];
  let store;
  try { store = parkPath(doc); } catch { return []; }
  let stat;
  try { stat = fs.statSync(store); } catch { parkCache.delete(store); return []; }
  const seen = parkCache.get(store);
  if (seen && seen.mtimeMs === stat.mtimeMs && seen.size === stat.size) return seen.parked;
  let parked = [];
  try { parked = park.parse(fs.readFileSync(store, "utf8")); } catch { /* unreadable: nothing is marked */ }
  parkCache.set(store, { mtimeMs: stat.mtimeMs, size: stat.size, parked });
  return parked;
}

// Apply { line, to?, text } line edits to an array of lines, last first so
// earlier indices stay true while a multi-line edit changes the count.
function applyLineEdits(lines, edits) {
  const out = lines.slice();
  for (const e of [...edits].sort((a, b) => (b.line - a.line))) {
    const from = e.line - 1, to = (e.to || e.line) - 1;
    out.splice(from, to - from + 1, ...e.text.split("\n"));
  }
  return out;
}

// Replace the whole document with `lines`, re-aligned, in one undoable edit.
function rewriteDocument(editor, lines) {
  const doc = editor.document;
  const rootName = docRootName(doc);
  let text = lines.join("\n");
  try {
    const aligned = table.align(text, formulaRegistry(doc), rootName);
    if (aligned.length) text = applyLineEdits(text.split("\n"), aligned).join("\n");
  } catch { /* an unalignable document is rewritten as it stands */ }
  const last = doc.lineCount - 1;
  const whole = new vscode.Range(0, 0, last, doc.lineAt(last).text.length);
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  return editor.edit((b) => b.replace(whole, text.replace(/\n/g, eol)));
}

async function parkFormulas(editor, store) {
  const doc = editor.document;
  // every derivation run fresh and every constraint checked first, so what
  // parks is current. With Python switched off (or the workspace untrusted)
  // the values park as they stand; a refused consent is a "no", and nothing
  // parks.
  let py = { ran: 0, failed: 0 };
  if (pythonWorkIn(doc)) {
    py = await runPython(editor, { mode: "all", quiet: true });
    if (py.blocked === "refused") return;
    if (py.blocked) {
      vscode.window.setStatusBarMessage(`AOT: Python not run (${py.blocked === "off" ? "aot.python.enabled is off" : "the workspace is not trusted"}) — its values park as they stand.`, 5000);
    }
  }
  // the values are written (the run above), the tables drawn, and only then
  // do the derivations leave
  await alignTables(editor);
  const rootName = docRootName(doc);
  const lines = doc.getText().split(/\r?\n/);
  let tree;
  try { tree = lint(doc.getText(), rootName); }
  catch { return vscode.window.showWarningMessage("AOT: the file does not parse — fix it before parking its formulas."); }
  const { lines: parkedLines, parked, stayed } = park.park(lines, tree.nodes, rootName, generatedConcepts(doc));
  // a bare `=` line comes home above the Concept that stood beneath it:
  // one with none beneath it has nowhere to come home to, so it stays
  if (stayed && stayed.length) {
    vscode.window.showWarningMessage(`AOT: the bare '=' line${stayed.length === 1 ? ` on line ${stayed[0]} has` : `s on lines ${stayed.join(", ")} have`} no Concept beneath to come home above, so ${stayed.length === 1 ? "it stays" : "they stay"} in the file — run ${stayed.length === 1 ? "it" : "them"} (Ctrl+Enter) to write ${stayed.length === 1 ? "its" : "their"} tables, and then ${stayed.length === 1 ? "it parks" : "they park"} with the rest.`);
  }
  if (!parked.length) {
    return vscode.window.setStatusBarMessage("AOT: no derivations or constraints to park.", 3000);
  }
  await rewriteDocument(editor, parkedLines);
  // a Python value's provenance goes with it: what computed it, and when
  const entry = pySessions.get(doc.uri.toString());
  const notes = py.ran && entry && entry.hello
    ? [`Python values computed ${new Date().toISOString().slice(0, 16).replace("T", " ")} with ${pyVersions(entry.hello)}`]
    : [];
  try {
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, park.serialise(parked, notes));
    parkCache.delete(store); // the marks read the store the moment it lands
  } catch (e) {
    return vscode.window.showErrorMessage(`AOT: could not write ${path.basename(store)} — ${e.message}`);
  }
  // the parked constraints hold from the store now, so judge the file again
  // with the store in place
  relintAll();
  const bounds = parked.filter((p) => park.isConstraintEntry(p.formula)).length;
  const derivations = parked.length - bounds;
  const counted = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const what = [derivations && counted(derivations, "derivation"), bounds && counted(bounds, "constraint")]
    .filter(Boolean).join(" and ");
  vscode.window.setStatusBarMessage(
    `AOT: ${what} parked in ${path.basename(store)} — Ctrl+Shift+\` puts them back.`, 5000);
  if (py.failed) {
    vscode.window.showWarningMessage(
      `AOT: ${py.failed} Python derivation${py.failed === 1 ? "" : "s"} did not run, and parked with ${py.failed === 1 ? "its" : "their"} previous value${py.failed === 1 ? "" : "s"} — see the Problems panel.`);
  }
}

async function unparkFormulas(editor, store) {
  const doc = editor.document;
  let parked;
  try { parked = park.parse(fs.readFileSync(store, "utf8")); }
  catch (e) { return vscode.window.showErrorMessage(`AOT: could not read ${path.basename(store)} — ${e.message}`); }
  const rootName = docRootName(doc);
  let tree;
  try { tree = lint(doc.getText(), rootName); }
  catch { return vscode.window.showWarningMessage("AOT: the file does not parse — fix it before putting its formulas back."); }
  const lines = doc.getText().split(/\r?\n/);
  const { lines: back, missing } = park.unpark(lines, tree.nodes, rootName, parked);
  const beforeText = doc.getText();
  await rewriteDocument(editor, back);
  // the store is a file on disk like any other: what comes home from it that
  // never ran here is asked about before it runs
  markBroughtIn(doc, beforeText);
  // a derivation whose row was renamed or deleted while it was parked is
  // never invented back: it stays in the store, and the store stays
  try {
    parkCache.delete(store);
    if (missing.length) {
      fs.writeFileSync(store, park.serialise(parked.filter((p) => missing.includes(p.address))));
      vscode.window.showWarningMessage(
        `AOT: ${missing.length} parked ${missing.length === 1 ? "entry no longer names" : "entries no longer name"} anything in the file `
        + `(${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""}) — kept in ${path.basename(store)}.`);
    } else {
      fs.unlinkSync(store);
    }
  } catch (e) {
    vscode.window.showErrorMessage(`AOT: the formulas are back, but ${path.basename(store)} could not be updated — ${e.message}`);
  }
  // the constraints are written on their declarations again, and no longer
  // held from the store as well
  relintAll();
}

function toggleFormulaPark(editor) {
  const doc = editor.document;
  if (doc.languageId !== "aot" || !doc.fileName) return;
  const store = parkPath(doc);
  return fs.existsSync(store) ? unparkFormulas(editor, store) : parkFormulas(editor, store);
}

// --- Python derivations (Ctrl+Enter) -----------------------------------------
// `=` has two languages behind it (pyshape.js). The formula half runs on
// every keystroke, in-process, and needs nothing. The Python half runs only
// when asked — Ctrl+Enter runs the derivation under the cursor with whatever
// it reads and whatever reads it, in place; the park key runs every one of
// them fresh before the derivations leave — in one persistent Python process
// per document (python.js, aot_runtime.py), so a DataFrame one derivation
// makes is there for the next.
//
// Running code a document carries is a trust decision, so three gates stand
// in front of it: aot.python.enabled (off by default), VS Code's workspace
// trust, and — for the Python files in aot.files, whose top-level code runs
// the moment they are loaded — consent keyed to a hash of those files, asked
// again whenever one of them changes. The consent lives in the workspace
// state, never in a file: a repository cannot ship its own.
//
// What a run leaves behind is ordinary text: values in front of their
// derivations, a Concept's table beneath it, a picture or a long text in
// aot.files with its path as the value. Nothing here counts toward V — a
// failure is a verdict on a machine, not on the model — so every Python
// finding goes to a collection of its own.

const PY_KIND_NAMES = ["Example", "Default Value", "Concept", "attribute", "Map"];
const PY_RUNS_KEY = "aot.python.runs";
// the Python files the writer has allowed to run, each by the hash of the
// content allowed: fileKey -> sha256
const PY_APPROVED_KEY = "aot.python.approved";
// the uv projects installed, each by the digest of the pyproject.toml and
// uv.lock that were reviewed and installed: projectKey -> sha256
const UV_SYNCED_KEY = "aot.python.uvSynced";
let pySpawn = childProcess.spawn; // the tests swap in a fake runtime (and a fake uv)
// a bare command found on PATH alone, never in the folder the run starts in
// (python.resolveExecutable); the tests' fake launches whatever it is given
let pyResolve = (cmd, base) => python.resolveExecutable(cmd, { base });
const pySessions = new Map(); // uri -> { session, hello, live: Set<address>, idle, starting }
const pyStatus = new Map();   // uri -> Map<address, { state, source, ms, rows, message, … }>
const pyDims = new Map();     // uri -> [{ range, message }] values older than their derivation
let pyState = null;           // context.workspaceState, or a stand-in
let pyDiagnostics = null;     // the "aot-python" collection

const pyConfig = () => vscode.workspace.getConfiguration("aot");
const pythonEnabled = () => pyConfig().get("python.enabled", false) === true;
const workspaceTrusted = () => vscode.workspace.isTrusted === true;

function pyMemento() {
  if (pyState) return pyState;
  const store = new Map();
  pyState = { get: (k, d) => (store.has(k) ? store.get(k) : d), update: async (k, v) => { store.set(k, v); } };
  return pyState;
}

// Each derivation's last successful run, per file: { source, run, at } by
// address — the source hash says whether it was edited since, the run hash
// whether anything it reads moved.
function runRecords(doc) {
  const all = pyMemento().get(PY_RUNS_KEY, {}) || {};
  return all[fileKey(doc.fileName || "")] || {};
}
async function saveRunRecords(doc, records) {
  const all = Object.assign({}, pyMemento().get(PY_RUNS_KEY, {}) || {});
  all[fileKey(doc.fileName || "")] = records;
  await pyMemento().update(PY_RUNS_KEY, all);
}

// What each bare `=` line last wrote — address -> Concept names — from its
// run record, which outlasts the session.
function generatedConcepts(doc) {
  const out = new Map();
  for (const [address, rec] of Object.entries(runRecords(doc))) {
    if (address.startsWith("@=") && rec && Array.isArray(rec.concepts)) out.set(address, rec.concepts);
  }
  return out;
}

// The derivations of a document indexed for resolving references, with what
// each bare `=` line last wrote, so `@Sales` reads the table its Python made.
function pyHostIndex(doc, hosts) {
  let nodes = [];
  try { nodes = parsedDoc(doc).nodes; } catch { /* no nodes: nothing for a rename to follow */ }
  return python.hostIndex(hosts, generatedConcepts(doc), nodes);
}

// --- the repository's Python -------------------------------------------------
// A derivation reaches the file's sidecar, aot.files/<file>.py, by its names
// alone, and any other Python file of the repository by naming it as a
// module — `=finance.revenue(@Sales)` — or by path, aot.use("tools/x.py").

const sidecarPath = (doc) => path.join(aotFilesDir(doc), docRootName(doc) + ".py");

// Every Python file of the repository a derivation may reach, walked once and
// kept until a Python file is created, deleted or saved. A virtual
// environment, node_modules, bytecode and hidden folders are not the
// repository's own code, and are never offered.
const PY_SKIP_DIRS = new Set(["node_modules", "__pycache__", "site-packages"]);
const pyIndexCache = new Map(); // root key -> [absolute paths]
function pyIndex(doc) {
  const root = aotRoot(doc);
  const key = fileKey(root);
  const hit = pyIndexCache.get(key);
  if (hit) return hit;
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 16 || files.length > 5000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === "pyvenv.cfg")) return; // a virtual environment
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !PY_SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile() && /\.py$/i.test(e.name)) files.push(path.join(dir, e.name));
    }
  };
  walk(root, 0);
  files.sort();
  pyIndexCache.set(key, files);
  return files;
}
const forgetPyIndex = () => pyIndexCache.clear();
// A path pyIndex would walk to: not under a hidden folder (.venv, .git) or
// one of the folders it skips.
const isRepoPython = (p) => !/[\\/](\.[^\\/]+|node_modules|__pycache__|site-packages)[\\/]/.test(String(p));

// A file's sha256 over its bytes — the runtime hashes the same bytes — kept
// until the file moves. (SHA-256, not SHA-1: a SHA-1 collision can be
// chosen, so a file allowed and its replacement could share one.)
const fileHashCache = new Map(); // path -> { mtimeMs, size, hash }
function fileDigest(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const hit = fileHashCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.hash;
  let body;
  try { body = fs.readFileSync(file); } catch { return null; }
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  fileHashCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, hash });
  return hash;
}

// The code a derivation's value depends on, hashed: the file's sidecar, and
// every repository file the modules and paths it names reach. A change to
// one of them makes this derivation stale, and no other. (A module those
// import in turn is not followed: run the line to take it in.)
function codeHash(doc, host, index, defs) {
  const root = aotRoot(doc), af = aotFilesDir(doc);
  const files = new Set();
  const own = sidecarPath(doc);
  if (fs.existsSync(own)) files.add(own);
  const { names, paths } = python.referencedModules(host.source);
  for (const n of names) {
    if (PY_PRELOADED.includes(n) || (defs && defs.has(n))) continue;
    for (const f of python.moduleFiles(n, index, root, af)) files.add(f);
  }
  for (const p of paths) {
    for (const base of [af, root]) {
      const f = path.resolve(base, p);
      if (fs.existsSync(f)) { files.add(f); break; }
    }
  }
  const h = crypto.createHash("sha1");
  for (const f of [...files].sort()) h.update(f + "\0" + (fileDigest(f) || "") + "\0");
  return h.digest("hex").slice(0, 16);
}

// --- allowing the repository's Python to run ---------------------------------
// A Python file runs only once its present content has been allowed. The
// runtime checks each file as it loads — the sidecar, a module a derivation
// names, one those import — and a file not allowed stops the derivation with
// the question, asked here, naming exactly that file. Allowing it records the
// hash of what was read: a change that arrives from outside (a pull, another
// tool) is asked about again, while a change saved in this editor is the
// writer's own and is allowed as it is saved. Kept in the workspace state,
// never in a file, so no repository can ship its own answer.

const approvals = () => pyMemento().get(PY_APPROVED_KEY, {}) || {};
// A copy of each allowed version, in the extension's own storage, so a file
// that changed outside the editor can be shown against what was allowed.
let pySnapshotRoot = null; // set on activation
const snapshotOf = (digest) => path.join(pySnapshotRoot || path.join(os.tmpdir(), "aot-approved"), `${digest}.py`);
async function approveFile(file, digest) {
  await pyMemento().update(PY_APPROVED_KEY, Object.assign({}, approvals(), { [fileKey(file)]: digest }));
  try {
    const body = fs.readFileSync(file);
    if (crypto.createHash("sha256").update(body).digest("hex") === digest) {
      fs.mkdirSync(path.dirname(snapshotOf(digest)), { recursive: true });
      fs.writeFileSync(snapshotOf(digest), body);
    }
  } catch { /* nothing to keep: the question simply offers the file */ }
}
const isApproved = (file, digest) => !!digest && approvals()[fileKey(file)] === digest;

// Ask about one file a run reached. true when the writer lets it run. A file
// allowed before and changed since offers the change itself, beside what
// was allowed.
async function askToRun(doc, consent) {
  const file = consent.path;
  const rel = path.relative(aotRoot(doc), file).split(path.sep).join("/");
  const before = approvals()[fileKey(file)];
  const why = before ? "has changed since you last allowed it, and not in this editor" : "has not been run here before";
  const diffable = !!before && fs.existsSync(snapshotOf(before));
  const look = diffable ? "Show Changes" : "Open File";
  const pick = await vscode.window.showWarningMessage(
    `AOT: run ${rel}? A Python derivation reaches it, and it ${why}. Its top-level code runs the moment it loads, with your permissions — read it first if you did not write it.`,
    { modal: true }, "Run", look);
  if (pick === "Run") {
    await approveFile(file, consent.digest);
    return true;
  }
  if (pick === "Show Changes") {
    vscode.commands.executeCommand("vscode.diff", vscode.Uri.file(snapshotOf(before)), vscode.Uri.file(file), `${rel}: as allowed ↔ as it is now`);
    vscode.window.setStatusBarMessage("AOT: nothing ran — Ctrl+Enter asks again once you have read the change.", 6000);
  } else if (pick === "Open File" && vscode.window.showTextDocument) {
    vscode.window.showTextDocument(vscode.Uri.file(file));
  }
  return false;
}

// A Python file saved in this editor: its new content is allowed when what it
// replaced was (or when it is new) — the writer's own edit is never asked
// about. The digest before the save is taken as the save begins.
const pyBeforeSave = new Map(); // fileKey -> sha256 | null (a new file)
function pyWillSave(doc) {
  const file = doc.fileName;
  pyBeforeSave.set(fileKey(file), fs.existsSync(file) ? fileDigest(file) : null);
}
async function pyDidSave(doc) {
  const file = doc.fileName;
  fileHashCache.delete(file);
  const key = fileKey(file);
  if (!pyBeforeSave.has(key)) return;
  const before = pyBeforeSave.get(key);
  pyBeforeSave.delete(key);
  if (before === null) forgetPyIndex(); // a new file: the repository has one more
  if (before === null || isApproved(file, before)) {
    const now = fileDigest(file);
    if (now) await approveFile(file, now);
  }
}

// --- allowing the Python a .aot carries ---------------------------------------
// A .aot is a program too: every derivation and every constraint's bound in
// it runs on Ctrl+Enter. So the same rule the Python files follow holds for
// it, piece by piece. Each piece is known by a hash of its text:
//
//   - one written in this editor is the writer's own, and runs without a
//     question: it stands in the editor and not yet on disk, or it was on
//     neither when the file was saved here;
//   - one that arrived from outside — on disk and never run here (a pull,
//     a clone, another tool), or brought in by the editor itself from
//     somewhere else (unparking a store, folding a CSV back, reconciling a
//     peer file) — is asked about before anything runs;
//   - once allowed, or once run, a piece is the writer's for this file.
//
// The answers are kept in the workspace state, as every consent is.

const PY_CODE_KEY = "aot.python.approvedCode";
const externalCode = new Map(); // fileKey -> Set(code key): brought in from elsewhere

const codeKey = (kind, text) => crypto.createHash("sha256").update(kind + "\0" + String(text).trim()).digest("hex");

// Every piece of Python a text carries: code key -> { kind, text, line } —
// each derivation, each bound written on a declaration, and each bound the
// file's store still holds (a parked constraint is checked on every run).
function codeItemsOf(text, rootName, parkedEntries) {
  const out = new Map();
  let parsed;
  try { parsed = lint(text, rootName); } catch { return out; }
  const add = (kind, code, line) => {
    if (!String(code).trim()) return;
    const k = codeKey(kind, code);
    if (!out.has(k)) out.set(k, { kind, text: String(code).trim(), line });
  };
  try {
    for (const h of python.hostsOf(parsed.nodes, text.split(/\r?\n/), rootName)) add("derivation", h.source, h.line);
  } catch { /* an unparseable grid carries no derivation it can run */ }
  for (const n of parsed.nodes) {
    if (n.kind === KIND.ATTRIBUTE && n.constraints) for (const c of n.constraints) add("bound", c.op + c.formula, n.line);
  }
  if (parkedEntries && parkedEntries.length) {
    try {
      for (const [decl, chain] of park.parkedConstraints(parsed.nodes, rootName, parkedEntries)) {
        for (const c of chain) add("bound", c.op + c.formula, decl.line);
      }
    } catch { /* a store that names nothing holds nothing */ }
  }
  return out;
}

const approvedCodeAll = () => pyMemento().get(PY_CODE_KEY, {}) || {};
const approvedCodeOf = (file) => approvedCodeAll()[fileKey(file || "")] || {};
async function approveCode(file, keys) {
  if (!keys.length) return;
  const all = Object.assign({}, approvedCodeAll());
  const mine = Object.assign({}, all[fileKey(file)] || {});
  for (const k of keys) mine[k] = 1;
  all[fileKey(file)] = mine;
  await pyMemento().update(PY_CODE_KEY, all);
}

// The pieces of a document's Python: { own: [key], asked: [{ key, kind,
// text, line }] } — own the writer's (written here, or run here before this
// was asked), asked the ones from outside, not yet allowed.
function codeConsent(doc) {
  const rootName = docRootName(doc);
  const parked = parkedFormulas(doc);
  const now = codeItemsOf(doc.getText(), rootName, parked);
  let diskText = "";
  try { diskText = fs.readFileSync(doc.fileName, "utf8"); } catch { /* never saved */ }
  const disk = codeItemsOf(diskText, rootName, parked);
  const allowed = approvedCodeOf(doc.fileName);
  const brought = externalCode.get(fileKey(doc.fileName)) || new Set();
  // a derivation that ran here before this was asked is the writer's already
  const ran = new Set(Object.values(runRecords(doc)).map((r) => r.source));
  const own = [], asked = [];
  for (const [key, item] of now) {
    if (allowed[key]) continue;
    if (item.kind === "derivation" && ran.has(python.sourceHash(item.text))) own.push(key);
    else if (disk.has(key) || brought.has(key)) asked.push(Object.assign({ key }, item));
    else own.push(key);
  }
  return { own, asked };
}

// Whatever an edit the editor makes brings in from somewhere else: the
// pieces of Python it adds are marked as arrived, not written.
function markBroughtIn(doc, beforeText) {
  const rootName = docRootName(doc);
  const before = codeItemsOf(beforeText, rootName, null);
  const key = fileKey(doc.fileName || "");
  const set = externalCode.get(key) || new Set();
  for (const k of codeItemsOf(doc.getText(), rootName, null).keys()) if (!before.has(k)) set.add(k);
  externalCode.set(key, set);
}

// A .aot about to be saved here: what the writer wrote since the last save
// — in the editor, not on disk, not brought in — is theirs. Taken as the save
// begins, before any edit the save itself makes (a reconcile) is applied.
function aotWillSave(doc) {
  if (!doc.fileName) return;
  try {
    const { own } = codeConsent(doc);
    if (own.length) approveCode(doc.fileName, own);
  } catch { /* a file that does not parse holds nothing to allow */ }
}

// Ask about the pieces of a .aot's Python that came from outside. true when
// the writer lets them run.
async function askToRunCode(doc, asked) {
  const rel = relToRepo(doc, doc.fileName);
  const n = (kind) => asked.filter((a) => a.kind === kind).length;
  const parts = [];
  if (n("derivation")) parts.push(`${n("derivation")} derivation${n("derivation") === 1 ? "" : "s"}`);
  if (n("bound")) parts.push(`${n("bound")} constraint bound${n("bound") === 1 ? "" : "s"}`);
  const first = asked.slice(0, 3).map((a) => `line ${a.line}: ${a.kind === "derivation" ? "=" : ""}${a.text.length > 60 ? a.text.slice(0, 57) + "…" : a.text}`).join("; ");
  const pick = await vscode.window.showWarningMessage(
    `AOT: run the Python in ${rel}? ${parts.join(" and ")} in it ${asked.length === 1 ? "has" : "have"} not run here before and did not come from this editor — ${first}${asked.length > 3 ? "; …" : ""}. It runs with your permissions: read it first if you did not write it.`,
    { modal: true }, "Run", "Show Them");
  if (pick === "Run") return true;
  if (pick === "Show Them") {
    try {
      const listing = asked.map((a) => `# line ${a.line} (${a.kind})\n${a.kind === "derivation" ? "=" : ""}${a.text}\n`).join("\n");
      const shown = await vscode.workspace.openTextDocument({ content: listing, language: "python" });
      if (vscode.window.showTextDocument) await vscode.window.showTextDocument(shown, { preview: true });
      vscode.window.setStatusBarMessage("AOT: nothing ran — Ctrl+Enter asks again once you have read them.", 6000);
    } catch { /* nowhere to show them */ }
  }
  return false;
}

// The functions a Python file defines, read off its text — nothing is run
// to learn them: name -> { line (0-based), signature, doc }.
function sidecarDefs(doc) {
  return fileDefs(sidecarPath(doc));
}
// read again only when the file moves: the underlines ask on every redraw
const defsCache = new Map(); // path -> { mtimeMs, size, defs }
function fileDefs(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { defsCache.delete(file); return new Map(); }
  const seen = defsCache.get(file);
  if (seen && seen.mtimeMs === stat.mtimeMs && seen.size === stat.size) return seen.defs;
  const defs = readDefs(file);
  defsCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, defs });
  return defs;
}
function readDefs(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return new Map(); }
  const out = new Map();
  const lines = text.split(/\r?\n/);
  lines.forEach((l, i) => {
    const m = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(l);
    if (!m) return;
    let docText = "";
    const first = (lines[i + 1] || "").trim();
    const q = /^[rRuU]?("""|''')/.exec(first);
    if (q) {
      const fence = q[1];
      const body = [first.slice(q[0].length)];
      let j = i + 1;
      while (!body[body.length - 1].includes(fence) && j + 1 < lines.length) body.push(lines[++j].trim());
      docText = body.join("\n").split(fence)[0].trim();
    }
    out.set(m[1], { line: i, signature: `${m[1]}(${m[2].trim()})`, doc: docText });
  });
  return out;
}

// The names a Python file takes from other modules with `from x import a,
// b as c` — name -> { module, name } — read off its text, so a derivation
// calling `load()` that the sidecar imports from helpers.py reaches helpers.py.
function fileImports(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return new Map(); }
  const out = new Map();
  for (const m of text.matchAll(/^from\s+([\w.]+)\s+import\s+\(?([^()#\r\n]+)\)?/gm)) {
    for (const part of m[2].split(",")) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (/^[A-Za-z_]\w*$/.test(name || "")) out.set((alias || name).trim(), { module: m[1], name });
    }
  }
  return out;
}

// Where a call in a derivation is defined: { file, def } — the sidecar's
// own function, one it imports, a repository module's, or the file an
// aot.use names — or null for anything else (the standard library, an
// installed package, a builtin), which has no file here to open.
function resolveCall(doc, call) {
  let file = null, name = call.name;
  if (call.used) file = usedFileOf(doc, call.used);
  else if (call.module) file = moduleFileOf(doc, call.module);
  else {
    const side = sidecarPath(doc);
    if (fileDefs(side).has(name)) file = side;
    else {
      const imported = fileImports(side).get(name);
      if (imported) { file = moduleFileOf(doc, imported.module); name = imported.name; }
    }
  }
  if (!file) return null;
  const def = fileDefs(file).get(name);
  return def ? { file, def } : null;
}

// Every call in the document's derivations that reaches a Python file of the
// repository: the callee's span and where its `def` is. Underlined, and a
// link — Ctrl+click opens the file at the function.
function pythonCallLinks(doc) {
  if (doc.languageId !== "aot") return [];
  const out = [];
  for (const h of pythonHostsIn(doc)) {
    if (h.line - 1 >= doc.lineCount) continue;
    const raw = doc.lineAt(h.line - 1).text;
    const at = raw.indexOf(h.source, h.startCol);
    if (at === -1) continue;
    for (const call of python.callSites(h.source)) {
      const target = resolveCall(doc, call);
      if (!target) continue;
      out.push({
        range: new vscode.Range(h.line - 1, at + call.start, h.line - 1, at + call.start + call.length),
        file: target.file, def: target.def,
      });
    }
  }
  return out;
}

const SIDECAR_HEADER = (root) => [
  `"""Python for ${root}.aot — the functions its \`=\` derivations call.`,
  "",
  `Every public name here can be called from a derivation in ${root}.aot, and`,
  "pd, np, plt, math, date, datetime, … and `aot` are available without being",
  "imported. Top-level code runs the moment this file is loaded, so keep it to",
  "definitions. The editor asks before running this file, and again after it",
  "changes.",
  '"""',
  "",
].join("\n");

// A Python file the editor itself wrote at the writer's asking — a stub, a
// moved expression — is allowed as written, so the writer is never asked to
// approve their own click. Only when what it replaced was allowed (or it is
// new): a file still unapproved stays so.
async function reconsentAfterWrite(file, before) {
  fileHashCache.delete(file);
  if (before === null) forgetPyIndex();
  if (before !== null && !isApproved(file, before)) return;
  const now = fileDigest(file);
  if (now) await approveFile(file, now);
}

// --- the gates --------------------------------------------------------------

// true when this document's Python may run now; otherwise why not — "off" or
// "untrusted". `quiet` skips the explanations (the park key parks
// regardless). The files a run reaches are asked about as it reaches them
// (askToRun) — that question is never quiet.
async function pythonGate(doc, quiet) {
  if (!pythonEnabled()) {
    if (!quiet) {
      const pick = await vscode.window.showInformationMessage(
        "AOT: Python derivations are off. Turn on 'aot.python.enabled' to run them — they run the code this file carries, with your permissions.",
        "Open Settings");
      if (pick === "Open Settings") vscode.commands.executeCommand("workbench.action.openSettings", "aot.python");
    }
    return "off";
  }
  if (!workspaceTrusted()) {
    if (!quiet) {
      const pick = await vscode.window.showWarningMessage(
        "AOT: this workspace is not trusted, so the Python its files carry is not run.", "Manage Workspace Trust");
      if (pick) vscode.commands.executeCommand("workbench.trust.manage");
    }
    return "untrusted";
  }
  return true;
}

// --- the interpreter ----------------------------------------------------------
// Which Python a document's derivations run in (aot.python.manager):
//   "auto"    aot.python.path when it is set, else the uv environment when
//             there is one, else `python` on PATH
//   "uv"      the uv environment only (AOT: Set Up Python Environment)
//   "python"  aot.python.path, else `python` on PATH
// Both paths are user settings only, so no repository can choose the
// program that runs.

const relToRepo = (doc, p) => path.relative(aotRoot(doc), p).split(path.sep).join("/") || ".";

// { exe, project } — project is the uv project when the interpreter is its
// environment's. Throws when "uv" is asked for and there is none yet.
function pythonCommand(doc) {
  const cfg = pyConfig();
  const manager = cfg.get("python.manager", "auto");
  const explicit = String(cfg.get("python.path", "") || "").trim();
  // no path set: the names PATH is searched for, in order — `python3` first
  // off Windows, since Debian, Ubuntu and WSL ship no bare `python`
  const onPath = () => {
    const names = python.defaultPythons(process.platform);
    return { exe: names[0], names, project: null };
  };
  if (manager === "python" || (manager !== "uv" && explicit)) return explicit ? { exe: explicit, project: null } : onPath();
  const project = uvenv.projectDir(aotRoot(doc), aotFilesDir(doc), fs.existsSync);
  // an environment is used only as it was set up here: a .venv a repository
  // arrived with — or one changed since — could hold a python of anyone's
  const exe = project && uvenv.venvPython(project, process.platform);
  const record = project && uvRecord(project);
  const ours = !!(exe && record && record.exe && fs.existsSync(exe) && fileDigest(exe) === record.exe);
  if (ours) return { exe, project };
  if (manager === "uv" || (record && fs.existsSync(exe || ""))) {
    throw new Error(!project ? "there is no uv environment here yet — run AOT: Set Up Python Environment"
      : record ? `the Python in ${relToRepo(doc, project)}/${path.basename(uvenv.venvDir(project, process.platform))} changed since it was set up here — run AOT: Set Up Python Environment to look at it again`
        : `the uv environment in ${relToRepo(doc, project)} was not set up here — run AOT: Set Up Python Environment`);
  }
  return onPath();
}

// --- setting up the environment with uv ---------------------------------------
// AOT: Set Up Python Environment. uv resolves the project into uv.lock, the
// writer is shown what the lock would install — every package, and anything
// from outside PyPI — and only then does `uv sync --locked --no-build`
// install exactly that, from built wheels alone, so nothing is compiled or
// run to install it. The digest of what was reviewed is kept (workspace
// state, as every consent is), so an unchanged project installs without
// asking again, and one changed by a pull asks first.

const uvPath = () => String(pyConfig().get("uv.path", "") || "").trim() || "uv";
let pyOutputChannel = null;
function pyOutput() {
  if (!pyOutputChannel && vscode.window.createOutputChannel) pyOutputChannel = vscode.window.createOutputChannel("AOT Python");
  return pyOutputChannel || { append() {}, appendLine() {}, show() {} };
}
const readText = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const uvDigestOf = (project) =>
  uvenv.projectDigest(readText(path.join(project, "pyproject.toml")), readText(path.join(project, "uv.lock")));
const uvSynced = () => pyMemento().get(UV_SYNCED_KEY, {}) || {};
// what was installed here for a project: { digest, exe } — the project as
// reviewed, and its environment's interpreter as uv made it
const uvRecord = (project) => uvSynced()[fileKey(project)] || null;

// One uv command, logged to the AOT Python output. `environment` (optional)
// is the folder the project's environment lives in, this OS's own.
function uv(args, cwd, environment) {
  const out = pyOutput();
  out.appendLine(`> uv ${args.join(" ")}`);
  const exe = pyResolve(uvPath(), cwd);
  if (!exe) return Promise.resolve({ code: null, stdout: "", stderr: "", missing: true });
  return uvenv.runUv(pySpawn, exe, args, { cwd, environment, onOutput: (s) => out.append(s) });
}

// { ok, project?, message } — the setup, start to finish. Asks what a new
// project should hold, and before anything is installed.
async function setUpPython() {
  const editor = vscode.window.activeTextEditor;
  const doc = editor && editor.document;
  if (!doc || doc.languageId !== "aot" || !doc.fileName) {
    vscode.window.showInformationMessage("AOT: open an .aot file to set up the Python its derivations run in.");
    return { ok: false, message: "no .aot file" };
  }
  if (!workspaceTrusted()) {
    vscode.window.showWarningMessage("AOT: this workspace is not trusted, so nothing is installed for it.");
    return { ok: false, message: "untrusted" };
  }
  const version = await uv(["--version"], aotRoot(doc));
  if (version.code !== 0) {
    const pick = await vscode.window.showErrorMessage(version.missing
      ? `AOT: '${uvPath()}' was not found. Install uv — https://docs.astral.sh/uv/ — or set aot.uv.path to it.`
      : `AOT: uv did not start — ${uvenv.lastWords(version)}`, "Install uv");
    if (pick === "Install uv" && vscode.env && vscode.env.openExternal) vscode.env.openExternal(vscode.Uri.parse("https://docs.astral.sh/uv/getting-started/installation/"));
    return { ok: false, message: "no uv" };
  }

  // the project: the one there is, or a new one in aot.files holding the
  // libraries the writer picks
  let project = uvenv.projectDir(aotRoot(doc), aotFilesDir(doc), fs.existsSync);
  if (!project) {
    const picked = vscode.window.showQuickPick
      ? await vscode.window.showQuickPick(
        uvenv.LIBRARIES.map((l) => ({ label: l.name, description: l.why, picked: !!l.picked })),
        { canPickMany: true, title: "AOT: Python libraries for this repository", placeHolder: "Written to aot.files/pyproject.toml — add more there later" })
      : uvenv.LIBRARIES.filter((l) => l.picked).map((l) => ({ label: l.name }));
    if (!picked) return { ok: false, message: "cancelled" };
    project = aotFilesDir(doc);
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, "pyproject.toml"), uvenv.pyprojectText(picked.map((p) => p.label)));
  }
  const rel = relToRepo(doc, project);
  const fail = (what, r) => {
    const message = `${what} — ${uvenv.lastWords(r)}`;
    vscode.window.showErrorMessage(`AOT: ${message}`, "Show Output").then((p) => { if (p) pyOutput().show(); });
    return { ok: false, project, message };
  };

  // the lock: made, or brought up to the project, from built wheels alone
  const check = await uv(["lock", "--project", project, "--check"], project);
  if (check.code !== 0) {
    const locked = await uv(["lock", "--project", project, "--no-build"], project);
    if (locked.code !== 0) return fail(`uv could not resolve ${rel}/pyproject.toml`, locked);
  }

  // the review: what would be installed, unless it is exactly what was
  // installed before
  const digest = uvDigestOf(project);
  // this OS's own environment: a repository opened from Windows and from
  // WSL keeps one of each, and neither setup touches the other's
  const venvDir = uvenv.venvDir(project, process.platform);
  const venvName = path.basename(venvDir);
  const venv = uvenv.venvPython(project, process.platform);
  const key = fileKey(project);
  const record = uvRecord(project);
  // a .venv that was not set up here — or whose interpreter changed since —
  // is not trusted to hold what it says, and is made again rather than
  // taken over
  const foreign = fs.existsSync(venvDir)
    && (!record || (fs.existsSync(venv) && fileDigest(venv) !== record.exe));
  if (!record || foreign || record.digest !== digest || !fs.existsSync(venv)) {
    const review = uvenv.lockReview(uvenv.parseLock(readText(path.join(project, "uv.lock"))));
    const shown = review.packages.slice(0, 12).join(", ") + (review.count > 12 ? `, and ${review.count - 12} more` : "");
    const outside = review.outside.length
      ? ` ${review.outside.length} of them come from outside PyPI — ${review.outside.map((o) => `${o.name} (${o.from})`).join("; ")} — read those before you install.`
      : "";
    const before = record && record.digest !== digest ? `${rel}/pyproject.toml or uv.lock has changed since it was last installed here. ` : "";
    const replaced = foreign ? ` The .venv already in ${rel} was not set up here${record ? " as it is now" : ""}, so it is replaced.` : "";
    const pick = await vscode.window.showWarningMessage(
      `AOT: install ${review.count} Python package${review.count === 1 ? "" : "s"} into ${rel}/${venvName}? ${before}${shown}.${outside}${replaced} Only built wheels are installed, so nothing is compiled or run to install them — but every installed package runs whenever the derivations' Python starts.`,
      { modal: true }, "Install", "Open uv.lock");
    if (pick === "Open uv.lock" && vscode.window.showTextDocument) vscode.window.showTextDocument(vscode.Uri.file(path.join(project, "uv.lock")));
    if (pick !== "Install") return { ok: false, project, message: "not installed" };
    if (foreign) fs.rmSync(venvDir, { recursive: true, force: true });
  }

  // exactly what the lock says, and nothing that has to be built — compiled
  // to bytecode as it installs: the runtime runs with -B and never writes a
  // .pyc, so without them every session would compile pandas from source
  // (40 s and more) before its first derivation could run
  const synced = await uv(["sync", "--project", project, "--locked", "--no-build", "--no-install-project", "--compile-bytecode"], project, venvDir);
  if (synced.code !== 0) return fail(`uv could not install ${rel}/uv.lock`, synced);
  // uv keeps an environment it makes out of git itself; one it did not
  // mark is marked here, so no platform's environment is ever committed
  try {
    if (fs.existsSync(venvDir) && !fs.existsSync(path.join(venvDir, ".gitignore"))) fs.writeFileSync(path.join(venvDir, ".gitignore"), "*\n");
  } catch { /* an unwritable folder is uv's to explain */ }
  fileHashCache.delete(venv);
  await pyMemento().update(UV_SYNCED_KEY, Object.assign({}, uvSynced(), { [key]: { digest, exe: fileDigest(venv) } }));
  // every session starts again, in the environment as it is now
  for (const k of [...pySessions.keys()]) pyStop(k, "the environment changed");
  forgetPyIndex();
  const message = `Python environment ready — ${rel}/${venvName}${fs.existsSync(venv) ? "" : " (its interpreter was not found where uv puts it)"}`;
  vscode.window.setStatusBarMessage(`AOT: ${message}`, 6000);
  return { ok: true, project, message };
}

// The uv project's lock changed since it was installed (a pull, a hand
// edit): the run goes on in the environment as it is, and says so, once.
const uvDriftSaid = new Set();
function uvDrift(doc, cmd) {
  if (!cmd || !cmd.project) return;
  const key = fileKey(cmd.project);
  const installed = uvRecord(cmd.project);
  if (!installed || installed.digest === uvDigestOf(cmd.project) || uvDriftSaid.has(key)) return;
  uvDriftSaid.add(key);
  vscode.window.showWarningMessage(
    `AOT: ${relToRepo(doc, cmd.project)}/pyproject.toml or uv.lock changed since the environment was set up — the derivations run with the packages as they were installed.`,
    "Set Up Python Environment").then((p) => { if (p) vscode.commands.executeCommand("aot.setUpPython"); });
}

// --- the session ------------------------------------------------------------

// What the derivations' Python is held to (user settings only): the
// runtime installs it at hello, once.
const pyGuards = () => {
  const cfg = pyConfig();
  const mb = Number(cfg.get("python.maxMemoryMb", 4096));
  return {
    memoryMb: Number.isFinite(mb) && mb > 0 ? Math.round(mb) : 0,
    subprocess: cfg.get("python.allowSubprocess", false) === true,
    network: cfg.get("python.allowNetwork", true) !== false,
    credentials: cfg.get("python.protectCredentials", true) !== false,
  };
};

function pySession(doc) {
  const key = doc.uri.toString();
  const hit = pySessions.get(key);
  if (hit && hit.session.alive) return hit;
  const cfg = pyConfig();
  let cwd = aotFilesDir(doc);
  if (!fs.existsSync(cwd)) cwd = aotRoot(doc);
  const cmd = pythonCommand(doc);
  const names = cmd.names || [cmd.exe];
  let exe = null;
  for (const name of names) if (!exe) exe = pyResolve(name, aotRoot(doc));
  if (!exe) throw new Error(python.spawnMessage({ code: "ENOENT" }, names.join("' or '")));
  const guards = pyGuards();
  // the credentials the editor's own environment carries are not handed on
  const scrubbed = guards.credentials ? python.scrubbedEnv(process.env) : { env: undefined, withheld: [] };
  const session = new python.Session(pySpawn, {
    python: exe,
    // a uv environment is the project's own, so Python is started isolated
    // from anything outside it: no PYTHON* variables, no user site-packages,
    // no current directory on the path
    isolated: !!cmd.project,
    runtime: path.join(__dirname, "aot_runtime.py"),
    cwd,
    env: scrubbed.env,
    timeoutMs: cfg.get("python.timeoutMs", 15000),
    maxResultBytes: cfg.get("python.maxResultBytes", 8000000),
  });
  const entry = { session, hello: null, live: new Set(), idle: null, starting: null, cmd, withheld: scrubbed.withheld };
  session.onExit = () => entry.live.clear();
  pySessions.set(key, entry);
  session.start();
  // the guards go in with the first request, before any code of the
  // repository's can run, and hold for the life of the process
  entry.starting = session.request({ op: "hello", guards }, 30000).then((h) => {
    if (h.protocol !== python.PROTOCOL) {
      throw new Error(`the Python runtime speaks protocol ${h.protocol} and the editor ${python.PROTOCOL} — reinstall the extension`);
    }
    entry.hello = h;
    return h;
  });
  entry.starting.catch(() => {});
  return entry;
}

// an idle session goes after aot.python.idleTimeoutMs; the next run starts afresh
function pyTouch(doc, entry) {
  clearTimeout(entry.idle);
  const ms = pyConfig().get("python.idleTimeoutMs", 300000);
  entry.idle = setTimeout(() => pyStop(doc.uri.toString(), "idle"), ms);
  if (entry.idle.unref) entry.idle.unref();
}

function pyStop(key, reason) {
  const entry = pySessions.get(key);
  if (!entry) return;
  clearTimeout(entry.idle);
  pySessions.delete(key);
  entry.session.kill(reason || "stopped");
}

// Start the interpreter and import pandas and numpy before the first run
// needs them. The sidecar is never loaded here, so no code the repository
// carries runs before it is asked to.
function pythonWarm(doc, hosts) {
  if (!hosts.length || !pythonEnabled() || !workspaceTrusted()) return;
  const key = doc.uri.toString();
  if (pySessions.has(key)) return;
  let entry;
  try { entry = pySession(doc); } catch { pySessions.delete(key); return; }
  entry.starting
    .then(() => entry.session.request({ op: "warm" }, 60000))
    .then(() => pyTouch(doc, entry))
    .catch(() => pyStop(key, "warm-up failed"));
}

const pyTree = (node) => ({
  line: node.line, kind: PY_KIND_NAMES[node.kind], name: node.name, value: node.value,
  alias: node.alias || null, children: node.children.map(pyTree),
});

function statusOf(doc) {
  const key = doc.uri.toString();
  if (!pyStatus.has(key)) pyStatus.set(key, new Map());
  return pyStatus.get(key);
}

const pyVersions = (hello) => {
  if (!hello) return "";
  const libs = Object.entries(hello.libraries || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`);
  return [`python ${hello.python}`, ...libs.filter((l) => /^(pandas|numpy|matplotlib)\b/.test(l))].join(" · ");
};

function pythonHostsIn(doc) {
  try {
    const { nodes } = parsedDoc(doc);
    return python.hostsOf(nodes, doc.getText().split(/\r?\n/), docRootName(doc));
  } catch { return []; }
}

// The values a constraint holds, each with its chain — parked bounds too.
function constraintChecksIn(doc) {
  try {
    const { nodes } = parsedDoc(doc);
    const parked = park.parkedConstraints(nodes, docRootName(doc), parkedFormulas(doc));
    return python.constraintChecks(nodes, doc.getText().split(/\r?\n/), parked);
  } catch { return []; }
}

// Whether a document holds anything for Python to do: a derivation to run,
// or a constraint to check.
const pythonWorkIn = (doc) => pythonHostsIn(doc).length > 0 || constraintChecksIn(doc).length > 0;

// --- the run ----------------------------------------------------------------

// mode "here": the derivation on `line` (or, off any derivation, every stale
// one), with its stale upstream and everything downstream — Ctrl+Enter.
// mode "all": every derivation, fresh — the park key. mode "fresh": the
// session reset first, then every derivation. Answers { ran, failed,
// blocked? } — blocked says why nothing ran (a gate).
async function runPython(editor, opts) {
  opts = opts || {};
  const doc = editor.document;
  if (doc.languageId !== "aot" || !doc.fileName) return { ran: 0, failed: 0 };
  const rootName = docRootName(doc);
  const { root, nodes } = parsedDoc(doc);
  const lines = doc.getText().split(/\r?\n/);
  const hosts = python.hostsOf(nodes, lines, rootName);
  const constrained = constraintChecksIn(doc).length > 0;
  if (!hosts.length && !constrained) {
    if (!opts.quiet) vscode.window.setStatusBarMessage("AOT: no Python derivations or constraints in this file.", 3000);
    return { ran: 0, failed: 0 };
  }
  const gate = await pythonGate(doc, opts.quiet);
  if (gate !== true) return { ran: 0, failed: 0, blocked: gate };

  // the Python this file carries that came from outside is asked about
  // before anything starts; what the writer wrote here runs without asking
  const code = codeConsent(doc);
  if (code.own.length) await approveCode(doc.fileName, code.own);
  if (code.asked.length) {
    if (!(await askToRunCode(doc, code.asked))) return { ran: 0, failed: 0, blocked: "refused" };
    await approveCode(doc.fileName, code.asked.map((a) => a.key));
  }

  const registry = formulaRegistry(doc);
  const ctx = { lines, registry, rootName, index: pyHostIndex(doc, hosts) };
  const byAddress = new Map(hosts.map((h) => [h.address, h]));
  const resolved = new Map(hosts.map((h) => {
    try { return [h.address, python.resolveHost(h, ctx)]; }
    catch (e) { return [h.address, { code: "", targets: [], deps: [], errors: [e.message], spans: [] }]; }
  }));
  const depsOf = (a) => (resolved.get(a) || { deps: [] }).deps;
  const { order, cycles } = python.orderDerivations(hosts, depsOf);
  const status = statusOf(doc);
  // every outcome keeps the moment it happened, which the end of its line shows
  const mark = (a, s) => status.set(a, Object.assign({ at: new Date() }, s));
  const srcOf = (a) => python.sourceHash(byAddress.get(a).source);
  for (const loop of cycles) {
    for (const a of loop) {
      mark(a, { state: "error", source: srcOf(a), message: `a cycle — ${[...loop, loop[0]].join(" → ")} — none of these can run first` });
    }
  }

  let entry;
  try {
    entry = pySession(doc);
    await entry.starting;
  } catch (e) {
    pyStop(doc.uri.toString(), "failed to start");
    vscode.window.showErrorMessage(`AOT: ${e.message}`);
    return { ran: 0, failed: hosts.length, error: e.message };
  }
  const session = entry.session;
  pyTouch(doc, entry);
  uvDrift(doc, entry.cmd);
  if (opts.mode === "fresh") {
    await session.request({ op: "reset" });
    entry.live.clear();
  }

  // which to run: a derivation is stale when its source, what it reads, or
  // the code it names changed since it last ran
  const index = pyIndex(doc);
  const defs = sidecarDefs(doc);
  const records = Object.assign({}, runRecords(doc));
  const runHashes = new Map();
  for (const a of order) {
    const r = resolved.get(a);
    const h = byAddress.get(a);
    runHashes.set(a, python.runHash(h.source, r.targets, codeHash(doc, h, index, defs), r.deps.map((d) => runHashes.get(d) || "")));
  }
  const stale = (a) => !entry.live.has(a) || !records[a] || records[a].run !== runHashes.get(a);
  let toRun;
  if (opts.mode === "here") {
    // a table row may carry several derivations, one per cell: the one the
    // cursor stands in, or — on the row's name — every one of them
    const onLine = hosts.filter((h) => h.line - 1 === opts.line);
    const inCell = onLine.length > 1 && opts.character !== undefined
      ? onLine.find((h) => {
        const span = pyCellSpan(lines[opts.line] || "", h);
        return span && opts.character >= span.start && opts.character <= span.end;
      })
      : null;
    const here = inCell ? [inCell] : onLine;
    const seeds = here.length ? here.map((h) => h.address) : order.filter(stale);
    toRun = new Set();
    for (const s of seeds) for (const a of python.affected(hosts, depsOf, s, stale)) toRun.add(a);
  } else {
    toRun = new Set(order);
  }
  if (!toRun.size && !constrained) {
    vscode.window.setStatusBarMessage("AOT: every Python derivation is up to date.", 3000);
    return { ran: 0, failed: 0 };
  }

  // a file the run reaches that has not been allowed: asked about, and once
  // allowed the runtime is told and the step tried again. A "no" holds for
  // the rest of this run, so nobody is asked twice about one file.
  const refused = new Set();
  const relOf = (file) => path.relative(aotRoot(doc), file).split(path.sep).join("/");
  const allow = async (consent) => {
    if (refused.has(fileKey(consent.path))) return false;
    if (!(await askToRun(doc, consent))) {
      refused.add(fileKey(consent.path));
      return false;
    }
    await session.request({ op: "approve", files: { [consent.path]: consent.digest } });
    return true;
  };

  // the tree, the repository's Python files and which of them may run, and
  // the sidecar — (re)loaded only when it moved
  const side = sidecarPath(doc);
  for (let attempt = 0; ; attempt++) {
    let sideMtime = null;
    try { sideMtime = fs.statSync(side).mtimeMs; } catch { /* no sidecar */ }
    try {
      await session.request({
        op: "open", file: doc.fileName, root: rootName, aotFiles: aotFilesDir(doc), tree: pyTree(root),
        sidecar: sideMtime === null ? null : side, sidecarMtime: sideMtime,
        repo: aotRoot(doc), pyFiles: index, approved: approvals(),
        install: entry.cmd && entry.cmd.project ? uvenv.installHint(entry.cmd.project, relToRepo(doc, entry.cmd.project)) : null,
      });
      pyDiagnostics.delete(vscode.Uri.file(side));
      break;
    } catch (e) {
      if (e.consent && session.alive && attempt < 10) {
        if (await allow(e.consent)) continue;
        return { ran: 0, failed: 0, blocked: "refused" };
      }
      // the sidecar — or a module it imports — raised as it loaded: say
      // where, and run nothing that might call it
      const where = e.file || side;
      const at = Math.max(0, (e.line || 1) - 1);
      const d = new vscode.Diagnostic(new vscode.Range(at, 0, at, 400), `failed to load — ${e.message}`, vscode.DiagnosticSeverity.Error);
      d.source = "aot-python";
      pyDiagnostics.set(vscode.Uri.file(where), [d]);
      vscode.window.showErrorMessage(`AOT: ${relOf(where)} failed to load — ${e.message}`);
      if (!session.alive) pySessions.delete(doc.uri.toString());
      return { ran: 0, failed: toRun.size, error: e.message };
    }
  }

  for (const a of toRun) status.set(a, Object.assign({}, status.get(a), { state: "running", source: srcOf(a) }));
  chainHintsChanged.fire();
  const results = new Map();
  const failed = new Set(cycles.flat());
  const maxInline = pyConfig().get("python.maxInlineText", 120);
  const versions = pyVersions(entry.hello);
  const started = Date.now();
  let stopped = null;
  for (const a of order) {
    if (!toRun.has(a)) continue;
    const h = byAddress.get(a);
    const r = resolved.get(a);
    const src = srcOf(a);
    if (stopped) {
      failed.add(a);
      mark(a, { state: "skipped", source: src, message: `not run — ${stopped}` });
      continue;
    }
    if (r.errors.length) {
      failed.add(a);
      mark(a, { state: "error", source: src, message: r.errors[0] });
      continue;
    }
    const blocker = r.deps.find((d) => failed.has(d)) || r.deps.find((d) => !entry.live.has(d));
    if (blocker) {
      failed.add(a);
      mark(a, { state: "skipped", source: src, message: `not run — ${blocker} ${failed.has(blocker) ? "failed" : "has no value in this session"}` });
      continue;
    }
    try {
      let resp;
      for (let attempt = 0; ; attempt++) {
        try {
          resp = await session.request({ op: "eval", address: a, code: r.code, targets: r.targets, host: h.kind });
          break;
        } catch (e) {
          if (!e.consent) throw e;
          if (session.alive && attempt < 10 && (await allow(e.consent))) continue;
          throw Object.assign(new Error(`${relOf(e.consent.path)} was not allowed to run — Ctrl+Enter asks again`), { file: e.consent.path });
        }
      }
      entry.live.add(a);
      let out;
      try { out = python.resultOf(h, resp.result, maxInline); } catch (e) {
        failed.add(a);
        mark(a, { state: "error", source: src, message: e.message });
        continue;
      }
      results.set(a, out);
      // the record outlasts the session: when it ran, how long it took, what
      // it wrote — for a bare `=` line, the Concepts, which is what lets
      // `@Sales` elsewhere read the live table and the rows be tinted as its
      const at = new Date();
      // (a Concept with a derivation of its own is that derivation's, never
      // the bare line's, even when the line returns its name: the line
      // leaves it alone — no failure, a warning that two places return it)
      const ownDerived = new Set(hosts.filter((x) => x.kind === "concept").map((x) => x.node.name.toLowerCase()));
      const returned = out.grids ? out.grids.map((g) => g.name) : undefined;
      const concepts = returned ? returned.filter((n) => !ownDerived.has(n.toLowerCase())) : undefined;
      const left = returned ? returned.filter((n) => ownDerived.has(n.toLowerCase())) : [];
      // the rows it wrote, not the rows of what it left alone
      const rows = out.grids
        ? out.grids.filter((g) => !ownDerived.has(g.name.toLowerCase())).reduce((n, g) => n + g.grid.rows.length, 0) : out.count;
      // a Concept it wrote last time and does not return now stays in the file: say so
      const dropped = returned && records[a] && Array.isArray(records[a].concepts)
        ? records[a].concepts.filter((n) => !returned.some((c) => c.toLowerCase() === n.toLowerCase())) : [];
      records[a] = { source: src, run: runHashes.get(a), at: at.toISOString(), ms: resp.ms, rows, ...(concepts ? { concepts } : {}) };
      status.set(a, {
        state: "ok", source: src, ms: resp.ms, rows, stdout: resp.stdout, at, versions,
        columns: resp.result && resp.result.columns, concepts, dropped, left,
      });
    } catch (e) {
      failed.add(a);
      entry.live.delete(a);
      mark(a, { state: "error", source: src, message: e.message, line: e.line });
      if (!session.alive) {
        // the process is gone (a timeout, a crash): nothing else runs in it,
        // and the next run starts a fresh one
        stopped = "the Python session stopped";
        pySessions.delete(doc.uri.toString());
      }
    }
  }
  // a record for a derivation that no longer exists is only clutter
  for (const a of Object.keys(records)) if (!byAddress.has(a)) delete records[a];
  await saveRunRecords(doc, records);

  if (results.size) {
    const written = pythonWrite(doc, hosts, results, status);
    for (const w of written.writes) {
      try {
        fs.mkdirSync(path.dirname(w.abs), { recursive: true });
        fs.writeFileSync(w.abs, w.data);
      } catch (e) {
        vscode.window.showErrorMessage(`AOT: could not write ${path.basename(w.abs)} — ${e.message}`);
      }
    }
    // every table a result widened is square in the same edit
    await replaceDocumentLines(editor, aligned(doc, written.lines));
  }
  // the constraints, held to the values as they now stand — Python's fresh
  // ones among them
  const held = await checkConstraints(editor, session, allow);
  pythonFindings(doc);
  chainHintsChanged.fire();
  const ran = results.size;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const parts = [];
  if (hosts.length) parts.push(`${ran} Python derivation${ran === 1 ? "" : "s"} ran${failed.size ? `, ${failed.size} did not` : ""}`);
  if (held.checked) parts.push(`${held.checked} constrained value${held.checked === 1 ? "" : "s"} checked${held.broken ? `, ${held.broken} broken` : ""}`);
  if (held.defined) parts.push(`${held.defined} defined`);
  if (held.errors) parts.push(`${held.errors} bound${held.errors === 1 ? "" : "s"} failed`);
  const trouble = failed.size || held.broken || held.errors;
  vscode.window.setStatusBarMessage(`AOT: ${parts.join("; ") || "nothing to run"}${trouble ? " — see the Problems panel." : ` in ${secs} s.`}`, 5000);
  return { ran, failed: failed.size, broken: held.broken, defined: held.defined };
}

// --- the constraints --------------------------------------------------------
// A constraint's bound is Python, run with the derivations and never
// otherwise: each value it holds is checked in one batch, a value that breaks
// it is a warning, and a `==` whose bound is one value writes that value into
// every value of the attribute that has no derivation of its own. What a
// check found is remembered, keyed to the text it was about, so an edit to
// that text retires it until the next run.

const pyChecks = new Map(); // uri -> [{ line, cell?, text?, needle?, message, severity }]

async function checkConstraints(editor, session, allow) {
  const doc = editor.document;
  const tally = { checked: 0, broken: 0, defined: 0, errors: 0 };
  const findings = [];
  pyChecks.set(doc.uri.toString(), findings);
  const checks = constraintChecksIn(doc);
  if (!checks.length) return tally;
  const rootName = docRootName(doc);
  const lines = doc.getText().split(/\r?\n/);
  let registry;
  try { registry = formulaRegistry(doc); } catch { registry = undefined; }
  const hosts = pythonHostsIn(doc);
  const plan = python.checkItems(checks, { lines, registry, rootName, index: pyHostIndex(doc, hosts) });
  const sent = plan.filter((p) => p.item);
  let answers = [];
  if (sent.length) {
    for (let attempt = 0; ; attempt++) {
      try {
        answers = (await session.request({ op: "checks", items: sent.map((p) => p.item) })).results || [];
        break;
      } catch (e) {
        if (e.consent && session.alive && attempt < 10 && (await allow(e.consent))) continue;
        answers = sent.map(() => ({ ok: false, error: e.message }));
        break;
      }
    }
  }
  const answerOf = new Map(sent.map((p, k) => [p, answers[k] || { ok: false, error: "no answer" }]));

  // where a finding stands: on the value, or — for a bound that failed — on
  // the clause of the declaration that wrote it
  const onValue = (check, message, severity) => findings.push({
    line: check.host.line - 1, cell: check.host.cell ? check.host.cell.col : null, text: check.value, message, severity,
  });
  const failedBounds = new Set();
  const onBound = (p, message) => {
    const key = `${p.check.a.line}:${p.k}:${message}`;
    if (failedBounds.has(key)) return;
    failedBounds.add(key);
    tally.errors++;
    if (p.clause.parked) return onValue(p.check, message, vscode.DiagnosticSeverity.Error);
    // found on its line as written: `=` where the writer wrote one, though it means `==`
    findings.push({ line: p.check.a.line - 1, needle: (p.clause.opText || p.clause.op) + p.clause.formula, message, severity: vscode.DiagnosticSeverity.Error });
  };
  const said = (p) => `'${p.check.a.name} ${p.clause.opText || p.clause.op}${p.clause.formula}'`;
  const maxInline = pyConfig().get("python.maxInlineText", 120);
  let next = lines;
  const counted = new Set();
  for (const p of plan) {
    const { check } = p;
    if (!counted.has(check)) { counted.add(check); if (!check.definesOnly) tally.checked++; }
    if (p.errors.length) { onBound(p, `Python: the bound ${said(p)} — ${p.errors[0]}`); continue; }
    const r = answerOf.get(p);
    if (!r.ok) { onBound(p, `Python: the bound ${said(p)} failed — ${r.error}`); continue; }
    if (r.define && !check.derived) {
      // one value: the attribute is defined by it
      let out;
      try { out = python.resultOf({ kind: check.host.kind, value: check.value, address: "@constraint" }, r.define, maxInline); }
      catch (e) { onBound(p, `Python: the bound ${said(p)} — ${e.message}`); continue; }
      if (out.file || out.grid) { onBound(p, `Python: ${said(p)} defines a value too large for a line — a bound computes one value`); continue; }
      // the result as written (escaped) against the value as read: compared
      // the same way, or an escaped value would count as changed every run
      if (table.readValue(out.text) !== check.value) {
        next = python.writeValue(next, check.host, out.text);
        tally.defined++;
      }
      continue;
    }
    if (check.definesOnly || r.holds) continue;
    tally.broken++;
    onValue(check, `'${check.value}' breaks ${said(p)} — it is not ${p.clause.op === "==" ? "" : p.clause.op + " "}${r.bound}`,
      vscode.DiagnosticSeverity.Warning);
  }
  if (next !== lines) await replaceDocumentLines(editor, aligned(doc, next));
  return tally;
}

// The findings the last check left that still describe the text: a value
// finding while its value reads as it did, a bound's while its clause is
// still written there.
function checkFindings(doc) {
  const out = [];
  for (const f of pyChecks.get(doc.uri.toString()) || []) {
    if (f.line >= doc.lineCount) continue;
    const raw = doc.lineAt(f.line).text;
    let start = -1, length = 0;
    if (f.needle !== undefined) {
      start = raw.indexOf(f.needle);
      length = f.needle.length;
    } else if (f.cell !== null) {
      // the value as written (escapes and all) is what stands on the line,
      // the value as read is what the finding names
      const cell = table.cells(raw)[f.cell];
      const written = cell ? table.splitCell(cell.text).value : "";
      if (cell && table.readValue(written) === f.text) { start = cell.col; length = Math.max(1, written.length); }
    } else {
      const d = python.valueDerivation(raw);
      const colon = raw.indexOf(":");
      const at = d ? d.valueStart : colon === -1 ? -1 : colon + 1 + (raw.slice(colon + 1).length - raw.slice(colon + 1).trimStart().length);
      const value = d ? d.value : raw.slice(at).trim();
      if (at !== -1 && table.readValue(value) === f.text) { start = at; length = Math.max(1, value.length); }
    }
    if (start === -1) continue;
    const d = new vscode.Diagnostic(new vscode.Range(f.line, start, f.line, start + length), f.message, f.severity);
    d.source = "aot-python";
    out.push(d);
  }
  return out;
}

// What the results write, as fresh lines plus the files to write into
// aot.files. Values first — they never change the line count — then each
// Concept's table, from the bottom up so the lines above stay where the
// parse left them.
function pythonWrite(doc, hosts, results, status) {
  let lines = doc.getText().split(/\r?\n/);
  const writes = [];
  const dir = aotFilesDir(doc);
  for (const h of hosts) {
    if (h.kind === "concept" || h.kind === "generator" || !results.has(h.address)) continue;
    const out = results.get(h.address);
    let text = out.text;
    if (out.file) {
      const abs = path.resolve(dir, out.file);
      // the name is the address, reduced to safe characters — and checked
      // anyway: nothing a derivation returns writes outside aot.files
      if (!isInside(dir, abs)) {
        status.set(h.address, { state: "error", source: python.sourceHash(h.source), message: `refused to write '${out.file}' outside aot.files` });
        continue;
      }
      writes.push({ abs, data: out.bytes || out.body });
      text = "aot.files/" + out.file;
    }
    lines = python.writeValue(lines, h, text);
  }
  const concepts = hosts.filter((h) => h.kind === "concept" && results.has(h.address)).sort((a, b) => b.line - a.line);
  for (const h of concepts) lines = python.writeGrid(lines, h.node, results.get(h.address).grid);
  // last, the bare `=` lines: each finds its Concepts afresh, by name, in the
  // lines as they now stand — a table written above moves everything below
  const generators = hosts.filter((h) => h.kind === "generator" && results.has(h.address));
  for (const h of generators) {
    const w = python.writeGenerated(lines, h, results.get(h.address).grids, docRootName(doc));
    lines = w.lines;
    if (w.errors.length) {
      status.set(h.address, Object.assign({}, status.get(h.address), {
        state: "error", source: python.sourceHash(h.source), message: w.errors.join("; "), at: new Date(),
      }));
    }
  }
  return { lines, writes };
}

// The lines with every table re-aligned, so a column Python widened is
// square in the same edit.
function aligned(doc, lines) {
  const text = lines.join("\n");
  try {
    const edits = table.align(text, formulaRegistry(doc), docRootName(doc));
    return edits.length ? applyLineEdits(lines, edits) : lines;
  } catch { return lines; }
}

// Replace only the lines that changed, in one undoable edit, so a cursor
// outside them stays exactly where it was.
function replaceDocumentLines(editor, next) {
  const doc = editor.document;
  const old = doc.getText().split(/\r?\n/);
  let a = 0;
  while (a < old.length && a < next.length && old[a] === next[a]) a++;
  if (a === old.length && a === next.length) return Promise.resolve(true);
  let b = 0;
  while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const from = a, to = old.length - 1 - b; // old lines from..to (inclusive) go
  const mid = next.slice(a, next.length - b);
  return editor.edit((e) => {
    if (to >= from && mid.length) {
      e.replace(new vscode.Range(from, 0, to, old[to].length), mid.join(eol));
    } else if (mid.length) {
      // a pure insertion before line `from`
      if (from < old.length) e.insert(new vscode.Position(from, 0), mid.join(eol) + eol);
      else e.insert(new vscode.Position(old.length - 1, old[old.length - 1].length), eol + mid.join(eol));
    } else if (to + 1 < old.length) {
      e.replace(new vscode.Range(from, 0, to + 1, 0), "");
    } else if (from > 0) {
      e.replace(new vscode.Range(from - 1, old[from - 1].length, to, old[to].length), "");
    } else {
      e.replace(new vscode.Range(0, 0, to, old[to].length), "");
    }
  });
}

// --- what the editor shows --------------------------------------------------

// What a bare `=` line is told when it returned Concepts that a derivation
// of their own writes: no failure — it ran, and wrote the rest — but one
// Concept said in two places, which the writer settles by keeping one.
function leftAloneMessage(names) {
  const quoted = names.map((n) => `'${n}'`);
  const list = quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
  return quoted.length === 1
    ? `this line returns ${list}, which has a derivation of its own — that one writes its rows, and this line leaves it alone; return it from one place only`
    : `this line returns ${list}, which have derivations of their own — those write their rows, and this line leaves them alone; return each from one place only`;
}

// The Python findings for a document, into their own collection: a failed
// run, a reference naming nothing, a cycle, a value that broke its
// constraint when last checked, a bound that failed, and — as information — a
// derivation that has not run, or was edited since it did. Also works out
// which values are older than their derivation, for the dimming.
function pythonFindings(doc) {
  if (!pyDiagnostics || doc.languageId !== "aot") return;
  const hosts = pythonHostsIn(doc);
  const out = [];
  const dims = [];
  if (hosts.length) {
    const rootName = docRootName(doc);
    const lines = doc.getText().split(/\r?\n/);
    const status = statusOf(doc);
    const records = runRecords(doc);
    let registry;
    try { registry = formulaRegistry(doc); } catch { registry = undefined; }
    const ctx = { lines, registry, rootName, index: pyHostIndex(doc, hosts) };
    const resolved = new Map();
    for (const h of hosts) {
      try { resolved.set(h.address, python.resolveHost(h, ctx)); }
      catch (e) { resolved.set(h.address, { errors: [e.message], deps: [], targets: [] }); }
    }
    const depsOf = (a) => (resolved.get(a) || { deps: [] }).deps || [];
    const { order, cycles } = python.orderDerivations(hosts, depsOf);
    const cyclic = new Map();
    for (const loop of cycles) for (const a of loop) cyclic.set(a, loop);
    const index = pyIndex(doc);
    const defs = sidecarDefs(doc);
    const byAddress = new Map(hosts.map((h) => [h.address, h]));
    const runHashes = new Map();
    for (const a of order) {
      const r = resolved.get(a);
      const h = byAddress.get(a);
      runHashes.set(a, python.runHash(h.source, r.targets || [], codeHash(doc, h, index, defs), depsOf(a).map((d) => runHashes.get(d) || "")));
    }
    const off = pythonEnabled() ? "" : " (aot.python.enabled is off)";
    for (const h of hosts) {
      const range = new vscode.Range(h.line - 1, h.startCol, h.line - 1, h.endCol);
      const src = python.sourceHash(h.source);
      const s = status.get(h.address);
      const r = resolved.get(h.address);
      const mk = (message, severity) => {
        const d = new vscode.Diagnostic(range, message, severity);
        d.source = "aot-python";
        return d;
      };
      if (!h.source) continue; // the linter already says a bare '=' is empty
      if (cyclic.has(h.address)) {
        const loop = cyclic.get(h.address);
        out.push(mk(`Python cycle — ${[...loop, loop[0]].join(" → ")} — none of these can run first`, vscode.DiagnosticSeverity.Error));
        continue;
      }
      if (r.errors && r.errors.length) {
        out.push(mk(`Python: ${r.errors[0]}`, vscode.DiagnosticSeverity.Error));
        continue;
      }
      if (s && s.source === src && s.state === "error") {
        out.push(mk(`Python failed — ${s.message}`, vscode.DiagnosticSeverity.Error));
        continue;
      }
      if (s && s.source === src && s.state === "skipped") {
        out.push(mk(`Python did not run — ${s.message.replace(/^not run — /, "")}`, vscode.DiagnosticSeverity.Warning));
        continue;
      }
      // a bare line that returned a Concept whose own derivation writes it
      // ran fine — the Concept just has two places saying what it holds
      if (s && s.source === src && s.state === "ok" && s.left && s.left.length) {
        out.push(mk(leftAloneMessage(s.left), vscode.DiagnosticSeverity.Warning));
        continue;
      }
      const rec = records[h.address];
      if (!rec) {
        out.push(mk(`not run yet — Ctrl+Enter runs it${off}`, vscode.DiagnosticSeverity.Information));
        continue;
      }
      const why = rec.source !== src ? "edited since it last ran"
        : rec.run !== runHashes.get(h.address) ? "something it reads changed since it last ran" : null;
      if (!why) continue;
      out.push(mk(`Python ${why} — Ctrl+Enter runs it${off}`, vscode.DiagnosticSeverity.Information));
      const span = pyValueSpan(doc, h);
      if (span) dims.push({ range: span, hoverMessage: `An older result: this derivation was ${why}. Ctrl+Enter brings it up to date.` });
    }
  }
  out.push(...checkFindings(doc));
  pyDiagnostics.set(doc.uri, out);
  pyDims.set(doc.uri.toString(), dims);
}

// The whole of a cell host's cell on its row, pipe to pipe — { start, end },
// end inclusive, so a cursor standing just before the next divider is still
// in it — or null for a host that is not a cell. What Ctrl+Enter and hover
// go by when a row carries several derivations side by side.
function pyCellSpan(raw, h) {
  if (h.kind !== "cell") return null;
  const ds = table.dividers(raw);
  const k = h.cell.col;
  // (a host read off this very row always has its cell among its dividers)
  return k > ds.length ? null : { start: k === 0 ? 0 : ds[k - 1] + 1, end: k < ds.length ? ds[k] : raw.length };
}

// Where a host's written value stands: the text in front of its derivation.
// A cell's is read off its own cell, so a row holding the same value twice
// fades the right one.
function pyValueSpan(doc, h) {
  if (h.kind === "concept" || !h.value) return null;
  const raw = doc.lineAt(h.line - 1).text;
  let start;
  if (h.kind === "cell") {
    const cell = table.cells(raw)[h.cell.col];
    if (!cell || !cell.text.startsWith(h.value)) return null;
    start = cell.col;
  } else {
    start = (python.valueDerivation(raw) || {}).valueStart;
  }
  if (start === undefined || start < 0) return null;
  return new vscode.Range(h.line - 1, start, h.line - 1, start + h.value.length);
}

// The rows of every table a Concept's inline derivation wrote, marked as
// computed — they are Python's, and a row typed into them is replaced on the
// next run. (A parked derivation's rows are marked by parkedMarks.)
function pythonMarks(doc) {
  if (doc.languageId !== "aot" || !pyConfig().get("parkedValueMarks", true)) return [];
  let parsed;
  try { parsed = parsedDoc(doc); } catch { return []; }
  const lines = doc.getText().split(/\r?\n/);
  const out = [];
  for (const node of parsed.nodes) {
    if (node.kind !== KIND.CONCEPT || node.formula === undefined) continue;
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**Written by Python** — ${codeSpan("=" + node.formula)}\n\n`);
    md.appendMarkdown(`Every row of '${node.name}' is this derivation's: a row typed or changed here is replaced the next time it runs `
      + "([Ctrl+Enter](command:aot.runPython)). Change the Python instead.");
    for (const r of park.ownedRows(lines, node)) {
      out.push({ range: new vscode.Range(r.line - 1, r.startCol, r.line - 1, r.endCol), hoverMessage: md });
    }
  }
  // the Concepts a bare `=` line wrote, while the line is there to own them
  const generated = generatedConcepts(doc);
  for (const h of pythonHostsIn(doc)) {
    if (h.kind !== "generator") continue;
    for (const name of generated.get(h.address) || []) {
      const node = parsed.nodes.find((n) => n.kind === KIND.CONCEPT && n.name.toLowerCase() === name.toLowerCase());
      if (!node || node.formula !== undefined) continue;
      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.appendMarkdown(`**Written by Python** — ${codeSpan("=" + h.source)}, the line on ${h.line}\n\n`);
      md.appendMarkdown(`Every row of '${node.name}' is that line's: a row typed or changed here is replaced the next time it runs `
        + "([Ctrl+Enter](command:aot.runPython)). Change the Python instead.");
      for (const r of park.ownedRows(lines, node)) {
        out.push({ range: new vscode.Range(r.line - 1, r.startCol, r.line - 1, r.endCol), hoverMessage: md });
      }
    }
  }
  return out;
}

// End-of-line notes on each derivation: running, how long it took, how many
// rows it wrote, what went wrong — or that it was edited since it ran.
// When a derivation ran, written the way the file writes a date: `16:04`
// today, `2026-09-23 16:04` on any other day — so a run that is not today's
// reads as old at a glance. Local time: it is the writer's own clock.
const pad2 = (n) => String(n).padStart(2, "0");
function ranAt(at, now) {
  const d = at instanceof Date ? at : new Date(at);
  if (!at || isNaN(d.getTime())) return "";
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return d.toDateString() === (now || new Date()).toDateString() ? time : `${ranDay(d)} ${time}`;
}
const ranDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// ...and whole, to the second, where there is room for it: a tooltip, a hover
function ranStamp(at) {
  const d = at instanceof Date ? at : new Date(at);
  if (!at || isNaN(d.getTime())) return "";
  return `${ranDay(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// What a run found, as the end of a line says it: rows, then time taken.
const ranWhat = (rows, ms) =>
  [rows !== undefined && rows !== null ? `${rows} row${rows === 1 ? "" : "s"}` : "", ms !== undefined && ms !== null ? `${ms} ms` : ""]
    .filter(Boolean).join(" · ");

// How one derivation last ran, as its inlay says it: { state, label,
// tooltip, ms, rows, at, message } — state one of running, error, skipped,
// edited, ok — or null when it has never run.
function pyRunNote(h, s, rec) {
  const src = python.sourceHash(h.source);
  const when = (at) => (ranAt(at) ? ` · ${ranAt(at)}` : "");
  if (s && s.source === src && s.state !== "ok") {
    if (s.state === "running") return { state: "running", label: "⟳ running", tooltip: "" };
    if (s.state === "error") {
      return {
        state: "error", message: s.message, at: s.at,
        label: `✗ ${s.message.length > 60 ? s.message.slice(0, 57) + "…" : s.message}${when(s.at)}`,
        tooltip: [s.message, s.at ? `failed ${ranStamp(s.at)}` : "", rec ? `last ran ${ranStamp(rec.at)}` : ""].filter(Boolean).join("\n"),
      };
    }
    // skipped: the one state a run marks besides these and ok
    return {
      state: "skipped", message: s.message, at: s.at, label: `– not run${when(s.at)}`,
      tooltip: [s.message, rec ? `last ran ${ranStamp(rec.at)}` : ""].filter(Boolean).join("\n"),
    };
  }
  if (rec && rec.source === src) {
    // the last successful run — from this session, or from the run records,
    // which outlast it: a restart does not forget when a value was computed
    const fresh = s && s.source === src && s.state === "ok" ? s : null;
    const rows = fresh ? fresh.rows : rec.rows;
    const ms = fresh ? fresh.ms : rec.ms;
    // a bare `=` line says how many Concepts it wrote, and names any it
    // wrote before and no longer does — those stay in the file — and any it
    // returned that a derivation of their own writes, which it left alone
    const concepts = (fresh && fresh.concepts) || rec.concepts;
    const dropped = (fresh && fresh.dropped) || [];
    const left = (fresh && fresh.left) || [];
    const what = [concepts ? `${concepts.length} Concept${concepts.length === 1 ? "" : "s"}` : "", ranWhat(rows, ms)]
      .filter(Boolean).join(" · ");
    return {
      state: "ok", rows, ms, at: rec.at,
      label: `✓ ${what ? what + " · " : ""}${ranAt(rec.at) || "ran"}${dropped.length ? ` · '${dropped[0]}' no longer written` : ""}`
        + `${left.length ? ` · '${left[0]}' left to its own derivation` : ""}`,
      tooltip: [`ran ${ranStamp(rec.at)}`, concepts ? `wrote ${concepts.join(", ")}` : "",
        dropped.length ? `no longer written: ${dropped.join(", ")} — still in the file; delete ${dropped.length === 1 ? "it" : "them"} if gone` : "",
        left.length ? `left alone: ${left.join(", ")} — ${left.length === 1 ? "its own derivation writes its" : "their own derivations write their"} rows` : "",
        fresh && fresh.versions, fresh && fresh.stdout ? `printed:\n${fresh.stdout}` : ""]
        .filter(Boolean).join("\n"),
    };
  }
  if (rec) {
    return {
      state: "edited", at: rec.at, label: `✎ edited since ${ranAt(rec.at) || "it ran"} — Ctrl+Enter`,
      tooltip: `last ran ${ranStamp(rec.at)}, before this edit`,
    };
  }
  return null;
}

// A table row may carry several derivations, one per cell. They share the
// row's one end, so they share one inlay, and it names the cells: the worst
// news first (running, a failure, one not run, one edited since), else every
// cell that ran. The tooltip has a line for each.
function combinedRunNote(notes) {
  const named = (n) => `${n.cell}: `;
  const time = (at) => (ranAt(at) ? ` · ${ranAt(at)}` : "");
  const worst = ["running", "error", "skipped", "edited"].map((state) => notes.find((n) => n.state === state)).find(Boolean);
  let label;
  if (worst && worst.state === "running") label = "⟳ running";
  else if (worst && worst.state === "error") {
    const said = `${named(worst)}${worst.message}`;
    label = `✗ ${said.length > 60 ? said.slice(0, 57) + "…" : said}${time(worst.at)}`;
  } else if (worst && worst.state === "skipped") label = `– ${worst.cell} not run${time(worst.at)}`;
  else if (worst) label = `✎ ${worst.cell} edited since ${ranAt(worst.at) || "it ran"} — Ctrl+Enter`;
  else {
    const ms = notes.reduce((sum, n) => sum + (Number(n.ms) || 0), 0);
    const latest = notes.map((n) => n.at).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
    label = `✓ ${notes.map((n) => n.cell).join(", ")} · ${ms} ms${time(latest)}`;
  }
  const tooltip = notes.map((n) => `${named(n)}${n.label}${n.tooltip ? `\n    ${n.tooltip.split("\n").join("\n    ")}` : ""}`).join("\n");
  return { label, tooltip };
}

function pythonInlays(doc, range) {
  const status = pyStatus.get(doc.uri.toString());
  const records = runRecords(doc);
  const byLine = new Map(); // line -> [note]
  for (const h of pythonHostsIn(doc)) {
    const line = h.line - 1;
    if (line < range.start.line || line > range.end.line || line >= doc.lineCount) continue;
    const note = pyRunNote(h, status && status.get(h.address), records[h.address]);
    if (!note) continue;
    // a cell is named by its column, the second part of its address
    note.cell = h.kind === "cell" ? String(h.address).split("@")[2] : "";
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line).push(note);
  }
  const out = [];
  for (const [line, notes] of byLine) {
    const { label, tooltip } = notes.length === 1 ? notes[0] : combinedRunNote(notes);
    const hint = new vscode.InlayHint(doc.lineAt(line).range.end, label);
    hint.paddingLeft = true;
    if (tooltip) hint.tooltip = tooltip;
    out.push(hint);
  }
  return out;
}

// The Python host on a line and whether a position falls in its derivation.
function pyHostAt(doc, position) {
  return pythonHostsIn(doc).find((h) => h.line - 1 === position.line
    && position.character >= h.startCol && position.character <= h.endCol) || null;
}

// The identifier under the cursor on a line.
function wordAt(text, character) {
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  while ((m = re.exec(text))) {
    if (character >= m.index && character <= m.index + m[0].length) return { word: m[0], start: m.index };
  }
  return null;
}

// The repository file a dotted module name in a derivation reaches —
// `finance`, `tools.finance` — resolved as the runtime resolves it; for a
// package, its __init__. null when it names none of the repository's, or
// more than one.
function moduleFileOf(doc, dotted) {
  const parts = dotted.split(".");
  const root = aotRoot(doc), af = aotFilesDir(doc), index = pyIndex(doc);
  const listed = (f) => index.find((x) => fileKey(x) === fileKey(f)) || null;
  for (const base of [af, root]) {
    const hit = listed(path.join(base, ...parts) + ".py") || listed(path.join(base, ...parts, "__init__.py"));
    if (hit) return hit;
  }
  if (parts.length > 1) return null;
  const hits = python.moduleFiles(parts[0], index, root, af);
  return hits.length === 1 ? hits[0] : null;
}

// The file aot.use("…") loads: in aot.files, else from the repository's root.
function usedFileOf(doc, rel) {
  for (const base of [aotFilesDir(doc), aotRoot(doc)]) {
    const f = path.resolve(base, rel);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// The function under the cursor in a derivation and the file defining it: a
// module's (finance.revenue, tools.finance.revenue, aot.use("x.py").total),
// or the sidecar's for a bare name. { file, def, start, word } or null.
function pyFunctionAt(doc, position) {
  const line = doc.lineAt(position.line).text;
  const w = wordAt(line, position.character);
  if (!w) return null;
  const before = line.slice(0, w.start);
  let file = null;
  const used = /aot\.use\(\s*(["'])(.*?)\1\s*\)\.$/.exec(before);
  const dotted = /(?<![\w.@])([A-Za-z_][\w.]*)\.$/.exec(before);
  if (used) file = usedFileOf(doc, used[2]);
  else if (dotted) file = moduleFileOf(doc, dotted[1]);
  else if (!/\.\s*$/.test(before)) {
    // the sidecar's own, or one it imports from elsewhere in the repository
    const hit = resolveCall(doc, { module: "", name: w.word, used: null });
    return hit ? { file: hit.file, def: hit.def, start: w.start, word: w.word } : null;
  }
  if (!file) return null;
  const def = fileDefs(file).get(w.word);
  return def ? { file, def, start: w.start, word: w.word } : null;
}

const relToRoot = (doc, file) => path.relative(aotRoot(doc), file).split(path.sep).join("/");

// Ctrl+click on a function inside a derivation opens its `def` — in the
// sidecar, or in whichever repository file the module it is called on is.
function pythonDefinition(doc, position) {
  if (!pyHostAt(doc, position)) return null;
  const hit = pyFunctionAt(doc, position);
  return hit ? new vscode.Location(vscode.Uri.file(hit.file), new vscode.Range(hit.def.line, 0, hit.def.line, 0)) : null;
}

// Hover in a derivation: a function's signature, docstring and file; on a
// computed value, what computed it and when.
function pythonHover(doc, position) {
  // a table row may carry several derivations: the one whose code, or whose
  // value, the pointer is over
  const onLine = pythonHostsIn(doc).filter((x) => x.line - 1 === position.line);
  if (!onLine.length) return null;
  if (onLine.some((x) => position.character >= x.startCol && position.character <= x.endCol)) {
    const hit = pyFunctionAt(doc, position);
    if (!hit) return null;
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`${codeSpan(hit.def.signature)} — defined in \`${relToRoot(doc, hit.file)}\` line ${hit.def.line + 1}`);
    if (hit.def.doc) md.appendMarkdown(`\n\n${hit.def.doc}`);
    return new vscode.Hover(md, new vscode.Range(position.line, hit.start, position.line, hit.start + hit.word.length));
  }
  let span = null;
  const h = onLine.find((x) => {
    span = pyValueSpan(doc, x);
    return span && span.contains(position);
  });
  if (!h) return null;
  const s = (pyStatus.get(doc.uri.toString()) || new Map()).get(h.address);
  const rec = runRecords(doc)[h.address];
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Computed by Python** — ${codeSpan("=" + h.source)}\n\n`);
  if (s && s.state === "ok") {
    md.appendMarkdown(`Ran ${ranStamp(s.at)} in ${s.ms} ms${s.versions ? ` · ${s.versions}` : ""}.`);
    if (s.stdout) md.appendMarkdown(`\n\nPrinted:\n\n${codeSpan(s.stdout.trim().slice(0, 400))}`);
  } else if (rec) {
    md.appendMarkdown(`Last ran ${ranStamp(rec.at)}${rec.ms !== undefined ? ` in ${rec.ms} ms` : ""}. Ctrl+Enter runs it again.`);
  } else {
    md.appendMarkdown("Not run yet — Ctrl+Enter runs it.");
  }
  return new vscode.Hover(md, span);
}

// The module names the repository's Python files answer to at the head of a
// derivation: each file's name, and each folder holding Python at the top of
// aot.files or the root — name -> the file or folder, relative to the root.
function repoModuleNames(doc) {
  const root = aotRoot(doc), af = aotFilesDir(doc);
  const out = new Map();
  for (const f of pyIndex(doc)) {
    const stem = path.basename(f, ".py");
    if (stem !== "__init__" && /^[A-Za-z_]\w*$/.test(stem) && !out.has(stem)) out.set(stem, relToRoot(doc, f));
    for (const base of [af, root]) {
      const rel = path.relative(base, f);
      const top = rel.split(path.sep)[0];
      if (!rel.startsWith("..") && rel.includes(path.sep) && /^[A-Za-z_]\w*$/.test(top) && !out.has(top)) {
        out.set(top, relToRoot(doc, path.join(base, top)) + "/");
      }
    }
  }
  return out;
}

// Completion inside Python: after '=' the sidecar's functions, the names
// every derivation has and the repository's modules; after `module.` that
// module's functions; after `@Name.` the columns of that table.
const PY_PRELOADED = ["pd", "np", "plt", "sns", "stats", "math", "statistics", "re", "json", "random",
  "itertools", "functools", "Path", "date", "datetime", "timedelta", "Decimal", "Counter", "defaultdict",
  "Image", "requests", "relativedelta", "aot"];
const pythonCompletion = {
  provideCompletionItems(doc, position) {
    const before = doc.lineAt(position.line).text.slice(0, position.character);
    const dot = /@([\p{L}\p{N}_ ]+?)\.([A-Za-z_]\w*)?$/u.exec(before);
    if (dot) {
      const name = dot[1].trim().toLowerCase();
      const cols = new Set();
      const status = pyStatus.get(doc.uri.toString()) || new Map();
      for (const h of pythonHostsIn(doc)) {
        const own = h.kind === "concept" ? h.node.name : h.node ? h.node.name : "";
        const s = status.get(h.address);
        if (own.toLowerCase() === name && s && s.columns) s.columns.forEach((c) => cols.add(c));
      }
      try {
        const scope = formulaRegistry(doc).scopes.get(name);
        if (scope) scope.columns.forEach((c) => cols.add(c));
      } catch { /* no registry: the run's columns are enough */ }
      return [...cols].map((c) => {
        const item = new vscode.CompletionItem(c.includes(" ") ? `["${c}"]` : c, vscode.CompletionItemKind.Field);
        item.detail = `a column of @${dot[1].trim()}`;
        return item;
      });
    }
    const fnItem = (name, def, file) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
      item.detail = `${def.signature} — ${relToRoot(doc, file)}`;
      if (def.doc) item.documentation = def.doc;
      return item;
    };
    // a module's functions, after its name and a dot — in a derivation only
    const member = /(?<![\w.@])((?:[A-Za-z_]\w*\.)+)\w*$/.exec(before);
    const used = /aot\.use\(\s*(["'])(.*?)\1\s*\)\.\w*$/.exec(before);
    if ((member || used) && /(^|\s)=/.test(before)) {
      const file = used ? usedFileOf(doc, used[2]) : moduleFileOf(doc, member[1].slice(0, -1));
      return file ? [...fileDefs(file)].map(([name, def]) => fnItem(name, def, file)) : [];
    }
    // the head of a derivation: '=' opening it, and at most the name being typed
    if (!/(^|\s)=\s*[A-Za-z_]?\w*$/.test(before)) return [];
    const items = [];
    for (const [name, def] of sidecarDefs(doc)) items.push(fnItem(name, def, sidecarPath(doc)));
    for (const name of PY_PRELOADED) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
      item.detail = "available in every Python derivation";
      items.push(item);
    }
    for (const [name, where] of repoModuleNames(doc)) {
      if (PY_PRELOADED.includes(name)) continue;
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
      item.detail = `${where} — a module of this repository`;
      items.push(item);
    }
    return items;
  },
};

// --- the commands -----------------------------------------------------------

async function runPythonHere(editor) {
  // a file with no Python keeps Ctrl+Enter's ordinary meaning
  if (!pythonWorkIn(editor.document)) {
    return vscode.commands.executeCommand("editor.action.insertLineAfter");
  }
  return runPython(editor, { mode: "here", line: editor.selection.active.line, character: editor.selection.active.character });
}

async function showPythonEnvironment() {
  const editor = vscode.window.activeTextEditor;
  const doc = editor && editor.document;
  if (!doc || doc.languageId !== "aot") {
    return vscode.window.showInformationMessage("AOT: open an .aot file to see the Python it would run with.");
  }
  if (!pythonEnabled() || !workspaceTrusted()) return pythonGate(doc, false);
  const SET_UP = "Set Up Python Environment";
  const offerSetUp = (pick) => (pick === SET_UP ? vscode.commands.executeCommand("aot.setUpPython") : undefined);
  let entry;
  try {
    entry = pySession(doc);
    await entry.starting;
    pyTouch(doc, entry);
  } catch (e) {
    pyStop(doc.uri.toString(), "failed to start");
    return vscode.window.showErrorMessage(`AOT: ${e.message}`, SET_UP).then(offerSetUp);
  }
  const h = entry.hello;
  const project = entry.cmd && entry.cmd.project;
  const libs = Object.entries(h.libraries || {});
  const missing = libs.filter(([, v]) => !v).map(([k]) => k);
  const g = h.guards || {};
  const withheld = (entry.withheld || []).length;
  const detail = [
    project ? `uv environment: ${relToRepo(doc, project)}/${path.basename(uvenv.venvDir(project, process.platform))}` : `No uv environment — the interpreter aot.python.path names, else ${python.defaultPythons(process.platform).join(" or ")} on PATH`,
    h.executable, "",
    ...libs.map(([k, v]) => `${v ? "✓" : "✗"} ${k}${v ? " " + v : ""}`), "",
    "Held to:",
    `  memory — ${g.memory || "not limited"}`,
    `  other programs — ${g.subprocess || "allowed"}`,
    `  the network — ${g.network || "allowed"}`,
    `  credentials — ${g.credentials || "not protected"}${withheld ? `; ${withheld} environment variable${withheld === 1 ? "" : "s"} holding secrets withheld` : ""}`,
    "Python's own guards stop the ordinary calls, not code written to get round them.", "",
    !missing.length ? "Everything listed is installed."
      : project ? `Add what you need of the rest to ${relToRepo(doc, project)}/pyproject.toml, then run AOT: Set Up Python Environment.`
        : `Install the rest with:\n"${h.executable}" -m pip install ${missing.join(" ")}\n\nor give this repository an environment of its own with AOT: Set Up Python Environment (uv).`,
  ].join("\n");
  return vscode.window.showInformationMessage(`AOT: Python ${h.python}`, { modal: true, detail }, SET_UP).then(offerSetUp);
}

// A name the derivation calls that no one defines: the builtins, the
// preloaded names and Python's own words are everyone's.
const PY_BUILTINS = new Set([
  "abs", "all", "any", "ascii", "bin", "bool", "bytes", "callable", "chr", "complex", "dict", "dir",
  "divmod", "enumerate", "filter", "float", "format", "frozenset", "getattr", "hasattr", "hash", "hex",
  "id", "int", "isinstance", "issubclass", "iter", "len", "list", "map", "max", "min", "next", "object",
  "oct", "open", "ord", "pow", "print", "range", "repr", "reversed", "round", "set", "slice", "sorted",
  "str", "sum", "super", "tuple", "type", "vars", "zip", "exit", "quit", "_aot_ref",
  "if", "else", "for", "in", "not", "and", "or", "lambda", "is", "print",
]);
function undefinedCalls(doc, source) {
  const defs = sidecarDefs(doc);
  const out = [];
  for (const m of source.matchAll(/(?<![.\w@])([A-Za-z_]\w*)\s*\(/g)) {
    const name = m[1];
    if (defs.has(name) || PY_BUILTINS.has(name) || PY_PRELOADED.includes(name)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

async function openSidecarAt(doc, line) {
  if (!vscode.window.showTextDocument) return;
  const shown = await vscode.window.showTextDocument(vscode.Uri.file(sidecarPath(doc)), { preview: false });
  if (shown && typeof line === "number") {
    const pos = new vscode.Position(line, 0);
    shown.selection = new vscode.Selection(pos, pos);
    shown.revealRange(new vscode.Range(line, 0, line, 0));
  }
}

function sidecarText(doc) {
  try { return fs.readFileSync(sidecarPath(doc), "utf8"); } catch { return ""; }
}

function writeSidecar(doc, text) {
  fs.mkdirSync(path.dirname(sidecarPath(doc)), { recursive: true });
  fs.writeFileSync(sidecarPath(doc), text);
  fileHashCache.delete(sidecarPath(doc));
  defsCache.delete(sidecarPath(doc));
}

// Lightbulb: a stub for a function a derivation calls and nobody defines.
async function createPythonFunction(uri, name) {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
  if (!doc || !/^[A-Za-z_]\w*$/.test(name || "")) return;
  const before = fs.existsSync(sidecarPath(doc)) ? fileDigest(sidecarPath(doc)) : null;
  let text = sidecarText(doc) || SIDECAR_HEADER(docRootName(doc));
  if (!new RegExp(`^def\\s+${name}\\s*\\(`, "m").test(text)) {
    text = text.replace(/\s*$/, "\n") + `\n\ndef ${name}():\n    """What ${name} computes."""\n    raise NotImplementedError("write ${name} in aot.files/${path.basename(sidecarPath(doc))}")\n`;
    writeSidecar(doc, text);
    await reconsentAfterWrite(sidecarPath(doc), before);
  }
  const def = sidecarDefs(doc).get(name);
  await openSidecarAt(doc, def ? def.line : 0);
}

const snake = (s) => {
  const out = String(s).trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return !out ? "value" : /^\d/.test(out) ? "_" + out : out;
};

// Lightbulb: the derivation's expression becomes a function in the sidecar,
// each `@` reference a parameter, and the line calls it with them.
async function movePythonToSidecar(uri, line) {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
  if (!doc) return;
  const h = pythonHostsIn(doc).find((x) => x.line - 1 === line);
  if (!h) return;
  const ctx = { lines: doc.getText().split(/\r?\n/), registry: formulaRegistry(doc), rootName: docRootName(doc), index: pyHostIndex(doc, pythonHostsIn(doc)) };
  const r = python.resolveHost(h, ctx);
  if (r.errors.length) return vscode.window.showWarningMessage(`AOT: fix the reference first — ${r.errors[0]}`);
  const defs = sidecarDefs(doc);
  const base = snake(h.kind === "concept" ? h.node.name : h.node ? h.node.name : h.address.split("@").pop());
  let name = base;
  for (let k = 2; defs.has(name) || PY_BUILTINS.has(name) || PY_PRELOADED.includes(name); k++) name = `${base}_${k}`;
  // one parameter per distinct reference, named after it
  const params = new Map(); // reference text -> parameter
  for (const s of r.spans) {
    if (params.has(s.text)) continue;
    let p = snake(s.text.replace(/^@/, "").replace(/@/g, " "));
    while ([...params.values()].includes(p) || p === name) p += "_";
    params.set(s.text, p);
  }
  let body = "";
  let last = 0;
  for (const s of r.spans) {
    body += h.source.slice(last, s.start) + params.get(s.text);
    last = s.start + s.length;
  }
  body += h.source.slice(last);
  const before = fs.existsSync(sidecarPath(doc)) ? fileDigest(sidecarPath(doc)) : null;
  const text = (sidecarText(doc) || SIDECAR_HEADER(docRootName(doc))).replace(/\s*$/, "\n")
    + `\n\ndef ${name}(${[...params.values()].join(", ")}):\n    return ${body}\n`;
  writeSidecar(doc, text);
  await reconsentAfterWrite(sidecarPath(doc), before);
  const call = `${name}(${[...params.keys()].join(", ")})`;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(h.line - 1, h.startCol + 1, h.line - 1, h.endCol), call);
  await vscode.workspace.applyEdit(edit);
  const def = sidecarDefs(doc).get(name);
  await openSidecarAt(doc, def ? def.line : 0);
}

// The Python lightbulbs on a derivation's line.
function pythonActions(doc, range) {
  const h = pythonHostsIn(doc).find((x) => x.line - 1 === range.start.line);
  if (!h || !h.source) return [];
  const actions = [];
  const run = new vscode.CodeAction("Run this Python derivation (Ctrl+Enter)", vscode.CodeActionKind.QuickFix);
  run.command = { command: "aot.runPython", title: "Run this Python derivation" };
  actions.push(run);
  const file = `aot.files/${path.basename(sidecarPath(doc))}`;
  for (const name of undefinedCalls(doc, h.source)) {
    const create = new vscode.CodeAction(`Create '${name}()' in ${file}`, vscode.CodeActionKind.QuickFix);
    create.command = { command: "aot.createPythonFunction", title: `Create '${name}()'`, arguments: [doc.uri.toString(), name] };
    actions.push(create);
  }
  const move = new vscode.CodeAction(`Move this Python into ${file}`, vscode.CodeActionKind.RefactorRewrite);
  move.command = { command: "aot.movePythonToSidecar", title: "Move this Python into the sidecar", arguments: [doc.uri.toString(), h.line - 1] };
  actions.push(move);
  return actions;
}

// --- flipping a Concept between its two forms --------------------------------
// A table is pure shorthand for the '- Example' lines it parses to, so one
// Concept has two spellings and the choice between them is about how the
// data reads, not about what it says. This key writes the Concept under the
// cursor out in the other one. The conversion itself is pure (derive.js);
// what lives here is finding the Concept the cursor is standing in and
// putting the edit — and the cursor — where the writer expects them.

// The Concept the cursor is in: the nearest one at or above the cursor's
// line, so standing on a row, a cell, an attribute, a value, or the
// Concept's own line all name the same Concept. A separator row carries no
// node, so a cursor on one is read from its table's header line instead.
function conceptAtCursor(root, nodes, lines, line) {
  let at = line + 1; // the parse counts lines from 1
  if (!nodes.some((n) => n.line === at)) {
    const block = table.blockAt(lines, line);
    if (block) at = block.start + 1;
  }
  const here = nodes.filter((n) => n.line === at);
  // a table header line holds the Concept it names and its columns: the
  // Concept is the one to take
  const start = here.find((n) => n.kind === KIND.CONCEPT) || here[0];
  if (!start) return null;
  for (let n = start; n; n = n.parent) if (n.kind === KIND.CONCEPT && n.line > 0) return n;
  return null;
}

async function toggleTableForm(editor) {
  const doc = editor.document;
  if (doc.languageId !== "aot") return;
  const rootName = docRootName(doc);
  let tree;
  try { tree = lint(doc.getText(), rootName); }
  catch { return vscode.window.showWarningMessage("AOT: the file does not parse — fix it before flipping a Concept's form."); }
  const lines = doc.getText().split(/\r?\n/);
  const concept = conceptAtCursor(tree.root, tree.nodes, lines, editor.selection.active.line);
  if (!concept) {
    return vscode.window.showWarningMessage(
      "AOT: put the cursor on a Concept — its line, its table, or one of its Examples — to flip between a table and free text.");
  }
  const edit = derive.flipForm(lines, concept, rootName);
  if (!edit) {
    return vscode.window.showWarningMessage(`AOT: '${concept.name}' has no line of its own to flip.`);
  }
  // the idea the cursor is on — a cell, a value, an Example, a column — so
  // it stays on that idea in the other form, whatever line it moves to
  const idea = derive.ideaAt(lines, tree.nodes, concept, editor.selection.active);
  // the whole document is rewritten, every table in it re-aligned; it
  // computes nothing — a flip is a re-spelling, not a recalculation
  const next = lines.slice();
  next.splice(edit.from, edit.to - edit.from + 1, ...edit.block);
  await rewriteDocument(editor, next);
  // read back as it now stands, re-aligning included — a table above that
  // the re-align redrew may have moved every line under it
  let landed = null;
  try {
    const text = editor.document.getText();
    const after = lint(text, rootName);
    landed = derive.positionOf(text.split(/\r?\n/), after.root, after.nodes, idea, edit.from);
  } catch { /* the Concept's first line, below */ }
  const at = landed ? landed.line : Math.min(edit.from, editor.document.lineCount - 1);
  const character = landed ? landed.character : editor.document.lineAt(at).firstNonWhitespaceCharacterIndex;
  editor.selection = new vscode.Selection(at, character, at, character);
  editor.revealRange(new vscode.Range(at, character, at, character));
  vscode.window.setStatusBarMessage(
    edit.form === "table"
      ? `AOT: '${concept.name}' written as a table — the same key writes it back as free text.`
      : `AOT: '${concept.name}' written as free text — the same key writes it back as a table.`, 5000);
}

// AOT: Copy Formula to Sibling Examples — the line-form copy-down: the
// derivation under the cursor lands on the same attribute of every sibling
// Example (adding the line where the attribute is absent). The copies hold no
// value until Ctrl+Enter runs them.
async function copyFormulaToSiblings(editor) {
  const doc = editor.document;
  if (doc.languageId !== "aot") return;
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const { root, nodes } = lint(doc.getText(), rootName);
  const lines = doc.getText().split(/\r?\n/);
  const ops = derive.copyToSiblings(root, nodes, lines, editor.selection.active.line);
  if (!ops) return;
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  await editor.edit((b) => {
    for (const op of ops) {
      if (op.type === "replace") {
        b.replace(doc.lineAt(op.line - 1).range, op.text);
      } else if (op.afterLine >= doc.lineCount) {
        const last = doc.lineCount - 1;
        b.insert(new vscode.Position(last, doc.lineAt(last).text.length), eol + op.text);
      } else {
        b.insert(new vscode.Position(op.afterLine, 0), op.text + eol);
      }
    }
  });
}

// Append a word to aot.acceptedWords (user settings, case-insensitive). The
// configuration change re-lints every open document, so the finding clears.
async function acceptWord(word) {
  const config = vscode.workspace.getConfiguration("aot");
  const words = config.get("acceptedWords", []) || [];
  const low = String(word).toLowerCase();
  if (words.some((w) => String(w).toLowerCase() === low)) return;
  await config.update("acceptedWords", [...words, low], vscode.ConfigurationTarget.Global);
}

// Record that two Concept names are two ideas (aot.distinctConcepts, user
// settings). The pair is stored order-free and lowercased, so it is dismissed
// whichever of the two the lightbulb was opened on. The configuration change
// re-lints every open document, so the warning clears on both sides at once.
async function acceptDistinct(a, b) {
  const config = vscode.workspace.getConfiguration("aot");
  const pairs = config.get("distinctConcepts", []) || [];
  const key = synonyms.pairKey(a, b);
  if (pairs.some((p) => {
    const [x, y] = String(p).split("|");
    return x && y && synonyms.pairKey(x.trim(), y.trim()) === key;
  })) return;
  await config.update("distinctConcepts", [...pairs, key], vscode.ConfigurationTarget.Global);
}

// Rename a Concept in the active document through the rename engine, so every
// reference to it follows exactly as F2 would move them. The lightbulb on a
// synonym warning uses it to fold one of the two names into the other.
async function renameConcept(from, to) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "aot") return;
  const doc = editor.document;
  const analysis = analysisByDoc.get(doc.uri.toString()) || analyse(doc);
  const low = String(from).toLowerCase();
  const node = (analysis.nodes || []).find(
    (n) => n.kind === KIND.CONCEPT && n.line && String(n.name).toLowerCase() === low);
  if (!node) return;
  const text = doc.lineAt(node.line - 1).text;
  const col = text.indexOf(node.name);
  if (col === -1) return;
  let edit;
  try {
    edit = renameProvider.provideRenameEdits(doc, new vscode.Position(node.line - 1, col), to);
  } catch (e) {
    vscode.window.showWarningMessage(`AOT: could not rename '${from}' — ${e.message}`);
    return;
  }
  if (edit) await vscode.workspace.applyEdit(edit);
}

// --- the CSV mirror -----------------------------------------------------------
// Every Concept with Examples lives twice: in its .aot, and as a CSV named
// after it in the repository's 'aot.files'. The two are kept in step both
// ways by a three-way merge (csvsync.js): each cell is judged against the
// text the two last agreed on — the baseline, remembered per CSV — so the
// side that changed it is the side that is right, an emptied cell empties,
// a dropped row is asked about, and only a cell both changed apart is a
// conflict, which the later save wins and which is said. Every sync point
// runs the same comparison: a .aot save, a CSV edit, the catch-up when the
// editor starts, and AOT: Sync CSVs Now (the only one, in manual mode).
// Both directions write only when the content genuinely differs, which is
// what stops the two from chasing each other. Saving also migrates the
// legacy per-file folders and archives a CSV no Concept speaks for.

const syncEnabled = () => vscode.workspace.getConfiguration("aot").get("tableCsvSync", true);
// auto: every sync point; manual: AOT: Sync CSVs Now alone
const syncManual = () => vscode.workspace.getConfiguration("aot").get("tableCsvSyncMode", "auto") === "manual";

const csvName = (name) => name.replace(/[\\/:*?"<>|]/g, "-") + ".csv";

// Two CSV texts hold the same data when they differ only in line endings or
// a byte-order mark. The mirror writes LF on every platform, but a CSV is
// exactly the file a user opens in something else — Excel and Notepad write
// CRLF back on Windows (Excel's 'CSV UTF-8' a BOM too), and git hands out
// CRLF wherever these are committed with 'text=auto'. Compare the bytes and
// that round trip looks like an edit: the watcher folds a grid that never
// changed, and the next save rewrites the file, for a diff nobody made.
const csvTextOf = (t) => String(t).replace(/^﻿/, "").replace(/\r\n/g, "\n");
const sameCsvText = (a, b) => csvTextOf(a) === csvTextOf(b);

// What each CSV and its .aot files last agreed on — csvsync's baseline — as
// the texts, newest first, the last CSV_BASELINES of them: a program that
// held an older copy merges against the one it descends from. Kept in the
// extension's own storage, per machine and never in the repository, once
// activate() has a place for it; in memory until then, and in the tests.
// Only a write that landed or a fold that took the CSV in advances it, so a
// write Excel's lock refused leaves the old one standing, which is right.
const CSV_BASELINES = 8;
const memoryBaselines = () => {
  const m = new Map();
  return { get: (k) => m.get(k) || [], set: (k, list) => m.set(k, list), drop: (k) => m.delete(k) };
};
const diskBaselines = (dir) => {
  const fileOf = (k) => path.join(dir, crypto.createHash("sha1").update(k).digest("hex") + ".json");
  return {
    get: (k) => { try { return JSON.parse(fs.readFileSync(fileOf(k), "utf8")).baselines || []; } catch { return []; } },
    set: (k, list) => {
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fileOf(k), JSON.stringify({ csv: k, baselines: list })); } catch { /* the next sync tries again */ }
    },
    drop: (k) => { try { fs.unlinkSync(fileOf(k)); } catch { /* none kept */ } },
  };
};
let baselineStore = memoryBaselines();
const baselinesOf = (csvPath) => baselineStore.get(fileKey(csvPath));
function rememberBaseline(csvPath, text) {
  const norm = csvTextOf(text);
  const list = baselinesOf(csvPath).filter((b) => b.text !== norm);
  list.unshift({ text: norm, at: Date.now() });
  baselineStore.set(fileKey(csvPath), list.slice(0, CSV_BASELINES));
}
const forgetBaselines = (csvPath) => baselineStore.drop(fileKey(csvPath));
function moveBaselines(from, to) {
  const list = baselinesOf(from);
  if (!list.length) return;
  baselineStore.set(fileKey(to), list);
  forgetBaselines(from);
}
// A CSV whose edits are already in a .aot buffer that is not saved yet —
// the CSV cannot be written from a buffer with unsaved edits, and a merge of
// what it already took in would only ask again. In memory: it means
// something only until that buffer is saved. Never a baseline, which is
// what both copies agreed on; this one they do not, yet.
const takenIn = new Map(); // csv path (fileKey) -> the CSV's text
// a CSV saying exactly what the two once agreed on, or what a buffer has
// taken in already, carries no edit of its own
const agreedOn = (csvPath, text) => baselinesOf(csvPath).some((b) => sameCsvText(b.text, text))
  || takenIn.get(fileKey(csvPath)) === csvTextOf(text);

// The workspace root a document belongs to (or its own folder, standalone).
function workspaceRoot(doc) {
  const folder = vscode.workspace.getWorkspaceFolder && vscode.workspace.getWorkspaceFolder(doc.uri);
  const ws = folder || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]);
  return ws ? ws.uri.fsPath : path.dirname(doc.fileName);
}

// The repository a path sits in: the nearest ancestor holding a '.git' — a
// directory in a clone, a *file* in a worktree or a submodule, so both are
// tested for existence rather than for being a folder. Null outside a
// repository, which is a real answer and not a failure.
function repoRootOf(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null; // the filesystem root: no repository above
    dir = up;
  }
}

// A repository has exactly one 'aot.files', at its root — the walk starts at
// the .aot's own folder and stops at the repository, so a file opened on its
// own, a repo opened as several workspace folders, and a folder opened below
// the root all answer with the same place, and a nested repo (a submodule)
// keeps its own. Only a file in no repository at all falls back to the
// workspace root, which is where every file used to go.
const aotRoot = (doc) =>
  (doc.fileName && repoRootOf(path.dirname(doc.fileName))) || workspaceRoot(doc);

// Set on activation: watchers for an 'aot.files' the workspace globs cannot
// see, because the repository root is above the folder that was opened.
let watchAotRoot = () => {};

// Set on activation: judge every open document again, for a change that
// lives outside any of them (the formula store's parked constraints).
let relintAll = () => {};

// One 'aot.files' folder holds every table's CSV. CSVs are named plainly
// after their Concept, so every .aot in the repo shares one folder; two
// files with a same-named table share one CSV (the repo-wide
// duplicate-Concept warning makes that visible).
const aotFilesDir = (doc) => path.join(aotRoot(doc), "aot.files");

// Every .aot file under a root, skipping heavy and generated folders.
function scanAotFiles(root) {
  const out = [];
  const skip = new Set(["node_modules", ".git", "aot.files", "out"]);
  const walk = (d) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name) && !e.name.endsWith(".tables") && !e.name.startsWith("tables.")) walk(p);
      } else if (e.isFile() && /\.aot$/i.test(e.name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

// The text of a workspace .aot, preferring the live document when it is the
// one being saved (so its unsaved edits count).
function aotText(fsPath, currentDoc) {
  if (currentDoc && fileKey(fsPath) === fileKey(currentDoc.fileName)) return currentDoc.getText();
  try { return fs.readFileSync(fsPath, "utf8"); } catch { return null; }
}

// Every CSV name the repo claims — the shared folder means a CSV is an
// orphan only when *no* file speaks for it. Two things speak for one: a
// table that would write it, and a **file-path value that points at it** —
// a CSV copied in as evidence is referenced, not abandoned, and archiving it
// would break the very link that names it.
const AOT_FILES_REF = /aot\.files[\\/]([^\s|`"'<>]+)/g;
// What one .aot speaks for: the aot.files it cites by path, the Concepts it
// would mirror with the grid each would write, and — only when the file will
// not parse — the names of the complete tables it still speaks for.
function mirrorFacts(fsPath, text) {
  const rootName = path.basename(fsPath).replace(/\.[^.]*$/, "");
  const refs = [];
  for (const m of text.matchAll(AOT_FILES_REF)) refs.push(path.basename(m[1]).toLowerCase());
  try {
    const { root: r, nodes } = lint(text, rootName);
    const grids = [];
    for (const g of derive.mirrorGrids(r, nodes)) {
      if (g.rows.length) grids.push({ name: g.name, grid: [g.header, ...g.rows] });
    }
    return { refs, grids, fallback: null };
  } catch {
    // an unparseable file still speaks for its complete tables — though it
    // owns nothing, which is why the two readings are kept apart here
    return { refs, grids: [], fallback: table.tablesOf(text.split(/\r?\n/), rootName).map((t) => t.name) };
  }
}

// The same, cached against the file's text — every save asks what every .aot
// in the repo speaks for, and every hand edit of a CSV asks which file owns
// it; without this both re-lint the whole repository each time. Reading a
// file is cheap beside linting it, and the text is the one test that cannot
// be fooled: a file rewritten within one tick of the clock to the same size
// (`100` becoming `110`, by a pull or a script) keeps its mtime and size. A
// file open in the editor is read from its live text instead, so it is
// computed fresh and never cached here.
const mirrorCache = new Map(); // fsPath -> { text, refs, grids, fallback }

function mirrorFactsOf(fsPath, currentDoc) {
  if (currentDoc && fileKey(fsPath) === fileKey(currentDoc.fileName)) {
    return mirrorFacts(fsPath, currentDoc.getText());
  }
  let text;
  try { text = fs.readFileSync(fsPath, "utf8"); } catch { mirrorCache.delete(fsPath); return null; }
  const hit = mirrorCache.get(fsPath);
  if (hit && hit.text === text) return hit;
  const entry = { text, ...mirrorFacts(fsPath, text) };
  mirrorCache.set(fsPath, entry);
  return entry;
}

function globalCsvNames(root, currentDoc) {
  const names = new Set();
  for (const f of scanAotFiles(root)) {
    const facts = mirrorFactsOf(f, currentDoc);
    if (!facts) continue;
    for (const ref of facts.refs) names.add(ref);
    // every Concept with Examples in its scope speaks for its CSV — tables
    // and line form alike, one union file per Concept
    for (const g of facts.grids) names.add(csvName(g.name).toLowerCase());
    for (const name of facts.fallback || []) names.add(csvName(name).toLowerCase());
  }
  return names;
}

// Every Concept the repo mirrors, indexed by its lowercased name: the .aot
// files that own it — written as a table, line form, or both, one idea, one
// CSV — each with the grid that file would write. Built in one pass, because
// a whole-folder import would otherwise re-scan and re-lint every .aot once
// per CSV.
function ownerIndex(root) {
  const index = new Map();
  for (const f of scanAotFiles(root)) {
    const facts = mirrorFactsOf(f);
    if (!facts) continue;
    // an unparseable file owns nothing, so only the grids count here
    for (const g of facts.grids) {
      const low = g.name.toLowerCase();
      if (!index.has(low)) index.set(low, []);
      index.get(low).push({ file: f, grid: g.grid });
    }
  }
  return index;
}

// Fold a document's pre-1.3 per-file folders (`tables.<file>` and
// `<file>.tables`) into the shared aot.files, then remove them. A CSV whose
// name is already present is left (the fresh write below is authoritative).
function migrateLegacyDirs(doc, dir) {
  const legacies = [
    path.join(path.dirname(doc.fileName), "tables." + path.basename(doc.fileName).replace(/\.aot$/i, "")),
    doc.fileName.replace(/\.aot$/i, ".tables"),
  ];
  for (const legacy of legacies) {
    let stat; try { stat = fs.statSync(legacy); } catch { continue; }
    if (!stat.isDirectory()) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const entry of fs.readdirSync(legacy)) {
        const from = path.join(legacy, entry), to = path.join(dir, entry);
        if (/\.csv$/i.test(entry) && !fs.existsSync(to)) {
          fs.copyFileSync(from, to);
          moveBaselines(from, to); // what it agreed on travels with it
        }
        fs.unlinkSync(from);
      }
      fs.rmdirSync(legacy);
    } catch { continue; } // a held lock loses this round; the next save retries
  }
}

// Fold an 'aot.files' an earlier release left elsewhere in this repository
// into the repository's own — the two places the old rule could have put
// one for *this* document: beside the file itself, and at its workspace
// root. Everything moves, not the CSVs alone: a '.formulas' store and a
// file copied in as evidence are exactly what must not be left behind. A
// name already taken at the destination is never overwritten — that copy
// stays where it is and its folder with it, so the fold can lose nothing.
// Only a folder *inside this repository* is ever moved: a file opened from
// another repository answers with the open workspace's root, and that
// folder is another repository's business, not this save's.
function migrateStrayAotFiles(doc, dir) {
  const root = path.dirname(dir);
  const strays = [path.dirname(doc.fileName), workspaceRoot(doc)]
    .map((d) => path.join(d, "aot.files"))
    .filter((d) => fileKey(d) !== fileKey(dir) && isInside(root, d));
  const seen = new Set();
  for (const stray of strays) {
    if (seen.has(fileKey(stray))) continue; // the two places can be one
    seen.add(fileKey(stray));
    let entries;
    try {
      if (!fs.statSync(stray).isDirectory()) continue;
      entries = fs.readdirSync(stray);
    } catch { continue; }
    try { fs.mkdirSync(dir, { recursive: true }); } catch { continue; }
    for (const entry of entries) {
      const from = path.join(stray, entry), to = path.join(dir, entry);
      if (fs.existsSync(to)) continue; // taken: the repo's copy is the one
      try {
        fs.copyFileSync(from, to); // a sub-folder throws, and is left alone
        fs.unlinkSync(from);
      } catch { continue; } // a held lock loses this round; the next save retries
      moveBaselines(from, to);
    }
    try { fs.rmdirSync(stray); } catch { /* what could not move stays, folder and all */ }
  }
}

// A CSV whose Concept no table anywhere still has is not deleted — it is
// prefixed with '_' so it is kept as an archive and skipped by the fold-back
// watcher. Only .csv files, only in this folder, never recursive.
function cleanupOrphans(dir, expected) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (!/\.csv$/i.test(entry) || entry.startsWith("_")) continue;
    if (expected.has(entry.toLowerCase())) continue;
    const from = path.join(dir, entry), to = path.join(dir, "_" + entry);
    try { fs.renameSync(from, to); } catch { continue; }
    forgetBaselines(from); // an archive is never synced
  }
}

// The .aot files a Concept lives in — one, or several that each spell part
// of it — each with the grid it mirrors and its document when one is open.
// Read as last saved, except `current` (the document being saved, its
// mirrorFacts already read as `currentFacts`), and with `live` every open
// document as it stands in the editor: its unsaved edits are the latest word
// in a merge, though never written out before a save.
function ownersFrom(index, name, { live, current, currentFacts } = {}) {
  const out = [];
  const low = String(name).toLowerCase();
  for (const e of index.get(low) || []) {
    const open = (vscode.workspace.textDocuments || []).find((d) => d.fileName && fileKey(d.fileName) === fileKey(e.file)) || null;
    const isCurrent = current && fileKey(current.fileName) === fileKey(e.file);
    const doc = isCurrent ? current : live ? open : null;
    if (!doc) { out.push({ file: e.file, doc: open, grid: e.grid }); continue; }
    const facts = isCurrent && currentFacts ? currentFacts : mirrorFacts(e.file, doc.getText());
    const g = facts.grids.find((x) => x.name.toLowerCase() === low);
    if (g) out.push({ file: e.file, doc: open || doc, grid: g.grid });
  }
  return out;
}

// Does a file's grid list the Example `row` (case aside)?
const listsRow = (owner, row) => owner.grid.slice(1).some((r) => String(r[0]).trim().toLowerCase() === String(row).trim().toLowerCase());

// Write a CSV, remembering it as what the two now agree on. Never over a CSV
// open here with unsaved edits, and never in silence when another program
// holds it locked (Excel does, with the workbook open): either is said, the
// baseline stays as it was, and the next sync tries again.
function writeCsvFile(csvPath, grid) {
  const csv = table.toCsv(grid);
  let onDisk = null;
  try { onDisk = fs.readFileSync(csvPath, "utf8"); } catch { /* none yet */ }
  if (onDisk !== null && sameCsvText(onDisk, csv)) { rememberBaseline(csvPath, onDisk); return true; }
  const openDirty = (vscode.workspace.textDocuments || []).find(
    (d) => d.fileName && fileKey(d.fileName) === fileKey(csvPath) && d.isDirty);
  if (openDirty) {
    vscode.window.showWarningMessage(`'${path.basename(csvPath)}' has unsaved edits — save or revert it, then save the .aot again to re-mirror.`);
    return false;
  }
  try {
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    fs.writeFileSync(csvPath, csv);
  } catch {
    vscode.window.showWarningMessage(`'${path.basename(csvPath)}' is open in another program — close it and save the .aot again to re-mirror.`);
    return false;
  }
  rememberBaseline(csvPath, csv); // before any watcher hears the write
  takenIn.delete(fileKey(csvPath));
  return true;
}

// A Concept's CSV, written as its .aot files say it — once every one of them
// is saved: a file with unsaved edits writes it on its own save.
function writeMirror(root, name) {
  const owners = ownersFrom(ownerIndex(root), name);
  if (!owners.length || owners.some((o) => o.doc && o.doc.isDirty)) return false;
  const grid = csvsync.unionGrids(owners.map((o) => o.grid));
  return grid ? writeCsvFile(path.join(root, "aot.files", csvName(name)), grid) : false;
}

// Saving a .aot: each Concept it mirrors is written out — unless its CSV
// says something the two never agreed on (edited with the editor closed, or
// by a program whose save no watcher heard), which is merged first rather
// than overwritten.
function syncAotToCsv(doc) {
  if (doc.languageId !== "aot" || !syncEnabled() || syncManual()) return;
  if (!/\.aot$/i.test(doc.fileName)) return;
  const dir = aotFilesDir(doc);
  const root = path.dirname(dir);
  watchAotRoot(root);
  migrateLegacyDirs(doc, dir);
  migrateStrayAotFiles(doc, dir);
  if (fs.existsSync(dir)) cleanupOrphans(dir, globalCsvNames(root, doc));
  // every Concept with Examples in its scope — a table, line form, or both,
  // one idea, one CSV — read once for the whole save
  const facts = mirrorFacts(doc.fileName, doc.getText());
  const names = [...new Map(facts.grids.map((g) => [csvName(g.name).toLowerCase(), g.name])).values()];
  if (!names.length) return;
  const index = ownerIndex(root);
  for (const name of names) {
    const csvPath = path.join(dir, csvName(name));
    // a Concept several files spell is mirrored whole, every file's rows —
    // the file being saved among them, whatever the index has read of it
    const owners = ownersFrom(index, name, { current: doc, currentFacts: facts });
    if (!owners.some((o) => fileKey(o.file) === fileKey(doc.fileName))) {
      const own = facts.grids.find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (own) owners.unshift({ file: doc.fileName, doc, grid: own.grid });
    }
    const grid = csvsync.unionGrids(owners.map((o) => o.grid));
    if (!grid) continue;
    let onDisk = null;
    try { onDisk = fs.readFileSync(csvPath, "utf8"); } catch { /* none yet */ }
    if (onDisk === null || sameCsvText(onDisk, table.toCsv(grid)) || agreedOn(csvPath, onDisk)) {
      writeCsvFile(csvPath, grid);
      continue;
    }
    settleSoon(root, name, { trigger: "save" });
  }
}

// One settle at a time per CSV: a save and the watcher hearing the write it
// causes must never merge the same cells at once.
const settling = new Map(); // csv path -> the settle in flight
function settleSoon(root, name, opts) {
  const k = fileKey(path.join(root, "aot.files", csvName(name)));
  const next = (settling.get(k) || Promise.resolve()).then(() => settleCsv(root, name, opts)).catch(() => false);
  settling.set(k, next);
  next.then(() => { if (settling.get(k) === next) settling.delete(k); });
  return next;
}

// The CSV as the repository's last commit holds it: the baseline a CSV has
// before this machine ever synced it — a fresh clone, an upgrade. null
// outside a repository, for a file never committed, and without git.
let csvAtHead = (root, csvPath) => {
  const top = repoRootOf(root);
  if (!top) return null;
  const rel = path.relative(top, csvPath).split(path.sep).join("/");
  try { return gitRun(top, ["show", `HEAD:${rel}`]); } catch { return null; }
};

// Whether the CSV was saved after every .aot it mirrors: the side a conflict
// goes to. A document with unsaved edits counts as now — they are the latest
// word, whoever saves them.
function csvIsNewer(csvPath, owners) {
  let csvTime;
  try { csvTime = fs.statSync(csvPath).mtimeMs; } catch { return false; }
  for (const o of owners) {
    if (o.doc && o.doc.isDirty) return false;
    try { if (fs.statSync(o.file).mtimeMs >= csvTime) return false; } catch { /* gone */ }
  }
  return true;
}

// One CSV settled both ways (csvsync.threeWay): what the CSV changed since
// the two last agreed folds into the .aot files that list the rows, what
// they changed is written back, a cell both changed apart goes to the later
// save and is said, and a row the CSV dropped is asked about. `trigger` is
// what asked — "save", "csv" (the watcher), "catchup" (the editor starting
// up, or Sync CSVs Now) — which matters only when nothing is known to judge
// by: then a save is the .aot's word, as a save always was, and anything
// else the CSV's where it says something, as the CSV always was. Answers
// whether a .aot changed.
async function settleCsv(root, name, opts = {}) {
  const csvPath = path.join(root, "aot.files", csvName(name));
  const owners = ownersFrom(ownerIndex(root), name, { live: true });
  if (!owners.length) return false;
  const aot = csvsync.unionGrids(owners.map((o) => o.grid));
  const raw = await readCsvSettled(csvPath);
  if (raw === null) { writeMirror(root, name); return false; }
  if (sameCsvText(raw, table.toCsv(aot))) { rememberBaseline(csvPath, raw); return false; }
  // its edits are in a buffer already: written out once that is saved
  if (takenIn.get(fileKey(csvPath)) === csvTextOf(raw)) { writeMirror(root, name); return false; }
  const csv = table.fromCsv(raw);
  if (!csv.length) return false;
  const known = baselinesOf(csvPath);
  let base = null;
  if (known.length) {
    const grids = known.map((b) => table.fromCsv(b.text));
    base = grids[Math.max(0, csvsync.closestBaseline(grids, csv))];
  } else {
    const committed = csvAtHead(root, csvPath);
    if (committed !== null && committed !== undefined) base = table.fromCsv(committed);
  }
  if (!base && opts.trigger === "save") { writeMirror(root, name); return false; }
  const plan = csvsync.threeWay(base, csv, aot, { csvNewer: csvIsNewer(csvPath, owners) });
  const changed = await applyFold(name, owners, plan);
  if (plan.conflicts.length) reportConflicts(root, name, plan.conflicts, owners);
  if (plan.deletions.length) askDeletions(root, name, plan.deletions);
  // written back as the .aot files now have it — and when it cannot be yet
  // (a buffer with unsaved edits, a locked file), the CSV is remembered as
  // heard, so the next save writes it rather than asking again
  if (!writeMirror(root, name)) takenIn.set(fileKey(csvPath), csvTextOf(raw));
  return changed;
}

// A plan's folds and erasures, each row into the files that list it — a new
// row into the first. One edit, one undo, per file; a file with no unsaved
// edits is saved after, one with them is left for its writer to save, so a
// fold never saves somebody's work in progress. Answers whether any changed.
async function applyFold(name, owners, plan) {
  if (!plan.fold && !plan.erase.length) return false;
  const header = plan.fold ? plan.fold[0] : [name];
  const rows = plan.fold ? plan.fold.slice(1) : [];
  let changed = false;
  for (let i = 0; i < owners.length; i++) {
    const o = owners[i];
    const mine = rows.filter((r) => listsRow(o, r[0]) || (i === 0 && !owners.some((x) => listsRow(x, r[0]))));
    const erase = plan.erase.filter((e) => listsRow(o, e.row));
    if (!mine.length && !erase.length) continue;
    let doc;
    try { doc = o.doc || await vscode.workspace.openTextDocument(o.file); } catch { continue; }
    let parsed;
    try { parsed = lint(doc.getText(), docRootName(doc)); } catch { continue; }
    const low = String(name).toLowerCase();
    const concept = [parsed.root, ...parsed.nodes].find((n) => n && n.kind === KIND.CONCEPT && n.name.toLowerCase() === low);
    if (!concept) continue;
    const ops = derive.updateScope(doc.getText().split(/\r?\n/), parsed.root, parsed.nodes, concept, header, mine, docRootName(doc), { erase });
    if (await applyOpsToDoc(doc, ops, `folded '${csvName(name)}' into`)) changed = true;
  }
  return changed;
}

// Ops (derive's shape) onto a document as one edit; saved after unless it
// held unsaved edits already. Answers whether anything was applied.
async function applyOpsToDoc(doc, ops, what) {
  if (!ops.length) return false;
  const wasDirty = !!doc.isDirty;
  const beforeText = doc.getText();
  const edit = new vscode.WorkspaceEdit();
  edit.set(doc.uri, opsToTextEdits(doc, ops));
  await vscode.workspace.applyEdit(edit);
  markBroughtIn(doc, beforeText); // a CSV is written by whoever edited it
  if (!wasDirty) {
    const saved = await doc.save();
    if (saved === false) vscode.window.showWarningMessage(`AOT: ${what} ${path.basename(doc.fileName)}, but could not save it.`);
  }
  return true;
}

// One notice for every cell both sides changed apart since they last agreed:
// which value stayed, and the one button that takes the other side's
// instead — one edit, one undo.
function reportConflicts(root, name, conflicts, owners) {
  const csvFile = csvName(name);
  const aotFile = owners.length === 1 ? path.basename(owners[0].file) : `the ${owners.length} .aot files`;
  const shown = (v) => (v === "" ? "nothing" : v);
  const said = (c) => (c.col === null
    ? (c.winner === "aot" ? `kept '${c.row}' (${csvFile} removed it, ${aotFile} had changed it)`
      : `brought '${c.row}' back (${aotFile} removed it, ${csvFile} changed it after)`)
    : c.winner === "aot" ? `${c.row} · ${c.col}: kept ${shown(c.aot)} from ${aotFile} (${csvFile} said ${shown(c.csv)})`
      : `${c.row} · ${c.col}: took ${shown(c.csv)} from ${csvFile} (${aotFile} said ${shown(c.aot)})`);
  const list = conflicts.slice(0, 3).map(said).join("; ") + (conflicts.length > 3 ? `; and ${conflicts.length - 3} more` : "");
  const cells = conflicts.filter((c) => c.col !== null);
  const aotWon = cells.filter((c) => c.winner === "aot"), csvWon = cells.filter((c) => c.winner === "csv");
  const useCsv = `Use ${csvFile}'s Values`, useAot = `Use ${owners.length === 1 ? path.basename(owners[0].file) : "the .aot"}'s Values`;
  const buttons = [...(aotWon.length ? [useCsv] : []), ...(csvWon.length ? [useAot] : [])];
  return Promise.resolve(vscode.window.showWarningMessage(
    `AOT: ${csvFile} and ${aotFile} both changed ${conflicts.length === 1 ? "one thing" : `${conflicts.length} things`} since they last agreed, and the later save won — ${list}.`,
    ...buttons)).then((answer) => {
    if (answer === useCsv) return takeValues(root, name, aotWon.map((c) => ({ row: c.row, col: c.col, value: c.csv })));
    if (answer === useAot) return takeValues(root, name, csvWon.map((c) => ({ row: c.row, col: c.col, value: c.aot })));
    return undefined;
  });
}

// Write `values` ([{ row, col, value }]) into the .aot files and the CSV
// after them: a conflict's other side, taken.
async function takeValues(root, name, values) {
  const owners = ownersFrom(ownerIndex(root), name, { live: true });
  const plan = csvsync.foldOf(csvsync.unionGrids(owners.map((o) => o.grid)), values);
  const changed = await applyFold(name, owners, plan);
  writeMirror(root, name);
  return changed;
}

// The rows a CSV dropped that the .aot never changed since the two agreed:
// never deleted in silence. Delete takes them out of the files that list
// them, a row's sub-rows too when the CSV dropped those as well; Keep leaves
// them, and the CSV has them back.
function askDeletions(root, name, names) {
  const csvFile = csvName(name);
  const owners = ownersFrom(ownerIndex(root), name);
  const files = [...new Set(owners.filter((o) => names.some((n) => listsRow(o, n))).map((o) => path.basename(o.file)))];
  if (!files.length) return Promise.resolve();
  const list = names.slice(0, 5).map((n) => `'${n}'`).join(", ") + (names.length > 5 ? ` and ${names.length - 5} more` : "");
  const del = `Delete from ${files.join(", ")}`;
  return Promise.resolve(vscode.window.showWarningMessage(
    `AOT: ${csvFile} no longer lists ${list} — delete ${names.length === 1 ? "it" : "them"} from ${files.join(", ")} too?`,
    del, "Keep")).then((answer) => (answer === del ? deleteRows(root, name, names) : undefined));
}

async function deleteRows(root, name, names) {
  const kept = [];
  for (const o of ownersFrom(ownerIndex(root), name, { live: true })) {
    if (!names.some((n) => listsRow(o, n))) continue;
    let doc;
    try { doc = o.doc || await vscode.workspace.openTextDocument(o.file); } catch { continue; }
    let parsed;
    try { parsed = lint(doc.getText(), docRootName(doc)); } catch { continue; }
    const low = String(name).toLowerCase();
    const concept = [parsed.root, ...parsed.nodes].find((n) => n && n.kind === KIND.CONCEPT && n.name.toLowerCase() === low);
    if (!concept) continue;
    const { ops, kept: stay } = derive.deleteExamples(doc.getText().split(/\r?\n/), parsed.root, parsed.nodes, concept, names);
    kept.push(...stay);
    await applyOpsToDoc(doc, ops, `deleted rows of '${csvName(name)}' from`);
  }
  if (kept.length) {
    vscode.window.showInformationMessage(`AOT: kept ${kept.map((n) => `'${n}'`).join(", ")} — ${kept.length === 1 ? "a row under it is" : "rows under them are"} still in ${csvName(name)}.`);
  }
  writeMirror(root, name);
}

// Excel does not write a CSV in place: it writes a temp file and renames it
// over the target, so a watcher event can land in the instant the name has
// nothing behind it — and a workbook still open holds a lock besides.
// Neither lasts long, so read again a few times before giving the edit up
// rather than dropping it in silence.
const csvWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CSV_READ_TRIES = 3, CSV_READ_PAUSE_MS = 150;
async function readCsvSettled(csvPath) {
  for (let attempt = 1; ; attempt++) {
    try { return fs.readFileSync(csvPath, "utf8"); } catch {
      if (attempt >= CSV_READ_TRIES) return null;
      await csvWait(CSV_READ_PAUSE_MS);
    }
  }
}

// A CSV in an 'aot.files' changed on disk: settled against the .aot files
// that own its Concept. Our own write echoing back says what the two agree
// on already, and settles nothing. Answers whether a .aot changed.
async function syncCsvIntoAot(uri) {
  if (!syncEnabled() || syncManual()) return false;
  const csvPath = uri.fsPath;
  const dir = path.dirname(csvPath);
  if (path.basename(dir) !== "aot.files") return false;
  if (path.basename(csvPath).startsWith("_")) return false; // an archived orphan, not synced
  return settleSoon(path.dirname(dir), path.basename(csvPath).replace(/\.csv$/i, ""), { trigger: "csv" });
}

// One save from Excel is several events — the temp file's rename shows up
// as a delete, a create and a change within a few milliseconds — and two
// folds of one CSV running at once would both measure the same lines and
// then both edit them. So the burst settles into a single fold. The promise
// is the fold's, so awaiting the event still awaits the result.
const csvPending = new Map(); // csv path -> the settling fold
const CSV_SETTLE_MS = 80;
function onCsvFsEvent(uri) {
  const key = fileKey(uri.fsPath);
  let entry = csvPending.get(key);
  if (entry) clearTimeout(entry.timer);
  else {
    entry = {};
    entry.promise = new Promise((resolve) => { entry.resolve = resolve; });
    csvPending.set(key, entry);
  }
  entry.timer = setTimeout(() => {
    csvPending.delete(key);
    entry.resolve(syncCsvIntoAot(uri));
  }, CSV_SETTLE_MS);
  return entry.promise;
}

// Settle every CSV in a repository's aot.files with the .aot files that own
// it. The watcher only hears an edit made while the editor is running, so a
// CSV changed in Excel with the window closed — or a .aot changed by a pull —
// would otherwise wait for the next save to be found. Catching the folder up
// once on activation closes that window, and an unchanged folder costs
// nothing. AOT: Sync CSVs Now (`manual`) does the same by hand, and writes
// the CSV of every Concept that has none yet besides — the only sync there
// is in manual mode. Answers how many CSVs changed a .aot.
async function importCsvFolder(root, opts) {
  const manual = !!(opts && opts.manual);
  if (!syncEnabled() || (syncManual() && !manual)) return 0;
  const dir = path.join(root, "aot.files");
  const index = ownerIndex(root);
  const names = new Map(); // lowercased -> the name a CSV is written under
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { /* no folder yet */ }
  for (const entry of entries) {
    if (!/\.csv$/i.test(entry) || entry.startsWith("_")) continue;
    const name = entry.replace(/\.csv$/i, "");
    if (index.has(name.toLowerCase())) names.set(name.toLowerCase(), name); // an orphan waits for a save to archive it
  }
  if (manual) {
    for (const [low, owners] of index) if (!names.has(low)) names.set(low, String(owners[0].grid[0][0]));
  }
  let folded = 0;
  // one at a time, never in parallel: two CSVs can fold into one .aot, and
  // each fold edits and saves that document
  for (const name of names.values()) if (await settleSoon(root, name, { trigger: "catchup" })) folded++;
  if (folded && !(opts && opts.silent)) {
    vscode.window.setStatusBarMessage(`AOT: ${folded} CSV file${folded === 1 ? "" : "s"} folded into the .aot`, 4000);
  }
  return folded;
}

// Every repository root the CSV watchers cover, so the catch-up reaches
// exactly the folders the live sync does — the workspace folders, and the
// repo root above a folder opened by one of its subfolders.
async function importAllCsvFolders(opts) {
  const roots = new Map();
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const root = repoRootOf(folder.uri.fsPath) || folder.uri.fsPath;
    roots.set(fileKey(root), root);
  }
  let folded = 0;
  for (const root of roots.values()) folded += await importCsvFolder(root, { ...opts, silent: true });
  if (!(opts && opts.silent)) {
    vscode.window.setStatusBarMessage(
      folded ? `AOT: ${folded} CSV file${folded === 1 ? "" : "s"} folded into the .aot` : "AOT: every CSV is in step with its .aot", 4000);
  }
  return folded;
}

// --- table cell colouring ---------------------------------------------------
// The grammar colours whole lines by shape, which is right everywhere but
// inside a table, where one line holds several kinds of idea. Semantic
// tokens overlay the parsed cells so a table is coloured exactly as its
// written-out form would be: header cells as attributes, name cells as
// Examples, value cells as Attribute Values. package.json maps each token
// type back to the grammar's own scopes, so themes use identical colours.
// Custom token types, not the built-in property/enumMember/string/macro:
// a theme colours those with its own palette, so a table Example would
// differ from a '- ' Example. Custom types no theme defines fall through to
// the grammar scope (semanticTokenScopes), so a cell colours identically to
// its written-out line form.
const TOKEN_TYPES = ["aotAttribute", "aotExample", "aotValue", "aotPython"];
const ATTR_TOKEN = 0, EXAMPLE_TOKEN = 1, VALUE_TOKEN = 2, PYTHON_TOKEN = 3;
const semanticLegend = new vscode.SemanticTokensLegend(TOKEN_TYPES, []);
const semanticProvider = {
  provideDocumentSemanticTokens(doc) {
    const { root, nodes } = parsedDoc(doc);
    const builder = new vscode.SemanticTokensBuilder(semanticLegend);
    const docLines = doc.getText().split(/\r?\n/);
    // a value as it stands on its line — escapes and all — which is what the
    // token must cover, though the model reads it shorter
    const writtenLength = (node) => {
      const raw = docLines[node.line - 1] || "";
      const cell = table.cells(raw).find((c) => c.col === node.valueCol);
      // a data cell holds its value whole; a header default's value starts
      // after its colon and runs to the cell's divider
      const text = cell ? cell.text : raw.slice(node.valueCol).split("|")[0].trim();
      return table.splitCell(text).value.length || node.value.length;
    };
    for (const node of nodes) {
      // a table's parent column is headed as an attribute is, and each cell
      // under it names a row — an Example, coloured as one
      for (const col of node.parentColumns || []) {
        builder.push(col.line - 1, col.nameCol, table.PARENT_TERM.length, ATTR_TOKEN);
        if (col.alias && col.aliasCol !== undefined) builder.push(col.line - 1, col.aliasCol, col.alias.length, ATTR_TOKEN);
      }
      if (node.kind === KIND.INDIVIDUAL && node.parentCell) {
        builder.push(node.line - 1, node.parentCell.col, node.parentCell.text.length, EXAMPLE_TOKEN);
      }
      if (node.kind === KIND.ATTRIBUTE && node.cell) {
        builder.push(node.line - 1, node.nameCol, node.name.length, ATTR_TOKEN);
        if (node.alias && node.aliasCol !== undefined) {
          builder.push(node.line - 1, node.aliasCol, node.alias.length, ATTR_TOKEN);
        }
      } else if (node.kind === KIND.INDIVIDUAL && node.nameCol !== undefined && node.name) {
        builder.push(node.line - 1, node.nameCol, node.name.length, EXAMPLE_TOKEN);
      } else if (node.kind === KIND.DEFAULT && node.cell && node.value) {
        builder.push(node.line - 1, node.valueCol, writtenLength(node), VALUE_TOKEN);
      } else if (node.kind === KIND.DEFAULT && node.header) {
        // a header cell stating its column's default: the attribute, then its value
        builder.push(node.line - 1, node.nameCol, node.name.length, ATTR_TOKEN);
        if (node.alias && node.aliasCol !== undefined) {
          builder.push(node.line - 1, node.aliasCol, node.alias.length, ATTR_TOKEN);
        }
        if (node.value) builder.push(node.line - 1, node.valueCol, writtenLength(node), VALUE_TOKEN);
      }
    }
    // everything from an operator to its end is Python — a derivation on a
    // value, a cell or a Concept, or a constraint's bound — in its own
    // colour, so code reads apart from the data at a glance. A Concept's own
    // derivation is painted here too: the grammar cannot tell it from the
    // Concept's name.
    for (const f of codeSpans(docLines, root, nodes, docRootName(doc))) {
      builder.push(f.line - 1, f.startCol, f.endCol - f.startCol, PYTHON_TOKEN);
    }
    return builder.build();
  },
};

// --- the org table editor ---------------------------------------------------
// Each command finds the table block under the cursor, applies one of the
// pure operations from table.js, redraws the whole block aligned, and lands
// the cursor at the start of the target cell — so every table keystroke
// re-aligns, exactly as org's TAB does. The Tab/Enter/Alt+Arrow keybindings
// are gated on the aot.inTable context so they only fire inside a table.

function runTableOp(editor, op) {
  const doc = editor.document;
  const lines = doc.getText().split(/\r?\n/);
  const pos = editor.selection.active;
  const block = table.blockAt(lines, pos.line);
  if (!block) return;
  const cursorRow = pos.line - block.start;
  // A table a 1.12 file nested by indent is rewritten with its parent
  // column before any key acts on it — the first key pressed in it is its
  // migration — and a column index past the one added moves with it.
  const added = table.flatten(block);
  const shifted = (c) => (added !== -1 && c >= added ? c + 1 : c);
  const col = shifted(table.colAt(lines[pos.line], pos.character));
  // A selection travels as cells — its two ends' rows (clamped into the
  // block) and columns — for the operations that act on a range, the fills;
  // every other operation takes the cursor's cell and ignores it.
  const sel = editor.selection;
  const span = sel.isEmpty ? undefined : {
    anchor: {
      row: Math.max(0, Math.min(sel.anchor.line - block.start, block.rows.length - 1)),
      col: shifted(table.colAt(lines[sel.anchor.line] || "", sel.anchor.character)),
    },
    active: { row: cursorRow, col },
  };
  const target = op(block, cursorRow, col, span);
  if (!target) {
    // the column keys leave the first column alone: it names the Concept
    // and its Examples, and is no attribute to move, copy or delete
    if (col === 0 && [table.deleteColumn, tableOps["aot.table.moveColumnRight"], tableOps["aot.table.copyColumnLeft"],
      tableOps["aot.table.copyColumnRight"]].includes(op)) {
      vscode.window.setStatusBarMessage("AOT: the first column names the Concept and its Examples — it is not an attribute column.", 4000);
    }
    return;
  }
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const range = new vscode.Range(block.start, 0, block.end, doc.lineAt(block.end).text.length);
  editor.edit((b) => b.replace(range, table.render(block).join(eol))).then(() => {
    const line = block.start + target.row;
    const character = table.cellStart(block, target.col);
    // an operation that acted on a range hands its anchor back, so the
    // selection it filled stays selected, as a spreadsheet's does
    const from = target.anchor
      ? { line: block.start + target.anchor.row, character: table.cellStart(block, target.anchor.col) }
      : { line, character };
    editor.selection = new vscode.Selection(from.line, from.character, line, character);
    editor.revealRange(new vscode.Range(line, character, line, character));
  });
}

const tableOps = {
  "aot.table.nextCell": table.nextCell,
  "aot.table.prevCell": table.prevCell,
  "aot.table.demoteRow": table.demoteRow,
  "aot.table.promoteRow": table.promoteRow,
  "aot.table.nextRow": table.nextRow,
  "aot.table.moveColumnLeft": (b, r, c) => table.moveColumn(b, r, c, -1),
  "aot.table.moveColumnRight": (b, r, c) => table.moveColumn(b, r, c, 1),
  "aot.table.moveRowUp": (b, r, c) => table.moveRow(b, r, c, -1),
  "aot.table.moveRowDown": (b, r, c) => table.moveRow(b, r, c, 1),
  "aot.table.insertColumn": table.insertColumn,
  "aot.table.deleteColumn": table.deleteColumn,
  "aot.table.insertRow": table.insertRow,
  "aot.table.deleteRow": table.deleteRow,
  "aot.table.sortRows": table.sortRows,
  "aot.table.copyFormulaDown": table.copyFormulaDown,
  "aot.table.copyFormulaAcross": table.copyFormulaAcross,
  "aot.table.defineColumn": table.defineColumn,
  // copying and cutting the text itself, in each of the four directions —
  // the cell, the whole row, the whole column
  "aot.table.copyCellDown": (b, r, c) => table.copyCell(b, r, c, 1, 0),
  "aot.table.copyCellUp": (b, r, c) => table.copyCell(b, r, c, -1, 0),
  "aot.table.copyCellLeft": (b, r, c) => table.copyCell(b, r, c, 0, -1),
  "aot.table.copyCellRight": (b, r, c) => table.copyCell(b, r, c, 0, 1),
  "aot.table.moveCellDown": (b, r, c) => table.moveCell(b, r, c, 1, 0),
  "aot.table.moveCellUp": (b, r, c) => table.moveCell(b, r, c, -1, 0),
  "aot.table.moveCellLeft": (b, r, c) => table.moveCell(b, r, c, 0, -1),
  "aot.table.moveCellRight": (b, r, c) => table.moveCell(b, r, c, 0, 1),
  "aot.table.copyRowDown": (b, r, c) => table.copyRow(b, r, c, 1),
  "aot.table.copyRowUp": (b, r, c) => table.copyRow(b, r, c, -1),
  "aot.table.copyColumnLeft": (b, r, c) => table.copyColumn(b, r, c, -1),
  "aot.table.copyColumnRight": (b, r, c) => table.copyColumn(b, r, c, 1),
  // the spreadsheet's own editing keys: fill down / right over the cell or
  // the selection (Ctrl+D / Ctrl+R), and the derivation or the value from
  // the cell above (Ctrl+' / Ctrl+Shift+')
  "aot.table.fillDown": table.fillDown,
  "aot.table.fillRight": table.fillRight,
  "aot.table.copyFormulaFromAbove": table.copyFormulaFromAbove,
  "aot.table.copyValueFromAbove": table.copyValueFromAbove,
};

// --- the spreadsheet's movement keys ----------------------------------------
// Ctrl+arrow and Ctrl+Home/End move the cursor as a spreadsheet does, and
// with Shift they select; Ctrl+A takes the table before the file. Moving is
// not editing, so nothing is redrawn: the cursor lands on the target cell's
// text wherever it stands on its line, aligned or not.

// The table at the cursor, with the cursor's row and column in it; null off
// a table.
function tableAtCursor(editor) {
  const lines = editor.document.getText().split(/\r?\n/);
  const pos = editor.selection.active;
  const block = table.blockAt(lines, pos.line);
  if (!block) return null;
  return { lines, block, row: pos.line - block.start, col: table.colAt(lines[pos.line], pos.character) };
}

// Where a cell's text begins on its own line as written; a row too short to
// have the cell ends where its line does.
function cellPosition(here, target) {
  const line = here.block.start + target.row;
  const text = here.lines[line] || "";
  const cell = table.cells(text)[target.col];
  return { line, character: cell ? cell.col : text.length };
}

function placeCursor(editor, at, extend) {
  const from = extend ? editor.selection.anchor : at;
  editor.selection = new vscode.Selection(from.line, from.character, at.line, at.character);
  editor.revealRange(new vscode.Range(at.line, at.character, at.line, at.character));
}

function moveInTable(editor, here, target, extend) {
  placeCursor(editor, cellPosition(here, target), extend);
}

// --- the table keys in free text --------------------------------------------
// A Concept written as lines is a grid too — its Examples the rows, its
// attributes the columns, an Example's 'attribute: value' line a cell — so
// every table key but Enter works there as well (src/lineform.js). The
// aot.inGrid context says, from the text alone, when the cursor stands on
// an Example's line or one of its values; the parse has the last word when
// a key is pressed, and where it finds no grid after all the key does what
// VS Code does with it, so it is never dead.

// The line-form grid the cursor stands in, with the lines it was read from.
// `header`: a column's declaration line counts too (the column keys only).
function lineGridAt(editor, header) {
  const doc = editor.document;
  const lines = doc.getText().split(/\r?\n/);
  try {
    const { nodes } = parsedDoc(doc);
    const grid = lineform.gridAt(lines, nodes, editor.selection.active.line, { header: !!header });
    return grid ? { lines, grid } : null;
  } catch {
    return null; // an unparseable document is no grid
  }
}

// VS Code's own command for each key the table editor takes.
const OWN_KEY = {
  "aot.table.nextCell": "tab",
  "aot.table.prevCell": "outdent",
  "aot.table.moveRowUp": "editor.action.moveLinesUpAction",
  "aot.table.moveRowDown": "editor.action.moveLinesDownAction",
  "aot.table.copyRowUp": "editor.action.insertCursorAbove",
  "aot.table.copyRowDown": "editor.action.insertCursorBelow",
  "aot.table.insertRow": "editor.action.copyLinesDownAction",
  "aot.table.deleteRow": "editor.action.copyLinesUpAction",
  "aot.table.insertColumn": "editor.action.smartSelect.expand",
  "aot.table.deleteColumn": "editor.action.smartSelect.shrink",
  "aot.table.fillDown": "editor.action.addSelectionToNextFindMatch",
  "aot.table.fillRight": "workbench.action.openRecent",
  "aot.table.jumpUp": "scrollLineUp",
  "aot.table.jumpDown": "scrollLineDown",
  "aot.table.jumpLeft": "cursorWordStartLeft",
  "aot.table.jumpRight": "cursorWordEndRight",
  "aot.table.selectToEdgeLeft": "cursorWordStartLeftSelect",
  "aot.table.selectToEdgeRight": "cursorWordEndRightSelect",
  "aot.table.firstCell": "cursorTop",
  "aot.table.lastCell": "cursorBottom",
  "aot.table.selectToFirstCell": "cursorTopSelect",
  "aot.table.selectToLastCell": "cursorBottomSelect",
  "aot.table.selectTable": "editor.action.selectAll",
};
const ownKey = (id) => (OWN_KEY[id] ? vscode.commands.executeCommand(OWN_KEY[id]) : undefined);

// The whole-line replacement that turns `lines` into the changed run
// lineform.changedLines found — a deletion takes its line break with it.
function lineChangeEdit(doc, lines, change) {
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const text = change.lines.join(eol);
  if (change.to >= change.from) {
    if (change.lines.length) return [new vscode.Range(change.from, 0, change.to, lines[change.to].length), text];
    if (change.to + 1 < lines.length) return [new vscode.Range(change.from, 0, change.to + 1, 0), ""];
    if (change.from > 0) {
      return [new vscode.Range(change.from - 1, lines[change.from - 1].length, change.to, lines[change.to].length), ""];
    }
    return [new vscode.Range(0, 0, change.to, lines[change.to].length), ""];
  }
  if (change.from < lines.length) return [new vscode.Range(change.from, 0, change.from, 0), text + eol];
  const last = lines.length - 1;
  return [new vscode.Range(last, lines[last].length, last, lines[last].length), eol + text];
}

// A table key pressed in free text: the operation lineform answers, applied
// in place as one edit, the cursor (and a filled selection) put back.
async function runLineOp(editor, id) {
  if (id === "aot.table.copyFormulaDown") return copyFormulaToSiblings(editor); // line form's own copy-down
  const name = id.replace("aot.table.", "");
  const here = lineGridAt(editor, lineform.COLUMN_OPS.has(name));
  if (!here) return ownKey(id);
  const op = lineform.ops[name];
  if (!op) return;
  const sel = editor.selection;
  const span = sel.isEmpty ? undefined : {
    anchor: { line: sel.anchor.line, ch: sel.anchor.character },
    active: { line: sel.active.line, ch: sel.active.character },
  };
  const answer = op(here.grid, span);
  if (!answer) return;
  const done = lineform.resolve(here.lines, answer);
  const change = lineform.changedLines(here.lines, done.lines);
  if (change) {
    const [range, text] = lineChangeEdit(editor.document, here.lines, change);
    await editor.edit((b) => b.replace(range, text));
  }
  if (!done.cursor) return;
  const from = done.anchor || done.cursor;
  editor.selection = new vscode.Selection(from.line, from.ch, done.cursor.line, done.cursor.ch);
  editor.revealRange(new vscode.Range(done.cursor.line, done.cursor.ch, done.cursor.line, done.cursor.ch));
}

// A line-form move: the cursor to where lineform's answer puts it.
function moveInLines(editor, here, answer, extend) {
  const at = answer && lineform.resolve(here.lines, answer).cursor;
  if (at) placeCursor(editor, { line: at.line, character: at.ch }, extend);
}

// Each movement key answers false when the cursor is in no grid at all, and
// the key then does what VS Code does with it.

// Ctrl+arrow (Shift: select): to the edge of the data, table.jumpCell — or,
// in free text, lineform.jump.
function jumpInTable(editor, dRow, dCol, extend) {
  const here = tableAtCursor(editor);
  if (here) {
    const target = table.jumpCell(here.block, here.row, here.col, dRow, dCol);
    if (target) moveInTable(editor, here, target, extend);
    return true;
  }
  const lines = lineGridAt(editor);
  if (!lines) return false;
  moveInLines(editor, lines, lineform.jump(lines.grid, dRow, dCol), extend);
  return true;
}

// Ctrl+Home / Ctrl+End (Shift: select): the table's corner — and from the
// corner already, the file's, so a second press leaves the table as it
// would leave a sheet's data. In free text, the first Example's name and
// the last Example's last value.
function cornerOfTable(editor, which, extend) {
  const leave = () => {
    const move = which === "home" ? "cursorTop" : "cursorBottom";
    return vscode.commands.executeCommand(extend ? move + "Select" : move);
  };
  const here = tableAtCursor(editor);
  if (here) {
    const target = table.cornerCell(here.block, which);
    if (!target || (here.row === target.row && here.col === target.col)) return leave();
    moveInTable(editor, here, target, extend);
    return true;
  }
  const lines = lineGridAt(editor);
  if (!lines) return false;
  const at = lineform.resolve(lines.lines, lineform.corner(lines.grid, which)).cursor;
  if (!at || at.line === editor.selection.active.line) return leave();
  placeCursor(editor, { line: at.line, character: at.ch }, extend);
  return true;
}

// Ctrl+A: the table the cursor stands in — in free text, the Concept whose
// Examples it is among — and with that already selected, the whole file: a
// spreadsheet's current region, then everything.
function selectTable(editor) {
  let from, to, lines;
  const here = tableAtCursor(editor);
  if (here) {
    ({ lines } = here);
    from = here.block.start;
    to = here.block.end;
  } else {
    const grid = lineGridAt(editor);
    const span = grid && lineform.conceptSpan(grid.grid);
    if (!span) return false;
    ({ lines } = grid);
    ({ from, to } = span);
  }
  const start = { line: from, character: 0 };
  const end = { line: to, character: (lines[to] || "").length };
  const sel = editor.selection;
  const same = (a, b) => a.line === b.line && a.character === b.character;
  if (same(sel.start, start) && same(sel.end, end)) {
    return vscode.commands.executeCommand("editor.action.selectAll");
  }
  editor.selection = new vscode.Selection(start.line, start.character, end.line, end.character);
  return true;
}

const tableMoves = {
  "aot.table.jumpUp": (e) => jumpInTable(e, -1, 0, false),
  "aot.table.jumpDown": (e) => jumpInTable(e, 1, 0, false),
  "aot.table.jumpLeft": (e) => jumpInTable(e, 0, -1, false),
  "aot.table.jumpRight": (e) => jumpInTable(e, 0, 1, false),
  "aot.table.selectToEdgeUp": (e) => jumpInTable(e, -1, 0, true),
  "aot.table.selectToEdgeDown": (e) => jumpInTable(e, 1, 0, true),
  "aot.table.selectToEdgeLeft": (e) => jumpInTable(e, 0, -1, true),
  "aot.table.selectToEdgeRight": (e) => jumpInTable(e, 0, 1, true),
  "aot.table.firstCell": (e) => cornerOfTable(e, "home", false),
  "aot.table.lastCell": (e) => cornerOfTable(e, "end", false),
  "aot.table.selectToFirstCell": (e) => cornerOfTable(e, "home", true),
  "aot.table.selectToLastCell": (e) => cornerOfTable(e, "end", true),
  "aot.table.selectTable": selectTable,
};

// Ctrl+; / Ctrl+Shift+;: today's date, or the time now, at every cursor.
// The date is written YYYY-MM-DD, the one form every reader of a value — a
// formula's comparison, a date constraint, the CSV mirror — takes as a date.
function insertNow(editor, what) {
  const now = new Date();
  const two = (n) => String(n).padStart(2, "0");
  const text = what === "date"
    ? `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
    : `${two(now.getHours())}:${two(now.getMinutes())}`;
  return editor.edit((b) => { for (const s of editor.selections) b.replace(s, text); });
}

// Turn the selected delimited lines (CSV, TSV, or multi-space columns) into
// an aligned table, org's C-c |: the first line is the header.
function fromSelection(editor) {
  const doc = editor.document;
  const sel = editor.selection;
  if (sel.isEmpty) return;
  const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
  const lines = [];
  for (let i = sel.start.line; i <= endLine; i++) lines.push(doc.lineAt(i).text);
  const rendered = table.fromRegion(lines);
  if (!rendered) return;
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const range = new vscode.Range(sel.start.line, 0, endLine, doc.lineAt(endLine).text.length);
  editor.edit((b) => b.replace(range, rendered.join(eol)));
}

// The cursor sits in a table when its line is a row: one divider is all a
// row has left to show for itself, and a separator rule counts too — even
// the half-typed '--' that Tab completes.
//
// Free text is a grid too, so aot.inGrid is set on an Example's '- ' line
// and on its value lines as well — every table key but Enter works there
// (src/lineform.js). A bare attribute line is neither, so Tab still indents
// it. Decided from the text alone: this runs on every cursor move.
//
// aot.inColumn is aot.inGrid plus an attribute's declaration line in free
// text (`age` under a Concept written as lines): that line is the column's
// header, so the column keys — Alt+←/→, Alt+Shift+←/→, Ctrl+Alt+←/→ — work
// there too, while Tab keeps indenting it.
function updateTableContext() {
  const editor = vscode.window.activeTextEditor;
  const doc = editor && editor.document;
  const line = editor ? editor.selection.active.line : -1;
  const ok = !!(doc && doc.languageId === "aot" && line >= 0 && line < doc.lineCount);
  const textOf = (i) => (i >= 0 && i < doc.lineCount ? doc.lineAt(i).text : undefined);
  const inTable = ok && table.isRowText(doc.lineAt(line).text);
  const inGrid = inTable || (ok && lineform.looksLikeCell(textOf, line));
  const inColumn = inGrid || (ok && lineform.looksLikeDeclaration(textOf, line));
  vscode.commands.executeCommand("setContext", "aot.inTable", inTable);
  vscode.commands.executeCommand("setContext", "aot.inGrid", inGrid);
  vscode.commands.executeCommand("setContext", "aot.inColumn", inColumn);
}

// --- keeping your place in a wide or long table -----------------------------
// A text editor cannot freeze a column the way a spreadsheet does: there is
// one scroll surface and it carries the whole line. Two things stand in for
// it, and between them they answer both directions.
//
// Down the table, the **document symbols** below make the header line the
// parent of its rows, so VS Code's own sticky scroll pins it to the top of
// the viewport exactly as it pins an enclosing Concept. That is the freeze,
// done by the editor rather than faked by the extension — and it costs
// nothing, because the tree is already parsed.
//
// Across the table, nothing can pin the name column, so the status bar says
// what the frozen column would have shown and then some: the Concept, the
// Example the cursor's row names, and the attribute its column declares.
// `Person ▸ Socrates ▸ occupation` reads the same however far right you are.

let cellStatus = null;

// The cell address at the cursor, or null when the cursor is not in a table
// with a readable header.
function cellAddress(editor) {
  const doc = editor.document;
  if (!doc || doc.languageId !== "aot") return null;
  const at = editor.selection.active;
  if (at.line >= doc.lineCount) return null;
  // The cursor's own table, found by walking out from the cursor rather than
  // by splitting the whole document. This runs on every cursor movement,
  // including every left/right arrow, so it must not cost the file's length —
  // and a block is bounded by what is not a row (table.blockAt), so the run
  // around the cursor is all there is to read.
  if (!table.isRowText(doc.lineAt(at.line).text)) return null;
  let first = at.line, last = at.line;
  while (first > 0 && table.isRowText(doc.lineAt(first - 1).text)) first--;
  while (last + 1 < doc.lineCount && table.isRowText(doc.lineAt(last + 1).text)) last++;
  // one line of margin on each side where the document has one, so the block
  // meets its own edges exactly as it would inside the whole file
  const from = Math.max(0, first - 1);
  const to = Math.min(doc.lineCount - 1, last + 1);
  const lines = [];
  for (let l = from; l <= to; l++) lines.push(doc.lineAt(l).text);
  const block = table.blockAt(lines, at.line - from);
  if (!block) return null;
  const header = block.rows.find((r) => !r.sep);
  if (!header) return null;
  const row = block.rows[at.line - from - block.start];
  if (!row || row.sep) return null;
  const col = table.colAt(doc.lineAt(at.line).text, at.character);
  const concept = table.cleanName(header.cells[0] || "") || "";
  // the header row addresses its own column; a data row also names its Example
  const example = row === header ? null : (row.cells[0] || "").trim();
  const attribute = col > 0 ? table.cleanName(header.cells[col] || "") : null;
  const parts = [concept, example, col === 0 ? null : attribute].filter(Boolean);
  return parts.length ? parts.join(" ▸ ") : null;
}

function updateCellStatus() {
  if (!cellStatus) return;
  const editor = vscode.window.activeTextEditor;
  const address = editor ? cellAddress(editor) : null;
  if (!address) return cellStatus.hide();
  cellStatus.text = `$(table) ${address}`;
  cellStatus.tooltip = "The cell at the cursor: Concept ▸ Example ▸ attribute";
  cellStatus.show();
}

// The document's outline: the parsed tree as symbols, so breadcrumbs, the
// Outline view, and — the reason this exists — **sticky scroll** all follow
// the model rather than guessing from indentation. A node's range runs from
// its own line to the last line of its subtree, which is what makes a table's
// header the parent of its rows and pins it while you scroll them.
const SYMBOL_KIND = {
  [KIND.CONCEPT]: () => vscode.SymbolKind.Class,
  [KIND.INDIVIDUAL]: () => vscode.SymbolKind.Constant,
  [KIND.ATTRIBUTE]: () => vscode.SymbolKind.Property,
  [KIND.DEFAULT]: () => vscode.SymbolKind.Field,
};

const symbolProvider = {
  provideDocumentSymbols(doc) {
    let analysis;
    try { analysis = currentAnalysis(doc) || parsedDoc(doc); }
    catch { return []; }
    const { root, nodes } = analysis;
    if (!root) return [];
    // A table never nests its rows by place (1.13): a row may stand anywhere
    // in its grid, above the row it sits under or below it, so a row's
    // symbol could not contain its sub-rows' — and a symbol's range must
    // contain its children's. A grid's rows are listed flat under its
    // header, in the order they are written, as the table reads; the tree
    // is the parent column's to show. Everything else nests as written.
    const isRow = (n) => n.kind === KIND.INDIVIDUAL && n.nameCol !== undefined;
    const subRows = (n) => n.children.filter(isRow).flatMap((c) => [c, ...subRows(c)]);
    const lastLine = (node) => {
      let last = node.line || 0;
      for (const c of node.children) {
        if (isRow(node) && isRow(c)) continue; // a sub-row is listed beside it
        last = Math.max(last, lastLine(c), ...(isRow(c) && !isRow(node) ? subRows(c).map(lastLine) : []));
      }
      return last;
    };
    const clamp = (line) => Math.min(Math.max(line - 1, 0), doc.lineCount - 1);

    // The table block a line belongs to, with the line its header row sits
    // on — cached per block, since every row of a grid asks the same
    // question. Written as a table the Concept *is* the header cell and the
    // tree already nests the rows under it; written in the merge form the
    // Concept has its own line above the grid, and the header row is just
    // another line among the Concept's children. The wrapper below restores
    // the nesting in that case, so the header pins either way.
    const lines = doc.getText().split(/\r?\n/);
    const blocks = new Map(); // line index -> block info or null
    const blockOf = (at) => {
      if (blocks.has(at)) return blocks.get(at);
      const block = table.blockAt(lines, at);
      let info = null;
      if (block) {
        const headerAt = block.rows.findIndex((r) => !r.sep);
        if (headerAt !== -1) {
          const header = block.rows[headerAt];
          info = {
            start: block.start,
            end: block.end,
            headerLine: block.start + headerAt,
            name: table.cleanName(header.cells[0] || "") || "table",
          };
        }
      }
      for (let i = block ? block.start : at; i <= (block ? block.end : at); i++) blocks.set(i, info);
      return info;
    };
    const headerSymbol = (info) => new vscode.DocumentSymbol(
      info.name, "", vscode.SymbolKind.Class,
      new vscode.Range(info.headerLine, 0, info.end, doc.lineAt(info.end).text.length),
      new vscode.Range(info.headerLine, 0, info.headerLine, doc.lineAt(info.headerLine).text.length));

    // Anything sharing its parent's line is nothing to navigate *to*: a
    // table cell's value, the Example that rode in on a `Concept: value`
    // line. It is skipped, and whatever hangs off it is lifted to where it
    // was, so no branch of the tree is lost with it.
    const childrenOf = (node) => {
      const out = [];
      let open = null; // the header symbol currently collecting a grid's rows
      const own = node.line ? node.line - 1 : -1;
      // a row's sub-rows stand beside it, under the table, in written order
      const kids = [];
      for (const child of node.children) {
        if (isRow(node) && isRow(child)) continue;
        kids.push(child);
        if (isRow(child) && !isRow(node)) kids.push(...subRows(child));
      }
      if (kids.some(isRow)) kids.sort((a, b) => (a.line || 0) - (b.line || 0));
      for (const child of kids) {
        const built = build(child);
        for (const symbol of built ? [built] : childrenOf(child)) {
          const at = symbol.range.start.line;
          const info = blockOf(at);
          // a row of a grid whose header line is neither this node's own line
          // nor the row's own: the header row is a line of its own, so it
          // becomes the parent it reads as
          if (info && info.headerLine !== own && info.headerLine !== at) {
            if (!open || open.start !== info.start) {
              open = { start: info.start, symbol: headerSymbol(info) };
              out.push(open.symbol);
            }
            open.symbol.children.push(symbol);
            continue;
          }
          open = null;
          out.push(symbol);
        }
      }
      return out;
    };
    const build = (node) => {
      // a Map marks what is missing; it names nothing to navigate to
      if (node.kind === KIND.MAP || !node.line || !node.name) return null;
      if (node.parent && node.parent.line === node.line) return null;
      const kindOf = SYMBOL_KIND[node.kind];
      const at = clamp(node.line);
      const end = clamp(lastLine(node));
      const line = doc.lineAt(at);
      const symbol = new vscode.DocumentSymbol(
        node.name,
        node.kind === KIND.DEFAULT && node.value != null ? String(node.value) : "",
        kindOf ? kindOf() : vscode.SymbolKind.Variable,
        new vscode.Range(at, 0, end, doc.lineAt(end).text.length),
        // the selection range must sit inside the range, so it is this line
        new vscode.Range(at, line.firstNonWhitespaceCharacterIndex || 0, at, line.text.length));
      symbol.children = childrenOf(node);
      return symbol;
    };
    void nodes;
    return childrenOf(root);
  },
};

// Typing a first '|' on an otherwise empty line scaffolds a fresh table —
// header and an empty data row — with the cursor in the data row when
// the enclosing Concept has already named the first header cell:
//
//     |Otter|
//     |-----|
//     |     |     <- cursor lands here
//
// At the top level nothing names it, so the first cell is left empty and the
// cursor waits in the header instead.
//
// Attributes the enclosing line inherits from its ancestors arrive as
// ready-made columns (creation-time only — a table is never re-columned
// when attributes are declared later). The parent's own attribute lines
// are left out: they already declare, and a same-named column would be a
// duplicate. One Ctrl+Z undoes the whole thing (the edit merges with the
// keystroke). A '|' typed beside an existing table, or mid-line,
// scaffolds nothing.
let scaffolding = false;

// The columns a fresh table inherits: attribute names declared on the
// parent's ancestors, outermost first, deduped case-insensitively, minus
// the names the parent declares itself.
function inheritedColumns(parentNode) {
  const declares = (n) => n.children
    .filter((k) => k.kind === KIND.ATTRIBUTE || (k.kind === KIND.DEFAULT && !k.cell))
    .map((k) => k.name);
  const own = new Set(declares(parentNode).map((n) => n.toLowerCase()));
  const chain = [];
  for (let p = parentNode.parent; p; p = p.parent) chain.unshift(p);
  const out = [], seen = new Set(["name"]);
  for (const p of chain) {
    for (const name of declares(p)) {
      const key = name.toLowerCase();
      if (seen.has(key) || own.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

// The node of the line a new table at `at` (0-based) with `indentLen`
// leading spaces is filed under: the nearest shallower non-blank line,
// else the root.
function scaffoldParent(doc, at, indentLen, root, nodes) {
  for (let i = at - 1; i >= 0; i--) {
    const raw = doc.lineAt(i).text;
    if (!raw.trim()) continue;
    const ind = raw.match(/^ */)[0].length;
    if (ind >= indentLen) continue;
    const here = nodes.filter((n) => n.line === i + 1);
    if (!here.length) return root;
    return here.reduce((best, n) => (n.depth < best.depth ? n : best));
  }
  return root;
}

async function maybeScaffold(event) {
  if (scaffolding || event.document.languageId !== "aot") return;
  if (event.contentChanges.length !== 1) return;
  const c = event.contentChanges[0];
  if (c.text !== "|" || !c.range.isEmpty) return;
  const doc = event.document;
  const at = c.range.start.line;
  if (at >= doc.lineCount) return;
  const text = doc.lineAt(at).text;
  if (text.trim() !== "|") return;
  const near = (i) => i >= 0 && i < doc.lineCount && table.isRowText(doc.lineAt(i).text);
  if (near(at - 1) || near(at + 1)) return;
  const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
  if (!editor) return;
  const indent = text.slice(0, text.indexOf("|"));
  // the first header cell names the Concept the table describes (1.9): the
  // enclosing Concept when the table is filed under one (a merge-form grid),
  // else empty for the writer to name — and then the cursor waits there.
  let columns = [], first = "";
  try {
    const { root, nodes } = parsedDoc(doc);
    const parentNode = scaffoldParent(doc, at, indent.length, root, nodes);
    columns = inheritedColumns(parentNode);
    if (parentNode && parentNode !== root && parentNode.name) first = parentNode.name;
  } catch { /* an unparseable document scaffolds the plain skeleton */ }
  // a table is cells DIVIDED, so a skeleton with nothing inherited still
  // gets one empty column beside the Concept for the writer to name
  const header = [first, ...(columns.length ? columns : [""])];
  const block = {
    indent,
    rows: [
      { sep: false, cells: header },
      { sep: false, cells: header.map(() => "") },
    ],
  };
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  scaffolding = true;
  try {
    await editor.edit(
      (b) => b.replace(doc.lineAt(at).range, table.render(block).join(eol)),
      { undoStopBefore: false, undoStopAfter: true });
    // a named Concept: land in the data row to add Examples; an unnamed one:
    // land in the header's first cell to name the Concept first
    const ch = indent.length;
    const line = first ? at + 1 : at;
    editor.selection = new vscode.Selection(line, ch, line, ch);
  } finally {
    scaffolding = false;
  }
}

function activate(context) {
  // what each CSV and its .aot last agreed on, kept per machine in the
  // extension's own storage — the workspace's, else the global one
  const store = context.storageUri || context.globalStorageUri;
  if (store && store.fsPath) baselineStore = diskBaselines(path.join(store.fsPath, "csv-sync"));
  const diagnostics = vscode.languages.createDiagnosticCollection("aot");
  // A crosslink is a *state* (navigable) layered on a token that already has
  // its own *type* colour from the grammar. So we add only an underline and
  // leave the colour alone: the link inherits the token's colour (no
  // ThemeColor override), which means it can never collide with another
  // token's hue the way textLink.foreground did with examples. The two link
  // kinds are told apart by underline style, not by colour:
  //   solid  -> the target is a Concept
  //   dotted -> the target is an Example
  const decorationTypes = {
    concept: vscode.window.createTextEditorDecorationType({
      textDecoration: "underline",
    }),
    individual: vscode.window.createTextEditorDecorationType({
      textDecoration: "underline dotted",
    }),
    // a value whose derivation is parked: the inlay-hint colours, because
    // that is exactly what it is — a number the editor is showing you rather
    // than one you wrote. A tinted span, never added text, so a marked cell
    // stays the width its column aligned it to.
    parked: vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editorInlayHint.background"),
      borderColor: new vscode.ThemeColor("editorInlayHint.foreground"),
      borderStyle: "none none dashed none",
      borderWidth: "0 0 1px 0",
      borderRadius: "2px",
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
  };
  // a Python value older than its derivation (edited, or an input moved
  // since it ran): faded, so a number that is not current does not read as
  // one that is
  decorationTypes.stale = vscode.window.createTextEditorDecorationType({ opacity: "0.55" });
  decorationTypes.pyLink = vscode.window.createTextEditorDecorationType({ textDecoration: "underline" });
  // the F2 nudge's ghost text, in the editor's native ghost-text colour
  renameHintType = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor("editorGhostText.foreground"), margin: "0 0 0 2em" },
  });
  // Python's findings in a collection of their own: a failed run, or one
  // not yet made, is never a verdict on the model, so never in V
  pyDiagnostics = vscode.languages.createDiagnosticCollection("aot-python");
  pyState = context.workspaceState || null;
  // the allowed versions of the Python files, kept beside the workspace's
  // own state rather than in the repository
  const storage = context.storageUri || context.globalStorageUri;
  if (storage && storage.fsPath) pySnapshotRoot = path.join(storage.fsPath, "allowed-python");
  context.subscriptions.push(diagnostics, decorationTypes.concept, decorationTypes.individual,
    decorationTypes.parked, decorationTypes.stale, decorationTypes.pyLink, renameHintType, pyDiagnostics);

  const timers = new Map();
  const refreshSoon = (doc) => {
    clearTimeout(timers.get(doc.uri.toString()));
    timers.set(doc.uri.toString(),
      setTimeout(() => refresh(diagnostics, decorationTypes, doc), DEBOUNCE_MS));
  };
  // Cross-file findings (duplicate Concepts, crosslinks) are computed from
  // the workspace index at each document's own analyse — so when one file's
  // entry changes, every *other* open .aot must re-analyse or its squiggles
  // go stale (a duplicate warning surviving the other definition's deletion).
  const refreshPeers = (changedFsPath) => {
    for (const d of vscode.workspace.textDocuments) {
      if (d.languageId !== "aot") continue;
      if (changedFsPath && fileKey(d.fileName) === fileKey(changedFsPath)) continue;
      refreshSoon(d);
    }
  };

  // an edit burst's findings (see hold.js and refresh): released when the
  // cursor leaves what is being edited, on save, and when another editor
  // takes over — what waited publishes then
  releaseHold = (doc) => {
    const state = holdState.get(doc.uri.toString());
    if (!state) return;
    holdState.delete(doc.uri.toString());
    refresh(diagnostics, decorationTypes, doc);
    updateHoldStatus();
  };
  const trackEdits = (event) => {
    const doc = event.document;
    if (doc.languageId !== "aot" || !event.contentChanges.length) return;
    // a burst is the writer's, in the editor being written in: an edit made
    // to a document no one is typing in (a CSV folded in, a peer reconciled)
    // has no cursor to leave its family, and holds nothing
    const active = vscode.window.activeTextEditor;
    if (!active || active.document !== doc) return;
    const key = doc.uri.toString();
    let state = holdState.get(key);
    if (!state) {
      // the burst begins: what is on screen now keeps showing
      state = {
        baseline: new Set((diagnostics.get(doc.uri) || []).map(hold.keyOf)),
        edited: new Set(), lastLine: 0, family: null, held: [],
      };
      holdState.set(key, state);
    }
    // bottom up, so each change's lines are still the ones it names
    const changes = [...event.contentChanges].sort((a, b) => b.range.start.line - a.range.start.line);
    for (const c of changes) {
      const start = c.range.start.line, end = c.range.end.line;
      const written = String(c.text).split(/\r\n|\r|\n/);
      const added = written.length;
      // Enter at the end of a line (auto-indent and all) writes the lines
      // after it, and leaves that line — a parent's, typically — as it was:
      // the text's last line then stands alone on its line, nothing after it
      const atEnd = start === end && c.range.start.character === c.range.end.character && added > 1
        && written[0].trim() === "" && start + added - 1 < doc.lineCount
        && doc.lineAt(start + added - 1).text === written[added - 1];
      state.edited = hold.shiftLines(state.edited, { start, end, added, from: atEnd ? start + 1 : start });
      // the family's lines move with the text, as the edited ones do
      const delta = added - (end - start + 1);
      if (state.family && start + 1 <= state.family.to) {
        state.family.to += delta;
        if (start + 1 < state.family.from) state.family.from += delta;
      }
    }
    const first = event.contentChanges[0];
    state.lastLine = first.range.start.line + String(first.text).split(/\r\n|\r|\n/).length - 1;
  };

  relintAll = () => vscode.workspace.textDocuments.forEach((doc) => refresh(diagnostics, decorationTypes, doc));
  relintAll();
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => refresh(diagnostics, decorationTypes, doc)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      trackTypedRename(event); // a declared name typed over is a rename in progress
      maybeScaffold(event); // a first '|' on an empty line grows a skeleton
      trackEdits(event); // a burst's new findings elsewhere wait (hold.js)
      refreshSoon(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      holdState.delete(doc.uri.toString());
      textBefore.delete(doc.uri.toString());
      typedRenames.delete(doc.uri.toString());
      renameOffers.delete(doc.uri.toString());
      diagnostics.delete(doc.uri);
      analysisByDoc.delete(doc.uri.toString());
      parsedByDoc.delete(doc.uri.toString());
      registryByDoc.delete(doc.uri.toString());
      // its Python session goes with it
      pyStop(doc.uri.toString(), "closed");
      pyStatus.delete(doc.uri.toString());
      pyDims.delete(doc.uri.toString());
      pyDiagnostics.delete(doc.uri);
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) decorate(editor, decorationTypes);
    }),
    vscode.languages.registerDefinitionProvider({ language: "aot" }, definitionProvider),
    // hovering a Concept (or a crosslink to one) lists its dependency chains;
    // an Example (or a crosslink to one) shows its details and usages
    vscode.languages.registerHoverProvider({ language: "aot" }, hoverProvider),
    // Shift+F12 lists a Concept's or Example's declaration and usages
    vscode.languages.registerReferenceProvider({ language: "aot" }, referenceProvider),
    // F2 renames a Concept, Example or attribute everywhere: declaration,
    // crosslinks, and every formula reference that resolves to it
    vscode.languages.registerRenameProvider({ language: "aot" }, renameProvider),
    // dependency chains in small print at the end of crosslinked lines
    vscode.languages.registerInlayHintsProvider({ language: "aot" }, inlayProvider),
    // typing '@' in a formula suggests the columns and Examples to reference
    vscode.languages.registerCompletionItemProvider({ language: "aot" }, referenceCompletion, "@"),
    // the values an attribute's Concept vouches for, live and archived —
    // '|' also triggers it, so entering a fresh table cell pops the list
    vscode.languages.registerCompletionItemProvider({ language: "aot" }, valueCompletion, "|"),
    // URLs and file-path values are Ctrl+clickable — a URL opens externally
    // (hover fetches its metadata), a file opens in the editor. A file cited
    // by an outside path opens its aot.files copy when one of its name is
    // there: the copy is the one that travels with the repo.
    vscode.languages.registerDocumentLinkProvider({ language: "aot" }, {
      provideDocumentLinks(doc) {
        const links = urls.findUrls(doc.getText().split(/\r?\n/)).map((u) => new vscode.DocumentLink(
          new vscode.Range(u.line - 1, u.startCol, u.line - 1, u.endCol), vscode.Uri.parse(u.url)));
        for (const f of fileLinksIn(doc)) {
          links.push(new vscode.DocumentLink(
            new vscode.Range(f.line - 1, f.startCol, f.line - 1, f.endCol),
            vscode.Uri.file(repoCopyOf(doc, f.fsPath) || f.fsPath)));
        }
        // a function a derivation calls opens the Python file it is written
        // in, at its `def`
        for (const c of pythonCallLinks(doc)) {
          const link = new vscode.DocumentLink(c.range, vscode.Uri.file(c.file).with({ fragment: `L${c.def.line + 1}` }));
          link.tooltip = `${relToRoot(doc, c.file)} line ${c.def.line + 1} — def ${c.def.signature}`;
          links.push(link);
        }
        // every `file.aot:12` in a maintained `...` line opens that file at
        // that Concept, so a split extension is one click from the rest of
        // it — at the line the Concept stands on now, which a peer edited
        // since the note was written may have moved
        const analysis = analysisByDoc.get(doc.uri.toString());
        if (analysis) {
          for (const s of repo.noteSpans(doc.getText().split(/\r?\n/), analysis.root, analysis.nodes)) {
            const target = peerPathFor(doc, s.file);
            if (!target) continue;
            const line = conceptLineIn(target, s.concept) || s.target;
            const link = new vscode.DocumentLink(
              new vscode.Range(s.line - 1, s.startCol, s.line - 1, s.endCol),
              vscode.Uri.file(target).with({ fragment: `L${line}` }));
            link.tooltip = `${s.file} line ${line}`;
            links.push(link);
          }
        }
        return links;
      },
    }),
    // the Quick Fix that accepts a hinted word into aot.acceptedWords
    vscode.languages.registerCodeActionsProvider({ language: "aot" }, codeActionProvider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite],
    }),
    vscode.commands.registerCommand("aot.acceptWord", acceptWord),
    // the two lightbulbs on a synonym warning: fold one name into the other,
    // or record that the two names are two ideas and stop being asked
    vscode.commands.registerCommand("aot.renameConcept", renameConcept),
    vscode.commands.registerCommand("aot.acceptDistinct", acceptDistinct),
    vscode.commands.registerCommand("aot.hoistValue", hoistValue),
    vscode.commands.registerCommand("aot.setUpGitMerge", setUpGitMerge),
    // the Quick Fix that lists an unlisted value as an Example of its Concept
    vscode.commands.registerCommand("aot.addExample", addExample),
    // the repo-wide sweep, and the lightbulb that settles a value two files
    // disagree about (src/repo.js)
    vscode.commands.registerCommand("aot.reconcileAcrossFiles", reconcileAcrossFiles),
    // a root may be named (the tests do, and a script may): without one the
    // command catches up every repository the watchers cover
    // AOT: Sync CSVs Now — both directions, by hand; in manual mode the only sync
    vscode.commands.registerCommand("aot.importCsvFiles", (root) => (root ? importCsvFolder(root, { manual: true }) : importAllCsvFolders({ manual: true }))),
    vscode.commands.registerCommand("aot.upgradeSyntax", () => upgradeWorkspaceSyntax()),
    vscode.commands.registerCommand("aot.setValueEverywhere", setValueEverywhere),
    // the Quick Fix that brings a cited file into the repo's own file store
    vscode.commands.registerCommand("aot.copyFileIntoRepo", copyFileIntoRepo),
    // a settings change (accepted words, spelling toggle, ...) re-lints
    // every open document so the findings track it immediately
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("aot")) return;
      // a session holds the interpreter and the guards it started with; the
      // next run starts one under the settings as they are now
      if (event.affectsConfiguration("aot.python") || event.affectsConfiguration("aot.uv")) {
        for (const k of [...pySessions.keys()]) pyStop(k, "the Python settings changed");
      }
      vscode.workspace.textDocuments.forEach((doc) => refresh(diagnostics, decorationTypes, doc));
    }),
    // Format Document re-aligns every table's columns, as org-mode's TAB
    // does — each column padded to its widest cell, leftover rules dropped —
    // and renumbers `N. ` Examples. It computes nothing: that is Ctrl+Enter's.
    vscode.languages.registerDocumentFormattingEditProvider({ language: "aot" }, {
      provideDocumentFormattingEdits(doc) {
        const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
        const reg = formulaRegistry(doc);
        const renumber = renumberEdits(doc);
        const renumbered = new Set(renumber.map((e) => e.line));
        const overlaps = (e) => {
          for (let l = e.line; l <= (e.to || e.line); l++) if (renumbered.has(l)) return true;
          return false;
        };
        return [
          ...table.align(doc.getText(), reg, rootName).filter((e) => !overlaps(e)),
          ...renumber,
        ].map((e) => vscode.TextEdit.replace(lineEditRange(doc, e), lineEditText(doc, e)));
      },
    }),
    // table cells coloured by their parsed kind, as their line forms are
    vscode.languages.registerDocumentSemanticTokensProvider({ language: "aot" }, semanticProvider, semanticLegend),
    // the tree as symbols: breadcrumbs, the Outline view, and sticky scroll —
    // which is what pins a table's header line while you scroll its rows
    vscode.languages.registerDocumentSymbolProvider({ language: "aot" }, symbolProvider),
    // the org table editor's commands and its aot.inTable keybinding gate
    ...Object.entries(tableOps).map(([id, op]) =>
      vscode.commands.registerTextEditorCommand(id, (editor) => {
        // Tab travels the cells from wherever in a row it is pressed, the
        // leading spaces included, and in a table it never indents — not
        // even with lines selected. A table nests through its `parent
        // (thing)` column (Nest Row Under the Row Above writes it), so there
        // is no indent there for a key to mean; a whole table is re-filed
        // under another parent with VS Code's own Ctrl+] / Ctrl+[.
        //
        // In line form, lines SELECTED are still the indent edit, as
        // everywhere else in the editor: there the indent IS the nesting.
        const dir = id === "aot.table.nextCell" ? 1 : id === "aot.table.prevCell" ? -1 : 0;
        const line = editor.selection.active.line;
        const onRow = line < editor.document.lineCount && table.isRowText(editor.document.lineAt(line).text);
        if (dir && !onRow && !editor.selection.isSingleLine) {
          return vscode.commands.executeCommand(
            dir > 0 ? "editor.action.indentLines" : "editor.action.outdentLines");
        }
        // a table row takes the table's operation; anywhere else the same key
        // works on the Concept's Examples written as lines
        if (onRow) return runTableOp(editor, op);
        return runLineOp(editor, id);
      })),
    // the spreadsheet's movement keys, which move the cursor and edit nothing;
    // in no grid at all, a key does what VS Code does with it
    ...Object.entries(tableMoves).map(([id, move]) => vscode.commands.registerTextEditorCommand(id, (editor) => {
      if (move(editor) === false) return ownKey(id);
    })),
    vscode.commands.registerTextEditorCommand("aot.insertDate", (editor) => insertNow(editor, "date")),
    vscode.commands.registerTextEditorCommand("aot.insertTime", (editor) => insertNow(editor, "time")),
    vscode.commands.registerTextEditorCommand("aot.table.fromSelection", fromSelection),
    // the formula commands: whole-document recompute, and the copy-downs
    vscode.commands.registerTextEditorCommand("aot.recomputeFormulas", recomputeFormulas),
    vscode.commands.registerTextEditorCommand("aot.copyFormulaToSiblings", copyFormulaToSiblings),
    // Ctrl+Shift+`: the derivations out of the data, and back
    vscode.commands.registerTextEditorCommand("aot.toggleFormulaPark", toggleFormulaPark),
    // Ctrl+Enter: the Python derivation at the cursor, in place — with what
    // it reads and what reads it
    vscode.commands.registerTextEditorCommand("aot.runPython", runPythonHere),
    vscode.commands.registerTextEditorCommand("aot.runPythonFresh", (editor) => runPython(editor, { mode: "fresh" })),
    vscode.commands.registerCommand("aot.showPythonEnvironment", showPythonEnvironment),
    vscode.commands.registerCommand("aot.setUpPython", setUpPython),
    vscode.commands.registerCommand("aot.createPythonFunction", createPythonFunction),
    vscode.commands.registerCommand("aot.movePythonToSidecar", movePythonToSidecar),
    // inside Python: the sidecar's functions after '=', a table's columns after '@Name.'
    vscode.languages.registerCompletionItemProvider({ language: "aot" }, pythonCompletion, "=", "."),
    // Ctrl+Alt+T: the Concept at the cursor as a table, and back as lines
    vscode.commands.registerTextEditorCommand("aot.toggleTableForm", toggleTableForm),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      updateTableContext();
      updateCellStatus();
      const doc = event && event.textEditor && event.textEditor.document;
      if (!doc || doc.languageId !== "aot") return;
      // leaving what is being edited ends the burst: what waited shows
      const state = holdState.get(doc.uri.toString());
      if (state && state.family) {
        const line = event.textEditor.selection.active.line + 1;
        if (line < state.family.from || line > state.family.to) releaseHold(doc);
      }
      // leaving a name being typed over: the rename is done
      const typing = typedRenames.get(doc.uri.toString());
      if (typing) {
        const at = event.textEditor.selection.active;
        if (at.line !== typing.line || at.character < typing.start || at.character > typing.start + typing.length) closeTypedRename(doc);
      }
      // standing in a used name shows the F2 nudge; leaving it clears it
      renameHint(event.textEditor);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateTableContext();
      // another editor taking over ends every other document's burst, and
      // any name being typed over there
      for (const d of vscode.workspace.textDocuments || []) {
        if (editor && editor.document === d) continue;
        if (holdState.has(d.uri.toString())) releaseHold(d);
        if (typedRenames.has(d.uri.toString())) closeTypedRename(d);
      }
      updateHoldStatus();
    }),
    // the status item's click: what waits, shown now
    vscode.commands.registerCommand("aot.showHeldFindings", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) releaseHold(editor.document);
    }),
    // a name typed over: its uses updated, from the notice or the lightbulb
    vscode.commands.registerCommand("aot.applyTypedRename", (key, line) => applyTypedRename(key, line)),
    // saving persists true numbering and agreement with the rest of the
    // repo: the renumber and reconcile edits ride the save itself, so the
    // file on disk carries sequential `N. ` Examples and whatever a shared
    // Concept says elsewhere. A save computes nothing — it runs no Python.
    vscode.workspace.onWillSaveTextDocument((event) => {
      const doc = event.document;
      // a Python file about to be saved: what it held, so its new content can
      // be allowed if that was
      if (/\.py$/i.test(doc.fileName || "")) pyWillSave(doc);
      if (doc.languageId !== "aot") return;
      // a name being typed over is done once the file is saved; the save's
      // own edits (a renumber, a reconcile) are no typing
      closeTypedRename(doc);
      savingDocs.add(doc.uri.toString());
      // the Python written here since the last save is the writer's own —
      // taken now, before this save's own edits (a reconcile) land
      aotWillSave(doc);
      event.waitUntil(Promise.resolve().then(() => {
        const renumber = renumberEdits(doc);
        // reconcile last and only where the renumber is not already
        // rewriting: two passes over one document must not land two edits
        // on one line
        const claimed = new Set(renumber.map((e) => e.line));
        const free = (op) => {
          if (op.type === "insert") return !claimed.has(op.afterLine) && !claimed.has(op.afterLine + 1);
          if (op.type === "block") {
            for (let l = op.from + 1; l <= op.to + 1; l++) if (claimed.has(l)) return false;
            return true;
          }
          return !claimed.has(op.line);
        };
        return [
          ...renumber.map((e) => vscode.TextEdit.replace(lineEditRange(doc, e), lineEditText(doc, e))),
          ...opsToTextEdits(doc, reconcileOpsFor(doc).filter(free)),
        ];
      }));
    }),
    // the CSV mirror: .aot saves write the CSVs, CSV edits fold back in;
    // a save also releases any live hold — saving says "I am done here"
    vscode.workspace.onDidSaveTextDocument((doc) => {
      // a Python file saved here is the writer's own edit; and every Python
      // value that names it may be stale now
      if (/\.py$/i.test(doc.fileName || "")) {
        pyDidSave(doc).then(() => relintAll(), () => relintAll());
        return;
      }
      releaseHold(doc);
      savingDocs.delete(doc.uri.toString());
      if (doc.languageId === "aot" && doc.fileName) {
        reindexAot(doc.fileName, doc.getText());
        refreshPeers(doc.fileName);
      }
      syncAotToCsv(doc);
      // the stable Gödel numbers, grown by what this save added
      saveGodelRegistry(doc);
    }),
  );
  const csvWatcher = vscode.workspace.createFileSystemWatcher("**/aot.files/*.csv");
  csvWatcher.onDidChange(onCsvFsEvent);
  csvWatcher.onDidCreate(onCsvFsEvent);
  context.subscriptions.push(csvWatcher);

  // the store's existence is the state, so a store edited, written or deleted
  // outside the editor changes which values are marked as computed. Parking
  // from the key already redraws (the document changes with it); this is for
  // the pull, the hand edit, and the delete.
  const parkWatcher = vscode.workspace.createFileSystemWatcher("**/aot.files/*.formulas");
  const onParkFsEvent = (uri) => {
    parkCache.delete(uri.fsPath);
    // the store's constraints bound the values, so the findings follow it too
    relintAll();
    for (const editor of vscode.window.visibleTextEditors) decorate(editor, decorationTypes);
  };
  parkWatcher.onDidChange(onParkFsEvent);
  parkWatcher.onDidCreate(onParkFsEvent);
  parkWatcher.onDidDelete(onParkFsEvent);
  context.subscriptions.push(parkWatcher);

  // the repository's Python files: one changed on disk (a pull, another
  // tool) makes stale every derivation that names it, and a new or deleted
  // one changes what a module name reaches
  const pyWatcher = vscode.workspace.createFileSystemWatcher("**/*.py");
  const onPyFsEvent = (listChanged) => (uri) => {
    // an environment being installed writes thousands of these, none of
    // them the repository's own code
    if (!isRepoPython(uri.fsPath)) return;
    fileHashCache.delete(uri.fsPath);
    if (listChanged) forgetPyIndex();
    relintAll();
  };
  pyWatcher.onDidChange(onPyFsEvent(false));
  pyWatcher.onDidCreate(onPyFsEvent(true));
  pyWatcher.onDidDelete(onPyFsEvent(true));
  context.subscriptions.push(pyWatcher);

  // Those two globs reach inside the workspace folders and nowhere else, so
  // a repository opened by one of its subfolders — its 'aot.files' at the
  // root, above the folder on screen — would be watched by neither. Such a
  // root gets watchers of its own, once, and the folder that is already
  // covered gets none, so no event is ever handled twice.
  const watchedRoots = new Set();
  watchAotRoot = (root) => {
    if (!root || watchedRoots.has(fileKey(root))) return;
    watchedRoots.add(fileKey(root));
    if (typeof vscode.RelativePattern !== "function") return;
    const dir = path.join(root, "aot.files");
    if ((vscode.workspace.workspaceFolders || []).some((f) => isInside(f.uri.fsPath, dir))) return;
    const watch = (glob) => vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(dir), glob));
    const csv = watch("*.csv"), park = watch("*.formulas");
    csv.onDidChange(onCsvFsEvent);
    csv.onDidCreate(onCsvFsEvent);
    park.onDidChange(onParkFsEvent);
    park.onDidCreate(onParkFsEvent);
    park.onDidDelete(onParkFsEvent);
    context.subscriptions.push(csv, park);
  };
  for (const folder of vscode.workspace.workspaceFolders || []) watchAotRoot(repoRootOf(folder.uri.fsPath));

  // the workspace index: every .aot parsed, so crosslinks resolve across
  // files and repo-wide duplicates surface. Built once, kept fresh by a
  // watcher for files edited outside the editor.
  buildWorkspaceIndex();

  // a CSV edited while the editor was closed has had no watcher to hear it,
  // and the next save of its .aot would overwrite it unread. Catch the
  // folder up once, in the background: an unchanged folder does nothing.
  importAllCsvFolders({ silent: true });

  // files written for 1.12 spell a literal '=' and a definition the old way:
  // asked about once per workspace, never in the way of anything else
  offerSyntaxUpgrade().catch(() => { /* the command is still there */ });

  // a merge driver set up by an older copy of this extension, pointed here
  try { repairGitMerge(); } catch { /* left as it was */ }

  const aotWatcher = vscode.workspace.createFileSystemWatcher("**/*.aot");
  const onAotFsEvent = (uri) => {
    try { reindexAot(uri.fsPath, fs.readFileSync(uri.fsPath, "utf8")); } catch { /* gone */ }
    refreshPeers(uri.fsPath);
  };
  aotWatcher.onDidChange(onAotFsEvent);
  aotWatcher.onDidCreate(onAotFsEvent);
  aotWatcher.onDidDelete((uri) => {
    workspaceIndex.delete(fileKey(uri.fsPath));
    workspaceExternal = null;
    indexGeneration++;
    refreshPeers(uri.fsPath);
  });
  context.subscriptions.push(aotWatcher);

  // the cell address, for when the header row and the name column have both
  // scrolled out of sight
  if (vscode.window.createStatusBarItem) {
    // what waits while you write, and the click that shows it now
    holdStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    holdStatus.command = "aot.showHeldFindings";
    context.subscriptions.push(holdStatus);
    cellStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(cellStatus);
  }

  updateTableContext();
  updateCellStatus();
}

// Parse every .aot under the workspace root(s) into the index. Skipped when
// there is no workspace (a lone file, or the smoke test) — cross-file then
// simply does nothing.
function buildWorkspaceIndex() {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    const root = folder.uri.fsPath;
    for (const fsPath of scanAotFiles(root)) {
      try { reindexAot(fsPath, fs.readFileSync(fsPath, "utf8")); } catch { /* skip */ }
    }
  }
}

// Every Python session ends with the extension.
function deactivate() {
  for (const key of [...pySessions.keys()]) pyStop(key, "the extension stopped");
}

// The tests run the editor's Python half against a fake runtime: a spawn
// function of their own, and the live sessions to look at.
const _test = {
  setSpawn: (fn) => {
    pySpawn = fn || childProcess.spawn;
    pyResolve = fn ? (cmd) => cmd : (cmd, base) => python.resolveExecutable(cmd, { base });
  },
  sessions: pySessions,
  runPython,
  ranAt,
  // what an inlay says of a run, for every state, without staging each run
  pyRunNote,
  combinedRunNote,
  leftAloneMessage,
  // git, for the merge-driver setup: the tests record the calls instead
  setGit: (fn) => { gitRun = fn || defaultGitRun; },
  // what a CSV and its .aot last agreed on, newest first
  csvBaselines: (csvPath) => baselinesOf(csvPath).map((b) => b.text),
  // the status item that counts what waits while you write
  holdStatus: () => holdStatus,
  repairGitMerge,
};

module.exports = { activate, deactivate, _test };
