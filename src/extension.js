// VS Code entry point for .aot documents: publishes the arithmetic
// linter's errors (including the FCA audit and content-identical Gödel clash)
// and warnings (including the inferred functional dependencies) as diagnostics
// (squiggles + Problems panel), spelling as hints, paints the inline
// crosslinks as links, serves go-to-definition for them, and shows a
// Concept's dependency chains on hover.

const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { lint, KIND, INDENT } = require("./linter");
const { resolve, owningConcept } = require("./crosslinks");
const table = require("./table");
const { suggest } = require("./fca");
const { clashes } = require("./godel");
const armstrong = require("./armstrong");
const spelling = require("./spelling");
const derive = require("./derive");
const urls = require("./urls");
const hold = require("./hold");

const DEBOUNCE_MS = 300;
// past this many Examples the lattice is no longer keystroke-cheap
const MAX_FCA_OBJECTS = 200;
// how long the lone-sub warnings wait past the last keystroke before they
// show: the debounce (typing settled) plus a breath, so pressing Enter to
// add the sibling never triggers a flash
const LONE_GRACE_MS = 600;

// uri string -> { links, root, nodes } from the last analysis of that document
const analysisByDoc = new Map();
// uri string -> { baseline, timer } while an edit burst is live (see
// hold.js): the two lone-child warnings wait for typing to settle, every
// other squiggle publishes at once
const holdState = new Map();

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
  // the links reversed: every place a node is referenced, for the "used at"
  // hover sections and Find All References
  const usagesOf = new Map();
  for (const link of links) {
    const list = usagesOf.get(link.target);
    if (list) list.push(link); else usagesOf.set(link.target, [link]);
  }
  analysisByDoc.set(doc.uri.toString(), { links, root, nodes, usagesOf });
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
      // Correlated attributes are allowed, so these squiggles are opt-in via
      // aot.dependencyFindings (verify.js --fd always shows the full set).
      // When on, only confident, witnessed dependencies are flagged: a bare
      // one-to-one covariation (confidence 0) could be coincidence, and a
      // finding over an ellipsis-marked (intentionally incomplete) Example
      // set is provisional — both stay held back, like the same-name clash
      // split below.
      depWarnings = vscode.workspace.getConfiguration("aot").get("dependencyFindings", false)
        ? armstrong.findings(root, nodes).filter((f) => f.confidence >= armstrong.MIN_CONFIDENCE && !f.incomplete)
        : [];
    }
    // only the strong, content-identical clashes are flagged in the editor;
    // the weaker same-name clashes are not surfaced
    deepErrors = deepErrors.concat(clashes(root, nodes).findings.filter((f) => f.kind === "content"));
  }
  // formulas and constraints, table cells and line-form values alike: one
  // that cannot compute (or a violated constraint) is an error, a value the
  // next recompute would change is a warning — pinned to the exact span
  const formulaErrors = [], formulaWarnings = [];
  const docLines = doc.getText().split(/\r?\n/);
  for (const f of [...table.formulas(docLines), ...derive.auditValues(root, nodes, docLines)]) {
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
    usagesOf,
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

// Fill computed line-form values in place, as a table keystroke does for
// cells: runs after every refresh, but never under a cursor and never
// while an edit burst is still held — type `total: =sum($price)`, move
// off the line, and the value materialises in front of the formula.
// Tracked per document, so one document's in-flight fill never swallows
// another document's genuine keystrokes.
const autoComputing = new Set(); // uri strings with a fill in flight
async function autoComputeValues(doc, analysis, force) {
  const key = doc.uri.toString();
  if (autoComputing.has(key) || doc.languageId !== "aot") return;
  // `force` is the line-change path (Enter, an arrow off the line): it
  // fills the line just left even mid edit-burst — the cursor line is
  // still protected by the busy filter below. The debounced path defers
  // while typing, so it never churns other lines under the cursor's hand.
  if (!force && holdState.has(key)) return;
  // a caller that just analysed passes it in; the line-change path parses
  // fresh so the value fills the moment the cursor leaves, no wait
  if (!analysis) {
    const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
    analysis = lint(doc.getText(), rootName);
  }
  const lines = doc.getText().split(/\r?\n/);
  let edits = derive.recomputeValues(analysis.root, analysis.nodes, lines);
  if (!edits.length) return;
  const busy = new Set();
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document !== doc) continue;
    for (const sel of editor.selections || [editor.selection]) {
      if (sel && sel.active) busy.add(sel.active.line);
    }
  }
  edits = edits.filter((e) => !busy.has(e.line - 1));
  if (!edits.length) return;
  const fill = new vscode.WorkspaceEdit();
  for (const { line, text } of edits) {
    fill.replace(doc.uri, doc.lineAt(line - 1).range, text);
  }
  autoComputing.add(key);
  try { await vscode.workspace.applyEdit(fill); } finally { autoComputing.delete(key); }
}

function refresh(diagnostics, decorationTypes, doc) {
  if (doc.languageId !== "aot") return;
  const { errors, warnings, hints, root, nodes } = analyse(doc);
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
  // the linter's verdict is a problem: errors (V != 0) squiggle red and
  // warnings squiggle yellow, both reaching the Problems panel. The FCA audit
  // and the content-identical clash are folded into errors; the inferred
  // functional dependencies into warnings (see analyse). Spelling maps to
  // Hint: visible on its exact span and on hover, never in the Problems
  // panel — a word the dictionaries don't know is a nudge, not a verdict.
  let publish = [
    ...errors.map(toDiagnostic(vscode.DiagnosticSeverity.Error)),
    ...warnings.map(toDiagnostic(vscode.DiagnosticSeverity.Warning)),
    ...hints.map(toDiagnostic(vscode.DiagnosticSeverity.Hint)),
  ];
  // the lone-sub warnings wait while an edit burst is live, so the linter
  // never nags a parent the instant its first child is typed; every other
  // squiggle publishes at once. Decorations and colours are not
  // diagnostics and are never held.
  const state = holdState.get(doc.uri.toString());
  if (state) publish = hold.partition(publish, state.baseline).show;
  diagnostics.set(doc.uri, publish);
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document === doc) decorate(editor, decorationTypes);
  }
  chainHintsChanged.fire(); // the inlay chains track the fresh analysis
  autoComputeValues(doc, { root, nodes }); // computed line values fill themselves in
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

// The defining Concept or Example whose name sits under the cursor, or null.
function definingNodeAt(analysis, doc, position) {
  for (const node of analysis.nodes) {
    if (node.line - 1 !== position.line) continue;
    if (node.kind !== KIND.CONCEPT && node.kind !== KIND.INDIVIDUAL) continue;
    const raw = doc.lineAt(node.line - 1).text;
    let start = node.nameCol;
    if (start === undefined) {
      const indent = raw.length - raw.trimStart().length;
      start = node.kind === KIND.INDIVIDUAL ? indent + 2 : indent; // past '- '
    }
    if (position.character >= start && position.character <= start + node.name.length) return node;
  }
  return null;
}

// The markdown lines for where a node is referenced, capped to stay readable.
const MAX_USAGES = 8;
function appendUsages(md, doc, analysis, node) {
  const usages = analysis.usagesOf ? analysis.usagesOf.get(node) || [] : [];
  if (!usages.length) return false;
  md.appendMarkdown(`\n**used at**\n\n`);
  for (const link of usages.slice(0, MAX_USAGES)) {
    const at = Math.min(Math.max(link.line - 1, 0), doc.lineCount - 1);
    md.appendMarkdown(`- line ${link.line}: \`${doc.lineAt(at).text.trim()}\`\n`);
  }
  if (usages.length > MAX_USAGES) md.appendMarkdown(`- +${usages.length - MAX_USAGES} more\n`);
  return true;
}

// The markdown for one Example's full details: what it is an Example of,
// where it is defined, and the values it carries.
function exampleMarkdown(doc, analysis, ex, withUsages) {
  const md = new vscode.MarkdownString();
  const owner = owningConcept(ex);
  md.appendMarkdown(`**'- ${ex.name}'**${owner && owner.name !== ex.name ? ` — Example of '${owner.name}'` : ""} (line ${ex.line})\n\n`);
  for (const c of ex.children) {
    if (c.kind === KIND.DEFAULT) md.appendMarkdown(`- ${c.name}: ${c.value}\n`);
    else if (c.kind === KIND.ATTRIBUTE) md.appendMarkdown(`- ${c.name}\n`);
    else if (c.kind === KIND.INDIVIDUAL) md.appendMarkdown(`- \\- ${c.name}\n`);
  }
  if (withUsages) appendUsages(md, doc, analysis, ex);
  return md;
}

// A URL under the cursor answers with light metadata — status, content
// type, last modified — fetched by a HEAD request only when hovered,
// cached for a few minutes (urls.js). Off with aot.urlMetadata; Ctrl+click
// (the DocumentLinkProvider) works regardless.
function urlHoverAt(doc, position) {
  if (position.line >= doc.lineCount) return null;
  const span = urls.findUrls([doc.lineAt(position.line).text])
    .find((u) => position.character >= u.startCol && position.character <= u.endCol);
  if (!span) return null;
  if (!vscode.workspace.getConfiguration("aot").get("urlMetadata", true)) return null;
  const range = new vscode.Range(position.line, span.startCol, position.line, span.endCol);
  return urls.metadata(span.url).then((m) => {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(m.error
      ? `**${span.url}** — unreachable: ${m.error}`
      : `**${span.url}**\n\n` + [
          `status ${m.status}`,
          m.contentType && `type ${m.contentType}`,
          m.lastModified && `last modified ${m.lastModified}`,
        ].filter(Boolean).join(" · "));
    return new vscode.Hover(md, range);
  });
}

// Hovering shows what the cursor rests on:
//   - a URL -> its metadata, fetched on demand;
//   - a crosslink to an Example -> that Example's full details (its owner,
//     defining line, and every value it carries);
//   - a Concept's defining name, or a crosslink to a Concept -> its
//     dependency chains — `Trip ─driver person→ Person ─home address→
//     Address (3 Concepts)`, one chain per crosslinked attribute — plus
//     where it is used;
//   - an Example's defining name -> its details plus where it is used as a
//     value.
const hoverProvider = {
  provideHover(doc, position) {
    // a URL answers with its metadata before anything else is consulted
    const url = urlHoverAt(doc, position);
    if (url) return url;
    const analysis = analysisByDoc.get(doc.uri.toString()) || analyse(doc);
    // a link to an Example: show the Example itself
    for (const link of analysis.links) {
      if (link.target.kind === KIND.INDIVIDUAL && linkRange(link).contains(position)) {
        return new vscode.Hover(exampleMarkdown(doc, analysis, link.target, false), linkRange(link));
      }
    }
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
      const node = definingNodeAt(analysis, doc, position);
      if (node && node.kind === KIND.INDIVIDUAL) {
        // an Example's defining name: details plus its usages
        const md = exampleMarkdown(doc, analysis, node, true);
        return md.value.trim() ? new vscode.Hover(md) : null;
      }
      if (node && node.kind === KIND.CONCEPT) {
        concept = node;
        const raw = doc.lineAt(node.line - 1).text;
        const start = raw.length - raw.trimStart().length;
        range = new vscode.Range(node.line - 1, start, node.line - 1, start + node.name.length);
      }
    }
    if (!concept) return null;
    const found = armstrong.chains(analysis.root, analysis.nodes, concept);
    const md = new vscode.MarkdownString();
    if (found.length) {
      md.appendMarkdown(`**'${concept.name}' dependency chains**\n\n`);
      for (const chain of found) {
        let s = chain.path[0].name;
        for (let i = 1; i < chain.path.length; i++) {
          s += ` ─${chain.via[i - 1]}→ ${chain.path[i].name}`;
        }
        md.appendMarkdown(`- ${s}${chain.cycle ? " ↩ (cycle)" : ""} — ${new Set(chain.path).size} Concepts\n`);
      }
    }
    const hadUsages = appendUsages(md, doc, analysis, concept);
    if (!found.length && !hadUsages) return null;
    return new vscode.Hover(md, range);
  },
};

// Find All References (Shift+F12): the declaration plus every crosslink
// that resolves to the Concept or Example under the cursor.
const referenceProvider = {
  provideReferences(doc, position, context) {
    const analysis = analysisByDoc.get(doc.uri.toString()) || analyse(doc);
    let node = null;
    for (const link of analysis.links) {
      if (linkRange(link).contains(position)) { node = link.target; break; }
    }
    if (!node) node = definingNodeAt(analysis, doc, position);
    if (!node) return null;
    const locations = (analysis.usagesOf.get(node) || [])
      .map((link) => new vscode.Location(doc.uri, linkRange(link)));
    if ((!context || context.includeDeclaration) && node.line) {
      const at = Math.min(Math.max(node.line - 1, 0), doc.lineCount - 1);
      locations.unshift(new vscode.Location(doc.uri, doc.lineAt(at).range));
    }
    return locations;
  },
};

// Dependency chains in small print: an inlay hint at the end of every line
// that carries a dependency-forming crosslink shows the first chain from
// the link's Concept, abbreviated — `→Person→Address` — in the editor's
// native faint inline style. One hint per line, at most MAX_HOPS Concepts,
// `…` when the chain runs on; the full chains stay on hover. Off with
// aot.chainHints.
const chainHintsChanged = new vscode.EventEmitter();
const MAX_HOPS = 3;
const inlayProvider = {
  onDidChangeInlayHints: chainHintsChanged.event,
  provideInlayHints(doc, range) {
    if (!vscode.workspace.getConfiguration("aot").get("chainHints", true)) return [];
    const analysis = analysisByDoc.get(doc.uri.toString());
    if (!analysis) return [];
    const chainCache = new Map();
    const chainsOf = (concept) => {
      if (!chainCache.has(concept)) {
        chainCache.set(concept, armstrong.chains(analysis.root, analysis.nodes, concept));
      }
      return chainCache.get(concept);
    };
    const hinted = new Set();
    const out = [];
    for (const link of analysis.links) {
      const line = link.line - 1;
      if (line < range.start.line || line > range.end.line || hinted.has(line)) continue;
      if (line >= doc.lineCount) continue;
      const start = link.target.kind === KIND.INDIVIDUAL ? owningConcept(link.target) : link.target;
      if (!start) continue;
      const found = chainsOf(start);
      if (!found.length) continue;
      const path = found[0].path;
      const shown = path.slice(0, 1 + MAX_HOPS);
      const label = "→" + shown.map((n) => n.name).join("→") + (path.length > shown.length ? "…" : "");
      const hint = new vscode.InlayHint(doc.lineAt(line).range.end, label);
      hint.paddingLeft = true;
      hint.tooltip = "dependency chain — hover the link for all chains";
      out.push(hint);
      hinted.add(line);
    }
    return out;
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
    // a stale formula/value offers the one command that fixes them all
    for (const diagnostic of context.diagnostics || []) {
      if (diagnostic.source !== "aot") continue;
      if (!/is not yet computed|does not match its formula/.test(diagnostic.message)) continue;
      const action = new vscode.CodeAction("Recompute formulas", vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.command = { command: "aot.recomputeFormulas", title: "Recompute formulas" };
      actions.push(action);
      break;
    }
    // a derivation under the cursor offers the copy-down: onto the same
    // column's other rows (table), or the same attribute of every sibling
    // Example (line form)
    const at = range && range.start;
    const lineText = at && at.line < doc.lineCount ? doc.lineAt(at.line).text : "";
    if (lineText.trimStart().startsWith("|")) {
      const cs = table.cells(lineText);
      const cell = cs.find((c) => at.character >= c.col && at.character <= c.col + Math.max(c.text.length, 1));
      if (cell && table.splitCell(cell.text).eq !== -1) {
        const action = new vscode.CodeAction("Copy formula down the column", vscode.CodeActionKind.QuickFix);
        action.command = { command: "aot.table.copyFormulaDown", title: "Copy formula down the column" };
        actions.push(action);
      }
    } else {
      const colon = lineText.indexOf(":");
      if (colon !== -1 && table.splitCell(lineText.slice(colon + 1).trim()).eq !== -1) {
        const action = new vscode.CodeAction("Copy formula to all sibling Examples", vscode.CodeActionKind.QuickFix);
        action.command = { command: "aot.copyFormulaToSiblings", title: "Copy formula to all sibling Examples" };
        actions.push(action);
      }
    }
    return actions;
  },
};

// AOT: Recompute Formulas — one pass over the whole document: every table
// re-aligned and recomputed, every line-form '=' value refreshed.
function recomputeFormulas(editor) {
  const doc = editor.document;
  if (doc.languageId !== "aot") return;
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const { root, nodes } = lint(doc.getText(), rootName);
  const lines = doc.getText().split(/\r?\n/);
  const edits = [...table.align(doc.getText()), ...derive.recomputeValues(root, nodes, lines)];
  if (!edits.length) return;
  return editor.edit((b) => {
    for (const { line, text } of edits) b.replace(doc.lineAt(line - 1).range, text);
  });
}

// AOT: Copy Formula to Sibling Examples — the line-form copy-down: the
// derivation under the cursor lands on the same attribute of every sibling
// Example (adding the line where the attribute is absent), then recomputes.
async function copyFormulaToSiblings(editor) {
  const doc = editor.document;
  if (doc.languageId !== "aot") return;
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const { root, nodes } = lint(doc.getText(), rootName);
  const lines = doc.getText().split(/\r?\n/);
  const ops = derive.copyToSiblings(root, nodes, lines, editor.selection.active.line);
  if (!ops) return;
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  await editor.edit((b) => {
    for (const op of ops) {
      if (op.type === "replace") {
        b.replace(doc.lineAt(op.line - 1).range, op.text);
      } else if (op.afterLine >= doc.lineCount) {
        const last = doc.lineCount - 1;
        b.insert(new vscode.Position(last, doc.lineAt(last).text.length), eol + op.text);
      } else {
        b.insert(new vscode.Position(op.afterLine, 0), op.text + eol);
      }
    }
  });
  // the fresh copies start unvalued; recompute them in place
  const again = lint(doc.getText(), rootName);
  const editsNow = derive.recomputeValues(again.root, again.nodes, doc.getText().split(/\r?\n/));
  if (editsNow.length) {
    await editor.edit((b) => {
      for (const { line, text } of editsNow) b.replace(doc.lineAt(line - 1).range, text);
    });
  }
}

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
// after its parent Concept in a sibling 'tables.<file>' folder. Saving the
// .aot rewrites the CSVs; editing a CSV folds the grid back into the .aot
// table (or inserts one under the Concept) and saves it. Both directions
// write only when the content genuinely differs, which is what stops the
// two mirrors from chasing each other. Saving also migrates the legacy
// '<file>.tables' folder to the new name and deletes any CSV whose Concept
// no longer has a table.

const syncEnabled = () => vscode.workspace.getConfiguration("aot").get("tableCsvSync", true);
const lastWritten = new Map(); // csv path -> the content this extension wrote

const csvName = (name) => name.replace(/[\\/:*?"<>|]/g, "-") + ".csv";

const tablesDirOf = (fileName) => path.join(
  path.dirname(fileName), "tables." + path.basename(fileName).replace(/\.aot$/i, ""));
const legacyDirOf = (fileName) => fileName.replace(/\.aot$/i, ".tables");

// One-time migration of the pre-1.2 '<file>.tables' folder: rename it to
// 'tables.<file>' (copy-and-delete when rename is refused — OneDrive and
// friends hold locks), or fold its CSVs in when both folders exist. The
// anti-echo memory is re-keyed so a migrated write is not read back.
function migrateLegacyDir(fileName) {
  const legacy = legacyDirOf(fileName);
  const dir = tablesDirOf(fileName);
  let stat;
  try { stat = fs.statSync(legacy); } catch { return; }
  if (!stat.isDirectory()) return;
  try {
    if (!fs.existsSync(dir)) {
      try {
        fs.renameSync(legacy, dir);
      } catch {
        fs.mkdirSync(dir, { recursive: true });
        for (const entry of fs.readdirSync(legacy)) {
          fs.copyFileSync(path.join(legacy, entry), path.join(dir, entry));
          fs.unlinkSync(path.join(legacy, entry));
        }
        fs.rmdirSync(legacy);
      }
    } else {
      for (const entry of fs.readdirSync(legacy)) {
        if (!fs.existsSync(path.join(dir, entry))) {
          fs.copyFileSync(path.join(legacy, entry), path.join(dir, entry));
        }
        fs.unlinkSync(path.join(legacy, entry));
      }
      fs.rmdirSync(legacy);
    }
  } catch { return; } // a held lock loses this round; the next save retries
  for (const [file, content] of [...lastWritten]) {
    if (file.startsWith(legacy + path.sep)) {
      lastWritten.delete(file);
      lastWritten.set(path.join(dir, path.basename(file)), content);
    }
  }
}

// Delete every CSV in the tables folder whose Concept no longer has a
// table — only .csv files, only in this folder, never recursive; the
// folder itself goes when it ends empty.
function cleanupOrphans(dir, expected) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (!/\.csv$/i.test(entry)) continue;
    if (expected.has(entry.toLowerCase())) continue;
    try { fs.unlinkSync(path.join(dir, entry)); } catch { continue; }
    lastWritten.delete(path.join(dir, entry));
  }
  try {
    if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
  } catch { /* the folder stays; nothing depends on its removal */ }
}

function syncAotToCsv(doc) {
  if (doc.languageId !== "aot" || !syncEnabled()) return;
  if (!/\.aot$/i.test(doc.fileName)) return;
  const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
  const found = table.tablesOf(doc.getText().split(/\r?\n/), rootName);
  migrateLegacyDir(doc.fileName);
  const dir = tablesDirOf(doc.fileName);
  const expected = new Set(found.map((t) => csvName(t.name).toLowerCase()));
  if (fs.existsSync(dir)) cleanupOrphans(dir, expected);
  if (!found.length) return;
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
  const dirName = path.basename(dir);
  if (!dirName.startsWith("tables.")) return;
  let csv;
  try { csv = fs.readFileSync(csvPath, "utf8"); } catch { return; }
  if (lastWritten.get(csvPath) === csv) return; // our own write echoing back
  const aotPath = path.join(path.dirname(dir), dirName.slice("tables.".length) + ".aot");
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
    const { root, nodes } = lint(doc.getText(), rootName);
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
    // everything from an operator to its end is derivation text — a cell
    // or value formula, or an attribute's constraint — in its own colour,
    // so derivations read apart from the data at a glance. A violated
    // value's span is diagnostic-only (paint: false): the value itself is
    // plain data, not derivation text.
    const docLines = doc.getText().split(/\r?\n/);
    for (const f of [...table.formulas(docLines), ...derive.auditValues(root, nodes, docLines)]) {
      if (f.paint === false) continue;
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
  "aot.table.copyFormulaDown": table.copyFormulaDown,
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

// Tab pressed in a table's leading indent moves the whole table, not the
// cursor: the block shifts one level right (Tab) or left (Shift+Tab) —
// re-filing a table under a different parent is an indent edit, not cell
// travel. Inside the cells the same keys keep navigating.
function tableIndentZone(editor) {
  const pos = editor.selection.active;
  if (pos.line >= editor.document.lineCount) return false;
  const line = editor.document.lineAt(pos.line).text;
  const pipe = line.indexOf("|");
  return pipe > 0 && pos.character < pipe;
}

function shiftTableIndent(editor, dir) {
  const doc = editor.document;
  const lines = doc.getText().split(/\r?\n/);
  const pos = editor.selection.active;
  const block = table.blockAt(lines, pos.line);
  if (!block) return;
  const next = dir > 0
    ? block.indent + " ".repeat(INDENT)
    : block.indent.slice(0, Math.max(0, block.indent.length - INDENT));
  if (next === block.indent) return;
  block.indent = next;
  table.recompute(block);
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const range = new vscode.Range(block.start, 0, block.end, doc.lineAt(block.end).text.length);
  editor.edit((b) => b.replace(range, table.render(block).join(eol))).then(() => {
    const ch = Math.max(0, pos.character + INDENT * dir);
    editor.selection = new vscode.Selection(pos.line, ch, pos.line, ch);
  });
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

// Typing a first '|' on an otherwise empty line scaffolds a fresh table —
// header, separator, empty data row — with the cursor in the data row:
//
//     |name|
//     |----|
//     |    |     <- cursor lands here
//
// One Ctrl+Z undoes the whole thing (the edit merges with the keystroke).
// A '|' typed beside an existing table, or mid-line, scaffolds nothing.
let scaffolding = false;
async function maybeScaffold(event) {
  if (scaffolding || event.document.languageId !== "aot") return;
  if (event.contentChanges.length !== 1) return;
  const c = event.contentChanges[0];
  if (c.text !== "|" || !c.range.isEmpty) return;
  const doc = event.document;
  const at = c.range.start.line;
  if (at >= doc.lineCount) return;
  const text = doc.lineAt(at).text;
  if (text.trim() !== "|") return;
  const near = (i) => i >= 0 && i < doc.lineCount && doc.lineAt(i).text.trim().startsWith("|");
  if (near(at - 1) || near(at + 1)) return;
  const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
  if (!editor) return;
  const indent = text.slice(0, text.indexOf("|"));
  const block = {
    indent,
    rows: [
      { sep: false, cells: ["name"] },
      { sep: true, cells: [] },
      { sep: false, cells: [""] },
    ],
  };
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  scaffolding = true;
  try {
    await editor.edit(
      (b) => b.replace(doc.lineAt(at).range, table.render(block).join(eol)),
      { undoStopBefore: false, undoStopAfter: true });
    const ch = indent.length + 1;
    editor.selection = new vscode.Selection(at + 2, ch, at + 2, ch);
  } finally {
    scaffolding = false;
  }
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
  const lastCursorLine = new Map(); // uri -> the cursor's last line, per doc
  const refreshSoon = (doc) => {
    clearTimeout(timers.get(doc.uri.toString()));
    timers.set(doc.uri.toString(),
      setTimeout(() => refresh(diagnostics, decorationTypes, doc), DEBOUNCE_MS));
  };

  // the lone-sub warnings' short grace (see hold.js and refresh)
  const releaseHold = (doc) => {
    const state = holdState.get(doc.uri.toString());
    if (!state) return;
    clearTimeout(state.timer);
    holdState.delete(doc.uri.toString());
    refresh(diagnostics, decorationTypes, doc); // the held warnings publish
  };
  const trackEdits = (event) => {
    const doc = event.document;
    if (autoComputing.has(doc.uri.toString())) return; // our own fill-in is not a user edit burst
    if (doc.languageId !== "aot" || !event.contentChanges.length) return;
    const key = doc.uri.toString();
    let state = holdState.get(key);
    if (!state) {
      // the burst begins: snapshot what was already published, so a
      // lone-child warning already on screen keeps showing (no flicker)
      state = {
        baseline: new Set((diagnostics.get(doc.uri) || []).map((d) => d.message)),
        timer: null,
      };
      holdState.set(key, state);
    }
    clearTimeout(state.timer);
    // a breath past the last keystroke: the sibling either exists by now
    // (no warning) or the writer has genuinely paused
    state.timer = setTimeout(() => releaseHold(doc), LONE_GRACE_MS);
  };

  vscode.workspace.textDocuments.forEach((doc) => refresh(diagnostics, decorationTypes, doc));
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => refresh(diagnostics, decorationTypes, doc)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      maybeScaffold(event); // a first '|' on an empty line grows a skeleton
      trackEdits(event); // arms the lone-sub warnings' grace timer
      refreshSoon(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      const held = holdState.get(doc.uri.toString());
      if (held) clearTimeout(held.timer);
      holdState.delete(doc.uri.toString());
      diagnostics.delete(doc.uri);
      analysisByDoc.delete(doc.uri.toString());
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) decorate(editor, decorationTypes);
    }),
    vscode.languages.registerDefinitionProvider({ language: "aot" }, definitionProvider),
    // hovering a Concept (or a crosslink to one) lists its dependency chains;
    // an Example (or a crosslink to one) shows its details and usages
    vscode.languages.registerHoverProvider({ language: "aot" }, hoverProvider),
    // Shift+F12 lists a Concept's or Example's declaration and usages
    vscode.languages.registerReferenceProvider({ language: "aot" }, referenceProvider),
    // dependency chains in small print at the end of crosslinked lines
    vscode.languages.registerInlayHintsProvider({ language: "aot" }, inlayProvider),
    // URLs in values are Ctrl+clickable (hover fetches their metadata)
    vscode.languages.registerDocumentLinkProvider({ language: "aot" }, {
      provideDocumentLinks(doc) {
        return urls.findUrls(doc.getText().split(/\r?\n/)).map((u) => new vscode.DocumentLink(
          new vscode.Range(u.line - 1, u.startCol, u.line - 1, u.endCol), vscode.Uri.parse(u.url)));
      },
    }),
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
    // does — each column padded to its widest cell, separators redrawn —
    // and recomputes every line-form '=' value.
    vscode.languages.registerDocumentFormattingEditProvider({ language: "aot" }, {
      provideDocumentFormattingEdits(doc) {
        const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
        const { root, nodes } = lint(doc.getText(), rootName);
        const lines = doc.getText().split(/\r?\n/);
        return [...table.align(doc.getText()), ...derive.recomputeValues(root, nodes, lines)]
          .map(({ line, text }) => vscode.TextEdit.replace(doc.lineAt(line - 1).range, text));
      },
    }),
    // table cells coloured by their parsed kind, as their line forms are
    vscode.languages.registerDocumentSemanticTokensProvider({ language: "aot" }, semanticProvider, semanticLegend),
    // the org table editor's commands and its aot.inTable keybinding gate
    ...Object.entries(tableOps).map(([id, op]) =>
      vscode.commands.registerTextEditorCommand(id, (editor) => {
        // Tab/Shift+Tab in the leading indent shift the whole table a level
        const dir = id === "aot.table.nextCell" ? 1 : id === "aot.table.prevCell" ? -1 : 0;
        if (dir && tableIndentZone(editor)) return shiftTableIndent(editor, dir);
        return runTableOp(editor, op);
      })),
    vscode.commands.registerTextEditorCommand("aot.table.fromSelection", fromSelection),
    // the formula commands: whole-document recompute, and the copy-downs
    vscode.commands.registerTextEditorCommand("aot.recomputeFormulas", recomputeFormulas),
    vscode.commands.registerTextEditorCommand("aot.copyFormulaToSiblings", copyFormulaToSiblings),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      updateTableContext();
      const doc = event && event.textEditor && event.textEditor.document;
      if (!doc || doc.languageId !== "aot") return;
      const key = doc.uri.toString();
      const active = event.selections && event.selections[0] && event.selections[0].active;
      if (!active) return;
      // crossing onto another line — including pressing Enter — fills the
      // formula left behind at once: no debounce, a fresh parse, and
      // through any edit-burst (force), the new cursor line still spared.
      // (The lone-sub warnings deliberately do NOT release on a line change:
      // pressing Enter to add the sibling would otherwise flash the warning.)
      if (lastCursorLine.get(key) !== active.line) {
        lastCursorLine.set(key, active.line);
        autoComputeValues(doc, null, true);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(updateTableContext),
    // saving persists computed values: the recompute edits ride the save
    // itself, so the file on disk always carries fresh values
    vscode.workspace.onWillSaveTextDocument((event) => {
      const doc = event.document;
      if (doc.languageId !== "aot") return;
      event.waitUntil(Promise.resolve().then(() => {
        const rootName = path.basename(doc.fileName).replace(/\.[^.]*$/, "");
        const { root, nodes } = lint(doc.getText(), rootName);
        return derive.recomputeValues(root, nodes, doc.getText().split(/\r?\n/))
          .map(({ line, text }) => vscode.TextEdit.replace(doc.lineAt(line - 1).range, text));
      }));
    }),
    // the CSV mirror: .aot saves write the CSVs, CSV edits fold back in;
    // a save also releases any live hold — saving says "I am done here"
    vscode.workspace.onDidSaveTextDocument((doc) => {
      releaseHold(doc);
      syncAotToCsv(doc);
    }),
  );
  const csvWatcher = vscode.workspace.createFileSystemWatcher("**/tables.*/*.csv");
  csvWatcher.onDidChange(syncCsvIntoAot);
  csvWatcher.onDidCreate(syncCsvIntoAot);
  context.subscriptions.push(csvWatcher);
  updateTableContext();
}

function deactivate() {}

module.exports = { activate, deactivate };
