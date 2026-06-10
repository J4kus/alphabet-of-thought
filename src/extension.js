// VS Code entry point for .aot documents: publishes the arithmetic
// linter's findings as diagnostics (squiggles + Problems panel), paints
// the inline crosslinks as links, and serves go-to-definition for them.

const vscode = require("vscode");
const path = require("path");
const { lint } = require("./linter");
const { resolve } = require("./crosslinks");

const DEBOUNCE_MS = 300;

// uri string -> crosslinks from the last analysis of that document
const linksByDoc = new Map();

function analyse(doc) {
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const { root, nodes, errors, warnings } = lint(doc.getText(), rootName);
  const links = resolve(doc.getText(), root, nodes);
  linksByDoc.set(doc.uri.toString(), links);
  return { errors, warnings, links };
}

function linkRange(link) {
  return new vscode.Range(link.line - 1, link.startCol, link.line - 1, link.endCol);
}

function decorate(editor, decorationTypes) {
  if (editor.document.languageId !== "aot") return;
  const links = linksByDoc.get(editor.document.uri.toString()) || [];
  const concepts = [];
  const individuals = [];
  for (const link of links) {
    const isConcept = link.connection === "attribute-is-a-Concept";
    const where = link.target.line ? `line ${link.target.line}` : "the file name";
    (isConcept ? concepts : individuals).push({
      range: linkRange(link),
      hoverMessage: `${link.connection}: ${isConcept ? "Concept" : "Individual"} '${link.target.name}' (${where})`,
    });
  }
  editor.setDecorations(decorationTypes.concept, concepts);
  editor.setDecorations(decorationTypes.individual, individuals);
}

function refresh(diagnostics, decorationTypes, doc) {
  if (doc.languageId !== "aot") return;
  const { errors, warnings } = analyse(doc);
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
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document === doc) decorate(editor, decorationTypes);
  }
}

// Ctrl+click on a crosslink jumps to the defining node's line.
const definitionProvider = {
  provideDefinition(doc, position) {
    const links = linksByDoc.get(doc.uri.toString()) || analyse(doc).links;
    for (const link of links) {
      if (linkRange(link).contains(position)) {
        const at = Math.min(Math.max(link.target.line - 1, 0), doc.lineCount - 1);
        return new vscode.Location(doc.uri, doc.lineAt(at).range);
      }
    }
    return null;
  },
};

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("aot");
  const decorationTypes = {
    concept: vscode.window.createTextEditorDecorationType({
      color: new vscode.ThemeColor("textLink.foreground"),
      textDecoration: "underline",
    }),
    individual: vscode.window.createTextEditorDecorationType({
      color: new vscode.ThemeColor("textLink.activeForeground"),
      textDecoration: "underline",
    }),
  };
  context.subscriptions.push(diagnostics, decorationTypes.concept, decorationTypes.individual);

  const timers = new Map();
  const refreshSoon = (doc) => {
    clearTimeout(timers.get(doc.uri.toString()));
    timers.set(doc.uri.toString(),
      setTimeout(() => refresh(diagnostics, decorationTypes, doc), DEBOUNCE_MS));
  };

  vscode.workspace.textDocuments.forEach((doc) => refresh(diagnostics, decorationTypes, doc));
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => refresh(diagnostics, decorationTypes, doc)),
    vscode.workspace.onDidChangeTextDocument((event) => refreshSoon(event.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      diagnostics.delete(doc.uri);
      linksByDoc.delete(doc.uri.toString());
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) decorate(editor, decorationTypes);
    }),
    vscode.languages.registerDefinitionProvider({ language: "aot" }, definitionProvider),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
