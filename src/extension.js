// VS Code entry point for .aot documents: publishes the arithmetic
// linter's errors (including the FCA audit and content-identical Gödel clash)
// and warnings (including the inferred functional dependencies) as diagnostics
// (squiggles + Problems panel), paints the inline crosslinks as links, and
// serves go-to-definition for them.

const vscode = require("vscode");
const path = require("path");
const { lint, KIND } = require("./linter");
const { resolve } = require("./crosslinks");
const table = require("./table");
const { suggest } = require("./fca");
const { clashes } = require("./godel");
const armstrong = require("./armstrong");

const DEBOUNCE_MS = 300;
// past this many Examples the lattice is no longer keystroke-cheap
const MAX_FCA_OBJECTS = 200;

// uri string -> crosslinks from the last analysis of that document
const linksByDoc = new Map();

function analyse(doc) {
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const { root, nodes, errors, warnings } = lint(doc.getText(), rootName);
  const links = resolve(doc.getText(), root, nodes);
  linksByDoc.set(doc.uri.toString(), links);
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
      // Only confident, witnessed dependencies are flagged in the editor; a bare
      // one-to-one covariation (confidence 0) could be coincidence, and a finding
      // over an ellipsis-marked (intentionally incomplete) Example set is
      // provisional. Both are held back from the editor, like the same-name
      // clash split below.
      depWarnings = armstrong.findings(root, nodes).filter((f) => f.confidence >= armstrong.MIN_CONFIDENCE && !f.incomplete);
    }
    // only the strong, content-identical clashes are flagged in the editor;
    // the weaker same-name clashes are not surfaced
    deepErrors = deepErrors.concat(clashes(root, nodes).findings.filter((f) => f.kind === "content"));
  }
  return { errors: errors.concat(deepErrors), warnings: warnings.concat(depWarnings), links };
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
    // dotted underline for links to an Example, solid for links to a Concept
    const isConcept = link.target.kind !== KIND.INDIVIDUAL;
    const where = link.target.line ? `line ${link.target.line}` : "the file name";
    (isConcept ? concepts : individuals).push({
      range: linkRange(link),
      hoverMessage: `${link.connection}: ${isConcept ? "Concept" : "Example"} '${link.target.name}' (${where})`,
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
    // the linter's verdict is a problem: errors (V != 0) squiggle red and
    // warnings squiggle yellow, both reaching the Problems panel. The FCA audit
    // and the content-identical clash are folded into errors; the inferred
    // functional dependencies into warnings (see analyse). Nothing maps to Hint.
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
  const target = op(block, pos.line - block.start, table.colAt(lines[pos.line], pos.character));
  if (!target) return;
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const range = new vscode.Range(block.start, 0, block.end, doc.lineAt(block.end).text.length);
  editor.edit((b) => b.replace(range, table.render(block).join(eol))).then(() => {
    const line = block.start + target.row;
    const character = table.cellStart(block, target.col);
    editor.selection = new vscode.Selection(line, character, line, character);
    editor.revealRange(new vscode.Range(line, character, line, character));
  });
}

const tableOps = {
  "aot.table.nextCell": table.nextCell,
  "aot.table.prevCell": table.prevCell,
  "aot.table.nextRow": table.nextRow,
  "aot.table.moveColumnLeft": (b, r, c) => table.moveColumn(b, r, c, -1),
  "aot.table.moveColumnRight": (b, r, c) => table.moveColumn(b, r, c, 1),
  "aot.table.moveRowUp": (b, r, c) => table.moveRow(b, r, c, -1),
  "aot.table.moveRowDown": (b, r, c) => table.moveRow(b, r, c, 1),
  "aot.table.insertColumn": table.insertColumn,
  "aot.table.deleteColumn": table.deleteColumn,
  "aot.table.insertRow": table.insertRow,
  "aot.table.deleteRow": table.deleteRow,
  "aot.table.insertSeparator": table.insertSeparator,
  "aot.table.sortRows": table.sortRows,
};

// Turn the selected delimited lines (CSV, TSV, or multi-space columns) into
// an aligned table, org's C-c |: first line the header, separator beneath.
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

// The cursor sits in a table when its line is a pipe row that is more than
// a lone-cell Example: a second pipe (a closed or multi-cell row) or a
// leading dash (a separator, even the half-typed '|-' that Tab completes).
const IN_TABLE = /^\s*\|(.*\||\s*-)/;
function updateTableContext() {
  const editor = vscode.window.activeTextEditor;
  const inTable = !!(editor && editor.document.languageId === "aot"
    && editor.selection.active.line < editor.document.lineCount
    && IN_TABLE.test(editor.document.lineAt(editor.selection.active.line).text));
  vscode.commands.executeCommand("setContext", "aot.inTable", inTable);
}

function activate(context) {
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
    // Format Document re-aligns every table's columns, as org-mode's TAB
    // does: each column padded to its widest cell, separators redrawn.
    vscode.languages.registerDocumentFormattingEditProvider({ language: "aot" }, {
      provideDocumentFormattingEdits(doc) {
        return table.align(doc.getText()).map(({ line, text }) =>
          vscode.TextEdit.replace(doc.lineAt(line - 1).range, text));
      },
    }),
    // the org table editor's commands and its aot.inTable keybinding gate
    ...Object.entries(tableOps).map(([id, op]) =>
      vscode.commands.registerTextEditorCommand(id, (editor) => runTableOp(editor, op))),
    vscode.commands.registerTextEditorCommand("aot.table.fromSelection", fromSelection),
    vscode.window.onDidChangeTextEditorSelection(updateTableContext),
    vscode.window.onDidChangeActiveTextEditor(updateTableContext),
  );
  updateTableContext();
}

function deactivate() {}

module.exports = { activate, deactivate };
