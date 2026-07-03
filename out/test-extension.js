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
const vscode = {
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
  Range: class {
    constructor(...a) { this.a = a; }
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
      delete: (uri) => published.delete(uri.toString()),
      dispose: () => {},
    }),
    registerDefinitionProvider: (selector, provider) => { definitionProvider = provider; return { dispose() {} }; },
    registerDocumentFormattingEditProvider: (selector, provider) => { formattingProvider = provider; return { dispose() {} }; },
  },
  TextEdit: { replace: (range, text) => ({ range, text }) },
  Selection: class { constructor(...a) { this.a = a; this.active = { line: a[0], character: a[1] }; } },
  EndOfLine: { LF: 1, CRLF: 2 },
  commands: {
    registerTextEditorCommand: (id, fn) => { registeredCommands.set(id, fn); return { dispose() {} }; },
    executeCommand: () => {},
  },
  window: {
    visibleTextEditors: [],
    activeTextEditor: undefined,
    createTextEditorDecorationType: (style) => ({ style, dispose() {} }),
    onDidChangeVisibleTextEditors: () => ({ dispose() {} }),
    onDidChangeTextEditorSelection: () => ({ dispose() {} }),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
  },
  workspace: {
    textDocuments: [],
    onDidOpenTextDocument: (fn) => { vscode.workspace._open = fn; return { dispose() {} }; },
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
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
// The FCA audit (drift / exhaustion) and the content-identical Gödel clash are
// errors; the inferred functional dependencies are warnings; nothing is a hint.
const fcaOrClash = /^(drift|exhaustion|clash):/m.test(errorsD.map((d) => d.message).join("\n"));
const depWarn = /^dependency:/m.test(warningsD.map((d) => d.message).join("\n"));
console.log(errorsD.length > 0 && fcaOrClash && depWarn && hintsD.length === 0
  ? "PASS (FCA/clash are errors; dependencies are warnings; no hints)"
  : "UNEXPECTED COUNT");

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
  const aligned = edits.some((e) => e.text === "    | Speed | Ratio                 |");
  console.log(aligned && edits.length === 3
    ? "PASS (table: Format Document aligns the columns)"
    : "UNEXPECTED table formatting " + JSON.stringify(edits));
}

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
      && applied.t.split("\n")[2] === "    | Ollie | 5    |"
      && editor.selection.active.line === 3 && editor.selection.active.character === 14;
    console.log(ok && registeredCommands.size === 14
      ? "PASS (table editor: 14 commands; Tab aligns and moves to the next cell)"
      : "UNEXPECTED table editor " + JSON.stringify({ n: registeredCommands.size, applied, sel: editor.selection.a }));
  });
}
