// Crosslink resolution for .aot documents: the four inline connections.
//
//   attribute-is-a-Concept   an attribute's (or default's) trailing words
//                            match a Concept name, case-insensitively:
//                            `age integer: 5` links to the `Integer` Concept
//   default-is-a-Example  a default value names an Example of the Concept
//                            its attribute is typed by (attribute-is-a-Concept,
//                            through the alias when it carries one),
//                            case-insensitively:
//                            `person: socrates` links to the `Person` Concept's
//                            `- Socrates`. Only Examples of a Concept are
//                            linkable: the Examples listed beneath an attribute
//                            are that frame's own, and no value reaches them.
//   example-is-a-Example  an Example listed under an attribute that names
//                            a Concept (attribute-is-a-Concept) matches an
//                            Example of that Concept: `shade hue` typed by
//                            `Hue` with `- Crimson` beneath links that
//                            `- Crimson` to the `Hue` Concept's `- Crimson`.
//                            The listed form of `shade hue: Crimson`, so it
//                            links the same way the value does.
//   concept-contains-Concept a Concept's name contains a run of words that
//                            names another Concept, case-insensitively:
//                            `Independent Node` links its `Node` to the
//                            `Node` Concept. Longest, non-overlapping runs
//                            win; the whole name never links (that is the
//                            node itself, or a univocity duplicate).
//   alias-is-a-Concept       a Concept's parenthetical alias names another
//                            Concept, case-insensitively: `Auto (Car)` links
//                            its `Car` to the `Car` Concept. An attribute's
//                            alias links the same way, as part of
//                            attribute-is-a-Concept.
//
// An alias is an explicit alternative name, so it also *resolves*: a
// Concept's alias is indexed beside its name, and anything that would link
// to the name links to the alias too — `type: ...` is typed by the Concept
// `Category (Type)` just as it would be by a Concept named `Type`. A real
// name always outranks an alias.
//
// Works from the tree the linter parses; shared by the VS Code extension
// (link decorations + go-to-definition).

const { KIND } = require("./linter");
const { valueType, numberless, splitCell } = require("./table"); // a leaf module; no cycle
const { isUnit } = require("./units");

// How many characters a value takes on its line — escapes and all, so a
// doubled `==` counts twice — from `start`, where the value begins. A
// table cell ends at its divider (a literal pipe in a cell is `¦`); a
// line-form value runs to its derivation or its end.
function writtenLength(raw, start, node) {
  let text = raw.slice(start);
  if (node.cell) text = text.split("|")[0];
  return splitCell(text.trim()).value.length || node.value.length;
}

// Start offset of every word in a name, so a matched trailing run of
// words maps back to the exact characters on the line.
function wordStarts(name) {
  const starts = [];
  const re = /\S+/g;
  for (let m; (m = re.exec(name)); ) starts.push(m.index);
  return starts;
}

// Start and end offset of every word, so a matched run of words maps back
// to the exact characters on the line.
function words(name) {
  const out = [];
  const re = /\S+/g;
  for (let m; (m = re.exec(name)); ) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

// Each longest, non-overlapping run of words in `text` — a Concept's name, or
// its alias — that names another Concept (or another Concept's alias, which
// resolves as its name does), scanned left to right: { start, end, span,
// target }. The whole text is never a run: it names `node` itself, or is an
// alias whose whole match is a link of its own. Navigation only — it makes
// no dependency, and no kind of one Concept another's.
function containedConcepts(text, node, concepts) {
  const out = [];
  const ws = words(text);
  for (let i = 0; i < ws.length; ) {
    let matched = false;
    for (let j = ws.length - 1; j >= i; j--) {
      if (i === 0 && j === ws.length - 1) continue;
      const span = text.slice(ws[i].start, ws[j].end);
      const target = concepts.get(span.toLowerCase());
      if (target && target !== node) {
        out.push({ start: ws[i].start, end: ws[j].end, span, target });
        i = j + 1;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return out;
}

// The defining node for every linkable name, both by lowercased name —
// every link kind resolves case-insensitively, so `person: socrates`
// finds `- Socrates` just as `age integer` finds `Integer`.
function index(root, nodes) {
  const concepts = new Map(); // lowercased name -> defining node
  const individuals = new Map(); // lowercased name -> defining node
  // a numbering prefix (`1. Trip`) is presentation: the name resolves with
  // and without it, so `trip` still types by `1. Trip`
  const put = (map, name, node) => {
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, node);
    const plain = numberless(name).toLowerCase();
    if (plain && !map.has(plain)) map.set(plain, node);
  };
  put(concepts, root.name, root);
  for (const node of nodes) {
    if (node.kind === KIND.CONCEPT) put(concepts, node.name, node);
    if (node.kind === KIND.INDIVIDUAL) put(individuals, node.name, node);
  }
  // a Concept's alias is an alternative name for it, so it resolves wherever
  // the name would; registered after the names so a real name always wins
  for (const node of nodes) {
    if (node.kind === KIND.CONCEPT && node.alias) put(concepts, node.alias, node);
  }
  return { concepts, individuals };
}

// The Concept an attribute (or default) names — the attribute-is-a-Concept
// target. An alias is exclusive: when the attribute carries one, only the
// alias types it (`type (category)` is typed by `Category`, never by any
// run of 'type'). Otherwise the longest trailing run of the name wins:
// `shade hue` names `Hue`. null when nothing names a Concept.
function conceptType(node, concepts) {
  if (node.alias) {
    const target = concepts.get(node.alias.toLowerCase());
    return target && target !== node ? target : null;
  }
  for (const start of wordStarts(node.name)) {
    const target = concepts.get(node.name.slice(start).toLowerCase());
    if (target && target !== node) return target;
  }
  return null;
}

// The default an attribute takes from the Concept that types it: `Currency:
// EUR` is what a `currency` reads wherever nothing values it — its own
// Example, the Concept above, the kinds above that. { concept, value }, or
// null when the type states no default (or nothing types the attribute).
function typeDefault(node, concepts) {
  const type = conceptType(node, concepts);
  return type && type.value != null && String(type.value) !== "" ? { concept: type, value: type.value } : null;
}

// The same, for a node alone: the file's Concepts found from its root once
// and kept, for the walks that hold a node but no index — a formula's
// context, a Concept's scope, the CSV mirror. A type written in another
// file is not followed here: a default holds in the file that states it.
const conceptsByRoot = new WeakMap();
function fileConcepts(node) {
  let root = node;
  while (root.parent) root = root.parent;
  let concepts = conceptsByRoot.get(root);
  if (!concepts) {
    const all = [];
    const walk = (n) => { for (const c of n.children || []) { all.push(c); walk(c); } };
    walk(root);
    concepts = index(root, all).concepts;
    conceptsByRoot.set(root, concepts);
  }
  return concepts;
}
function typeDefaultOf(node) {
  return node ? typeDefault(node, fileConcepts(node)) : null;
}

// --- units ------------------------------------------------------------------
// `distance (km)` is an attribute typed through its alias, as `type (category)`
// is: `km` is a Concept every file has, in the built-in hierarchy of units
// (units.js). The file's own Concept of that name wins, as its own names always
// do, and is a unit when it is filed under a Concept called Unit: that is how a
// file adds one of its own. An alias naming neither is only another name.

// The unit an alias names, as written, in the file `node` stands in; else null.
function unitNamed(alias, node) {
  if (!alias) return null;
  const own = node ? fileConcepts(node).get(String(alias).toLowerCase()) : null;
  if (own) {
    for (let p = own; p; p = p.parent) if (numberless(p.name).toLowerCase() === "unit") return alias;
    return null;
  }
  return isUnit(alias) ? alias : null;
}

// Each owner's aliases by attribute name, worked out once for the parse: a Concept
// with thousands of rows is not walked again for every value read under it.
const aliasesByOwner = new WeakMap();
function aliasesOn(owner) {
  let found = aliasesByOwner.get(owner);
  if (!found) {
    found = new Map();
    for (const c of owner.children || []) {
      if ((c.kind === KIND.ATTRIBUTE || c.kind === KIND.DEFAULT) && c.alias && !found.has(c.name.toLowerCase())) {
        found.set(c.name.toLowerCase(), c.alias);
      }
    }
    aliasesByOwner.set(owner, found);
  }
  return found;
}

// The unit an attribute or a value is in: its own alias, else the nearest
// declaration of that name above it. `distance: 120` under a Concept declaring
// `distance (km)` is in km. Null when no alias on the way names a unit.
function unitOf(node) {
  if (!node || !node.name) return null;
  const own = node.alias ? unitNamed(node.alias, node) : null;
  if (own) return own;
  const key = node.name.toLowerCase();
  for (let p = node.parent; p; p = p.parent) {
    const alias = aliasesOn(p).get(key);
    if (alias) {
      const unit = unitNamed(alias, p);
      if (unit) return unit;
    }
  }
  return null;
}

// Whether an Example is one of a Concept's own — an Example *of the Concept*,
// not of some attribute. The walk up from it to the named Concept may pass
// through Examples and narrower Concepts only: `- Crimson` under `- Red` under
// `Hue` is a Hue. An attribute on the way stops the walk, because the Examples
// listed beneath an attribute are that attribute's own vocabulary, in that
// frame — the `- Ellipsis` under one frame's `allow special value override` is
// not a value another frame's attribute may name. Matched by name (with an
// alias, and past a numbering prefix) so a Concept and its Examples may live
// in different files.
function exampleOfConcept(node, conceptName) {
  const want = numberless(conceptName).toLowerCase();
  for (let a = node.parent; a; a = a.parent) {
    if (a.kind === KIND.ATTRIBUTE || a.kind === KIND.DEFAULT) return false;
    if (numberless(a.name).toLowerCase() === want
      || (a.alias && a.alias.toLowerCase() === want)) return true;
  }
  return false;
}

// The nearest Concept at or above a node — the Concept a fact belongs to.
function owningConcept(node) {
  for (let p = node; p; p = p.parent) if (p.kind === KIND.CONCEPT) return p;
  return null;
}

// Every Example by lowercased name, in document order — a value may share a
// name with several, so resolution picks the one in the attribute's scope.
function individualsIndex(nodes) {
  const byName = new Map();
  const push = (key, n) => {
    const list = byName.get(key);
    if (list) { if (!list.includes(n)) list.push(n); } else byName.set(key, [n]);
  };
  for (const n of nodes) {
    if (n.kind !== KIND.INDIVIDUAL) continue;
    push(n.name.toLowerCase(), n);
    // a numbering prefix (`1. day 1`) is presentation: the plain name
    // resolves to the numbered Example too
    const plain = numberless(n.name).toLowerCase();
    if (plain && plain !== n.name.toLowerCase()) push(plain, n);
  }
  return byName;
}

// The Example a default's value names (default-is-a-Example), or null: the
// attribute (or its alias) must name a Concept, and the value must be an
// Example of that Concept. An attribute that names no Concept states no
// vocabulary for its values, so nothing links.
function valueTarget(node, concepts, byName) {
  if (node.kind !== KIND.DEFAULT || !node.value) return null;
  const type = conceptType(node, concepts);
  if (!type) return null;
  return (byName.get(node.value.toLowerCase()) || []).find(
    (cand) => cand !== node && exampleOfConcept(cand, type.name)
  ) || null;
}

// The defining Example a listed Example references (example-is-a-Example),
// or null: the target must be an Example of the Concept typing the attribute.
function listedTarget(node, concepts, byName) {
  if (node.kind !== KIND.INDIVIDUAL || !node.parent) return null;
  if (node.parent.kind !== KIND.ATTRIBUTE && node.parent.kind !== KIND.DEFAULT) return null;
  const type = conceptType(node.parent, concepts);
  return (type && (byName.get(node.name.toLowerCase()) || []).find(
    (cand) => cand !== node && exampleOfConcept(cand, type.name)
  )) || null;
}

// Whether an Example genuinely instantiates an attribute: true when one of
// its ancestors is that attribute, by name OR by alias. A
// `default-is-a-Example` value only carries meaningful ancestry when the
// Example it names lives under the attribute it is given to — `operation:
// Ratio` with Ratio filed under the `operation` attribute instantiates
// `operation`, so `operation: Formula` follows; an ancestor named through
// its alias counts too, so a value of `type (category)` links against an
// Example filed under `category`. Names are matched case-insensitively.
function instantiates(node, attrName) {
  // numbering prefixes are presentation: `operation` still names the
  // ancestor `1. Operation`
  const want = numberless(attrName).toLowerCase();
  for (let a = node.parent; a; a = a.parent) {
    if (numberless(a.name).toLowerCase() === want
      || (a.alias && a.alias.toLowerCase() === want)) return true;
  }
  return false;
}

// The Examples a Concept enumerates — the `- Example` children it lists
// directly, a table's rows among them (a row parses to exactly such a
// child). These are the values the Concept vouches for.
const listedExamples = (concept) => concept.children.filter((c) => c.kind === KIND.INDIVIDUAL);

// The truth values: a fact asserted *about* an Example, never the name of
// one. They are the values the language already writes bare (`is prime: No`).
const TRUTH_VALUES = new Set(["yes", "no", "true", "false"]);

// Values that name no Example of the Concept typing their attribute: the
// `default-is-a-Example` link that did not land. `person: James`, on an
// attribute typed by `Person` whose only Example is Socrates, asserts that
// James is a Person while the file never says who James is.
//
// Three things keep this to values that were genuinely *trying* to name an
// Example, because an attribute may mention a Concept without being valued
// by one:
//
//   the Concept must enumerate Examples — one listing none states an open
//     vocabulary, where any value is fair (`name: Socrates` is prose, not a
//     claim against a listed set);
//   the value must be the same kind of value its Examples are — `maximum
//     worker pool: 1` measures the pool, it does not name one of
//     Role/Asset/Function, and a number never could, while `age integer: 5`
//     is a number among the numbers 1 and 35 and genuinely misses;
//   the value must not be a truth value — `present in: False` says a fact
//     holds, it does not nominate an Example (and a Concept that really did
//     enumerate `- Yes` would have linked the value already).
//
// A value that does link — through the attribute itself or through its
// Concept — is already sound, and a derived value is its formula's business.
//
// Advisory, never counted in V: an unlisted value is a gap in the model, not
// a contradiction in it. The extension publishes these as Hints and offers
// the Quick Fix that lists the Example (derive.addExample). Returns
// { line, startCol, endCol, value, concept, message }, 1-based lines.
function unlistedValues(text, root, nodes, external) {
  const lines = text.split(/\r?\n/);
  const { concepts } = index(root, nodes);
  const byName = individualsIndex(nodes);
  // the repo's definitions fill in for names this file does not define, so a
  // value is only ever called unlisted against the whole model
  if (external) {
    for (const [key, ent] of external.concepts) if (!concepts.has(key)) concepts.set(key, ent.node);
    for (const [key, list] of external.individuals) {
      if (!byName.has(key)) byName.set(key, list.map((e) => e.node));
    }
  }
  const out = [];
  for (const node of nodes) {
    if (node.kind !== KIND.DEFAULT || !node.value || node.formula !== undefined) continue;
    if (TRUTH_VALUES.has(node.value.trim().toLowerCase())) continue;
    // `...` says the value is still to come, as it says everywhere else
    if (node.value.trim() === "...") continue;
    const type = conceptType(node, concepts);
    if (!type) continue;
    // the type's default is a value it vouches for, Example or not
    if (type.value && String(type.value).toLowerCase() === node.value.trim().toLowerCase()) continue;
    const listed = listedExamples(type);
    if (!listed.length) continue;
    const kinds = new Set(listed.map((c) => valueType(c.name)));
    if (!kinds.has(valueType(node.value))) continue;
    if (valueTarget(node, concepts, byName)) continue;
    // a table cell knows its offset; a 'name: value' line finds its value
    // after the colon, exactly as resolve() pins a default-is-a-Example
    const raw = lines[node.line - 1] || "";
    let startCol = node.valueCol;
    if (startCol === undefined) {
      const nameStart = raw.length - raw.trimStart().length;
      const colon = raw.indexOf(":", nameStart);
      if (colon === -1) continue;
      const after = raw.slice(colon + 1);
      startCol = colon + 1 + (after.length - after.trimStart().length);
    }
    const names = listed.map((c) => c.name);
    const shown = names.length > 5 ? `${names.slice(0, 5).join(", ")}, …` : names.join(", ");
    out.push({
      line: node.line,
      startCol,
      endCol: startCol + writtenLength(raw, startCol, node),
      value: node.value,
      concept: type,
      message: `add it as an Example of '${type.name}', or use one already listed — '${node.value}' is not an Example of Concept '${type.name}': its Examples are ${shown}`,
    });
  }
  return out;
}

// A merged index of Concepts and Examples across other files, for cross-file
// resolution. entries is [{ file, root, nodes }] (the current file excluded);
// the first file to define a name wins. Values carry their file so a link
// can point at it.
function externalIndex(entries) {
  const concepts = new Map();    // lowercased name -> { node, file }
  const individuals = new Map(); // lowercased name -> [{ node, file }]
  const putConcept = (name, entry) => {
    const key = name.toLowerCase();
    if (!concepts.has(key)) concepts.set(key, entry);
    const plain = numberless(name).toLowerCase();
    if (plain && !concepts.has(plain)) concepts.set(plain, entry);
  };
  const putIndividual = (key, entry) => {
    if (individuals.has(key)) individuals.get(key).push(entry);
    else individuals.set(key, [entry]);
  };
  for (const { file, root, nodes } of entries) {
    if (root) putConcept(root.name, { node: root, file });
    for (const n of nodes) {
      if (n.kind === KIND.CONCEPT) putConcept(n.name, { node: n, file });
      if (n.kind === KIND.INDIVIDUAL) {
        putIndividual(n.name.toLowerCase(), { node: n, file });
        const plain = numberless(n.name).toLowerCase();
        if (plain && plain !== n.name.toLowerCase()) putIndividual(plain, { node: n, file });
      }
    }
    for (const n of nodes) {
      if (n.kind === KIND.CONCEPT && n.alias) putConcept(n.alias, { node: n, file });
    }
  }
  return { concepts, individuals };
}

// Resolve all crosslinks in a parsed document. Returns
// { connection, line, startCol, endCol, text, target, file } with 1-based
// lines and 0-based columns; target is the defining node, file its source
// path when the target lives in another file (null for the same file).
// `external` (optional, from externalIndex) fills references the current
// file does not define — the local definition always wins.
function resolve(text, root, nodes, external) {
  const lines = text.split(/\r?\n/);
  const { concepts } = index(root, nodes);

  // Every Example by name, in document order — a value or listed Example may
  // share a name with several (`- 1` under both `Interval Count` and `maximum
  // number of elements`), so resolution picks the one in the attribute's
  // scope rather than the document's first.
  const individualsByName = individualsIndex(nodes);

  // fold in the other files' definitions for names this one doesn't define,
  // remembering each external node's file so its link can point there
  const fileOf = new Map();
  if (external) {
    for (const [key, ent] of external.concepts) {
      if (!concepts.has(key)) { concepts.set(key, ent.node); fileOf.set(ent.node, ent.file); }
    }
    for (const [key, list] of external.individuals) {
      if (!individualsByName.has(key)) {
        individualsByName.set(key, list.map((e) => e.node));
        for (const e of list) fileOf.set(e.node, e.file);
      }
    }
  }

  const links = [];
  for (const node of nodes) {
    const raw = lines[node.line - 1] || "";
    const nameStart = raw.length - raw.trimStart().length;

    // A table's parent column (1.13): its (alias) names the table's own
    // Concept — which is what makes every cell under it name one of the
    // table's rows — and each row's cell links the row it names, as a value
    // links the Example it names. A cell naming no row links nothing; the
    // linter says why.
    for (const col of node.parentColumns || []) {
      if (!col.alias || col.aliasCol === undefined) continue;
      links.push({
        connection: "attribute-is-a-Concept",
        line: col.line,
        startCol: col.aliasCol,
        endCol: col.aliasCol + col.alias.length,
        text: col.alias,
        target: node,
      });
    }
    if (node.kind === KIND.INDIVIDUAL && node.parentCell && node.parentCell.row) {
      links.push({
        connection: "parent-is-a-Example",
        line: node.line,
        startCol: node.parentCell.col,
        endCol: node.parentCell.col + node.parentCell.text.length,
        text: node.parentCell.text,
        target: node.parentCell.row,
      });
    }

    // A table cell's Attribute Value carries its column's attribute name,
    // but that name is written on the header line, not here — the header's
    // own ATTRIBUTE node links it, so the name link is skipped for cells.
    if ((node.kind === KIND.ATTRIBUTE || node.kind === KIND.DEFAULT) && node.valueCol === undefined) {
      // the longest trailing run of words that names a Concept wins — but an
      // alias is exclusive: when the attribute carries one, only the alias
      // types it, so `duration (time)` links 'time', never 'duration'. A
      // table header cell knows its exact column offset, other lines start
      // at the first non-space character.
      const base = node.nameCol !== undefined ? node.nameCol : nameStart;
      if (!node.alias) {
        for (const start of wordStarts(node.name)) {
          const suffix = node.name.slice(start);
          const target = concepts.get(suffix.toLowerCase());
          if (target && target !== node) {
            links.push({
              connection: "attribute-is-a-Concept",
              line: node.line,
              startCol: base + start,
              endCol: base + node.name.length,
              text: suffix,
              target,
            });
            break;
          }
        }
      }
      // a parenthetical alias is an explicit alternative name and the only
      // crosslink when present: `type (category)` links `category` to the
      // `Category` Concept, with the underline falling inside the parentheses
      if (node.alias) {
        const target = concepts.get(node.alias.toLowerCase());
        if (target && target !== node) {
          // a table header cell recorded its alias offset at parse time
          let aliasStart = node.aliasCol;
          if (aliasStart === undefined) {
            const region = raw.slice(0, raw.indexOf(":") === -1 ? raw.length : raw.indexOf(":"));
            const open = region.lastIndexOf("(");
            const inner = region.slice(open + 1);
            aliasStart = open + 1 + (inner.length - inner.trimStart().length);
          }
          links.push({
            connection: "attribute-is-a-Concept",
            line: node.line,
            startCol: aliasStart,
            endCol: aliasStart + node.alias.length,
            text: node.alias,
            target,
          });
        }
      }
    }

    if (node.kind === KIND.CONCEPT) {
      // a Concept named in a table's first header cell (1.9) knows its exact
      // offset; a line-form Concept starts at the first non-space character
      const cbase = node.nameCol !== undefined ? node.nameCol : nameStart;
      const contains = (text, base) => {
        for (const run of containedConcepts(text, node, concepts)) {
          links.push({
            connection: "concept-contains-Concept",
            line: node.line,
            startCol: base + run.start,
            endCol: base + run.end,
            text: run.span,
            target: run.target,
          });
        }
      };
      contains(node.name, cbase);
      if (node.alias) {
        // a table header cell recorded its alias offset at parse time
        let aliasStart = node.aliasCol;
        if (aliasStart === undefined) {
          const region = raw.slice(0, raw.indexOf(":") === -1 ? raw.length : raw.indexOf(":"));
          const open = region.lastIndexOf("(");
          const inner = region.slice(open + 1);
          aliasStart = open + 1 + (inner.length - inner.trimStart().length);
        }
        // a parenthetical alias that names another Concept links whole, with
        // the underline inside the parentheses, exactly as an attribute's
        // alias does: `Auto (Car)` links its `Car` to the `Car` Concept (and
        // is a duplicated identity the linter reports). Otherwise its own
        // words link as a name's do: `Human (Natural Person)` links `Person`.
        const target = concepts.get(node.alias.toLowerCase());
        if (target && target !== node) {
          links.push({
            connection: "alias-is-a-Concept",
            line: node.line,
            startCol: aliasStart,
            endCol: aliasStart + node.alias.length,
            text: node.alias,
            target,
          });
        } else contains(node.alias, aliasStart);
      }
    }

    if (node.kind === KIND.DEFAULT && node.value) {
      // Only a genuine value of the attribute links: the attribute must name a
      // Concept (attribute-is-a-Concept, through its alias when it carries one
      // — `person: Socrates` typed by `Person`, `interval count: 1` typed by
      // the `Interval Count` Concept), and the value must name an Example of
      // that Concept. Among Examples of that name the in-scope one is chosen,
      // so a same-named Example filed under an attribute — the `- 1` under
      // `maximum number of elements` — is never picked: an attribute's listed
      // Examples are its own frame's vocabulary, not a Concept's.
      const target = valueTarget(node, concepts, individualsByName);
      // a value that is no Example of the type but is the type's default —
      // `currency: EUR` beside `Currency: EUR` — names that default, and
      // links to the line that states it, as a value (dotted)
      const byDefault = target ? null : typeDefault(node, concepts);
      const toDefault = byDefault && String(byDefault.value).toLowerCase() === node.value.toLowerCase() ? byDefault.concept : null;
      if (target || toDefault) {
        // a table cell knows its exact offset; a 'name: value' line finds
        // its value after the colon
        let valueStart = node.valueCol;
        if (valueStart === undefined) {
          const colon = raw.indexOf(":", nameStart);
          const after = raw.slice(colon + 1);
          valueStart = colon + 1 + (after.length - after.trimStart().length);
        }
        links.push({
          connection: target ? "default-is-a-Example" : "value-is-a-default",
          line: node.line,
          startCol: valueStart,
          endCol: valueStart + writtenLength(raw, valueStart, node),
          text: node.value,
          target: target || toDefault,
          ...(target ? {} : { asValue: true }),
        });
      }
    }

    // An Example listed under an attribute that names a Concept is the listed
    // form of `attribute: Example`: link it to that Concept's Example, just as
    // default-is-a-Example links the value. The defining Example is the first
    // of its name (target !== node skips it); a later same-named Example under
    // the typed attribute is the reference. Requiring the target to be an
    // Example of the attribute's Concept keeps it to genuine values of that
    // type, and off another attribute's listed Examples.
    if (node.kind === KIND.INDIVIDUAL && node.parent
        && (node.parent.kind === KIND.ATTRIBUTE || node.parent.kind === KIND.DEFAULT)) {
      const target = listedTarget(node, concepts, individualsByName);
      if (target) {
        // a table row's Example knows its first cell's offset; otherwise the
        // marker ('-' or '|') is the line's first non-space character
        let valueStart = node.nameCol;
        if (valueStart === undefined) {
          const after = raw.slice(nameStart + 1);
          valueStart = nameStart + 1 + (after.length - after.trimStart().length);
        }
        links.push({
          connection: "example-is-a-Example",
          line: node.line,
          startCol: valueStart,
          endCol: valueStart + node.name.length,
          text: node.name,
          target,
        });
      }
    }
  }
  // tag each link with the file its target lives in (null = the same file)
  for (const l of links) l.file = fileOf.get(l.target) || null;
  return links;
}

module.exports = {
  resolve, index, externalIndex, conceptType, wordStarts, instantiates,
  exampleOfConcept, individualsIndex, valueTarget, listedTarget, owningConcept,
  unlistedValues, listedExamples, typeDefault, typeDefaultOf, unitOf, unitNamed,
};
