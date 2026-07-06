// VS Code entry point for .aot documents: publishes the arithmetic
// linter's errors (including the FCA audit and content-identical Gödel clash)
// and warnings (including the inferred functional dependencies) as diagnostics
// (squiggles + Problems panel), spelling as hints, paints the inline
// crosslinks as links, serves go-to-definition for them, and shows a
// Concept's dependency chains on hover.

const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { lint, KIND } = require("./linter");
const { resolve } = require("./crosslinks");
const table = require("./table");
const { suggest } = require("./fca");
const { clashes } = require("./godel");
const armstrong = require("./armstrong");
const spelling = require("./spelling");

const DEBOUNCE_MS = 300;
// past this many Examples the lattice is no longer keystroke-cheap
const MAX_FCA_OBJECTS = 200;

// uri string -> { links, root, nodes } from the last analysis of that document
const analysisByDoc = new Map();

// The user's accepted words (aot.acceptedWords, lowercased): the spelling
// hints skip them and a Concept ending in one is not read as plural. The
// Quick Fix on either finding appends to the list.
function acceptedWords() {
  const config = vscode.workspace.getConfiguration("aot");
  return new Set((config.get("acceptedWords", []) || []).map((w) => String(w).toLowerCase()));
}

function analyse(doc) {
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const accepted = acceptedWords();
  const { root, nodes, errors, warnings } = lint(doc.getText(), rootName, accepted);
  const links = resolve(doc.getText(), root, nodes);
  analysisByDoc.set(doc.uri.toString(), { links, root, nodes });
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
  // cell formulas: one that cannot compute is an error, a value the next
  // recompute would change is a warning — both pinned to the formula's span
  const formulaErrors = [], formulaWarnings = [];
  for (const f of table.formulas(doc.getText().split(/\r?\n/))) {
    if (f.error) formulaErrors.push({ line: f.line, message: f.message, startCol: f.startCol, endCol: f.endCol });
    else if (f.stale) formulaWarnings.push({ line: f.line, message: f.message, startCol: f.startCol, endCol: f.endCol });
  }
  // spelling is advisory prose-hygiene, independent of the tree's verdict:
  // words longer than four characters that no English dialect (nor the
  // user's accepted words) knows, off with aot.spellingHints
  const hints = vscode.workspace.getConfiguration("aot").get("spellingHints", true)
    ? spelling.check(doc.getText(), accepted)
    : [];
  return {
    errors: errors.concat(deepErrors, formulaErrors),
    warnings: warnings.concat(depWarnings, formulaWarnings),
    hints,
    links,
    root,
    nodes,
  };
}

function linkRange(link) {
  return new vscode.Range(link.line - 1, link.startCol, link.line - 1, link.endCol);
}

function decorate(editor, decorationTypes) {
  if (editor.document.languageId !== "aot") return;
  const { links = [] } = analysisByDoc.get(editor.document.uri.toString()) || {};
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
  const { errors, warnings, hints } = analyse(doc);
  const toDiagnostic = (severity) => ({ line, message, startCol, endCol }) => {
    // lines are 1-based; a finding that carries columns (a table cell)
    // squiggles just that span, otherwise the whole line's content
    const at = Math.min(Math.max(line - 1, 0), doc.lineCount - 1);
    const range = startCol !== undefined
      ? new vscode.Range(at, startCol, at, endCol)
      : doc.lineAt(at).range;
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = "aot";
    return diagnostic;
  };
  diagnostics.set(doc.uri, [
    // the linter's verdict is a problem: errors (V != 0) squiggle red and
    // warnings squiggle yellow, both reaching the Problems panel. The FCA audit
    // and the content-identical clash are folded into errors; the inferred
    // functional dependencies into warnings (see analyse). Spelling maps to
    // Hint: visible on its exact span and on hover, never in the Problems
    // panel — a word the dictionaries don't know is a nudge, not a verdict.
    ...errors.map(toDiagnostic(vscode.DiagnosticSeverity.Error)),
    ...warnings.map(toDiagnostic(vscode.DiagnosticSeverity.Warning)),
    ...hints.map(toDiagnostic(vscode.DiagnosticSeverity.Hint)),
  ]);
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document === doc) decorate(editor, decorationTypes);
  }
}

// Ctrl+click on a crosslink jumps to the defining node's line.
const definitionProvider = {
  provideDefinition(doc, position) {
    const { links } = analysisByDoc.get(doc.uri.toString()) || analyse(doc);
    for (const link of links) {
      if (linkRange(link).contains(position)) {
        const at = Math.min(Math.max(link.target.line - 1, 0), doc.lineCount - 1);
        return new vscode.Location(doc.uri, doc.lineAt(at).range);
      }
    }
    return null;
  },
};

// Hovering a Concept shows its dependency chains. A crosslinked attribute
// makes the Concept depend on the Concept it names; if that one's attributes
// are crosslinked too the chain runs on, one Concept per hop — `Trip ─driver
// person→ Person ─home address→ Address (3 Concepts)` — and a Concept with
// several crosslinked attributes has several chains. Works on a Concept's
// defining name and on any crosslink that lands on a Concept (there the
// chains start from the target).
const hoverProvider = {
  provideHover(doc, position) {
    const analysis = analysisByDoc.get(doc.uri.toString()) || analyse(doc);
    let concept = null;
    let range = null;
    for (const link of analysis.links) {
      if (link.target.kind !== KIND.INDIVIDUAL && linkRange(link).contains(position)) {
        concept = link.target;
        range = linkRange(link);
        break;
      }
    }
    if (!concept) {
      for (const node of analysis.nodes) {
        if (node.kind !== KIND.CONCEPT || node.line - 1 !== position.line) continue;
        const raw = doc.lineAt(node.line - 1).text;
        const start = raw.length - raw.trimStart().length;
        if (position.character < start || position.character > start + node.name.length) continue;
        concept = node;
        range = new vscode.Range(node.line - 1, start, node.line - 1, start + node.name.length);
        break;
      }
    }
    if (!concept) return null;
    const found = armstrong.chains(analysis.root, analysis.nodes, concept);
    if (!found.length) return null;
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**'${concept.name}' dependency chains**\n\n`);
    for (const chain of found) {
      let s = chain.path[0].name;
      for (let i = 1; i < chain.path.length; i++) {
        s += ` ─${chain.via[i - 1]}→ ${chain.path[i].name}`;
      }
      md.appendMarkdown(`- ${s}${chain.cycle ? " ↩ (cycle)" : ""} — ${new Set(chain.path).size} Concepts\n`);
    }
    return new vscode.Hover(md, range);
  },
};

// The lightbulb on a spelling hint or an appears-plural warning accepts the
// word: it joins aot.acceptedWords in the user settings, the spelling hints
// skip it and a Concept ending in it is no longer read as plural. The word
// is read back out of the message (both formats are this extension's own).
const ACCEPT_SPELLING = /^'(.+)' is not in the dictionary/;
const ACCEPT_PLURAL = /^Concept '(.+)' appears plural/;
const codeActionProvider = {
  provideCodeActions(doc, range, context) {
    const actions = [];
    for (const diagnostic of context.diagnostics || []) {
      if (diagnostic.source !== "aot") continue;
      const spelt = ACCEPT_SPELLING.exec(diagnostic.message);
      const plural = ACCEPT_PLURAL.exec(diagnostic.message);
      // a plural finding is about the Concept's last word, which carries the number
      const word = spelt ? spelt[1] : plural ? plural[1].split(/\s+/).pop() : null;
      if (!word) continue;
      const action = new vscode.CodeAction(
        `Accept '${word}' (add to aot.acceptedWords)`, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.command = { command: "aot.acceptWord", title: `Accept '${word}'`, arguments: [word] };
      actions.push(action);
    }
    return actions;
  },
};

// Append a word to aot.acceptedWords (user settings, case-insensitive). The
// configuration change re-lints every open document, so the finding clears.
async function acceptWord(word) {
  const config = vscode.workspace.getConfiguration("aot");
  const words = config.get("acceptedWords", []) || [];
  const low = String(word).toLowerCase();
  if (words.some((w) => String(w).toLowerCase() === low)) return;
  await config.update("acceptedWords", [...words, low], vscode.ConfigurationTarget.Global);
}

// --- the CSV mirror -----------------------------------------------------------
// Every table lives twice: as the pipe grid in the .aot and as a CSV named
// after its parent Concept in a sibling '<file>.tables' folder. Saving the
// .aot rewrites the CSVs; editing a CSV folds the grid back into the .aot
// table (or inserts one under the Concept) and saves it. Both directions
// write only when the content genuinely differs, which is what stops the
// two mirrors from chasing each other.

const syncEnabled = () => vscode.workspace.getConfiguration("aot").get("tableCsvSync", true);
const lastWritten = new Map(); // csv path -> the content this extension wrote

const csvName = (name) => name.replace(/[\\/:*?"<>|]/g, "-") + ".csv";

function syncAotToCsv(doc) {
  if (doc.languageId !== "aot" || !syncEnabled()) return;
  if (!/\.aot$/i.test(doc.fileName)) return;
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const found = table.tablesOf(doc.getText().split(/\r?\n/), rootName);
  if (!found.length) return;
  const dir = doc.fileName.replace(/\.aot$/i, ".tables");
  fs.mkdirSync(dir, { recursive: true });
  for (const t of found) {
    const file = path.join(dir, csvName(t.name));
    const csv = table.toCsv([t.header, ...t.rows]);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === csv) continue;
    lastWritten.set(file, csv);
    fs.writeFileSync(file, csv);
  }
}

async function syncCsvIntoAot(uri) {
  if (!syncEnabled()) return;
  const csvPath = uri.fsPath;
  const dir = path.dirname(csvPath);
  if (!dir.endsWith(".tables")) return;
  let csv;
  try { csv = fs.readFileSync(csvPath, "utf8"); } catch { return; }
  if (lastWritten.get(csvPath) === csv) return; // our own write echoing back
  const aotPath = dir.slice(0, -".tables".length) + ".aot";
  if (!fs.existsSync(aotPath)) return;
  const grid = table.fromCsv(csv);
  if (!grid.length) return;
  const doc = await vscode.workspace.openTextDocument(aotPath);
  const rootName = path.basename(aotPath).replace(/\.[^.]*$/, "");
  const name = path.basename(csvPath, ".csv");
  const result = table.updateTable(
    doc.getText().split(/\r?\n/), name, grid[0], grid.slice(1), rootName);
  if (!result || !result.changed) return;
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const edit = new vscode.WorkspaceEdit();
  if (result.to < result.from) {
    const at = Math.min(result.from, doc.lineCount);
    edit.insert(doc.uri, new vscode.Position(at, 0), result.block.join(eol) + eol);
  } else {
    const range = new vscode.Range(result.from, 0, result.to, doc.lineAt(result.to).text.length);
    edit.replace(doc.uri, range, result.block.join(eol));
  }
  await vscode.workspace.applyEdit(edit);
  await doc.save(); // the save re-mirrors, converging both copies
}

// --- table cell colouring ---------------------------------------------------
// The grammar colours whole lines by shape, which is right everywhere but
// inside a table, where one line holds several kinds of idea. Semantic
// tokens overlay the parsed cells so a table is coloured exactly as its
// written-out form would be: header cells as attributes, name cells as
// Examples, value cells as Attribute Values. package.json maps each token
// type back to the grammar's own scopes, so themes use identical colours.
const TOKEN_TYPES = ["property", "enumMember", "string", "macro"];
const ATTR_TOKEN = 0, EXAMPLE_TOKEN = 1, VALUE_TOKEN = 2, FORMULA_TOKEN = 3;
const semanticLegend = new vscode.SemanticTokensLegend(TOKEN_TYPES, []);
const semanticProvider = {
  provideDocumentSemanticTokens(doc) {
    const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
    const { nodes } = lint(doc.getText(), rootName);
    const builder = new vscode.SemanticTokensBuilder(semanticLegend);
    for (const node of nodes) {
      if (node.kind === KIND.ATTRIBUTE && node.cell) {
        builder.push(node.line - 1, node.nameCol, node.name.length, ATTR_TOKEN);
        if (node.alias && node.aliasCol !== undefined) {
          builder.push(node.line - 1, node.aliasCol, node.alias.length, ATTR_TOKEN);
        }
      } else if (node.kind === KIND.INDIVIDUAL && node.nameCol !== undefined && node.name) {
        builder.push(node.line - 1, node.nameCol, node.name.length, EXAMPLE_TOKEN);
      } else if (node.kind === KIND.DEFAULT && node.cell && node.value) {
        builder.push(node.line - 1, node.valueCol, node.value.length, VALUE_TOKEN);
      }
    }
    // everything from a cell's '=' to its end is the formula, in its own
    // colour, so derivations read apart from the data at a glance
    for (const f of table.formulas(doc.getText().split(/\r?\n/))) {
      builder.push(f.line - 1, f.startCol, f.endCol - f.startCol, FORMULA_TOKEN);
    }
    return builder.build();
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
  table.recompute(block); // every table keystroke recalculates, as org's TAB does
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
      analysisByDoc.delete(doc.uri.toString());
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) decorate(editor, decorationTypes);
    }),
    vscode.languages.registerDefinitionProvider({ language: "aot" }, definitionProvider),
    // hovering a Concept (or a crosslink to one) lists its dependency chains
    vscode.languages.registerHoverProvider({ language: "aot" }, hoverProvider),
    // the Quick Fix that accepts a hinted word into aot.acceptedWords
    vscode.languages.registerCodeActionsProvider({ language: "aot" }, codeActionProvider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.commands.registerCommand("aot.acceptWord", acceptWord),
    // a settings change (accepted words, spelling toggle, ...) re-lints
    // every open document so the findings track it immediately
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("aot")) return;
      vscode.workspace.textDocuments.forEach((doc) => refresh(diagnostics, decorationTypes, doc));
    }),
    // Format Document re-aligns every table's columns, as org-mode's TAB
    // does: each column padded to its widest cell, separators redrawn.
    vscode.languages.registerDocumentFormattingEditProvider({ language: "aot" }, {
      provideDocumentFormattingEdits(doc) {
        return table.align(doc.getText()).map(({ line, text }) =>
          vscode.TextEdit.replace(doc.lineAt(line - 1).range, text));
      },
    }),
    // table cells coloured by their parsed kind, as their line forms are
    vscode.languages.registerDocumentSemanticTokensProvider({ language: "aot" }, semanticProvider, semanticLegend),
    // the org table editor's commands and its aot.inTable keybinding gate
    ...Object.entries(tableOps).map(([id, op]) =>
      vscode.commands.registerTextEditorCommand(id, (editor) => runTableOp(editor, op))),
    vscode.commands.registerTextEditorCommand("aot.table.fromSelection", fromSelection),
    vscode.window.onDidChangeTextEditorSelection(updateTableContext),
    vscode.window.onDidChangeActiveTextEditor(updateTableContext),
    // the CSV mirror: .aot saves write the CSVs, CSV edits fold back in
    vscode.workspace.onDidSaveTextDocument(syncAotToCsv),
  );
  const csvWatcher = vscode.workspace.createFileSystemWatcher("**/*.tables/*.csv");
  csvWatcher.onDidChange(syncCsvIntoAot);
  csvWatcher.onDidCreate(syncCsvIntoAot);
  context.subscriptions.push(csvWatcher);
  updateTableContext();
}

function deactivate() {}

module.exports = { activate, deactivate };
