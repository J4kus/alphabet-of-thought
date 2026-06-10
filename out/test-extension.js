// Smoke test: activate the extension against a mocked vscode API and an
// in-memory .aot document, then print the diagnostics it publishes.
const fs = require("fs");
const Module = require("module");

const published = new Map();
const vscode = {
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
  Range: class { constructor(...a) { this.a = a; } },
  languages: {
    createDiagnosticCollection: () => ({
      set: (uri, diags) => published.set(uri.toString(), diags),
      delete: (uri) => published.delete(uri.toString()),
      dispose: () => {},
    }),
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

const text = fs.readFileSync("alphabet of thought.aot", "utf-8");
const lines = text.split(/\r?\n/);
const doc = {
  languageId: "aot",
  fileName: "c:\\repo\\alphabet of thought.aot",
  uri: { toString: () => "file:///repo/alphabet%20of%20thought.aot" },
  lineCount: lines.length,
  getText: () => text,
  lineAt: (i) => ({ range: new vscode.Range(i, 0, i, lines[i].length) }),
};
vscode.workspace._open(doc);

const diags = published.get(doc.uri.toString());
console.log(`published ${diags.length} diagnostics`);
for (const d of diags.slice(0, 3)) {
  console.log(`  [${d.severity === 0 ? "error" : "warning"}] line ${d.range.a[0] + 1}: ${d.message}`);
}
const errors = diags.filter((d) => d.severity === 0).length;
console.log(errors === 1 && diags.length === 4 ? "PASS (1 error + 3 warnings)" : "UNEXPECTED COUNT");
