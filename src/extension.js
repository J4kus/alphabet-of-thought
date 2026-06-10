// VS Code entry point: publishes the arithmetic linter's findings as
// diagnostics (squiggles + Problems panel) for .aot documents.

const vscode = require("vscode");
const path = require("path");
const { lint } = require("./linter");

const DEBOUNCE_MS = 300;

function refresh(diagnostics, doc) {
  if (doc.languageId !== "aot") return;
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const { errors, warnings } = lint(doc.getText(), rootName);
  const toDiagnostic = (severity) => ({ line, message }) => {
    // lines are 1-based; range covers the line's content
    const at = Math.min(Math.max(line - 1, 0), doc.lineCount - 1);
    const range = doc.lineAt(at).range;
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = "aot";
    return diagnostic;
  };
  diagnostics.set(doc.uri, [
    ...errors.map(toDiagnostic(vscode.DiagnosticSeverity.Error)),
    ...warnings.map(toDiagnostic(vscode.DiagnosticSeverity.Warning)),
  ]);
}

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("aot");
  context.subscriptions.push(diagnostics);

  const timers = new Map();
  const refreshSoon = (doc) => {
    clearTimeout(timers.get(doc.uri.toString()));
    timers.set(doc.uri.toString(),
      setTimeout(() => refresh(diagnostics, doc), DEBOUNCE_MS));
  };

  vscode.workspace.textDocuments.forEach((doc) => refresh(diagnostics, doc));
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => refresh(diagnostics, doc)),
    vscode.workspace.onDidChangeTextDocument((event) => refreshSoon(event.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      diagnostics.delete(doc.uri);
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
