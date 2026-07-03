// Crosslink resolution for .aot documents: the four inline connections.
//
//   attribute-is-a-Concept   an attribute's (or default's) trailing words
//                            match a Concept name, case-insensitively:
//                            `age integer: 5` links to the `Integer` Concept
//   default-is-a-Example  a default value matches an Example name
//                            exactly, case-sensitively:
//                            `person: Socrates` links to `- Socrates`
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

// The defining node for every linkable name: Concepts by lowercased
// name (attribute-is-a-Concept is case-insensitive), Examples by
// exact name (default-is-a-Example is case-sensitive).
function index(root, nodes) {
  const concepts = new Map(); // lowercased name -> defining node
  const individuals = new Map(); // exact name -> defining node
  concepts.set(root.name.toLowerCase(), root);
  for (const node of nodes) {
    if (node.kind === KIND.CONCEPT && !concepts.has(node.name.toLowerCase()))
      concepts.set(node.name.toLowerCase(), node);
    if (node.kind === KIND.INDIVIDUAL && !individuals.has(node.name))
      individuals.set(node.name, node);
  }
  return { concepts, individuals };
}

// The Concept an attribute (or default) names by its trailing words — the
// attribute-is-a-Concept target, longest trailing run wins, as in resolve().
// Its "type": `shade hue` names `Hue`. A parenthetical alias is an explicit
// alternative name, so it is matched whole: `type (category)` is typed by
// `Category`. null when neither the name nor the alias is a Concept.
function conceptType(node, concepts) {
  for (const start of wordStarts(node.name)) {
    const target = concepts.get(node.name.slice(start).toLowerCase());
    if (target && target !== node) return target;
  }
  if (node.alias) {
    const target = concepts.get(node.alias.toLowerCase());
    if (target && target !== node) return target;
  }
  return null;
}

// Whether anc is an ancestor of node (node sits somewhere beneath it).
function descendsFrom(node, anc) {
  for (let p = node.parent; p; p = p.parent) if (p === anc) return true;
  return false;
}

// Whether an Example genuinely instantiates an attribute: true when one of
// its ancestors is that attribute. A `default-is-a-Example` value only
// carries meaningful ancestry when the Example it names lives under the
// attribute it is given to — `operation: Ratio` with Ratio filed under the
// `operation` attribute instantiates `operation`, so `operation: Formula`
// and `operation: Arithmetic` follow; a value naming an unrelated Example
// does not. Names are matched case-insensitively, as attribute-is-a-Concept.
function instantiates(node, attrName) {
  const want = attrName.toLowerCase();
  for (let a = node.parent; a; a = a.parent) {
    if (a.name.toLowerCase() === want) return true;
  }
  return false;
}

// Resolve all crosslinks in a parsed document. Returns
// { connection, line, startCol, endCol, text, target } with 1-based
// lines and 0-based columns; target is the defining node.
function resolve(text, root, nodes) {
  const lines = text.split(/\r?\n/);
  const { concepts } = index(root, nodes);

  // Every Example by name, in document order — a value or listed Example may
  // share a name with several (`- 1` under both `Interval Count` and `maximum
  // number of elements`), so resolution picks the one in the attribute's
  // scope rather than the document's first.
  const individualsByName = new Map();
  for (const n of nodes) {
    if (n.kind !== KIND.INDIVIDUAL) continue;
    const list = individualsByName.get(n.name);
    if (list) list.push(n); else individualsByName.set(n.name, [n]);
  }

  const links = [];
  for (const node of nodes) {
    const raw = lines[node.line - 1] || "";
    const nameStart = raw.length - raw.trimStart().length;

    // A table cell's Attribute Value carries its column's attribute name,
    // but that name is written on the header line, not here — the header's
    // own ATTRIBUTE node links it, so the name link is skipped for cells.
    if ((node.kind === KIND.ATTRIBUTE || node.kind === KIND.DEFAULT) && node.valueCol === undefined) {
      // the longest trailing run of words that names a Concept wins; a
      // table header cell knows its exact column offset, other lines start
      // at the first non-space character
      const base = node.nameCol !== undefined ? node.nameCol : nameStart;
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
      // a parenthetical alias is an explicit alternative name: link it whole
      // when it names a Concept, so `type (category)` links `category` to the
      // `Category` Concept, with the underline falling inside the parentheses
      if (node.alias) {
        const target = concepts.get(node.alias.toLowerCase());
        if (target && target !== node) {
          const region = raw.slice(0, raw.indexOf(":") === -1 ? raw.length : raw.indexOf(":"));
          const open = region.lastIndexOf("(");
          const inner = region.slice(open + 1);
          const aliasStart = open + 1 + (inner.length - inner.trimStart().length);
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
      const type = conceptType(node, concepts);
      const target = (individualsByName.get(node.value) || []).find(
        (cand) => cand !== node
          && (instantiates(cand, node.name) || (type && instantiates(cand, type.name)))
      );
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
      const type = conceptType(node.parent, concepts);
      const target = type && (individualsByName.get(node.name) || []).find(
        (cand) => cand !== node && descendsFrom(cand, type)
      );
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
  return links;
}

module.exports = { resolve, index, wordStarts, instantiates };
