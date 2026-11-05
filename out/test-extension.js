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
  CodeActionTriggerKind: { Invoke: 1, Automatic: 2 },
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
  CompletionItemKind: { Field: 4, EnumMember: 19, Function: 2, Module: 8, Value: 11, Constant: 20 },
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
  TextEdit: {
    replace: (range, text) => ({ range, text }),
    delete: (range) => ({ range, text: "" }),
    insert: (pos, text) => ({ range: new vscode.Range(pos.line, pos.character, pos.line, pos.character), text }),
  },
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
  TextDocumentChangeReason: { Undo: 1, Redo: 2 },
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
    onDidChangeVisibleTextEditors: (fn) => { vscode.window._visibleChanged = fn; return { dispose() {} }; },
    onDidChangeTextEditorSelection: (fn) => { vscode.window._selectionChanged = fn; return { dispose() {} }; },
    onDidChangeActiveTextEditor: (fn) => { vscode.window._activeChanged = fn; return { dispose() {} }; },
    onDidChangeWindowState: (fn) => { vscode.window._windowState = fn; return { dispose() {} }; },
    // the answer a test sets is the button the user "presses"; the items
    // offered are recorded beside the message. An answer keyed to a message
    // (_answers: [{ test: RegExp, answer }]) is pressed for that message
    // alone, whatever another block has set meanwhile
    _answers: [],
    showWarningMessage: (m, ...items) => {
      vscode.window._warnings.push(m);
      vscode.window._warningItems = items.filter((i) => typeof i === "string");
      vscode.window._warningModal = items.some((i) => i && typeof i === "object" && i.modal);
      const keyed = vscode.window._answers.find((a) => a.test.test(m));
      return Promise.resolve(keyed ? keyed.answer : vscode.window._warningAnswer);
    },
    showInformationMessage: (m, ...rest) => {
      vscode.window._info.push(m);
      vscode.window._infoItems = rest.filter((i) => typeof i === "string");
      const opts = rest.find((r) => r && typeof r === "object");
      if (opts && opts.detail) vscode.window._infoDetail = opts.detail;
      const keyed = vscode.window._answers.find((a) => a.test.test(m));
      return Promise.resolve(keyed ? keyed.answer : undefined);
    },
    showErrorMessage: (m, ...items) => {
      vscode.window._errors.push(m);
      vscode.window._errorItems = items.filter((i) => typeof i === "string");
      const keyed = vscode.window._answers.find((a) => a.test.test(m));
      return Promise.resolve(keyed ? keyed.answer : undefined);
    },
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
    // TextEdits for one document, applied by character offset as VS Code does
    set(uri, edits) { for (const e of edits) this.ops.push({ type: "text", uri, range: e.range, text: e.text }); }
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
        // a save fires the save event, as the real one does: what the mirror
        // does on a save is half of what a fold does
        save: async () => {
          fs.writeFileSync(p, doc.lines.join("\n"));
          if (vscode.workspace._save) vscode.workspace._save(doc);
        },
      };
      doc.uri = { fsPath: p, toString: () => "file:///" + p, __doc: doc };
      return doc;
    },
    applyEdit: async (edit) => {
      // TextEdits set on a document: by offset, last first, so earlier ones hold
      const texts = edit.ops.filter((op) => op.type === "text" && op.uri.__doc);
      for (const doc of new Set(texts.map((op) => op.uri.__doc))) {
        let text = doc.lines.join("\n");
        const at = (line, ch) => doc.lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + ch;
        const mine = texts.filter((op) => op.uri.__doc === doc)
          .map((op) => ({ from: at(op.range.a[0], op.range.a[1]), to: at(op.range.a[2], op.range.a[3]), text: op.text }))
          .sort((x, y) => y.from - x.from);
        for (const e of mine) text = text.slice(0, e.from) + e.text + text.slice(e.to);
        doc.lines = text.split("\n");
      }
      for (const op of edit.ops) {
        const doc = op.uri.__doc;
        if (!doc || op.type === "text") continue; // a makeDoc fixture is a read-only snapshot
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
    && /^add it as an Example of 'Person', or use one already listed — 'James' is not an Example of Concept 'Person': its Examples are Socrates/.test(james.message);
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
    // 53 table and formula commands (AutoSum went with the formula language;
    // Define Column joined them), plus Ctrl+Alt+F9's fresh calculation
    console.log(ok && registeredCommands.size === 54
      ? "PASS (table editor: 54 commands; Tab aligns and moves to the next cell)"
      : "UNEXPECTED table editor " + JSON.stringify({ n: registeredCommands.size, applied, sel: editor.selection.a }));
  });
}

// 5b) Tab travels the cells from ANYWHERE in a row, and never indents one:
// a table nests through its `parent (thing)` column, so there is no indent
// a key could mean — with lines selected Tab still moves to the next cell.
// Off a table it is VS Code's own Tab, selected or not, as in any other file.
(async () => {
  const lines = [
    "Otter|parent (otter)|size",
    "Ollie|              |5",
    "Pup  |Ollie         |1",
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
    // the head of the sub-Example's name
    selection: new vscode.Selection(2, 0, 2, 0),
    edit: (cb) => {
      cb({ replace: (range, t) => { const [sl, , el] = range.a; lines.splice(sl, el - sl + 1, ...t.split("\n")); } });
      return Promise.resolve(true);
    },
    revealRange: () => {},
    setDecorations: () => {},
  };
  registeredCommands.get("aot.table.nextCell")(editor);
  await new Promise((r) => setImmediate(r));
  // nothing moved but the cursor, which is now in the parent cell
  const kept = lines.join("\n") === written;
  const toNext = editor.selection.active.line === 2 && editor.selection.active.character === 6;
  registeredCommands.get("aot.table.prevCell")(editor);
  await new Promise((r) => setImmediate(r));
  const back = lines.join("\n") === written
    && editor.selection.active.line === 2 && editor.selection.active.character === 0;
  // rows selected: still the next cell, and no indent
  editor.selection = new vscode.Selection(1, 0, 2, 0);
  vscode.commands._calls.length = 0;
  registeredCommands.get("aot.table.nextCell")(editor);
  await new Promise((r) => setImmediate(r));
  const noIndent = lines.join("\n") === written
    && !vscode.commands._calls.some((c) => c[0] === "editor.action.indentLines")
    && editor.selection.active.line === 2 && editor.selection.active.character === 6;
  // line form: VS Code's own Tab and Shift+Tab, selected or not
  lines.splice(0, lines.length, "Otter", "    - Ollie", "    - Pup");
  editor.selection = new vscode.Selection(1, 0, 2, 0);
  vscode.commands._calls.length = 0;
  registeredCommands.get("aot.table.nextCell")(editor);
  await new Promise((r) => setImmediate(r));
  const lineTab = vscode.commands._calls.some((c) => c[0] === "tab");
  vscode.commands._calls.length = 0;
  registeredCommands.get("aot.table.prevCell")(editor);
  await new Promise((r) => setImmediate(r));
  const lineOutdent = vscode.commands._calls.some((c) => c[0] === "outdent");
  console.log(kept && toNext && back && noIndent && lineTab && lineOutdent
    ? "PASS (table editor: Tab travels the cells and indents nothing, selected or not; off a table Tab and Shift+Tab are VS Code's own)"
    : "UNEXPECTED table indent " + JSON.stringify({ lines, kept, toNext, back, noIndent, lineTab, lineOutdent, sel: editor.selection.a }));
})();

// 5b2) the manifest gates Tab and Shift+Tab on a table row, and nowhere else
{
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const when = (key) => manifest.contributes.keybindings.find((k) => k.key === key).when;
  console.log(/aot\.inTable/.test(when("tab")) && !/aot\.inGrid/.test(when("tab"))
    && /aot\.inTable/.test(when("shift+tab")) && !/aot\.inGrid/.test(when("shift+tab"))
    ? "PASS (keys: Tab and Shift+Tab are the table's only on a table row)"
    : "UNEXPECTED Tab binding " + JSON.stringify([when("tab"), when("shift+tab")]));
}

// 5b2a) Ctrl+/ writes the language's own `...`, and there is no block comment
{
  const config = fs.readFileSync(path.join(__dirname, "..", "language-configuration.json"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const comments = JSON.parse(config).comments;
  console.log(comments.lineComment === "..." && !comments.blockComment
    ? "PASS (keys: Ctrl+/ makes a '...' line)"
    : "UNEXPECTED comment config " + JSON.stringify(comments));
}

// 5b2b) a flip that would lose a value stops, changes nothing, and says where;
// the next edit clears what it said
(async () => {
  const lines = ["Order", "    - A1", "        tag: red", "        tag: blue"];
  const doc = {
    languageId: "aot", fileName: "c:\\repo\\Stopped.aot", eol: vscode.EndOfLine.LF,
    uri: { toString: () => "file:///stopped" },
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  let edited = false;
  const editor = {
    document: doc, selection: new vscode.Selection(0, 0, 0, 0),
    edit: () => { edited = true; return Promise.resolve(true); },
    revealRange: () => {}, setDecorations: () => {},
  };
  await registeredCommands.get("aot.toggleTableForm")(editor);
  const said = (publishedByName.get("aot-flip") || new Map()).get(doc.uri.toString()) || [];
  const stopped = !edited && said.length === 2 && said[0].severity === vscode.DiagnosticSeverity.Error
    && /^keep one value for 'tag' on 'A1' before flipping/.test(said[0].message) && said[0].range.a[0] === 2;
  vscode.workspace._changed({ document: doc, contentChanges: [] });
  const cleared = !(publishedByName.get("aot-flip").get(doc.uri.toString()) || []).length;
  console.log(stopped && cleared
    ? "PASS (flip: a shape a table has no place for stops it, on the exact lines, until the next edit)"
    : "UNEXPECTED flip stop " + JSON.stringify({ edited, said: said.map((d) => d.message), cleared }));
})();

// 5b3) several cursors: Tab, Shift+Tab and Enter move each one in its own row,
// a row grown at the bottom shifts no cursor above; one off a table hands the
// key back to VS Code
(async () => {
  const start = ["Pet|age|size", "Rex|1  |2", "Tom|3  |4"];
  let lines = start.slice();
  const offset = (l, c) => lines.slice(0, l).reduce((n, s) => n + s.length + 1, 0) + c;
  const doc = {
    languageId: "aot", fileName: "c:\\repo\\Multi.aot", eol: vscode.EndOfLine.LF,
    uri: { toString: () => "file:///multi" },
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  const editor = {
    document: doc,
    selection: new vscode.Selection(1, 0, 1, 0),
    selections: [new vscode.Selection(1, 0, 1, 0), new vscode.Selection(2, 0, 2, 0)],
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
  const where = () => editor.selections.map((s) => `${s.active.line}:${s.active.character}`).join();
  await registeredCommands.get("aot.table.nextCell")(editor);
  const tabbed = where() === "1:4,2:4" && lines.join("\n") === start.join("\n");
  editor.selection = editor.selections[0];
  await registeredCommands.get("aot.table.prevCell")(editor);
  const backed = where() === "1:0,2:0";
  editor.selection = editor.selections[0];
  // Enter on the bottom row grows one row; the cursor above only steps down
  await registeredCommands.get("aot.table.nextRow")(editor);
  const entered = where() === "2:0,3:0" && lines.length === 4;
  // one cursor in free text: the key is VS Code's, and nothing is redrawn
  lines = ["Pet|age", "Rex|1", "Note"];
  editor.selection = new vscode.Selection(1, 0, 1, 0);
  editor.selections = [new vscode.Selection(1, 0, 1, 0), new vscode.Selection(2, 0, 2, 0)];
  vscode.commands._calls.length = 0;
  await registeredCommands.get("aot.table.nextCell")(editor);
  const handedBack = vscode.commands._calls.some((c) => c[0] === "tab");
  console.log(tabbed && backed && entered && handedBack
    ? "PASS (table editor: several cursors move together; one off a table hands the key back)"
    : "UNEXPECTED multi-cursor " + JSON.stringify({ tabbed, backed, entered, handedBack, at: where(), lines }));
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
// Concept; a CSV edit folds back; an orphaned CSV is archived with '_' (never
// deleted).
(async () => {
  // a fresh folder outside the repository: a file-syncing client (OneDrive)
  // watching the repository can write an earlier run's copy back into a
  // fixture kept there, mid-test
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "aot-sync-"));
  // the fixture is a repository of its own: 'aot.files' hangs off the root
  // the '.git' marks, and without one the walk would climb out of the
  // fixture and into whatever repository holds it
  fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  const aotPath = path.join(tmp, "World.aot");
  const aotText = [
    "Otter",
    "    Otter | size",
    "    Ollie | 5",
  ].join("\n");
  fs.writeFileSync(aotPath, aotText);

  // a CSV no Concept speaks for
  const dir = path.join(tmp, "aot.files");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "Ghost.csv"), "name\nBoo\n");

  // save the .aot -> aot.files/Otter.csv appears; the orphaned Ghost.csv is
  // archived as _Ghost.csv
  vscode.workspace._save(makeDoc(aotPath, aotText));
  const csvPath = path.join(dir, "Otter.csv");
  const written = fs.existsSync(csvPath) && fs.readFileSync(csvPath, "utf8");
  console.log(written === "Otter,size\nOllie,5\n"
    ? "PASS (csv mirror: saving writes aot.files/<Concept>.csv at the workspace root)"
    : "UNEXPECTED csv written: " + JSON.stringify(written));
  console.log(!fs.existsSync(path.join(dir, "Ghost.csv")) && fs.existsSync(path.join(dir, "_Ghost.csv"))
    ? "PASS (csv mirror: an orphan is archived _Ghost.csv, not deleted)"
    : "UNEXPECTED orphan state " + JSON.stringify(fs.existsSync(dir) && fs.readdirSync(dir)));

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
// place.
(async () => {
  const os = require("os");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "aot-onefolder-"));
  fs.mkdirSync(path.join(repo, ".git"));
  const sub = path.join(repo, "sub");
  fs.mkdirSync(sub);

  const dir = path.join(repo, "aot.files");
  fs.mkdirSync(dir);

  const aotPath = path.join(sub, "Deep.aot");
  const aotText = ["Otter", "    Otter | size", "    Ollie | 5"].join("\n");
  fs.writeFileSync(aotPath, aotText);

  // the workspace is the subfolder, and the CSV still goes to the root
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: sub } }];
  vscode.workspace._save(makeDoc(aotPath, aotText));
  console.log(fs.existsSync(path.join(dir, "Otter.csv")) && !fs.existsSync(path.join(sub, "aot.files"))
    ? "PASS (one folder: the CSV lands at the repository root, not at the opened subfolder)"
    : "UNEXPECTED mirror location " + JSON.stringify(fs.readdirSync(repo)));

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
// would wait for the next save of its .aot, which overwrites it. On activation
// — and from 'aot.importCsvFiles' by hand — the folder is caught up: a CSV
// saved after its .aot folds in, an unchanged one costs nothing, and an
// archived '_' file is left alone exactly as the watcher leaves it. The command is given its root, so this holds no global and
// races with nothing else here.
(async () => {
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aot-catchup-"));
  const dir = path.join(root, "aot.files");
  fs.mkdirSync(dir);
  const aotPath = path.join(root, "Numbers.aot");
  fs.writeFileSync(aotPath, ["Integer", "    - 1", "        is prime: Yes"].join("\n"));
  const importCsvs = () => plainCommands.get("aot.importCsvFiles")(root);
  // a CSV saved after everything so far, whatever the clock's tick says
  let later = Date.now() / 1000;
  const saveCsv = (text) => {
    fs.writeFileSync(path.join(dir, "Integer.csv"), text);
    later += 10;
    fs.utimesSync(path.join(dir, "Integer.csv"), later, later);
  };

  // the editor was closed for this edit: no watcher heard it
  saveCsv("Integer,is prime\n1,Yes\n7,Yes\n");
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
  saveCsv("\uFEFFInteger,is prime\r\n1,Yes\r\n7,Yes\r\n13,Yes\r\n");
  const fromExcel = await importCsvs();
  const excelAfter = fs.readFileSync(aotPath, "utf8").split(/\r?\n/);
  console.log(fromExcel === 1 && excelAfter[5] === "    - 13" && excelAfter[6] === "        is prime: Yes"
    ? "PASS (csv catch-up: a BOM'd CRLF file from Excel folds in as the grid it is)"
    : "UNEXPECTED excel catch-up " + JSON.stringify({ fromExcel, excelAfter }));

  // a semicolon file, which is all Excel writes where the comma is the
  // decimal mark, folds in exactly as a comma one does
  saveCsv("Integer;is prime\n1;Yes\n7;Yes\n13;Yes\n21;No\n");
  const semi = await importCsvs();
  const semiAfter = fs.readFileSync(aotPath, "utf8").split(/\r?\n/);
  console.log(semi === 1 && semiAfter[7] === "    - 21" && semiAfter[8] === "        is prime: No"
    ? "PASS (csv catch-up: a semicolon-delimited file from Excel folds in too)"
    : "UNEXPECTED semicolon catch-up " + JSON.stringify({ semi, semiAfter }));

  fs.rmSync(root, { recursive: true, force: true });
})();


// 6b9) the CSV mirror's data-loss cases: every edit in every CSV arrives, with
// the .aot open or closed, the editor running or not, a diff open or not
(async () => {
  const os = require("os");
  const fresh = (name) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `aot-${name}-`));
    fs.mkdirSync(path.join(root, ".git"));
    const dir = path.join(root, "aot.files");
    fs.mkdirSync(dir);
    return { root, dir };
  };
  const ago = (file, seconds) => { const t = new Date(Date.now() - seconds * 1000); fs.utimesSync(file, t, t); };
  const read = (file) => fs.readFileSync(file, "utf8");
  const sync = (root) => plainCommands.get("aot.importCsvFiles")(root);

  // two CSVs of one .aot edited with the editor closed: both arrive, and
  // neither is overwritten by the save the other's fold makes
  {
    const { root, dir } = fresh("two-csvs");
    const aot = path.join(root, "Shop.aot");
    fs.writeFileSync(aot, ["Pet|age", "Rex|1", "", "Toy|price", "Ball|2", ""].join("\n"));
    fs.writeFileSync(path.join(dir, "Pet.csv"), "Pet,age\nRex,9\n");
    fs.writeFileSync(path.join(dir, "Toy.csv"), "Toy,price\nBall,7\n");
    ago(aot, 60);
    await sync(root);
    const text = read(aot);
    console.log(/Rex\|9/.test(text) && /Ball\|7/.test(text)
      && read(path.join(dir, "Pet.csv")) === "Pet,age\nRex,9\n" && read(path.join(dir, "Toy.csv")) === "Toy,price\nBall,7\n"
      ? "PASS (csv: two CSVs edited while closed both reach the .aot, and neither is overwritten)"
      : "UNEXPECTED two csvs " + JSON.stringify({ text, pet: read(path.join(dir, "Pet.csv")), toy: read(path.join(dir, "Toy.csv")) }));

    // the same with the editor running: a script saving both at once
    fs.writeFileSync(path.join(dir, "Pet.csv"), "Pet,age\nRex,3\n");
    fs.writeFileSync(path.join(dir, "Toy.csv"), "Toy,price\nBall,4\n");
    await Promise.all([vscode.workspace._csvChanged({ fsPath: path.join(dir, "Pet.csv") }), vscode.workspace._csvChanged({ fsPath: path.join(dir, "Toy.csv") })]);
    const live = read(aot);
    console.log(/Rex\|3/.test(live) && /Ball\|4/.test(live)
      ? "PASS (csv: two CSVs saved at once with the editor running both arrive)"
      : "UNEXPECTED two csvs live " + JSON.stringify(live));

    // a person's save of the .aot is a save: it wins over a CSV older than it
    fs.writeFileSync(path.join(dir, "Pet.csv"), "Pet,age\nRex,100\n");
    ago(path.join(dir, "Pet.csv"), 60);
    fs.writeFileSync(aot, live);
    await sync(root);
    console.log(/Rex\|3/.test(read(aot)) && read(path.join(dir, "Pet.csv")) === "Pet,age\nRex,3\n"
      ? "PASS (csv: the rule stands — a .aot a person saved later overrides an older CSV)"
      : "UNEXPECTED rule " + JSON.stringify({ aot: read(aot), csv: read(path.join(dir, "Pet.csv")) }));
    fs.rmSync(root, { recursive: true, force: true });
  }

  // an open diff: the read-only `git:` copy of the file is not the file
  {
    const { root, dir } = fresh("diff");
    const aot = path.join(root, "Shop.aot");
    fs.writeFileSync(aot, ["Pet|age", "Rex|1", ""].join("\n"));
    fs.writeFileSync(path.join(dir, "Pet.csv"), "Pet,age\nRex,1\n");
    const old = ["Pet|age", "Rex|0", ""].join("\n");
    const copy = {
      languageId: "aot", fileName: aot, eol: vscode.EndOfLine.LF, isDirty: false,
      uri: { scheme: "git", fsPath: aot, toString: () => "git:/" + aot },
      lineCount: 3, getText: () => old,
      lineAt: (i) => { const l = old.split("\n")[i]; return { range: new vscode.Range(i, 0, i, l.length), text: l }; },
      save: async () => { throw new Error("a git: copy cannot be saved"); },
    };
    vscode.workspace.textDocuments.push(copy);
    const pick = ext._test.openDocFor(aot);
    fs.writeFileSync(path.join(dir, "Pet.csv"), "Pet,age\nRex,9\n");
    await vscode.workspace._csvChanged({ fsPath: path.join(dir, "Pet.csv") });
    vscode.workspace.textDocuments.splice(vscode.workspace.textDocuments.indexOf(copy), 1);
    console.log(pick === null && /Rex\|9/.test(read(aot)) && read(path.join(dir, "Pet.csv")) === "Pet,age\nRex,9\n"
      ? "PASS (csv: a diff open on the file changes nothing — the edit reaches the real file, and the CSV keeps it)"
      : "UNEXPECTED diff " + JSON.stringify({ picked: !!pick, aot: read(aot), csv: read(path.join(dir, "Pet.csv")) }));
    fs.rmSync(root, { recursive: true, force: true });
  }

  // a line break in an Excel cell stays one cell, and comes back a line break
  {
    const { root, dir } = fresh("line-break");
    const aot = path.join(root, "Notes.aot");
    fs.writeFileSync(aot, ["Pet|note", "Rex|old", ""].join("\n"));
    const csv = path.join(dir, "Pet.csv");
    fs.writeFileSync(csv, 'Pet,note\nRex,"Line 1\nLine 2"\n');
    await vscode.workspace._csvChanged({ fsPath: csv });
    const text = read(aot);
    const parsed = lint(text, "Notes");
    console.log(/^Rex\|Line 1↵Line 2$/m.test(text) && parsed.errors.length === 0
      && parsed.nodes.filter((n) => n.kind === 0).length === 1 && read(csv) === 'Pet,note\nRex,"Line 1\nLine 2"\n'
      ? "PASS (csv: a line break in a cell stays one row, and survives the round trip)"
      : "UNEXPECTED line break " + JSON.stringify({ text, csv: read(csv) }));
    fs.rmSync(root, { recursive: true, force: true });
  }

  // a new row's name is data: it stays a row with that name, and never code
  {
    const { root, dir } = fresh("row-names");
    const aot = path.join(root, "Day.aot");
    fs.writeFileSync(aot, ["Event|room", "Lunch|A", ""].join("\n"));
    const csv = path.join(dir, "Event.csv");
    fs.writeFileSync(csv, "Event,room\nLunch,A\n10:30 Standup,B\n=x(),C\nstandup: late,D\n... rest,E\n");
    await vscode.workspace._csvChanged({ fsPath: csv });
    const text = read(aot);
    const parsed = lint(text, "Day");
    const rows = parsed.nodes.filter((n) => n.kind === 0).map((n) => n.name);
    const hosts = require("../src/python").hostsOf(parsed.nodes, text.split(/\r?\n/), "Day");
    console.log(parsed.errors.length === 0 && !hosts.length && rows.join("|") === "Lunch|10:30 Standup|＝x()|standup： late|… rest"
      && !/^=/m.test(text) && /10:30 Standup,B/.test(read(csv))
      ? "PASS (csv: a new row's name stays a row, unchanged where it can be, and never becomes code)"
      : "UNEXPECTED row names " + JSON.stringify({ rows, hosts: hosts.length, errors: parsed.errors.map((e) => e.message), csv: read(csv) }));
    fs.rmSync(root, { recursive: true, force: true });
  }

  // a name a file name cannot hold: the Concept that writes the file answers
  {
    const { root, dir } = fresh("slash");
    const aot = path.join(root, "Io.aot");
    fs.writeFileSync(aot, ["Input/Output|rate", "Disk|1", "", "Is it valid?|ok", "A|no", ""].join("\n"));
    const slash = path.join(dir, "Input-Output.csv"), mark = path.join(dir, "Is it valid-.csv");
    fs.writeFileSync(slash, "Input/Output,rate\nDisk,5\n");
    await vscode.workspace._csvChanged({ fsPath: slash });
    fs.writeFileSync(mark, "Is it valid?,ok\nA,yes\n");
    ago(aot, 60);
    await sync(root);
    const text = read(aot);
    console.log(/^Disk *\|5$/m.test(text) && /^A *\|yes$/m.test(text) && read(slash) === "Input/Output,rate\nDisk,5\n"
      ? "PASS (csv: 'Input/Output' and 'Is it valid?' sync through the files their names write)"
      : "UNEXPECTED slash " + JSON.stringify({ text, csv: read(slash) }));
    fs.rmSync(root, { recursive: true, force: true });
  }

  // two Concepts one file name: neither writes over the other, and it is said
  {
    const { root, dir } = fresh("shared-csv");
    const aot = path.join(root, "Both.aot");
    const body = ["Input/Output|rate", "Disk|1", "", "Input-Output|cost", "Tape|2", ""].join("\n");
    fs.writeFileSync(aot, body);
    const csv = path.join(dir, "Input-Output.csv");
    fs.writeFileSync(csv, "keep me\n");
    vscode.window._warnings.length = 0;
    vscode.workspace._save(makeDoc(aot, body));
    console.log(read(csv) === "keep me\n" && vscode.window._warnings.some((w) => /^AOT: rename one — .*would both write Input-Output\.csv/.test(w))
      ? "PASS (csv: two Concepts writing one file overwrite nothing, and say so)"
      : "UNEXPECTED shared csv " + JSON.stringify({ csv: read(csv), warned: vscode.window._warnings }));
    fs.rmSync(root, { recursive: true, force: true });
  }

  // a model in a folder named `out` is a model like any other
  {
    const { root, dir } = fresh("out-folder");
    fs.mkdirSync(path.join(root, "reports", "out"), { recursive: true });
    const aot = path.join(root, "reports", "out", "Q3.aot");
    fs.writeFileSync(aot, ["Quarter|sales", "Q3|1", ""].join("\n"));
    const csv = path.join(dir, "Quarter.csv");
    fs.writeFileSync(csv, "Quarter,sales\nQ3,5\n");
    await vscode.workspace._csvChanged({ fsPath: csv });
    const other = path.join(root, "Other.aot");
    fs.writeFileSync(other, "Thing\n    - A\n");
    vscode.workspace._save(makeDoc(other, "Thing\n    - A\n"));
    console.log(/^Q3 *\|5$/m.test(read(aot)) && fs.existsSync(csv) && !fs.existsSync(path.join(dir, "_Quarter.csv"))
      ? "PASS (csv: a model in a folder named 'out' syncs, and its CSV is not archived)"
      : "UNEXPECTED out folder " + JSON.stringify({ aot: read(aot), dir: fs.readdirSync(dir) }));
    fs.rmSync(root, { recursive: true, force: true });
  }

  // a Concept taken out of one of two files: its rows stay gone
  {
    const { root, dir } = fresh("left-behind");
    const a = path.join(root, "A.aot"), b = path.join(root, "B.aot");
    const aBefore = ["Pet|age", "Rex|1", "", "Toy|price", "Ball|2", ""].join("\n");
    const bText = ["Pet|age", "Tom|2", ""].join("\n");
    fs.writeFileSync(a, aBefore);
    fs.writeFileSync(b, bText);
    vscode.workspace._save(makeDoc(a, aBefore));
    const csv = path.join(dir, "Pet.csv");
    const both = read(csv);
    const aAfter = ["Toy|price", "Ball|2", ""].join("\n");
    vscode.workspace._willSave({ document: makeDoc(a, aBefore), waitUntil: () => {} });
    fs.writeFileSync(a, aAfter);
    vscode.workspace._save(makeDoc(a, aAfter));
    const written = read(csv);
    await sync(root);
    console.log(/Rex/.test(both) && written === "Pet,age\nTom,2\n" && !/Rex/.test(read(b))
      ? "PASS (csv: a Concept taken out of one of two files leaves its rows gone, and the other file untouched)"
      : "UNEXPECTED left behind " + JSON.stringify({ both, written, b: read(b) }));
    // a file deleted altogether, likewise
    fs.writeFileSync(a, aBefore);
    vscode.workspace._save(makeDoc(a, aBefore));
    plainCommands.get("aot.importCsvFiles")(root);
    await new Promise((r) => setTimeout(r, 20));
    fs.rmSync(a);
    vscode.workspace._aotDeleted({ fsPath: a });
    await sync(root);
    console.log(read(csv) === "Pet,age\nTom,2\n" && !/Rex/.test(read(b))
      ? "PASS (csv: a file deleted leaves its rows gone from the CSV it shared)"
      : "UNEXPECTED deleted " + JSON.stringify({ csv: read(csv), b: read(b) }));
    fs.rmSync(root, { recursive: true, force: true });
  }
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

// 6e) the CSV mirror's one rule (1.13): the file saved last overrides the other,
// even where the other was edited too. Run late and on a timer: it presses
// buttons on the shared warning mock, which another block's message must not
// answer — and the blocks that do the same wait for it to finish (lateBlocks).
let lateBlocks = Promise.resolve();
const late = (ms, fn) => {
  const ready = new Promise((r) => setTimeout(r, ms));
  lateBlocks = Promise.all([lateBlocks, ready]).then(fn);
};
late(2600, async () => {
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aot-lastsaved-"));
  fs.mkdirSync(path.join(root, ".git"));
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
  const dir = path.join(root, "aot.files");
  const aotPath = path.join(root, "Shop.aot");
  const csvPath = path.join(dir, "Order.csv");
  // the save times are the test's own, each later than every one before it, so
  // "saved last" never rests on a tick of the clock
  let clock = Date.now() / 1000;
  const stamp = (p) => { clock += 10; fs.utimesSync(p, clock, clock); };
  const writeAot = (...lines) => { fs.writeFileSync(aotPath, lines.join("\n")); stamp(aotPath); };
  const writeCsv = (text) => { fs.writeFileSync(csvPath, text); stamp(csvPath); };
  const aot = () => fs.readFileSync(aotPath, "utf8");
  const csv = () => fs.readFileSync(csvPath, "utf8").replace(/\r\n/g, "\n");
  const sync = () => plainCommands.get("aot.importCsvFiles")(root);
  const settle = () => new Promise((r) => setTimeout(r, 60)); // a button's answer lands
  const results = [];
  const expect = (name, ok, detail) => results.push(ok ? `PASS (csv last save: ${name})` : `UNEXPECTED csv last save ${name} ${JSON.stringify(detail)}`);
  const notices = () => vscode.window._warnings.filter((w) => /Order\.csv|Shop\.aot/.test(w));
  const quiet = () => { vscode.window._warnings.length = 0; };

  writeAot("Order|price|qty", "Acme |100  |1", "Bolt |50   |2");
  vscode.workspace._save(makeDoc(aotPath, aot()));
  expect("the first save writes the CSV", csv() === "Order,price,qty\nAcme,100,1\nBolt,50,2\n", csv());

  // saving a .aot in the editor overwrites the CSV, unread, whatever it said
  writeCsv("Order,price,qty\nAcme,100,1\nBolt,99,2\n");
  writeAot("Order|price|qty", "Acme |101  |1", "Bolt |50   |2");
  vscode.workspace._save(makeDoc(aotPath, aot()));
  expect("a .aot saved in the editor overwrites the CSV, an edit the CSV had included",
    csv() === "Order,price,qty\nAcme,101,1\nBolt,50,2\n", csv());

  // the same with the editor closed: only the save times say which is later
  writeCsv("Order,price,qty\nAcme,101,1\nBolt,98,2\n");
  writeAot("Order|price|qty", "Acme |110  |1", "Bolt |50   |2");
  quiet();
  await sync();
  expect("both edited in different cells, the .aot saved last: the .aot overrides the whole CSV",
    aot() === "Order|price|qty\nAcme |110  |1\nBolt |50   |2" && csv() === "Order,price,qty\nAcme,110,1\nBolt,50,2\n" && !notices().length,
    { aot: aot(), csv: csv(), notices: notices() });

  writeAot("Order|price|qty", "Acme |111  |1", "Bolt |50   |2");
  writeCsv("Order,price,qty\nAcme,110,1\nBolt,55,2\n");
  quiet();
  await sync();
  expect("both edited in different cells, the CSV saved last: the CSV overrides the whole .aot",
    aot() === "Order|price|qty\nAcme |110  |1\nBolt |55   |2" && csv() === "Order,price,qty\nAcme,110,1\nBolt,55,2\n" && !notices().length,
    { aot: aot(), csv: csv(), notices: notices() });

  // the same cell: no conflict to report, the later save simply stands
  writeAot("Order|price|qty", "Acme |120  |1", "Bolt |55   |2");
  writeCsv("Order,price,qty\nAcme,130,1\nBolt,55,2\n");
  quiet();
  await sync();
  expect("one cell edited on both sides goes to the later save, and nothing is said",
    aot().includes("Acme |130  |1") && !notices().length, { aot: aot(), notices: notices() });
  writeCsv("Order,price,qty\nAcme,131,1\nBolt,55,2\n");
  writeAot("Order|price|qty", "Acme |140  |1", "Bolt |55   |2");
  await sync();
  expect("and the other way about", aot().includes("Acme |140  |1") && csv().includes("Acme,140,1"), { aot: aot(), csv: csv() });

  // a value set back to an earlier one is just the file saved last: no older
  // copy to detect, no notice, nothing remembered to judge it by
  writeCsv("Order,price,qty\nAcme,140,1\nBolt,56,2\n");
  await sync();
  writeCsv("Order,price,qty\nAcme,140,1\nBolt,55,2\n");
  quiet();
  await sync();
  expect("a CSV edit changed back folds in", aot().includes("Bolt |55   |2") && csv().includes("Bolt,55,2") && !notices().length, { aot: aot(), notices: notices() });
  writeAot("Order|price|qty", "Acme |140  |1", "Bolt |58   |2");
  await sync();
  writeCsv("Order,price,qty\nAcme,140,1\nBolt,55,2\n");
  quiet();
  await sync();
  expect("a CSV setting a cell back to before the .aot's change wins too, since it was saved later",
    aot().includes("Bolt |55   |2") && !notices().length, { aot: aot(), notices: notices() });

  // an emptied cell empties, and the watcher hearing the save does the same
  writeCsv("Order,price,qty\nAcme,140,\nBolt,55,2\n");
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  expect("a cell the CSV emptied is emptied", aot() === "Order|price|qty\nAcme |140  |\nBolt |55   |2", aot());

  // the watcher's event is no trump: a CSV event carrying an older time loses
  const copied = "Order,price,qty\nAcme,1,\nBolt,1,2\n";
  fs.writeFileSync(csvPath, copied);
  fs.utimesSync(csvPath, clock - 1000, clock - 1000); // a copy that kept its old time
  writeAot("Order|price|qty", "Acme |140  |", "Bolt |55   |2");
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  expect("a CSV older than the .aot is overwritten, whatever event brought it",
    aot().includes("Acme |140  |") && csv().includes("Acme,140,"), { aot: aot(), csv: csv() });

  // a row the CSV no longer lists goes from the .aot, with nothing asked
  writeCsv("Order,price,qty\nAcme,140,\n");
  quiet();
  await sync();
  expect("a row the CSV no longer lists is deleted from the .aot, and nothing is asked",
    !aot().includes("Bolt") && aot().includes("Acme") && !vscode.window._warnings.length && csv() === "Order,price,qty\nAcme,140,\n",
    { aot: aot(), csv: csv(), warnings: vscode.window._warnings });
  // but a row whose sub-row the CSV still lists has to stay, and that is said
  writeAot("Order|parent (order)|price|qty", "Acme |              |140  |", "Kid  |Acme          |1    |");
  await sync();
  writeCsv("Order,parent,price,qty\nKid,Acme,1,\n");
  vscode.window._info.length = 0;
  await sync();
  expect("a row whose sub-row the CSV still lists stays, and that is said",
    aot().includes("Acme |") && aot().includes("Kid  |") && vscode.window._info.some((m) => /kept 'Acme'/.test(m)),
    { aot: aot(), info: vscode.window._info });
  writeAot("Order|price|qty", "Acme |140  |");
  await sync();

  // a new row in the CSV saved last arrives
  writeCsv("Order,price,qty\nAcme,140,\nBolt,55,2\n");
  await sync();
  expect("a new row in the CSV arrives", aot().includes("Bolt |55"), aot());

  // Unsaved edits are no save. A CSV saved after them overrides them: the table
  // in the buffer ends up saying what the CSV says, cells and rows alike, the
  // buffer stays unsaved for what it holds elsewhere, and the disk is untouched.
  writeAot("Note", "    - Plain", "", "Order|price|qty", "Acme |140  |1", "Bolt |55   |2", "Cog  |7    |3");
  await sync();
  const typed = ["Note", "    - Plain", "    - Typed", "", "Order|price|qty", "Acme |140  |9", "Bolt |55   |2", "Cog  |8    |3", "New  |1    |1"];
  let saves = 0;
  const open = {
    lines: typed.slice(), languageId: "aot", fileName: aotPath, eol: vscode.EndOfLine.LF, isDirty: true,
    get lineCount() { return this.lines.length; },
    getText() { return this.lines.join("\n"); },
    lineAt(i) { return { range: new vscode.Range(i, 0, i, this.lines[i].length), text: this.lines[i] }; },
    save: async () => { saves++; return true; },
  };
  open.uri = { fsPath: aotPath, toString: () => "file:///" + aotPath, __doc: open };
  vscode.workspace.textDocuments.push(open);
  const onDisk = aot();
  const withoutTyped = csv();
  // the mirror's own text, heard again: nothing new, so nothing is overridden.
  // This is what stops every save's write, always the later file, from wiping
  // what was typed since — and a startup from wiping restored unsaved edits
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  await sync();
  expect("a CSV saying what the saved .aot says overrides nothing, however late it was saved",
    open.getText() === typed.join("\n") && csv() === withoutTyped, { text: open.getText(), csv: csv() });
  writeCsv("Order,price,qty\nAcme,140,1\nBolt,60,2\nCog,70,3\n");
  quiet();
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  expect("a CSV saved after unsaved edits edits the buffer, leaves it unsaved, and leaves the disk alone",
    saves === 0 && aot() === onDisk, { saves, aot: aot() });
  expect("it overrides them all: a cell it left alone, a cell it changed, and a row typed and not saved",
    open.getText().includes("Acme |140  |1") && open.getText().includes("Bolt |60") && open.getText().includes("Cog  |70") && !open.getText().includes("New"),
    open.getText());
  expect("what the buffer holds outside the table stays, and nothing is said",
    open.getText().includes("    - Typed") && !vscode.window._warnings.length, { text: open.getText(), warnings: vscode.window._warnings });
  expect("the CSV is left as it was saved until the buffer is", csv() === "Order,price,qty\nAcme,140,1\nBolt,60,2\nCog,70,3\n", csv());
  const heardOnce = open.getText();
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  expect("heard twice, the same CSV changes nothing more", open.getText() === heardOnce, open.getText());
  // saved at last: the .aot is the file saved last
  fs.writeFileSync(aotPath, open.getText());
  stamp(aotPath);
  vscode.workspace._save(makeDoc(aotPath, aot()));
  expect("the buffer saved writes the CSV", /Acme,140,1/.test(csv()) && /Bolt,60,2/.test(csv()) && /Cog,70,3/.test(csv()), csv());
  // a .aot saved after the CSV, with unsaved edits on top: nothing to write yet
  writeCsv(csv().replace("Acme,140,1", "Acme,141,1"));
  writeAot(...aot().split("\n"));
  const waiting = csv();
  open.lines = aot().split("\n");
  await sync();
  expect("with the .aot saved last but a buffer still unsaved, nothing moves until it is saved",
    csv() === waiting && open.getText() === aot(), { csv: csv(), text: open.getText() });
  vscode.workspace.textDocuments.splice(vscode.workspace.textDocuments.indexOf(open), 1);
  await sync();

  // a .aot saved by another program while the editor runs: no save event, and
  // the file watcher is what hears it
  writeAot("Order|price|qty", "Acme |150  |9", "Bolt |60   |2", "Cog  |70   |3");
  await vscode.workspace._aotChanged({ fsPath: aotPath });
  await settle();
  expect("a .aot saved by another program overrides the CSV at once", csv().includes("Acme,150,9"), csv());
  const unchanged = fs.statSync(csvPath).mtimeMs;
  await vscode.workspace._aotChanged({ fsPath: aotPath });
  await settle();
  expect("and hearing it again writes nothing", fs.statSync(csvPath).mtimeMs === unchanged, csv());

  // one Concept written in two files: the CSV holds both files' rows, and a
  // row's edit lands in the file that lists it
  const peerPath = path.join(root, "Shop2.aot");
  fs.writeFileSync(peerPath, ["Order|price|qty", "Dot  |7    |3"].join("\n"));
  stamp(peerPath);
  vscode.workspace._save(makeDoc(peerPath, fs.readFileSync(peerPath, "utf8")));
  const union = csv();
  writeCsv(union.replace("Dot,7,3", "Dot,8,3"));
  await sync();
  expect("a Concept two files spell mirrors both, and each row's edit goes to its own file",
    /Acme,150,9/.test(union) && /Dot,7,3/.test(union) && fs.readFileSync(peerPath, "utf8").includes("Dot  |8    |3") && !aot().includes("Dot"),
    { union, peer: fs.readFileSync(peerPath, "utf8"), aot: aot() });
  writeAot("Order|price|qty", "Acme |151  |9", "Bolt |60   |2", "Cog  |70   |3");
  await sync();
  expect("saved after the CSV, either file overrides it, the other file's rows still in the union",
    /Acme,151,9/.test(csv()) && /Dot,8,3/.test(csv()), csv());
  fs.unlinkSync(peerPath);
  await sync();

  // manual mode: nothing syncs until Sync CSVs Now, where the save times decide
  configStore.tableCsvSyncMode = "manual";
  writeAot("Order|price|qty", "Acme |152  |9", "Bolt |60   |2", "Cog  |70   |3");
  vscode.workspace._save(makeDoc(aotPath, aot()));
  const unsynced = csv();
  writeCsv(csv().replace("Bolt,60,2", "Bolt,61,2"));
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  const notFolded = !aot().includes("Bolt |61");
  await sync();
  delete configStore.tableCsvSyncMode;
  expect("in manual mode nothing syncs until Sync CSVs Now, and then the file saved last overrides the other",
    /Acme,151,9/.test(unsynced) && notFolded && aot().includes("Bolt |61") && !aot().includes("Acme |152"),
    { unsynced, notFolded, aot: aot() });

  // nothing was ever remembered about this repository: a first meeting decides
  // exactly as any other, which is what makes a moved folder or a new profile safe
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "aot-lastsaved-fresh-"));
  fs.mkdirSync(path.join(fresh, ".git"));
  fs.mkdirSync(path.join(fresh, "aot.files"));
  const freshAot = path.join(fresh, "Shop.aot"), freshCsv = path.join(fresh, "aot.files", "Order.csv");
  fs.writeFileSync(freshAot, ["Order|price|qty", "Acme |100  |9", "Bolt |50   |2"].join("\n"));
  fs.writeFileSync(freshCsv, "Order,price,qty\nAcme,1,1\nBolt,1,2\n");
  stamp(freshCsv);
  stamp(freshAot);
  await plainCommands.get("aot.importCsvFiles")(fresh);
  expect("an older CSV never beats a newer .aot, with nothing known of either",
    fs.readFileSync(freshAot, "utf8").includes("Acme |100  |9") && fs.readFileSync(freshCsv, "utf8").includes("Acme,100,9"),
    { aot: fs.readFileSync(freshAot, "utf8"), csv: fs.readFileSync(freshCsv, "utf8") });
  fs.writeFileSync(freshCsv, "Order,price,qty\nAcme,200,\nBolt,50,2\n");
  stamp(freshCsv);
  await plainCommands.get("aot.importCsvFiles")(fresh);
  expect("and a newer CSV overrides the .aot the same way, an emptied cell included",
    fs.readFileSync(freshAot, "utf8").includes("Acme |200  |"), fs.readFileSync(freshAot, "utf8"));

  vscode.workspace.workspaceFolders = undefined;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(fresh, { recursive: true, force: true });
  for (const r of results) console.log(r);
});

// 6d2) hovering a Concept links its CSV, once it has one: on the Concept's own
// name, in a table or on a line, and on anything linking to it. The link is a
// plain file link, so the hover stays untrusted around the file's own text.
{
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aot-csvlink-"));
  fs.mkdirSync(path.join(root, ".git"));
  const dir = path.join(root, "aot.files");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "Stock Item.csv"), "Stock Item,count\nBolt,5\n");
  fs.writeFileSync(path.join(dir, "Lonely.csv"), "Lonely\n");
  const text = ["Stock Item|count", "Bolt      |5", "", "Lonely", "", "Alone", "", "Bin", "    stock item", "    - Top", "        stock item: Bolt"].join("\n");
  const doc = makeDoc(path.join(root, "Shop.aot"), text);
  const at = (line, ch) => hoverProvider.provideHover(doc, new vscode.Position(line, ch));
  const LINK = /\[Open Stock Item\.csv\]\(file:\/\/\/.*aot\.files\/Stock Item\.csv\)/;
  const inTable = at(0, 2), onAttribute = at(8, 6), lone = at(3, 2), onExample = at(1, 1), bare = at(5, 2);
  console.log(inTable && LINK.test(inTable.contents.value)
    ? "PASS (csv link: hovering a table's Concept links its CSV)"
    : "UNEXPECTED csv link on the Concept " + JSON.stringify(inTable && inTable.contents.value));
  console.log(onAttribute && LINK.test(onAttribute.contents.value)
    ? "PASS (csv link: hovering a link to the Concept links its CSV too)"
    : "UNEXPECTED csv link on a crosslink " + JSON.stringify(onAttribute && onAttribute.contents.value));
  console.log(lone && /\[Open Lonely\.csv\]/.test(lone.contents.value)
    ? "PASS (csv link: a line-form Concept with nothing else to say still gets a hover, for its CSV)"
    : "UNEXPECTED csv link alone " + JSON.stringify(lone && lone.contents.value));
  console.log(bare === null && !(onExample && /\[Open /.test(onExample.contents.value))
    ? "PASS (csv link: none for a Concept with no CSV, and none on an Example)"
    : "UNEXPECTED csv link where none belongs " + JSON.stringify({ bare: bare && bare.contents.value, example: onExample && onExample.contents.value }));
  console.log(inTable && inTable.contents.isTrusted !== true
    ? "PASS (csv link: the hover stays untrusted, so a value can never become a command link)"
    : "UNEXPECTED trusted hover");
  fs.rmSync(root, { recursive: true, force: true });
}

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

// 7b2) the maintained `...` note: its file names link to the Concept where it
// stands now (a peer edited since may have moved it), a name with spaces
// included; hovering `N more` lists those N Examples where they are written,
// hovering a file name lists that file's.
{
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "aot-note-"));
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  const herePath = path.join(tmp, "Close.aot");
  const peerPath = path.join(tmp, "bank recon.aot");
  const herePeer = path.join(tmp, "Vat.aot");
  fs.writeFileSync(peerPath, ["Intro", "", "Team", "    - Two", "    - Three"].join("\n")); // Team now on line 3
  fs.writeFileSync(herePeer, ["Team", "    - One", "    - Two"].join("\n"));
  const hereText = ["Team", "    - One", "    ... 2 more in bank recon.aot:1, Vat.aot:1"].join("\n");
  fs.writeFileSync(herePath, hereText);
  for (const p of [peerPath, herePeer, herePath]) vscode.workspace._aotCreated({ fsPath: p });
  const doc = makeDoc(herePath, hereText);
  vscode.workspace._open(doc);
  const links = (documentLinkProvider.provideDocumentLinks(doc) || []).filter((l) => l.range.a[0] === 2);
  const bank = links.find((l) => l.target.fsPath === peerPath);
  console.log(bank && bank.target.fragment === "L3" && bank.range.a[1] === hereText.split("\n")[2].indexOf("bank recon.aot:1")
    ? "PASS (note: a file name with spaces links, to the Concept's line as it stands now)"
    : "UNEXPECTED note link " + JSON.stringify(links.map((l) => [l.range.a, l.target.fsPath, l.target.fragment])));
  const noteLine = hereText.split("\n")[2];
  const count = hoverProvider.provideHover(doc, new vscode.Position(2, noteLine.indexOf("2 more") + 1));
  const countText = count && count.contents ? String(count.contents.value || count.contents) : "";
  console.log(/2 more Team/.test(countText) && /Three/.test(countText) && /Two/.test(countText) && !/\bOne\b/.test(countText)
    ? "PASS (note: hovering `N more` lists the Examples written elsewhere and not here)"
    : "UNEXPECTED note count hover " + JSON.stringify(countText));
  const onFile = hoverProvider.provideHover(doc, new vscode.Position(2, noteLine.indexOf("Vat.aot") + 2));
  const fileText = onFile && onFile.contents ? String(onFile.contents.value || onFile.contents) : "";
  console.log(/Team\*\* in \[Vat\.aot\]/.test(fileText) && /One/.test(fileText) && /Two/.test(fileText) && !/Three/.test(fileText)
    ? "PASS (note: hovering a file name lists that file's Examples)"
    : "UNEXPECTED note file hover " + JSON.stringify(fileText));
  vscode.workspace.workspaceFolders = undefined;
  for (const p of [peerPath, herePeer, herePath]) vscode.workspace._aotDeleted({ fsPath: p });
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

// 7c2) Gödel numbering in the editor: one content under two names in two
// files warns, with the synonym lightbulb; hover shows a node's content; a
// value every child sets warns, with its "move up" lightbulb; and a save
// writes the stable numbers into aot.files/godel.tsv. In a folder of its own
// outside this repository, with a .git of its own, so the save writes there.
{
  const os = require("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aot-godel-"));
  fs.mkdirSync(path.join(tmp, ".git"));
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  const aPath = path.join(tmp, "Kennel.aot"), bPath = path.join(tmp, "Pound.aot");
  const aText = ["Hound", "    legs: 4", "    sound: bark", "    - Rex", "        age: 3", "        sound: yap"].join("\n");
  fs.writeFileSync(aPath, aText);
  fs.writeFileSync(bPath, ["Mutt", "    legs: 4", "    sound: bark"].join("\n"));
  vscode.workspace._aotCreated({ fsPath: aPath });
  vscode.workspace._aotCreated({ fsPath: bPath });
  const docA = makeDoc(aPath, aText);
  vscode.workspace._open(docA);
  const twin = (published.get(docA.uri.toString()) || []).find((d) => /^rename one to the other.* — 'Hound' and 'Mutt' \(Pound\.aot:1\) carry exactly the same attributes and values/.test(d.message));
  const twinFixes = twin ? codeActionsProvider.provideCodeActions(docA, twin.range, { diagnostics: [twin] }) : [];
  console.log(twin && twin.severity === vscode.DiagnosticSeverity.Warning
    && (twin.relatedInformation || []).some((r) => /Pound\.aot/.test(r.location.uri.toString()))
    && twinFixes.some((f) => f.command && f.command.command === "aot.renameConcept")
    && twinFixes.some((f) => f.command && f.command.command === "aot.acceptDistinct")
    ? "PASS (twins: one content under two names in two files warns, the peer linked, rename or keep apart on the lightbulb)"
    : "UNEXPECTED twin " + JSON.stringify({ diags: (published.get(docA.uri.toString()) || []).map((d) => d.message), fixes: twinFixes.map((f) => f.title) }));

  const rex = hoverProvider.provideHover(docA, new vscode.Position(3, 7));
  const rexText = rex && rex.contents.value;
  console.log(rexText && /\*\*Content\*\* — G = /.test(rexText) && /- `legs`: `4` — from 'Hound' \(line 2\)/.test(rexText)
    && /- `age`: `3`\n/.test(rexText)
    ? "PASS (hover: an Example's content — each slot, an inherited one saying where it came from)"
    : "UNEXPECTED Example content hover " + JSON.stringify(rexText));
  console.log(rexText && /- overrides `sound`: `bark` from 'Hound' with `yap`/.test(rexText)
    ? "PASS (hover: an override names what it replaces and where that came from)"
    : "UNEXPECTED override hover " + JSON.stringify(rexText));

  const vPath = path.join(tmp, "Garage.aot");
  const vText = ["Vehicle", "    Car", "        wheels: 4", "        doors: 3", "    Van", "        wheels: 4", "        doors: 5"].join("\n");
  fs.writeFileSync(vPath, vText);
  const docV = makeDoc(vPath, vText);
  vscode.workspace._open(docV);
  const hoistD = (published.get(docV.uri.toString()) || []).find((d) => /^write 'wheels: 4' once under 'Vehicle' and drop it from each child — every child of 'Vehicle' sets it/.test(d.message));
  const moveUp = hoistD && codeActionsProvider.provideCodeActions(docV, hoistD.range, { diagnostics: [hoistD] })
    .find((f) => f.command && f.command.command === "aot.hoistValue");
  console.log(hoistD && hoistD.severity === vscode.DiagnosticSeverity.Warning
    && moveUp && moveUp.title === "Move 'wheels: 4' up to 'Vehicle'" && JSON.stringify(moveUp.command.arguments) === JSON.stringify([1, "wheels", "4", "hoist"])
    ? "PASS (hoists: a value every child sets warns, never in V, with the move up on the lightbulb)"
    : "UNEXPECTED hoist " + JSON.stringify({ diags: (published.get(docV.uri.toString()) || []).map((d) => [d.severity, d.message]), moveUp: moveUp && moveUp.title }));
  const dPath = path.join(tmp, "Kitchen.aot");
  const dText = ["Drink", "    temperature: cold", "    Tea", "        temperature: hot", "    Soup", "        temperature: warm"].join("\n");
  fs.writeFileSync(dPath, dText);
  const docD = makeDoc(dPath, dText);
  vscode.workspace._open(docD);
  const deadD = (published.get(docD.uri.toString()) || []).find((d) => /^keep just 'temperature', or drop the line — 'Drink' sets 'temperature: cold' but every child overrides it/.test(d.message));
  const keepJust = deadD && codeActionsProvider.provideCodeActions(docD, deadD.range, { diagnostics: [deadD] })
    .find((f) => f.command && f.command.command === "aot.hoistValue");
  console.log(deadD && keepJust && keepJust.title === "Keep just 'temperature'" && !keepJust.isPreferred
    && JSON.stringify(keepJust.command.arguments) === JSON.stringify([1, "temperature", "", "bare"])
    ? "PASS (hoists: a default no child keeps warns, with 'keep just the attribute' on the lightbulb)"
    : "UNEXPECTED dead default " + JSON.stringify({ diags: (published.get(docD.uri.toString()) || []).map((d) => d.message), fix: keepJust && keepJust.title }));
  // a squiggle the document no longer bears out, or another tool's, offers nothing
  const ghost = { source: "aot", message: "write 'x: 1' once under 'Ghost' and drop it from each child — every child of 'Ghost' sets it (lines 2, 4), …", range: new vscode.Range(0, 0, 0, 5) };
  const foreign = Object.assign({}, hoistD, { source: "other" });
  console.log(!codeActionsProvider.provideCodeActions(docV, ghost.range, { diagnostics: [ghost, foreign] })
    .some((f) => f.command && f.command.command === "aot.hoistValue")
    ? "PASS (hoists: a stale squiggle, or another tool's, offers no move)"
    : "UNEXPECTED stale hoist action");
  // a built-in unit has no line in any file, so the hover says what it is
  const docKm = makeDoc("c:\\repo\\Journeys.aot", ["Trip|distance (km)|note (remark)", "A|120|x", "Leg", "    time (km/h)"].join("\n"));
  const kmHover = hoverProvider.provideHover(docKm, new vscode.Position(0, 16));
  const kmText = kmHover && kmHover.contents.value;
  console.log(kmText && /A built-in unit: Unit ▸ Length ▸ km\. 1 km = 1000 m\./.test(kmText) && /A plain number in `distance` is in `km`/.test(kmText)
    ? "PASS (hover: a unit in an alias says where it sits in the hierarchy, and what it is worth)"
    : "UNEXPECTED unit hover " + JSON.stringify(kmText));
  const compound = hoverProvider.provideHover(docKm, new vscode.Position(3, 12));
  const compoundText = compound && compound.contents.value;
  console.log(compoundText && /Unit ▸ Length ▸ km/.test(compoundText) && /Unit ▸ Time ▸ h/.test(compoundText)
    ? "PASS (hover: a compound unit names each part)"
    : "UNEXPECTED compound unit hover " + JSON.stringify(compoundText));
  const plainAlias = hoverProvider.provideHover(docKm, new vscode.Position(0, 29));
  console.log(!(plainAlias && plainAlias.contents && /built-in unit/.test(plainAlias.contents.value || ""))
    ? "PASS (hover: an alias naming no unit is told nothing of units)"
    : "UNEXPECTED alias hover " + JSON.stringify(plainAlias));
  const car = hoverProvider.provideHover(docV, new vscode.Position(1, 5));
  const carText = car && car.contents.value;
  console.log(carText && /\*\*Content\*\*/.test(carText) && /Nearest sibling: 'Van' \(line 5\), 1 slot apart — `~ doors: 3 \| 5`/.test(carText)
    ? "PASS (hover: a Concept with no chains and no usages still shows its content, and its nearest sibling)"
    : "UNEXPECTED Concept content hover " + JSON.stringify(carText));
  // Examples are named as the file writes them, '- ' and all; a sub-Example
  // inherits from its kinds and never from the Example it sits under — a
  // part takes nothing from its whole, in lines exactly as in a nested
  // table row; and a Concept with nothing to say — no chains, no usages, no
  // content — has no hover
  const lText = ["Litter", "    size: small", "    - Pup One", "        colour: brown", "    - Pup Two", "        colour: black", "        weight: 3",
    "        - Runt", "            colour: grey"].join("\n");
  const docL = makeDoc(path.join(tmp, "Litter.aot"), lText);
  const runt = hoverProvider.provideHover(docL, new vscode.Position(7, 12));
  const pup = hoverProvider.provideHover(docL, new vscode.Position(2, 8));
  console.log(runt && /- `size`: `small` — from 'Litter' \(line 2\)/.test(runt.contents.value)
    && !/weight/.test(runt.contents.value) && !/overrides/.test(runt.contents.value)
    && pup && /Nearest sibling: '- Pup Two' \(line 5\), 2 slots apart/.test(pup.contents.value)
    && hoverProvider.provideHover(makeDoc(path.join(tmp, "Alone.aot"), "Lonely"), new vscode.Position(0, 2)) === null
    ? "PASS (hover: an Example is named '- X' wherever its content is shown; a sub-Example inherits nothing from the Example above it; a Concept with nothing to say has no hover)"
    : "UNEXPECTED Example naming hover " + JSON.stringify({ runt: runt && runt.contents.value, pup: pup && pup.contents.value }));

  vscode.workspace._save(docV);
  const tsv = path.join(tmp, "aot.files", "godel.tsv");
  const reg = fs.existsSync(tsv) ? fs.readFileSync(tsv, "utf8") : "";
  console.log(/^# Gödel numbering kept by the AOT extension/.test(reg) && /\na\tdoors\t\d+\n/.test(reg) && /\nv\twheels\t2\t4\n/.test(reg)
    ? "PASS (registry: a save writes the stable numbers into aot.files/godel.tsv)"
    : "UNEXPECTED registry " + JSON.stringify(reg));
  // switched off, a save writes nothing; a registry that can be neither read
  // nor written (a folder where the file should be) numbers afresh, quietly
  const grownText = vText + "\n        seats: 2";
  configStore["godelRegistry"] = false;
  vscode.workspace._save(makeDoc(vPath, grownText));
  const offKept = fs.readFileSync(tsv, "utf8") === reg;
  delete configStore["godelRegistry"];
  fs.rmSync(tsv);
  fs.mkdirSync(tsv);
  let regThrew = null, regHover = null;
  try {
    vscode.workspace._save(makeDoc(vPath, grownText));
    regHover = hoverProvider.provideHover(makeDoc(vPath, grownText), new vscode.Position(1, 5));
  } catch (e) { regThrew = e; }
  console.log(offKept && !regThrew && fs.statSync(tsv).isDirectory() && regHover && /\*\*Content\*\*/.test(regHover.contents.value)
    ? "PASS (registry: aot.godelRegistry off writes nothing; one that cannot be read or written is numbered afresh, and nothing breaks)"
    : "UNEXPECTED registry edges " + JSON.stringify({ offKept, threw: regThrew && regThrew.message }));

  vscode.workspace.workspaceFolders = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 7c2b) the hover says each thing once: a line whose name and value both link
// to a Concept is one use, a G that is a lone prime is not written twice, and
// two Concepts carrying nothing are not called identical in content
{
  const text = [
    "Currency: EUR",
    "Note",
    "Trip",
    "    currency: EUR",
    "Tag",
    "    colour",
  ].join("\n");
  const d = makeDoc("c:\\repo\\HoverOnce.aot", text);
  vscode.workspace._open(d);
  const said = (line) => {
    const h = hoverProvider.provideHover(d, new vscode.Position(line, 1));
    return h ? h.contents.value : "";
  };
  const uses = said(0).match(/- line 4:/g) || [];
  const tag = said(4);
  const factors = /\*\*Content\*\* — G = (\S+)/.exec(tag);
  console.log(uses.length === 1 && !/Identical in content/.test(said(0)) && !/Identical in content/.test(said(1))
    && factors && !tag.includes(`G = ${factors[1]} = `)
    ? "PASS (hover: a line used twice is listed once; no 'identical' for empty content; a lone prime is not repeated)"
    : "UNEXPECTED hover repeats " + JSON.stringify({ currency: said(0), note: said(1), tag }));
}

// 7c3) AOT: Set Up Git Merge for .aot Files: .gitattributes gains the two
// lines it lacks, the driver goes into the repository's local git config,
// and on activation a driver left pointing at a gone verify.js is repaired —
// while a repository that never ran the setup is never touched
(async () => {
  const os = require("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aot-gitmerge-"));
  fs.mkdirSync(path.join(tmp, ".git"));
  fs.writeFileSync(path.join(tmp, ".gitattributes"), "*.png binary\n*.aot merge=aot\n");
  const calls = [];
  ext._test.setGit((root, args) => { calls.push([root, ...args]); return ""; });
  const before = vscode.workspace.workspaceFolders;
  const activeBefore = vscode.window.activeTextEditor;
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  vscode.window.activeTextEditor = undefined;
  const setUp = plainCommands.get("aot.setUpGitMerge");
  const result = setUp && await setUp();
  const attrs = fs.readFileSync(path.join(tmp, ".gitattributes"), "utf8");
  const driver = calls.find((c) => c[1] === "config" && c[3] === "merge.aot.driver");
  console.log(result && result.ok && attrs === "*.png binary\n*.aot merge=aot\naot.files/godel.tsv merge=union\n"
    && driver && driver[0] === tmp && /^node ".*\/verify\.js" --merge %O %A %B %P$/.test(driver[4])
    && calls.some((c) => c[3] === "merge.aot.name")
    ? "PASS (git merge: the setup adds only the missing .gitattributes lines, and the driver to the local git config)"
    : "UNEXPECTED git merge setup " + JSON.stringify({ result, attrs, calls }));

  calls.length = 0;
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }]; // other async blocks move it while this one awaits
  fs.writeFileSync(path.join(tmp, ".git", "config"), '[merge "aot"]\n\tname = x\n\tdriver = node "C:/gone/extension/verify.js" --merge %O %A %B %P\n');
  ext._test.repairGitMerge();
  const repaired = calls.find((c) => c[3] === "merge.aot.driver");
  fs.writeFileSync(path.join(tmp, ".git", "config"), "[core]\n\tbare = false\n");
  const n = calls.length;
  ext._test.repairGitMerge();
  console.log(repaired && !/gone/.test(repaired[4]) && calls.length === n
    ? "PASS (git merge: a driver pointing at a gone verify.js is repaired; a repository never set up is left alone)"
    : "UNEXPECTED git merge repair " + JSON.stringify(calls));

  // no repository to set up, and git refusing: both said, nothing pretended
  vscode.workspace.workspaceFolders = undefined;
  vscode.window.activeTextEditor = undefined;
  const infos = vscode.window._info.length;
  const none = await setUp();
  const noneSaid = vscode.window._info.slice(infos).some((m) => /open a file in a git repository/.test(m));
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  vscode.window.activeTextEditor = undefined;
  ext._test.setGit(() => { throw Object.assign(new Error("exit 128"), { stderr: "fatal: not in a git directory\n" }); });
  const errs = vscode.window._errors.length;
  const refused = await setUp();
  console.log(none && !none.ok && noneSaid && refused && !refused.ok
    && vscode.window._errors.slice(errs).some((m) => /git could not be configured — fatal: not in a git directory/.test(m))
    ? "PASS (git merge: no repository, or git refusing, is said and sets nothing up)"
    : "UNEXPECTED git merge failures " + JSON.stringify({ none, refused, errors: vscode.window._errors.slice(errs) }));
  ext._test.setGit(null);
  vscode.workspace.workspaceFolders = before;
  vscode.window.activeTextEditor = activeBefore;
  fs.rmSync(tmp, { recursive: true, force: true });
})();

// 7c3b) the git merge setup's edges, from the sequential Python block (12),
// since they move the active editor across awaits: git not there at all;
// set up from the file open in the editor; a second time, nothing left to
// commit; a repository with no .gitattributes, and one whose last line has
// no newline; and the repair on activation passing over what it cannot read
// or set.
async function gitMergeEdges() {
  const os = require("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aot-gitedges-"));
  fs.mkdirSync(path.join(tmp, ".git"));
  const setUp = plainCommands.get("aot.setUpGitMerge");
  const activeBefore = vscode.window.activeTextEditor;
  const foldersBefore = vscode.workspace.workspaceFolders;
  ext._test.setGit(() => { throw new Error("spawn git ENOENT"); });
  vscode.window.activeTextEditor = { document: { fileName: path.join(tmp, "zoo.aot") } };
  const errs = vscode.window._errors.length;
  await setUp();
  const noGit = vscode.window._errors.slice(errs).some((m) => /git could not be configured — spawn git ENOENT/.test(m));

  ext._test.setGit(() => "");
  vscode.window.activeTextEditor = { document: { fileName: path.join(tmp, "zoo.aot") } };
  const first = await setUp();
  const infos = vscode.window._info.length;
  vscode.window.activeTextEditor = { document: { fileName: path.join(tmp, "zoo.aot") } };
  const again = await setUp();
  const againSaid = vscode.window._info.slice(infos).find((m) => /now merge by meaning/.test(m)) || "";
  const created = fs.readFileSync(path.join(tmp, ".gitattributes"), "utf8");
  fs.writeFileSync(path.join(tmp, ".gitattributes"), "*.png binary");
  vscode.window.activeTextEditor = { document: { fileName: path.join(tmp, "zoo.aot") } };
  await setUp();
  const appended = fs.readFileSync(path.join(tmp, ".gitattributes"), "utf8");
  console.log(noGit && first.ok && first.root === tmp && again.ok && againSaid && !/commit \.gitattributes/.test(againSaid)
    && created === "*.aot merge=aot\naot.files/godel.tsv merge=union\n" && appended === "*.png binary\n*.aot merge=aot\naot.files/godel.tsv merge=union\n"
    ? "PASS (git merge: set up from the open file's repository; nothing to commit the second time; a .gitattributes made, or one without a final newline kept whole; git not there said)"
    : "UNEXPECTED git merge setup edges " + JSON.stringify({ noGit, first, again, againSaid, created, appended }));

  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "aot-norepo-"));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "aot-worktree-"));
  fs.writeFileSync(path.join(worktree, ".git"), "gitdir: elsewhere\n");
  fs.writeFileSync(path.join(tmp, ".git", "config"), '[merge "aot"]\n\tdriver = node "C:/gone/extension/verify.js" --merge %O %A %B %P\n');
  ext._test.setGit(() => { throw new Error("git is busy"); });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: plain } }, { uri: { fsPath: worktree } }, { uri: { fsPath: tmp } }];
  let repairThrew = null;
  try { ext._test.repairGitMerge(); } catch (e) { repairThrew = e; }
  console.log(!repairThrew
    ? "PASS (git merge: the repair passes over a folder in no repository, a worktree's .git file, and git failing, quietly)"
    : "UNEXPECTED git merge repair threw " + repairThrew.message);
  ext._test.setGit(null);
  vscode.window.activeTextEditor = activeBefore;
  vscode.workspace.workspaceFolders = foldersBefore;
  for (const d of [tmp, plain, worktree]) fs.rmSync(d, { recursive: true, force: true });
}

// 7c4) the lightbulb's "move up" really edits the document; when the file
// moved on since the warning, it says so and edits nothing; and the
// repo-wide reconcile removes a stale '...' note from a file on disk. Run
// from the sequential Python block (12), since it moves the workspace.
async function hoistAndReconcile() {
  const os = require("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aot-hoist-"));
  fs.mkdirSync(path.join(tmp, ".git"));
  const vPath = path.join(tmp, "Garage.aot");
  fs.writeFileSync(vPath, ["Vehicle", "    Car", "        wheels: 4", "        doors: 5", "    Van", "        wheels: 4", "        doors: 3"].join("\n"));
  const doc = await vscode.workspace.openTextDocument(vPath);
  const activeBefore = vscode.window.activeTextEditor;
  vscode.window.activeTextEditor = { document: doc };
  await plainCommands.get("aot.hoistValue")(1, "wheels", "4", "hoist");
  const moved = doc.getText() === ["Vehicle", "    wheels: 4", "    Car", "        doors: 5", "    Van", "        doors: 3"].join("\n");
  vscode.window.activeTextEditor = { document: doc };
  vscode.window._status = "";
  await plainCommands.get("aot.hoistValue")(99, "wheels", "4", "hoist");
  const stale = /nothing to move/.test(vscode.window._status || "");
  console.log(moved && stale
    ? "PASS (hoists: 'move up' writes the fact once on the parent and takes it off each child; a stale lightbulb edits nothing)"
    : "UNEXPECTED hoist command " + JSON.stringify({ text: doc.getText(), status: vscode.window._status }));
  const dPath = path.join(tmp, "Kitchen.aot");
  fs.writeFileSync(dPath, ["Drink", "    temperature: cold", "    Tea", "        temperature: hot", "    Soup", "        temperature: warm"].join("\n"));
  const docD = await vscode.workspace.openTextDocument(dPath);
  vscode.window.activeTextEditor = { document: docD };
  await plainCommands.get("aot.hoistValue")(1, "temperature", "", "bare");
  console.log(docD.getText() === ["Drink", "    temperature", "    Tea", "        temperature: hot", "    Soup", "        temperature: warm"].join("\n")
    ? "PASS (hoists: 'keep just the attribute' takes the dead value off the line)"
    : "UNEXPECTED keep just " + JSON.stringify(docD.getText()));
  // a table ending the file: the column and the fact are one edit, not two meeting at its end
  const pPath = path.join(tmp, "Ledger.aot");
  fs.writeFileSync(pPath, ["Payment|currency|amount", "P1     |EUR     |10", "P2     |EUR     |20", "P3     |EUR     |30"].join("\n"));
  const docP = await vscode.workspace.openTextDocument(pPath);
  vscode.window.activeTextEditor = { document: docP };
  await plainCommands.get("aot.hoistValue")(1, "currency", "EUR", "hoist");
  console.log(docP.getText() === ["Payment|amount", "P1     |10", "P2     |20", "P3     |30", "    currency: EUR"].join("\n")
    ? "PASS (hoists: 'move up' on a table drops the column and writes the fact under it, the table flush)"
    : "UNEXPECTED hoist table " + JSON.stringify(docP.getText()));

  const aPath = path.join(tmp, "Lamps.aot"), bPath = path.join(tmp, "Store.aot");
  fs.writeFileSync(aPath, ["Lantern", "    fuel", "    - Hurricane", "        fuel: oil", "    ... 2 more in Store.aot:1"].join("\n"));
  fs.writeFileSync(bPath, ["Torch", "    - Pocket", "    - Head"].join("\n"));
  const foldersBefore = vscode.workspace.workspaceFolders;
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  await plainCommands.get("aot.reconcileAcrossFiles")();
  const lamps = fs.readFileSync(aPath, "utf8");
  console.log(!/more in Store\.aot/.test(lamps) && /- Hurricane/.test(lamps)
    ? "PASS (reconcile across files: a '...' note no other file backs any more is removed from the file on disk)"
    : "UNEXPECTED reconcile across files " + JSON.stringify(lamps));
  vscode.workspace.workspaceFolders = foldersBefore;
  vscode.window.activeTextEditor = activeBefore;
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

// 7d0) spelling on or off from Ctrl+.: beside Replace and Accept on a flagged
// word, and anywhere else only when Ctrl+. asks, never in the lightbulb that
// follows the cursor. Off, the hints and the English plural guess both stop.
{
  const doc = makeDoc("c:\\repo\\Spelt.aot", "Huis\n    - recieve\n");
  vscode.workspace._open(doc);
  const diags = published.get(doc.uri.toString()) || [];
  const hint = diags.find((d) => /is not in the dictionary/.test(d.message));
  const plural = diags.find((d) => /appears plural/.test(d.message));
  const titles = (context, range) => codeActionsProvider.provideCodeActions(doc, range, context).map((f) => f.title);
  const onWord = titles({ diagnostics: [hint] }, hint.range);
  const onPlural = titles({ diagnostics: [plural] }, plural.range);
  console.log(hint && plural && onWord.some((t) => /^Replace with 'receive'/.test(t)) && onWord.some((t) => /^Accept 'recieve'/.test(t))
    && onWord.includes("Turn off spelling checks") && onPlural.includes("Turn off spelling checks") && onPlural.some((t) => /^Accept 'Huis'/.test(t))
    ? "PASS (spelling: Ctrl+. on a flagged word offers Replace, Accept and the off switch)"
    : "UNEXPECTED spelling actions " + JSON.stringify({ onWord, onPlural }));
  const elsewhere = new vscode.Range(0, 0, 0, 0);
  const automatic = titles({ diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Automatic }, elsewhere);
  const asked = titles({ diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke }, elsewhere);
  console.log(!automatic.some((t) => /spelling/.test(t)) && asked.includes("Turn off spelling checks")
    ? "PASS (spelling: elsewhere the switch answers Ctrl+. only, so no lightbulb follows the cursor)"
    : "UNEXPECTED spelling offer " + JSON.stringify({ automatic, asked }));
  plainCommands.get("aot.toggleSpelling")();
  const off = configStore.spellingHints === false;
  vscode.workspace._open(doc);
  const quiet = (published.get(doc.uri.toString()) || []).filter((d) => /is not in the dictionary|appears plural/.test(d.message));
  const backOn = titles({ diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke }, elsewhere);
  console.log(off && !quiet.length && backOn.includes("Turn on spelling checks") && !backOn.includes("Turn off spelling checks")
    ? "PASS (spelling: turned off, the hints and the plural guess stop, and Ctrl+. offers the way back)"
    : "UNEXPECTED spelling off " + JSON.stringify({ off, quiet: quiet.map((d) => d.message), backOn }));
  plainCommands.get("aot.toggleSpelling")();
  vscode.workspace._open(doc);
  const again = (published.get(doc.uri.toString()) || []).filter((d) => /is not in the dictionary|appears plural/.test(d.message)).length === 2;
  console.log(configStore.spellingHints === true && again
    ? "PASS (spelling: turned back on, both return)"
    : "UNEXPECTED spelling on " + JSON.stringify(configStore.spellingHints));
  delete configStore.spellingHints;
  vscode.workspace._close(doc);
}

// 7d1) the lightbulbs on the repo-wide findings and on an unlisted value read
// their names back out of the message, so a reworded finding must not take the
// fix off the bulb. Driven by the messages the checks really produce.
{
  const repo = require("../src/repo");
  const { unlistedValues } = require("../src/crosslinks");
  const build = (files) => Object.entries(files).map(([file, text]) => {
    const rootName = file.replace(/\.[^.]*$/, "");
    return { file, text, rootName, ...lint(text, rootName) };
  });
  const said = (files, autoReconcile) => {
    const f = repo.findings("a.aot", repo.occurrences(build(files)), { autoReconcile });
    return [...f.errors, ...f.warnings][0].message;
  };
  const doc = makeDoc("c:\\repo\\Lightbulb.aot", "Pet\n    colour: red");
  const range = new vscode.Range(0, 0, 0, 3);
  const bulb = (message) => codeActionsProvider.provideCodeActions(doc, range, { diagnostics: [{ source: "aot", message, range }] })
    .filter((f) => f.command && f.diagnostics);

  const clash = bulb(said({ "a.aot": "Pet\n    colour: red", "b.aot": "Pet\n    colour: blue" }, true));
  console.log(clash.map((f) => f.title).join("|") === "Set 'colour' to 'red' everywhere|Set 'colour' to 'blue' everywhere"
    && JSON.stringify(clash[1].command.arguments) === JSON.stringify(["Pet", "colour", "blue"])
    ? "PASS (repo lightbulb: one attribute with two values offers each value, everywhere)"
    : "UNEXPECTED repo value clash " + JSON.stringify(clash.map((f) => f.title)));

  const genus = bulb(said({ "a.aot": "Animal\n    Pet\n        age", "b.aot": "Thing\n    Pet\n        age" }, true));
  console.log(genus.length === 1 && /^Qualify this 'Pet'/.test(genus[0].title)
    ? "PASS (repo lightbulb: one Concept under two kinds offers to qualify it)"
    : "UNEXPECTED repo genus clash " + JSON.stringify(genus.map((f) => f.title)));

  const reconciles = (actions) => actions.length === 1 && actions[0].command.command === "aot.reconcileAcrossFiles";
  const gone = bulb(said({ "a.aot": "Person\n    - Ann\n    ... 1 more in b.aot:1", "b.aot": "Dog" }, false));
  const stale = bulb(said({ "a.aot": "Person\n    - Ann", "b.aot": "Person\n    - Bob" }, false));
  console.log(reconciles(gone) && reconciles(stale)
    ? "PASS (repo lightbulb: a '...' note gone stale, either way, offers to reconcile)"
    : "UNEXPECTED repo stale note " + JSON.stringify([gone.map((f) => f.title), stale.map((f) => f.title)]));

  const text = "Person\n    - Socrates\nClub\n    person: James";
  const r = lint(text, "Lightbulb");
  const add = bulb(unlistedValues(text, r.root, r.nodes)[0].message);
  console.log(add.length === 1 && add[0].title === "Add 'James' as an Example of 'Person'"
    && JSON.stringify(add[0].command.arguments) === JSON.stringify(["James", "Person"])
    ? "PASS (lightbulb: an unlisted value offers to add itself as an Example of its Concept)"
    : "UNEXPECTED unlisted lightbulb " + JSON.stringify(add.map((f) => f.title)));
}

// 7d2) an Example's name is part of what it is: two ledger rows carrying
// the same values are two payments, not a clash. And the flip between a
// table and free text is NOT on the lightbulb: offered on every line of a
// Concept, it lit the bulb everywhere (it stays on its keys and the menu).
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
  console.log(!flip
    ? "PASS (flip: the lightbulb no longer offers the flip)"
    : "UNEXPECTED flip action " + JSON.stringify(flip.title));
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
// the cells — Ctrl+D fills a value down, Alt+↓ moves the whole Example; on a
// bare attribute line the key is VS Code's own again, and Tab is everywhere
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

  // on an Example's line and on an attribute alike, Tab is VS Code's own
  const ownTabAt = async (line, ch) => {
    editor.selection = new vscode.Selection(line, ch, line, ch);
    vscode.commands._calls.length = 0;
    await registeredCommands.get("aot.table.nextCell")(editor);
    return vscode.commands._calls.some((c) => c[0] === "tab") && editor.selection.active.line === line;
  };
  const onExampleTab = await ownTabAt(2, 6), onValueTab = await ownTabAt(3, 13), onAttrTab = await ownTabAt(1, 4);
  console.log(onExampleTab && onValueTab && onAttrTab
    ? "PASS (free text: Tab is VS Code's own, on an Example, a value and an attribute)"
    : "UNEXPECTED free-text Tab " + JSON.stringify({ onExampleTab, onValueTab, onAttrTab, sel: editor.selection.a }));

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

  // the declaration line is the column's header: the column keys take it
  // (aot.inColumn), Tab does not (aot.inGrid stays false there)
  const columnContext = () => {
    vscode.window.activeTextEditor = editor; // other async blocks swap it between awaits
    vscode.commands._calls.length = 0;
    vscode.window._selectionChanged({ textEditor: editor, selections: [editor.selection] });
    const set = vscode.commands._calls.find((c) => c[0] === "setContext" && c[1] === "aot.inColumn");
    return set && set[2];
  };
  editor.selection = new vscode.Selection(1, 4, 1, 4); // the bare 'age' declaration
  const declColumn = columnContext() === true && gridContext() === false;
  vscode.window.activeTextEditor = editor;
  editor.selection = new vscode.Selection(0, 2, 0, 2); // the Concept's own line
  const conceptColumn = columnContext() === false;
  editor.selection = new vscode.Selection(1, 4, 1, 4);
  await registeredCommands.get("aot.table.deleteColumn")(editor);
  const gone = !lines.some((l) => /\bage\b/.test(l)) && lines.length === 5;
  console.log(declColumn && conceptColumn && gone
    ? "PASS (free text: Alt+Shift+← on a declaration line deletes the column, declaration and values)"
    : "UNEXPECTED declaration delete " + JSON.stringify({ declColumn, conceptColumn, lines }));
  // a declaration with no Example below it, to the document's last line, is no column
  lines.push("Other", "    note");
  editor.selection = new vscode.Selection(lines.length - 1, 5, lines.length - 1, 5);
  const lastColumn = columnContext();
  lines.splice(-2);
  console.log(lastColumn === false
    ? "PASS (free text: a declaration with no Example below it, to the end of the file, takes no column keys)"
    : "UNEXPECTED trailing declaration context " + JSON.stringify(lastColumn));
  vscode.window.activeTextEditor = active;
})();

// 7d5) Alt+Shift+← in a table deletes the cursor's column, and never the
// first one, which names the Concept and its Examples
(async () => {
  let lines = ["Otter|size|colour", "Ollie|5   |brown"];
  const doc = makeDoc("c:\\repo\\Cols.aot", lines.join("\n"));
  doc.eol = vscode.EndOfLine.LF;
  doc.getText = () => lines.join("\n");
  doc.lineAt = (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] });
  Object.defineProperty(doc, "lineCount", { get: () => lines.length });
  const editor = {
    document: doc,
    selection: new vscode.Selection(1, 6, 1, 6), // in Ollie's size
    edit: (cb) => {
      cb({ replace: (range, t) => { lines = t.split("\n"); } });
      return Promise.resolve(true);
    },
    revealRange: () => {},
  };
  await registeredCommands.get("aot.table.deleteColumn")(editor);
  await new Promise((r) => setImmediate(r));
  const deleted = lines.join("|") === "Otter|colour|Ollie|brown";
  editor.selection = new vscode.Selection(1, 1, 1, 1); // in Ollie's name
  const before = lines.join("\n");
  await registeredCommands.get("aot.table.deleteColumn")(editor);
  const spared = lines.join("\n") === before;
  console.log(deleted && spared
    ? "PASS (table: Alt+Shift+← deletes the cursor's column, never the name column)"
    : "UNEXPECTED table column delete " + JSON.stringify({ lines }));
})();

// 7d6) no two contributed keybindings claim one key where both could fire:
// a shadowed Alt+Shift+← is a key that silently stops working
{
  const kb = require("../package.json").contributes.keybindings;
  const clashes = [];
  kb.forEach((a, i) => kb.slice(i + 1).forEach((b) => {
    if (a.key !== b.key || (a.mac || "") !== (b.mac || "")) return;
    // two clauses can both hold unless one negates what the other requires
    const terms = (w) => String(w || "").split("&&").map((t) => t.trim()).filter(Boolean);
    const neg = (t) => (t.startsWith("!") ? t.slice(1) : "!" + t);
    const exclusive = terms(a.when).some((t) => terms(b.when).includes(neg(t)));
    if (!exclusive) clashes.push(`${a.key}: ${a.command} / ${b.command}`);
  }));
  const deleteKey = kb.find((k) => k.command === "aot.table.deleteColumn");
  console.log(!clashes.length && deleteKey && deleteKey.key === "alt+shift+left" && /aot\.inColumn/.test(deleteKey.when)
    ? "PASS (keybindings: none shadows another; Alt+Shift+← deletes a column wherever a column is)"
    : "UNEXPECTED keybinding clashes " + JSON.stringify({ clashes, deleteKey }));
}

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
    return [...parkDecorated.values()].find((set) => set.some((d) => /\*\*Calculated\*\*/.test(d.hoverMessage.value))) || [];
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
// nothing has computed yet draws no verdict from the linter, and Tab itself
// computes nothing.
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

  // Tab aligns and computes nothing: the 15 stays until the file calculates
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
      ? "PASS (derivation: Tab computes nothing itself — the value waits for the file to calculate)"
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

// 8e) the ghost text: standing in a name that is used elsewhere says how
// many uses it has (typing over it offers to update them); an unused name
// shows nothing
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
    && hint[0].renderOptions.after.contentText === "2 uses elsewhere"
    && hint[0].range.a[0] === 1
    ? "PASS (nudge: a used Concept shows its count of uses in ghost text)"
    : "UNEXPECTED nudge " + JSON.stringify(hint));
  editor.selections = [new vscode.Selection(0, 2, 0, 2)];
  vscode.window._selectionChanged({ textEditor: editor, selections: editor.selections });
  const cleared = shown.pop();
  console.log(cleared && cleared.length === 0
    ? "PASS (nudge: an unused name shows nothing)"
    : "UNEXPECTED nudge clear " + JSON.stringify(cleared));

  // standing in a usage, typing may be the right move — this one reference
  // pointing somewhere else — so the ghost text names its target and says so
  editor.selections = [new vscode.Selection(4, 10, 4, 10)]; // in 'person:', wearing Concept Person's name
  vscode.window._selectionChanged({ textEditor: editor, selections: editor.selections });
  const usage = shown.pop();
  console.log(usage && usage.length === 1 && usage[0].range.a[0] === 4
    && usage[0].renderOptions.after.contentText === "names 'Person' — typing changes just this one"
    ? "PASS (nudge: an attribute wearing a Concept's name says what it names)"
    : "UNEXPECTED usage nudge " + JSON.stringify(usage));
  editor.selections = [new vscode.Selection(4, 18, 4, 18)]; // in the value 'Socrates'
  vscode.window._selectionChanged({ textEditor: editor, selections: editor.selections });
  const value = shown.pop();
  console.log(value && value.length === 1
    && value[0].renderOptions.after.contentText === "names 'Socrates' — typing changes just this one"
    ? "PASS (nudge: a value naming an Example says what it names)"
    : "UNEXPECTED value nudge " + JSON.stringify(value));
}

// 8f) a name typed over: the uses it leaves behind — here and in another
// file — are offered for updating once the cursor leaves the name, in one
// notice and on the lightbulb; F2 reaches the other file too; undo never
// starts one. Late, after the CSV block (lateBlocks): it answers the shared
// warning mock and stands in for applyEdit while it runs.
late(3200, async () => {
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "aot-typed-"));
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmp } }];
  const herePath = path.join(tmp, "Here.aot"), otherPath = path.join(tmp, "Other.aot"), peerPath = path.join(tmp, "Peer.aot");
  const start = ["Person", "    - Socrates", "Emp", "    person: Socrates", "    friend (person): Socrates"];
  fs.writeFileSync(herePath, start.join("\n"));
  fs.writeFileSync(otherPath, ["Visit", "    person: Socrates"].join("\n"));
  fs.writeFileSync(peerPath, ["Person", "    - Plato"].join("\n"));
  // Here first: the file whose 'Person' other files resolve a name to
  for (const p of [herePath, otherPath, peerPath]) vscode.workspace._aotCreated({ fsPath: p });
  const lines = start.slice();
  const doc = {
    languageId: "aot", fileName: herePath, eol: vscode.EndOfLine.LF,
    uri: { fsPath: herePath, toString: () => "file:///typed-here" },
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  doc.uri.__doc = doc;
  const editor = { document: doc, selection: new vscode.Selection(1, 8, 1, 8), selections: [], setDecorations: () => {}, revealRange: () => {} };
  const activeBefore = vscode.window.activeTextEditor, applyBefore = vscode.workspace.applyEdit;
  vscode.window.activeTextEditor = editor;
  vscode.workspace._open(doc);
  const moveTo = (line, ch) => {
    editor.selection = new vscode.Selection(line, ch, line, ch);
    editor.selections = [editor.selection];
    vscode.window._selectionChanged({ textEditor: editor, selections: editor.selections });
  };
  const type = (line, from, to, text, reason) => {
    const was = lines[line];
    lines[line] = was.slice(0, from) + text + was.slice(to);
    vscode.workspace._changed({ document: doc, reason, contentChanges: [{ text, range: new vscode.Range(line, from, line, to) }] });
  };
  const applied = [];
  vscode.workspace.applyEdit = async (edit) => { applied.push(edit); return true; };
  const results = [];
  const expect = (name, ok, detail) => results.push(ok ? `PASS (typed rename: ${name})` : `UNEXPECTED typed rename ${name} ${JSON.stringify(detail)}`);

  // 'Socrates' becomes 'Sokrates', a character at a time, the cursor in it
  type(1, 8, 9, "k");             // So|c|rates -> Sokrates
  moveTo(1, 9);
  vscode.window._warnings.length = 0;
  // the notice goes unanswered — whatever answer another block has set — so
  // the offer stays on the lightbulb
  vscode.window._answers.push({ key: "typed", test: /is now/, answer: undefined });
  moveTo(3, 4);                   // and away
  await new Promise((r) => setTimeout(r, 30));
  const said = vscode.window._warnings.find((w) => /is now/.test(w)) || "";
  expect("leaving the name counts the uses it left, here and in another file",
    /'Socrates' is now 'Sokrates' — 3 uses still say 'Socrates' — 2 here, 1 in Other\.aot/.test(said), said);
  const fixes = codeActionsProvider.provideCodeActions(doc, new vscode.Range(1, 0, 1, 0), { diagnostics: [] });
  const fix = fixes.find((f) => /Update 3 uses of 'Socrates' to 'Sokrates'/.test(f.title));
  expect("the offer stays on the declaration's lightbulb", !!fix, { titles: fixes.map((f) => f.title), warnings: vscode.window._warnings, lines });
  if (fix) await plainCommands.get("aot.applyTypedRename")(...fix.command.arguments);
  const ops = (applied[0] && applied[0].ops) || [];
  const at = (o) => `${o.uri.fsPath === otherPath ? "Other" : o.uri.fsPath === peerPath ? "Peer" : "Here"}:${o.range.a.slice(0, 2).join(",")}=${o.text}`;
  expect("taken, one edit updates every use — this file's and the other file's",
    ops.map(at).sort().join(" ") === ["Here:3,12=Sokrates", "Here:4,21=Sokrates", "Other:1,12=Sokrates"].sort().join(" "), ops.map(at));
  expect("taken, the offer leaves the lightbulb",
    !codeActionsProvider.provideCodeActions(doc, new vscode.Range(1, 0, 1, 0), { diagnostics: [] }).some((f) => /Update/.test(f.title)));

  // undo brings a name back: it is no rename, and offers nothing
  vscode.window._warnings.length = 0;
  type(1, 8, 9, "c", 1);          // reason 1: Undo
  moveTo(3, 4);
  await new Promise((r) => setTimeout(r, 30));
  expect("undo starts nothing", !vscode.window._warnings.some((w) => /is now/.test(w)), vscode.window._warnings);

  // F2 renames across the workspace: the peer Concept in Other.aot too
  const f2 = renameProvider.provideRenameEdits(doc, new vscode.Position(0, 2), "Human");
  const f2ops = f2.ops.map(at).sort();
  expect("F2 on a Concept renames its peer in another file, a reference from a third, and this file's uses",
    f2ops.includes("Here:0,0=Human") && f2ops.includes("Peer:0,0=Human") && f2ops.includes("Other:1,4=human") && f2ops.includes("Here:3,4=human"), f2ops);

  vscode.workspace.applyEdit = applyBefore;
  vscode.window._answers = vscode.window._answers.filter((a) => a.key !== "typed");
  vscode.window.activeTextEditor = activeBefore;
  vscode.workspace.workspaceFolders = undefined;
  for (const p of [otherPath, peerPath, herePath]) vscode.workspace._aotDeleted({ fsPath: p });
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const r of results) console.log(r);
});

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

// 9b2) nothing fills itself in while formulas are off: a formula is Python, which
// runs only once it is turned on. Opening a file, leaving a line, a stale table
// cell — with it off, none of them computes a value.
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
    ? "PASS (no fill: with formulas off, opening a file or leaving a line computes nothing)"
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
  // in a workspace VS Code does not trust, a hover loads and contacts nothing
  configStore.urlMetadata = false;
  vscode.workspace.isTrusted = false;
  const untrustedImg = await hoverProvider.provideHover(docF, new vscode.Position(3, 12));
  vscode.workspace.isTrusted = true;
  delete configStore.urlMetadata;
  console.log(!(untrustedImg && /!\[\]\(https:/.test(untrustedImg.contents.value))
    ? "PASS (hover: an untrusted workspace loads no remote picture)"
    : "UNEXPECTED untrusted hover " + JSON.stringify(untrustedImg.contents.value));
  // and no hover anywhere contacts an address on this machine or its network
  const internal = "Doc\n    logo: http://192.168.1.1/logo.png\n    admin: http://localhost:8080/x";
  const docI = {
    languageId: "aot", fileName: aot, eol: vscode.EndOfLine.LF,
    uri: { toString: () => "file:///internal" },
    get lineCount() { return internal.split("\n").length; },
    getText: () => internal,
    lineAt: (i) => { const l = internal.split("\n")[i]; return { range: new vscode.Range(i, 0, i, l.length), text: l }; },
  };
  configStore.urlMetadata = false;
  const internalImg = await hoverProvider.provideHover(docI, new vscode.Position(1, 18));
  delete configStore.urlMetadata;
  const internalUrl = await hoverProvider.provideHover(docI, new vscode.Position(2, 18));
  const named = (h) => h && /192\.168|localhost/.test(String(h.contents && h.contents.value));
  console.log(!named(internalImg) && !named(internalUrl)
    ? "PASS (hover: an internal address is never contacted)"
    : "UNEXPECTED internal hover " + JSON.stringify([internalImg && internalImg.contents.value, internalUrl && internalUrl.contents.value]));
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

// 9d) findings elsewhere wait while you write (hold.js). Typing a first
// child under Parent makes Parent "have 1 sub-Concept" — a finding about a
// line not being typed, so it waits, counted in the status bar; one already
// on screen (the plural name) keeps showing; a second sibling typed makes it
// moot without it ever flashing; and leaving the family shows what waited.
// Begun once this file's synchronous blocks have run, so its debounces are
// the ones it measures.
(async () => {
  await new Promise((r) => setTimeout(r, 0));
  const lines = ["Animals", "Parent", "Stone"];
  const doc = {
    languageId: "aot", fileName: "c:\\repo\\Hold.aot", eol: vscode.EndOfLine.LF,
    uri: { toString: () => "file:///hold" },
    get lineCount() { return lines.length; },
    getText: () => lines.join("\n"),
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length), text: lines[i] }),
  };
  const editor = { document: doc, selection: new vscode.Selection(1, 6, 1, 6), setDecorations: () => {}, revealRange: () => {} };
  const activeBefore = vscode.window.activeTextEditor;
  vscode.window.activeTextEditor = editor;
  vscode.workspace._open(doc);
  const diagsOf = () => published.get(doc.uri.toString()) || [];
  const plural = () => diagsOf().some((d) => /appears plural/.test(d.message));
  const lone = () => diagsOf().some((d) => /has 1 sub-Concept/.test(d.message));
  const settle = () => new Promise((r) => setTimeout(r, 400)); // past the 300 ms debounce
  const moveTo = (line, ch) => {
    editor.selection = new vscode.Selection(line, ch, line, ch);
    vscode.window._selectionChanged({ textEditor: editor, selections: [editor.selection] });
  };
  const before = plural() && !lone();

  // Enter at the end of 'Parent' and '    Child' typed: Parent's line is
  // not edited, so what is newly said of it waits
  lines.splice(2, 0, "    Child");
  vscode.workspace._changed({ document: doc, contentChanges: [{ text: "\n    Child", range: new vscode.Range(1, 6, 1, 6) }] });
  moveTo(2, 9);
  await settle();
  const status = ext._test.holdStatus();
  const waiting = plural() && !lone() && status && status.shown && /1 waiting — leave 'Parent'/.test(status.text);

  // moving about inside the family — Child's line — ends nothing
  moveTo(2, 4);
  const stillWaiting = !lone();

  // a second sibling: the finding is moot, and never showed
  lines.splice(3, 0, "    Child Two");
  vscode.workspace._changed({ document: doc, contentChanges: [{ text: "\n    Child Two", range: new vscode.Range(2, 9, 2, 9) }] });
  moveTo(3, 13);
  await settle();
  const moot = !lone() && !status.shown;

  // take the second one away again: it waits once more; then leave the
  // family — Stone's line — and it shows
  lines.splice(3, 1);
  vscode.workspace._changed({ document: doc, contentChanges: [{ text: "", range: new vscode.Range(2, 9, 3, 13) }] });
  moveTo(2, 9);
  await settle();
  const waitsAgain = !lone();
  moveTo(3, 2);
  const shown = lone() && plural() && !status.shown;
  vscode.window.activeTextEditor = activeBefore;
  console.log(before && waiting && stillWaiting && moot && waitsAgain && shown
    ? "PASS (hold: a new finding off the lines being typed waits, counted, until the cursor leaves the family; one already shown stays; a moot one never flashes)"
    : "UNEXPECTED hold behaviour " + JSON.stringify({ before, waiting, stillWaiting, moot, waitsAgain, shown, status: status && status.text, diags: diagsOf().map((d) => d.message.slice(0, 40)) }));
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
// follows computing nothing: a flip is a re-spelling, and each derivation
// waits for the next run where it has landed. A default a row states rides in
// the header (`tax rate: 0.2`), so it flips to one standalone table.
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
    "        tax rate: 0.1",
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
    selection: new vscode.Selection(6, 10, 6, 10),
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
  console.log(gridLines.join("\n") === [
    "Invoice|tax rate: 0.2|price|vat",
    "INV-1  |0.1          |100  |20 =@price*@tax rate",
    "INV-9  |             |50   |10 =@price*@tax rate",
  ].join("\n")
    ? "PASS (flip: a cursor inside the Concept writes the whole Concept out as a grid, its default in the header)"
    : "UNEXPECTED flip grid " + JSON.stringify(gridLines));
  console.log(lint(text, "Books").errors.length === 0
    ? "PASS (flip: the flipped file verifies — V is unchanged by a re-spelling)"
    : "UNEXPECTED flip errors " + JSON.stringify(lint(text, "Books").errors.map((e) => e.message)));
  // the cursor was on INV-1's 'vat' line: it stays on that idea, now INV-1's vat cell
  console.log(editor.selection.a.join(",") === [1, 28, 1, 28].join(",")
    ? "PASS (flip: the cursor stays on its idea — a value line's becomes that value's cell)"
    : "UNEXPECTED flip cursor " + JSON.stringify(editor.selection.a));

  // and back, the same key from inside the grid: every Example, value and
  // derivation returns — and the grid's header, which is a declaration,
  // returns as the attribute lines that declare the same columns, the
  // default's cell as the line stating that default
  editor.selection = new vscode.Selection(2, 12, 2, 12); // INV-9's empty 'tax rate' cell
  await registeredCommands.get("aot.toggleTableForm")(editor);
  // an empty cell writes no line, so the cursor goes to its Example's name
  const backAt = editor.selection.a.join(",");
  console.log(text === [
    "Invoice",
    "    tax rate: 0.2",
    "    price",
    "    vat",
    "    - INV-1",
    "        tax rate: 0.1",
    "        price: 100",
    "        vat: 20 =@price*@tax rate",
    "    - INV-9",
    "        price: 50",
    "        vat: 10 =@price*@tax rate",
  ].join("\n")
    ? "PASS (flip: the same key writes it back, every value and derivation intact)"
    : "UNEXPECTED unflipped " + JSON.stringify(text.split("\n")));
  console.log(backAt === [8, 6, 8, 6].join(",")
    ? "PASS (flip: a cursor in an empty cell lands on its Example's name in line form)"
    : "UNEXPECTED unflip cursor " + backAt);

  // a Concept with totals: one flush table, its values one level under it, and
  // the cursor stays on the value it stood on, both ways
  const tripLines = [
    "Trip",
    "    total: 195 km =@Trip@distance.sum()",
    "    distance (km)",
    "    - A",
    "        distance (km): 120",
    "    - B",
    "        distance (km): 75",
  ];
  text = tripLines.join("\n");
  editor.selection = new vscode.Selection(1, 6, 1, 6); // inside 'total'
  await registeredCommands.get("aot.toggleTableForm")(editor);
  console.log(text === ["Trip|distance (km)", "A   |120", "B   |75", "    total: 195 km =@Trip@distance.sum()"].join("\n")
    && editor.selection.a.join(",") === [3, 6, 3, 6].join(",") && lint(text, "Books").errors.length === 0
    ? "PASS (flip: a value no row states stands under the flush table, the cursor still on it)"
    : "UNEXPECTED flip under " + JSON.stringify({ text, sel: editor.selection.a }));
  await registeredCommands.get("aot.toggleTableForm")(editor);
  console.log(text === tripLines.join("\n") && editor.selection.a.join(",") === [1, 6, 1, 6].join(",")
    ? "PASS (flip: the same key, from the line under the table, writes the lines it came from)"
    : "UNEXPECTED unflip under " + JSON.stringify({ text, sel: editor.selection.a }));

  // a Concept with no Examples flips too — its header alone — and the
  // cursor stays on the declaration it stood on
  text = ["Colour", "    hue", "    shade"].join("\n");
  editor.selection = new vscode.Selection(2, 6, 2, 6); // inside 'shade'
  await registeredCommands.get("aot.toggleTableForm")(editor);
  console.log(text === "Colour|hue|shade" && editor.selection.a.join(",") === [0, 13, 0, 13].join(",")
    ? "PASS (flip: a Concept with no Examples is written as its header, the cursor on the same column)"
    : "UNEXPECTED empty flip " + JSON.stringify({ text, sel: editor.selection.a }));
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
// needed: the gates, F9 writing values, a Concept's table, a picture
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
  const batches = [];
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
    else if (it.code === "_aot_ref(0)*0.2") bound = num(it.targets[0].text) * 0.2;
    else if (it.code === "_aot_ref(0)-1") bound = num(it.targets[0].text) - 1;
    else return { ok: false, error: `NameError: name '${it.code}' is not defined` };
    const v = it.value === "" ? null : Number.isNaN(num(it.value)) ? it.value : num(it.value);
    const rel = { "==": (a, b) => a === b, ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, "<": (a, b) => a < b, ">": (a, b) => a > b }[it.rel];
    const many = Array.isArray(bound) ? bound : null;
    const out = { ok: true, holds: (many || [bound]).some((b) => rel(v, b)), bound: many ? "one of " + many.map((x) => `'${x}'`).join(", ") : String(bound) };
    if (it.rel === "==" && !many) out.define = { kind: "number", value: bound };
    return out;
  };
  let shrinks = 0; // shrink() returns two Concepts the first time, one after
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
      case "load_all()": return {
        ok: true, ms: 4, result: {
          kind: "grids", summary: "<2 Concepts>", grids: [
            { name: "sales", columns: ["month", "amount"], rows: [["1", "2026-01", 15000]] },
            { name: "Region", columns: ["code"], rows: [["1", "EU"]] },
          ],
        },
      };
      case "1+1": return { ok: true, result: { kind: "number", value: 2 }, ms: 1 };
      case "two()": return {
        ok: true, ms: 2, result: {
          kind: "grids", summary: "<2 Concepts>", grids: [
            { name: "Gen Own", columns: ["x"], rows: [["1", "from the bare line"]] },
            { name: "Gen Extra", columns: ["y"], rows: [["1", "b"]] },
          ],
        },
      };
      case "own()": return { ok: true, ms: 1, result: { kind: "frame", columns: ["x"], rows: [["1", "its own"]], summary: "<1 row>" } };
      case "({})": return { ok: true, ms: 1, result: { kind: "grids", grids: [], summary: "<0 Concepts>" } };
      case "shrink()": return shrinks++ === 0
        ? { ok: true, ms: 1, result: { kind: "grids", summary: "<2 Concepts>", grids: [
          { name: "Stock", columns: ["n"], rows: [["1", 5]] }, { name: "Old Stock", columns: ["n"], rows: [["1", 2]] }] } }
        : { ok: true, ms: 1, stdout: "shrinking\n", result: { kind: "grids", summary: "<1 Concept>", grids: [{ name: "Stock", columns: ["n"], rows: [["1", 6]] }] } };
      case "len(_aot_ref(0))":
        return req.targets[0].kind === "object" && req.targets[0].address === "@=1" && req.targets[0].key === "Sales"
          ? { ok: true, result: { kind: "number", value: 1 }, ms: 1 } : { ok: false, error: "not the live table the bare line wrote " + JSON.stringify(req.targets) };
      case "_aot_ref(0)*0.2": return { ok: true, result: { kind: "number", value: Number(req.targets[0].text) * 0.2 }, ms: 1 };
      case "_aot_ref(0)-1": return { ok: true, result: { kind: "number", value: Number(req.targets[0].text) - 1 }, ms: 1 };
      case "_aot_ref(0)*2": return { ok: true, result: { kind: "number", value: Number(String(req.targets[0].text).replace(/,/g, "")) * 2 }, ms: 1 };
      case '("draft", "sent")': return { ok: true, many: true, ms: 1 };
      case "_aot_ref(0).sum()": return { ok: true, result: { kind: "number", value: req.targets[0].values.reduce((n, v) => n + Number(v), 0) }, ms: 1 };
      case "third()": return { ok: true, result: { kind: "number", text: "0.3333333333333333" }, ms: 1 };
      case "whole()": return { ok: true, result: { kind: "number", text: "12345" }, ms: 1 };
      default: return { ok: false, error: `the fake runtime was not taught ${req.code}` };
    }
  };
  let lastSpawn = null;
  let duringEval = null; // what happens in the middle of a formula's running, for a test to say
  const fakeRuntime = (cmd, args, opts) => {
    spawns++;
    lastSpawn = { cmd, args, opts };
    const proc = new EventEmitter();
    // as the runtime does: what reads a formula with no result here does not run at all
    const results = new Set();
    let dead = false;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = {
      write: (s) => {
        const req = JSON.parse(s);
        if (req.op === "evalBatch") {
          // a batch answers a line per formula as each finishes, then says it is done
          batches.push(req);
          setImmediate(() => {
            for (let k = 0; k < req.items.length; k++) {
              const item = req.items[k];
              const one = { op: "eval", address: item.address, code: item.code, host: item.host, value: item.value, targets: item.refs.map((i) => req.targets[i]) };
              const missing = one.targets.find((t) => t.kind === "object" && !results.has(t.address));
              let said;
              if (missing) said = { ok: false, error: `LookupError: ${missing.address} has not been computed in this session` };
              else {
                requests.push(one);
                if (duringEval) duringEval(one);
                if (dead) return;
                if (one.code === "crash()") {
                  dead = true;
                  proc.emit("exit", 1);
                  return;
                }
                said = answer(one);
              }
              if (said.ok) results.add(one.address);
              else results.delete(one.address);
              proc.stdout.emit("data", JSON.stringify(Object.assign({ id: req.id, partial: true, k }, said)) + "\n");
            }
            proc.stdout.emit("data", JSON.stringify({ id: req.id, ok: true, count: req.items.length }) + "\n");
          });
          return;
        }
        if (req.op === "reset") results.clear();
        requests.push(req);
        setImmediate(() => proc.stdout.emit("data", JSON.stringify(Object.assign({ id: req.id }, answer(req))) + "\n"));
      },
      end() {},
    };
    proc.kill = () => {
      dead = true;
      setImmediate(() => proc.emit("exit", null));
    };
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
    return registeredCommands.get("aot.recomputeFormulas")(f.editor);
  };

  const visibleBefore = vscode.window.visibleTextEditors;
  vscode.window.visibleTextEditors = []; // each test here says what is on screen
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
    console.log(infoFirst.length === 8 && infoFirst.every((d) => /^turn on formulas to calculate it — not calculated yet \(aot\.python\.enabled is off\)$/.test(d.message))
      && infoFirst.every((d) => d.source === "formula")
      ? "PASS (python: with formulas off, each one not yet calculated says so, in a collection of its own)"
      : "UNEXPECTED python notes " + JSON.stringify(pyFindings(f.doc).map((d) => d.message)));
    console.log(!(published.get(f.doc.uri.toString()) || []).some((d) => /Python|does not compute/.test(d.message) && d.range.a[0] >= 1 && d.range.a[0] <= 7)
      ? "PASS (python: no Python derivation is a linter error — V never counts them)"
      : "UNEXPECTED python in the linter's findings " + JSON.stringify((published.get(f.doc.uri.toString()) || []).map((d) => d.message)));

    // the first formula offers to turn them on, once; a key pressed always gets an answer
    const offers = () => vscode.window._info.filter((m) => /^AOT: formulas are off\. A formula is Python and runs with your permissions\.$/.test(m)).length;
    ext._test.forgetOffer();
    const offersBefore = offers();
    const autoOff = await ext._test.runPython(f.doc, { mode: "auto" });
    const offerItems = vscode.window._infoItems;
    await ext._test.runPython(f.doc, { mode: "auto" });
    console.log(autoOff.blocked === "off" && spawns === 0 && ran() === 0 && offers() === offersBefore + 1
      && JSON.stringify(offerItems) === JSON.stringify(["Turn on formulas", "Not now"])
      ? "PASS (python: the first formula offers to turn formulas on, once, and nothing starts)"
      : "UNEXPECTED offer " + JSON.stringify({ autoOff, spawns, offers: offers() - offersBefore, offerItems }));
    const offRun = await run(f, 1);
    console.log(offRun && offRun.blocked === "off" && spawns === 0 && ran() === 0 && offers() === offersBefore + 2
      ? "PASS (python: with formulas off, F9 runs nothing, starts nothing, and offers again)"
      : "UNEXPECTED run while off " + JSON.stringify({ offRun, spawns }));
    // one click turns them on
    vscode.window._answers.push({ test: /^AOT: formulas are off/, answer: "Turn on formulas" });
    await run(f, 1);
    await new Promise((r) => setImmediate(r));
    vscode.window._answers.pop();
    await new Promise((r) => setTimeout(r, 20));
    console.log(configStore["python.enabled"] === true
      ? "PASS (python: one click turns formulas on)"
      : "UNEXPECTED offer not taken " + JSON.stringify(configStore));
    // (turning them on warms an interpreter, which loads nothing of the repository's)
    const spawnsOn = spawns;
    console.log(requests.every((r) => ["hello", "warm"].includes(r.op))
      ? "PASS (python: the interpreter warmed as formulas turn on runs nothing the file carries)"
      : "UNEXPECTED warm-up " + JSON.stringify(requests.map((r) => r.op)));

    // on, but the workspace untrusted
    vscode.workspace.isTrusted = false;
    const untrusted = await run(f, 1);
    console.log(untrusted && untrusted.blocked === "untrusted" && spawns === spawnsOn && ran() === 0
      ? "PASS (python: an untrusted workspace runs nothing and starts nothing)"
      : "UNEXPECTED run while untrusted " + JSON.stringify({ untrusted, spawns }));
    vscode.workspace.isTrusted = true;

    // the file's own Python arrived on disk, not written in this editor: nothing
    // stops for it, and it waits for a word, asked once
    vscode.window._warningAnswer = undefined;
    const codeAsked = vscode.window._warnings.length;
    const pausedFirst = await ext._test.runPython(f.doc, { mode: "auto" });
    const askedModal = vscode.window._warningModal;
    await ext._test.runPython(f.doc, { mode: "auto" });
    console.log(pausedFirst.blocked === "consent" && spawns === spawnsOn && ran() === 0 && vscode.window._warnings.length === codeAsked + 1 && !askedModal
      && /^AOT: 8 formulas in Ledger\.aot came from outside this editor — line 2: =math\.factorial\(10\); line 3: =frame\(\)/.test(vscode.window._warnings[codeAsked] || "")
      && JSON.stringify(vscode.window._warningItems) === JSON.stringify(["Enable", "Show Them"])
      ? "PASS (python: formulas from outside wait for a word, asked once and in no one's way, and nothing starts)"
      : "UNEXPECTED .aot consent " + JSON.stringify({ pausedFirst, spawns, askedModal, warnings: vscode.window._warnings.slice(codeAsked), items: vscode.window._warningItems }));
    // F9 asks again, and no answer is a no
    const askedAtKey = vscode.window._warnings.length;
    const refusedCode = await run(f, 1);
    console.log(refusedCode.blocked === "refused" && spawns === spawnsOn && ran() === 0 && vscode.window._warnings.length === askedAtKey + 1
      ? "PASS (python: F9 asks about formulas from outside; no answer, nothing runs)"
      : "UNEXPECTED F9 consent " + JSON.stringify({ refusedCode, spawns }));
    vscode.window._warningAnswer = "Enable";

    // F9: every formula, what each reads first
    const first = await run(f, 1);
    console.log(first.ran === 6 && f.lines()[1] === "    n: 3,628,800 =math.factorial(10)"
      && f.lines().includes("    vat: 725,760 =@n*@tax rate")
      ? "PASS (python: F9 writes each value in front of its formula, what it reads first)"
      : "UNEXPECTED first F9 " + JSON.stringify({ first, lines: f.lines() }));
    // what the process is held to goes in with its first request, and the
    // editor's own secrets never reach it
    const helloSent = requests.find((r) => r.op === "hello");
    const env = (lastSpawn && lastSpawn.opts && lastSpawn.opts.env) || {};
    console.log(helloSent && JSON.stringify(helloSent.guards) === JSON.stringify({ memoryMb: 4096, subprocess: false, network: true, credentials: true })
      && !("AOT_TEST_API_TOKEN" in env) && !("VSCODE_TEST_HANDLE" in env) && Object.keys(env).some((k) => /^path$/i.test(k))
      ? "PASS (python: the guards go in with hello — 4 GB, no other programs, credentials protected — and no secret in the environment reaches Python)"
      : "UNEXPECTED guards " + JSON.stringify({ guards: helloSent && helloSent.guards, leaked: Object.keys(env).filter((k) => /AOT_TEST|VSCODE_TEST/.test(k)) }));

    const all = first;    const L = f.lines();
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
      ? "PASS (python: a failure keeps its old value, and what reads it never runs)"
      : "UNEXPECTED failure handling " + JSON.stringify(L));
    const findings = pyFindings(f.doc);
    const badLine = L.indexOf("    bad: =boom()");
    const failedD = findings.find((d) => d.range.a[0] === badLine);
    const skippedD = findings.find((d) => d.range.a[0] === badLine + 1);
    console.log(all.failed === 2 && failedD && failedD.severity === vscode.DiagnosticSeverity.Error && failedD.message === "fix this formula — 'boom' isn't a known name"
      && skippedD && skippedD.severity === vscode.DiagnosticSeverity.Warning && skippedD.message === "fix what it reads — it did not calculate: @Report@bad failed"
      ? "PASS (python: the failure is an error on its own line, in plain words; what reads it says why it did not calculate)"
      : "UNEXPECTED failure findings " + JSON.stringify(findings.map((d) => [d.range.a[0], d.severity, d.message])));    console.log(lint(f.text(), "Ledger").errors.length === 0
      ? "PASS (python: the file Python wrote still verifies — V is unchanged)"
      : "UNEXPECTED errors after the run " + JSON.stringify(lint(f.text(), "Ledger").errors.map((e) => e.message)));

    // what calculated says nothing at the end of its line, as a spreadsheet's cell
    // says nothing; what did not says why, and the details are in the hover
    const hintsNow = () => inlayProvider.provideInlayHints(f.doc, new vscode.Range(0, 0, 40, 0)).map((h) => h.label);
    const hints = hintsNow();
    console.log(hints.length === 2 && /^✗ 'boom' isn't a known name · \d\d:\d\d$/.test(hints[0]) && /^– did not calculate · \d\d:\d\d$/.test(hints[1])
      ? "PASS (python: only what did not calculate says anything at the end of its line)"
      : "UNEXPECTED python inlays " + JSON.stringify(hints));
    const valueHover = () => {
      const hv = hoverProvider.provideHover(f.doc, new vscode.Position(1, 8));
      return hv && hv.contents ? [].concat(hv.contents).map((c) => c.value || String(c)).join(" ") : "";
    };
    console.log(/\*\*Calculated\*\* — `=math\.factorial\(10\)`/.test(valueHover()) && /Calculated \d{4}-\d\d-\d\d \d\d:\d\d:\d\d in 3 ms · python 3\.13\.0/.test(valueHover())
      ? "PASS (python: the hover on a value says when it calculated, how long it took, and with what)"
      : "UNEXPECTED value hover " + JSON.stringify(valueHover()));    const { ranAt } = ext._test;
    const now = new Date(2026, 8, 24, 16, 30);
    console.log(ranAt(new Date(2026, 8, 24, 9, 5), now) === "09:05" && ranAt(new Date(2026, 8, 23, 16, 4), now) === "2026-09-23 16:04"
      && ranAt(undefined, now) === "" && ranAt("not a date", now) === ""
      ? "PASS (python: a run today shows its time, an older one its date as the file writes one)"
      : "UNEXPECTED ranAt " + JSON.stringify([ranAt(new Date(2026, 8, 24, 9, 5), now), ranAt(new Date(2026, 8, 23, 16, 4), now)]));

    // what an inlay says, state by state — one formula, then a row of them
    {
      const { pyRunNote, combinedRunNote } = ext._test;
      const hash = require("../src/python").sourceHash;
      const h = { source: "f()" };
      const rec = { source: hash("f()"), at: new Date().toISOString(), ms: 3 };
      const running = pyRunNote(h, { state: "running", source: hash("f()") }, rec);
      const failed = pyRunNote(h, { state: "error", source: hash("f()"), message: "'f' isn't a known name", raw: "NameError: f", traceback: "Traceback: f" }, rec);
      const skipped = pyRunNote(h, { state: "skipped", source: hash("f()"), message: "not run — @x failed" }, rec);
      const well = pyRunNote(h, { state: "ok", source: hash("f()"), ms: 3 }, rec);
      const editedNote = pyRunNote({ source: "g()" }, undefined, rec);
      console.log(running.label === null && failed.label === "✗ 'f' isn't a known name"
        && /^NameError: f\nTraceback: f\nlast calculated [^\n]+$/.test(failed.tooltip)
        && skipped.label === "– did not calculate" && /^not run — @x failed\nlast calculated [^\n]+$/.test(skipped.tooltip)
        && well.label === null && /^calculated [^\n]+ · 3 ms$/.test(well.tooltip)
        && editedNote.label === null && /^last calculated [^\n]+, before this edit$/.test(editedNote.tooltip)
        ? "PASS (python inlay: only a failure and what it held up have a label, in plain words with the traceback behind them)"
        : "UNEXPECTED run notes " + JSON.stringify([running, failed, skipped, well, editedNote]));
      const at = new Date();
      const cell = (c, n) => Object.assign({ cell: c, label: null, tooltip: "" }, n);
      const long = "ValueError: " + "x".repeat(80);
      const row = (...notes) => combinedRunNote(notes);
      const busy = row(cell("a", { state: "ok" }), cell("b", { state: "running" }));
      const broke = row(cell("a", { state: "error", message: long, at }));
      const notRun = row(cell("a", { state: "ok" }), cell("b", { state: "skipped", at, label: "– did not calculate", tooltip: "not run — @x failed" }));
      const plain = row(cell("a", { state: "ok" }), cell("b", { state: "ok" }));
      console.log(busy.label === null && busy.tooltip === "a: ok\nb: running"
        && broke.label.startsWith("✗ a: ValueError: xxx") && broke.label.includes("…") && broke.label.length < 75
        && notRun.label === `– b did not calculate · ${ranAt(at)}` && /^b: – did not calculate\n {4}not run — @x failed$/m.test(notRun.tooltip)
        && plain.label === null
        ? "PASS (python inlay: a row's one inlay leads with its worst news, and with none it is not there)"
        : "UNEXPECTED row notes " + JSON.stringify([busy, broke, notRun, plain].map((x) => x.label)));
    }

    // nothing to do: a pass with nothing out of date sends nothing, and what failed
    // is not tried again, nor what reads it, until something about it changes
    const evalCount = () => requests.filter((r) => r.op === "eval").length;
    const evalsBefore = evalCount();
    const calm = await ext._test.runPython(f.doc, { mode: "auto" });
    console.log(calm.ran === 0 && evalCount() === evalsBefore
      ? "PASS (python: a pass runs only what is out of date, and what failed waits until it changes)"
      : "UNEXPECTED second pass " + JSON.stringify({ calm, sent: requests.filter((r) => r.op === "eval").slice(evalsBefore).map((r) => r.code) }));
    // F9 tries again what failed, and whatever reads nothing in the file
    await run(f, 0);
    const rerun = requests.filter((r) => r.op === "eval").slice(evalsBefore).map((r) => r.code);
    console.log(rerun.includes("boom()") && rerun.includes("math.factorial(10)") && rerun.includes("_aot_ref(0)*_aot_ref(1)") && !rerun.some((c) => /real/.test(c))
      ? "PASS (python: F9 tries again what failed, and what reads nothing in the file; what reads a failure still never runs)"
      : "UNEXPECTED rerun " + JSON.stringify(rerun));

    // the file closed, the session and everything it knew gone: when each last
    // calculated is kept with the run records, and so is what failed
    vscode.workspace._close(f.doc);
    const afterClose = valueHover();
    vscode.workspace._open(f.doc);
    const stillSaid = pyFindings(f.doc).map((d) => d.message);
    console.log(/Last calculated \d{4}-\d\d-\d\d \d\d:\d\d:\d\d in 3 ms\./.test(afterClose)
      && stillSaid.includes("fix this formula — 'boom' isn't a known name")
      && stillSaid.includes("fix what it reads — it did not calculate: @Report@bad failed")
      ? "PASS (python: when a formula last calculated, and what failed, outlast the session)"
      : "UNEXPECTED after close " + JSON.stringify({ afterClose, stillSaid }));

    // an edit fades the old value and, in automatic calculation, says nothing else:
    // it is about to be calculated. Where only a key will calculate it, it says so
    f.set(f.text().replace("    n: 3,628,800 =math.factorial(10)", "    n: 3,628,800 =math.factorial(10) + 0"));
    const painted = new Map();
    f.editor.setDecorations = (type, ranges) => painted.set(type, ranges);
    vscode.window.visibleTextEditors = [f.editor];
    vscode.workspace._open(f.doc);
    vscode.window.visibleTextEditors = [];
    f.editor.setDecorations = () => {};
    const faded = [...painted.values()].flat().filter((d) => d && /^An older result: this formula was edited since it last calculated\.$/.test(d.hoverMessage || ""));
    const plainEdit = pyFindings(f.doc).find((d) => d.range.a[0] === 1);
    configStore.calculation = "manual";
    vscode.workspace._open(f.doc);
    const manualEdit = pyFindings(f.doc).find((d) => d.range.a[0] === 1);
    delete configStore.calculation;
    console.log(faded.some((d) => d.range.a[0] === 1) && !plainEdit
      && manualEdit && manualEdit.message === "press F9 to calculate it — edited since it last calculated" && manualEdit.severity === vscode.DiagnosticSeverity.Information
      ? "PASS (python: an edited formula's old value fades; only in manual calculation does it also say to press F9)"
      : "UNEXPECTED edited note " + JSON.stringify({ faded: faded.length, plainEdit: plainEdit && plainEdit.message, manualEdit: manualEdit && manualEdit.message }));
    f.set(f.text().replace(" =math.factorial(10) + 0", " =math.factorial(10)"));
    // the sidecar: asked before it first runs, and again once it changes
    const side = path.join(root, "aot.files", "Ledger.py");
    fs.writeFileSync(side, "def helper():\n    return 1\n");
    vscode.window._warningAnswer = undefined;
    const warned = vscode.window._warnings.length;
    const evals = requests.filter((r) => r.op === "eval").length;
    const refused = await run(f, 1);
    console.log(refused.blocked === "refused" && vscode.window._warnings.length === warned + 1
      && /^AOT: a formula reaches aot\.files\/Ledger\.py, which has not been run here before/.test(vscode.window._warnings[warned])
      && JSON.stringify(vscode.window._warningItems) === JSON.stringify(["Enable", "Open File"])
      && requests.filter((r) => r.op === "eval").length === evals
      ? "PASS (python: the sidecar is asked about before it first runs; no answer is a no, and nothing runs)"
      : "UNEXPECTED sidecar consent " + JSON.stringify({ refused, warnings: vscode.window._warnings.slice(warned) }));
    vscode.window._warningAnswer = "Enable";
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
      && JSON.stringify(vscode.window._warningItems) === JSON.stringify(["Enable", "Show Changes"])
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
    vscode.window._warningAnswer = "Enable";
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
      && /^AOT: 2 formulas in Books\.aot came from outside this editor/.test(vscode.window._warnings[reached] || "")
      && /^AOT: a formula reaches tools\/finance\.py, which has not been run here before/.test(vscode.window._warnings[reached + 1] || "")
      && approveSent.length === 1 && Object.keys(approveSent[0].files)[0] === finance
      ? "PASS (python: a module anywhere in the repository runs once allowed, asked about by its own path)"
      : "UNEXPECTED repository module " + JSON.stringify({ lines: g.lines(), warnings: vscode.window._warnings.slice(reached), approveSent }));

    // changed on disk, outside the editor: what names it is out of date, nothing else is
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(finance, "def revenue(units):\n    return units * 30\n");
    if (vscode.workspace._pyChanged) vscode.workspace._pyChanged({ fsPath: finance });
    configStore.calculation = "manual";
    vscode.workspace._open(g.doc);
    const gNotes = pyFindings(g.doc);
    delete configStore.calculation;
    console.log(gNotes.some((d) => d.range.a[0] === 1 && /^press F9 to calculate it — something it reads changed since it last calculated$/.test(d.message)) && !gNotes.some((d) => d.range.a[0] === 2)
      ? "PASS (python: a module changing puts out of date the formulas that name it, and no other)"
      : "UNEXPECTED staleness after a module change " + JSON.stringify(gNotes.map((d) => [d.range.a[0], d.message])));
    const askedAgain = vscode.window._warnings.length;
    await run(g, 1);
    console.log(/^AOT: a formula reaches tools\/finance\.py, which has changed since you last allowed it, and not in this editor/.test(vscode.window._warnings[askedAgain] || "")
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
      && !gHints.some((label) => /^✗/.test(label))
      ? "PASS (python: a module saved in this editor runs without being asked about)"
      : "UNEXPECTED own edit asked about " + JSON.stringify(vscode.window._warnings.slice(beforeOwn)));
    vscode.window._warningAnswer = "Enable";

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

    // a save, a CSV arriving and a store arriving calculate only what is out of
    // date, and here nothing is
    const quiet = ran();
    await vscode.workspace._willSave({ document: f.doc, waitUntil: (p) => p });
    vscode.workspace._save(f.doc);
    if (vscode.workspace._csvChanged) await vscode.workspace._csvChanged({ fsPath: path.join(root, "aot.files", "Sales.csv") });
    if (vscode.workspace._parkChanged) vscode.workspace._parkChanged({ fsPath: path.join(root, "aot.files", "Ledger.formulas") });
    await new Promise((r) => setTimeout(r, 120));
    console.log(ran() === quiet
      ? "PASS (python: a save, a CSV arriving and a store arriving run nothing when nothing is out of date)"
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
      '    status =("draft", "sent")',
      "    grade =@level*2",
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
      && cf().some((d) => d.range.a[0] === 10 && d.severity === W && /^change the value, or the bound — '15' breaks 'age >=18': it is not >= 18$/.test(d.message))
      && cf().some((d) => d.range.a[0] === 6 && d.severity === W && /^change the value, or the bound — 'void' breaks 'status =\("draft", "sent"\)': it is not one of 'draft', 'sent'$/.test(d.message))
      // and the `grade: 5` somebody typed, replaced, says so
      && cf().some((d) => d.range.a[0] === 13 && d.severity === W && /^find out where '5' came from — its formula gives 2,408/.test(d.message))
      && cf().filter((d) => d.severity === W).length === 3
      ? "PASS (constraints: F9 checks every bound, warns a breach on its value, and fills what a '==' defines)"
      : "UNEXPECTED constraint run " + JSON.stringify({ checkedRun, lines: c.lines(), findings: cf().map((d) => [d.range.a, d.message]) }));
    // the master check: one count of everything wrong with the file in front of you
    {
      const was = vscode.window.activeTextEditor;
      vscode.window.activeTextEditor = c.editor;
      const st = ext._test.checkStatusOf(c.doc);
      console.log(st.shown && /^\$\(error\) 3 problems$/.test(st.text) && /Violations \(V\): 0/.test(st.tooltip) && /values to look at: 3/.test(st.tooltip)
        ? "PASS (status: two broken rules and a replaced value are 3 problems, though V is 0)"
        : "UNEXPECTED status " + JSON.stringify(st));
      configStore["python.enabled"] = false;
      const off = ext._test.checkStatusOf(c.doc);
      console.log(/formulas not calculated/.test(off.text) && /say nothing about those numbers/.test(off.tooltip)
        ? "PASS (status: with formulas off it says they were not calculated, so it can't look clean)"
        : "UNEXPECTED status with formulas off " + JSON.stringify(off));
      configStore["python.enabled"] = true;
      const plainDoc = live(path.join(root, "Quiet.aot"), ["Quiet", "    a: 1"]);
      vscode.window.activeTextEditor = plainDoc.editor;
      const quiet = ext._test.checkStatusOf(plainDoc.doc);
      console.log(/^\$\(check\) 0 problems$/.test(quiet.text)
        ? "PASS (status: a file with nothing wrong and nothing to calculate says 0 problems)"
        : "UNEXPECTED quiet status " + JSON.stringify(quiet));
      vscode.window.activeTextEditor = was;
      ext._test.checkStatusOf(c.doc);
    }
    // a replaced value's warning goes when its cell is edited
    c.set(c.text().replace("        grade: 2,408", "        grade: 2,409"));
    vscode.workspace._open(c.doc);
    console.log(!cf().some((d) => /find out where/.test(d.message))
      ? "PASS (constraints: a replaced value's warning goes when the cell is edited)"
      : "UNEXPECTED replaced warning " + JSON.stringify(cf().map((d) => d.message)));
    c.set(c.text().replace("        grade: 2,409", "        grade: 2,408"));
    c.set(c.text().replace("        age: 15", "        age: 21"));
    vscode.workspace._open(c.doc);
    console.log(!cf().some((d) => d.range.a[0] === 10) && cf().some((d) => d.range.a[0] === 6)
      ? "PASS (constraints: an edit to a flagged value retires its warning until the next run)"
      : "UNEXPECTED stale constraint finding " + JSON.stringify(cf().map((d) => [d.range.a, d.message])));
    c.set(c.text().replace("    age >=18", "    age >=nobody"));
    await run(c, 0);
    console.log(cf().some((d) => d.range.a[0] === 1 && d.severity === vscode.DiagnosticSeverity.Error && /^fix the bound 'age >=nobody' — it failed: 'nobody' isn't a known name$/.test(d.message))
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
      vscode.window._warningAnswer = "Enable";
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
      const pullQuestion = vscode.window._warnings.slice(n0).find((w) => /^AOT: 1 formula in Keys\.aot came from outside this editor/.test(w)) || "";
      console.log(refusedPull.blocked === "refused" && /line 3: =__import__\('os'\)\.getpid\(\)/.test(pullQuestion)
        ? "PASS (python: a derivation a pull changed is asked about, naming the line and the code, and does not run unanswered)"
        : "UNEXPECTED pulled code " + JSON.stringify({ refusedPull, pullQuestion }));

      // parked, the store changed on disk, and brought home: asked about too
      vscode.window._warningAnswer = "Enable";
      await registeredCommands.get("aot.toggleFormulaPark")(k.editor);
      const kStore = path.join(root, "aot.files", "Keys.formulas");
      fs.writeFileSync(kStore, fs.readFileSync(kStore, "utf8").replace("=math.factorial(3)", "=__import__('os').getcwd()"));
      await registeredCommands.get("aot.toggleFormulaPark")(k.editor);
      vscode.window._warningAnswer = undefined;
      const n1 = vscode.window._warnings.length;
      const refusedStore = await run(k, 1);
      const storeQuestion = vscode.window._warnings.slice(n1).find((w) => /^AOT: \d+ formulas? in Keys\.aot came from outside this editor/.test(w)) || "";
      console.log(k.lines()[1] === "    a: =__import__('os').getcwd()" && refusedStore.blocked === "refused" && /getcwd/.test(storeQuestion)
        ? "PASS (python: a derivation brought home from a store that changed on disk is asked about before it runs)"
        : "UNEXPECTED store code " + JSON.stringify({ lines: k.lines(), refusedStore, storeQuestion }));
      vscode.window._warningAnswer = "Enable";
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

      vscode.window._warningAnswer = "Enable";
      await run(c, 0);
      const opened = requests.filter((r) => r.op === "open").pop();
      console.log(lastSpawn && lastSpawn.cmd === venvExe && lastSpawn.args[0] === "-I" && !lastSpawn.args.includes("-E")
        && opened && /^add it to aot\.files\/pyproject\.toml, then run AOT: Set Up Python Environment$/.test(opened.install)
        ? "PASS (uv: the derivations run in the environment's own interpreter, isolated, and a missing library says how to add it)"
        : "UNEXPECTED uv run " + JSON.stringify({ lastSpawn, install: opened && opened.install }));
      vscode.window._infoDetail = "";
      vscode.window.activeTextEditor = c.editor;
      await plainCommands.get("aot.showPythonEnvironment")();
      const envFolder = path.basename(require("../src/uvenv").venvDir(afDir, process.platform));
      console.log((vscode.window._infoDetail || "").includes(`uv environment: aot.files/${envFolder}`)
        ? "PASS (uv: Show Python Environment names this system's own environment folder)"
        : "UNEXPECTED environment report " + JSON.stringify(vscode.window._infoDetail));

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
      vscode.window._warningAnswer = "Enable";
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

    // two formulas side by side in one table row: each cell is its own, the row says
    // nothing while they calculate well, and hover answers for the cell it is over
    {
      const t = live(path.join(root, "Pair.aot"), [
        "Invoice|price|vat        |net",
        "A      |100  |=@price*0.2|=@price-1",
        "B      |50   |=@price*0.2|=@price-1",
      ]);
      vscode.workspace.textDocuments = [f.doc, t.doc];
      vscode.workspace._open(t.doc);
      await registeredCommands.get("aot.recomputeFormulas")(t.editor);
      const rowA = t.lines()[1];
      const rowB = t.lines()[2];
      console.log(/\|20 =@price\*0\.2 *\|99 =@price-1$/.test(rowA) && /\|10 =@price\*0\.2 *\|49 =@price-1$/.test(rowB)
        ? "PASS (python in a table: each formula of a row writes into its own cell)"
        : "UNEXPECTED row run " + JSON.stringify({ rowA, rowB }));

      const rowHints = inlayProvider.provideInlayHints(t.doc, new vscode.Range(0, 0, 5, 0)).filter((h) => h.position.line === 2);
      console.log(rowHints.length === 0
        ? "PASS (python in a table: a row that calculated says nothing at its end)"
        : "UNEXPECTED row inlays " + JSON.stringify(rowHints.map((h) => [h.label, h.tooltip])));

      const hoverAt = (col) => {
        const hv = hoverProvider.provideHover(t.doc, new vscode.Position(2, col));
        return hv && hv.contents ? [].concat(hv.contents).map((c) => c.value || String(c)).join(" ") : "";
      };
      const netValue = t.lines()[2].indexOf("49");
      const vatValue = t.lines()[2].indexOf("10 =");
      console.log(/=@price-1/.test(hoverAt(netValue)) && /=@price\*0\.2/.test(hoverAt(vatValue))
        ? "PASS (python in a table: hover on a value names the derivation of that cell)"
        : "UNEXPECTED cell hover " + JSON.stringify({ net: hoverAt(netValue), vat: hoverAt(vatValue) }));

      // the ergonomic answer: a column every row derives alike is defined
      // once, on its header, and the cells read as plain values
      const vatAt = t.lines()[2].indexOf("=@price*0.2") + 2;
      const offered = codeActionsProvider.provideCodeActions(t.doc, new vscode.Range(2, vatAt, 2, vatAt), { diagnostics: [] })
        .find((a) => a.command && a.command.command === "aot.table.defineColumn");
      t.editor.selection = new vscode.Selection(2, vatAt, 2, vatAt);
      await registeredCommands.get("aot.table.defineColumn")(t.editor);
      const netAt = t.lines()[2].indexOf("=@price-1") + 2;
      t.editor.selection = new vscode.Selection(2, netAt, 2, netAt);
      await registeredCommands.get("aot.table.defineColumn")(t.editor);
      const defined = t.lines().slice(0, 3);
      await registeredCommands.get("aot.recomputeFormulas")(t.editor);
      const computed = t.lines().slice(0, 3);
      const expected = ["Invoice|price|vat =@price*0.2|net =@price-1", "A      |100  |20             |99", "B      |50   |10             |49"].join("\n");
      console.log(offered && /Define 'vat' for the whole column \(vat =@price\*0\.2\)/.test(offered.title)
        && defined.join("\n") === expected && computed.join("\n") === expected
        ? "PASS (python in a table: a column every row derives alike moves to its header as =, and each pass fills its cells)"
        : "UNEXPECTED define column " + JSON.stringify({ offered: offered && offered.title, defined, computed }));
      vscode.workspace._close(t.doc);
      vscode.workspace.textDocuments = [f.doc];
    }
    // a bare `=` line writes Concepts: its tables by name, under it at its
    // own indent; what reads one of them gets the live table; the park key
    // takes the line out and puts it back above the first Concept it wrote
    {
      const g = live(path.join(root, "Gen.aot"), [
        "=load_all()",
        "",
        "Summary",
        "    count: =len(@Sales)",
        "=two()",
        "Gen Own =own()",
        "=({})",
      ]);
      vscode.workspace.textDocuments = [f.doc, g.doc];
      vscode.workspace._open(g.doc);
      await registeredCommands.get("aot.recomputeFormulas")(g.editor);
      const wrote = g.lines();
      console.log(wrote.slice(0, 7).join("\n") === ["=load_all()", "Sales|month  |amount", "1    |2026-01|15,000", "", "Region|code", "1     |EU", ""].join("\n")
        && lint(g.text(), "Gen").errors.length === 0
        ? "PASS (python: a bare = line writes each table it returns as a Concept, under it, and the file verifies)"
        : "UNEXPECTED bare = line " + JSON.stringify(wrote));
      const countLine = () => g.lines().find((l) => /count:/.test(l));
      console.log(countLine() === "    count: 1 =len(@Sales)"
        ? "PASS (python: what reads a Concept a bare = line writes is right the first time: it gets that table, live, by its name)"
        : "UNEXPECTED read of a written Concept " + JSON.stringify({ line: countLine(), findings: pyFindings(g.doc).map((d) => d.message) }));

      // the second bare line returns a Concept that has a formula of its own — left
      // to it, which is no failure: the line ran and wrote the rest, and a warning
      // says one Concept is returned from two places — and the third returns nothing
      const G = g.lines();
      const twoAt = G.indexOf("=two()");
      const twoHint = inlayProvider.provideInlayHints(g.doc, new vscode.Range(0, 0, 40, 0)).find((h) => h.position.line === twoAt);
      const twoFindings = pyFindings(g.doc).filter((d) => d.range.start.line === twoAt);
      console.log(G[twoAt + 1] === "Gen Extra|y" && G.includes("Gen Own =own()|x") && G.some((l) => /^1 +\|its own$/.test(l))
        && !G.some((l) => /from the bare line/.test(l))
        && twoHint && twoHint.label === "ⓘ 'Gen Own' left to its own formula"
        && /left alone: Gen Own — its own formula writes its rows/.test(twoHint.tooltip)
        && twoFindings.length === 1 && twoFindings[0].severity === vscode.DiagnosticSeverity.Warning
        && twoFindings[0].message === "return it from one place only — this line returns 'Gen Own', which has a formula of its own: that one writes its rows, and this line leaves it alone"
        && !pyFindings(g.doc).some((d) => /^fix this formula/.test(d.message))
        ? "PASS (python: a Concept with its own formula is left to it — the bare line writes the rest, succeeds, and warns that two places return it)"
        : "UNEXPECTED bare = conflict " + JSON.stringify({ G, hint: twoHint && [twoHint.label, twoHint.tooltip], findings: pyFindings(g.doc).map((d) => [d.severity, d.message]) }));
      console.log(ext._test.leftAloneMessage(["Fleet", "Depot", "Yard"])
        === "return each from one place only — this line returns 'Fleet', 'Depot' and 'Yard', which have formulas of their own: those write their rows, and this line leaves them alone"
        ? "PASS (python: several Concepts left to their own formulas are named in one warning)"
        : "UNEXPECTED left-alone wording " + JSON.stringify(ext._test.leftAloneMessage(["Fleet", "Depot", "Yard"])));
      // the tables a bare line wrote are tinted as Python's, with a hover naming the line
      const captured = new Map();
      const visible = vscode.window.visibleTextEditors;
      g.editor.setDecorations = (type, ranges) => captured.set(type, ranges);
      vscode.window.visibleTextEditors = [g.editor];
      vscode.workspace._open(g.doc);
      vscode.window.visibleTextEditors = visible;
      g.editor.setDecorations = () => {};
      const tinted = [...captured.values()].flat().filter((d) => d.hoverMessage && /=load_all\(\)`, the line on 1/.test(d.hoverMessage.value || ""));
      console.log(tinted.length === 2 && tinted.every((d) => g.lines()[d.range.a[0]] && !/^Sales\|/.test(g.lines()[d.range.a[0]]))
        ? "PASS (python: every row a bare line wrote is tinted, and its hover names the line)"
        : "UNEXPECTED bare = marks " + JSON.stringify(tinted.map((d) => d.range.a)));

      const beforePark = g.text();
      const warned = vscode.window._warnings.length;
      await registeredCommands.get("aot.toggleFormulaPark")(g.editor);
      const parkedText = g.text();
      const store = fs.readFileSync(path.join(root, "aot.files", "Gen.formulas"), "utf8");
      const stayedSaid = vscode.window._warnings.slice(warned).find((w) => /bare '=' line on line \d+ has no Concept beneath to come home above, so it stays/.test(w));
      await registeredCommands.get("aot.toggleFormulaPark")(g.editor);
      console.log(!/=load_all\(\)/.test(parkedText) && /^Sales\|month/.test(parkedText) && /@=Sales@Region: =load_all\(\)/.test(store)
        && /@=Gen Extra: =two\(\)/.test(store) && /^=\(\{\}\)$/m.test(parkedText) && stayedSaid
        && g.text() === beforePark
        ? "PASS (python: the park key takes each bare = line out whole and puts it back where it stood; one with nothing beneath it stays, and is said to)"
        : "UNEXPECTED bare = park " + JSON.stringify({ parkedText, store, back: g.text(), stayedSaid }));
      vscode.workspace._close(g.doc);
      vscode.workspace.textDocuments = [f.doc];
    }

    // a row whose second cell fails: its one inlay names the failing cell,
    // and the tooltip gives each cell its line
    {
      const e = live(path.join(root, "Err.aot"), ["Box|a   |b", "X  |=1+1|=boom()"]);
      vscode.workspace.textDocuments = [f.doc, e.doc];
      vscode.workspace._open(e.doc);
      await registeredCommands.get("aot.recomputeFormulas")(e.editor);
      const hint = inlayProvider.provideInlayHints(e.doc, new vscode.Range(0, 0, 5, 0)).find((h) => h.position.line === 1);
      console.log(hint && /^✗ b: 'boom' isn't a known name · \d\d:\d\d$/.test(hint.label)
        && /^a: ok/m.test(hint.tooltip) && /^b: ✗ 'boom'/m.test(hint.tooltip)
        ? "PASS (python in a table: a row's one inlay names the cell that failed, and lists every cell)"
        : "UNEXPECTED row failure inlay " + JSON.stringify(hint && [hint.label, hint.tooltip]));      vscode.workspace._close(e.doc);
      vscode.workspace.textDocuments = [f.doc];
    }

    // a bare line run again without a Concept it wrote before: the Concept
    // stays in the file, and the inlay says it is no longer written
    {
      const s = live(path.join(root, "Shrink.aot"), ["=shrink()"]);
      vscode.workspace.textDocuments = [f.doc, s.doc];
      vscode.workspace._open(s.doc);
      await run(s, 0);
      await run(s, 0);
      const hint = inlayProvider.provideInlayHints(s.doc, new vscode.Range(0, 0, 20, 0)).find((h) => h.position.line === 0);
      console.log(hint && hint.label === "ⓘ 'Old Stock' no longer written"
        && /no longer written: Old Stock — still in the file; delete it if gone/.test(hint.tooltip) && /printed:\nshrinking/.test(hint.tooltip)        && s.lines().includes("Old Stock|n") && s.lines().some((l) => /^1 +\|6$/.test(l))
        ? "PASS (python: a Concept a bare line no longer returns stays in the file, and the inlay says so)"
        : "UNEXPECTED dropped Concept " + JSON.stringify({ hint: hint && [hint.label, hint.tooltip], lines: s.lines() }));
      vscode.workspace._close(s.doc);
      vscode.workspace.textDocuments = [f.doc];
    }

    // two bare lines with nothing beneath either: both stay, said once
    {
      const n = live(path.join(root, "Nowhere.aot"), ["=({})", "", "=({})"]);
      vscode.workspace.textDocuments = [f.doc, n.doc];
      vscode.workspace._open(n.doc);
      const warned = vscode.window._warnings.length;
      await registeredCommands.get("aot.toggleFormulaPark")(n.editor);
      // (the first run of a file it did not write asks first: that is a warning too)
      const said = vscode.window._warnings.slice(warned).filter((w) => /bare '=' line/.test(w));
      console.log(said.length === 1 && /bare '=' lines on lines 1, 3 have no Concept beneath to come home above, so they stay in the file — once they write their tables, they park with the rest/.test(said[0])
        && n.text() === "=({})\n\n=({})"
        ? "PASS (python: bare lines with nowhere to come home to stay, and one warning names them all)"
        : "UNEXPECTED stayed lines " + JSON.stringify({ said, text: n.text() }));
      vscode.workspace._close(n.doc);
      vscode.workspace.textDocuments = [f.doc];
    }

    // hover on a function a derivation calls: its signature, file and
    // docstring; on the line's attribute name, nothing of Python's
    {
      fs.writeFileSync(path.join(root, "aot.files", "Fn.py"), 'def double(x):\n    """Twice x."""\n    return 2 * x\n');
      const fn = live(path.join(root, "Fn.aot"), ["Fn", "    d: =double(2)"]);
      vscode.workspace.textDocuments = [f.doc, fn.doc];
      vscode.workspace._open(fn.doc);
      const onCall = hoverProvider.provideHover(fn.doc, new vscode.Position(1, 10));
      const onName = hoverProvider.provideHover(fn.doc, new vscode.Position(1, 4));
      console.log(onCall && /^`double\(x\)` — defined in `aot\.files\/Fn\.py` line 1\n\nTwice x\.$/.test(onCall.contents.value)
        && !(onName && /defined in `aot\.files|\*\*Calculated\*\*/.test(onName.contents.value || ""))
        ? "PASS (python: hover on a function a derivation calls gives its signature, file and docstring)"
        : "UNEXPECTED function hover " + JSON.stringify({ onCall: onCall && onCall.contents.value, onName: onName && onName.contents.value }));
      vscode.workspace._close(fn.doc);
      vscode.workspace.textDocuments = [f.doc];
    }

    // no uv environment: the report names what is searched for instead; and
    // an interpreter that is not there is said by name, nothing started
    {
      const l = live(path.join(root, "Lost.aot"), ["Lost", "    x: =1+1"]);
      vscode.workspace.textDocuments = [f.doc, l.doc];
      vscode.workspace._open(l.doc);
      vscode.window._infoDetail = "";
      vscode.window.activeTextEditor = l.editor;
      await plainCommands.get("aot.showPythonEnvironment")();
      const searched = require("../src/python").defaultPythons(process.platform).join(" or ");
      console.log((vscode.window._infoDetail || "").startsWith(`No uv environment — the interpreter aot.python.path names, else ${searched} on PATH`)
        ? "PASS (python: with no uv environment, the report says which interpreter is looked for)"
        : "UNEXPECTED no-uv report " + JSON.stringify(vscode.window._infoDetail));
      // aot.python.manager "python" with no path: PATH's interpreter, by name
      for (const e of ext._test.sessions.values()) e.session.kill("test");
      configStore["python.manager"] = "python";
      try { await run(l, 1); } finally { delete configStore["python.manager"]; }
      console.log(lastSpawn && lastSpawn.cmd === require("../src/python").defaultPythons(process.platform)[0]
        ? "PASS (python: the 'python' manager with no path set runs PATH's interpreter)"
        : "UNEXPECTED python manager " + JSON.stringify(lastSpawn && lastSpawn.cmd));
      for (const e of ext._test.sessions.values()) e.session.kill("test");
      ext._test.setSpawn(null);
      configStore["python.path"] = "no-such-python-anywhere";
      const errorsBefore = vscode.window._errors.length;
      try {
        await run(l, 1);
      } finally {
        delete configStore["python.path"];
        ext._test.setSpawn(fakeRuntime);
      }
      console.log(/^AOT: 'no-such-python-anywhere' was not found — install Python 3\.10 or later, or set aot\.python\.path to its executable$/.test(vscode.window._errors[errorsBefore] || "")
        && JSON.stringify(vscode.window._errorItems) === JSON.stringify(["Get Python", "Set Up with uv"])
        ? "PASS (python: an interpreter that is not there is named, nothing is started, and it offers to get one)"
        : "UNEXPECTED missing interpreter " + JSON.stringify(vscode.window._errors.slice(errorsBefore)));
      vscode.workspace._close(l.doc);
      vscode.workspace.textDocuments = [f.doc];
    }

    // the lightbulb's "move into the sidecar": the expression becomes a
    // function there, each reference a parameter
    {
      const mv = live(path.join(root, "Move.aot"), ["Move", "    n: 4", "    twice: =@n * 2"]);
      vscode.workspace.textDocuments = [f.doc, mv.doc];
      vscode.workspace._open(mv.doc);
      await plainCommands.get("aot.movePythonToSidecar")(mv.doc.uri.toString(), 2);
      const sidePath = path.join(root, "aot.files", "Move.py");
      const side = fs.existsSync(sidePath) ? fs.readFileSync(sidePath, "utf8") : "";
      console.log(/def twice\(n\):\n {4}return n \* 2\n/.test(side)
        ? "PASS (python: moving a derivation into the sidecar writes it as a function of its references)"
        : "UNEXPECTED moved derivation " + JSON.stringify(side));
      vscode.workspace._close(mv.doc);
      vscode.workspace.textDocuments = [f.doc];
    }

    // when a file calculates, as a spreadsheet does. There is no timer: you say you
    // are done by moving on
    {
      const settle = () => new Promise((r) => setTimeout(r, 120)); // a burst gathered, and the fake's answers
      const evals = () => requests.filter((r) => r.op === "eval").length;
      const x = live(path.join(root, "Excel.aot"), ["Sheet|a|b", "X    |1|=@a*2", "Y    |5|=@a*2", ""]);
      vscode.workspace.textDocuments = [f.doc, x.doc];
      vscode.window.visibleTextEditors = [x.editor];
      const activeBefore = vscode.window.activeTextEditor;
      vscode.window.activeTextEditor = x.editor;
      vscode.window._warningAnswer = "Enable";
      await registeredCommands.get("aot.recomputeFormulas")(x.editor);

      // the editor's own way of editing: the text changes, the event says so
      const edit = (line, from, to, text, reason) => {
        const lines = x.lines();
        lines[line] = lines[line].slice(0, from) + text + lines[line].slice(to);
        x.set(lines.join("\n"));
        vscode.workspace._changed({ document: x.doc, reason, contentChanges: [{ text, range: new vscode.Range(line, from, line, to) }] });
      };
      const cursor = (line, ch) => {
        x.editor.selection = new vscode.Selection(line, ch, line, ch);
        vscode.window._selectionChanged({ textEditor: x.editor, selections: [x.editor.selection] });
      };
      const cellOf = (line, k) => x.lines()[line].split("|")[k].trim();
      const aEnd = (line) => x.lines()[line].indexOf("|") + 1 + x.lines()[line].split("|")[1].trimEnd().length;
      const editOptions = [];
      const realEdit = x.editor.edit;
      x.editor.edit = (cb, opts) => { editOptions.push(opts); return realEdit(cb, opts); };

      console.log(cellOf(1, 2) === "2 =@a*2" && cellOf(2, 2) === "10 =@a*2"
        ? "PASS (calculation: F9 fills a table's formulas)"
        : "UNEXPECTED first calculation " + JSON.stringify(x.lines()));

      // typing in a cell: nothing runs, so a half-written number reaches no formula
      const before = evals();
      cursor(1, aEnd(1));
      edit(1, aEnd(1), aEnd(1), "2");
      x.editor.selection = new vscode.Selection(1, aEnd(1), 1, aEnd(1));
      await settle();
      console.log(evals() === before && cellOf(1, 2) === "2 =@a*2"
        ? "PASS (calculation: typing in a cell runs nothing)"
        : "UNEXPECTED ran while typing " + JSON.stringify({ evals: evals() - before, lines: x.lines() }));
      // moving about inside it is still typing in it
      cursor(1, aEnd(1) - 1);
      await settle();
      console.log(evals() === before
        ? "PASS (calculation: a cursor moving inside the cell runs nothing)"
        : "UNEXPECTED ran on a move inside the cell");
      // leaving it calculates: that row, not the other
      cursor(2, 0);
      await settle();
      console.log(evals() === before + 1 && cellOf(1, 1) === "12" && cellOf(1, 2) === "24 =@a*2" && cellOf(2, 2) === "10 =@a*2"
        ? "PASS (calculation: leaving the cell calculates what reads it, and nothing else)"
        : "UNEXPECTED on leaving " + JSON.stringify({ evals: evals() - before, lines: x.lines() }));
      console.log(editOptions.length && editOptions.every((o) => o && o.undoStopBefore === false && o.undoStopAfter === false)
        ? "PASS (calculation: a result joins the writer's last edit, so one Ctrl+Z takes both back)"
        : "UNEXPECTED undo stops " + JSON.stringify(editOptions));

      // anything that is not typing calculates straight away, cursor where it is
      const beforePaste = evals();
      {
        const lines = x.lines();
        lines.splice(3, 0, "Z    |7|=@a*2");
        x.set(lines.join("\n"));
        vscode.workspace._changed({ document: x.doc, contentChanges: [{ text: "Z    |7|=@a*2\n", range: new vscode.Range(3, 0, 3, 0) }] });
      }
      await settle();
      console.log(evals() === beforePaste + 1 && cellOf(3, 2) === "14 =@a*2"
        ? "PASS (calculation: a paste of lines calculates straight away)"
        : "UNEXPECTED paste " + JSON.stringify({ evals: evals() - beforePaste, lines: x.lines() }));

      // a save commits what was being typed, and what it computed goes to disk too
      let saves = 0;
      x.doc.save = async () => { saves++; return true; };
      cursor(2, aEnd(2));
      edit(2, aEnd(2), aEnd(2), "0");
      x.editor.selection = new vscode.Selection(2, aEnd(2), 2, aEnd(2));
      await settle();
      const typedBeforeSave = cellOf(2, 2);
      await vscode.workspace._willSave({ document: x.doc, waitUntil: () => {} });
      fs.writeFileSync(x.doc.fileName, x.text());
      vscode.workspace._save(x.doc);
      await settle();
      console.log(typedBeforeSave === "10 =@a*2" && cellOf(2, 1) === "50" && cellOf(2, 2) === "100 =@a*2" && saves === 1
        ? "PASS (calculation: a save commits the cell being typed in, and what it computed is saved too)"
        : "UNEXPECTED save " + JSON.stringify({ typedBeforeSave, saves, lines: x.lines() }));
      delete x.doc.save;

      // switching to another program, or another editor, is leaving too
      const beforeLeave = evals();
      cursor(1, aEnd(1));
      edit(1, aEnd(1), aEnd(1), "3");
      x.editor.selection = new vscode.Selection(1, aEnd(1), 1, aEnd(1));
      await settle();
      const stayed = evals() === beforeLeave;
      vscode.window._windowState({ focused: false });
      await settle();
      console.log(stayed && cellOf(1, 2) === "246 =@a*2" && cellOf(1, 1) === "123"
        ? "PASS (calculation: switching to another program commits the cell being typed in)"
        : "UNEXPECTED window leave " + JSON.stringify({ stayed, lines: x.lines() }));
      edit(1, aEnd(1), aEnd(1), "4");
      x.editor.selection = new vscode.Selection(1, aEnd(1), 1, aEnd(1));
      await settle();
      vscode.window.activeTextEditor = f.editor;
      vscode.window._activeChanged(f.editor);
      await settle();
      vscode.window.activeTextEditor = x.editor;
      console.log(cellOf(1, 2) === "2,468 =@a*2"
        ? "PASS (calculation: switching to another editor commits the cell being typed in)"
        : "UNEXPECTED editor leave " + JSON.stringify(x.lines()));

      // an undo calculates, and writes nothing when the answer is the same, so the
      // redo it left stays good
      const editsBeforeUndo = editOptions.length;
      {
        const lines = x.lines();
        lines[1] = lines[1].replace(/\|1234 *\|2,468 =@a\*2/, "|123 |246 =@a*2");
        x.set(lines.join("\n"));
        vscode.workspace._changed({ document: x.doc, reason: vscode.TextDocumentChangeReason.Undo, contentChanges: [{ text: "", range: new vscode.Range(1, 8, 1, 9) }] });
      }
      await settle();
      console.log(cellOf(1, 2) === "246 =@a*2" && editOptions.length === editsBeforeUndo
        ? "PASS (calculation: an undo writes nothing when a formula's answer is unchanged, so redo survives)"
        : "UNEXPECTED undo " + JSON.stringify({ edits: editOptions.length - editsBeforeUndo, lines: x.lines() }));

      // a cell with a cursor in it is left alone until the cursor leaves it
      {
        const bAt = x.lines()[2].lastIndexOf("|") + 1;
        cursor(2, bAt);
        edit(2, aEnd(2) - 1, aEnd(2), "1", vscode.TextDocumentChangeReason.Redo);
        await settle();
        const heldThere = cellOf(2, 2);
        cursor(1, 0);
        await settle();
        console.log(cellOf(2, 1) === "51" && heldThere === "100 =@a*2" && cellOf(2, 2) === "102 =@a*2"
          ? "PASS (calculation: a result waits while a cursor stands in its cell, and lands when it leaves)"
          : "UNEXPECTED held cell " + JSON.stringify({ heldThere, lines: x.lines() }));
      }

      // manual: only the key calculates
      configStore.calculation = "manual";
      const beforeManual = evals();
      cursor(1, aEnd(1));
      edit(1, aEnd(1), aEnd(1), "5");
      x.editor.selection = new vscode.Selection(1, aEnd(1), 1, aEnd(1));
      cursor(2, 0);
      await settle();
      vscode.workspace._save(x.doc);
      await settle();
      const manualQuiet = evals() === beforeManual;
      await registeredCommands.get("aot.recomputeFormulas")(x.editor);
      console.log(manualQuiet && cellOf(1, 2) === "2,470 =@a*2"
        ? "PASS (calculation: with aot.calculation manual, only F9 calculates)"
        : "UNEXPECTED manual " + JSON.stringify({ manualQuiet, lines: x.lines() }));
      delete configStore.calculation;

      // Ctrl+Alt+F9: a new session, then every formula
      const resets = () => requests.filter((r) => r.op === "reset").length;
      const beforeFresh = evals();
      const resetsBefore = resets();
      await registeredCommands.get("aot.runPythonFresh")(x.editor);
      console.log(resets() === resetsBefore + 1 && evals() === beforeFresh + 3
        ? "PASS (calculation: Ctrl+Alt+F9 clears the session and runs every formula)"
        : "UNEXPECTED fresh " + JSON.stringify({ resets: resets() - resetsBefore, evals: evals() - beforeFresh }));

      // a file coming on screen: nothing out of date, nothing starts
      vscode.workspace._close(x.doc);
      const spawnsAtOpen = spawns;
      vscode.window._visibleChanged([x.editor]);
      await settle();
      console.log(spawns === spawnsAtOpen
        ? "PASS (calculation: a file opening with nothing out of date starts nothing)"
        : "UNEXPECTED start on open " + JSON.stringify({ spawned: spawns - spawnsAtOpen }));
      // and with something out of date, that runs, once
      vscode.workspace._close(x.doc);
      {
        const lines = x.lines();
        lines[3] = lines[3].replace(/\|7( *)\|/, "|8$1|");
        x.set(lines.join("\n"));
      }
      const evalsAtOpen = evals();
      vscode.window._visibleChanged([x.editor]);
      vscode.window._visibleChanged([x.editor]);
      await settle();
      console.log(spawns === spawnsAtOpen + 1 && evals() === evalsAtOpen + 1 && cellOf(3, 2) === "16 =@a*2"
        ? "PASS (calculation: a file opening runs only what is out of date, once)"
        : "UNEXPECTED open " + JSON.stringify({ evals: evals() - evalsAtOpen, lines: x.lines() }));
      vscode.workspace._close(x.doc);

      // a long file goes a batch at a time, and a new edit is noticed between them
      {
        const rows = Array.from({ length: 70 }, (_, k) => `R${k}|1|=@a*2`);
        const big = live(path.join(root, "Big.aot"), ["Big|a|b", ...rows]);
        vscode.workspace.textDocuments = [f.doc, big.doc];
        await registeredCommands.get("aot.recomputeFormulas")(big.editor);
        const firstSizes = batches.slice(-2).map((b) => b.items.length);
        big.set(big.lines().map((l, i) => (i ? l.replace("|1", "|2") : l)).join("\n"));
        const atCancel = evals();
        let polled = 0;
        const stoppedShort = await ext._test.runPython(big.editor, { mode: "auto", isCancelled: () => polled++ > 0 });
        const ranBeforeCancel = evals() - atCancel;
        const landed = big.lines().filter((l) => /\|4 =@a\*2/.test(l)).length;
        const atRest = evals();
        const rest = await ext._test.runPython(big.editor, { mode: "auto" });
        console.log(firstSizes.join() === "64,6" && stoppedShort.cancelled === true && ranBeforeCancel === 64 && landed === 64
          ? "PASS (calculation: a long file goes in batches of 64, and a pass told to stop stops between them, keeping what finished)"
          : "UNEXPECTED batches " + JSON.stringify({ firstSizes, stoppedShort, ranBeforeCancel, landed }));
        console.log(rest.ran === 6 && evals() === atRest + 6 && big.lines().filter((l) => /\|4 =@a\*2/.test(l)).length === 70
          ? "PASS (calculation: the next pass does only what the stopped one did not)"
          : "UNEXPECTED rest " + JSON.stringify({ rest, ran: evals() - atRest }));
        vscode.workspace._close(big.doc);
      }

      // a table many formulas read is sent once
      {
        const sh = live(path.join(root, "Shared.aot"), ["T|a|s", "A|1|=@T@a.sum()", "B|2|=@T@a.sum()", "C|3|=@T@a.sum()"]);
        vscode.workspace.textDocuments = [f.doc, sh.doc];
        await registeredCommands.get("aot.recomputeFormulas")(sh.editor);
        const sent = batches[batches.length - 1];
        console.log(sent.items.length === 3 && sent.targets.length === 1 && sh.lines().slice(1).every((l) => /\|6 =@T@a\.sum\(\)$/.test(l))
          ? "PASS (calculation: a column read by many formulas goes to Python once)"
          : "UNEXPECTED shared targets " + JSON.stringify({ items: sent.items.length, targets: sent.targets.length, lines: sh.lines() }));
        vscode.workspace._close(sh.doc);
      }

      // the writer kept typing while it ran: each result is found again by address
      {
        const m = live(path.join(root, "Moved.aot"), ["Moved", "    a: 2", "    b: =@a*2"]);
        vscode.workspace.textDocuments = [f.doc, m.doc];
        duringEval = () => {
          duringEval = null;
          const lines = m.lines();
          lines.splice(1, 0, "    new: 9");
          m.set(lines.join("\n"));
        };
        await registeredCommands.get("aot.recomputeFormulas")(m.editor);
        console.log(m.lines().join("\n") === ["Moved", "    new: 9", "    a: 2", "    b: 4 =@a*2"].join("\n")
          ? "PASS (calculation: a line added while it ran moves the result with it)"
          : "UNEXPECTED moved result " + JSON.stringify(m.lines()));
        // ...and a result whose formula changed while it ran is dropped, and runs again
        m.set(m.text().replace("    a: 2", "    a: 3"));
        duringEval = () => {
          duringEval = null;
          m.set(m.text().replace("=@a*2", "=@a-1"));
        };
        await ext._test.runPython(m.editor, { mode: "auto" });
        const dropped = m.lines()[3];
        await ext._test.runPython(m.editor, { mode: "auto" });
        console.log(dropped === "    b: 4 =@a-1" && m.lines()[3] === "    b: 2 =@a-1"
          ? "PASS (calculation: a result whose formula changed while it ran is dropped, and the formula runs again)"
          : "UNEXPECTED dropped result " + JSON.stringify({ dropped, line: m.lines()[3] }));
        vscode.workspace._close(m.doc);
      }

      // a formula that takes its session down: it waits, and the rest go on
      {
        const c2 = live(path.join(root, "Crash.aot"), ["Crash", "    a: =1+1", "    b: =crash()", "    c: =math.factorial(10)"]);
        vscode.workspace.textDocuments = [f.doc, c2.doc];
        const spawnsAtCrash = spawns;
        const crashed = await registeredCommands.get("aot.recomputeFormulas")(c2.editor);
        const crashFinding = pyFindings(c2.doc).find((d) => d.range.a[0] === 2);
        console.log(c2.lines()[1] === "    a: 2 =1+1" && c2.lines()[3] === "    c: 3,628,800 =math.factorial(10)" && crashed.failed === 1 && spawns === spawnsAtCrash + 2
          && crashFinding && /^fix this formula — /.test(crashFinding.message)
          ? "PASS (calculation: a formula that crashes its session is that formula's failure, and the rest go on in a fresh one)"
          : "UNEXPECTED crash " + JSON.stringify({ crashed, lines: c2.lines(), findings: pyFindings(c2.doc).map((d) => d.message) }));
        const atCrash = evals();
        await ext._test.runPython(c2.editor, { mode: "auto" });
        console.log(evals() === atCrash
          ? "PASS (calculation: a formula that crashed is not tried again until it changes)"
          : "UNEXPECTED crash retried " + JSON.stringify(requests.slice(-3)));
        vscode.workspace._close(c2.doc);
      }

      // Stop: what has not run stays out of date, and no one is told it failed
      {
        const st = live(path.join(root, "Stop.aot"), ["Stop", "    a: =1+1", "    b: =math.factorial(10)"]);
        vscode.workspace.textDocuments = [f.doc, st.doc];
        vscode.window.activeTextEditor = st.editor;
        duringEval = () => {
          duringEval = null;
          plainCommands.get("aot.stopCalculating")();
        };
        await registeredCommands.get("aot.recomputeFormulas")(st.editor);
        const stoppedSaid = pyFindings(st.doc).filter((d) => d.severity !== vscode.DiagnosticSeverity.Information);
        const textAtStop = st.lines().slice(1).join();
        const next = await ext._test.runPython(st.editor, { mode: "auto" });
        console.log(!stoppedSaid.length && textAtStop === "    a: =1+1,    b: =math.factorial(10)" && next.ran === 2 && st.lines()[1] === "    a: 2 =1+1"
          ? "PASS (calculation: Stop leaves what it did not reach out of date, says nothing failed, and the next pass runs it)"
          : "UNEXPECTED stop " + JSON.stringify({ stoppedSaid: stoppedSaid.map((d) => d.message), textAtStop, next, lines: st.lines() }));
        vscode.window.activeTextEditor = x.editor;
        vscode.workspace._close(st.doc);
      }

      // a CSV edit arriving: the .aot takes it, calculates, and goes back to disk
      // with what it computed
      {
        const p = path.join(root, "Mirror.aot");
        fs.writeFileSync(p, ["Stock|qty|twice =@qty*2", "A    |1  |", "B    |2  |", ""].join("\n"));
        const doc = await vscode.workspace.openTextDocument(p);
        vscode.workspace.textDocuments = [f.doc, doc];
        vscode.window.visibleTextEditors = [];
        vscode.workspace._open(doc);
        await ext._test.runPython(doc, { mode: "now" });
        const firstWrote = doc.lines.slice(0, 3).join("\n");
        await doc.save();
        await settle();
        const csv = path.join(root, "aot.files", "Stock.csv");
        const mirrored = fs.existsSync(csv) ? fs.readFileSync(csv, "utf8") : "";
        await new Promise((r) => setTimeout(r, 30));
        fs.writeFileSync(csv, "Stock,qty,twice\nA,10,2\nB,2,4\n");
        await vscode.workspace._csvChanged({ fsPath: csv });
        await settle();
        const disk = fs.readFileSync(p, "utf8").split(/\r?\n/);
        console.log(firstWrote === ["Stock|qty|twice =@qty*2", "A    |1  |2", "B    |2  |4"].join("\n") && mirrored === "Stock,qty,twice\nA,1,2\nB,2,4\n"
          && /^A +\|10 *\|20 *$/.test(disk[1]) && /^B +\|2 *\|4 *$/.test(disk[2])
          ? "PASS (calculation: a CSV edit arriving calculates its .aot, and what it computed is saved)"
          : "UNEXPECTED csv arriving " + JSON.stringify({ firstWrote, mirrored, disk, doc: doc.lines, findings: pyFindings(doc).map((d) => d.message) }));
        // the CSV follows, with every digit
        console.log(fs.readFileSync(csv, "utf8") === "Stock,qty,twice\nA,10,20\nB,2,4\n"
          ? "PASS (calculation: the CSV takes what was calculated from it)"
          : "UNEXPECTED csv after calculation " + JSON.stringify(fs.readFileSync(csv, "utf8")));
        vscode.workspace._close(doc);

        // two CSVs of one file arriving together: both are heard, and each table calculates
        const p2 = path.join(root, "Mirror2.aot");
        fs.writeFileSync(p2, ["Coal|ton|twice =@ton*2", "A   |1  |", "", "Wood|ton|twice =@ton*2", "B   |3  |", ""].join("\n"));
        const doc2 = await vscode.workspace.openTextDocument(p2);
        vscode.workspace.textDocuments = [f.doc, doc2];
        vscode.workspace._open(doc2);
        await ext._test.runPython(doc2, { mode: "now" });
        await doc2.save();
        await settle();
        await new Promise((r) => setTimeout(r, 30));
        const coal = path.join(root, "aot.files", "Coal.csv");
        const wood = path.join(root, "aot.files", "Wood.csv");
        fs.writeFileSync(coal, "Coal,ton,twice\nA,10,2\n");
        fs.writeFileSync(wood, "Wood,ton,twice\nB,30,6\n");
        await Promise.all([vscode.workspace._csvChanged({ fsPath: coal }), vscode.workspace._csvChanged({ fsPath: wood })]);
        await settle();
        const both = fs.readFileSync(p2, "utf8").split(/\r?\n/);
        console.log(/^A +\|10 *\|20 *$/.test(both[1]) && /^B +\|30 *\|60 *$/.test(both[4])
          && fs.readFileSync(coal, "utf8") === "Coal,ton,twice\nA,10,20\n" && fs.readFileSync(wood, "utf8") === "Wood,ton,twice\nB,30,60\n"
          ? "PASS (calculation: two CSVs arriving together are both heard, each table calculates, and each CSV takes the results)"
          : "UNEXPECTED two csvs arriving " + JSON.stringify({ both, coal: fs.readFileSync(coal, "utf8"), wood: fs.readFileSync(wood, "utf8") }));
        // a spreadsheet re-saving long numbers shorter has edited nothing
        {
          const pl = path.join(root, "Long.aot");
          fs.writeFileSync(pl, ["Ratio|v", "A    |0.3333333333333333", "B    |5", ""].join("\n"));
          const docLong = await vscode.workspace.openTextDocument(pl);
          vscode.workspace.textDocuments = [f.doc, doc2, docLong];
          vscode.workspace._open(docLong);
          await docLong.save();
          await settle();
          await new Promise((r) => setTimeout(r, 30));
          const ratio = path.join(root, "aot.files", "Ratio.csv");
          fs.writeFileSync(ratio, "Ratio,v\nA,0.333333333333333\nB,5\n");
          await vscode.workspace._csvChanged({ fsPath: ratio });
          await settle();
          console.log(fs.readFileSync(pl, "utf8").split(/\r?\n/)[1] === "A    |0.3333333333333333" && fs.readFileSync(ratio, "utf8") === "Ratio,v\nA,0.333333333333333\nB,5\n"
            ? "PASS (csv mirror: a CSV re-saved at 15 digits is no edit: the .aot keeps every digit, and the file is left as it is)"
            : "UNEXPECTED 15 digits " + JSON.stringify({ aot: fs.readFileSync(pl, "utf8"), csv: fs.readFileSync(ratio, "utf8") }));
          // and a real edit beside it still arrives
          await new Promise((r) => setTimeout(r, 30));
          fs.writeFileSync(ratio, "Ratio,v\nA,0.333333333333333\nB,6\n");
          await vscode.workspace._csvChanged({ fsPath: ratio });
          await settle();
          const longLines = fs.readFileSync(pl, "utf8").split(/\r?\n/);
          console.log(longLines[1] === "A    |0.3333333333333333" && /^B +\|6 *$/.test(longLines[2])
            ? "PASS (csv mirror: an edit beside a shortened number arrives, and the long number keeps every digit)"
            : "UNEXPECTED edit beside 15 digits " + JSON.stringify(longLines));
          vscode.workspace._close(docLong);
          vscode.workspace.textDocuments = [f.doc, doc2];
        }
        // ...and an edit made after all that is still an edit
        await new Promise((r) => setTimeout(r, 30));
        fs.writeFileSync(coal, "Coal,ton,twice\nA,5,20\n");
        await vscode.workspace._csvChanged({ fsPath: coal });
        await settle();
        const later = fs.readFileSync(p2, "utf8").split(/\r?\n/);
        console.log(/^A +\|5 *\|10 *$/.test(later[1]) && fs.readFileSync(coal, "utf8") === "Coal,ton,twice\nA,5,10\n"
          ? "PASS (calculation: a CSV edited after a calculation is still an edit)"
          : "UNEXPECTED later csv edit " + JSON.stringify({ later, coal: fs.readFileSync(coal, "utf8") }));
        vscode.workspace._close(doc2);
      }

      // a file holding work its writer has not saved is calculated, and not saved
      {
        const d = live(path.join(root, "Dirty.aot"), ["Dirty", "    a: 2", "    b: =@a*2"]);
        vscode.workspace.textDocuments = [f.doc, d.doc];
        await registeredCommands.get("aot.recomputeFormulas")(d.editor);
        let saved = 0;
        d.doc.save = async () => { saved++; return true; };
        d.doc.isDirty = true;
        d.set(d.text().replace("a: 2", "a: 3"));
        await ext._test.runPython(d.editor, { mode: "auto", reasons: new Set(["csv"]) });
        console.log(d.lines()[2] === "    b: 6 =@a*2" && saved === 0
          ? "PASS (calculation: a file with unsaved work is calculated and left unsaved)"
          : "UNEXPECTED dirty " + JSON.stringify({ saved, lines: d.lines() }));
        vscode.workspace._close(d.doc);
      }

      // what a number shows: the file holds every digit, the screen the short form,
      // and the cell a cursor stands in all of it
      {
        const sn = live(path.join(root, "Short.aot"), ["Ratio|v         |typed", "A    |=third()  |0.3333333333333333", "B    |=whole()  |1", "", "lone: =third()", "plain: 0.3333333333333333", "", "Share|w =third()|z", "C    |         |1", ""]);
        vscode.workspace.textDocuments = [f.doc, sn.doc];
        vscode.window.visibleTextEditors = [sn.editor];
        await registeredCommands.get("aot.recomputeFormulas")(sn.editor);
        const painted2 = new Map();
        sn.editor.setDecorations = (type, opts) => painted2.set(type, opts);
        const paint = (line, ch) => {
          sn.editor.selection = new vscode.Selection(line, ch, line, ch);
          vscode.window._selectionChanged({ textEditor: sn.editor, selections: [sn.editor.selection] });
          return [...painted2.values()].flat().filter((o) => o && o.renderOptions && o.renderOptions.after);
        };
        const shortAway = paint(3, 0);
        const cellShort = shortAway.find((o) => o.range.a[0] === 1);
        const loneShort = shortAway.find((o) => o.range.a[0] === 4);
        const width = sn.lines()[1].split("|")[1].length;
        console.log(sn.lines()[1].includes("0.3333333333333333 =third()") && sn.lines()[2].includes("12,345 =whole()")
          && shortAway.filter((o) => o.hoverMessage).length === 3 && cellShort && loneShort
          && cellShort.renderOptions.after.contentText === "0.3\u0305"
          && loneShort.renderOptions.after.contentText === "0.3\u0305"
          && cellShort.hoverMessage === "0.3333333333333333"
          ? "PASS (short numbers: a computed value shows its short form, and a typed one never does)"
          : "UNEXPECTED short forms " + JSON.stringify({ lines: sn.lines(), shortAway: shortAway.map((o) => [o.range.a, o.renderOptions.after.contentText]), width }));
        // a row as the screen draws it: a number's digits gone, each `after` where it is attached
        const drawn = (line) => {
          let text = sn.lines()[line];
          const here = shortAway.filter((o) => o.range.a[0] === line).sort((x, y) => y.range.a[1] - x.range.a[1]);
          for (const o of here) text = text.slice(0, o.range.a[1]) + o.renderOptions.after.contentText + text.slice(o.range.a[3]);
          return text.replace(/\u0305/g, "");
        };
        const pipesAt = (text) => JSON.stringify([...text].flatMap((c, i) => (c === "|" ? [i] : [])));
        console.log(/^A\s*\|0\.3 =third\(\)\s*\|/.test(drawn(1))
          ? "PASS (short numbers: a formula stands one space behind the short form, the padding at the end of its cell)"
          : "UNEXPECTED formula's place " + JSON.stringify(drawn(1)));
        console.log(/^C\s*\|0\.3\s*\|/.test(drawn(8)) && shortAway.filter((o) => o.range.a[0] === 8).length === 1
          ? "PASS (short numbers: with no formula in the cell, the padding is drawn with the number)"
          : "UNEXPECTED plain cell's padding " + JSON.stringify(drawn(8)));
        console.log(pipesAt(drawn(1)) === pipesAt(sn.lines()[1]) && pipesAt(drawn(8)) === pipesAt(sn.lines()[8])
          ? "PASS (short numbers: in a table the pipes stay where the file has them)"
          : "UNEXPECTED pipes " + JSON.stringify([drawn(1), sn.lines()[1], drawn(8), sn.lines()[8]]));
        const inCell = paint(1, sn.lines()[1].indexOf("|") + 2);
        console.log(!inCell.some((o) => o.range.a[0] === 1) && inCell.some((o) => o.range.a[0] === 4)
          ? "PASS (short numbers: the cell a cursor stands in shows every digit)"
          : "UNEXPECTED cursor in a short cell " + JSON.stringify(inCell.map((o) => o.range.a)));
        configStore.shortNumbers = false;
        const offNow = paint(3, 0);
        delete configStore.shortNumbers;
        console.log(!offNow.length
          ? "PASS (short numbers: aot.shortNumbers off shows every digit everywhere)"
          : "UNEXPECTED short numbers off " + JSON.stringify(offNow.length));
        await vscode.workspace._willSave({ document: sn.doc, waitUntil: () => {} });
        fs.writeFileSync(sn.doc.fileName, sn.text());
        vscode.workspace._save(sn.doc);
        await settle();
        const ratioCsv = path.join(root, "aot.files", "Ratio.csv");
        console.log(fs.existsSync(ratioCsv) && /^A,0\.3333333333333333,0\.3333333333333333$/m.test(fs.readFileSync(ratioCsv, "utf8"))
          ? "PASS (short numbers: the CSV gets every digit)"
          : "UNEXPECTED csv digits " + JSON.stringify(fs.existsSync(ratioCsv) && fs.readFileSync(ratioCsv, "utf8")));
        vscode.workspace._close(sn.doc);
      }

      vscode.window.activeTextEditor = activeBefore;
      vscode.window.visibleTextEditors = [];
      vscode.workspace.textDocuments = [f.doc];
    }
    await hoistAndReconcile();
    await gitMergeEdges();
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];

    // Ctrl+Enter is VS Code's own again: nothing here binds it, and no command stands behind it
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    const bound = manifest.contributes.keybindings;
    console.log(!bound.some((k) => /^(ctrl|cmd)\+enter$/.test(k.key || "") || /^(ctrl|cmd)\+enter$/.test(k.mac || "")) && !registeredCommands.has("aot.runPython")
      && bound.some((k) => k.key === "f9" && k.command === "aot.recomputeFormulas") && bound.some((k) => k.key === "ctrl+alt+f9" && k.command === "aot.runPythonFresh")
      ? "PASS (calculation: F9 and Ctrl+Alt+F9 calculate, and Ctrl+Enter is VS Code's own)"
      : "UNEXPECTED keys " + JSON.stringify(bound.filter((k) => /enter|f9/.test(k.key || ""))));
    // a file with no formulas: F9 has nothing to do, and starts nothing
    const plain = live(path.join(root, "Plain.aot"), ["Plain", "    a: 1"]);
    const spawnsAtPlain = spawns;
    const plainRun = await run(plain, 1);
    console.log(plainRun.ran === 0 && !plainRun.blocked && spawns === spawnsAtPlain
      ? "PASS (python: in a file with no formulas, F9 starts nothing)"
      : "UNEXPECTED F9 without formulas " + JSON.stringify({ plainRun, spawned: spawns - spawnsAtPlain }));

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
    vscode.window.visibleTextEditors = visibleBefore;
    ext._test.setSpawn(null);
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 5000);
