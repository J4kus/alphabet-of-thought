// Arithmetic linting of .aot files, after Leibniz (1679).
//
// Every node receives a unique prime. A node's characteristic number is
// its prime multiplied by its parent's characteristic number, so the
// whole ancestry of an idea is encoded in one integer:
//
//     is-a        X is under Y         <=>  chi(Y) divides chi(X)
//     genus       nearest common kind   =   gcd(chi(X), chi(Y))
//     differentia what sets X apart     =   chi(X) / chi(genus)
//
// The file is valid if and only if the violation count V = 0.
//
// On top of the arithmetic, a subsumption reasoner (subsumption.js) derives
// the hierarchy a second time from each Concept's declared facts and holds
// the written tree to it: a misfiled Concept (its attributes are another
// Concept's), two kinds under one name, a shared definition or a cycle are
// errors that count toward V. The single-inheritance check that primes once
// only restated is now proved by the reasoner.
//
// Used by the VS Code extension (extension.js).

const pluralize = require("pluralize");
const { cells: tableCells, isSeparator, splitCell } = require("./table");

const INDENT = 4;

// Node types as Said-of / Present-in bits: t = 2*S + P
const INDIVIDUAL = 0, DEFAULT = 1, CONCEPT = 2, ATTRIBUTE = 3, MAP = 4;
const TYPE_NAME = ["Example", "Default Value", "Concept", "attribute", "Map"];

// One home for every finding. parse and verify both report through this,
// so no check has to know whether it produces an error or a warning until
// it calls error() or warn(). A finding may carry { startCol, endCol } to
// pin the squiggle to a span (a table cell); without it the editor
// underlines the whole line.
function makeReport() {
  const errors = [], warnings = [];
  return {
    errors, warnings,
    error: (line, message, range) => errors.push({ line, message, ...range }),
    warn: (line, message) => warnings.push({ line, message }),
  };
}

// A node's children that carry real content. Maps describe a node rather
// than divide it, so the structural checks skip them.
const realChildren = (node) => node.children.filter((c) => c.kind !== MAP);

function* primes() {
  const found = [];
  for (let n = 2; ; n++) {
    if (found.every((p) => n % p)) {
      found.push(n);
      yield BigInt(n);
    }
  }
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

// Group items by a key. keyOf returning null drops the item from every group.
function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

// Walk the groups that hold a duplicate. For each, fn is called once per
// extra member (all but the first) with that member, the shared "lines a, b"
// string, and the whole group — the shape every uniqueness check reports in.
function eachDuplicate(groups, fn) {
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const where = group.map((d) => d.line).join(", ");
    for (const dup of group.slice(1)) fn(dup, where, group);
  }
}

// Return { kind, name, value } for one stripped line of content.
//
// A colon gives the term on its left a single inline value. What that value
// is depends on the term: a lowercase term is an attribute, so its value is
// an Attribute Value (a Default); a capitalised term is a Concept, so its
// value is the Concept's one inline Example — `Run Command: code ...` is the
// Concept 'Run Command' described by the single Example 'code ...', all on
// one line. parse materialises that Example as a child so it is an Example
// everywhere the tree is read. value is null when there is no colon, and ""
// when the colon has nothing after it (an empty value, caught in parse).
function classify(text) {
  if (text.startsWith("...")) return { kind: MAP, name: text.slice(3).trim(), value: null };
  // '- ' opens an Example. Pipe rows (the table form of an Example) are
  // handled in parse, which rewrites a lone-cell row to this '- ' form.
  if (text.startsWith("- ")) return { kind: INDIVIDUAL, name: text.slice(2).trim(), value: null };
  let value = null;
  const colon = text.indexOf(":");
  if (colon !== -1) {
    value = text.slice(colon + 1).trim();
    text = text.slice(0, colon).trim();
  }
  // trailing (alias) does not change identity, but it names the same idea,
  // so it is kept for crosslinking: `type (category)` links its alias to the
  // `Category` Concept just as the bare attribute `category` would.
  let alias = null;
  if (text.endsWith(")") && text.includes("(")) {
    const open = text.lastIndexOf("(");
    alias = text.slice(open + 1, -1).trim() || null;
    text = text.slice(0, open).trim();
  }
  if (text && text[0] >= "a" && text[0] <= "z") {
    return value !== null ? { kind: DEFAULT, name: text, value, alias } : { kind: ATTRIBUTE, name: text, value: null, alias };
  }
  return { kind: CONCEPT, name: text, value, alias };
}

// Parse text into a tree rooted at the file name (without extension),
// reporting indentation and shape problems to the report.
function parse(text, rootName, report) {
  const root = {
    line: 0, depth: -1, kind: CONCEPT, name: rootName,
    value: null, parent: null, children: [],
  };
  const nodes = [];
  const stack = [root]; // stack[d + 1] is the last node seen at depth d
  let prevDepth = -1;
  // The active table, set by a header row: { depth, attrs } where attrs[c]
  // is the ATTRIBUTE node column c + 1 was declared as (null for an empty
  // header cell). Only an unbroken run of pipe rows at one depth shares
  // columns — a blank line, another kind of line, or a depth change ends it.
  let table = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    let content = raw;
    if (!content.trim()) {
      table = null; // a blank line ends a table, as in org
      return;
    }
    if (content.includes("\t")) {
      report.error(line, "tab character in the indentation — AOT indents with spaces only, four per level; replace the tab with spaces");
      content = content.replace(/\t/g, " ".repeat(INDENT));
    }
    const spaces = content.length - content.replace(/^ +/, "").length;
    if (spaces % INDENT) {
      report.error(line, `indent of ${spaces} spaces is not a whole number of levels — each level of nesting is exactly ${INDENT} spaces, so add or remove spaces to reach a multiple of ${INDENT} (${spaces} mod ${INDENT} = ${spaces % INDENT}, expected 0)`);
    }
    let depth = Math.floor(spaces / INDENT);
    if (depth - prevDepth > 1) {
      report.error(line, `depth jump ${prevDepth} -> ${depth}: this line is ${depth - prevDepth} levels deeper than the line above, but a child sits exactly one level under its parent — there is no line at depth ${depth - 1} to be its parent; indent it to depth ${prevDepth + 1}`);
      depth = prevDepth + 1;
    }
    let trimmed = content.trim();
    // a '|---+---|' separator row is table layout, never a node: it marks
    // the row above it as the table's header
    if (isSeparator(trimmed)) return;
    const marker = trimmed[0];
    if (table && (marker !== "|" || depth !== table.depth)) table = null;
    if ((marker === "-" || marker === "|") && !trimmed.startsWith(marker + " ")) {
      report.error(line, `'${trimmed}' has 0 spaces after '${marker}', expected 1 — an Example begins with a dash or pipe then a space ('${marker} '); add the missing space`);
      trimmed = marker + " " + trimmed.slice(1);
    }
    if (marker === "|") {
      const row = tableCells(content);
      const parent = stack[Math.min(depth, stack.length - 1)];
      // A header row is told from a data row as in org: the line directly
      // beneath it is a '|---|' separator (so a single-cell row above one
      // is a one-column table's header, not an Example). A lone multi-cell
      // row — nothing tabular on the next line — is a header being typed:
      // it is assumed, the separator and data rows still to come.
      const below = i + 1 < lines.length ? lines[i + 1].trim() : "";
      const separatorBelow = isSeparator(below);
      const rowBelow = !separatorBelow && below[0] === "|";
      if (!table && (separatorBelow || (row.length > 1 && !rowBelow))) {
        // header row: the cells after the first declare the columns as
        // attributes of the parent, exactly as bare lowercase lines would;
        // the first cell only labels the name column and asserts nothing
        table = { depth, attrs: [] };
        let last = null;
        for (const cell of row.slice(1)) {
          // a header cell is an attribute term, so it may carry a trailing
          // (alias) exactly as the bare line form does
          let name = cell.text, alias = null, aliasCol;
          if (name.endsWith(")") && name.includes("(")) {
            const open = name.lastIndexOf("(");
            const inner = name.slice(open + 1, -1);
            alias = inner.trim() || null;
            if (alias) aliasCol = cell.col + open + 1 + (inner.length - inner.trimStart().length);
            name = name.slice(0, open).trim();
          }
          if (!name) {
            table.attrs.push(null);
            continue;
          }
          if (name[0] >= "A" && name[0] <= "Z") {
            report.error(line, `column '${name}' is capitalised — a table column names an attribute of '${parent.name}', and attributes are lowercase; lowercase it`,
              { startCol: cell.col, endCol: cell.col + cell.text.length });
          }
          const attr = {
            line, depth, kind: ATTRIBUTE, name, value: null,
            alias, aliasCol, parent, children: [], nameCol: cell.col, cell: true,
          };
          parent.children.push(attr);
          nodes.push(attr);
          table.attrs.push(attr);
          last = attr;
        }
        stack.length = depth + 1;
        stack.push(last || parent);
        prevDepth = depth;
        return;
      }
      if (table) {
        // data row: one Example named by the first cell, one Attribute
        // Value per further cell — an empty cell asserts nothing
        if (!row[0].text) {
          report.error(line, "table row has an empty first cell, expected the Example's name — the first column names the Example the row describes",
            { startCol: row[0].col, endCol: row[0].col + 1 });
        }
        if (row.length - 1 > table.attrs.length) {
          const first = row[table.attrs.length + 1];
          const lastCell = row[row.length - 1];
          report.error(line, `table row has ${row.length} cells but the header names ${table.attrs.length + 1} columns — remove the extra cells, or add columns to the header`,
            { startCol: first.col, endCol: lastCell.col + Math.max(lastCell.text.length, 1) });
        }
        const example = {
          line, depth, kind: INDIVIDUAL, name: row[0].text, value: null,
          alias: null, parent, children: [], nameCol: row[0].col,
        };
        parent.children.push(example);
        nodes.push(example);
        for (let c = 1; c < row.length && c <= table.attrs.length; c++) {
          const attr = table.attrs[c - 1];
          // a formula ('10 =$1+10') derives the value: only the value part
          // is the Attribute Value; the formula itself is presentation,
          // audited and coloured by the editor, invisible to the model
          const { value } = splitCell(row[c].text);
          if (!attr || !value) continue;
          const cellValue = {
            line, depth: depth + 1, kind: DEFAULT, name: attr.name,
            value, alias: null, parent: example, children: [],
            valueCol: row[c].col, cell: true,
          };
          example.children.push(cellValue);
          nodes.push(cellValue);
        }
        stack.length = depth + 1;
        stack.push(example);
        prevDepth = depth;
        return;
      }
      if (row.length > 1) {
        report.error(line, `table row has ${row.length} cells but no header names its columns — add a header row of attribute names directly above the data rows, with a '|---|' separator row between them`);
      }
      // a lone-cell pipe row is a plain Example: rewrite it to the '- ' form
      trimmed = "- " + (row.length ? row[0].text : "");
    }
    const { kind, name, value, alias } = classify(trimmed);
    if (value === "") {
      report.error(line, `'${name}:' has 0 characters after ':', expected a value — a colon assigns a value (as in 'colour: red'); add the value, or drop the colon to leave '${name}' as a bare attribute`);
    }
    const parent = stack[Math.min(depth, stack.length - 1)];
    const node = { line, depth, kind, name, value, alias: alias || null, parent, children: [] };
    parent.children.push(node);
    nodes.push(node);
    // A capitalised line with a colon is a Concept with one inline Example.
    // Materialise that Example as a real child, sharing the Concept's line,
    // so counts, crosslinks and the FCA context all see it as an Example —
    // the only difference from a '- ' line being that it rode in on the
    // Concept's own line.
    if (kind === CONCEPT && value) {
      const example = {
        line, depth: depth + 1, kind: INDIVIDUAL, name: value,
        value: null, parent: node, children: [],
      };
      node.children.push(example);
      nodes.push(example);
    }
    stack.length = depth + 1;
    stack.push(node);
    prevDepth = depth;
  });
  return { root, nodes };
}

// Assign primes and characteristic numbers: chi = prime * chi(parent).
function number(root, nodes) {
  const gen = primes();
  root.prime = gen.next().value;
  root.chi = root.prime;
  for (const node of nodes) {
    node.prime = gen.next().value;
    node.chi = node.prime * node.parent.chi;
  }
}

// Run the arithmetic checks, reporting errors and warnings to the report.
// accepted is an optional Set of lowercased words the user has accepted: a
// Concept whose last word is one of them is not read as plural (pluralize
// guesses, and the editor's Quick Fix feeds this set via aot.acceptedWords).
function verify(root, nodes, report, accepted) {
  const all = [root, ...nodes];

  // The file name is the root Concept; do not repeat it as a top-level line
  for (const child of root.children) {
    if (child.name === root.name) {
      report.error(child.line, `'${child.name}' repeats the file name — the file name is already the root Concept of the tree, so start with its children rather than naming it again (2 primes for the root, expected 1)`);
    }
  }

  // Maps mark omitted information; they explain a node, so under a Map
  // only further Maps may appear, never real content
  for (const node of nodes) {
    if (node.kind === MAP) {
      const content = realChildren(node);
      if (content.length) {
        report.error(node.line, `Map '... ${node.name}' has ${content.length} non-Map children, expected 0 — a '...' Map marks what is missing or still to come, so it cannot hold real content; move those lines out from under it, or remove the '...'`);
      }
    }
  }

  // A Concept names one kind; 'and' joins two
  for (const node of nodes) {
    if (node.kind === CONCEPT && /\band\b/i.test(node.name)) {
      report.error(node.line, `Concept '${node.name}' contains 'and' — 'and' names two kinds at once, but a Concept must name exactly one; split it into two Concepts (2 kinds under 1 prime, expected 1)`);
    }
  }

  // Univocity: one Concept name, one prime
  const concepts = nodes.filter((n) => n.kind === CONCEPT);
  eachDuplicate(groupBy(concepts, (n) => n.name), (dup, where, defs) => {
    report.error(dup.line, `Concept '${dup.name}' defined ${defs.length} times (lines ${where}) — one name must mean one kind, but this name labels ${defs.length} different ones; give all but one a distinguishing qualifier, or merge them (${defs.length} definitions for one term, expected 1)`);
  });

  // Ambiguity: identical siblings (same name AND same value) collapse meaning.
  // A differing alias sets them apart: `type (category)` and `type (Tag)` name
  // the same attribute but type it by different Concepts, so they are distinct.
  for (const node of all) {
    const byContent = groupBy(realChildren(node), (c) => `${c.kind} ${c.name} ${c.value} ${c.alias || ""}`);
    eachDuplicate(byContent, (d, where) => {
      report.error(d.line, `${TYPE_NAME[d.kind]} '${d.name}' repeated under '${node.name}' with the same value (lines ${where}) — two identical siblings add nothing and blur the meaning; give them different values, or keep just one`);
    });
  }

  // Single inheritance used to be checked here as gcd(chi(A), chi(B)) ==
  // chi(parent) for siblings. With a fresh unique prime per node that holds
  // by construction — it never fired. The subsumption reasoner now verifies
  // single inheritance for real (one most-specific genus per Concept), so
  // the tautology is gone.

  // Always singular form: 'Person' not 'People'. The last word carries the
  // number ('Bank Accounts'), so pluralize.isPlural judges that word — it
  // knows irregulars ('People', 'Categories') a suffix test would miss. Still
  // a warning: pluralize guesses, and words that are the same either way
  // (e.g. 'Series') can go either way.
  const looksPlural = (name) => {
    const last = name.split(/\s+/).pop();
    return pluralize.isPlural(last);
  };
  for (const node of nodes) {
    if (node.kind === CONCEPT && looksPlural(node.name)) {
      report.warn(node.line, `Concept '${node.name}' appears plural — a Concept names one kind, not a set of them; use the singular form (e.g. 'Person', not 'People')`);
    }
  }

  // Every measurement carries both a target and an actual value
  for (const node of all) {
    const defs = node.children.filter((c) => c.kind === DEFAULT);
    const actual = defs.find((c) => c.name === "actual");
    const target = defs.find((c) => c.name === "target");
    if (actual && !target) {
      report.warn(actual.line, `'${node.name}' has 'actual' without 'target' — a measurement needs both: an 'actual' is a reading with nothing to judge it against; add a 'target', or remove 'actual'`);
    }
    if (target && !actual) {
      report.warn(target.line, `'${node.name}' has 'target' without 'actual' — a measurement needs both: a 'target' is a goal with no reading yet to compare; add an 'actual', or remove 'target'`);
    }
  }

  // Child counts: more than one child of the same kind, and no more
  // than eight sub-Concepts. Sub-Concepts partition the parent, and a
  // division into more than eight kinds is not graspable at a glance;
  // Examples and attributes may come in any quantity.
  // A lone child of the same kind divides nothing: a Concept with exactly
  // one sub-Concept, or an Example with exactly one sub-Example, is
  // that child. Children of other kinds describe the parent and don't count.
  // A Map child marks the node intentionally incomplete, so a lone child
  // under it is accepted: the missing siblings are declared, not forgotten.
  for (const node of nodes) {
    const kids = realChildren(node);
    const subConcepts = kids.filter((c) => c.kind === CONCEPT).length;
    if (subConcepts > 8) {
      report.warn(node.line, `'${node.name}' has ${subConcepts} sub-Concepts, more than the eight a reader can take in at a glance — gather related ones under an in-between kind (Examples and attributes may be any number)`);
    }
    if (node.children.some((c) => c.kind === MAP)) continue;
    if (node.kind === CONCEPT && subConcepts === 1) {
      report.warn(node.line, `'${node.name}' has 1 sub-Concept, expected 0 or more than one — a single subtype divides nothing (the parent simply is that subtype); add a sibling subtype, or merge the two`);
    }
    if (node.kind === INDIVIDUAL && kids.filter((c) => c.kind === INDIVIDUAL).length === 1) {
      report.warn(node.line, `'${node.name}' has 1 sub-Example, expected 0 or more than one — a single sub-Example breaks nothing down (the parent simply is that sub-Example); add another, or merge the two`);
    }
  }

  // Differentia: sub-Concepts that divide one genus must each be told apart
  // by an asserted slot, not by the prime their position happened to assign.
  // Children inherit the genus's slots silently, so a sub-Concept's own
  // attributes and default values are its differentia. Two sibling
  // sub-Concepts with the same slot signature differ in the data by position
  // alone — the arithmetic differentia chi/genus is never empty, so the
  // numbers can't catch this; the slots must. A lone sub-Concept divides
  // nothing and is left to the child-count check; a sub-Concept whose slots
  // differ from its siblings is already set apart. A Map under the genus
  // declares the division intentionally incomplete, so it excuses the group.
  // A sub-Concept's inline Example is asserted data too, so it counts as a
  // differentia just as a default value does: `Reload: Ctrl+...` and
  // `Run: code ...` are told apart by their inline Examples, not position.
  // A sub-Concept that asserts no slot at all has an implied `...`: with no
  // attributes there is nothing yet to tell it apart, so its differentia is
  // still to come, exactly as a Map would declare — it is excused.
  const slotSignature = (c) => {
    const slots = c.children
      .filter((k) => k.kind === ATTRIBUTE || k.kind === DEFAULT)
      .map((k) => (k.kind === DEFAULT ? `${k.name}:${k.value}` : k.name));
    if (c.value) slots.push(`:${c.value}`);
    return slots.sort().join("\0");
  };
  for (const node of all) {
    if (node.children.some((c) => c.kind === MAP)) continue;
    const subConcepts = realChildren(node).filter((c) => c.kind === CONCEPT);
    if (subConcepts.length < 2) continue;
    // no attributes (empty signature): the `...` is implied, differentia still to come
    const bySlots = groupBy(subConcepts, (c) => slotSignature(c) || null);
    eachDuplicate(bySlots, (c, where) => {
      report.warn(c.line, `'${c.name}' shares its slots with a sibling under '${node.name}' (lines ${where}) — same attributes and values, so only their order tells them apart; give each a differentia (a distinguishing attribute or value), or add a '...' Map under '${node.name}' if those differences are still to come`);
    });
  }
}

// Full lint pass over a document's text. Returns the numbered tree along
// with errors and warnings as { line, message } (lines are 1-based).
function lint(text, rootName) {
  const report = makeReport();
  const { root, nodes } = parse(text, rootName, report);
  number(root, nodes);
  verify(root, nodes, report);
  // Required lazily: subsumption.js reads KIND from this module, so a
  // top-level require would be circular (as it is for crosslinks.js). The
  // reasoner is authoritative: a Concept the definitions place elsewhere is
  // an error, counted in V, so primes only cache a hierarchy it has cleared.
  const { subsume } = require("./subsumption");
  const sub = subsume(root, nodes);
  for (const { line, message } of sub.findings) report.error(line, message);
  const byLine = (a, b) => a.line - b.line;
  return {
    root, nodes,
    errors: report.errors.sort(byLine),
    warnings: report.warnings.sort(byLine),
    subsumption: { edges: sub.edges, consistent: sub.findings.length === 0 },
  };
}

module.exports = {
  lint, parse, number, verify, gcd, primes, INDENT,
  KIND: { INDIVIDUAL, DEFAULT, CONCEPT, ATTRIBUTE, MAP },
};
