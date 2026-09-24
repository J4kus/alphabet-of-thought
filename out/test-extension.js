// Smoke test: activate the extension against a mocked vscode API and
// in-memory .aot documents, then print the diagnostics it publishes and
// check the crosslink decorations and go-to-definition.
const fs = require("fs");
const path = require("path");
const Module = require("module");

// every check here prints PASS or UNEXPECTED; an UNEXPECTED fails the run,
// so the chain in `npm test` stops on it rather than scrolling past
const printLine = console.log;
console.log = (...args) => {
  if (typeof args[0] === "string" && args[0].startsWith("UNEXPECTED")) process.exitCode = 1;
  printLine(...args);
};

const published = new Map();
// every collection but the linter's "aot" publishes into its own map, so the
// Python findings ("aot-python") never overwrite the linter's
const publishedByName = new Map();
const registeredCommands = new Map();
let pythonCompletionProvider = null; // the '=' / '.' completion inside Python
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
let symbolProvider = null;          // the outline, which sticky scroll reads
const plainCommands = new Map();
const configStore = {};
const vscode = {
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
  MarkdownString: class { constructor() { this.value = ""; } appendMarkdown(s) { this.value += s; return this; } },
  Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
  CodeAction: class { constructor(title, kind) { Object.assign(this, { title, kind }); } },
  CodeActionKind: { QuickFix: "quickfix", RefactorRewrite: "refactor.rewrite" },
  SymbolKind: { Class: 4, Property: 6, Field: 7, Constant: 13, Variable: 12 },
  DocumentSymbol: class {
    constructor(name, detail, kind, range, selectionRange) {
      Object.assign(this, { name, detail, kind, range, selectionRange, children: [] });
    }
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
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
  DiagnosticRelatedInformation: class { constructor(location, message) { Object.assign(this, { location, message }); } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  languages: {
    createDiagnosticCollection: (name) => {
      const store = name === "aot" || !name ? published
        : (publishedByName.get(name) || publishedByName.set(name, new Map()).get(name));
      return {
        set: (uri, diags) => store.set(uri.toString(), diags),
        get: (uri) => store.get(uri.toString()),
        delete: (uri) => store.delete(uri.toString()),
        dispose: () => {},
      };
    },
    registerDefinitionProvider: (selector, provider) => { definitionProvider = provider; return { dispose() {} }; },
    registerHoverProvider: (selector, provider) => { hoverProvider = provider; return { dispose() {} }; },
    registerCodeActionsProvider: (selector, provider) => { codeActionsProvider = provider; return { dispose() {} }; },
    registerDocumentFormattingEditProvider: (selector, provider) => { formattingProvider = provider; return { dispose() {} }; },
    registerDocumentSemanticTokensProvider: (selector, provider) => { semanticProvider = provider; return { dispose() {} }; },
    registerDocumentSymbolProvider: (selector, provider) => { symbolProvider = provider; return { dispose() {} }; },
    registerReferenceProvider: (selector, provider) => { referenceProvider = provider; return { dispose() {} }; },
    registerRenameProvider: (selector, provider) => { renameProvider = provider; return { dispose() {} }; },
    registerInlayHintsProvider: (selector, provider) => { inlayProvider = provider; return { dispose() {} }; },
    registerDocumentLinkProvider: (selector, provider) => { documentLinkProvider = provider; return { dispose() {} }; },
    registerCompletionItemProvider: (selector, provider, ...triggers) => {
      // two are registered: the '@' reference completion and, with no trigger
      // character, the value completion
      if (triggers.includes("@")) completionProvider = provider;
      else if (triggers.includes("=")) pythonCompletionProvider = provider;
      else valueCompletionProvider = provider;
      return { dispose() {} };
    },
  },
  CompletionItem: class { constructor(label, kind) { Object.assign(this, { label, kind }); } },
  CompletionItemKind: { Field: 4, EnumMember: 19, Function: 2, Module: 8 },
  DocumentLink: class { constructor(range, target) { Object.assign(this, { range, target }); } },
  Uri: {
    parse: (s) => ({ toString: () => s }),
    file: (p) => {
      const u = { fsPath: p, scheme: "file", toString: () => "file:///" + p.replace(/\\/g, "/") };
      u.with = (change) => Object.assign({}, u, change);
      return u;
    },
  },
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
  Selection: class {
    constructor(...a) {
      this.a = a;
      const [sl, sc, el = sl, ec = sc] = a;
      this.anchor = { line: sl, character: sc };
      this.active = { line: el, character: ec };
      this.start = { line: Math.min(sl, el), character: sl <= el ? sc : ec };
      this.end = { line: Math.max(sl, el), character: sl <= el ? ec : sc };
      this.isEmpty = sl === el && sc === ec;
      this.isSingleLine = sl === el;
    }
  },
  EndOfLine: { LF: 1, CRLF: 2 },
  DecorationRangeBehavior: { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 },
  commands: {
    registerTextEditorCommand: (id, fn) => { registeredCommands.set(id, fn); return { dispose() {} }; },
    registerCommand: (id, fn) => { plainCommands.set(id, fn); return { dispose() {} }; },
    executeCommand: (...a) => { vscode.commands._calls.push(a); },
    _calls: [],
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
    // the answer a test sets is the button the user "presses"; the items
    // offered are recorded beside the message
    showWarningMessage: (m, ...items) => {
      vscode.window._warnings.push(m);
      vscode.window._warningItems = items.filter((i) => typeof i === "string");
      return Promise.resolve(vscode.window._warningAnswer);
    },
    showInformationMessage: (m) => { vscode.window._info.push(m); return Promise.resolve(); },
    showErrorMessage: (m) => { vscode.window._errors.push(m); return Promise.resolve(); },
    setStatusBarMessage: (m) => { vscode.window._status = m; return { dispose() {} }; },
    createStatusBarItem: () => {
      const item = { text: "", tooltip: "", shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} };
      vscode.window._statusItem = item;
      return item;
    },
  },
  WorkspaceEdit: class {
    constructor() { this.ops = []; }
    replace(uri, range, text) { this.ops.push({ type: "replace", uri, range, text }); }
    insert(uri, pos, text) { this.ops.push({ type: "insert", uri, pos, text }); }
  },
  workspace: {
    textDocuments: [],
    isTrusted: true, // a test flips it to see the Python gate close
    workspaceFolders: undefined, // set per-test when a workspace root is needed
    getWorkspaceFolder: () => (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) || null,
    onDidOpenTextDocument: (fn) => { vscode.workspace._open = fn; return { dispose() {} }; },
    onDidChangeTextDocument: (fn) => { vscode.workspace._changed = fn; return { dispose() {} }; },
    onDidCloseTextDocument: (fn) => { vscode.workspace._close = fn; return { dispose() {} }; },
    onDidSaveTextDocument: (fn) => { vscode.workspace._save = fn; return { dispose() {} }; },
    onWillSaveTextDocument: (fn) => { vscode.workspace._willSave = fn; return { dispose() {} }; },
    onDidChangeConfiguration: (fn) => { vscode.workspace._configChanged = fn; return { dispose() {} }; },
    // three watchers live in aot.files or beside it: the CSV mirror, the
    // .formulas stores, and the .aot files themselves. They are told apart
    // by their glob, so one never takes another's handlers.
    createFileSystemWatcher: (glob) => {
      const slot = /\.formulas/.test(glob || "") ? "_park"
        : /aot\.files/.test(glob || "") ? "_csv"
        : /\.py$/.test(glob || "") ? "_py"
        : "_aot";
      return {
        onDidChange: (fn) => { vscode.workspace[slot + "Changed"] = fn; },
        onDidCreate: (fn) => { vscode.workspace[slot + "Created"] = fn; },
        onDidDelete: (fn) => { vscode.workspace[slot + "Deleted"] = fn; },
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
    // the bins differ by name, so they are four bins; the clash is one
    // Example written twice, name and all
    "Left",
    "    - Twin",
    "        mood: calm",
    "Right",
    "    - Twin",
    "        mood: calm",
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

  // default-is-a-Example: a value only links when it names an Example of the
  // Concept its attribute is typed by. An Example listed beneath an attribute
  // is that frame's own vocabulary, not a Concept's, so no value reaches it:
  // neither 'interval count: 1' nor a second 'maximum number of elements: 1'
  // elsewhere may name the '- 1' filed under Length's attribute.
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
  console.log(!valueLinks.length
    ? "PASS (default-is-a-Example: an Example of an attribute is not a value any attribute may name)"
    : "UNEXPECTED default-is-a-Example value linking "
      + JSON.stringify(valueLinks.map((l) => [l.line, l.text])));

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
    "    name    |alias",
    "    Socrates|Paul",
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
  const jamesOk = james && james.line === 12 && james.concept.name === "Person"
    && james.startCol === text.split("\n")[11].indexOf("James")
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
    "    name | measurement operation",
    "    Speed | Ratio",
  ].join("\n");
  const t = lint(table, "World");
  const links = resolve(table, t.root, t.nodes);
  const headerLink = links.find((l) => l.connection === "attribute-is-a-Concept" && l.line === 4);
  const cellLink = links.find((l) => l.connection === "default-is-a-Example" && l.line === 5);
  const headerOk = headerLink && headerLink.startCol === 11 && headerLink.target.line === 1;
  const cellOk = cellLink && cellLink.startCol === 12 && cellLink.text === "Ratio" && cellLink.target.line === 2;
  console.log(headerOk && cellOk
    ? "PASS (table: header cell links to its Concept, value cell to its Example)"
    : "UNEXPECTED table crosslinks");

  // an (alias) on the column types every cell under it, exactly as it does
  // in the line form: `beneficiary (person)` writes out as
  // `beneficiary (person): Socrates`, so the cell links to the Person
  const aliased = [
    "Person",
    "    - Socrates",
    "Known For",
    "    Known For | beneficiary (person)",
    "    Ethics | Socrates",
  ].join("\n");
  const a = lint(aliased, "World");
  const aLinks = resolve(aliased, a.root, a.nodes);
  const aCell = aLinks.find((l) => l.connection === "default-is-a-Example" && l.line === 5);
  console.log(aCell && aCell.text === "Socrates" && aCell.target.line === 2
    ? "PASS (table: a cell of an aliased column links through the alias' Concept)"
    : "UNEXPECTED aliased-column cell crosslink " + JSON.stringify(aCell || null));

  const doc3 = makeDoc("c:\repo\World.aot", table);
  const edits = formattingProvider.provideDocumentFormattingEdits(doc3);
  const aligned = edits.some((e) => e.text === "    Speed|Ratio");
  console.log(aligned && edits.length === 2
    ? "PASS (table: Format Document aligns the columns)"
    : "UNEXPECTED table formatting " + JSON.stringify(edits));
}

// 4b) the aot.addExample command: the lightbulb on an unlisted value lists
// it under its Concept, in the form that Concept is already written in. The
// cursor is left where the Fix was invoked (the editor's own selection
// tracking rides it through the edit); the status bar names the landed line.
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
  const cursorKept = editor.selection.active.line === 4 && editor.selection.active.character === 0;
  const told = vscode.window._status === "AOT: '5' listed as an Example of 'Integer' (line 4)";
  console.log(landed && cursorKept && told
    ? "PASS (addExample command: the value is listed under its Concept, cursor kept at the usage)"
    : "UNEXPECTED addExample " + JSON.stringify({ lines, sel: editor.selection.a, status: vscode.window._status }));
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

  // a value still naming the outside path — another file citing the same
  // evidence, never lightbulbed — Ctrl+clicks through to the copy now in
  // aot.files, and the hover names the same target the click opens
  const citingOutside = makeDoc(path.join(wsRoot, "Cites.aot"),
    ["Study", "    evidence: " + source.replace(/\\/g, "/")].join("\n"));
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: wsRoot } }];
  const outsideLinks = documentLinkProvider.provideDocumentLinks(citingOutside);
  const repointed = outsideLinks.find((l) => l.target.scheme === "file");
  const hover = await hoverProvider.provideHover(citingOutside, new vscode.Position(1, 20));
  vscode.workspace.workspaceFolders = folders;
  console.log(repointed && repointed.target.fsPath === copied
    && hover && hover.contents.value.includes(copied)
    ? "PASS (copy file: a value still naming the outside path clicks and hovers through to the aot.files copy)"
    : "UNEXPECTED repoint " + JSON.stringify({
      target: repointed && repointed.target.fsPath, hover: hover && hover.contents.value }));

  // a CSV a value points at is claimed, not an orphan: no table writes
  // 'evidence.csv', but the model cites it, so the save must leave it be —
  // archiving it would break the very link that names it. 'stray.csv',
  // which nothing speaks for, is archived as before.
  const filesDir = path.join(wsRoot, "aot.files");
  fs.writeFileSync(path.join(filesDir, "evidence.csv"), "a,b\n1,2\n");
  fs.writeFileSync(path.join(filesDir, "stray.csv"), "a,b\n3,4\n");
  const citing = ["Study", "    source: aot.files/evidence.csv", "    Otter", "        name", "        Ollie"].join("\n");
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
    "    name | size",
    "    Ollie | 5",
  ].join("\n");
  const doc4 = makeDoc("c:\repo\World.aot", text);
  doc4.eol = vscode.EndOfLine.LF;
  let applied = null;
  const editor = {
    document: doc4,
    selection: new vscode.Selection(2, 7, 2, 7), // inside 'Ollie'
    edit: (cb) => { cb({ replace: (range, t) => { applied = { range, t }; } }); return Promise.resolve(true); },
    revealRange: () => {},
  };
  registeredCommands.get("aot.table.nextCell")(editor);
  Promise.resolve().then(() => {
    const ok = applied
      && applied.t.split("\n")[1] === "    Ollie|5"
      && editor.selection.active.line === 2 && editor.selection.active.character === 10;
    // 52 table and derivation commands (AutoSum went with the formula
    // language), plus Ctrl+Enter's run and its fresh twin
    console.log(ok && registeredCommands.size === 54
      ? "PASS (table editor: 54 commands; Tab aligns and moves to the next cell)"
      : "UNEXPECTED table editor " + JSON.stringify({ n: registeredCommands.size, applied, sel: editor.selection.a }));
  });
}

// 5b) Tab travels the cells from ANYWHERE in a row — the leading spaces and
// the head of a nested row's name included. It re-indents nothing: a row's
// depth is its own leading spaces, and a key that moved them would move an
// Example's place in the tree when all that was asked for was the next cell
// (and would do nothing at all on a row with no sibling to nest under).
// Lines *selected* are the indent edit, as everywhere else in the editor.
(async () => {
  const lines = [
    "Otter",
    "    name   |size",
    "    Ollie  |5",
    "        Pup|1",
  ];
  const doc = {
    languageId: "aot", fileName: "c:\\repo\\World.aot", eol: vscode.EndOfLine.LF,
    uri: { toString: () => "file:///indent" },
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  const written = lines.join("\n");
  const editor = {
    document: doc,
    // the head of the nested row's name: its own indent, which is its depth
    selection: new vscode.Selection(3, 4, 3, 4),
    edit: (cb) => {
      cb({ replace: (range, t) => { const [sl, , el] = range.a; lines.splice(sl, el - sl + 1, ...t.split("\n")); } });
      return Promise.resolve(true);
    },
    revealRange: () => {},
    setDecorations: () => {},
  };
  registeredCommands.get("aot.table.nextCell")(editor);
  await new Promise((r) => setImmediate(r));
  // nothing moved but the cursor, which is now in the value cell
  const kept = lines.join("\n") === written;
  const toValue = editor.selection.active.line === 3 && editor.selection.active.character === 12;
  registeredCommands.get("aot.table.prevCell")(editor);
  await new Promise((r) => setImmediate(r));
  const back = lines.join("\n") === written
    && editor.selection.active.line === 3 && editor.selection.active.character === 4;
  // lines selected: the editor's own indent, which is how a row is nested
  // and how a whole table is re-filed
  editor.selection = new vscode.Selection(2, 0, 3, 0);
  vscode.commands._calls.length = 0;
  registeredCommands.get("aot.table.nextCell")(editor);
  await new Promise((r) => setImmediate(r));
  const indents = lines.join("\n") === written
    && vscode.commands._calls.some((c) => c[0] === "editor.action.indentLines");
  console.log(kept && toValue && back && indents
    ? "PASS (table editor: Tab travels the cells and re-indents nothing; a selection indents)"
    : "UNEXPECTED table indent " + JSON.stringify({ lines, kept, toValue, back, indents, sel: editor.selection.a }));
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

  // at the top level nothing names the Concept, so the first header cell is
  // left empty and the cursor waits there to name it (1.9: the first header
  // cell *is* the Concept)
  const grow = ["Otter", "|"];
  const { doc: docG, editor: edG } = makeLive(grow, "Grow.aot");
  typedPipe(docG, 1);
  await new Promise((r) => setImmediate(r));
  const grown = grow.join("\n") === ["Otter", " |", " |"].join("\n");
  const cursorOk = edG.selection.active.line === 1 && edG.selection.active.character === 0;
  console.log(grown && cursorOk
    ? "PASS (scaffold: a top-level '|' grows the skeleton, cursor in the header to name the Concept)"
    : "UNEXPECTED scaffold " + JSON.stringify({ grow, sel: edG.selection.a }));

  // typed *under* a Concept the first cell arrives already naming it, and
  // the cursor lands in the data row to start listing Examples
  const under = ["Otter", "    |"];
  const { doc: docU, editor: edU } = makeLive(under, "Under.aot");
  typedPipe(docU, 1);
  await new Promise((r) => setImmediate(r));
  const named = under.join("\n") === ["Otter", "    Otter|", "         |"].join("\n");
  console.log(named && edU.selection.active.line === 2 && edU.selection.active.character === 4
    ? "PASS (scaffold: under a Concept the header cell names it, cursor in the data row)"
    : "UNEXPECTED scaffold under a Concept " + JSON.stringify({ under, sel: edU.selection.a }));

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
    "        Otter|legs|habitat",
    "             |    |",
  ].join("\n");
  console.log(inherited
    ? "PASS (scaffold: inherited attributes pre-fill the header, the parent's own stay out)"
    : "UNEXPECTED scaffold columns " + JSON.stringify(nested.slice(5)));

  const beside = ["a|b", "|"];
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
    "    name | size (length) | colour",
    "    Ollie | 5 | brown",
  ].join("\n");
  const doc5 = makeDoc("c:\repo\World.aot", text);
  const { tokens } = semanticProvider.provideDocumentSemanticTokens(doc5);
  const has = (t) => tokens.some((x) => x.join(",") === t.join(","));
  const tokensOk = has([2, 11, 4, 0])   // header 'size' as attribute
    && has([2, 17, 6, 0])               // header alias 'length' as attribute
    && has([2, 27, 6, 0])               // header 'colour' as attribute
    && has([3, 4, 5, 1])                // name cell 'Ollie' as Example
    && has([3, 12, 1, 2])               // value cell '5' as value
    && has([3, 16, 5, 2]);              // value cell 'brown' as value
  console.log(tokensOk
    ? "PASS (table: cells coloured as attribute / Example / value)"
    : "UNEXPECTED semantic tokens " + JSON.stringify(tokens));

  const t6 = lint(text, "World");
  const aliasLink = resolve(text, t6.root, t6.nodes).find((l) =>
    l.connection === "attribute-is-a-Concept" && l.line === 3 && l.text === "length");
  console.log(aliasLink && aliasLink.startCol === 17 && aliasLink.target.name === "Length"
    ? "PASS (table: a header cell's alias crosslinks to its Concept)"
    : "UNEXPECTED header alias link " + JSON.stringify(aliasLink));
}

// 7) the CSV mirror, end to end: saving the .aot writes each table's CSV
// into one 'aot.files' folder at the repository root, named after the
// Concept; a CSV edit folds back; legacy per-file folders migrate; an
// orphaned CSV is archived with '_' (never deleted).
(async () => {
  const tmp = path.join(__dirname, "tmp-sync");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  // the fixture is a repository of its own: 'aot.files' hangs off the root
  // the '.git' marks, and without one the walk would climb out of the
  // fixture and into the repository this test file itself lives in
  fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  const aotPath = path.join(tmp, "World.aot");
  const aotText = [
    "Otter",
    "    Otter | size",
    "    Ollie | 5",
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
  console.log(written === "Otter,size\nOllie,5\n"
    ? "PASS (csv mirror: saving writes aot.files/<Concept>.csv at the workspace root)"
    : "UNEXPECTED csv written: " + JSON.stringify(written));
  console.log(!fs.existsSync(legacyDir) && !fs.existsSync(path.join(dir, "Ghost.csv"))
    && fs.existsSync(path.join(dir, "_Ghost.csv"))
    ? "PASS (csv mirror: the legacy folder folds in; an orphan is archived _Ghost.csv, not deleted)"
    : "UNEXPECTED migration state " + JSON.stringify(fs.existsSync(dir) && fs.readdirSync(dir)));

  // edit the CSV -> the owning .aot's table gains the row, aligned, and saves
  fs.writeFileSync(csvPath, "Otter,size\nOllie,5\nPebble,3\n");
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  const after = fs.readFileSync(aotPath, "utf8").split(/\r?\n/);
  console.log(after[2] === "    Ollie |5" && after[3] === "    Pebble|3"
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
  const renamed = aotText.replace(/Otter/g, "Beaver"); // the Concept line and the header cell that names it
  fs.writeFileSync(aotPath, renamed);
  vscode.workspace._save(makeDoc(aotPath, renamed));
  console.log(fs.existsSync(path.join(dir, "Beaver.csv")) && !fs.existsSync(csvPath) && fs.existsSync(path.join(dir, "_Otter.csv"))
    ? "PASS (csv mirror: a renamed Concept's old CSV is archived _Otter.csv on save)"
    : "UNEXPECTED rename cleanup " + JSON.stringify(fs.readdirSync(dir)));
  vscode.workspace.workspaceFolders = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
})();

// 7a) one 'aot.files' per repository. The folder hangs off the repository
// root - the nearest '.git' above the file - so a subfolder opened on its
// own, and a file opened with no folder at all, both write to the one
// place. An 'aot.files' an older release left elsewhere folds into it on
// the next save, everything in it and not the CSVs alone; a name already
// taken at the destination is never overwritten, and its folder stays.
(async () => {
  const os = require("os");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "aot-onefolder-"));
  fs.mkdirSync(path.join(repo, ".git"));
  const sub = path.join(repo, "sub");
  fs.mkdirSync(sub);

  // what the old rule left at the opened folder: a CSV, a parked
  // store, a copied-in file, and one name the repository already has
  const stray = path.join(sub, "aot.files");
  fs.mkdirSync(stray);
  fs.writeFileSync(path.join(stray, "Ghost.csv"), "name\nBoo\n");
  fs.writeFileSync(path.join(stray, "Deep.formulas"), "@Otter@size@Ollie\t=1+4\n");
  fs.writeFileSync(path.join(stray, "note.txt"), "the stray copy");
  const dir = path.join(repo, "aot.files");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "note.txt"), "the repo's own");

  const aotPath = path.join(sub, "Deep.aot");
  const aotText = ["Otter", "    Otter | size", "    Ollie | 5"].join("\n");
  fs.writeFileSync(aotPath, aotText);

  // the workspace is the subfolder, so the old rule would have written here
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: sub } }];
  vscode.workspace._save(makeDoc(aotPath, aotText));

  console.log(fs.existsSync(path.join(dir, "Otter.csv")) && !fs.existsSync(path.join(stray, "Otter.csv"))
    ? "PASS (one folder: the CSV lands at the repository root, not at the opened subfolder)"
    : "UNEXPECTED mirror location " + JSON.stringify(fs.readdirSync(repo)));

  // folded in whole, and the CSV no Concept claims archived as the orphan
  // it is, in the same save
  const moved = fs.existsSync(path.join(dir, "Deep.formulas"))
    && !fs.existsSync(path.join(stray, "Deep.formulas"))
    && fs.existsSync(path.join(dir, "_Ghost.csv"));
  console.log(moved
    ? "PASS (one folder: a stray aot.files folds in whole - the store and the orphan CSV with it)"
    : "UNEXPECTED stray fold " + JSON.stringify({ repo: fs.readdirSync(dir), stray: fs.readdirSync(stray) }));

  console.log(fs.readFileSync(path.join(dir, "note.txt"), "utf8") === "the repo's own"
    && fs.readFileSync(path.join(stray, "note.txt"), "utf8") === "the stray copy"
    && fs.readdirSync(stray).length === 1
    ? "PASS (one folder: a name already taken is never overwritten, and its folder stays)"
    : "UNEXPECTED overwrite " + JSON.stringify(fs.readdirSync(stray)));

  // the clash resolved by hand: the next save takes the last file, and the
  // emptied folder goes with it
  fs.unlinkSync(path.join(stray, "note.txt"));
  vscode.workspace._save(makeDoc(aotPath, aotText));
  console.log(!fs.existsSync(stray)
    ? "PASS (one folder: the emptied stray folder is removed)"
    : "UNEXPECTED stray survives " + JSON.stringify(fs.readdirSync(stray)));

  // a file opened on its own, no folder in sight: still the repository's
  // folder, never a second one beside the file
  vscode.workspace.workspaceFolders = undefined;
  const lone = path.join(repo, "deeper");
  fs.mkdirSync(lone);
  const lonePath = path.join(lone, "Lone.aot");
  const loneText = ["Beaver", "    Beaver | size", "    Bucky  | 9"].join("\n");
  fs.writeFileSync(lonePath, loneText);
  vscode.workspace._save(makeDoc(lonePath, loneText));
  console.log(fs.existsSync(path.join(dir, "Beaver.csv")) && !fs.existsSync(path.join(lone, "aot.files"))
    ? "PASS (one folder: a lone file with no workspace still writes to its repository's folder)"
    : "UNEXPECTED lone-file location " + JSON.stringify(fs.readdirSync(lone)));

  fs.rmSync(repo, { recursive: true, force: true });
})();

// 6d) the catch-up. The fold-back watcher only hears a CSV edited while the
// editor is running, so a file changed in Excel with the window closed
// would be overwritten, unread, by the next save of its .aot. On activation
// — and from 'aot.importCsvFiles' by hand — the folder is caught up: every
// CSV saying something its .aot does not folds in, an unchanged one costs
// nothing, and an archived '_' file is left alone exactly as the watcher
// leaves it. The command is given its root, so this holds no global and
// races with nothing else here.
(async () => {
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aot-catchup-"));
  const dir = path.join(root, "aot.files");
  fs.mkdirSync(dir);
  const aotPath = path.join(root, "Numbers.aot");
  fs.writeFileSync(aotPath, ["Integer", "    - 1", "        is prime: Yes"].join("\n"));
  const importCsvs = () => plainCommands.get("aot.importCsvFiles")(root);

  // the editor was closed for this edit: no watcher heard it
  fs.writeFileSync(path.join(dir, "Integer.csv"), "Integer,is prime\n1,Yes\n7,Yes\n");
  const folded = await importCsvs();
  const after = fs.readFileSync(aotPath, "utf8").split(/\r?\n/);
  console.log(folded === 1 && after[3] === "    - 7" && after[4] === "        is prime: Yes"
    ? "PASS (csv catch-up: a CSV edited with the editor closed folds in on the import)"
    : "UNEXPECTED catch-up fold " + JSON.stringify({ folded, after }));

  // and again changes nothing: the CSV now says what the .aot says, so an
  // ordinary launch does no work at all
  const settled = fs.readFileSync(aotPath, "utf8");
  const again = await importCsvs();
  console.log(again === 0 && fs.readFileSync(aotPath, "utf8") === settled
    ? "PASS (csv catch-up: a folder already in step folds nothing — a launch is a no-op)"
    : "UNEXPECTED catch-up not idempotent " + JSON.stringify({ again }));

  // an archived orphan is never folded back, on the import as on the watcher
  fs.writeFileSync(path.join(dir, "_Ghost.csv"), "Integer,is prime\n99,No\n");
  const withGhost = await importCsvs();
  console.log(withGhost === 0 && fs.readFileSync(aotPath, "utf8") === settled
    ? "PASS (csv catch-up: an archived _CSV is skipped by the import too)"
    : "UNEXPECTED catch-up folded an archive " + JSON.stringify({ withGhost }));

  // what Excel writes is read as what it means: a BOM in front of the
  // Concept's own cell, and CRLF throughout, is the same grid
  fs.writeFileSync(path.join(dir, "Integer.csv"), "\uFEFFInteger,is prime\r\n1,Yes\r\n7,Yes\r\n13,Yes\r\n");
  const fromExcel = await importCsvs();
  const excelAfter = fs.readFileSync(aotPath, "utf8").split(/\r?\n/);
  console.log(fromExcel === 1 && excelAfter[5] === "    - 13" && excelAfter[6] === "        is prime: Yes"
    ? "PASS (csv catch-up: a BOM'd CRLF file from Excel folds in as the grid it is)"
    : "UNEXPECTED excel catch-up " + JSON.stringify({ fromExcel, excelAfter }));

  // a semicolon file, which is all Excel writes where the comma is the
  // decimal mark, folds in exactly as a comma one does
  fs.writeFileSync(path.join(dir, "Integer.csv"), "Integer;is prime\n1;Yes\n7;Yes\n13;Yes\n21;No\n");
  const semi = await importCsvs();
  const semiAfter = fs.readFileSync(aotPath, "utf8").split(/\r?\n/);
  console.log(semi === 1 && semiAfter[7] === "    - 21" && semiAfter[8] === "        is prime: No"
    ? "PASS (csv catch-up: a semicolon-delimited file from Excel folds in too)"
    : "UNEXPECTED semicolon catch-up " + JSON.stringify({ semi, semiAfter }));

  fs.rmSync(root, { recursive: true, force: true });
})();


// 6c) the mirror reaches line-form Concepts too, exactly as it does
// tables: the first save writes the CSV unbidden — a Concept listing bare
// names included, just as a one-column table of names would write. A CSV
// of the Concept's name folds its rows in as Examples (line form kept).
(async () => {
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aot-lineform-"));
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
  const dir = path.join(root, "aot.files");
  fs.mkdirSync(dir);
  const aotPath = path.join(root, "Numbers.aot");
  const aotText = ["Integer", "    - 1", "        is prime: Yes", "    - 35", "        is prime: No"].join("\n");
  fs.writeFileSync(aotPath, aotText);

  // no CSV yet, but the Examples carry values: the first save mirrors out
  vscode.workspace._save(makeDoc(aotPath, aotText));
  let written; try { written = fs.readFileSync(path.join(dir, "Integer.csv"), "utf8"); } catch { written = null; }
  console.log(written === "Integer,is prime\n1,Yes\n35,No\n"
    ? "PASS (csv mirror: a line-form Concept with attribute values mirrors out unbidden)"
    : "UNEXPECTED line-form mirror " + JSON.stringify({ written }));

  // bare names are Examples all the same: a name-only Concept mirrors out
  // on its first save, exactly as a one-column table of names would
  const namesPath = path.join(root, "Colours.aot");
  const namesText = ["Colour", "    - Red", "    - Blue"].join("\n");
  fs.writeFileSync(namesPath, namesText);
  vscode.workspace._save(makeDoc(namesPath, namesText));
  let colours; try { colours = fs.readFileSync(path.join(dir, "Colour.csv"), "utf8"); } catch { colours = null; }
  console.log(colours === "Colour\nRed\nBlue\n"
    ? "PASS (csv mirror: a name-only line-form Concept mirrors out unbidden, as a table would)"
    : "UNEXPECTED name-only mirror " + JSON.stringify({ colours }));

  // and back: a new row folds in as a '- Example', line form kept
  fs.writeFileSync(path.join(dir, "Integer.csv"), "Integer,is prime\n1,Yes\n35,No\n7,Yes\n");
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

// 6e) the same dropdown inside a table cell: a column typed by a Concept
// offers that Concept's Examples; the name column and the header row offer
// nothing (they declare, they don't value)
{
  const text = [
    "Person",
    "    - Socrates",
    "Trip",
    "    name|person",
    "    T1  |",
  ].join("\n");
  const doc = makeDoc("c:\\repo\\Cells.aot", text);
  const inCell = valueCompletionProvider.provideCompletionItems(doc, new vscode.Position(4, 9));
  const labels = (inCell || []).map((i) => i.label);
  console.log(labels.join(",") === "Socrates"
    ? "PASS (value completion: a Concept-typed column's cell offers the Concept's Examples)"
    : "UNEXPECTED table-cell completion " + JSON.stringify(labels));
  const inName = valueCompletionProvider.provideCompletionItems(doc, new vscode.Position(4, 5));
  const inHeader = valueCompletionProvider.provideCompletionItems(doc, new vscode.Position(3, 10));
  console.log((inName || []).length === 0 && (inHeader || []).length === 0
    ? "PASS (value completion: the name column and the header row are offered nothing)"
    : "UNEXPECTED name/header completion " + JSON.stringify([inName, inHeader]));
}

// 6f) numbered Examples renumber on Format Document (and the same edits
// ride every save): the first `N. ` opts the list in, stale and missing
// numbers correct in listed order, and a same-file reference to a renamed
// Example follows through the rename engine
{
  const text = [
    "Recipe",
    "    - 1. Mix",
    "    - Bake",
    "    - 4. Serve",
    "Note",
    "    recipe: 4. Serve",
  ].join("\n");
  const doc = makeDoc("c:\\repo\\Steps.aot", text);
  const edits = formattingProvider.provideDocumentFormattingEdits(doc);
  const byLine = new Map(edits.map((e) => [e.range.a[0], e.text]));
  console.log(byLine.get(2) === "    - 2. Bake"
    && byLine.get(3) === "    - 3. Serve"
    && byLine.get(5) === "    recipe: 3. Serve"
    ? "PASS (renumber: Format Document renumbers the list and its references)"
    : "UNEXPECTED renumber edits " + JSON.stringify(edits));

  // an unnumbered list is not opted in: formatting leaves it alone
  const plain = makeDoc("c:\\repo\\Plain.aot", ["Recipe", "    - Mix", "    - Bake"].join("\n"));
  console.log((formattingProvider.provideDocumentFormattingEdits(plain) || []).length === 0
    ? "PASS (renumber: an unnumbered list is left exactly as written)"
    : "UNEXPECTED renumber of an unnumbered list");
}

// 6g) Concept numbering: one `1. ` numbers every Concept on format — the
// top level `N. `, sub-Concepts dotted — and an attribute still types by
// the numbered Concept, because resolution strips the prefix
{
  const text = [
    "1. Trip",
    "    Day Trip",
    "    - Weekend",
    "Note",
    "    trip: Weekend",
  ].join("\n");
  const doc = makeDoc("c:\\repo\\NumberedConcepts.aot", text);
  const edits = formattingProvider.provideDocumentFormattingEdits(doc);
  const byLine = new Map(edits.map((e) => [e.range.a[0], e.text]));
  console.log(byLine.get(1) === "    1.1 Day Trip" && byLine.get(3) === "2. Note"
    ? "PASS (concept numbering: '1. ' numbers the scope, dotted down the is-a chain)"
    : "UNEXPECTED concept numbering " + JSON.stringify(edits));

  const t = lint(text, "NumberedConcepts");
  const links = resolve(text, t.root, t.nodes);
  const typed = links.find((l) => l.connection === "attribute-is-a-Concept" && l.line === 5);
  const value = links.find((l) => l.connection === "default-is-a-Example" && l.line === 5);
  console.log(typed && typed.target.name === "1. Trip" && value && value.target.name === "Weekend"
    ? "PASS (concept numbering: 'trip' still types by '1. Trip' — the prefix is presentation)"
    : "UNEXPECTED numbered crosslinks " + JSON.stringify(links.map((l) => [l.connection, l.line])));
}

// 7b) cross-file: a crosslink whose target lives in another repo file
// resolves and its go-to-definition opens that file; a Concept written in
// two files is one idea in two places and reports nothing (1.10 — every
// occurrence is a peer, and no file owns a Concept).
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

  // 'Human' is written in both People.aot and Census.aot — two peers, not a
  // duplicate: nothing is reported about the repeat itself
  const bDiags = published.get(docB.uri.toString()) || [];
  console.log(!bDiags.some((d) => /also defined in|defined twice|duplicate/i.test(d.message))
    ? "PASS (cross-file: a Concept written in two files is one idea, and reports nothing)"
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

// 7d) two names for one idea: an advisory warning with a lightbulb on each
// of the two ways out, and a dismissal that is remembered.
{
  const twain = ["Client", "    - Acme", "Customer", "    - Globex"].join("\n");
  const docS = makeDoc("c:\repo\Twain.aot", twain);
  vscode.workspace._open(docS);
  const sDiags = published.get(docS.uri.toString()) || [];
  const synonym = sDiags.find((d) => /'Client' and 'Customer'.*two words for one idea/.test(d.message));
  console.log(synonym && synonym.severity === vscode.DiagnosticSeverity.Warning
    ? "PASS (synonyms: two words for one idea warn, advisory and never in V)"
    : "UNEXPECTED synonym diagnostics " + JSON.stringify(sDiags.map((d) => d.message)));
  console.log(sDiags.filter((d) => /two words for one idea/.test(d.message)).length === 2
    ? "PASS (synonyms: the pair reports at both of its places)"
    : "UNEXPECTED synonym sides " + sDiags.filter((d) => /two words for one idea/.test(d.message)).length);

  const fixes = codeActionsProvider.provideCodeActions(docS, synonym.range, { diagnostics: [synonym] });
  const rename = fixes.find((f) => /^Rename '/.test(f.title));
  const keep = fixes.find((f) => /different ideas/.test(f.title));
  console.log(rename && rename.isPreferred && rename.command.command === "aot.renameConcept"
    && keep && keep.command.command === "aot.acceptDistinct"
    ? "PASS (synonyms: the lightbulb offers the rename first, and the dismissal beside it)"
    : "UNEXPECTED synonym fixes " + JSON.stringify(fixes.map((f) => f.title)));

  // dismissing the pair clears it, whichever order it is written in
  configStore.distinctConcepts = ["Customer|Client"];
  vscode.workspace._open(docS);
  const after = published.get(docS.uri.toString()) || [];
  console.log(!after.some((d) => /two words for one idea/.test(d.message))
    ? "PASS (synonyms: a pair declared distinct is never raised again, in either order)"
    : "UNEXPECTED synonym after dismissal " + JSON.stringify(after.map((d) => d.message)));
  delete configStore.distinctConcepts;

  // and the lightbulb's own command writes exactly that entry
  plainCommands.get("aot.acceptDistinct")("Customer", "Client");
  console.log(JSON.stringify(configStore.distinctConcepts) === JSON.stringify(["client|customer"])
    ? "PASS (synonyms: the dismissal is stored order-free and case-free)"
    : "UNEXPECTED distinctConcepts " + JSON.stringify(configStore.distinctConcepts));
  delete configStore.distinctConcepts;
}

// 7d2) an Example's name is part of what it is: two ledger rows carrying
// the same values are two payments, not a clash. And the flip between a
// table and free text is on the lightbulb, no chord needed.
{
  const text = ["Payment|amount|payee", "P1     |100   |Shop", "P2     |100   |Shop"].join("\n");
  const doc = makeDoc("c:\\repo\\Books.aot", text);
  vscode.workspace._open(doc);
  const diags = published.get(doc.uri.toString()) || [];
  console.log(!diags.some((d) => /^clash: /.test(d.message))
    ? "PASS (name identity: differently named Examples with one content do not clash)"
    : "UNEXPECTED ledger clash " + JSON.stringify(diags.map((d) => d.message)));
  const flip = codeActionsProvider.provideCodeActions(doc, new vscode.Range(1, 2, 1, 2), { diagnostics: [] })
    .find((f) => f.command && f.command.command === "aot.toggleTableForm");
  console.log(flip && /Flip 'Payment' between table and free text/.test(flip.title) && flip.kind === "refactor.rewrite"
    ? "PASS (flip: the lightbulb offers the flip, no chord needed)"
    : "UNEXPECTED flip action " + JSON.stringify(flip && flip.title));
}

// 7d3) the spreadsheet's movement keys move the cursor and edit nothing;
// Ctrl+A takes the table first; Ctrl+; writes today's date
(async () => {
  const lines = [
    "Otter |size|colour",
    "Ollie |5   |brown",
    "Pebble|    |grey",
    "Pup   |3   |",
  ];
  const doc = makeDoc("c:\\repo\\Keys.aot", lines.join("\n"));
  let edited = 0;
  const editor = {
    document: doc,
    selection: new vscode.Selection(1, 7, 1, 7), // in Ollie's size
    edit: () => { edited++; return Promise.resolve(true); },
    revealRange: () => {},
  };
  registeredCommands.get("aot.table.jumpDown")(editor);
  const jumped = editor.selection.active.line === 3 && editor.selection.active.character === 7;
  registeredCommands.get("aot.table.selectToEdgeUp")(editor);
  const selected = editor.selection.anchor.line === 3 && editor.selection.active.line === 1;
  registeredCommands.get("aot.table.lastCell")(editor);
  const last = editor.selection.active.line === 3 && editor.selection.isEmpty;
  vscode.commands._calls.length = 0;
  registeredCommands.get("aot.table.lastCell")(editor);
  const leaves = vscode.commands._calls.some((c) => c[0] === "cursorBottom");
  console.log(jumped && selected && last && leaves && edited === 0
    ? "PASS (spreadsheet keys: Ctrl+arrow jumps, Shift selects, Ctrl+End twice leaves the table — no edit)"
    : "UNEXPECTED spreadsheet moves " + JSON.stringify({ jumped, selected, last, leaves, edited, sel: editor.selection.a }));

  registeredCommands.get("aot.table.selectTable")(editor);
  const table1 = editor.selection.start.line === 0 && editor.selection.end.line === 3;
  vscode.commands._calls.length = 0;
  registeredCommands.get("aot.table.selectTable")(editor);
  const all = vscode.commands._calls.some((c) => c[0] === "editor.action.selectAll");
  console.log(table1 && all
    ? "PASS (spreadsheet keys: Ctrl+A selects the table, then the file)"
    : "UNEXPECTED select table " + JSON.stringify({ table1, all, sel: editor.selection.a }));

  let inserted = null;
  const dated = {
    document: doc,
    selections: [new vscode.Selection(0, 0, 0, 0)],
    edit: (cb) => { cb({ replace: (range, t) => { inserted = t; } }); return Promise.resolve(true); },
  };
  await registeredCommands.get("aot.insertDate")(dated);
  console.log(/^\d{4}-\d{2}-\d{2}$/.test(inserted || "")
    ? "PASS (spreadsheet keys: Ctrl+; writes today's date as YYYY-MM-DD)"
    : "UNEXPECTED date " + JSON.stringify(inserted));
})();

// 7d4) the table keys in free text: an Example's lines are a row, its values
// the cells — Tab walks them, Ctrl+D fills a value down, Alt+↓ moves the
// whole Example; on a bare attribute line
// the key is VS Code's own again
(async () => {
  let lines = [
    "Person",
    "    age",
    "    - Ann",
    "        age: 30",
    "        city: Paris",
    "    - Bob",
    "        age: 12",
    "        city: Rome",
  ];
  const doc = makeDoc("c:\\repo\\Lines.aot", lines.join("\n"));
  doc.eol = vscode.EndOfLine.LF;
  doc.getText = () => lines.join("\n");
  doc.lineAt = (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] });
  Object.defineProperty(doc, "lineCount", { get: () => lines.length });
  const offset = (l, c) => lines.slice(0, l).reduce((n, s) => n + s.length + 1, 0) + c;
  const editor = {
    document: doc,
    selection: new vscode.Selection(2, 6, 2, 6), // on '- Ann'
    edit: (cb) => {
      cb({ replace: (range, t) => {
        const [sl, sc, el, ec] = range.a;
        const text = lines.join("\n");
        lines = (text.slice(0, offset(sl, sc)) + t + text.slice(offset(el, ec))).split("\n");
      } });
      return Promise.resolve(true);
    },
    revealRange: () => {},
    setDecorations: () => {},
  };
  const active = vscode.window.activeTextEditor;
  vscode.window.activeTextEditor = editor;
  const gridContext = () => {
    vscode.commands._calls.length = 0;
    vscode.window._selectionChanged({ textEditor: editor, selections: [editor.selection] });
    const set = vscode.commands._calls.find((c) => c[0] === "setContext" && c[1] === "aot.inGrid");
    return set && set[2];
  };
  const onExample = gridContext() === true;
  editor.selection = new vscode.Selection(1, 4, 1, 4); // the bare 'age' declaration
  const onDeclaration = gridContext() === false;
  console.log(onExample && onDeclaration
    ? "PASS (free text: an Example's line takes the table keys; a bare attribute line does not)"
    : "UNEXPECTED grid context " + JSON.stringify({ onExample, onDeclaration }));

  editor.selection = new vscode.Selection(2, 6, 2, 6);
  await registeredCommands.get("aot.table.nextCell")(editor);
  const tabbed = editor.selection.active.line === 3 && editor.selection.active.character === 13;
  editor.selection = new vscode.Selection(1, 4, 1, 4);
  vscode.commands._calls.length = 0;
  await registeredCommands.get("aot.table.nextCell")(editor);
  const ownTab = vscode.commands._calls.some((c) => c[0] === "tab");
  console.log(tabbed && ownTab
    ? "PASS (free text: Tab walks from an Example's name to its value; on an attribute it is VS Code's own Tab)"
    : "UNEXPECTED free-text Tab " + JSON.stringify({ tabbed, ownTab, sel: editor.selection.a }));

  editor.selection = new vscode.Selection(7, 14, 7, 14); // Bob's city
  await registeredCommands.get("aot.table.fillDown")(editor);
  const filled = lines[7] === "        city: Paris" && lines.length === 8;
  const noSum = !registeredCommands.has("aot.table.autoSum");
  console.log(filled && noSum
    ? "PASS (free text: Ctrl+D fills from the Example above; AutoSum went with the formula language)"
    : "UNEXPECTED free-text fill " + JSON.stringify({ lines, noSum }));

  editor.selection = new vscode.Selection(3, 13, 3, 13); // Ann's age
  await registeredCommands.get("aot.table.moveRowDown")(editor);
  const moved = lines.slice(2).join("|")
    === "    - Bob|        age: 12|        city: Paris|    - Ann|        age: 30|        city: Paris";
  console.log(moved && editor.selection.active.line === 6
    ? "PASS (free text: Alt+↓ moves the whole Example, the cursor with it)"
    : "UNEXPECTED free-text move " + JSON.stringify({ lines, sel: editor.selection.a }));
  vscode.window.activeTextEditor = active;
})();

// 7e) keeping your place in a long or wide table: the outline makes the
// header line the parent of its rows (which is what sticky scroll pins),
// and the status bar names the cell the cursor stands in.
{
  const sheet = [
    "Person",
    "    Person|occupation",
    "    Socrates|philosopher",
    "    Plato   |philosopher",
  ].join("\n");
  const docT = makeDoc("c:\repo\Sheet.aot", sheet);
  const symbols = symbolProvider.provideDocumentSymbols(docT);
  const person = symbols.find((s) => s.name === "Person");
  console.log(person && person.range.a[0] === 0 && person.range.a[2] === 3
    ? "PASS (outline: a Concept's range runs to the last line of its subtree)"
    : "UNEXPECTED outline root " + JSON.stringify(symbols.map((s) => [s.name, s.range && s.range.a])));

  // the table's own Concept (its first header cell) is a symbol whose range
  // covers the grid, so its rows sit *inside* it — sticky scroll then pins
  // the header line while you scroll them, which is the freeze asked for
  const grid = person && person.children.find((s) => s.range.a[0] === 1 && s.children.length);
  console.log(grid && grid.name === "Person" && grid.range.a[2] === 3
    && grid.children.some((r) => r.name === "Socrates") && grid.children.some((r) => r.name === "Plato")
    ? "PASS (outline: the header line is the parent of its rows — what sticky scroll pins)"
    : "UNEXPECTED table symbol " + JSON.stringify(grid && { n: grid.name, r: grid.range.a, kids: grid.children.map((k) => k.name) }));

  // a cell's own value shares its row's line, so it is no symbol of its own
  const socrates = grid && grid.children.find((r) => r.name === "Socrates");
  console.log(socrates && socrates.children.length === 0
    ? "PASS (outline: a cell value shares its row's line and is nothing to navigate to)"
    : "UNEXPECTED row children " + JSON.stringify(socrates && socrates.children.map((c) => c.name)));

  // the status bar: Concept, the row's Example, the column's attribute
  const item = vscode.window._statusItem;
  vscode.window.activeTextEditor = {
    document: docT, selection: new vscode.Selection(2, 15, 2, 15),
    setDecorations: () => {}, revealRange: () => {},
  };
  vscode.window._selectionChanged({
    textEditor: vscode.window.activeTextEditor,
    selections: [vscode.window.activeTextEditor.selection],
  });
  console.log(item && item.shown && /Person ▸ Socrates ▸ occupation/.test(item.text)
    ? "PASS (status bar: the cell address reads the same however far right you have scrolled)"
    : "UNEXPECTED cell address " + JSON.stringify(item && { shown: item.shown, text: item.text }));

  // off a table it says nothing
  vscode.window.activeTextEditor = {
    document: docT, selection: new vscode.Selection(0, 2, 0, 2),
    setDecorations: () => {}, revealRange: () => {},
  };
  vscode.window._selectionChanged({
    textEditor: vscode.window.activeTextEditor,
    selections: [vscode.window.activeTextEditor.selection],
  });
  console.log(item && !item.shown
    ? "PASS (status bar: away from a table the address hides)"
    : "UNEXPECTED cell address off-table " + JSON.stringify(item && item.text));
  vscode.window.activeTextEditor = undefined;
}

// 7f) Ctrl+Shift+`: the derivations out of the data and back, end to end.
// The values are written first, so the parked file still stands on its own —
// which is exactly why verify.js never needs to read the store.
(async () => {
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aot-park-"));
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
  const aotPath = path.join(root, "Ledger.aot");
  const lines = [
    "Invoice",
    "    tax rate: 0.2",
    "    Invoice|price|vat",
    "    INV-1  |100  |20 =@price*0.2",
    "    - INV-9",
    "        price: 50",
    "        vat: 10 =@price*0.2",
  ];
  fs.writeFileSync(aotPath, lines.join("\n"));
  const doc = makeDoc(aotPath, lines.join("\n"));
  doc.eol = vscode.EndOfLine.LF;
  let text = lines.join("\n");
  doc.getText = () => text;
  doc.lineAt = (i) => {
    const ls = text.split("\n");
    return { range: new vscode.Range(i, 0, i, ls[i].length), text: ls[i], firstNonWhitespaceCharacterIndex: ls[i].length - ls[i].trimStart().length };
  };
  Object.defineProperty(doc, "lineCount", { get: () => text.split("\n").length });
  const editor = {
    document: doc,
    selection: new vscode.Selection(0, 0, 0, 0),
    edit: (cb) => {
      cb({ replace: (range, t) => {
        const ls = text.split("\n");
        const [sl, sc, el] = range.a;
        ls.splice(sl, el - sl + 1, ...t.split("\n"));
        text = ls.join("\n");
        void sc;
      } });
      return Promise.resolve(true);
    },
    revealRange: () => {},
    setDecorations: (type, ranges) => parkDecorated.set(type, ranges),
  };
  const parkDecorated = new Map(); // decoration type -> ranges
  // decorate() runs over the visible editors, so the document is re-opened
  // with this one visible and the rest of the suite's editors left alone
  const redraw = () => {
    const visible = vscode.window.visibleTextEditors;
    vscode.window.visibleTextEditors = [editor];
    parkDecorated.clear();
    vscode.workspace._open(doc);
    vscode.window.visibleTextEditors = visible;
    return [...parkDecorated.values()].find((set) => set.some((d) => /\*\*Computed by Python\*\*/.test(d.hoverMessage.value))) || [];
  };

  const store = path.join(root, "aot.files", "Ledger.formulas");
  await registeredCommands.get("aot.toggleFormulaPark")(editor);
  const parkedLines = text.split("\n");
  // Python is off here, so the values park as they stand: the derivation
  // leaves, the value stays, the grid narrows
  console.log(parkedLines[2] === "    Invoice|price|vat" && parkedLines[3] === "    INV-1  |100  |20"
    ? "PASS (park: with Python off the value parks as it stands, the derivation leaves, the grid narrows)"
    : "UNEXPECTED parked grid " + JSON.stringify(parkedLines));
  console.log(parkedLines[6] === "        vat: 10" && !/=/.test(text)
    ? "PASS (park: no '=' is left anywhere in the data)"
    : "UNEXPECTED parked line form " + JSON.stringify(parkedLines[6]));

  const stored = fs.existsSync(store) && fs.readFileSync(store, "utf8");
  console.log(stored && /@Invoice@vat@INV-1: =@price\*0\.2/.test(stored) && /@Invoice@vat@INV-9: =@price\*0\.2/.test(stored)
    ? "PASS (park: both notations are addressed the same way in the store)"
    : "UNEXPECTED store " + JSON.stringify(stored));

  // the parked file still verifies on its own: every value is present, and
  // nothing in it refers to the store
  const parkedTree = lint(text, "Ledger");
  console.log(parkedTree.errors.length === 0
    ? "PASS (park: the parked file still verifies on its own terms — V is unchanged)"
    : "UNEXPECTED parked errors " + JSON.stringify(parkedTree.errors.map((e) => e.message)));

  // ...and the values it computed say so. A parked file reads as plain
  // values, which is what makes it lintable and what makes it easy to type
  // over: every value the store owns is marked where it stands.
  {
    const marks = redraw();
    const parkedText = text.split("\n");
    const at = (line) => marks.find((d) => d.range.a[0] === line - 1);
    const spanOf = (d) => parkedText[d.range.a[0]].slice(d.range.a[1], d.range.a[3]);
    const cell = at(4), lineForm = at(7);
    console.log(marks.length === 2 && cell && spanOf(cell) === "20" && lineForm && spanOf(lineForm) === "10"
      ? "PASS (park: every parked value is marked where it stands, in both notations)"
      : "UNEXPECTED parked marks " + JSON.stringify(marks.map((d) => [d.range.a, spanOf(d)])));
    console.log(cell && /=@price\*0\.2/.test(cell.hoverMessage.value)
      && /Ledger\.formulas/.test(cell.hoverMessage.value)
      && /@Invoice@vat@INV-1/.test(cell.hoverMessage.value)
      && /command:aot\.toggleFormulaPark/.test(cell.hoverMessage.value) && cell.hoverMessage.isTrusted
      ? "PASS (park: the mark names its formula, its store and its address, and offers the key back)"
      : "UNEXPECTED parked hover " + JSON.stringify(cell && cell.hoverMessage.value));

    // Python may hold a backtick (in a string), so the code span that shows
    // a derivation must be fenced wider than the derivation itself
    const parkModule = require("../src/park");
    fs.writeFileSync(store, parkModule.serialise(
      [{ address: "@Invoice@vat@INV-1", formula: "=lookup(\"`A`\", @Person)" }]));
    const quoted = redraw()[0];
    console.log(quoted && quoted.hoverMessage.value.includes("`` =lookup(\"`A`\", @Person) ``")
      ? "PASS (park: a derivation holding a backtick survives the hover's code span)"
      : "UNEXPECTED quoted hover " + JSON.stringify(quoted && quoted.hoverMessage.value));
    fs.writeFileSync(store, stored); // the store as parking left it

    configStore.parkedValueMarks = false;
    console.log(redraw().length === 0
      ? "PASS (park: aot.parkedValueMarks off leaves the values unmarked)"
      : "UNEXPECTED marks with aot.parkedValueMarks off");
    delete configStore.parkedValueMarks;
  }

  // and back: the same key restores every derivation and removes the store
  await registeredCommands.get("aot.toggleFormulaPark")(editor);
  const backLines = text.split("\n");
  console.log(/=@price\*0\.2/.test(backLines[3]) && backLines[6] === "        vat: 10 =@price*0.2"
    ? "PASS (park: the same key puts every derivation back where it came from)"
    : "UNEXPECTED unparked " + JSON.stringify(backLines));
  console.log(!fs.existsSync(store)
    ? "PASS (park: the store is the state — it is gone once the formulas are home)"
    : "UNEXPECTED store still there");
  console.log(redraw().length === 0
    ? "PASS (park: the marks go with the store — a formula in the data needs no mark)"
    : "UNEXPECTED marks after unparking");

  vscode.workspace.workspaceFolders = undefined;
  fs.rmSync(root, { recursive: true, force: true });
})();

// 8) derivations: the span after the '=' is coloured as Python, a value
// nothing has computed yet draws no verdict from the linter, and Tab
// computes nothing — only Ctrl+Enter runs Python.
{
  const calc = [
    "Order",
    "    Order | price | total",
    "    A     | 10    | 15 =@price*2",
    "    age >=18",
  ].join("\n");
  const doc8 = makeDoc("c:\repo\Calc.aot", calc);
  const { tokens } = semanticProvider.provideDocumentSemanticTokens(doc8);
  const pyToks = tokens.filter((t) => t[3] === 3);
  console.log(pyToks.length === 2 && pyToks[0][0] === 2 && pyToks[0][1] === 23 && pyToks[0][2] === 9
    && pyToks[1][0] === 3 && pyToks[1][1] === 8 && pyToks[1][2] === 4
    ? "PASS (derivation: '=@price*2' and the bound '>=18' carry the Python colour)"
    : "UNEXPECTED python tokens " + JSON.stringify(tokens));

  vscode.workspace._open(doc8);
  const calcDiags = published.get(doc8.uri.toString()) || [];
  console.log(!calcDiags.some((d) => /formula|does not match|compute/i.test(d.message))
    ? "PASS (derivation: the linter judges no computed value — that is the run's to say)"
    : "UNEXPECTED formula diagnostics " + JSON.stringify(calcDiags.map((d) => d.message)));

  // Tab aligns and computes nothing: the 15 stays until Python runs
  let applied8 = null;
  const editor8 = {
    document: doc8,
    selection: new vscode.Selection(2, 7, 2, 7),
    edit: (cb) => { cb({ replace: (range, t) => { applied8 = t; } }); return Promise.resolve(true); },
    revealRange: () => {},
  };
  registeredCommands.get("aot.table.nextCell")(editor8);
  Promise.resolve().then(() => {
    console.log(applied8 && applied8.includes("15 =@price*2")
      ? "PASS (derivation: Tab computes nothing — the value waits for Ctrl+Enter)"
      : "UNEXPECTED recompute on Tab " + JSON.stringify(applied8));
  });
}

// 8c) F2 rename: the declaration, the crosslinks and every formula
// reference change together, so a rename never strands a formula
{
  // a column rename reaches the formula that reads it
  const calc = makeDoc("c:\\repo\\Rename.aot", [
    "Order",
    "    name|price|total",
    "    A   |10   |20 =@price*2",
  ].join("\n"));
  const prep = renameProvider.prepareRename(calc, new vscode.Position(1, 11));
  console.log(prep && prep.placeholder === "price" && prep.range.a[1] === 9
    ? "PASS (rename: prepare finds the header cell under the cursor)"
    : "UNEXPECTED prepareRename " + JSON.stringify(prep));
  const colEdit = renameProvider.provideRenameEdits(calc, new vscode.Position(1, 11), "cost");
  const colOps = colEdit.ops.map((o) => o.range.a.join(",") + ":" + o.text).sort();
  console.log(colOps.length === 2 && colOps[0] === "1,9,1,14:cost" && colOps[1] === "2,20,2,25:cost"
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
    "    name|price",
    "    Acme|10",
    "spend: =@Order@price@Acme",
  ].join("\n"));
  const tableEdit = renameProvider.provideRenameEdits(named, new vscode.Position(0, 2), "Purchases");
  const tableOps = tableEdit.ops.map((o) => o.range.a.join(",") + ":" + o.text).sort();
  console.log(tableOps.length === 2
    && tableOps.includes("0,0,0,5:Purchases")  // the Concept the table sits under
    && tableOps.includes("3,9,3,14:Purchases") // the table name inside the formula
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

// 9b2) nothing fills itself in: a derivation is Python, and Python runs only
// when asked (Ctrl+Enter). Opening a file, leaving a line, a stale table
// cell — none of them computes a value.
(async () => {
  const lines = [
    "Order",
    "    total: =sum(@price)",
    "    - A",
    "        price: 2",
    "    - B",
    "        price: 3",
    "    Order|price|total",
    "    C    |10   |15 =@price*2",
  ];
  const before = lines.join("\n");
  const doc = {
    lines,
    languageId: "aot", fileName: "c:\\repo\\Fill.aot", eol: vscode.EndOfLine.LF,
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  doc.uri = { toString: () => "file:///fill", __doc: doc };
  const editor = {
    document: doc,
    selection: new vscode.Selection(1, 24, 1, 24),
    selections: [new vscode.Selection(2, 0, 2, 0)],
    edit: (cb) => { cb({ replace: (range, t) => { const [sl, , el] = range.a; lines.splice(sl, el - sl + 1, ...t.split("\n")); } }); return Promise.resolve(true); },
    revealRange: () => {}, setDecorations: () => {},
  };
  vscode.workspace._open(doc);
  vscode.window.visibleTextEditors.push(editor);
  vscode.window._selectionChanged({ textEditor: editor, selections: [new vscode.Selection(3, 0, 3, 0)] });
  await new Promise((r) => setImmediate(r));
  console.log(lines.join("\n") === before
    ? "PASS (no fill: opening a file or leaving a line computes nothing — Ctrl+Enter does)"
    : "UNEXPECTED fill " + JSON.stringify(lines));
  vscode.window.visibleTextEditors.pop();
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
    "    name |price|qty|total",
    "    Alpha|10   |2  |=@",
    "    Beta |5    |4  |",
  ].join("\n");
  const docC = makeDoc("c:\\repo\\Comp.aot", tbl);
  const atCol = tbl.split("\n")[2].indexOf("@") + 1;
  const items = completionProvider.provideCompletionItems(docC, new vscode.Position(2, atCol));
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
  const recieveOk = recieve && recieve.range.a.join(",") === "0,0,0,7" && /is not in the dictionary/.test(recieve.message);
  const pakageOk = pakage && pakage.range.a.join(",") === "1,14,1,20" && /is not in the dictionary/.test(pakage.message);
  console.log(recieveOk && pakageOk
    ? "PASS (spelling: misspelled words hint on their span)"
    : "UNEXPECTED spelling hints " + JSON.stringify(sHints.map((d) => [d.range.a, d.message])));
  // the candidates are no longer in the message — computing them is what made
  // spelling slow, so they are fetched for the one word the lightbulb asks
  // about. They must still be the right ones.
  const speller = require("../src/spelling");
  console.log(speller.suggestionsFor("Recieve").includes("Receive")
    && speller.suggestionsFor("pakage").includes("package")
    ? "PASS (spelling: the candidates are there when asked for, off the typing path)"
    : "UNEXPECTED suggestions " + JSON.stringify([speller.suggestionsFor("Recieve"), speller.suggestionsFor("pakage")]));
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

  // a suggestion also offers to be applied: one Replace fix per suggestion,
  // preferred when it is the only one so Auto Fix applies it in a stroke
  const replaceFixes = actions.filter((a) => a.title.startsWith("Replace with '"));
  const lone = require("../src/spelling").suggestionsFor("pakage").length === 1;
  console.log(replaceFixes.length > 0
    && replaceFixes.every((a) => a.edit && a.edit.ops[0].type === "replace" && a.edit.ops[0].range === hint.range)
    && (!lone || (replaceFixes.length === 1 && replaceFixes[0].isPreferred === true))
    && (lone || replaceFixes.every((a) => a.isPreferred === false))
    ? "PASS (spelling: each suggestion offers Replace with 'X', preferred when it stands alone)"
    : "UNEXPECTED replace fixes " + JSON.stringify(actions.map((a) => [a.title, a.isPreferred])));

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

// Ctrl+Alt+T: the Concept at the cursor written out in its other form, end
// to end — the cursor standing anywhere inside it, and the re-align that
// follows computing the formulas where they have landed.
//
// Last, and on a timer: the command names what it did in the status bar,
// which is one shared global here, so running it after every other block has
// settled keeps its message out of another test's assertion.
setTimeout(async () => {
  const start = [
    "Invoice",
    "    tax rate: 0.2",
    "    price",
    "    - INV-1",
    "        price: 100",
    "        vat: 20 =@price*@tax rate",
    "    - INV-9",
    "        price: 50",
    "        vat: 10 =@price*@tax rate",
  ];
  let text = start.join("\n");
  const doc = makeDoc("c:\repo\Books.aot", text);
  doc.eol = vscode.EndOfLine.LF;
  doc.getText = () => text;
  doc.lineAt = (i) => {
    const ls = text.split("\n");
    return { range: new vscode.Range(i, 0, i, ls[i].length), text: ls[i], firstNonWhitespaceCharacterIndex: ls[i].length - ls[i].trimStart().length };
  };
  Object.defineProperty(doc, "lineCount", { get: () => text.split("\n").length });
  const editor = {
    document: doc,
    // the cursor on a value line deep inside the Concept, not on its own line
    selection: new vscode.Selection(5, 10, 5, 10),
    edit: (cb) => {
      cb({ replace: (range, t) => {
        const ls = text.split("\n");
        const [sl, , el] = range.a;
        ls.splice(sl, el - sl + 1, ...t.split("\n"));
        text = ls.join("\n");
      } });
      return Promise.resolve(true);
    },
    revealRange: () => {}, setDecorations: () => {},
  };

  await registeredCommands.get("aot.toggleTableForm")(editor);
  const gridLines = text.split("\n");
  console.log(gridLines[0] === "Invoice" && gridLines[1] === "    tax rate: 0.2"
    && gridLines[2] === "    Invoice|price|vat"
    && gridLines[3] === "    INV-1  |100  |20 =@price*@tax rate"
    && gridLines[4] === "    INV-9  |50   |10 =@price*@tax rate"
    ? "PASS (flip: a cursor inside the Concept writes the whole Concept out as a grid)"
    : "UNEXPECTED flip grid " + JSON.stringify(gridLines));
  console.log(lint(text, "Books").errors.length === 0
    ? "PASS (flip: the flipped file verifies — V is unchanged by a re-spelling)"
    : "UNEXPECTED flip errors " + JSON.stringify(lint(text, "Books").errors.map((e) => e.message)));
  console.log(editor.selection.a[0] === 0
    ? "PASS (flip: the cursor lands on the Concept's first line in its new form)"
    : "UNEXPECTED flip cursor " + JSON.stringify(editor.selection.a));

  // and back, the same key from inside the grid: every Example, value and
  // derivation returns — and the grid's header, which is a declaration,
  // returns as the attribute lines that declare the same columns
  editor.selection = new vscode.Selection(4, 12, 4, 12);
  await registeredCommands.get("aot.toggleTableForm")(editor);
  console.log(text === [
    "Invoice",
    "    tax rate: 0.2",
    "    price",
    "    vat",
    "    - INV-1",
    "        price: 100",
    "        vat: 20 =@price*@tax rate",
    "    - INV-9",
    "        price: 50",
    "        vat: 10 =@price*@tax rate",
  ].join("\n")
    ? "PASS (flip: the same key writes it back, every value and derivation intact)"
    : "UNEXPECTED unflipped " + JSON.stringify(text.split("\n")));
}, 2000);

// 11b) the settings that choose what runs, and what it is held to, are the
// writer's alone: user settings, which no repository's .vscode can set
{
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const props = manifest.contributes.configuration.properties;
  const userOnly = ["aot.python.enabled", "aot.python.manager", "aot.python.path", "aot.uv.path",
    "aot.python.maxMemoryMb", "aot.python.allowSubprocess", "aot.python.allowNetwork", "aot.python.protectCredentials"];
  const wrong = userOnly.filter((k) => !props[k] || props[k].scope !== "machine");
  const restricted = manifest.capabilities.untrustedWorkspaces.restrictedConfigurations;
  console.log(!wrong.length && userOnly.every((k) => restricted.includes(k))
    && props["aot.python.allowSubprocess"].default === false && props["aot.python.protectCredentials"].default === true
    && props["aot.python.enabled"].default === false
    ? "PASS (security: what runs and what it is held to are user settings only — no repository can set them — off and guarded by default)"
    : "UNEXPECTED setting scopes " + JSON.stringify({ wrong }));
}

// 12) Python derivations end to end, against a fake runtime — no Python
// needed: the gates, Ctrl+Enter writing values, a Concept's table, a picture
// and a long text into aot.files, a failure kept to its own line and what
// reads it, the findings in a collection of their own, consent for the
// sidecar asked again after it changes, the park key running Python first,
// and the paths that must never run anything. Late, so no other block is
// still moving the mock's shared workspace state.
setTimeout(async () => {
  const os = require("os");
  const { EventEmitter } = require("events");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aot-pyed-"));
  const before = vscode.workspace.workspaceFolders;
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
  const requests = [];
  let spawns = 0;
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // the fake keeps the runtime's one rule about the repository's Python: a
  // file runs only when the content it holds now has been allowed
  const crypto = require("crypto");
  const fakeApproved = new Map();
  const fkey = (p) => path.normalize(p).toLowerCase();
  const needs = (p) => {
    const digest = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    return fakeApproved.get(fkey(p)) === digest ? null
      : { ok: false, error: `NeedsConsent: ${path.basename(p)} has not been allowed to run here`, consent: { path: p, digest } };
  };
  const finance = path.join(root, "tools", "finance.py");
  // a constraint's bound, for the few the tests write: a number, a tuple of
  // allowed words, or twice a referenced value
  const fakeCheck = (it) => {
    const num = (s) => Number(String(s).replace(/[$,]/g, ""));
    let bound;
    if (/^\d+$/.test(it.code)) bound = Number(it.code);
    else if (it.code === '("draft", "sent")') bound = ["draft", "sent"];
    else if (it.code === "_aot_ref(0)*2") bound = num(it.targets[0].text) * 2;
    else return { ok: false, error: `NameError: name '${it.code}' is not defined` };
    const v = it.value === "" ? null : Number.isNaN(num(it.value)) ? it.value : num(it.value);
    const rel = { "==": (a, b) => a === b, ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, "<": (a, b) => a < b, ">": (a, b) => a > b }[it.rel];
    const many = Array.isArray(bound) ? bound : null;
    const out = { ok: true, holds: (many || [bound]).some((b) => rel(v, b)), bound: many ? "one of " + many.map((x) => `'${x}'`).join(", ") : String(bound) };
    if (it.rel === "==" && !many) out.define = { kind: "number", value: bound };
    return out;
  };
  const answer = (req) => {
    if (req.op === "hello") return { ok: true, protocol: 1, python: "3.13.0", executable: "fakepython", libraries: { pandas: "2.2.2", seaborn: null } };
    if (req.op === "open") {
      for (const [k, d] of Object.entries(req.approved || {})) fakeApproved.set(fkey(k), d);
      const stop = req.sidecar && needs(req.sidecar);
      return stop || { ok: true, sidecar: !!req.sidecar, functions: [] };
    }
    if (req.op === "approve") {
      for (const [k, d] of Object.entries(req.files || {})) fakeApproved.set(fkey(k), d);
      return { ok: true };
    }
    if (req.op === "checks") return { ok: true, results: req.items.map(fakeCheck) };
    if (req.op !== "eval") return { ok: true };
    switch (req.code) {
      case "finance.revenue(3)": return needs(finance) || { ok: true, result: { kind: "number", value: 60 }, ms: 2 };
      case "math.factorial(10)": return { ok: true, result: { kind: "number", value: 3628800 }, ms: 3 };
      case "_aot_ref(0)*_aot_ref(1)":
        return req.targets[0].kind === "object" && req.targets[0].address === "@Report@n" && req.targets[1].text === "0.2"
          ? { ok: true, result: { kind: "number", value: 725760 }, ms: 1 } : { ok: false, error: "vat read the wrong things" };
      case "frame()": return { ok: true, ms: 5, result: { kind: "frame", columns: ["month", "units"], rows: [["Q1", "2026-01", 1204], ["Q2", "2026-04", 1380]], summary: "<DataFrame 2 rows × 2 cols>" } };
      case "_aot_ref(0).units.sum()":
        return req.targets[0].kind === "object" && req.targets[0].address === "@Sales"
          ? { ok: true, result: { kind: "number", value: 2584 }, ms: 1 } : { ok: false, error: "the reference was not the live frame" };
      case "chart()": return { ok: true, result: { kind: "image", ext: "png", base64: PNG.toString("base64") }, ms: 9 };
      case "notes()": return { ok: true, result: { kind: "text", text: "line one\nline two" }, ms: 1 };
      case "boom()": return { ok: false, error: "NameError: name 'boom' is not defined" };
      default: return { ok: false, error: `the fake runtime was not taught ${req.code}` };
    }
  };
  let lastSpawn = null;
  const fakeRuntime = (cmd, args, opts) => {
    spawns++;
    lastSpawn = { cmd, args, opts };
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = {
      write: (s) => {
        const req = JSON.parse(s);
        requests.push(req);
        setImmediate(() => proc.stdout.emit("data", JSON.stringify(Object.assign({ id: req.id }, answer(req))) + "\n"));
      },
      end() {},
    };
    proc.kill = () => setImmediate(() => proc.emit("exit", null));
    return proc;
  };
  ext._test.setSpawn(fakeRuntime);
  const ran = () => requests.filter((r) => r.op === "open" || r.op === "eval").length;

  // a document whose text the editor really changes
  const live = (fsPath, lines) => {
    let text = lines.join("\n");
    fs.writeFileSync(fsPath, text);
    const doc = {
      languageId: "aot", fileName: fsPath, eol: vscode.EndOfLine.LF,
      uri: { fsPath, toString: () => "file:///" + fsPath.replace(/\\/g, "/") },
      getText: () => text,
      get lineCount() { return text.split("\n").length; },
      lineAt: (i) => { const ls = text.split("\n"); return { range: new vscode.Range(i, 0, i, ls[i].length), text: ls[i] }; },
    };
    const offset = (line, ch) => {
      const ls = text.split("\n");
      let o = 0;
      for (let k = 0; k < line; k++) o += ls[k].length + 1;
      return o + ch;
    };
    const editor = {
      document: doc,
      selection: new vscode.Selection(0, 0, 0, 0),
      revealRange() {},
      setDecorations() {},
      edit: (cb) => {
        const ops = [];
        cb({
          replace: (r, t) => ops.push([offset(r.a[0], r.a[1]), offset(r.a[2], r.a[3]), t]),
          insert: (p, t) => ops.push([offset(p.line, p.character), offset(p.line, p.character), t]),
          delete: (r) => ops.push([offset(r.a[0], r.a[1]), offset(r.a[2], r.a[3]), ""]),
        });
        ops.sort((a, b) => b[0] - a[0]);
        for (const [s, e, t] of ops) text = text.slice(0, s) + t + text.slice(e);
        return Promise.resolve(true);
      },
    };
    return { doc, editor, text: () => text, lines: () => text.split("\n"), set: (t) => { text = t; } };
  };
  const pyFindings = (doc) => (publishedByName.get("aot-python") || new Map()).get(doc.uri.toString()) || [];
  const run = (f, line) => {
    f.editor.selection = new vscode.Selection(line, 0, line, 0);
    return registeredCommands.get("aot.runPython")(f.editor);
  };

  try {
    process.env.AOT_TEST_API_TOKEN = "a secret the editor was started with";
    process.env.VSCODE_TEST_HANDLE = "a door back into the editor";
    const f = live(path.join(root, "Ledger.aot"), [
      "Report",
      "    n: =math.factorial(10)",
      "    Sales =frame()",
      "    revenue: =@Sales.units.sum()",
      "    chart: =chart()",
      "    notes: =notes()",
      "    bad: =boom()",
      "    twice: =@bad.real * 2",
      "    tax rate: 0.2",
      "    vat: =@n*@tax rate",
    ]);
    vscode.workspace.textDocuments = [f.doc];

    // off by default: nothing runs, nothing starts, and the note says so
    vscode.workspace._open(f.doc);
    const infoFirst = pyFindings(f.doc).filter((d) => d.severity === vscode.DiagnosticSeverity.Information);
    console.log(infoFirst.length === 8 && infoFirst.every((d) => /^not run yet — Ctrl\+Enter runs it \(aot\.python\.enabled is off\)$/.test(d.message))
      && infoFirst.every((d) => d.source === "aot-python")
      ? "PASS (python: a derivation that has never run is noted as such, in a collection of its own)"
      : "UNEXPECTED python notes " + JSON.stringify(pyFindings(f.doc).map((d) => d.message)));
    console.log(!(published.get(f.doc.uri.toString()) || []).some((d) => /Python|does not compute/.test(d.message) && d.range.a[0] >= 1 && d.range.a[0] <= 7)
      ? "PASS (python: no Python derivation is a linter error — V never counts them)"
      : "UNEXPECTED python in the linter's findings " + JSON.stringify((published.get(f.doc.uri.toString()) || []).map((d) => d.message)));
    const offRun = await run(f, 1);
    console.log(offRun && offRun.blocked === "off" && spawns === 0 && ran() === 0
      ? "PASS (python: with aot.python.enabled off, Ctrl+Enter runs nothing and starts nothing)"
      : "UNEXPECTED run while off " + JSON.stringify({ offRun, spawns }));

    // on, but the workspace untrusted
    configStore["python.enabled"] = true;
    vscode.workspace.isTrusted = false;
    const untrusted = await run(f, 1);
    console.log(untrusted && untrusted.blocked === "untrusted" && spawns === 0
      ? "PASS (python: an untrusted workspace runs nothing and starts nothing)"
      : "UNEXPECTED run while untrusted " + JSON.stringify({ untrusted, spawns }));
    vscode.workspace.isTrusted = true;

    // the file's own Python arrived on disk, not written in this editor: it
    // is asked about before anything starts
    vscode.window._warningAnswer = undefined;
    const codeAsked = vscode.window._warnings.length;
    const refusedCode = await run(f, 1);
    console.log(refusedCode.blocked === "refused" && spawns === 0
      && /^AOT: run the Python in Ledger\.aot\? 8 derivations in it have not run here before and did not come from this editor — line 2: =math\.factorial\(10\); line 3: =frame\(\)/.test(vscode.window._warnings[codeAsked] || "")
      && JSON.stringify(vscode.window._warningItems) === JSON.stringify(["Run", "Show Them"])
      ? "PASS (python: a .aot's own Python that came from outside is asked about before anything starts — no answer, nothing runs)"
      : "UNEXPECTED .aot consent " + JSON.stringify({ refusedCode, spawns, warning: vscode.window._warnings[codeAsked] }));
    vscode.window._warningAnswer = "Run";

    // Ctrl+Enter on one derivation: that one, in place
    const first = await run(f, 1);
    console.log(first.ran === 2 && f.lines()[1] === "    n: 3,628,800 =math.factorial(10)"
      && f.lines()[9] === "    vat: 725,760 =@n*@tax rate"
      ? "PASS (python: Ctrl+Enter writes the value in front of its derivation, and what reads it runs after it)"
      : "UNEXPECTED Ctrl+Enter one " + JSON.stringify({ first, lines: f.lines() }));

    // what the process is held to goes in with its first request, and the
    // editor's own secrets never reach it
    const helloSent = requests.find((r) => r.op === "hello");
    const env = (lastSpawn && lastSpawn.opts && lastSpawn.opts.env) || {};
    console.log(helloSent && JSON.stringify(helloSent.guards) === JSON.stringify({ memoryMb: 4096, subprocess: false, network: true, credentials: true })
      && !("AOT_TEST_API_TOKEN" in env) && !("VSCODE_TEST_HANDLE" in env) && Object.keys(env).some((k) => /^path$/i.test(k))
      ? "PASS (python: the guards go in with hello — 4 GB, no other programs, credentials protected — and no secret in the environment reaches Python)"
      : "UNEXPECTED guards " + JSON.stringify({ guards: helloSent && helloSent.guards, leaked: Object.keys(env).filter((k) => /AOT_TEST|VSCODE_TEST/.test(k)) }));

    // Ctrl+Enter off any derivation: every stale one, dependencies first
    const all = await run(f, 0);
    const L = f.lines();
    const chartFile = path.join(root, "aot.files", "Report.chart.png");
    const notesFile = path.join(root, "aot.files", "Report.notes.md");
    // the table IS the Concept: its line becomes the header, derivation and
    // all, and the rows stand at the Concept's own indent
    console.log(L.slice(2, 5).join("\n") === [
      "    Sales =frame()|month  |units",
      "    Q1            |2026-01|1,204",
      "    Q2            |2026-04|1,380",
    ].join("\n") && L[5] === "    revenue: 2,584 =@Sales.units.sum()"
      ? "PASS (python: a Concept's derivation turns its line into the table's header, numbers separated)"
      : "UNEXPECTED Concept table " + JSON.stringify(L));
    console.log(L.includes("    revenue: 2,584 =@Sales.units.sum()")
      ? "PASS (python: a derivation reading @Sales gets the live frame the Concept's Python made)"
      : "UNEXPECTED revenue " + JSON.stringify(L));
    console.log(L.includes("    chart: aot.files/Report.chart.png =chart()") && fs.existsSync(chartFile)
      && fs.readFileSync(chartFile).equals(PNG)
      ? "PASS (python: a picture is written into aot.files, and its path is the value)"
      : "UNEXPECTED chart " + JSON.stringify(L));
    console.log(L.includes("    notes: aot.files/Report.notes.md =notes()") && fs.existsSync(notesFile)
      && fs.readFileSync(notesFile, "utf8") === "line one\nline two\n"
      ? "PASS (python: a text with a line break goes to aot.files/<name>.md)"
      : "UNEXPECTED notes " + JSON.stringify(L));
    console.log(L.includes("    bad: =boom()") && L.includes("    twice: =@bad.real * 2")
      && !requests.some((r) => r.op === "eval" && /real/.test(r.code))
      ? "PASS (python: a failure keeps its old value, and what reads it is never sent to run)"
      : "UNEXPECTED failure handling " + JSON.stringify(L));
    const findings = pyFindings(f.doc);
    const badLine = L.indexOf("    bad: =boom()");
    const failedD = findings.find((d) => d.range.a[0] === badLine);
    const skippedD = findings.find((d) => d.range.a[0] === badLine + 1);
    console.log(all.failed === 2 && failedD && failedD.severity === vscode.DiagnosticSeverity.Error && /NameError: name 'boom'/.test(failedD.message)
      && skippedD && skippedD.severity === vscode.DiagnosticSeverity.Warning && /@Report@bad failed/.test(skippedD.message)
      ? "PASS (python: the failure is an error on its own line; what reads it says why it did not run)"
      : "UNEXPECTED failure findings " + JSON.stringify(findings.map((d) => [d.range.a[0], d.severity, d.message])));
    console.log(lint(f.text(), "Ledger").errors.length === 0
      ? "PASS (python: the file Python wrote still verifies — V is unchanged)"
      : "UNEXPECTED errors after the run " + JSON.stringify(lint(f.text(), "Ledger").errors.map((e) => e.message)));

    // how each ran, and when, at the end of its line
    const hintsNow = () => inlayProvider.provideInlayHints(f.doc, new vscode.Range(0, 0, 40, 0)).map((h) => h.label);
    const hints = hintsNow();
    console.log(hints.some((label) => /^✓ 2 rows · 5 ms · \d\d:\d\d$/.test(label)) && hints.some((label) => /^✗ NameError.* · \d\d:\d\d$/.test(label))
      && hints.some((label) => /^✓ 1 ms · \d\d:\d\d$/.test(label))
      ? "PASS (python: an inlay says how each derivation ran and when — its rows, its time, or what went wrong)"
      : "UNEXPECTED python inlays " + JSON.stringify(hints));
    const { ranAt } = ext._test;
    const now = new Date(2026, 8, 24, 16, 30);
    console.log(ranAt(new Date(2026, 8, 24, 9, 5), now) === "09:05" && ranAt(new Date(2026, 8, 23, 16, 4), now) === "2026-09-23 16:04"
      && ranAt(undefined, now) === "" && ranAt("not a date", now) === ""
      ? "PASS (python: a run today shows its time, an older one its date as the file writes one)"
      : "UNEXPECTED ranAt " + JSON.stringify([ranAt(new Date(2026, 8, 24, 9, 5), now), ranAt(new Date(2026, 8, 23, 16, 4), now)]));

    // nothing left to do: a second Ctrl+Enter off every derivation runs only the failures again
    const evalsBefore = requests.filter((r) => r.op === "eval").length;
    await run(f, 0);
    const rerun = requests.filter((r) => r.op === "eval").slice(evalsBefore).map((r) => r.code);
    console.log(rerun.length === 1 && rerun[0] === "boom()"
      ? "PASS (python: a fresh derivation is not run again — only what is stale)"
      : "UNEXPECTED rerun " + JSON.stringify(rerun));

    // the file closed — the session and everything it knew gone — and the
    // last run's time still shows: it is kept with the run records
    vscode.workspace._close(f.doc);
    const afterClose = hintsNow();
    console.log(afterClose.some((label) => /^✓ 2 rows · 5 ms · \d\d:\d\d$/.test(label)) && afterClose.some((label) => /^✓ 1 ms · \d\d:\d\d$/.test(label))
      && !afterClose.some((label) => /^✗/.test(label))
      ? "PASS (python: when a derivation last ran outlasts its session)"
      : "UNEXPECTED inlays after close " + JSON.stringify(afterClose));

    // an edit dims the old value and says so, without running anything
    f.set(f.text().replace("    n: 3,628,800 =math.factorial(10)", "    n: 3,628,800 =math.factorial(10) + 0"));
    vscode.workspace._open(f.doc);
    const edited = pyFindings(f.doc).find((d) => d.range.a[0] === 1);
    console.log(edited && /edited since it last ran/.test(edited.message) && edited.severity === vscode.DiagnosticSeverity.Information
      && hintsNow().some((label) => /^✎ edited since \d\d:\d\d — Ctrl\+Enter$/.test(label))
      ? "PASS (python: a derivation edited since it ran is noted with when it last ran, and nothing runs until asked)"
      : "UNEXPECTED edited note " + JSON.stringify({ findings: pyFindings(f.doc).map((d) => d.message), hints: hintsNow() }));
    f.set(f.text().replace(" =math.factorial(10) + 0", " =math.factorial(10)"));

    // the sidecar: asked before it first runs, and again once it changes
    const side = path.join(root, "aot.files", "Ledger.py");
    fs.writeFileSync(side, "def helper():\n    return 1\n");
    vscode.window._warningAnswer = undefined;
    const warned = vscode.window._warnings.length;
    const evals = requests.filter((r) => r.op === "eval").length;
    const refused = await run(f, 1);
    console.log(refused.blocked === "refused" && vscode.window._warnings.length === warned + 1
      && /^AOT: run aot\.files\/Ledger\.py\? A Python derivation reaches it, and it has not been run here before/.test(vscode.window._warnings[warned])
      && JSON.stringify(vscode.window._warningItems) === JSON.stringify(["Run", "Open File"])
      && requests.filter((r) => r.op === "eval").length === evals
      ? "PASS (python: the sidecar is asked about before it first runs; no answer is a no, and nothing runs)"
      : "UNEXPECTED sidecar consent " + JSON.stringify({ refused, warnings: vscode.window._warnings.slice(warned) }));
    vscode.window._warningAnswer = "Run";
    const allowed = await run(f, 1);
    const sentSidecar = requests.filter((r) => r.op === "open").pop();
    console.log(allowed.ran >= 1 && sentSidecar && sentSidecar.sidecar === side
      ? "PASS (python: once allowed, the sidecar is loaded by its path)"
      : "UNEXPECTED allowed run " + JSON.stringify({ allowed, sentSidecar }));
    const asked = vscode.window._warnings.length;
    vscode.window._warningAnswer = undefined;
    await run(f, 1);
    console.log(vscode.window._warnings.length === asked
      ? "PASS (python: an unchanged sidecar is not asked about again)"
      : "UNEXPECTED asked again for an unchanged sidecar");
    fs.writeFileSync(side, "def helper():\n    return 2  # changed\n");
    const again = await run(f, 1);
    console.log(again.blocked === "refused" && vscode.window._warnings.length === asked + 1
      && /has changed since you last allowed it, and not in this editor/.test(vscode.window._warnings[asked])
      && JSON.stringify(vscode.window._warningItems) === JSON.stringify(["Run", "Show Changes"])
      ? "PASS (python: a sidecar changed outside the editor is asked about again)"
      : "UNEXPECTED changed sidecar " + JSON.stringify({ again, warnings: vscode.window._warnings.slice(asked), items: vscode.window._warningItems }));
    // and the change itself is one click away: the version allowed, beside this one
    vscode.window._warningAnswer = "Show Changes";
    vscode.commands._calls.length = 0;
    const looked = await run(f, 1);
    const diff = vscode.commands._calls.find((c) => c[0] === "vscode.diff");
    console.log(looked.blocked === "refused" && diff && diff[2].fsPath === side
      && fs.readFileSync(diff[1].fsPath, "utf8") === "def helper():\n    return 1\n"
      ? "PASS (python: 'Show Changes' opens the version allowed beside the changed one, and runs nothing)"
      : "UNEXPECTED show changes " + JSON.stringify({ looked, diff }));
    vscode.window._warningAnswer = "Run";
    await run(f, 1);

    // any Python file of the repository, named as a module — here one in
    // tools/, found by its name — asked about when a derivation first reaches it
    fs.mkdirSync(path.dirname(finance), { recursive: true });
    fs.writeFileSync(finance, "def revenue(units):\n    return units * 20\n");
    if (vscode.workspace._pyCreated) vscode.workspace._pyCreated({ fsPath: finance });
    const g = live(path.join(root, "Books.aot"), ["Books", "    rev: =finance.revenue(3)", "    n: =math.factorial(10)"]);
    vscode.workspace.textDocuments = [f.doc, g.doc];
    const reached = vscode.window._warnings.length;
    const approvesBefore = requests.filter((r) => r.op === "approve").length;
    await run(g, 0);
    const approveSent = requests.filter((r) => r.op === "approve").slice(approvesBefore);
    console.log(g.lines()[1] === "    rev: 60 =finance.revenue(3)" && g.lines()[2] === "    n: 3,628,800 =math.factorial(10)"
      && /^AOT: run the Python in Books\.aot\?/.test(vscode.window._warnings[reached] || "")
      && /^AOT: run tools\/finance\.py\? A Python derivation reaches it/.test(vscode.window._warnings[reached + 1] || "")
      && approveSent.length === 1 && Object.keys(approveSent[0].files)[0] === finance
      ? "PASS (python: a module anywhere in the repository runs once allowed, asked about by its own path)"
      : "UNEXPECTED repository module " + JSON.stringify({ lines: g.lines(), warnings: vscode.window._warnings.slice(reached), approveSent }));

    // changed on disk, outside the editor: what names it is stale, nothing else is
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(finance, "def revenue(units):\n    return units * 30\n");
    if (vscode.workspace._pyChanged) vscode.workspace._pyChanged({ fsPath: finance });
    vscode.workspace._open(g.doc);
    const gNotes = pyFindings(g.doc);
    console.log(gNotes.some((d) => d.range.a[0] === 1 && /something it reads changed/.test(d.message)) && !gNotes.some((d) => d.range.a[0] === 2)
      ? "PASS (python: a module changing makes stale the derivations that name it, and no other)"
      : "UNEXPECTED staleness after a module change " + JSON.stringify(gNotes.map((d) => [d.range.a[0], d.message])));
    const askedAgain = vscode.window._warnings.length;
    await run(g, 1);
    console.log(/^AOT: run tools\/finance\.py\?.*has changed since you last allowed it, and not in this editor/.test(vscode.window._warnings[askedAgain] || "")
      ? "PASS (python: a module changed outside the editor is asked about again)"
      : "UNEXPECTED changed module " + JSON.stringify(vscode.window._warnings.slice(askedAgain)));

    // saved in this editor: the writer's own edit, never asked about
    const pyDoc = { fileName: finance, languageId: "python", uri: { fsPath: finance, toString: () => "file:///" + finance.replace(/\\/g, "/") }, getText: () => "" };
    await vscode.workspace._willSave({ document: pyDoc, waitUntil: () => {} });
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(finance, "def revenue(units):\n    return units * 40\n");
    vscode.workspace._save(pyDoc);
    await new Promise((r) => setTimeout(r, 30));
    const beforeOwn = vscode.window._warnings.length;
    vscode.window._warningAnswer = undefined; // any question now would be a "no"
    await run(g, 1);
    const gHints = inlayProvider.provideInlayHints(g.doc, new vscode.Range(0, 0, 10, 0)).map((h) => h.label);
    console.log(vscode.window._warnings.length === beforeOwn && g.lines()[1] === "    rev: 60 =finance.revenue(3)"
      && gHints.some((label) => /^✓/.test(label)) && !gHints.some((label) => /^✗/.test(label))
      ? "PASS (python: a module saved in this editor runs without being asked about)"
      : "UNEXPECTED own edit asked about " + JSON.stringify(vscode.window._warnings.slice(beforeOwn)));
    vscode.window._warningAnswer = "Run";

    // Ctrl+click on the function a derivation calls opens the file it is
    // written in, at its def — the module's, or the one the sidecar imports
    // it from — and the callee is underlined as a link; nothing is run to
    // find out
    const booksSide = path.join(root, "aot.files", "Books.py");
    fs.writeFileSync(booksSide, "from finance import revenue as rev_of, other\n");
    g.set(g.text() + "\n    via: =rev_of(2) + len(@n) + math.floor(1)");
    const evalsAtLinks = requests.filter((r) => r.op === "eval").length;
    const links = documentLinkProvider.provideDocumentLinks(g.doc).filter((l) => /finance\.py$/i.test(l.target.fsPath || ""));
    const spanText = (l) => g.lines()[l.range.a[0]].slice(l.range.a[1], l.range.a[3]);
    console.log(links.length === 2 && spanText(links[0]) === "finance.revenue" && spanText(links[1]) === "rev_of"
      && links.every((l) => l.target.fragment === "L1")
      && /tools\/finance\.py line 1 — def revenue\(units\)/.test(links[0].tooltip)
      && requests.filter((r) => r.op === "eval").length === evalsAtLinks
      ? "PASS (python: a derivation's function is a link to its def — a module's, or one the sidecar imports; len and math are nobody's file)"
      : "UNEXPECTED python links " + JSON.stringify(links.map((l) => [l.range.a, spanText(l), l.tooltip, l.target])));
    g.set(g.text().replace("\n    via: =rev_of(2) + len(@n) + math.floor(1)", ""));
    fs.rmSync(booksSide);

    // what must never run anything: a save, a CSV arriving, a store arriving
    const quiet = ran();
    await vscode.workspace._willSave({ document: f.doc, waitUntil: (p) => p });
    vscode.workspace._save(f.doc);
    if (vscode.workspace._csvChanged) await vscode.workspace._csvChanged({ fsPath: path.join(root, "aot.files", "Sales.csv") });
    if (vscode.workspace._parkChanged) vscode.workspace._parkChanged({ fsPath: path.join(root, "aot.files", "Ledger.formulas") });
    await new Promise((r) => setTimeout(r, 50));
    console.log(ran() === quiet
      ? "PASS (python: a save, a CSV arriving and a store arriving run no Python)"
      : "UNEXPECTED Python ran from a save or a watcher " + JSON.stringify(requests.slice(-4)));

    // the park key: Python first, fresh, then the derivations leave
    const evalsAtPark = requests.filter((r) => r.op === "eval").length;
    await registeredCommands.get("aot.toggleFormulaPark")(f.editor);
    const store = path.join(root, "aot.files", "Ledger.formulas");
    const stored = fs.existsSync(store) ? fs.readFileSync(store, "utf8") : "";
    console.log(requests.filter((r) => r.op === "eval").length > evalsAtPark
      && /^@Sales: =frame\(\)$/m.test(stored) && /^@Report@n: =math\.factorial\(10\)$/m.test(stored)
      && f.lines()[2] === "    Sales|month  |units" && !/ =math|=frame/.test(f.text())
      ? "PASS (park: the key runs every Python derivation first, then parks it — a Concept's under its own name)"
      : "UNEXPECTED park with Python " + JSON.stringify({ stored, lines: f.lines() }));
    console.log(/PYTHON/.test(stored) && /^\/\/ Python values computed .* with python 3\.13\.0 · pandas 2\.2\.2$/m.test(stored)
      ? "PASS (park: the store says it holds code, and what computed its Python values)"
      : "UNEXPECTED store notice " + JSON.stringify(stored.split("\n").slice(0, 9)));
    const atUnpark = ran();
    await registeredCommands.get("aot.toggleFormulaPark")(f.editor);
    console.log(ran() === atUnpark && f.lines()[2] === "    Sales =frame()|month  |units"
      ? "PASS (park: putting the derivations back runs nothing)"
      : "UNEXPECTED unpark " + JSON.stringify({ ran: ran() - atUnpark, line: f.lines()[2] }));

    // the constraints: checked with the run, a breach warned on its value, a
    // '==' naming one value written into every value it defines — in a file
    // with no derivation at all
    const c = live(path.join(root, "Staff.aot"), [
      "Staff",
      "    age >=18",
      '    status ==("draft", "sent")',
      "    grade ==@level*2",
      "    - Ann",
      "        age: 30",
      "        status: void",
      "        level: 3",
      "        grade:",
      "    - Bob",
      "        age: 15",
      "        status: draft",
      "        level: 1,204",
      "        grade: 5",
    ]);
    vscode.workspace.textDocuments = [f.doc, g.doc, c.doc];
    const checkedRun = await run(c, 0);
    const cf = () => pyFindings(c.doc);
    const W = vscode.DiagnosticSeverity.Warning;
    console.log(checkedRun.broken === 2 && checkedRun.defined === 2
      && c.lines()[8] === "        grade: 6" && c.lines()[13] === "        grade: 2,408"
      && cf().some((d) => d.range.a[0] === 10 && d.severity === W && /^'15' breaks 'age >=18' — it is not >= 18$/.test(d.message))
      && cf().some((d) => d.range.a[0] === 6 && d.severity === W && /^'void' breaks 'status ==\("draft", "sent"\)' — it is not one of 'draft', 'sent'$/.test(d.message))
      && cf().filter((d) => d.severity === W).length === 2
      ? "PASS (constraints: Ctrl+Enter checks every bound, warns a breach on its value, and fills what a '==' defines)"
      : "UNEXPECTED constraint run " + JSON.stringify({ checkedRun, lines: c.lines(), findings: cf().map((d) => [d.range.a, d.message]) }));
    c.set(c.text().replace("        age: 15", "        age: 21"));
    vscode.workspace._open(c.doc);
    console.log(!cf().some((d) => d.range.a[0] === 10) && cf().some((d) => d.range.a[0] === 6)
      ? "PASS (constraints: an edit to a flagged value retires its warning until the next run)"
      : "UNEXPECTED stale constraint finding " + JSON.stringify(cf().map((d) => [d.range.a, d.message])));
    c.set(c.text().replace("    age >=18", "    age >=nobody"));
    await run(c, 0);
    console.log(cf().some((d) => d.range.a[0] === 1 && d.severity === vscode.DiagnosticSeverity.Error && /the bound 'age >=nobody' failed — NameError/.test(d.message))
      && cf().filter((d) => /age >=nobody/.test(d.message)).length === 1
      ? "PASS (constraints: a bound that fails is one error, on the clause that wrote it)"
      : "UNEXPECTED failing bound " + JSON.stringify(cf().map((d) => [d.range.a, d.message])));

    // a .aot's own Python, piece by piece: what is written here runs without
    // a question, saved or not; what arrives from outside — a pull, a store
    // coming home — is asked about
    {
      const kPath = path.join(root, "Keys.aot");
      const k = live(kPath, ["Keys", "    a: =math.factorial(3)"]);
      vscode.workspace.textDocuments = [f.doc, g.doc, c.doc, k.doc];
      vscode.window._warningAnswer = "Run";
      await run(k, 1);
      const n0 = vscode.window._warnings.length;
      vscode.window._warningAnswer = undefined; // any question now is a "no"
      k.set(k.text() + "\n    b: =math.factorial(4)");
      const typed = await run(k, 2);
      const typedOk = !typed.blocked && vscode.window._warnings.length === n0;
      await vscode.workspace._willSave({ document: k.doc, waitUntil: () => {} });
      fs.writeFileSync(kPath, k.text());
      const saved = await run(k, 2);
      const savedOk = !saved.blocked && vscode.window._warnings.length === n0;
      console.log(typedOk && savedOk
        ? "PASS (python: a derivation written in this editor runs without a question, before and after it is saved here)"
        : "UNEXPECTED typed code asked about " + JSON.stringify({ typed, saved, warnings: vscode.window._warnings.slice(n0) }));

      // a pull rewrites a line on disk, and the editor reloads it
      const pulled = k.text().replace("=math.factorial(4)", "=__import__('os').getpid()");
      fs.writeFileSync(kPath, pulled);
      k.set(pulled);
      const refusedPull = await run(k, 2);
      const pullQuestion = vscode.window._warnings.slice(n0).find((w) => /^AOT: run the Python in Keys\.aot\?/.test(w)) || "";
      console.log(refusedPull.blocked === "refused" && /1 derivation in it has not run here before/.test(pullQuestion) && /line 3: =__import__\('os'\)\.getpid\(\)/.test(pullQuestion)
        ? "PASS (python: a derivation a pull changed is asked about, naming the line and the code, and does not run unanswered)"
        : "UNEXPECTED pulled code " + JSON.stringify({ refusedPull, pullQuestion }));

      // parked, the store changed on disk, and brought home: asked about too
      vscode.window._warningAnswer = "Run";
      await registeredCommands.get("aot.toggleFormulaPark")(k.editor);
      const kStore = path.join(root, "aot.files", "Keys.formulas");
      fs.writeFileSync(kStore, fs.readFileSync(kStore, "utf8").replace("=math.factorial(3)", "=__import__('os').getcwd()"));
      await registeredCommands.get("aot.toggleFormulaPark")(k.editor);
      vscode.window._warningAnswer = undefined;
      const n1 = vscode.window._warnings.length;
      const refusedStore = await run(k, 1);
      const storeQuestion = vscode.window._warnings.slice(n1).find((w) => /^AOT: run the Python in Keys\.aot\?/.test(w)) || "";
      console.log(k.lines()[1] === "    a: =__import__('os').getcwd()" && refusedStore.blocked === "refused" && /getcwd/.test(storeQuestion)
        ? "PASS (python: a derivation brought home from a store that changed on disk is asked about before it runs)"
        : "UNEXPECTED store code " + JSON.stringify({ lines: k.lines(), refusedStore, storeQuestion }));
      vscode.window._warningAnswer = "Run";
    }

    // AOT: Set Up Python Environment, against a fake uv: the project made in
    // aot.files, the lock reviewed before anything installs, exactly the lock
    // installed from built wheels, and the environment's own interpreter
    // started isolated — and only as it was set up here
    {
      const uvCalls = [];
      let lockChecks = 0;
      const projectOf = (args) => args[args.indexOf("--project") + 1];
      const fakeUv = (cmd, args, opts) => {
        uvCalls.push(args.join(" "));
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = () => {};
        let code = 0, out = "";
        if (args[0] === "--version") out = "uv 0.11.17\n";
        else if (args[0] === "lock" && args.includes("--check")) code = lockChecks++ === 0 ? 1 : 0;
        else if (args[0] === "lock") {
          fs.writeFileSync(path.join(projectOf(args), "uv.lock"), [
            "version = 1", "", "[[package]]", 'name = "aot-python"', 'version = "0.1.0"', 'source = { virtual = "." }', "",
            "[[package]]", 'name = "pandas"', 'version = "3.0.6"', 'source = { registry = "https://pypi.org/simple" }', "",
            "[[package]]", 'name = "helper"', 'version = "0.2.0"', 'source = { git = "https://example.com/helper.git" }', "",
          ].join("\n"));
        } else if (args[0] === "sync") {
          const exe = require("../src/uvenv").venvPython(projectOf(args), process.platform);
          fs.mkdirSync(path.dirname(exe), { recursive: true });
          if (!fs.existsSync(exe)) fs.writeFileSync(exe, "the environment's own python");
        }
        setImmediate(() => { if (out) proc.stdout.emit("data", out); proc.emit("close", code); });
        return proc;
      };
      ext._test.setSpawn((cmd, args, opts) => (cmd === "uv" ? fakeUv(cmd, args, opts) : fakeRuntime(cmd, args, opts)));
      const setUp = plainCommands.get("aot.setUpPython");
      const activeBefore = vscode.window.activeTextEditor;
      vscode.window.activeTextEditor = c.editor;
      const afDir = path.join(root, "aot.files");
      const venvExe = require("../src/uvenv").venvPython(afDir, process.platform);

      vscode.window._warningAnswer = undefined;
      const asked = vscode.window._warnings.length;
      const first = await setUp();
      const question = vscode.window._warnings[asked] || "";
      console.log(!first.ok && fs.existsSync(path.join(afDir, "pyproject.toml"))
        && /"pandas",\n {4}"numpy",\n {4}"matplotlib",/.test(fs.readFileSync(path.join(afDir, "pyproject.toml"), "utf8"))
        && /^AOT: install 2 Python packages into aot\.files\/\.venv\? pandas 3\.0\.6, helper 0\.2\.0\. 1 of them come from outside PyPI — helper \(git https:\/\/example\.com\/helper\.git\)/.test(question)
        && /Only built wheels are installed/.test(question)
        && JSON.stringify(vscode.window._warningItems) === JSON.stringify(["Install", "Open uv.lock"])
        && uvCalls.includes(`lock --project ${afDir} --no-build`) && !uvCalls.some((a) => a.startsWith("sync"))
        ? "PASS (uv: a new project in aot.files, locked from built wheels, and every package shown — the one from outside PyPI named — before anything installs)"
        : "UNEXPECTED uv review " + JSON.stringify({ first, question, uvCalls, items: vscode.window._warningItems }));

      vscode.window._warningAnswer = "Install";
      const second = await setUp();
      console.log(second.ok && uvCalls.includes(`sync --project ${afDir} --locked --no-build --no-install-project --compile-bytecode`) && fs.existsSync(venvExe)
        ? "PASS (uv: once allowed, exactly the lock is installed — --locked, --no-build)"
        : "UNEXPECTED uv install " + JSON.stringify({ second, uvCalls }));
      const askedAfter = vscode.window._warnings.length;
      const third = await setUp();
      console.log(third.ok && vscode.window._warnings.length === askedAfter
        ? "PASS (uv: an unchanged project installs again without asking)"
        : "UNEXPECTED uv asked again " + JSON.stringify(vscode.window._warnings.slice(askedAfter)));

      vscode.window._warningAnswer = "Run";
      await run(c, 0);
      const opened = requests.filter((r) => r.op === "open").pop();
      console.log(lastSpawn && lastSpawn.cmd === venvExe && lastSpawn.args[0] === "-I" && !lastSpawn.args.includes("-E")
        && opened && /^add it to aot\.files\/pyproject\.toml, then run AOT: Set Up Python Environment$/.test(opened.install)
        ? "PASS (uv: the derivations run in the environment's own interpreter, isolated, and a missing library says how to add it)"
        : "UNEXPECTED uv run " + JSON.stringify({ lastSpawn, install: opened && opened.install }));

      // the interpreter changed since it was set up: not run
      for (const e of ext._test.sessions.values()) e.session.kill("test");
      fs.writeFileSync(venvExe, "somebody else's python");
      const errorsBefore = vscode.window._errors.length;
      const spawnsBefore = spawns;
      await run(c, 0);
      console.log(spawns === spawnsBefore && /changed since it was set up here/.test(vscode.window._errors[errorsBefore] || "")
        ? "PASS (uv: an environment whose interpreter changed since it was set up here is never started)"
        : "UNEXPECTED tampered interpreter " + JSON.stringify({ errors: vscode.window._errors.slice(errorsBefore), spawned: spawns - spawnsBefore }));

      // set up again, and then the project moves on: the run says so, once
      vscode.window._warningAnswer = "Install";
      fs.writeFileSync(path.join(afDir, "uv.lock"), fs.readFileSync(path.join(afDir, "uv.lock"), "utf8") + "\n");
      const again = await setUp();
      fs.appendFileSync(path.join(afDir, "pyproject.toml"), "# pulled\n");
      vscode.window._warningAnswer = "Run";
      const warnedBefore = vscode.window._warnings.length;
      await run(c, 0);
      const drift = vscode.window._warnings.slice(warnedBefore).filter((w) => /changed since the environment was set up/.test(w));
      await run(c, 0);
      const driftAgain = vscode.window._warnings.slice(warnedBefore).filter((w) => /changed since the environment was set up/.test(w));
      console.log(again.ok && drift.length === 1 && driftAgain.length === 1 && fs.readFileSync(venvExe, "utf8") !== "somebody else's python"
        ? "PASS (uv: a set-up replaces an environment it did not make; a project changed since, by a pull, is said once, and the run goes on)"
        : "UNEXPECTED uv drift " + JSON.stringify({ again, drift, driftAgain }));

      ext._test.setSpawn(fakeRuntime);
      vscode.window.activeTextEditor = activeBefore;
      for (const e of ext._test.sessions.values()) e.session.kill("test");
      for (const f of ["pyproject.toml", "uv.lock", ".venv"]) fs.rmSync(path.join(afDir, f), { recursive: true, force: true });
    }

    // a file with no Python keeps Ctrl+Enter's own meaning
    const plain = live(path.join(root, "Plain.aot"), ["Plain", "    a: 1"]);
    vscode.commands._calls.length = 0;
    await run(plain, 1);
    console.log(vscode.commands._calls.some((c) => c[0] === "editor.action.insertLineAfter")
      ? "PASS (python: in a file with no Python, Ctrl+Enter inserts a line as it always did)"
      : "UNEXPECTED Ctrl+Enter without Python " + JSON.stringify(vscode.commands._calls));

    ext.deactivate();
    console.log(ext._test.sessions.size === 0
      ? "PASS (python: every session ends with the extension)"
      : "UNEXPECTED sessions left " + ext._test.sessions.size);
  } catch (e) {
    console.log("UNEXPECTED python block threw " + (e && e.stack));
  } finally {
    delete configStore["python.enabled"];
    vscode.window._warningAnswer = undefined;
    vscode.workspace.textDocuments = [];
    vscode.workspace.workspaceFolders = before;
    ext._test.setSpawn(null);
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 5000);
