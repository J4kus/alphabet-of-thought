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
const { writtenForm, cells: tableCells, isSeparator, isRowText, splitCell, splitConstraint, readValue, numberless, lineDerivation, defaultColon, isParentColumn, startsLower, startsUpper, startsCaseless } = require("./table");
const { bigPrimes } = require("./primes");
const { isUnit } = require("./units");

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
//
// A message says how to fix the finding first, then why it is a finding:
// `<fix> — <why>`. A rule's label (`drift:`) may stand ahead of the fix.
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

// Every prime in order, as BigInts — from the sieve primes.js keeps for the
// life of the process, so a lint no longer re-derives them one by one.
function* primes() {
  yield* bigPrimes();
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
// value is the Concept's default — `Currency: EUR` says what any attribute
// typed by Currency reads where nothing values it (crosslinks.typeDefault).
// A default is not an Example: it is no row, no CSV line, no member of the
// Concept's extension. value is null when there is no colon, and "" when the
// colon has nothing after it (an empty value, caught in parse).
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
  if (text && startsLower(text)) {
    return value !== null ? { kind: DEFAULT, name: text, value, alias } : { kind: ATTRIBUTE, name: text, value: null, alias };
  }
  // a script with no capitals has no case to say which it is, so the shape
  // does: a term with a value is an attribute's, a bare term a Concept
  if (text && value !== null && startsCaseless(text)) return { kind: DEFAULT, name: text, value, alias };
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
  // the bare `=` lines (Python that writes Concepts): no nodes of the model,
  // so they ride beside it — on the result, and on the nodes array itself,
  // so every reader already handed a parse's nodes holds them too
  const generators = [];
  const stack = [root]; // stack[d + 1] is the last node seen at depth d
  let prevDepth = -1;
  // The active table, set by a header row: { depth, attrs } where attrs[c]
  // is the ATTRIBUTE node column c + 1 was declared as (null for an empty
  // header cell). Only an unbroken run of rows at the header's depth or
  // deeper shares columns — a blank line, a line carrying no pipe, or a
  // line shallower than the header ends it.
  // rows are the table's Examples in the order written, filed under the rows
  // their parent cells name once the table is complete (refile).
  let table = null;
  // A table names its Concept in its first header cell, so one level under the
  // table is one level under the Concept: what stands there is the Concept's,
  // never the last row's. A row that needs a line of its own is written in
  // line form, where it has a line to hang one under.
  const closeTable = () => {
    if (!table) return;
    refile(table, report);
    stack.length = table.depth + 1;
    stack.push(table.owner);
    table = null;
  };
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    let content = raw;
    if (!content.trim()) {
      closeTable(); // a blank line ends a table, as in org
      return;
    }
    // only the indentation is the language's: a tab further along is a
    // character of the value, as it is in a line pasted from a spreadsheet
    const leading = /^[ \t]*/.exec(content)[0];
    if (leading.includes("\t")) {
      report.error(line, "replace the tab in the indentation with spaces — AOT indents with spaces only, four per level");
      content = leading.replace(/\t/g, " ".repeat(INDENT)) + content.slice(leading.length);
    }
    const spaces = content.length - content.replace(/^ +/, "").length;
    // A row of an open table stands at its table's depth, however far it is
    // indented: a row never nests by its indent, and a parent cell says where
    // it is filed. A row whose name cell is empty — one still being filled —
    // is padded to its name column like every other row, so its leading spaces
    // ARE that empty cell and not an indent at all. The two indent laws below
    // have nothing to say about either.
    const rowText = !isSeparator(content.trim()) && isRowText(content);
    const padded = rowText && (!((tableCells(content)[0] || {}).text)
      || (!!table && Math.floor(spaces / INDENT) >= table.depth));
    if (!padded && spaces % INDENT) {
      report.error(line, `add or remove spaces to reach a multiple of ${INDENT} — an indent of ${spaces} spaces is not a whole number of levels, and each level of nesting is exactly ${INDENT} spaces (${spaces} mod ${INDENT} = ${spaces % INDENT}, expected 0)`);
    }
    let depth = !padded ? Math.floor(spaces / INDENT)
      : table ? table.depth
      : Math.min(Math.floor(spaces / INDENT), prevDepth + 1);
    if (!padded && depth - prevDepth > 1) {
      report.error(line, `indent this line to depth ${prevDepth + 1} — depth jump ${prevDepth} -> ${depth}: it is ${depth - prevDepth} levels deeper than the line above, but a child sits exactly one level under its parent, and there is no line at depth ${depth - 1} to be its parent`);
      depth = prevDepth + 1;
    }
    let trimmed = content.trim();
    // a '----|----' divider groups a table's rows, as a blank line groups an
    // outline's: it is presentation, so it is skipped without ending the table
    if (isSeparator(trimmed)) return;
    const marker = trimmed[0];
    // a row carries a '|' between its cells, and only a shallower line ends
    // the table
    const isRow = isRowText(trimmed);
    // A '...' Map under a table is the Concept's like every other line there
    // (closeTable), and it is where a reader already reads it: '... 4 more in
    // other.aot:12' says what the grid is missing, never what its last row is
    // missing. It alone leaves the table open, so more rows may follow it.
    //
    // One level with the rows it is the same: the line Ctrl+/ makes of a row
    // (`... Rail|20`). It is out of the model and the table goes on past it,
    // as it does past a divider.
    const tableMap = !!table && !isRow && depth >= table.depth && trimmed.startsWith("...");
    if (table && !tableMap && (!isRow || depth < table.depth)) closeTable();
    // A derivation with nothing before its '=' — `=load_all()` on a line of
    // its own — writes Concepts: its Python returns tables by name, and each
    // lands as a Concept (python.js writeGenerated). The line itself is no
    // idea of the model's, so it is no node: it is recorded apart, with the
    // node it is filed under, and the tree goes on as though it were not
    // there. A bound on a line of its own holds nothing — it needs the
    // attribute it bounds.
    if (/^=(?!=)/.test(trimmed)) {
      const formula = trimmed.slice(1).trim();
      if (!formula) {
        report.error(line, "write the expression, or remove the line — '=' stands alone, and a derivation on a line of its own is the Python that writes Concepts",
          { startCol: spaces, endCol: spaces + trimmed.length });
      }
      generators.push({
        line, depth, formula, col: spaces, end: spaces + trimmed.length,
        parent: stack[Math.min(depth, stack.length - 1)],
      });
      return;
    }
    if (trimmed.startsWith("==")) {
      report.error(line, `put the attribute's name in front of '${trimmed}', as in 'status =("draft", "sent")' — it is a bound with no attribute, and a bound holds the values of the attribute it is written on`,
        { startCol: spaces, endCol: spaces + trimmed.length });
      return;
    }
    // a dash Example needs its space ('- '); rows carry no gutter
    // spaces, so a cell may start right after its '|'
    if (!isRow && marker === "-" && !trimmed.startsWith("- ")) {
      report.error(line, `add the missing space after the '-' — '${trimmed}' has 0 spaces after '-', expected 1, and an Example begins with a dash then a space ('- ')`);
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
        table = { depth, attrs: [], rows: [] };
        // the header names the Concept the whole table describes, so it is
        // the table's own line: its indent IS the table's
        let cName = row.length ? row[0].text : "", cAlias = null, cAliasCol;
        // the Concept's own derivation rides in its first cell once its
        // Python has written the table — `Quarter =quarters()|units|…` —
        // exactly as it rode on the Concept's line before: off the name
        let headDerivation = null;
        {
          const d = lineDerivation(cName);
          if (d) {
            headDerivation = { formula: d.formula, col: row[0].col + d.eq, end: row[0].col + row[0].text.length };
            cName = d.head;
          }
        }
        // the first cell may state the Concept's default, as the Concept's
        // own line would: `Currency: EUR|symbol` (table.isRowText lets a
        // capitalised colon through)
        let cDefault = null, cDefaultCol;
        {
          const colon = cName.indexOf(":");
          if (colon !== -1 && row.length) {
            const after = cName.slice(colon + 1);
            const written = after.trim();
            const split = splitCell(written);
            cDefaultCol = row[0].col + colon + 1 + (after.length - after.trimStart().length);
            if (!written) {
              report.error(line, `write the Concept's default, or drop the colon — '${cName}' has 0 characters after ':', expected the Concept's default`,
                { startCol: row[0].col, endCol: row[0].col + row[0].text.length });
            } else if (split.eq !== -1) {
              report.error(line, `write the value, or double a literal '=' (==) — '${cName}' derives the Concept's default, and a default is stated, not derived`,
                { startCol: cDefaultCol + split.eq, endCol: cDefaultCol + written.length });
            }
            cDefault = written ? readValue(split.eq !== -1 ? split.value : written) || null : null;
            cName = cName.slice(0, colon).trim();
          }
        }
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
          report.error(line, "write the Concept's name in the table's first header cell — it is empty, expected the Concept the table describes: the first cell names the Concept whose Examples the rows are",
            row.length ? { startCol: row[0].col, endCol: row[0].col + Math.max(row[0].text.length, 1) } : undefined);
        } else if (sameAsParent) {
          owner = parent; // the table fills in the line it is filed under
          // its default with it — one Concept, one default
          if (cDefault !== null) {
            if (parent.value && String(parent.value).toLowerCase() !== String(cDefault).toLowerCase()) {
              report.error(line, `keep one default for '${cName}' — it states two defaults: '${parent.value}' on its line (line ${parent.line}) and '${cDefault}' in its table's header`,
                { startCol: row[0].col, endCol: row[0].col + row[0].text.length, related: [{ line: parent.line, message: `'${cName}' says '${parent.value}' here` }] });
            } else if (!parent.value) {
              parent.value = cDefault;
              parent.valueCol = cDefaultCol;
            }
          }
        } else if (startsLower(cName)) {
          // (a 'name: value' line whose value holds a pipe never reaches
          // here: the colon before its first pipe keeps it a line —
          // table.isRowText)
          report.error(line, `write the Concept's name in the first header cell, capitalised — the first header cell '${cName}' is lowercase, and it names the Concept the table describes (the old 'name' label was dropped in 1.9)`,
            { startCol: row[0].col, endCol: row[0].col + row[0].text.length });
        } else {
          const concept = {
            line, depth, kind: CONCEPT, name: cName, value: cDefault,
            alias: cAlias, aliasCol: cAliasCol, parent, children: [], nameCol: row[0].col, cell: true,
          };
          if (cDefault !== null) concept.valueCol = cDefaultCol;
          parent.children.push(concept);
          nodes.push(concept);
          owner = concept;
        }
        if (headDerivation && owner && owner.kind === CONCEPT && owner.formula === undefined) {
          owner.formula = headDerivation.formula;
          owner.op = "=";
          owner.formulaCol = headDerivation.col;
          owner.formulaEnd = headDerivation.end;
          if (!headDerivation.formula) {
            report.error(line, `write the expression, or remove the '=' — '${cName} =' has nothing after '=', and a derivation on a Concept is the Python that writes its table`,
              { startCol: headDerivation.col, endCol: headDerivation.end });
          }
        }
        table.owner = owner;
        let last = null;
        // `parent (thing)` is no attribute but the table's own structure:
        // each row's cell under it names the row that row sits under
        const owners = [owner.name, owner.alias];
        const structural = (cell, alias, aliasCol) => {
          if (table.attrs.some((a) => a && a.structural)) {
            report.error(line, `remove this column — it is a second '${cell.text}' column, and a table names each row's parent in one column`,
              { startCol: cell.col, endCol: cell.col + cell.text.length });
            table.attrs.push(null);
            return;
          }
          const col = { structural: true, line, nameCol: cell.col, alias, aliasCol };
          (owner.parentColumns || (owner.parentColumns = [])).push(col);
          table.attrs.push(col);
        };
        for (const cell of row.slice(1)) {
          // a cell with a colon states the column's default, exactly the line
          // that would state it under the Concept — `tax rate: 0.2` — so an
          // empty cell below inherits it as a silent Example does. It is the
          // Concept's own value, as that line is (not a cell's: no grid row
          // holds it), and a default is stated, not derived, in a header.
          const colon = defaultColon(cell.text);
          if (colon !== -1) {
            let dName = cell.text.slice(0, colon).trim(), dAlias = null, dAliasCol;
            const after = cell.text.slice(colon + 1);
            const written = after.trim();
            const split = splitCell(written);
            const valueCol = cell.col + colon + 1 + (after.length - after.trimStart().length);
            if (dName.endsWith(")") && dName.includes("(")) {
              const open = dName.lastIndexOf("(");
              const inner = dName.slice(open + 1, -1);
              dAlias = inner.trim() || null;
              if (dAlias) dAliasCol = cell.col + open + 1 + (inner.length - inner.trimStart().length);
              dName = dName.slice(0, open).trim();
            }
            if (!dName) { table.attrs.push(null); continue; }
            if (isParentColumn(dName, dAlias, owners)) {
              report.error(line, `drop the ':' and what follows it — '${cell.text}' gives the parent column a default, but the column names the row each row sits under, so a row naming none is a row of '${owner.name}' itself`,
                { startCol: cell.col + colon, endCol: cell.col + cell.text.length });
              structural(cell, dAlias, dAliasCol);
              continue;
            }
            if (startsUpper(dName)) {
              report.error(line, `lowercase column '${dName}' — it is capitalised, but a table column names an attribute of '${owner.name}', and attributes are lowercase`,
                { startCol: cell.col, endCol: cell.col + cell.text.length });
            }
            if (!written) {
              report.error(line, `write the column's default, or drop the colon to leave '${dName}' a plain column — '${cell.text}' has 0 characters after ':', expected the column's default`,
                { startCol: cell.col, endCol: cell.col + cell.text.length });
            } else if (split.eq !== -1) {
              report.error(line, `write the value, or put the derivation on the Concept's own line ('${dName}: =…') — '${cell.text}' derives the column's default, and a default in a header is stated, not derived`,
                { startCol: valueCol + split.eq, endCol: valueCol + written.length });
            }
            const def = {
              line, depth, kind: DEFAULT, name: dName, value: readValue(split.eq !== -1 ? split.value : written),
              alias: dAlias, aliasCol: dAliasCol, parent: owner, children: [], nameCol: cell.col, valueCol, header: true,
            };
            owner.children.push(def);
            nodes.push(def);
            table.attrs.push(def);
            last = def;
            continue;
          }
          // a header cell is an attribute term, so it may carry a trailing
          // (alias) and trailing constraints (`qty >=1`, chained as
          // `age >=18 <=65`, or the column's definition `vat =@price*0.2`)
          // exactly as the bare line form does — each constraint bounds the
          // whole column
          let name = cell.text, alias = null, aliasCol, constraints = null;
          const con = splitConstraint(name);
          if (con.eq !== -1) {
            constraints = con.constraints.map((b) => ({ op: b.op, opText: b.opText, formula: b.formula, opCol: cell.col + b.eq }));
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
          if (isParentColumn(name, alias, owners)) {
            if (constraints) {
              report.error(line, `drop the '${constraints[0].opText}' and what follows it — '${cell.text}' bounds the parent column, but the column names the row each row sits under, and holds nothing to bound or define`,
                { startCol: constraints[0].opCol, endCol: cell.col + cell.text.length });
            }
            structural(cell, alias, aliasCol);
            continue;
          }
          if (startsUpper(name)) {
            report.error(line, `lowercase column '${name}' — it is capitalised, but a table column names an attribute of '${owner.name}', and attributes are lowercase`,
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
          report.error(line, "write the Example's name in the row's first cell — the table row has an empty first cell, and the first column names the Example the row describes",
            { startCol: row[0].col, endCol: row[0].col + 1 });
        }
        if (row.length - 1 > table.attrs.length) {
          const first = row[table.attrs.length + 1];
          const lastCell = row[row.length - 1];
          report.error(line, `remove the extra cells, or add columns to the header — the table row has ${row.length} cells but the header names ${table.attrs.length + 1} columns`,
            { startCol: first.col, endCol: lastCell.col + Math.max(lastCell.text.length, 1) });
        }
        // A table never nests by indentation: a row that sits under another
        // names it in the `parent (thing)` column, and is filed there once the
        // table is complete (refile).
        const example = {
          line, depth, kind: INDIVIDUAL, name: row[0].text, value: null,
          alias: null, parent: table.owner, children: [], nameCol: row[0].col,
        };
        table.owner.children.push(example);
        nodes.push(example);
        table.rows.push(example);
        for (let c = 1; c < row.length && c <= table.attrs.length; c++) {
          const attr = table.attrs[c - 1];
          // the parent cell is structure: it names a row, and holds no value
          if (attr && attr.structural) {
            if (row[c].text) example.parentCell = { text: row[c].text, col: row[c].col };
            continue;
          }
          // a formula ('10 =$1+10') derives the value: only the value part
          // is the Attribute Value; the formula itself is presentation,
          // audited and coloured by the editor, invisible to the model
          const { value, eq } = splitCell(row[c].text);
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
          // a value its own derivation computed: a fact of this row's, never
          // one to lift onto the Concept (godel.hoists)
          if (eq !== -1) cellValue.derived = true;
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
    // every value the attribute takes (checked by derive.js), several may
    // chain on the one declaration (`age >=18 <=65`), and `=` defines them:
    // `vat =@price*0.2` is what every value of vat is. The head must be a
    // colon-less lowercase term, so `age: 25 >=18` (a value) and Concepts
    // are left whole.
    let constraints = null;
    {
      const con = splitConstraint(trimmed);
      const head = con.eq === -1 ? "" : con.value;
      if (head && !head.includes(":") && (startsLower(head) || startsCaseless(head))) {
        constraints = con.constraints.map((b) => ({ op: b.op, opText: b.opText, formula: b.formula, opCol: spaces + b.eq }));
        trimmed = head;
      }
    }
    // A derivation on a line that carries no value. On a Concept it is the
    // Python that writes the Concept's table — `Sales =by_month(@raw)` — and
    // it comes off the line before the line is classified, so the Concept is
    // named `Sales` everywhere it is read (and a colon inside the Python,
    // `Sales =df[:10]`, never becomes an inline Example). On a bare
    // attribute an `=` whose Python reads as an expression was a definition
    // above; one that reaches here does not read as one, so it defines
    // nothing and says so.
    let derivation = null;
    if (!constraints) {
      const d = lineDerivation(trimmed);
      if (d) {
        derivation = { formula: d.formula, col: spaces + d.eq, end: spaces + trimmed.length };
        trimmed = d.head;
      }
    }
    const read = classify(trimmed);
    const { name, value, alias } = read;
    // a bound holds an attribute's values, so in a script with no capitals it
    // is what says the term is one
    const kind = constraints && read.kind === CONCEPT && startsCaseless(name) ? ATTRIBUTE : read.kind;
    if (derivation && kind !== CONCEPT) {
      report.error(line, derivation.formula
        ? `write the definition as Python, or add a colon to make it the value's own derivation: '${name}: =${derivation.formula}' — '${name} =${derivation.formula}' does not read as Python, so it defines nothing; on an attribute, '=' defines every value it takes ('${name} =@price*0.2')`
        : `write the definition, or remove the '=' — '${name} =' has nothing after '=', and on an attribute, '=' defines every value it takes`,
        { startCol: derivation.col, endCol: derivation.end });
    } else if (derivation && !derivation.formula) {
      report.error(line, `write the expression, or remove the '=' — '${name} =' has nothing after '=', and a derivation on a Concept is the Python that writes its table`,
        { startCol: derivation.col, endCol: derivation.end });
    }
    if (value === "") {
      report.error(line, `add the value, or drop the colon to leave '${name}' as a bare attribute — '${name}:' has 0 characters after ':', expected a value, and a colon assigns a value (as in 'colour: red')`);
    }
    const parent = tableMap ? table.owner : stack[Math.min(depth, stack.length - 1)];
    const node = { line, depth, kind, name, value, alias: alias || null, parent, children: [] };
    if (constraints && kind === ATTRIBUTE) node.constraints = constraints;
    // the Concept's derivation, kept off its name: the model never sees it,
    // exactly as it never sees a value's formula
    if (derivation && kind === CONCEPT) {
      node.formula = derivation.formula;
      node.op = "=";
      node.formulaCol = derivation.col;
      node.formulaEnd = derivation.end;
    }
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
    // A capitalised line with a colon states the Concept's default, read as
    // any value is (a doubled '=' is one). A default is stated, not derived,
    // so far: an '=' that would open a derivation here is an error rather
    // than a guess, which leaves the spelling free for a later release.
    if (kind === CONCEPT && value) {
      const split = splitCell(value);
      if (split.eq !== -1) {
        const at = raw.indexOf(value, raw.indexOf(":") + 1);
        report.error(line, `write the value, or double a literal '=' (==) — '${name}: ${value}' derives the Concept's default, and a default is stated, not derived`,
          at === -1 ? undefined : { startCol: at + split.eq, endCol: at + value.length });
      }
      node.value = readValue(split.eq !== -1 ? split.value : value);
    }
    parent.children.push(node);
    nodes.push(node);
    stack.length = depth + 1;
    stack.push(node);
    prevDepth = depth;
  });
  closeTable(); // the last table ends with the file
  Object.defineProperty(nodes, "generators", { value: generators, enumerable: false });
  return { root, nodes, generators };
}

// A complete table's rows, filed under the rows their parent cells name.
// A cell names the nearest row ABOVE it of that name (numbering and case
// aside), else the first one below — a parent may be written after its
// child, as a sort leaves it — and never the row itself, so a child named
// like its parent is still filed under it and meets the whole-and-part rule
// as it would in line form. A name no row carries, a row naming itself and a
// chain of parents that comes back round are errors; each such row stays a
// row of the table's own Concept. The tree that comes out is the one the
// same Examples written as nested '- ' lines parse to.
function refile(table, report) {
  const rows = table.rows;
  if (!rows.some((r) => r.parentCell)) return;
  const keyOf = (name) => numberless(name).trim().toLowerCase();
  const spanOf = (row) => ({ startCol: row.parentCell.col, endCol: row.parentCell.col + row.parentCell.text.length });
  const want = new Map(); // row -> the row its cell names
  rows.forEach((row, i) => {
    const cell = row.parentCell;
    if (!cell) return;
    const key = keyOf(cell.text);
    let target = null;
    for (let j = i - 1; j >= 0 && !target; j--) if (keyOf(rows[j].name) === key) target = rows[j];
    for (let j = i + 1; j < rows.length && !target; j++) if (keyOf(rows[j].name) === key) target = rows[j];
    if (target) { want.set(row, target); return; }
    report.error(row.line, keyOf(row.name) === key
      ? `name the row it sits under, or empty the cell to make it a row of '${table.owner.name}' itself — '${row.name}' names itself as its parent, and a row cannot sit under itself`
      : `name one of the table's rows, or empty the cell to make '${row.name}' a row of '${table.owner.name}' itself — '${row.name}' names '${cell.text}' as its parent, but no row of this table is called '${cell.text}', and a parent cell names the row this one sits under`,
    spanOf(row));
  });
  // a circle of parents has no top, so no row in it has a place in the tree
  const cyclic = new Set();
  for (const start of want.keys()) {
    const path = [], onPath = new Set();
    let p = start;
    while (want.has(p) && !onPath.has(p) && !cyclic.has(p)) { onPath.add(p); path.push(p); p = want.get(p); }
    if (!onPath.has(p)) continue;
    const loop = path.slice(path.indexOf(p));
    const round = [...loop, p].map((r) => `'${r.name}'`).join(" → ");
    for (const r of loop) {
      cyclic.add(r);
      report.error(r.line, `empty one of these parent cells to break the circle — '${r.name}' sits under a row that sits under it: the parent cells go round in a circle (${round}), so none of these rows has a place in the tree`,
        { ...spanOf(r), related: loop.filter((o) => o !== r).map((o) => ({ line: o.line, message: `'${o.name}' names '${o.parentCell.text}'` })) });
    }
  }
  for (const r of cyclic) want.delete(r);
  for (const [row, target] of want) {
    const from = row.parent.children;
    from.splice(from.indexOf(row), 1);
    target.children.push(row);
    row.parent = target;
    row.parentCell.row = target;
  }
}

// Assign primes and characteristic numbers: chi = prime * chi(parent). The
// primes go out in the order the file is written; a row filed under a parent
// written below it (refile) takes its chi once its parent has one.
function number(root, nodes) {
  const gen = primes();
  root.prime = gen.next().value;
  root.chi = root.prime;
  for (const node of nodes) node.prime = gen.next().value;
  const done = new Set([root]);
  const chiOf = (n) => {
    if (!done.has(n)) { n.chi = n.prime * chiOf(n.parent); done.add(n); }
    return n.chi;
  };
  for (const node of nodes) chiOf(node);
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
      report.error(child.line, `start with the children of '${child.name}' rather than naming it again — it repeats the file name, and the file name is already the root Concept of the tree (2 primes for the root, expected 1)`);
    }
  }

  // Maps mark omitted information; they explain a node, so under a Map
  // only further Maps may appear, never real content
  for (const node of nodes) {
    if (node.kind === MAP) {
      const content = realChildren(node);
      if (content.length) {
        report.error(node.line, `move those lines out from under it, or remove the '...' — Map '... ${node.name}' has ${content.length} non-Map children, expected 0, and a '...' Map marks what is missing or still to come, so it cannot hold real content`);
      }
    }
  }

  // A Concept names one kind; 'and' joins two
  for (const node of nodes) {
    if (node.kind === CONCEPT && /\band\b/i.test(node.name)) {
      report.error(node.line, `split '${node.name}' into two Concepts — Concept '${node.name}' contains 'and', and 'and' names two kinds at once, but a Concept must name exactly one (2 kinds under 1 prime, expected 1)`);
    }
  }

  // Univocity: one Concept name, one prime. References resolve
  // case-insensitively and numbering prefixes are presentation, so 'Foo',
  // 'FOO' and '2. Foo' are all one name here.
  const concepts = nodes.filter((n) => n.kind === CONCEPT);
  eachDuplicate(groupBy(concepts, (n) => numberless(n.name).toLowerCase()), (dup, where, defs, others) => {
    const caseNote = new Set(defs.map((d) => numberless(d.name))).size > 1
      ? " (names differ only in case — references resolve case-insensitively, so they are one name)" : "";
    report.error(dup.line, `give all but one '${dup.name}' a distinguishing qualifier, or merge them — Concept '${dup.name}' defined ${defs.length} times (lines ${where})${caseNote}: one name must mean one kind, but this name labels ${defs.length} different ones (${defs.length} definitions for one term, expected 1)`,
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
      report.error(node.line, `drop the alias, or make it a genuinely different name — alias '(${node.alias})' on '${node.name}' repeats the Concept's own name, and an alias is a second name, so this one renames nothing`);
      continue;
    }
    const other = conceptByName.get(low);
    if (other && other !== node) {
      report.error(node.line, `merge '${node.name}' and '${node.alias}', or if '${node.name}' is a kind of '${node.alias}' file it under '${node.alias}' instead — alias '(${node.alias})' on '${node.name}' is the name of another Concept (line ${other.line}), and an alias is a second name for the *same* idea, so this makes them one duplicated identity`);
    }
  }
  eachDuplicate(groupBy(aliased, (n) => n.alias.toLowerCase()), (dup, where, group, others) => {
    report.error(dup.line, `rename one alias — alias '(${dup.alias})' on '${dup.name}' is also the alias of '${others[0].name}' (lines ${where}), and an identifier must resolve to exactly one target`,
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
      report.warn(dup.line, `align the spelling — Example '- ${dup.name}' differs only in case from '- ${others[0].name}' (line ${others[0].line}), and Example references resolve case-insensitively, so these are one name to every link`,
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
      // an Example holds no value of its own to differ by: its name is what is repeated
      if (d.kind === INDIVIDUAL) {
        report.error(d.line, `rename one, or keep just one — Example '${d.name}' is written ${group.length} times under '${node.name}' (lines ${where}), and one name is one Example, so nothing can say which of them is meant`,
          { related: others.map((o) => ({ line: o.line, message: `'${o.name}' repeated here` })) });
        return;
      }
      report.error(d.line, `give each '${d.name}' a different value, or keep just one — ${TYPE_NAME[d.kind]} '${d.name}' repeated under '${node.name}' with the same value (lines ${where}): two identical siblings add nothing and blur the meaning`,
        { related: others.map((o) => ({ line: o.line, message: `'${o.name}' repeated here` })) });
    });
  }

  // One attribute may hold several texts (`tag: a`, `tag: b`), but a number is one
  // number: `discount: 10%` and `discount: 15%` on one Example contradict each
  // other. A value counts when it reads as a plain number, or one with a unit Alpha
  // knows, so `film: 12 Monkeys` and `film: 3 Idiots` are two texts.
  for (const node of all) {
    const byName = groupBy(realChildren(node).filter((c) => c.kind === DEFAULT && !c.header && c.value), (c) => c.name.toLowerCase());
    for (const group of byName.values()) {
      if (group.length < 2) continue;
      const numbers = group.filter((c) => {
        const form = writtenForm(c.value);
        return form.number && (!form.unit || isUnit(form.unit));
      });
      const said = new Set(numbers.map((c) => String(c.value).trim().toLowerCase()));
      if (numbers.length < 2 || said.size < 2) continue;
      const shown = [...new Set(numbers.map((c) => `'${c.value}'`))].join(" and ");
      for (const c of numbers) {
        report.error(c.line, `keep the one that is right — '${node.name}' sets '${c.name}' to ${shown} (lines ${numbers.map((o) => o.line).join(", ")}), and a number has one value`,
          { related: numbers.filter((o) => o !== c).map((o) => ({ line: o.line, message: `'${o.name}' is '${o.value}' here` })) });
      }
    }
  }

  // A sub-Example is a part, or a finer instance, of the Example it sits
  // under — so it cannot carry that Example's own name: one name would be
  // both the whole and its part, and every path through the tree that names
  // it (`@Order@total@X@X`, the CSV mirror's `parent` column naming its own
  // row) would say nothing. Checked against every Example up the chain, in
  // `- ` lines and nested table rows alike; numbering is presentation.
  for (const node of nodes) {
    if (node.kind !== INDIVIDUAL || !node.name) continue;
    const key = numberless(node.name).trim().toLowerCase();
    for (let p = node.parent; p && p.kind === INDIVIDUAL; p = p.parent) {
      if (numberless(p.name).trim().toLowerCase() !== key) continue;
      const cell = node.nameCol !== undefined ? { startCol: node.nameCol, endCol: node.nameCol + node.name.length } : {};
      report.error(node.line, `rename one of them — Example '- ${node.name}' has the same name as the Example it sits under ('- ${p.name}', line ${p.line}), and one name cannot be both the whole and its part`,
        { ...cell, related: [{ line: p.line, message: `'- ${p.name}' is the Example it sits under` }] });
      break;
    }
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
      report.warn(node.line, `use the singular form (e.g. 'Person', not 'People') — Concept '${node.name}' appears plural, and a Concept names one kind, not a set of them`);
    }
  }

  // Every measurement carries both a target and an actual value
  for (const node of all) {
    const defs = node.children.filter((c) => c.kind === DEFAULT);
    const actual = defs.find((c) => c.name === "actual");
    const target = defs.find((c) => c.name === "target");
    if (actual && !target) {
      report.warn(actual.line, `add a 'target', or remove 'actual' — '${node.name}' has 'actual' without 'target', and a measurement needs both: an 'actual' is a reading with nothing to judge it against`);
    }
    if (target && !actual) {
      report.warn(target.line, `add an 'actual', or remove 'target' — '${node.name}' has 'target' without 'actual', and a measurement needs both: a 'target' is a goal with no reading yet to compare`);
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
      report.warn(node.line, `gather related sub-Concepts under an in-between kind — '${node.name}' has ${subConcepts} sub-Concepts, more than the eight a reader can take in at a glance (Examples and attributes may be any number)`);
    }
    if (node.children.some((c) => c.kind === MAP)) continue;
    if (node.kind === CONCEPT && subConcepts === 1) {
      report.warn(node.line, `add a sibling subtype, or merge the two — '${node.name}' has 1 sub-Concept, expected 0 or more than one: a single subtype divides nothing (the parent simply is that subtype)`);
    }
    if (node.kind === INDIVIDUAL && kids.filter((c) => c.kind === INDIVIDUAL).length === 1) {
      report.warn(node.line, `add another sub-Example, or merge the two — '${node.name}' has 1 sub-Example, expected 0 or more than one: a single sub-Example breaks nothing down (the parent simply is that sub-Example)`);
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
      report.warn(c.line, `give each a differentia (a distinguishing attribute or value), or add a '...' Map under '${node.name}' if those differences are still to come — '${c.name}' shares its slots with a sibling under '${node.name}' (lines ${where}): same attributes and values, so only their order tells them apart`,
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
  const { root, nodes, generators } = parse(text, rootName, report);
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
    root, nodes, generators,
    errors: report.errors.sort(byLine),
    warnings: report.warnings.sort(byLine),
    subsumption: { edges: sub.edges, consistent: sub.findings.length === 0 },
  };
}

module.exports = {
  lint, parse, number, verify, gcd, primes, INDENT,
  KIND: { INDIVIDUAL, DEFAULT, CONCEPT, ATTRIBUTE, MAP },
};
