// Smoke test: activate the extension against a mocked vscode API and
// in-memory .aot documents, then print the diagnostics it publishes and
// check the crosslink decorations and go-to-definition.
const fs = require("fs");
const Module = require("module");

const published = new Map();
let definitionProvider = null;
const vscode = {
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
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
  },
  window: {
    visibleTextEditors: [],
    createTextEditorDecorationType: (style) => ({ style, dispose() {} }),
    onDidChangeVisibleTextEditors: () => ({ dispose() {} }),
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
    lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length) }),
  };
}

// 1) diagnostics over the reference file, as before
const doc = makeDoc("c:\\repo\\alphabet of thought.aot", fs.readFileSync("alphabet of thought.aot", "utf-8"));
vscode.workspace._open(doc);

const diags = published.get(doc.uri.toString());
const severityName = ["error", "warning", "suggestion"];
const violations = diags.filter((d) => d.severity < 2);
const suggestions = diags.filter((d) => d.severity === 2);
console.log(`published ${violations.length} violations and ${suggestions.length} FCA suggestions`);
for (const d of diags.slice(0, 3)) {
  console.log(`  [${severityName[d.severity]}] line ${d.range.a[0] + 1}: ${d.message}`);
}
console.log(violations.length === 0 && suggestions.length > 0
  ? "PASS (the reference file verifies clean, with suggestions)"
  : "UNEXPECTED COUNT");

// 2) crosslinks: an attribute-is-a-Concept and a default-is-a-Individual
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
const individualLinks = sets.find((s) => s.some((d) => /Individual 'Socrates'/.test(d.hoverMessage))) || [];
console.log(`decorated ${conceptLinks.length} Concept link(s), ${individualLinks.length} Individual link(s)`);
for (const d of [...conceptLinks, ...individualLinks]) {
  console.log(`  line ${d.range.a[0] + 1} cols ${d.range.a[1]}-${d.range.a[3]}: ${d.hoverMessage}`);
}

// Ctrl+click on 'person' (line 5, col 5) should land on 'Person' (line 1)
const definition = definitionProvider.provideDefinition(doc2, new vscode.Position(4, 5));
const landed = definition && definition.range.a[0] === 0;
console.log(landed ? "definition of 'person' -> line 1 'Person'" : "DEFINITION FAILED");

const crosslinksPass = conceptLinks.length === 1 && individualLinks.length === 1 && landed;
console.log(crosslinksPass ? "PASS (crosslinks)" : "UNEXPECTED CROSSLINKS");
