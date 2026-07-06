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
const vscode = {
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
  MarkdownString: class { constructor() { this.value = ""; } appendMarkdown(s) { this.value += s; return this; } },
  Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
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
    registerHoverProvider: (selector, provider) => { hoverProvider = provider; return { dispose() {} }; },
    registerDocumentFormattingEditProvider: (selector, provider) => { formattingProvider = provider; return { dispose() {} }; },
    registerDocumentSemanticTokensProvider: (selector, provider) => { semanticProvider = provider; return { dispose() {} }; },
  },
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
  WorkspaceEdit: class {
    constructor() { this.ops = []; }
    replace(uri, range, text) { this.ops.push({ type: "replace", uri, range, text }); }
    insert(uri, pos, text) { this.ops.push({ type: "insert", uri, pos, text }); }
  },
  workspace: {
    textDocuments: [],
    onDidOpenTextDocument: (fn) => { vscode.workspace._open = fn; return { dispose() {} }; },
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidSaveTextDocument: (fn) => { vscode.workspace._save = fn; return { dispose() {} }; },
    createFileSystemWatcher: () => ({
      onDidChange: (fn) => { vscode.workspace._csvChanged = fn; },
      onDidCreate: (fn) => { vscode.workspace._csvCreated = fn; },
      dispose() {},
    }),
    getConfiguration: () => ({ get: (key, fallback) => fallback }),
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
// must all be spelling (the only finding that maps to Hint).
const spellingOnly = hintsD.every((d) => / is not in the dictionary/.test(d.message));
console.log(errorsD.length === 0 && spellingOnly
  ? "PASS (reference file verifies; hints are spelling only)"
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
  const docM = makeDoc("c:\\repo\\Dep.aot", stock);
  vscode.workspace._open(docM);
  const mDiags = published.get(docM.uri.toString()) || [];
  const clashErr = mDiags.find((d) => /^clash:/.test(d.message));
  const depWarn = mDiags.find((d) => /^dependency:/.test(d.message));
  console.log(clashErr && clashErr.severity === vscode.DiagnosticSeverity.Error
    && depWarn && depWarn.severity === vscode.DiagnosticSeverity.Warning
    ? "PASS (clash publishes as error; dependency as warning)"
    : "UNEXPECTED severity mapping " + JSON.stringify(mDiags.map((d) => [d.severity, d.message.slice(0, 30)])));
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
  ].join("\n");
  const doc5 = makeDoc("c:\repo\World.aot", text);
  const { tokens } = semanticProvider.provideDocumentSemanticTokens(doc5);
  const has = (t) => tokens.some((x) => x.join(",") === t.join(","));
  const tokensOk = has([2, 13, 4, 0])   // header 'size' as attribute
    && has([2, 19, 6, 0])               // header alias 'length' as attribute
    && has([2, 29, 6, 0])               // header 'colour' as attribute
    && has([4, 6, 5, 1])                // name cell 'Ollie' as Example
    && has([4, 14, 1, 2])               // value cell '5' as value
    && has([4, 18, 5, 2]);              // value cell 'brown' as value
  console.log(tokensOk
    ? "PASS (table: cells coloured as attribute / Example / value)"
    : "UNEXPECTED semantic tokens " + JSON.stringify(tokens));

  const t6 = lint(text, "World");
  const aliasLink = resolve(text, t6.root, t6.nodes).find((l) =>
    l.connection === "attribute-is-a-Concept" && l.line === 3 && l.text === "length");
  console.log(aliasLink && aliasLink.startCol === 19 && aliasLink.target.name === "Length"
    ? "PASS (table: a header cell's alias crosslinks to its Concept)"
    : "UNEXPECTED header alias link " + JSON.stringify(aliasLink));
}

// 7) the CSV mirror, end to end on real files: saving the .aot writes one
// CSV per table into '<file>.tables', named after the parent Concept; a
// CSV edit folds back into the .aot table, aligned, and saves it.
(async () => {
  const tmp = path.join(__dirname, "tmp-sync");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const aotPath = path.join(tmp, "World.aot");
  const aotText = [
    "Otter",
    "    | name  | size |",
    "    |-------+------|",
    "    | Ollie | 5    |",
  ].join("\n");
  fs.writeFileSync(aotPath, aotText);

  // save the .aot -> Otter.csv appears
  vscode.workspace._save(makeDoc(aotPath, aotText));
  const csvPath = path.join(tmp, "World.tables", "Otter.csv");
  const written = fs.existsSync(csvPath) && fs.readFileSync(csvPath, "utf8");
  console.log(written === "name,size\nOllie,5\n"
    ? "PASS (csv mirror: saving the .aot writes <Concept>.csv)"
    : "UNEXPECTED csv written: " + JSON.stringify(written));

  // edit the CSV -> the .aot table gains the row, aligned, and is saved
  fs.writeFileSync(csvPath, "name,size\nOllie,5\nPebble,3\n");
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  const after = fs.readFileSync(aotPath, "utf8").split(/\r?\n/);
  console.log(after[3] === "    | Ollie  | 5    |" && after[4] === "    | Pebble | 3    |"
    ? "PASS (csv mirror: a CSV edit folds back into the .aot table)"
    : "UNEXPECTED aot after csv edit: " + JSON.stringify(after));

  // our own write echoing back does nothing
  const before = fs.readFileSync(aotPath, "utf8");
  await vscode.workspace._csvChanged({ fsPath: csvPath });
  console.log(fs.readFileSync(aotPath, "utf8") === before
    ? "PASS (csv mirror: no self-chase — an unchanged grid edits nothing)"
    : "UNEXPECTED csv loop");
  fs.rmSync(tmp, { recursive: true, force: true });
})();

// 8) formulas: the span after the '=' is coloured as its own token, a
// stale value publishes a pinned warning, and Tab recomputes it.
{
  const calc = [
    "Order",
    "    | name | price | total    |",
    "    |------+-------+----------|",
    "    | A    | 10    | 15 =$2*2 |",
  ].join("\n");
  const doc8 = makeDoc("c:\repo\Calc.aot", calc);
  const { tokens } = semanticProvider.provideDocumentSemanticTokens(doc8);
  const formulaTok = tokens.find((t) => t[3] === 3);
  console.log(formulaTok && formulaTok[0] === 3 && formulaTok[1] === 24 && formulaTok[2] === 5
    ? "PASS (formula: '=$2*2' carries its own colour token)"
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
    console.log(applied8 && applied8.includes("| 20 =$2*2 |")
      ? "PASS (formula: Tab recomputes the value in place)"
      : "UNEXPECTED recompute on Tab " + JSON.stringify(applied8));
  });
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

  // hovering 'Auto': its alias adds a hop, so the same chain runs one longer
  const hoverAuto = hoverProvider.provideHover(doc9, new vscode.Position(4, 1));
  console.log(hoverAuto && hoverAuto.contents.value.includes("Auto ─alias→ Car ─owner person→ Person ─home address→ Address")
    && hoverAuto.contents.value.includes("4 Concepts")
    ? "PASS (hover: 'Auto (Car)' chains through its alias, 4 Concepts)"
    : "UNEXPECTED alias hover " + JSON.stringify(hoverAuto && hoverAuto.contents.value));

  // hovering the crosslink 'person' in 'owner person' (line 7) starts the
  // chains from its target: Person ─home address→ Address
  const hoverLink = hoverProvider.provideHover(doc9, new vscode.Position(6, 11));
  console.log(hoverLink && hoverLink.contents.value.includes("'Person' dependency chains")
    && hoverLink.contents.value.includes("Person ─home address→ Address")
    ? "PASS (hover: a crosslink to a Concept shows the target's chains)"
    : "UNEXPECTED crosslink hover " + JSON.stringify(hoverLink && hoverLink.contents.value));

  // 'Address' declares no dependency, so it has no chains and no hover
  const hoverLeaf = hoverProvider.provideHover(doc9, new vscode.Position(9, 1));
  console.log(hoverLeaf === null
    ? "PASS (hover: a Concept with no dependencies hovers nothing)"
    : "UNEXPECTED leaf hover " + JSON.stringify(hoverLeaf));
}

// 10) spelling: a word longer than four characters that no English dialect
// knows publishes a Hint diagnostic on exactly its span, with suggestions;
// short words, code-shaped tokens and both dialects' spellings stay silent.
{
  const spelt = [
    "Recieve Order",
    "    note: the pakage arrived",
    "    colour: gray",
    "    url: https://example.com/blorptastic",
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
    ? "PASS (spelling: 'colour'/'gray' both dialects, short words and URLs stay silent)"
    : "UNEXPECTED extra spelling hints " + JSON.stringify(sHints.map((d) => d.message)));
}
