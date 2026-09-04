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
const { cells: tableCells, isSeparator, isRowText, splitCell, splitConstraint, readValue, numberless } = require("./table");

const INDENT = 4;

// Node types as Said-of / Present-in bits: t = 2*S + P
const INDIVIDUAL = 0, DEFAULT = 1, CONCEPT = 2, ATTRIBUTE = 3, MAP = 4;
const TYPE_NAME = ["Example", "Default Value", "Concept", "attribute", "Map"];

// One home for every finding. parse and verify both report through this,
// so no check has to know whether it produces an error or a warning until
// it calls error() or warn(). A finding may carry { startCol, endCol } to
// pin the squiggle to a span (a table cell); without it the editor
// underlines the whole line. It may also carry related:
// [{ file?, line, startCol?, endCol?, message }] — the finding's partner
// locations (the other half of a duplicate), which the editor renders as
// clickable related information.
function makeReport() {
  const errors = [], warnings = [];
  return {
    errors, warnings,
    error: (line, message, extra) => errors.push({ line, message, ...extra }),
    warn: (line, message, extra) => warnings.push({ line, message, ...extra }),
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
// member with that member, the shared "lines a, b" string, the whole group,
// and the member's partners — every occurrence of a conflict reports, each
// finding pointing back at the others (rendered as related locations).
function eachDuplicate(groups, fn) {
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const where = group.map((d) => d.line).join(", ");
    for (const dup of group) fn(dup, where, group, group.filter((o) => o !== dup));
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
  // '- ' opens an Example. A table row is the other way of writing one,
  // and parse handles it before ever reaching here.
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
  // header cell). Only an unbroken run of rows at the header's depth or
  // deeper shares columns — a blank line, a line carrying no pipe, or a
  // line shallower than the header ends it.
  // rowStack[d] is the last row Example seen at depth d, the table's own
  // copy of the `stack` above: a row written one level deeper than the row
  // above it nests under it, exactly as an indented line nests under the
  // line above it.
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
    // A row of an open table whose name cell is empty — one still being
    // filled — is padded to its name column like every other row, so its leading spaces ARE that empty cell and not an
    // indent at all. It stands at its table's depth, and the two indent
    // laws below have nothing to say about it.
    const padded = !isSeparator(content.trim()) && isRowText(content)
      && !((tableCells(content)[0] || {}).text);
    if (!padded && spaces % INDENT) {
      report.error(line, `indent of ${spaces} spaces is not a whole number of levels — each level of nesting is exactly ${INDENT} spaces, so add or remove spaces to reach a multiple of ${INDENT} (${spaces} mod ${INDENT} = ${spaces % INDENT}, expected 0)`);
    }
    let depth = !padded ? Math.floor(spaces / INDENT)
      : table ? table.depth
      : Math.min(Math.floor(spaces / INDENT), prevDepth + 1);
    if (!padded && depth - prevDepth > 1) {
      report.error(line, `depth jump ${prevDepth} -> ${depth}: this line is ${depth - prevDepth} levels deeper than the line above, but a child sits exactly one level under its parent — there is no line at depth ${depth - 1} to be its parent; indent it to depth ${prevDepth + 1}`);
      depth = prevDepth + 1;
    }
    let trimmed = content.trim();
    // a '---+---' rule is layout left over from before 1.12, when it marked
    // the row above it as the header. Standing first is what marks the header
    // now, so the rule states nothing — it is skipped without ending the
    // table, and the next re-draw takes it out of the file
    if (isSeparator(trimmed)) return;
    const marker = trimmed[0];
    // a row carries a '|' between its cells; a row deeper than the table's
    // own line is nested inside it, so only a shallower line ends the table
    const isRow = isRowText(trimmed);
    // A '...' Map written under a table is the table's OWN — a child of the
    // Concept the table names, not of the row it happens to follow. A
    // standalone table names its Concept in its first header cell, so the
    // Concept and its rows share a line depth and the Concept's children
    // have nowhere else to sit: one level under the table is where they
    // belong, and it is where a reader already reads them ('... 4 more in
    // other.aot:12' under a grid says what the grid is missing, never what
    // its last row is missing). A row that needs a Map of its own is
    // written in line form, where it has a line to hang one under.
    const tableMap = !!table && !isRow && depth > table.depth && trimmed.startsWith("...");
    if (table && !tableMap && (!isRow || depth < table.depth)) table = null;
    // a dash Example needs its space ('- '); rows carry no gutter
    // spaces, so a cell may start right after its '|'
    if (!isRow && marker === "-" && !trimmed.startsWith("- ")) {
      report.error(line, `'${trimmed}' has 0 spaces after '-', expected 1 — an Example begins with a dash then a space ('- '); add the missing space`);
      trimmed = "- " + trimmed.slice(1);
    }
    if (isRow) {
      const row = tableCells(content);
      const parent = stack[Math.min(depth, stack.length - 1)];
      // The header is the row that opens the table: no rule declares it,
      // standing first does. Every row under it is an Example, and a row with
      // no table open is a header with its rows still to come.
      if (!table) {
        // header row: the FIRST cell names the Concept the table describes
        // — the table stands where the Concept's line would stand — and the
        // cells after it declare the columns as attributes of that Concept,
        // exactly as bare lowercase lines would. When the line the table is
        // filed under already bears the same name, the table fills that
        // node in rather than declaring a twin, so a Concept can carry
        // line-form defaults and '- ' Examples beside its grid.
        table = { depth, attrs: [], rowStack: [] };
        // the header names the Concept the whole table describes, so it is
        // the table's own line: its indent IS the table's, and every row
        // written deeper than it nests inside it
        let cName = row.length ? row[0].text : "", cAlias = null, cAliasCol;
        if (cName.endsWith(")") && cName.includes("(")) {
          const open = cName.lastIndexOf("(");
          const inner = cName.slice(open + 1, -1);
          cAlias = inner.trim() || null;
          if (cAlias && row.length) cAliasCol = row[0].col + open + 1 + (inner.length - inner.trimStart().length);
          cName = cName.slice(0, open).trim();
        }
        const sameAsParent = cName && parent.name
          && numberless(cName).toLowerCase() === numberless(parent.name).toLowerCase();
        let owner = parent;
        if (!cName) {
          report.error(line, "the table's first header cell is empty, expected the Concept the table describes — the first cell names the Concept whose Examples the rows are; write its name",
            row.length ? { startCol: row[0].col, endCol: row[0].col + Math.max(row[0].text.length, 1) } : undefined);
        } else if (sameAsParent) {
          owner = parent; // the table fills in the line it is filed under
        } else if (cName[0] >= "a" && cName[0] <= "z") {
          // a colon in the cell says this was meant as a line-form value: one
          // pipe is all it takes to be a row now, so the value's own pipe is
          // what turned it into one
          report.error(line, `the first header cell '${cName}' is lowercase — it names the Concept the table describes (the old 'name' label was dropped in 1.9); write the Concept's name there, capitalised${cName.includes(":") ? `. If this is a value rather than a table, its '|' is what made it a row — write a literal pipe as the broken bar '¦'` : ""}`,
            { startCol: row[0].col, endCol: row[0].col + row[0].text.length });
        } else {
          const concept = {
            line, depth, kind: CONCEPT, name: cName, value: null,
            alias: cAlias, aliasCol: cAliasCol, parent, children: [], nameCol: row[0].col, cell: true,
          };
          parent.children.push(concept);
          nodes.push(concept);
          owner = concept;
        }
        table.owner = owner;
        let last = null;
        for (const cell of row.slice(1)) {
          // a header cell is an attribute term, so it may carry a trailing
          // (alias) and trailing constraints (`qty >=1`, chained as
          // `age >=18 <=65`) exactly as the bare line form does — each
          // constraint bounds the whole column
          let name = cell.text, alias = null, aliasCol, constraints = null;
          const con = splitConstraint(name);
          if (con.eq !== -1) {
            constraints = con.constraints.map((b) => ({ op: b.op, formula: b.formula, opCol: cell.col + b.eq }));
            name = con.value;
          }
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
            report.error(line, `column '${name}' is capitalised — a table column names an attribute of '${owner.name}', and attributes are lowercase; lowercase it`,
              { startCol: cell.col, endCol: cell.col + cell.text.length });
          }
          const attr = {
            line, depth, kind: ATTRIBUTE, name, value: null,
            alias, aliasCol, parent: owner, children: [], nameCol: cell.col, cell: true,
          };
          if (constraints) attr.constraints = constraints;
          owner.children.push(attr);
          nodes.push(attr);
          table.attrs.push(attr);
          last = attr;
        }
        stack.length = depth + 1;
        stack.push(last || owner);
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
        // A row's leading spaces inside its name cell are its depth in the
        // table's tree: a row one level deeper than the row above it is a
        // sub-Example of that row, exactly as '- Child' under '- Parent' is.
        // Its parent is the nearest shallower row; at depth 0 it is the
        // Concept the header names, as every row always was.
        // With the outer pipe gone the name stands where the line starts,
        // so a row's depth is simply its line's, past the table's own — the
        // one indent law the whole language runs on, and already checked
        // for whole levels above.
        let rowDepth = depth - table.depth;
        if (rowDepth > table.rowStack.length) {
          report.error(line, `row '${row[0].text}' is ${rowDepth - table.rowStack.length} ${rowDepth - table.rowStack.length === 1 ? "level" : "levels"} deeper than the row above it, but a sub-Example sits exactly one level under its parent row — there is no row at depth ${rowDepth - 1} to be its parent; indent its name cell to depth ${table.rowStack.length}`,
            { startCol: row[0].col - row[0].indent, endCol: row[0].col + Math.max(row[0].text.length, 1) });
          rowDepth = table.rowStack.length;
        }
        const rowParent = rowDepth ? table.rowStack[rowDepth - 1] : table.owner;
        const example = {
          line, depth, kind: INDIVIDUAL, name: row[0].text, value: null,
          alias: null, parent: rowParent, children: [], nameCol: row[0].col,
        };
        rowParent.children.push(example);
        nodes.push(example);
        table.rowStack.length = rowDepth;
        table.rowStack.push(example);
        for (let c = 1; c < row.length && c <= table.attrs.length; c++) {
          const attr = table.attrs[c - 1];
          // a formula ('10 =$1+10') derives the value: only the value part
          // is the Attribute Value; the formula itself is presentation,
          // audited and coloured by the editor, invisible to the model
          const { value } = splitCell(row[c].text);
          if (!attr || !value) continue;
          // the column's (alias) types every value in it, exactly as it does
          // in the line form: a cell of `beneficiary (person)` is written out
          // `beneficiary (person): Socrates`, so it must be typed by `Person`
          // too — without the alias the cell would resolve nothing and its
          // value would not crosslink. Only the alias travels, not aliasCol:
          // the alias text is on the header line, not this one.
          const cellValue = {
            line, depth: depth + 1, kind: DEFAULT, name: attr.name,
            value: readValue(value), alias: attr.alias, parent: example, children: [],
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
    }
    // a bare attribute may carry trailing constraints — `age >=18` bounds
    // every value the attribute takes (checked by derive.js), and several
    // may chain on the one declaration: `age >=18 <=65`. The head must
    // be a colon-less lowercase term, so `age: 25 >=18` (a value) and
    // Concepts are left whole.
    let constraints = null;
    {
      const con = splitConstraint(trimmed);
      const head = con.eq === -1 ? "" : con.value;
      if (head && !head.includes(":") && head[0] >= "a" && head[0] <= "z") {
        constraints = con.constraints.map((b) => ({ op: b.op, formula: b.formula, opCol: spaces + b.eq }));
        trimmed = head;
      }
    }
    const { kind, name, value, alias } = classify(trimmed);
    if (value === "") {
      report.error(line, `'${name}:' has 0 characters after ':', expected a value — a colon assigns a value (as in 'colour: red'); add the value, or drop the colon to leave '${name}' as a bare attribute`);
    }
    const parent = tableMap ? table.owner : stack[Math.min(depth, stack.length - 1)];
    const node = { line, depth, kind, name, value, alias: alias || null, parent, children: [] };
    if (constraints && kind === ATTRIBUTE) node.constraints = constraints;
    // a line-form value may carry an '=' formula exactly as a table cell
    // does: `total: 30 =sum($price)` computes. Only the value part enters
    // the model; the formula is presentation, audited and coloured by the
    // editor (derive.js), invisible to the arithmetic. The split comes
    // first and the escape comes off after, so `a \= b` is read as the one
    // value 'a = b' rather than split into a derivation of 'a'.
    if (kind === DEFAULT && value) {
      const split = splitCell(value);
      if (split.eq !== -1) {
        node.formula = value.slice(split.eq + split.op.length).trim();
        node.op = split.op;
      }
      node.value = readValue(split.value);
    }
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
  // (names resolve case-insensitively, so the comparison folds case)
  for (const child of root.children) {
    if (child.name.toLowerCase() === root.name.toLowerCase()) {
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

  // Univocity: one Concept name, one prime. References resolve
  // case-insensitively and numbering prefixes are presentation, so 'Foo',
  // 'FOO' and '2. Foo' are all one name here.
  const concepts = nodes.filter((n) => n.kind === CONCEPT);
  eachDuplicate(groupBy(concepts, (n) => numberless(n.name).toLowerCase()), (dup, where, defs, others) => {
    const caseNote = new Set(defs.map((d) => numberless(d.name))).size > 1
      ? " (names differ only in case — references resolve case-insensitively, so they are one name)" : "";
    report.error(dup.line, `Concept '${dup.name}' defined ${defs.length} times (lines ${where})${caseNote} — one name must mean one kind, but this name labels ${defs.length} different ones; give all but one a distinguishing qualifier, or merge them (${defs.length} definitions for one term, expected 1)`,
      { related: others.map((o) => ({ line: o.line, message: `'${o.name}' also defined here` })) });
  });

  // An identifier resolves to exactly one target. A Concept's alias must be
  // a genuinely new name: repeating its own name renames nothing, sharing an
  // alias with another Concept is ambiguous, and naming *another* Concept
  // makes the two a single duplicated identity — all errors. (A Concept that
  // is a kind of another belongs *under* it in the tree, not aliased to it.)
  const conceptByName = new Map();
  for (const n of concepts) if (!conceptByName.has(n.name.toLowerCase())) conceptByName.set(n.name.toLowerCase(), n);
  const aliased = concepts.filter((n) => n.alias);
  for (const node of aliased) {
    const low = node.alias.toLowerCase();
    if (low === node.name.toLowerCase()) {
      report.error(node.line, `alias '(${node.alias})' on '${node.name}' repeats the Concept's own name — an alias is a second name, so this one renames nothing; drop it, or make it a genuinely different name`);
      continue;
    }
    const other = conceptByName.get(low);
    if (other && other !== node) {
      report.error(node.line, `alias '(${node.alias})' on '${node.name}' is the name of another Concept (line ${other.line}) — an alias is a second name for the *same* idea, so this makes '${node.name}' and '${node.alias}' one duplicated identity; merge them, or if '${node.name}' is a kind of '${node.alias}' file it under '${node.alias}' instead`);
    }
  }
  eachDuplicate(groupBy(aliased, (n) => n.alias.toLowerCase()), (dup, where, group, others) => {
    report.error(dup.line, `alias '(${dup.alias})' on '${dup.name}' is also the alias of '${others[0].name}' (lines ${where}) — an identifier must resolve to exactly one target; rename one alias`,
      { related: others.map((o) => ({ line: o.line, message: `alias '(${o.alias})' on '${o.name}'` })) });
  });

  // Example references resolve case-insensitively, so two Examples whose
  // names differ only in case are one name to every link and audit — align
  // the spelling. A warning, not an error: same-named Examples in
  // different scopes are legitimate.
  const individualsByCase = groupBy(nodes.filter((n) => n.kind === INDIVIDUAL), (n) => n.name.toLowerCase());
  for (const group of individualsByCase.values()) {
    if (new Set(group.map((n) => n.name)).size < 2) continue;
    for (const dup of group) {
      const others = group.filter((o) => o.name !== dup.name);
      if (!others.length) continue;
      report.warn(dup.line, `Example '- ${dup.name}' differs only in case from '- ${others[0].name}' (line ${others[0].line}) — Example references resolve case-insensitively, so these are one name to every link; align the spelling`,
        { related: others.map((o) => ({ line: o.line, message: `spelled '- ${o.name}' here` })) });
    }
  }

  // Ambiguity: identical siblings (same name AND same value) collapse meaning.
  // A differing alias sets them apart: `type (category)` and `type (Tag)` name
  // the same attribute but type it by different Concepts, so they are distinct.
  for (const node of all) {
    const byContent = groupBy(realChildren(node), (c) =>
      `${c.kind} ${c.name.toLowerCase()} ${String(c.value).toLowerCase()} ${(c.alias || "").toLowerCase()}`);
    eachDuplicate(byContent, (d, where, group, others) => {
      report.error(d.line, `${TYPE_NAME[d.kind]} '${d.name}' repeated under '${node.name}' with the same value (lines ${where}) — two identical siblings add nothing and blur the meaning; give them different values, or keep just one`,
        { related: others.map((o) => ({ line: o.line, message: `'${o.name}' repeated here` })) });
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
  //
  // A possessive is not a number: the 's' of `Aristotle's` marks whose the
  // idea is, not how many there are, so the possessive comes off before the
  // word is judged — `Aristotle's Ethics` is one kind, and `Farmers' Market`
  // is judged on 'Farmers' (plural) rather than on 'Farmers'' (which
  // pluralize does not recognise as a word at all). Straight and curly
  // apostrophes alike; a name is prose, and editors substitute one for the
  // other freely.
  const possessive = (word) => word.replace(/['’]s$/i, "").replace(/s['’]$/i, "s");
  const looksPlural = (name) => {
    const written = name.split(/\s+/).pop();
    const last = possessive(written);
    // the Quick Fix accepts the word as written, so either spelling counts
    if (accepted && (accepted.has(written.toLowerCase()) || accepted.has(last.toLowerCase()))) return false;
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
      .map((k) => (k.kind === DEFAULT
        ? `${k.name.toLowerCase()}:${String(k.value).toLowerCase()}`
        : k.name.toLowerCase()));
    if (c.value) slots.push(`:${String(c.value).toLowerCase()}`);
    return slots.sort().join("\0");
  };
  for (const node of all) {
    if (node.children.some((c) => c.kind === MAP)) continue;
    const subConcepts = realChildren(node).filter((c) => c.kind === CONCEPT);
    if (subConcepts.length < 2) continue;
    // no attributes (empty signature): the `...` is implied, differentia still to come
    const bySlots = groupBy(subConcepts, (c) => slotSignature(c) || null);
    eachDuplicate(bySlots, (c, where, group, others) => {
      report.warn(c.line, `'${c.name}' shares its slots with a sibling under '${node.name}' (lines ${where}) — same attributes and values, so only their order tells them apart; give each a differentia (a distinguishing attribute or value), or add a '...' Map under '${node.name}' if those differences are still to come`,
        { related: others.map((o) => ({ line: o.line, message: `'${o.name}' shares the same slots` })) });
    });
  }
}

// Full lint pass over a document's text. Returns the numbered tree along
// with errors and warnings as { line, message } (lines are 1-based).
// accepted (optional) is the user's accepted-words Set, see verify.
//
// repo (optional) is { file, others, autoReconcile } — this file's path and
// every *other* .aot in the workspace as [{ file, text, root, nodes }]. Given
// it, a Concept this file shares with another is held to one meaning and the
// disagreements that no tool may settle — one attribute carrying two values,
// one Concept filed under two kinds — are errors counted in V. Without it
// nothing cross-file is checked and V is the file's own number, exactly as
// before: a lone file, or a smoke test, is judged on its own terms.
function lint(text, rootName, accepted, repo) {
  const report = makeReport();
  const { root, nodes } = parse(text, rootName, report);
  number(root, nodes);
  verify(root, nodes, report, accepted);
  // Required lazily: subsumption.js reads KIND from this module, so a
  // top-level require would be circular (as it is for crosslinks.js). The
  // reasoner is authoritative: a Concept the definitions place elsewhere is
  // an error, counted in V, so primes only cache a hierarchy it has cleared.
  const { subsume } = require("./subsumption");
  const sub = subsume(root, nodes);
  for (const { line, message } of sub.findings) report.error(line, message);
  // Armstrong's axioms over the declared dependency graph (also a lazy
  // require — armstrong.js reads KIND from this module too). Structural like
  // the subsumption pass, so not gated on V = 0: a dependency cycle is an
  // error counted in V, a transitively implied direct edge a warning.
  const { axioms } = require("./armstrong");
  const ax = axioms(root, nodes);
  for (const { line, message } of ax.errors) report.error(line, message);
  for (const { line, message } of ax.warnings) report.warn(line, message);
  // The repo pass, when the caller supplied one (lazy for the same reason).
  // This file's own occurrences come from the tree just parsed, never from
  // the caller's index, so an unsaved edit is judged as it stands.
  if (repo && repo.file) {
    const { occurrences, findings } = require("./repo");
    const all = occurrences([
      ...(repo.others || []),
      { file: repo.file, text, root, nodes },
    ]);
    const found = findings(repo.file, all, { autoReconcile: repo.autoReconcile !== false });
    for (const f of found.errors) report.error(f.line, f.message, { related: f.related });
    for (const f of found.warnings) report.warn(f.line, f.message, { related: f.related });
  }
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
