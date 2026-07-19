// Smoke test: activate the extension against a mocked vscode API and
// in-memory .aot documents, then print the diagnostics it publishes and
// check the crosslink decorations and go-to-definition.
const fs = require("fs");
const path = require("path");
const Module = require("module");

const published = new Map();
const registeredCommands = new Map();
let definitionProvider = null;
let formattingProvider = null;
let semanticProvider = null;
let hoverProvider = null;
let codeActionsProvider = null;
let referenceProvider = null;
let renameProvider = null;
let inlayProvider = null;
let documentLinkProvider = null;
let completionProvider = null;      // the '@' reference completion
let valueCompletionProvider = null; // the value completion (no trigger char)
const plainCommands = new Map();
const configStore = {};
const vscode = {
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
  MarkdownString: class { constructor() { this.value = ""; } appendMarkdown(s) { this.value += s; return this; } },
  Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
  CodeAction: class { constructor(title, kind) { Object.assign(this, { title, kind }); } },
  CodeActionKind: { QuickFix: "quickfix" },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  Range: class {
    constructor(...a) { this.a = a; }
    get start() { return { line: this.a[0], character: this.a[1] }; }
    get end() { return { line: this.a[2], character: this.a[3] }; }
    get isEmpty() { return this.a[0] === this.a[2] && this.a[1] === this.a[3]; }
    contains(p) {
      const [startLine, startCol, endLine, endCol] = this.a;
      return p.line >= startLine && p.line <= endLine && p.character >= startCol && p.character <= endCol;
    }
  },
  Position: class { constructor(line, character) { Object.assign(this, { line, character }); } },
  Location: class { constructor(uri, range) { Object.assign(this, { uri, range }); } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  languages: {
    createDiagnosticCollection: () => ({
      set: (uri, diags) => published.set(uri.toString(), diags),
      get: (uri) => published.get(uri.toString()),
      delete: (uri) => published.delete(uri.toString()),
      dispose: () => {},
    }),
    registerDefinitionProvider: (selector, provider) => { definitionProvider = provider; return { dispose() {} }; },
    registerHoverProvider: (selector, provider) => { hoverProvider = provider; return { dispose() {} }; },
    registerCodeActionsProvider: (selector, provider) => { codeActionsProvider = provider; return { dispose() {} }; },
    registerDocumentFormattingEditProvider: (selector, provider) => { formattingProvider = provider; return { dispose() {} }; },
    registerDocumentSemanticTokensProvider: (selector, provider) => { semanticProvider = provider; return { dispose() {} }; },
    registerReferenceProvider: (selector, provider) => { referenceProvider = provider; return { dispose() {} }; },
    registerRenameProvider: (selector, provider) => { renameProvider = provider; return { dispose() {} }; },
    registerInlayHintsProvider: (selector, provider) => { inlayProvider = provider; return { dispose() {} }; },
    registerDocumentLinkProvider: (selector, provider) => { documentLinkProvider = provider; return { dispose() {} }; },
    registerCompletionItemProvider: (selector, provider, ...triggers) => {
      // two are registered: the '@' reference completion and, with no trigger
      // character, the value completion
      if (triggers.includes("@")) completionProvider = provider;
      else valueCompletionProvider = provider;
      return { dispose() {} };
    },
  },
  CompletionItem: class { constructor(label, kind) { Object.assign(this, { label, kind }); } },
  CompletionItemKind: { Field: 4, EnumMember: 19 },
  DocumentLink: class { constructor(range, target) { Object.assign(this, { range, target }); } },
  Uri: { parse: (s) => ({ toString: () => s }), file: (p) => ({ fsPath: p, scheme: "file", toString: () => "file:///" + p.replace(/\\/g, "/") }) },
  EventEmitter: class {
    constructor() { this.listeners = []; }
    get event() { return (fn) => { this.listeners.push(fn); return { dispose() {} }; }; }
    fire(x) { for (const fn of this.listeners) fn(x); }
  },
  InlayHint: class { constructor(position, label) { Object.assign(this, { position, label }); } },
  SemanticTokensLegend: class { constructor(types, modifiers) { Object.assign(this, { types, modifiers }); } },
  SemanticTokensBuilder: class {
    constructor(legend) { this.legend = legend; this.tokens = []; }
    push(line, char, length, type) { this.tokens.push([line, char, length, type]); }
    build() { return { tokens: this.tokens }; }
  },
  TextEdit: { replace: (range, text) => ({ range, text }) },
  Selection: class { constructor(...a) { this.a = a; this.active = { line: a[0], character: a[1] }; } },
  EndOfLine: { LF: 1, CRLF: 2 },
  commands: {
    registerTextEditorCommand: (id, fn) => { registeredCommands.set(id, fn); return { dispose() {} }; },
    registerCommand: (id, fn) => { plainCommands.set(id, fn); return { dispose() {} }; },
    executeCommand: () => {},
  },
  window: {
    visibleTextEditors: [],
    activeTextEditor: undefined,
    _warnings: [],
    _info: [],
    _errors: [],
    createTextEditorDecorationType: (style) => ({ style, dispose() {} }),
    onDidChangeVisibleTextEditors: () => ({ dispose() {} }),
    onDidChangeTextEditorSelection: (fn) => { vscode.window._selectionChanged = fn; return { dispose() {} }; },
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    showWarningMessage: (m) => { vscode.window._warnings.push(m); return Promise.resolve(); },
    showInformationMessage: (m) => { vscode.window._info.push(m); return Promise.resolve(); },
    showErrorMessage: (m) => { vscode.window._errors.push(m); return Promise.resolve(); },
  },
  WorkspaceEdit: class {
    constructor() { this.ops = []; }
    replace(uri, range, text) { this.ops.push({ type: "replace", uri, range, text }); }
    insert(uri, pos, text) { this.ops.push({ type: "insert", uri, pos, text }); }
  },
  workspace: {
    textDocuments: [],
    workspaceFolders: undefined, // set per-test when a workspace root is needed
    getWorkspaceFolder: () => (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) || null,
    onDidOpenTextDocument: (fn) => { vscode.workspace._open = fn; return { dispose() {} }; },
    onDidChangeTextDocument: (fn) => { vscode.workspace._changed = fn; return { dispose() {} }; },
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidSaveTextDocument: (fn) => { vscode.workspace._save = fn; return { dispose() {} }; },
    onWillSaveTextDocument: (fn) => { vscode.workspace._willSave = fn; return { dispose() {} }; },
    onDidChangeConfiguration: (fn) => { vscode.workspace._configChanged = fn; return { dispose() {} }; },
    createFileSystemWatcher: (glob) => {
      const csv = /aot\.files/.test(glob || "");
      return {
        onDidChange: (fn) => { if (csv) vscode.workspace._csvChanged = fn; else vscode.workspace._aotChanged = fn; },
        onDidCreate: (fn) => { if (csv) vscode.workspace._csvCreated = fn; else vscode.workspace._aotCreated = fn; },
        onDidDelete: (fn) => { if (!csv) vscode.workspace._aotDeleted = fn; },
        dispose() {},
      };
    },
    // a store-backed configuration, so a Quick Fix's update round-trips:
    // writing fires onDidChangeConfiguration exactly as the real one does
    getConfiguration: () => ({
      get: (key, fallback) => (key in configStore ? configStore[key] : fallback),
      update: async (key, value) => {
        configStore[key] = value;
        if (vscode.workspace._configChanged) {
          vscode.workspace._configChanged({ affectsConfiguration: (section) => section === "aot" });
        }
      },
    }),
    // a real file-backed document, so the CSV sync can be tested end to end
    openTextDocument: async (p) => {
      const doc = {
        lines: fs.readFileSync(p, "utf8").split(/\r?\n/),
        languageId: "aot", fileName: p, eol: vscode.EndOfLine.LF,
        get lineCount() { return this.lines.length; },
        getText() { return this.lines.join("\n"); },
        lineAt(i) { return { range: new vscode.Range(i, 0, i, this.lines[i].length), text: this.lines[i] }; },
        save: async () => fs.writeFileSync(p, doc.lines.join("\n")),
      };
      doc.uri = { fsPath: p, toString: () => "file:///" + p, __doc: doc };
      return doc;
    },
    applyEdit: async (edit) => {
      for (const op of edit.ops) {
        const doc = op.uri.__doc;
        if (!doc) continue; // a makeDoc fixture is a read-only snapshot
        if (op.type === "replace") {
          const [sl, , el] = op.range.a;
          doc.lines.splice(sl, el - sl + 1, ...op.text.split("\n"));
        } else {
          const parts = op.text.split("\n");
          if (parts[parts.length - 1] === "") parts.pop();
          doc.lines.splice(op.pos.line, 0, ...parts);
        }
      }
      return true;
    },
  },
};
const load = Module._load;
Module._load = (request, ...rest) => (request === "vscode" ? vscode : load(request, ...rest));

const ext = require("../src/extension.js");
ext.activate({ subscriptions: [] });

function makeDoc(fileName, text) {
  const lines = text.split(/\r?\n/);
  return {
    languageId: "aot",
    fileName,
    uri: { toString: () => "file:///" + fileName.replace(/\\/g, "/").replace(/ /g, "%20") },
    lineCount: lines.length,
    getText: () => text,
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
}

// 1) diagnostics over the reference file, as before
const doc = makeDoc("c:\\repo\\alphabet of thought.aot", fs.readFileSync(path.join(__dirname, "..", "examples", "alphabet of thought.aot"), "utf-8"));
vscode.workspace._open(doc);

const diags = published.get(doc.uri.toString());
const severityName = ["error", "warning", "info", "suggestion"];
const errorsD = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
const warningsD = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning);
const hintsD = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Hint);
console.log(`published ${errorsD.length} errors, ${warningsD.length} warnings, ${hintsD.length} hints`);
for (const d of diags.slice(0, 3)) {
  console.log(`  [${severityName[d.severity]}] line ${d.range.a[0] + 1}: ${d.message}`);
}
// The reference file verifies (V = 0), so no errors; whatever hints appear
// must be advisory — a spelling nudge or an unlisted value. Both are gaps in
// the prose or the model, never a verdict on it, so neither counts in V.
const advisoryOnly = hintsD.every((d) =>
  / is not in the dictionary/.test(d.message) || / is not an Example of Concept /.test(d.message));
console.log(errorsD.length === 0 && advisoryOnly
  ? "PASS (reference file verifies; hints are advisory only)"
  : "UNEXPECTED COUNT");

// Severity mapping on a fixture that carries one of each deep finding: the
// content-identical Gödel clash publishes as an error, the inferred
// functional dependency as a warning — the drifting reference file can't be
// trusted to keep exhibiting either.
{
  const stock = [
    "Stock",
    "    - Bin 1",
    "        sku: P",
    "        name: Widget",
    "    - Bin 2",
    "        sku: P",
    "        name: Widget",
    "    - Bin 3",
    "        sku: Q",
    "        name: Gadget",
    "    - Bin 4",
    "        sku: Q",
    "        name: Gadget",
  ].join("\n");
  // dependency squiggles are opt-in since 1.2.0 (correlated attributes are
  // allowed), so the on-case flips the setting first
  configStore.dependencyFindings = true;
  const docM = makeDoc("c:\\repo\\Dep.aot", stock);
  vscode.workspace.textDocuments.push(docM); // so the config-change re-lint reaches it
  vscode.workspace._open(docM);
  const mDiags = published.get(docM.uri.toString()) || [];
  const clashErr = mDiags.find((d) => /^clash:/.test(d.message));
  const depWarn = mDiags.find((d) => /^dependency:/.test(d.message));
  console.log(clashErr && clashErr.severity === vscode.DiagnosticSeverity.Error
    && depWarn && depWarn.severity === vscode.DiagnosticSeverity.Warning
    ? "PASS (clash publishes as error; dependency as warning when aot.dependencyFindings is on)"
    : "UNEXPECTED severity mapping " + JSON.stringify(mDiags.map((d) => [d.severity, d.message.slice(0, 30)])));

  // off by default: with the setting cleared the dependency warning goes,
  // while the clash error (a verified content problem) remains
  delete configStore.dependencyFindings;
  vscode.workspace._configChanged({ affectsConfiguration: (section) => section === "aot" });
  const offDiags = published.get(docM.uri.toString()) || [];
  console.log(offDiags.some((d) => /^clash:/.test(d.message))
    && !offDiags.some((d) => /^dependency:/.test(d.message))
    ? "PASS (dependency findings are off by default; the clash error remains)"
    : "UNEXPECTED default-off mapping " + JSON.stringify(offDiags.map((d) => [d.severity, d.message.slice(0, 30)])));
}

// 2) crosslinks: an attribute-is-a-Concept and a default-is-a-Example
const sample = [
  "Person",
  "    full name",
  "    - Socrates",
  "Census",
  "    person: Socrates",
].join("\n");
const doc2 = makeDoc("c:\\repo\\Sample.aot", sample);
const decorated = new Map(); // decoration type -> ranges
const editor = { document: doc2, setDecorations: (type, ranges) => decorated.set(type, ranges) };
vscode.window.visibleTextEditors = [editor];
vscode.workspace._open(doc2);

const sets = [...decorated.values()];
const conceptLinks = sets.find((s) => s.some((d) => /Concept 'Person'/.test(d.hoverMessage))) || [];
const individualLinks = sets.find((s) => s.some((d) => /Example 'Socrates'/.test(d.hoverMessage))) || [];
console.log(`decorated ${conceptLinks.length} Concept link(s), ${individualLinks.length} Example link(s)`);
for (const d of [...conceptLinks, ...individualLinks]) {
  console.log(`  line ${d.range.a[0] + 1} cols ${d.range.a[1]}-${d.range.a[3]}: ${d.hoverMessage}`);
}

// Ctrl+click on 'person' (line 5, col 5) should land on 'Person' (line 1)
const definition = definitionProvider.provideDefinition(doc2, new vscode.Position(4, 5));
const landed = definition && definition.range.a[0] === 0;
console.log(landed ? "definition of 'person' -> line 1 'Person'" : "DEFINITION FAILED");

const crosslinksPass = conceptLinks.length === 1 && individualLinks.length === 1 && landed;
console.log(crosslinksPass ? "PASS (crosslinks)" : "UNEXPECTED CROSSLINKS");

// 3) example-is-a-Example: an Example listed under an attribute that names a
// Concept links to that Concept's Example, the same as the value form would.
const { lint } = require("../src/linter");
const { resolve } = require("../src/crosslinks");
const listed = [
  "Hue",
  "    - Red",
  "        - Crimson",
  "        - Scarlet",
  "    - Blue",
  "Pen",
  "    - Rose",
  "        shade hue",
  "            - Crimson",
].join("\n");
{
  const { root, nodes } = lint(listed, "World");
  const links = resolve(listed, root, nodes);
  const link = links.find((l) => l.connection === "example-is-a-Example");
  const ok = link && link.line === 9 && link.target.line === 3 && link.text === "Crimson";
  console.log(ok
    ? "PASS (example-is-a-Example: listed '- Crimson' links to its Concept type's '- Crimson')"
    : "UNEXPECTED example-is-a-Example");
  // a listed Example whose name is not of the attribute's Concept type must not link
  const stray = [
    "Hue",
    "    - Red",
    "Dance",
    "    - Tango",
    "Pen",
    "    - Rose",
    "        shade hue",
    "            - Tango",
  ].join("\n");
  const s = lint(stray, "World");
  const strayLinks = resolve(stray, s.root, s.nodes);
  const noStray = !strayLinks.some((l) => l.connection === "example-is-a-Example");
  console.log(noStray
    ? "PASS (example-is-a-Example: a wrong-typed listed Example does not link)"
    : "UNEXPECTED stray example-is-a-Example");

  // default-is-a-Example: a value only links when it names an Example the
  // attribute genuinely ranges over — either held directly beneath it, or
  // under the Concept it is typed to. A value merely sharing a name with an
  // unrelated Example ('interval count: 1' matching a '- 1' filed elsewhere)
  // must not link, but the same value naming the attribute's own '- 1' must.
  const values = [
    "Length",
    "    maximum number of elements",
    "        - 1",
    "Time",
    "    Duration",
    "        interval count: 1",
    "    span length",
    "        maximum number of elements: 1",
  ].join("\n");
  const v = lint(values, "World");
  const valueLinks = resolve(values, v.root, v.nodes).filter((l) => l.connection === "default-is-a-Example");
  const strayValue = valueLinks.some((l) => l.line === 6); // Duration's interval count: 1
  const ownValue = valueLinks.some((l) => l.line === 8);   // maximum number of elements: 1
  console.log(!strayValue && ownValue
    ? "PASS (default-is-a-Example: unrelated same-named Example does not link; the attribute's own does)"
    : "UNEXPECTED default-is-a-Example value linking");

  // Among several same-named Examples, a concept-typed value picks the one
  // under its Concept, not the document's first: 'interval count: 1' links to
  // the '- 1' under the 'Interval Count' Concept, past the earlier stray '- 1'.
  const typed = [
    "Length",
    "    maximum number of elements",
    "        - 1",
    "Interval Count",
    "    - 1",
    "Duration",
    "    interval count: 1",
  ].join("\n");
  const t = lint(typed, "World");
  const typedLink = resolve(typed, t.root, t.nodes)
    .find((l) => l.connection === "default-is-a-Example" && l.line === 7);
  console.log(typedLink && typedLink.target.line === 5
    ? "PASS (default-is-a-Example: concept-typed value picks the in-scope Example among duplicates)"
    : "UNEXPECTED concept-typed duplicate resolution");
}

// 3c) Example links resolve case-insensitively: `person: socrates` still
// finds `- Socrates`, exactly as attribute-is-a-Concept always has.
{
  const text = [
    "Person",
    "    - Socrates",
    "Note",
    "    person: socrates",
  ].join("\n");
  const t = lint(text, "World");
  const link = resolve(text, t.root, t.nodes).find((l) => l.connection === "default-is-a-Example");
  console.log(link && link.text === "socrates" && link.target.name === "Socrates" && link.target.line === 2
    ? "PASS (default-is-a-Example: value matching is case-insensitive)"
    : "UNEXPECTED case-insensitive link " + JSON.stringify(link));
}

// 3d) unlisted values: a value naming no Example of the Concept typing its
// attribute is hinted, but only when it was genuinely trying to name one.
{
  const { unlistedValues } = require("../src/crosslinks");
  const text = [
    "Person",
    "    |name    |alias|",
    "    |--------+-----|",
    "    |Socrates|Paul |",
    "Integer",
    "    - 1",
    "    - 35",
    "Worker Pool",
    "    - Role",
    "    - Asset",
    "Open Name",                      // a Concept listing no Examples
    "Note",
    "    person: James",             // text among text Examples: a real miss
    "    age integer: 5",            // a number among the numbers 1 and 35
    "    person here: Socrates",     // links: no finding
    "    maximum worker pool: 1",    // a measurement of the pool, not one of them
    "    present open name: whatever", // an open vocabulary vouches for nothing
    "    listed integer: =@Integer@1", // derived: the formula's business
  ].join("\n");
  const t = lint(text, "World");
  const found = unlistedValues(text, t.root, t.nodes);
  const at = (v) => found.find((f) => f.value === v);
  const james = at("James");
  const jamesOk = james && james.line === 13 && james.concept.name === "Person"
    && james.startCol === text.split("\n")[12].indexOf("James")
    && /is not an Example of Concept 'Person' — its Examples are Socrates/.test(james.message);
  const fiveOk = at("5") && at("5").concept.name === "Integer"
    && /its Examples are 1, 35/.test(at("5").message);
  console.log(jamesOk && fiveOk && found.length === 2
    ? "PASS (unlisted values: the misses hint; truth values, measurements, open vocabularies and derived values stay quiet)"
    : "UNEXPECTED unlisted values " + JSON.stringify(found.map((f) => `${f.line}:${f.value}`)));

  // a truth value asserts a fact about an Example, it never nominates one
  const truth = ["Present In", "    - Is Present In", "Note", "    present in: False"].join("\n");
  const tv = lint(truth, "World");
  console.log(unlistedValues(truth, tv.root, tv.nodes).length === 0
    ? "PASS (unlisted values: a truth value is not a nomination)"
    : "UNEXPECTED truth-value hint");
}

// 4) tables: a value cell crosslinks to the Example it names, the header
// cell to the Concept its attribute is typed by, and Format Document
// aligns the columns as org-mode's TAB does.
{
  const table = [
    "Measurement Operation",
    "    - Ratio",
    "Metric",
    "    | name | measurement operation |",
    "    |------+-----------------------|",
    "    | Speed | Ratio |",
  ].join("\n");
  const t = lint(table, "World");
  const links = resolve(table, t.root, t.nodes);
  const headerLink = links.find((l) => l.connection === "attribute-is-a-Concept" && l.line === 4);
  const cellLink = links.find((l) => l.connection === "default-is-a-Example" && l.line === 6);
  const headerOk = headerLink && headerLink.startCol === 13 && headerLink.target.line === 1;
  const cellOk = cellLink && cellLink.startCol === 14 && cellLink.text === "Ratio" && cellLink.target.line === 2;
  console.log(headerOk && cellOk
    ? "PASS (table: header cell links to its Concept, value cell to its Example)"
    : "UNEXPECTED table crosslinks");

  const doc3 = makeDoc("c:\repo\World.aot", table);
  const edits = formattingProvider.provideDocumentFormattingEdits(doc3);
  const aligned = edits.some((e) => e.text === "    |Speed|Ratio                |");
  console.log(aligned && edits.length === 3
    ? "PASS (table: Format Document aligns the columns)"
    : "UNEXPECTED table formatting " + JSON.stringify(edits));
}

// 4b) the aot.addExample command: the lightbulb on an unlisted value lists
// it under its Concept, in the form that Concept is already written in, and
// leaves the cursor on the new Example.
(async () => {
  const lines = [
    "Integer",
    "    - 1",
    "    - 35",
    "Note",
    "    age integer: 5",
  ];
  const doc = {
    languageId: "aot", fileName: "c:\\repo\\World.aot", eol: vscode.EndOfLine.LF,
    uri: { toString: () => "file:///addexample" },
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  const editor = {
    document: doc,
    selection: new vscode.Selection(4, 0, 4, 0),
    edit: (cb) => {
      cb({
        replace: (range, t) => { const [sl, , el] = range.a; lines.splice(sl, el - sl + 1, ...t.split("\n")); },
        insert: (pos, t) => { lines.splice(pos.line, 0, ...t.replace(/\n$/, "").split("\n")); },
      });
      return Promise.resolve(true);
    },
    revealRange: () => {},
  };
  vscode.window.activeTextEditor = editor;
  await plainCommands.get("aot.addExample")("5", "Integer");
  vscode.window.activeTextEditor = undefined;
  const landed = lines[3] === "    - 5"; // after the last Example, before 'Note'
  const cursorOnIt = editor.selection.active.line === 3;
  console.log(landed && cursorOnIt
    ? "PASS (addExample command: the value is listed under its Concept, cursor on it)"
    : "UNEXPECTED addExample " + JSON.stringify({ lines, sel: editor.selection.a }));
})();

// 4c) aot.copyFileIntoRepo: a cited file living outside the repo is copied
// into aot.files and the value rewritten to name the copy.
(async () => {
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aot-copy-"));
  const outside = path.join(root, "elsewhere");
  fs.mkdirSync(outside);
  const source = path.join(outside, "report.txt");
  fs.writeFileSync(source, "the evidence");
  const wsRoot = path.join(root, "repo");
  fs.mkdirSync(wsRoot);

  const lines = ["Study", "    evidence: " + source.replace(/\\/g, "/")];
  const aotPath = path.join(wsRoot, "World.aot");
  fs.writeFileSync(aotPath, lines.join("\n"));
  const doc = {
    languageId: "aot", fileName: aotPath, eol: vscode.EndOfLine.LF,
    uri: { toString: () => "file:///copyfile" },
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  const editor = {
    document: doc,
    selection: new vscode.Selection(1, 20, 1, 20), // inside the path
    edit: (cb) => {
      cb({ replace: (range, t) => {
        const [sl, sc, , ec] = range.a;
        lines[sl] = lines[sl].slice(0, sc) + t + lines[sl].slice(ec);
      } });
      return Promise.resolve(true);
    },
    revealRange: () => {},
  };
  const folders = vscode.workspace.workspaceFolders;
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: wsRoot } }];
  vscode.window.activeTextEditor = editor;
  await plainCommands.get("aot.copyFileIntoRepo")();
  vscode.window.activeTextEditor = undefined;
  vscode.workspace.workspaceFolders = folders;

  const copied = path.join(wsRoot, "aot.files", "report.txt");
  const landed = fs.existsSync(copied) && fs.readFileSync(copied, "utf8") === "the evidence";
  const relinked = lines[1] === "    evidence: aot.files/report.txt";
  console.log(landed && relinked
    ? "PASS (copy file: the file lands in aot.files and the value names the copy)"
    : "UNEXPECTED copy file " + JSON.stringify({ landed, line: lines[1] }));

  // a CSV a value points at is claimed, not an orphan: no table writes
  // 'evidence.csv', but the model cites it, so the save must leave it be —
  // archiving it would break the very link that names it. 'stray.csv',
  // which nothing speaks for, is archived as before.
  const filesDir = path.join(wsRoot, "aot.files");
  fs.writeFileSync(path.join(filesDir, "evidence.csv"), "a,b\n1,2\n");
  fs.writeFileSync(path.join(filesDir, "stray.csv"), "a,b\n3,4\n");
  const citing = ["Study", "    source: aot.files/evidence.csv", "    Otter", "        |name |", "        |-----|", "        |Ollie|"].join("\n");
  fs.writeFileSync(aotPath, citing);
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: wsRoot } }];
  vscode.workspace._save(makeDoc(aotPath, citing));
  vscode.workspace.workspaceFolders = folders;
  const kept = fs.existsSync(path.join(filesDir, "evidence.csv"))
    && !fs.existsSync(path.join(filesDir, "_evidence.csv"));
  const archived = fs.existsSync(path.join(filesDir, "_stray.csv"));
  console.log(kept && archived
    ? "PASS (copy file: a CSV a value cites is claimed; one nothing speaks for is still archived)"
    : "UNEXPECTED orphan claim " + JSON.stringify(fs.readdirSync(filesDir)));
  fs.rmSync(root, { recursive: true, force: true });
})();

// 5) the org table editor: the commands are registered, and Tab re-aligns
// the block then lands the cursor at the start of the next cell.
{
  console.log(`registered ${registeredCommands.size} table command(s)`);
  const text = [
    "Otter",
    "    | name | size |",
    "    |--+--|",
    "    | Ollie | 5 |",
  ].join("\n");
  const doc4 = makeDoc("c:\repo\World.aot", text);
  doc4.eol = vscode.EndOfLine.LF;
  let applied = null;
  const editor = {
    document: doc4,
    selection: new vscode.Selection(3, 7, 3, 7), // inside 'Ollie'
    edit: (cb) => { cb({ replace: (range, t) => { applied = { range, t }; } }); return Promise.resolve(true); },
    revealRange: () => {},
  };
  registeredCommands.get("aot.table.nextCell")(editor);
  Promise.resolve().then(() => {
    const ok = applied
      && applied.t.split("\n")[2] === "    |Ollie|5   |"
      && editor.selection.active.line === 3 && editor.selection.active.character === 11;
    console.log(ok && registeredCommands.size === 18
      ? "PASS (table editor: 18 commands; Tab aligns and moves to the next cell)"
      : "UNEXPECTED table editor " + JSON.stringify({ n: registeredCommands.size, applied, sel: editor.selection.a }));
  });
}

// 5b) Tab pressed in the leading indent shifts the whole table one level;
// Shift+Tab shifts it back. Inside the cells the keys keep navigating.
(async () => {
  const lines = [
    "Otter",
    "    |name |size|",
    "    |-----+----|",
    "    |Ollie|5   |",
  ];
  const doc = {
    languageId: "aot", fileName: "c:\\repo\\World.aot", eol: vscode.EndOfLine.LF,
    uri: { toString: () => "file:///indent" },
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  const editor = {
    document: doc,
    selection: new vscode.Selection(3, 1, 3, 1), // inside the 4-space indent
    edit: (cb) => {
      cb({ replace: (range, t) => { const [sl, , el] = range.a; lines.splice(sl, el - sl + 1, ...t.split("\n")); } });
      return Promise.resolve(true);
    },
    revealRange: () => {},
    setDecorations: () => {},
  };
  registeredCommands.get("aot.table.nextCell")(editor);
  await new Promise((r) => setImmediate(r));
  const indented = lines[1] === "        |name |size|" && lines[3] === "        |Ollie|5   |";
  const selOk = editor.selection.active.line === 3 && editor.selection.active.character === 5;
  registeredCommands.get("aot.table.prevCell")(editor);
  await new Promise((r) => setImmediate(r));
  const back = lines[1] === "    |name |size|" && lines[3] === "    |Ollie|5   |";
  console.log(indented && selOk && back
    ? "PASS (table editor: Tab in the leading indent shifts the table a level; Shift+Tab back)"
    : "UNEXPECTED table indent " + JSON.stringify({ lines, sel: editor.selection.a }));
})();

// 5c) a first '|' typed on an otherwise empty line scaffolds a fresh table —
// header, separator, empty data row — cursor in the data row; a '|' beside
// an existing table, or mid-line, scaffolds nothing.
(async () => {
  const makeLive = (lines, name) => {
    const doc = {
      languageId: "aot", fileName: name, eol: vscode.EndOfLine.LF,
      uri: { toString: () => "file:///" + name },
      get lineCount() { return lines.length; },
      getText: () => lines.join("\n"),
      lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
    };
    const editor = {
      document: doc,
      selection: new vscode.Selection(0, 0, 0, 0),
      edit: (cb) => {
        cb({ replace: (range, t) => { const [sl, , el] = range.a; lines.splice(sl, el - sl + 1, ...t.split("\n")); } });
        return Promise.resolve(true);
      },
      revealRange: () => {},
      setDecorations: () => {},
    };
    vscode.window.visibleTextEditors.push(editor);
    return { doc, editor };
  };
  const typedPipe = (doc, line) => vscode.workspace._changed({
    document: doc,
    contentChanges: [{ text: "|", range: new vscode.Range(line, 0, line, 0) }],
  });

  const grow = ["Otter", "|"];
  const { doc: docG, editor: edG } = makeLive(grow, "Grow.aot");
  typedPipe(docG, 1);
  await new Promise((r) => setImmediate(r));
  const grown = grow.join("\n") === ["Otter", "|name|", "|----|", "|    |"].join("\n");
  const cursorOk = edG.selection.active.line === 3 && edG.selection.active.character === 1;
  console.log(grown && cursorOk
    ? "PASS (scaffold: a first '|' grows header, separator and data row, cursor in the data row)"
    : "UNEXPECTED scaffold " + JSON.stringify({ grow, sel: edG.selection.a }));

  // inherited attributes arrive as ready-made columns: the ancestors'
  // declarations become the header, the parent's own lines stay out
  const nested = [
    "Animal",
    "    legs",
    "    habitat: land",
    "    Otter",
    "        whiskered",
    "        |",
  ];
  const { doc: docN } = makeLive(nested, "Nested.aot");
  typedPipe(docN, 5);
  await new Promise((r) => setImmediate(r));
  const inherited = nested.slice(5).join("\n") === [
    "        |name|legs|habitat|",
    "        |----+----+-------|",
    "        |    |    |       |",
  ].join("\n");
  console.log(inherited
    ? "PASS (scaffold: inherited attributes pre-fill the header, the parent's own stay out)"
    : "UNEXPECTED scaffold columns " + JSON.stringify(nested.slice(5)));

  const beside = ["|a|b|", "|"];
  const { doc: docB } = makeLive(beside, "Beside.aot");
  typedPipe(docB, 1);
  const midline = ["Otter", "note |"];
  const { doc: docM2 } = makeLive(midline, "Midline.aot");
  typedPipe(docM2, 1);
  await new Promise((r) => setImmediate(r));
  console.log(beside.length === 2 && midline.length === 2
    ? "PASS (scaffold: a '|' beside a table, or mid-line, scaffolds nothing)"
    : "UNEXPECTED scaffold guard " + JSON.stringify({ beside, midline }));
})();

// 6) table cells carry Alpha's colouring and crosslinks: semantic tokens
// paint header cells as attributes (aliases included), name cells as
// Examples and value cells as values, and a header alias crosslinks to the
// Concept it names, exactly as the bare attribute form would.
{
  const text = [
    "Length",
    "Otter",
    "    | name | size (length) | colour |",
    "    |------+----------------+--------|",
    "    | Ollie | 5 | brown |",
    "",
    "    | Loner",
  ].join("\n");
  const doc5 = makeDoc("c:\repo\World.aot", text);
  const { tokens } = semanticProvider.provideDocumentSemanticTokens(doc5);
  const has = (t) => tokens.some((x) => x.join(",") === t.join(","));
  const tokensOk = has([2, 13, 4, 0])   // header 'size' as attribute
    && has([2, 19, 6, 0])               // header alias 'length' as attribute
    && has([2, 29, 6, 0])               // header 'colour' as attribute
    && has([4, 6, 5, 1])                // name cell 'Ollie' as Example
    && has([4, 14, 1, 2])               // value cell '5' as value
    && has([4, 18, 5, 2])               // value cell 'brown' as value
    && has([6, 6, 5, 1]);               // lone-cell '| Loner' as Example too
  console.log(tokensOk
    ? "PASS (table: cells coloured as attribute / Example / value; lone cell as Example)"
    : "UNEXPECTED semantic tokens " + JSON.stringify(tokens));

  const t6 = lint(text, "World");
  const aliasLink = resolve(text, t6.root, t6.nodes).find((l) =>
    l.connection === "attribute-is-a-Concept" && l.line === 3 && l.text === "length");
  console.log(aliasLink && aliasLink.startCol === 19 && aliasLink.target.name === "Length"
    ? "PASS (table: a header cell's alias crosslinks to its Concept)"
    : "UNEXPECTED header alias link " + JSON.stringify(aliasLink));
}

// 7) the CSV mirror, end to end: saving the .aot writes each table's CSV
// into one 'aot.files' folder at the workspace root, named after the
// Concept; a CSV edit folds back; legacy per-file folders migrate; an
// orphaned CSV is archived with '_' (never deleted).
(async () => {
  const tmp = path.join(__dirname, "tmp-sync");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  const aotPath = path.join(tmp, "World.aot");
  const aotText = [
    "Otter",
    "    | name  | size |",
    "    |-------+------|",
    "    | Ollie | 5    |",
  ].join("\n");
  fs.writeFileSync(aotPath, aotText);

  // a legacy per-file folder from a pre-1.3 install, with a stale CSV + note
  const legacyDir = path.join(tmp, "tables.World");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "Ghost.csv"), "name\nBoo\n");
  fs.writeFileSync(path.join(legacyDir, "notes.txt"), "keep me");

  // save the .aot -> aot.files/Otter.csv appears; the legacy folder folds in
  // and is removed; the orphaned Ghost.csv is archived as _Ghost.csv
  vscode.workspace._save(makeDoc(aotPath, aotText));
  const dir = path.join(tmp, "aot.files");
  const csvPath = path.join(dir, "Otter.csv");
  const written = fs.existsSync(csvPath) && fs.readFileSync(csvPath, "utf8");
  console.log(written === "name,size\nOllie,5\n"
    ? "PASS (csv mirror: saving writes aot.files/<Concept>.csv at the workspace root)"
    : "UNEXPECTED csv written: " + JSON.stringify(written));
  console.log(!fs.existsSync(legacyDir) && !fs.existsSync(path.join(dir, "Ghost.csv"))
    && fs.existsSync(path.join(dir, "_Ghost.csv"))
    ? "PASS (csv mirror: the legacy folder folds in; an orphan is archived _Ghost.csv, not deleted)"
    : "UNEXPECTED migration state " + JSON.stringify(fs.existsSync(dir) && fs.readdirSync(dir)));

  // edit the CSV -> the owning .aot's table gains the row, aligned, and saves
  fs.writeFileSync(csvPath, "name,size\nOllie,5\nPebble,3\n");
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  const after = fs.readFileSync(aotPath, "utf8").split(/\r?\n/);
  console.log(after[3] === "    |Ollie |5   |" && after[4] === "    |Pebble|3   |"
    ? "PASS (csv mirror: a CSV edit folds back into the owning .aot table)"
    : "UNEXPECTED aot after csv edit: " + JSON.stringify(after));

  // the same CSV with Windows line endings is the same data: a clone that
  // git handed CRLF ('* text=auto') must not be rewritten on every save,
  // nor folded back as though somebody had edited it
  {
    const lf = fs.readFileSync(csvPath, "utf8");
    fs.writeFileSync(csvPath, lf.replace(/\n/g, "\r\n"));
    const aotBefore = fs.readFileSync(aotPath, "utf8");
    await vscode.workspace._csvChanged({ fsPath: csvPath });
    const foldedNothing = fs.readFileSync(aotPath, "utf8") === aotBefore;
    vscode.workspace._save(makeDoc(aotPath, aotBefore));
    const leftAlone = fs.readFileSync(csvPath, "utf8").includes("\r\n");
    console.log(foldedNothing && leftAlone
      ? "PASS (csv mirror: CRLF and LF are the same data — no rewrite, no fold-back)"
      : "UNEXPECTED eol churn " + JSON.stringify({ foldedNothing, leftAlone }));
    fs.writeFileSync(csvPath, lf);
  }

  // our own write echoing back does nothing
  const before = fs.readFileSync(aotPath, "utf8");
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  console.log(fs.readFileSync(aotPath, "utf8") === before
    ? "PASS (csv mirror: no self-chase — an unchanged grid edits nothing)"
    : "UNEXPECTED csv loop");

  // an archived _CSV is ignored by the fold-back watcher
  fs.writeFileSync(path.join(dir, "_Ghost.csv"), "name\nZzz\n");
  await vscode.workspace._csvChanged({ fsPath: path.join(dir, "_Ghost.csv") });
  console.log(fs.readFileSync(aotPath, "utf8") === before
    ? "PASS (csv mirror: an archived _CSV is not folded back)"
    : "UNEXPECTED archived csv folded");

  // renaming the Concept: the fresh save writes Beaver.csv and archives the
  // now-orphaned Otter.csv as _Otter.csv (never deleted)
  const renamed = aotText.replace("Otter", "Beaver");
  fs.writeFileSync(aotPath, renamed);
  vscode.workspace._save(makeDoc(aotPath, renamed));
  console.log(fs.existsSync(path.join(dir, "Beaver.csv")) && !fs.existsSync(csvPath) && fs.existsSync(path.join(dir, "_Otter.csv"))
    ? "PASS (csv mirror: a renamed Concept's old CSV is archived _Otter.csv on save)"
    : "UNEXPECTED rename cleanup " + JSON.stringify(fs.readdirSync(dir)));
  vscode.workspace.workspaceFolders = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
})();

// 6c) the mirror reaches line-form Concepts too: a CSV of a Concept's name
// folds its rows in as Examples (keeping line form), and saving writes the
// Concept back out — but only because a CSV of that name is already there.
(async () => {
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aot-lineform-"));
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
  const dir = path.join(root, "aot.files");
  fs.mkdirSync(dir);
  const aotPath = path.join(root, "Numbers.aot");
  const aotText = ["Integer", "    - 1", "        is prime: Yes", "    - 35", "        is prime: No"].join("\n");
  fs.writeFileSync(aotPath, aotText);

  // no CSV yet: saving must not rain a file into aot.files for every Concept
  vscode.workspace._save(makeDoc(aotPath, aotText));
  const restrained = !fs.existsSync(path.join(dir, "Integer.csv"));

  // the CSV is the opt-in: put one there, and the Concept mirrors out to it
  fs.writeFileSync(path.join(dir, "Integer.csv"), "name,is prime\n");
  vscode.workspace._save(makeDoc(aotPath, aotText));
  const written = fs.readFileSync(path.join(dir, "Integer.csv"), "utf8");
  const mirrored = written === "name,is prime\n1,Yes\n35,No\n";
  console.log(restrained && mirrored
    ? "PASS (csv mirror: a line-form Concept mirrors out, but only where a CSV opted in)"
    : "UNEXPECTED line-form mirror " + JSON.stringify({ restrained, written }));

  // and back: a new row folds in as a '- Example', line form kept
  fs.writeFileSync(path.join(dir, "Integer.csv"), "name,is prime\n1,Yes\n35,No\n7,Yes\n");
  await vscode.workspace._csvChanged({ fsPath: path.join(dir, "Integer.csv") });
  const after = fs.readFileSync(aotPath, "utf8").split(/\r?\n/);
  const folded = after[5] === "    - 7" && after[6] === "        is prime: Yes";
  const stillLineForm = !after.some((l) => l.trim().startsWith("|"));
  console.log(folded && stillLineForm
    ? "PASS (csv mirror: a CSV row folds into a line-form Concept as an Example, not a table)"
    : "UNEXPECTED line-form fold " + JSON.stringify(after));

  vscode.workspace.workspaceFolders = undefined;
  fs.rmSync(root, { recursive: true, force: true });
})();

// 6d) value completion: an attribute typed by a Concept offers that
// Concept's Examples, with its archived CSV's values beside them.
(async () => {
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aot-values-"));
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
  fs.mkdirSync(path.join(root, "aot.files"));
  // an archive: Plato was a Person once, and no Concept claims this CSV now
  fs.writeFileSync(path.join(root, "aot.files", "_Person.csv"), "name,nationality\nSocrates,RSA\nPlato,Greek\n");
  const aotPath = path.join(root, "World.aot");
  const text = ["Person", "    - Socrates", "Measurement", "    person: "].join("\n");
  fs.writeFileSync(aotPath, text);
  const doc = makeDoc(aotPath, text);

  const at = new vscode.Position(3, 12); // after 'person: '
  const items = valueCompletionProvider.provideCompletionItems(doc, at);
  const labels = (items || []).map((i) => i.label);
  const live = items.find((i) => i.label === "Socrates");
  const archived = items.find((i) => i.label === "Plato");
  console.log(labels.join(",") === "Socrates,Plato"
    && /Example of Person/.test(live.detail) && /archived in _Person\.csv/.test(archived.detail)
    ? "PASS (value completion: the Concept's Examples first, its archived values after, each marked)"
    : "UNEXPECTED value completion " + JSON.stringify((items || []).map((i) => [i.label, i.detail])));

  // a formula is not a value: nothing is offered inside one
  const formulaDoc = makeDoc(aotPath, ["Person", "    - Socrates", "Measurement", "    person: =@x"].join("\n"));
  const inFormula = valueCompletionProvider.provideCompletionItems(formulaDoc, new vscode.Position(3, 16));
  console.log((inFormula || []).length === 0
    ? "PASS (value completion: a formula is not a value, and is offered nothing)"
    : "UNEXPECTED completion inside a formula");

  vscode.workspace.workspaceFolders = undefined;
  fs.rmSync(root, { recursive: true, force: true });
})();

// 7b) cross-file: a crosslink whose target lives in another repo file
// resolves and its go-to-definition opens that file; a Concept defined in
// two files warns (repo-wide), without counting in V.
{
  const tmp = path.join(__dirname, "tmp-xfile");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  const aPath = path.join(tmp, "People.aot");
  const bPath = path.join(tmp, "Census.aot");
  fs.writeFileSync(aPath, ["Human", "    - Socrates"].join("\n"));
  fs.writeFileSync(bPath, ["Record", "    human: Socrates", "Human"].join("\n")); // B also defines Human

  // index both files as the workspace watcher would
  vscode.workspace._aotCreated({ fsPath: aPath });
  vscode.workspace._aotCreated({ fsPath: bPath });

  const docB = makeDoc(bPath, fs.readFileSync(bPath, "utf8"));
  vscode.workspace._open(docB);

  // the value 'Socrates' in B resolves to '- Socrates' defined in People.aot
  const defB = definitionProvider.provideDefinition(docB, new vscode.Position(1, 15));
  console.log(defB && /People\.aot/.test(defB.uri.toString())
    ? "PASS (cross-file: a value resolves to an Example in another file; go-to-definition opens it)"
    : "UNEXPECTED cross-file definition " + JSON.stringify(defB && defB.uri.toString()));

  // 'Human' is defined in both People.aot and Census.aot -> a repo warning
  const bDiags = published.get(docB.uri.toString()) || [];
  console.log(bDiags.some((d) => d.severity === vscode.DiagnosticSeverity.Warning && /also defined in People\.aot/.test(d.message))
    ? "PASS (cross-file: a Concept defined in two files warns repo-wide, not counted in V)"
    : "UNEXPECTED repo duplicate " + JSON.stringify(bDiags.map((d) => d.message)));

  vscode.workspace.workspaceFolders = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 7c) the same file reaching the index in two different cases is one file.
// On Windows and macOS a path arrives as 'C:\repo\A.aot' from VS Code's URIs
// and 'c:\repo\A.aot' from a glob; keyed by raw case that is two entries, and
// the file is then flagged as its own repo-wide duplicate. Linux holds names
// case-sensitively, so there the two really are different files.
if (process.platform === "win32" || process.platform === "darwin") {
  const tmp = path.join(__dirname, "tmp-case");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  // a Concept name no other fixture uses, so a stale index entry from an
  // earlier block cannot be mistaken for this file's own duplicate
  const real = path.join(tmp, "Kinfolk.aot");
  fs.writeFileSync(real, ["Otterkin", "    - Ollie"].join("\n"));

  // the watcher indexes it as written; the editor then opens the very same
  // file under a differently-cased path
  vscode.workspace._aotCreated({ fsPath: real });
  const doc = makeDoc(path.join(tmp, "kinfolk.aot"), fs.readFileSync(real, "utf8"));
  vscode.workspace._open(doc);
  const diags = published.get(doc.uri.toString()) || [];
  const selfDuplicate = diags.some((d) => /also defined in/i.test(d.message));
  console.log(!selfDuplicate
    ? "PASS (cross-platform: one file in two cases is one entry, never its own duplicate)"
    : "UNEXPECTED self-duplicate " + JSON.stringify(diags.map((d) => d.message)));

  vscode.workspace.workspaceFolders = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 8) formulas: the span after the '=' is coloured as its own token, a
// stale value publishes a pinned warning, and Tab recomputes it.
{
  const calc = [
    "Order",
    "    | name | price | total    |",
    "    |------+-------+----------|",
    "    | A    | 10    | 15 =@price*2 |",
  ].join("\n");
  const doc8 = makeDoc("c:\repo\Calc.aot", calc);
  const { tokens } = semanticProvider.provideDocumentSemanticTokens(doc8);
  const formulaTok = tokens.find((t) => t[3] === 3);
  console.log(formulaTok && formulaTok[0] === 3 && formulaTok[1] === 24 && formulaTok[2] === 9
    ? "PASS (formula: '=@price*2' carries its own colour token)"
    : "UNEXPECTED formula token " + JSON.stringify(tokens.filter((t) => t[3] === 3)));

  vscode.workspace._open(doc8);
  const calcDiags = published.get(doc8.uri.toString()) || [];
  const stale = calcDiags.find((d) => /does not match its formula \(= 20\)/.test(d.message));
  console.log(stale && stale.severity === vscode.DiagnosticSeverity.Warning && stale.range.a[1] === 24
    ? "PASS (formula: a stale value warns on exactly its span)"
    : "UNEXPECTED formula diagnostics " + JSON.stringify(calcDiags.map((d) => d.message)));

  // Tab recomputes: the stale 15 becomes 20
  let applied8 = null;
  const editor8 = {
    document: doc8,
    selection: new vscode.Selection(3, 7, 3, 7),
    edit: (cb) => { cb({ replace: (range, t) => { applied8 = t; } }); return Promise.resolve(true); },
    revealRange: () => {},
  };
  registeredCommands.get("aot.table.nextCell")(editor8);
  Promise.resolve().then(() => {
    console.log(applied8 && applied8.includes("|20 =@price*2|")
      ? "PASS (formula: Tab recomputes the value in place)"
      : "UNEXPECTED recompute on Tab " + JSON.stringify(applied8));
  });
}

// 8c) F2 rename: the declaration, the crosslinks and every formula
// reference change together, so a rename never strands a formula
{
  // a column rename reaches the formula that reads it
  const calc = makeDoc("c:\\repo\\Rename.aot", [
    "Order",
    "    |name|price|total       |",
    "    |----+-----+------------|",
    "    |A   |10   |20 =@price*2|",
  ].join("\n"));
  const prep = renameProvider.prepareRename(calc, new vscode.Position(1, 11));
  console.log(prep && prep.placeholder === "price" && prep.range.a[1] === 10
    ? "PASS (rename: prepare finds the header cell under the cursor)"
    : "UNEXPECTED prepareRename " + JSON.stringify(prep));
  const colEdit = renameProvider.provideRenameEdits(calc, new vscode.Position(1, 11), "cost");
  const colOps = colEdit.ops.map((o) => o.range.a.join(",") + ":" + o.text).sort();
  console.log(colOps.length === 2 && colOps[0] === "1,10,1,15:cost" && colOps[1] === "3,21,3,26:cost"
    ? "PASS (rename: a column renames its header cell and the formula reading it)"
    : "UNEXPECTED column rename " + JSON.stringify(colOps));

  // a Concept rename carries the attribute wearing its name, and the
  // formula reading that attribute follows in turn
  const web = makeDoc("c:\\repo\\Web.aot", [
    "Registry",
    "    Person",
    "        - Socrates",
    "    - Emp",
    "        person: Socrates",
    "        boss: =@person",
  ].join("\n"));
  const conceptEdit = renameProvider.provideRenameEdits(web, new vscode.Position(1, 4), "Human");
  const conceptOps = conceptEdit.ops.map((o) => o.range.a.join(",") + ":" + o.text).sort();
  console.log(conceptOps.length === 3
    && conceptOps.includes("1,4,1,10:Human")   // the Concept itself, as typed
    && conceptOps.includes("4,8,4,14:human")   // the attribute wearing its name stays lowercase
    && conceptOps.includes("5,16,5,22:human")  // the formula reading that attribute follows it
    ? "PASS (rename: a Concept carries its crosslinked attribute, case following the span)"
    : "UNEXPECTED concept rename " + JSON.stringify(conceptOps));

  // a table's parent renames through cross-table references
  const named = makeDoc("c:\\repo\\Named.aot", [
    "Order",
    "    |name|price|",
    "    |----+-----|",
    "    |Acme|10   |",
    "spend: =@Order@price@Acme",
  ].join("\n"));
  const tableEdit = renameProvider.provideRenameEdits(named, new vscode.Position(0, 2), "Purchases");
  const tableOps = tableEdit.ops.map((o) => o.range.a.join(",") + ":" + o.text).sort();
  console.log(tableOps.length === 2
    && tableOps.includes("0,0,0,5:Purchases")  // the Concept the table sits under
    && tableOps.includes("4,9,4,14:Purchases") // the table name inside the formula
    ? "PASS (rename: a table's parent renames inside cross-table references)"
    : "UNEXPECTED table rename " + JSON.stringify(tableOps));
}

// 8d) rename on the real spreadsheet example: renaming Concept 'Integer'
// reaches the alias that wears it and the '@Integer' formula reference
{
  // an inline copy of the spreadsheet example's shape (the live example
  // file is the user's to edit, so the test carries its own fixture)
  const sheetLines = [
    "Integer",
    "    is prime: No",
    "    - 35",
    "        is prime: No",
    "Measurement Test",
    "    age (integer): 5",
    "    check: No =@Integer@is prime",
  ];
  const real = sheetLines.join("\n");
  const sheet = makeDoc("c:\\repo\\spreadsheet.aot", real);
  const line = sheetLines.findIndex((l) => l.trim() === "Integer");
  let ops = null, failed = null;
  try {
    ops = renameProvider.provideRenameEdits(sheet, new vscode.Position(line, 0), "Integer Test")
      .ops.map((o) => o.range.a.join(",") + ":" + o.text).sort();
  } catch (e) { failed = e.message; }
  const aliasAt = sheetLines[5].indexOf("integer");
  const refAt = sheetLines[6].indexOf("Integer");
  const hasDecl = ops && ops.includes(`${line},0,${line},7:Integer Test`);
  const hasFormula = ops && ops.includes(`6,${refAt},6,${refAt + 7}:Integer Test`); // '@Integer' keeps the Concept's case
  const hasAlias = ops && ops.includes(`5,${aliasAt},5,${aliasAt + 7}:integer test`); // the attribute's alias stays lowercase
  console.log(!failed && hasDecl && hasFormula && hasAlias
    ? "PASS (rename: the spreadsheet fixture's Integer renames with alias and formula)"
    : "UNEXPECTED spreadsheet rename " + (failed || JSON.stringify(ops)));
}

// 8e) the F2 nudge: standing in a name that is used elsewhere shows ghost
// text with the count F2 would edit; an unused name shows nothing
{
  const web = makeDoc("c:\\repo\\Nudge.aot", [
    "Registry",
    "    Person",
    "        - Socrates",
    "    - Emp",
    "        person: Socrates",
    "        boss: =@person",
  ].join("\n"));
  const shown = [];
  const editor = {
    document: web,
    selections: [new vscode.Selection(1, 5, 1, 5)],
    setDecorations: (type, opts) => shown.push(opts),
  };
  vscode.window._selectionChanged({ textEditor: editor, selections: editor.selections });
  const hint = shown.pop();
  console.log(hint && hint.length === 1
    && hint[0].renderOptions.after.contentText === "2 uses elsewhere — F2 renames them all"
    && hint[0].range.a[0] === 1
    ? "PASS (nudge: a used Concept shows the F2 ghost text with its count)"
    : "UNEXPECTED nudge " + JSON.stringify(hint));
  editor.selections = [new vscode.Selection(0, 2, 0, 2)];
  vscode.window._selectionChanged({ textEditor: editor, selections: editor.selections });
  const cleared = shown.pop();
  console.log(cleared && cleared.length === 0
    ? "PASS (nudge: an unused name shows nothing)"
    : "UNEXPECTED nudge clear " + JSON.stringify(cleared));

  // standing in a usage is ambiguous — typing may be the right move — so
  // the ghost text names the target and says which key does which
  editor.selections = [new vscode.Selection(4, 10, 4, 10)]; // in 'person:', wearing Concept Person's name
  vscode.window._selectionChanged({ textEditor: editor, selections: editor.selections });
  const usage = shown.pop();
  console.log(usage && usage.length === 1 && usage[0].range.a[0] === 4
    && usage[0].renderOptions.after.contentText === "names 'Person' — F2 renames its 2 uses, typing changes just this one"
    ? "PASS (nudge: an attribute wearing a Concept's name offers both keys)"
    : "UNEXPECTED usage nudge " + JSON.stringify(usage));
  editor.selections = [new vscode.Selection(4, 18, 4, 18)]; // in the value 'Socrates'
  vscode.window._selectionChanged({ textEditor: editor, selections: editor.selections });
  const value = shown.pop();
  console.log(value && value.length === 1
    && value[0].renderOptions.after.contentText === "names 'Socrates' — F2 renames its 1 use, typing changes just this one"
    ? "PASS (nudge: a value naming an Example offers both keys)"
    : "UNEXPECTED value nudge " + JSON.stringify(value));
}

// 9) aliases are alternative names: an attribute typed by a Concept's alias
// crosslinks to that Concept, a Concept's alias that names another Concept
// links itself (alias-is-a-Concept), and hovering a Concept lists its
// dependency chains — one per crosslinked attribute, one Concept per hop.
{
  const text = [
    "Category (Type)",     // 'type' resolves to this Concept via its alias
    "    label",
    "Card",
    "    type",            // attribute-is-a-Concept through the alias
    "Auto (Car)",          // alias-is-a-Concept: 'Car' names the Concept below
    "Car",
    "    owner person",
    "Person",
    "    home address",
    "Address",
  ].join("\n");
  const { lint } = require("../src/linter");
  const { resolve } = require("../src/crosslinks");
  const t9 = lint(text, "World");
  const links9 = resolve(text, t9.root, t9.nodes);
  const typeLink = links9.find((l) => l.connection === "attribute-is-a-Concept" && l.line === 4);
  console.log(typeLink && typeLink.target.name === "Category"
    ? "PASS (alias: attribute 'type' crosslinks to the Concept 'Category (Type)')"
    : "UNEXPECTED alias typing " + JSON.stringify(typeLink));
  const aliasLink9 = links9.find((l) => l.connection === "alias-is-a-Concept");
  console.log(aliasLink9 && aliasLink9.line === 5 && aliasLink9.startCol === 6 && aliasLink9.text === "Car" && aliasLink9.target.line === 6
    ? "PASS (alias: a Concept's alias links to the Concept it names, inside the parentheses)"
    : "UNEXPECTED alias-is-a-Concept " + JSON.stringify(aliasLink9));

  // hovering 'Car' (line 6): its crosslinked attribute reaches Person, whose
  // attribute reaches Address — one chain of three Concepts
  const doc9 = makeDoc("c:\\repo\\World.aot", text);
  vscode.workspace._open(doc9);
  const hover = hoverProvider.provideHover(doc9, new vscode.Position(5, 1));
  const hoverOk = hover && hover.contents.value.includes("Car ─owner person→ Person ─home address→ Address")
    && hover.contents.value.includes("3 Concepts");
  console.log(hoverOk
    ? "PASS (hover: 'Car' shows the chain Car → Person → Address, 3 Concepts)"
    : "UNEXPECTED hover " + JSON.stringify(hover && hover.contents.value));

  // hovering 'Auto': a Concept alias names a *kind*, not a dependency, so
  // 'Auto' has no dependency chain (the alias link still navigates)
  const hoverAuto = hoverProvider.provideHover(doc9, new vscode.Position(4, 1));
  console.log(!hoverAuto || !/dependency chains/.test(hoverAuto.contents.value)
    ? "PASS (hover: a Concept alias is a kind, not a dependency — 'Auto' shows no chain)"
    : "UNEXPECTED alias hover " + JSON.stringify(hoverAuto && hoverAuto.contents.value));

  // hovering the crosslink 'person' in 'owner person' (line 7) starts the
  // chains from its target: Person ─home address→ Address
  const hoverLink = hoverProvider.provideHover(doc9, new vscode.Position(6, 11));
  console.log(hoverLink && hoverLink.contents.value.includes("'Person' dependency chains")
    && hoverLink.contents.value.includes("Person ─home address→ Address")
    ? "PASS (hover: a crosslink to a Concept shows the target's chains)"
    : "UNEXPECTED crosslink hover " + JSON.stringify(hoverLink && hoverLink.contents.value));

  // 'Address' declares no dependency, so no chains — but it is referenced
  // by 'home address', so the hover shows where it is used instead
  const hoverLeaf = hoverProvider.provideHover(doc9, new vscode.Position(9, 1));
  console.log(hoverLeaf && !/dependency chains/.test(hoverLeaf.contents.value)
    && /used at/.test(hoverLeaf.contents.value) && /home address/.test(hoverLeaf.contents.value)
    ? "PASS (hover: a chain-less Concept still shows where it is used)"
    : "UNEXPECTED leaf hover " + JSON.stringify(hoverLeaf));
}

// 9a2) an attribute alias is exclusive: only the alias crosslinks, never a
// run of the attribute's own name.
{
  const text = [
    "Time",
    "Duration",
    "    span (time)",   // alias 'time' -> Time; the run 'duration'... has no Concept anyway
    "Journey",
    "    duration (time)",  // alias wins; 'duration' (the Concept) must NOT link
  ].join("\n");
  const { lint } = require("../src/linter");
  const { resolve } = require("../src/crosslinks");
  const tE = lint(text, "World");
  const linksE = resolve(text, tE.root, tE.nodes).filter((l) => l.line === 5);
  const toTime = linksE.find((l) => l.target.name === "Time");
  const toDuration = linksE.find((l) => l.target.name === "Duration");
  console.log(toTime && toTime.text === "time" && !toDuration && linksE.length === 1
    ? "PASS (alias exclusivity: only 'duration (time)'s alias links, to Time — never to Duration)"
    : "UNEXPECTED alias exclusivity " + JSON.stringify(linksE.map((l) => [l.text, l.target.name])));
}

// 9b) dependency visibility: an Example used as a value hovers its full
// details; Find All References lists declaration + usages; inlay hints
// write the chain in small print at the end of crosslinked lines.
{
  const text = [
    "Person",
    "    home address",
    "    - Socrates",
    "        wisdom: high",
    "Address",
    "    - Athens",
    "Note",
    "    person: Socrates",
  ].join("\n");
  const docV = makeDoc("c:\\repo\\Visible.aot", text);
  vscode.workspace._open(docV); // caches the analysis for the inlay provider

  // hovering the value 'Socrates' (line 8) shows the Example's details
  const hoverEx = hoverProvider.provideHover(docV, new vscode.Position(7, 14));
  console.log(hoverEx && /'- Socrates'/.test(hoverEx.contents.value)
    && /Example of 'Person'/.test(hoverEx.contents.value)
    && /wisdom: high/.test(hoverEx.contents.value)
    ? "PASS (hover: an Example used as a value shows its full details)"
    : "UNEXPECTED example hover " + JSON.stringify(hoverEx && hoverEx.contents.value));

  // hovering the defining '- Socrates' (line 3) shows details plus usages
  const hoverDef = hoverProvider.provideHover(docV, new vscode.Position(2, 8));
  console.log(hoverDef && /wisdom: high/.test(hoverDef.contents.value)
    && /used at/.test(hoverDef.contents.value) && /person: Socrates/.test(hoverDef.contents.value)
    ? "PASS (hover: an Example's defining line lists where it is used)"
    : "UNEXPECTED defining hover " + JSON.stringify(hoverDef && hoverDef.contents.value));

  // references on the value: declaration first, then the usage
  const refs = referenceProvider.provideReferences(docV, new vscode.Position(7, 14), { includeDeclaration: true });
  console.log(refs && refs.length === 2 && refs[0].range.a[0] === 2 && refs[1].range.a[0] === 7
    ? "PASS (references: declaration + usages for the Example under the cursor)"
    : "UNEXPECTED references " + JSON.stringify(refs && refs.map((r) => r.range.a)));

  // the inlay hint sits at the end of the crosslinked line, naming where the
  // chain leads — without restating the linked Concept itself
  const hints = inlayProvider.provideInlayHints(docV, new vscode.Range(0, 0, 7, 99));
  const hint = hints.find((h) => (h.position.a ? h.position.a[0] : h.position.line) === 7);
  console.log(hint && hint.label === "→Address"
    ? "PASS (inlay: the dependency chain appears in small print at the line's end)"
    : "UNEXPECTED inlay hints " + JSON.stringify(hints));

  // and the setting turns them off
  configStore.chainHints = false;
  const none = inlayProvider.provideInlayHints(docV, new vscode.Range(0, 0, 7, 99));
  delete configStore.chainHints;
  console.log(none.length === 0
    ? "PASS (inlay: aot.chainHints=false silences the small print)"
    : "UNEXPECTED inlay setting " + JSON.stringify(none));
}

// 9b2) line-form formulas fill themselves in: once no cursor holds the
// line, the computed value materialises in front of the formula, exactly
// as a table cell's would on Tab.
(async () => {
  const lines = [
    "Order",
    "    total: =sum(@price)",
    "    - A",
    "        price: 2",
    "    - B",
    "        price: 3",
  ];
  const doc = {
    lines,
    languageId: "aot", fileName: "c:\\repo\\Fill.aot", eol: vscode.EndOfLine.LF,
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  doc.uri = { toString: () => "file:///fill", __doc: doc };
  vscode.workspace._open(doc);
  await new Promise((r) => setImmediate(r));
  console.log(lines[1] === "    total: 5 =sum(@price)"
    ? "PASS (fill: a line formula computes itself once no cursor holds the line)"
    : "UNEXPECTED auto fill " + JSON.stringify(lines));

  // pressing Enter starts an edit burst, yet the formula on the line just
  // left still fills at once (force bypasses the hold, busy spares the new
  // line). Simulate: reset the value, fire the change then the selection.
  lines[1] = "    total: =sum(@price)";
  const editor = {
    document: doc,
    selection: new vscode.Selection(1, 24, 1, 24),
    selections: [new vscode.Selection(2, 0, 2, 0)],
    edit: (cb) => { cb({ replace: (range, t) => { const [sl, , el] = range.a; lines.splice(sl, el - sl + 1, ...t.split("\n")); } }); return Promise.resolve(true); },
    revealRange: () => {}, setDecorations: () => {},
  };
  vscode.window.visibleTextEditors.push(editor);
  lines.splice(2, 0, ""); // Enter inserted a blank line under the formula
  vscode.workspace._changed({ document: doc, contentChanges: [{ text: "\n", range: new vscode.Range(1, 24, 1, 24) }] });
  vscode.window._selectionChanged({ textEditor: editor, selections: [new vscode.Selection(2, 0, 2, 0)] });
  await new Promise((r) => setImmediate(r));
  console.log(lines[1] === "    total: 5 =sum(@price)"
    ? "PASS (fill: pressing Enter fills the formula on the line just left, mid edit-burst)"
    : "UNEXPECTED enter fill " + JSON.stringify(lines));
  vscode.window.visibleTextEditors.pop();
})();

// 9b3) table formulas fill themselves in too: a stale cell refreshes as
// soon as the linter sees it — no Tab, no Format Document
(async () => {
  const lines = [
    "Order",
    "    |name|price|total       |",
    "    |----+-----+------------|",
    "    |A   |10   |15 =@price*2|",
  ];
  const doc = {
    lines,
    languageId: "aot", fileName: "c:\\repo\\TableFill.aot", eol: vscode.EndOfLine.LF,
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  doc.uri = { toString: () => "file:///tablefill", __doc: doc };
  vscode.workspace._open(doc);
  await new Promise((r) => setImmediate(r));
  console.log(lines[3] === "    |A   |10   |20 =@price*2|"
    ? "PASS (fill: a stale table cell recomputes itself, no Tab needed)"
    : "UNEXPECTED table fill " + JSON.stringify(lines));
})();

// 9c) a URL in a value is Ctrl+clickable on exactly its span
{
  const docU = makeDoc("c:\\repo\\Links.aot", ["Doc", "    spec: https://example.com/spec"].join("\n"));
  const links = documentLinkProvider.provideDocumentLinks(docU);
  console.log(links.length === 1 && links[0].range.a.join(",") === "1,10,1,34"
    && links[0].target.toString() === "https://example.com/spec"
    ? "PASS (links: a URL in a value is Ctrl+clickable on its exact span)"
    : "UNEXPECTED document links " + JSON.stringify(links));
}

// 9c2) a file-path value that resolves to a real file is Ctrl+clickable, and
// an image (URL or file) hovers as a picture.
(async () => {
  const dir = path.join(__dirname, "tmp-files");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const png = path.join(dir, "chart.png");
  fs.writeFileSync(png, "x");
  const aot = path.join(dir, "Doc.aot");
  const text = ["Doc", "    chart: ./chart.png", "    missing: ./nope.png", "    logo: https://example.com/logo.png"].join("\n");
  fs.writeFileSync(aot, text);
  const docF = {
    languageId: "aot", fileName: aot, eol: vscode.EndOfLine.LF,
    uri: { toString: () => "file:///" + aot },
    get lineCount() { return text.split("\n").length; },
    getText: () => text,
    lineAt: (i) => { const l = text.split("\n")[i]; return { range: new vscode.Range(i, 0, i, l.length), text: l }; },
  };
  const links = documentLinkProvider.provideDocumentLinks(docF);
  const fileLink = links.find((l) => l.target.scheme === "file");
  console.log(fileLink && fileLink.target.fsPath === png && !links.some((l) => l.range.a[0] === 2)
    ? "PASS (links: a resolvable file path is Ctrl+clickable; a missing one is not)"
    : "UNEXPECTED file links " + JSON.stringify(links.map((l) => [l.range.a[0], l.target.toString()])));

  // hovering the local png shows the picture
  const hoverImg = await hoverProvider.provideHover(docF, new vscode.Position(1, 13));
  console.log(hoverImg && /!\[\]\(file:/.test(hoverImg.contents.value)
    ? "PASS (hover: a local image file shows the picture)"
    : "UNEXPECTED image hover " + JSON.stringify(hoverImg && hoverImg.contents.value));

  // hovering the image URL shows the picture too (metadata off to skip the network)
  configStore.urlMetadata = false;
  const hoverUrlImg = await hoverProvider.provideHover(docF, new vscode.Position(3, 12));
  delete configStore.urlMetadata;
  console.log(hoverUrlImg && /!\[\]\(https:\/\/example\.com\/logo\.png\)/.test(hoverUrlImg.contents.value)
    ? "PASS (hover: an image URL shows the picture)"
    : "UNEXPECTED image url hover " + JSON.stringify(hoverUrlImg && hoverUrlImg.contents.value));
  fs.rmSync(dir, { recursive: true, force: true });
})();

// 9c3) typing '@' in a table formula suggests the columns first, then the
// Examples; on a line-form value it suggests sibling attributes and Examples.
{
  const tbl = [
    "Order",
    "    |name |price|qty|total|",
    "    |-----+-----+---+-----|",
    "    |Alpha|10   |2  |=@|",
    "    |Beta |5    |4  |     |",
  ].join("\n");
  const docC = makeDoc("c:\\repo\\Comp.aot", tbl);
  const atCol = tbl.split("\n")[3].indexOf("@") + 1;
  const items = completionProvider.provideCompletionItems(docC, new vscode.Position(3, atCol));
  const cols = items.filter((i) => i.detail === "column").map((i) => i.label);
  const exs = items.filter((i) => i.detail === "Example").map((i) => i.label);
  console.log(cols.join(",") === "price,qty,total" && exs.includes("Alpha") && exs.includes("Beta")
    && items[0].detail === "column"
    ? "PASS (completion: '@' in a table cell offers columns first, then Examples)"
    : "UNEXPECTED completion " + JSON.stringify({ cols, exs }));

  const lineForm = [
    "Order",
    "    - A",
    "        price: 10",
    "        qty: 2",
    "        total: =@",
    "    - B",
    "        price: 5",
  ].join("\n");
  const docL = makeDoc("c:\\repo\\Line.aot", lineForm);
  const lCol = lineForm.split("\n")[4].indexOf("@") + 1;
  const litems = completionProvider.provideCompletionItems(docL, new vscode.Position(4, lCol));
  const lcols = litems.filter((i) => i.detail === "column").map((i) => i.label);
  console.log(lcols.includes("price") && lcols.includes("qty") && litems.some((i) => i.detail === "Example")
    ? "PASS (completion: '@' on a line-form value offers sibling attributes and Examples)"
    : "UNEXPECTED line completion " + JSON.stringify(litems.map((i) => [i.label, i.detail])));
}

// 9d) the lone-sub grace: only the "1 sub-Concept" warning waits — every
// other squiggle (a plural name) shows at the debounce. The warning lands
// once typing has been quiet past the grace, without the cursor moving.
(async () => {
  const lines = ["Animals", "Parent"];
  const doc = {
    languageId: "aot", fileName: "c:\\repo\\Hold.aot", eol: vscode.EndOfLine.LF,
    uri: { toString: () => "file:///hold" },
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  vscode.workspace._open(doc);
  const diagsOf = () => published.get(doc.uri.toString()) || [];
  const plural = () => diagsOf().some((d) => /appears plural/.test(d.message));
  const lone = () => diagsOf().some((d) => /has 1 sub-Concept/.test(d.message));
  const before = plural() && !lone();

  // the user types '    Child' under Parent, creating the lone-sub warning
  // on the parent line the moment the child exists
  lines.push("    Child");
  vscode.workspace._changed({
    document: doc,
    contentChanges: [{ text: "\n    Child", range: new vscode.Range(1, 6, 1, 6) }],
  });
  await new Promise((r) => setTimeout(r, 400)); // past the 300ms debounce, before the 600ms grace
  const during = plural() && !lone(); // plural shows at once, the lone warning still waits
  const duringDiags = diagsOf().map((d) => d.message.slice(0, 40));

  await new Promise((r) => setTimeout(r, 400)); // now past the grace, typing stayed quiet
  const after = plural() && lone();
  console.log(before && during && after
    ? "PASS (hold: only the lone-sub warning waits a grace; other squiggles are immediate)"
    : "UNEXPECTED hold behaviour " + JSON.stringify({ before, during, after, duringDiags, diags: diagsOf().map((d) => d.message.slice(0, 40)) }));
})();

// 10) spelling: a word longer than four characters that no English dialect
// knows publishes a Hint diagnostic on exactly its span, with suggestions;
// short words, code-shaped tokens and both dialects' spellings stay silent.
{
  const spelt = [
    "Recieve Order",
    "    note: the pakage arrived",
    "    colour: gray",
    "    url: https://example.com/blorptastic",
    "    month: december deadline",
  ].join("\n");
  const docS = makeDoc("c:\\repo\\Spell.aot", spelt);
  vscode.workspace._open(docS);
  const sDiags = published.get(docS.uri.toString()) || [];
  const sHints = sDiags.filter((d) => d.severity === vscode.DiagnosticSeverity.Hint);
  const recieve = sHints.find((d) => d.message.includes("'Recieve'"));
  const pakage = sHints.find((d) => d.message.includes("'pakage'"));
  const recieveOk = recieve && recieve.range.a.join(",") === "0,0,0,7" && /did you mean 'Receive'/.test(recieve.message);
  const pakageOk = pakage && pakage.range.a.join(",") === "1,14,1,20" && /did you mean 'package'/.test(pakage.message);
  console.log(recieveOk && pakageOk
    ? "PASS (spelling: misspelled words hint on their span with suggestions)"
    : "UNEXPECTED spelling hints " + JSON.stringify(sHints.map((d) => [d.range.a, d.message])));
  console.log(sHints.length === 2
    ? "PASS (spelling: 'colour'/'gray' both dialects, 'december' via 'December', short words and URLs stay silent)"
    : "UNEXPECTED extra spelling hints " + JSON.stringify(sHints.map((d) => d.message)));
}

// 11) accepting a word: the Quick Fix on a spelling hint or an appears-plural
// warning appends the word to aot.acceptedWords; the settings change re-lints
// and both findings clear.
(async () => {
  const text = [
    "People",
    "    note: the pakage arrived",
  ].join("\n");
  const docA = makeDoc("c:\\repo\\Accept.aot", text);
  vscode.workspace.textDocuments.push(docA); // so the settings-change refresh sees it
  vscode.workspace._open(docA);
  const diagsOf = () => published.get(docA.uri.toString()) || [];
  const hint = diagsOf().find((d) => d.message.includes("'pakage'"));
  const plural = diagsOf().find((d) => /appears plural/.test(d.message));
  const actions = codeActionsProvider.provideCodeActions(docA, hint && hint.range,
    { diagnostics: [hint, plural].filter(Boolean) });
  const acceptSpelt = actions.find((a) => a.title === "Accept 'pakage' (add to aot.acceptedWords)");
  const acceptPlural = actions.find((a) => a.title === "Accept 'People' (add to aot.acceptedWords)");
  console.log(hint && plural && acceptSpelt && acceptPlural
    ? "PASS (accept: both a spelling hint and a plural warning offer the Quick Fix)"
    : "UNEXPECTED accept actions " + JSON.stringify(actions.map((a) => a.title)));

  await plainCommands.get("aot.acceptWord")(...acceptSpelt.command.arguments);
  await plainCommands.get("aot.acceptWord")(...acceptPlural.command.arguments);
  const cleared = !diagsOf().some((d) => d.message.includes("'pakage'") || /appears plural/.test(d.message));
  console.log(cleared && configStore.acceptedWords.join(",") === "pakage,people"
    ? "PASS (accept: the words join aot.acceptedWords and both findings clear)"
    : "UNEXPECTED accept round trip " + JSON.stringify({ store: configStore.acceptedWords, diags: diagsOf().map((d) => d.message) }));

  // accepting the same word twice writes nothing new
  await plainCommands.get("aot.acceptWord")("People");
  console.log(configStore.acceptedWords.join(",") === "pakage,people"
    ? "PASS (accept: a word already accepted is not duplicated)"
    : "UNEXPECTED duplicate accept " + JSON.stringify(configStore.acceptedWords));
})();
