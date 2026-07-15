// Crosslink resolution for .aot documents: the four inline connections.
//
//   attribute-is-a-Concept   an attribute's (or default's) trailing words
//                            match a Concept name, case-insensitively:
//                            `age integer: 5` links to the `Integer` Concept
//   default-is-a-Example  a default value matches an Example name,
//                            case-insensitively:
//                            `person: socrates` links to `- Socrates`
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

// The defining node for every linkable name, both by lowercased name —
// every link kind resolves case-insensitively, so `person: socrates`
// finds `- Socrates` just as `age integer` finds `Integer`.
function index(root, nodes) {
  const concepts = new Map(); // lowercased name -> defining node
  const individuals = new Map(); // lowercased name -> defining node
  concepts.set(root.name.toLowerCase(), root);
  for (const node of nodes) {
    if (node.kind === KIND.CONCEPT && !concepts.has(node.name.toLowerCase()))
      concepts.set(node.name.toLowerCase(), node);
    if (node.kind === KIND.INDIVIDUAL && !individuals.has(node.name.toLowerCase()))
      individuals.set(node.name.toLowerCase(), node);
  }
  // a Concept's alias is an alternative name for it, so it resolves wherever
  // the name would; registered after the names so a real name always wins
  for (const node of nodes) {
    if (node.kind === KIND.CONCEPT && node.alias && !concepts.has(node.alias.toLowerCase()))
      concepts.set(node.alias.toLowerCase(), node);
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

// Whether anc is an ancestor of node (node sits somewhere beneath it).
function descendsFrom(node, anc) {
  for (let p = node.parent; p; p = p.parent) if (p === anc) return true;
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
  for (const n of nodes) {
    if (n.kind !== KIND.INDIVIDUAL) continue;
    const list = byName.get(n.name.toLowerCase());
    if (list) list.push(n); else byName.set(n.name.toLowerCase(), [n]);
  }
  return byName;
}

// The Example a default's value names (default-is-a-Example), or null: the
// named Example must instantiate the attribute, or the Concept typing it.
function valueTarget(node, concepts, byName) {
  if (node.kind !== KIND.DEFAULT || !node.value) return null;
  const type = conceptType(node, concepts);
  return (byName.get(node.value.toLowerCase()) || []).find(
    (cand) => cand !== node
      && (instantiates(cand, node.name) || (type && instantiates(cand, type.name)))
  ) || null;
}

// The defining Example a listed Example references (example-is-a-Example),
// or null: the target must descend from the Concept typing the attribute.
function listedTarget(node, concepts, byName) {
  if (node.kind !== KIND.INDIVIDUAL || !node.parent) return null;
  if (node.parent.kind !== KIND.ATTRIBUTE && node.parent.kind !== KIND.DEFAULT) return null;
  const type = conceptType(node.parent, concepts);
  return (type && (byName.get(node.name.toLowerCase()) || []).find(
    (cand) => cand !== node && descendsFrom(cand, type)
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
  const want = attrName.toLowerCase();
  for (let a = node.parent; a; a = a.parent) {
    if (a.name.toLowerCase() === want || (a.alias && a.alias.toLowerCase() === want)) return true;
  }
  return false;
}

// A merged index of Concepts and Examples across other files, for cross-file
// resolution. entries is [{ file, root, nodes }] (the current file excluded);
// the first file to define a name wins. Values carry their file so a link
// can point at it.
function externalIndex(entries) {
  const concepts = new Map();    // lowercased name -> { node, file }
  const individuals = new Map(); // lowercased name -> [{ node, file }]
  for (const { file, root, nodes } of entries) {
    if (root && !concepts.has(root.name.toLowerCase())) concepts.set(root.name.toLowerCase(), { node: root, file });
    for (const n of nodes) {
      if (n.kind === KIND.CONCEPT && !concepts.has(n.name.toLowerCase())) concepts.set(n.name.toLowerCase(), { node: n, file });
      if (n.kind === KIND.INDIVIDUAL) {
        const k = n.name.toLowerCase();
        if (individuals.has(k)) individuals.get(k).push({ node: n, file });
        else individuals.set(k, [{ node: n, file }]);
      }
    }
    for (const n of nodes) {
      if (n.kind === KIND.CONCEPT && n.alias && !concepts.has(n.alias.toLowerCase())) concepts.set(n.alias.toLowerCase(), { node: n, file });
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
      // each longest, non-overlapping run of words that names another
      // Concept becomes its own link, scanned left to right
      const ws = words(node.name);
      for (let i = 0; i < ws.length; ) {
        let matched = false;
        for (let j = ws.length - 1; j >= i; j--) {
          if (i === 0 && j === ws.length - 1) continue; // the whole name is the node itself
          const span = node.name.slice(ws[i].start, ws[j].end);
          const target = concepts.get(span.toLowerCase());
          if (target && target !== node) {
            links.push({
              connection: "concept-contains-Concept",
              line: node.line,
              startCol: nameStart + ws[i].start,
              endCol: nameStart + ws[j].end,
              text: span,
              target,
            });
            i = j + 1;
            matched = true;
            break;
          }
        }
        if (!matched) i++;
      }
      // a parenthetical alias that names another Concept links whole, with
      // the underline inside the parentheses, exactly as an attribute's
      // alias does: `Auto (Car)` links its `Car` to the `Car` Concept
      if (node.alias) {
        const target = concepts.get(node.alias.toLowerCase());
        if (target && target !== node) {
          const region = raw.slice(0, raw.indexOf(":") === -1 ? raw.length : raw.indexOf(":"));
          const open = region.lastIndexOf("(");
          const inner = region.slice(open + 1);
          const aliasStart = open + 1 + (inner.length - inner.trimStart().length);
          links.push({
            connection: "alias-is-a-Concept",
            line: node.line,
            startCol: aliasStart,
            endCol: aliasStart + node.alias.length,
            text: node.alias,
            target,
          });
        }
      }
    }

    if (node.kind === KIND.DEFAULT && node.value) {
      // Only a genuine value of the attribute links: the named Example must
      // instantiate the attribute, either because the attribute directly holds
      // it (`operation: Ratio`, Ratio filed beneath `operation`) or because the
      // attribute names the Concept it lives under (attribute-is-a-Concept,
      // `person: Socrates` typed by `Person`, `interval count: 1` typed by the
      // `Interval Count` Concept). Among Examples of that name the in-scope one
      // is chosen, so a same-named Example filed under an unrelated attribute —
      // the `- 1` under `maximum number of elements` — is never picked.
      const target = valueTarget(node, concepts, individualsByName);
      if (target) {
        // a table cell knows its exact offset; a 'name: value' line finds
        // its value after the colon
        let valueStart = node.valueCol;
        if (valueStart === undefined) {
          const colon = raw.indexOf(":", nameStart);
          const after = raw.slice(colon + 1);
          valueStart = colon + 1 + (after.length - after.trimStart().length);
        }
        links.push({
          connection: "default-is-a-Example",
          line: node.line,
          startCol: valueStart,
          endCol: valueStart + node.value.length,
          text: node.value,
          target,
        });
      }
    }

    // An Example listed under an attribute that names a Concept is the listed
    // form of `attribute: Example`: link it to that Concept's Example, just as
    // default-is-a-Example links the value. The defining Example is the first
    // of its name (target !== node skips it); a later same-named Example under
    // the typed attribute is the reference. Requiring the target to descend
    // from the attribute's Concept keeps it to genuine values of that type.
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
  individualsIndex, valueTarget, listedTarget, owningConcept,
};
