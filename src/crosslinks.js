// Crosslink resolution for .aot documents: the three inline connections.
//
//   attribute-is-a-Concept   an attribute's (or default's) trailing words
//                            match a Concept name, case-insensitively:
//                            `age integer: 5` links to the `Integer` Concept
//   default-is-a-Individual  a default value matches an Individual name
//                            exactly, case-sensitively:
//                            `person: Socrates` links to `- Socrates`
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
// name (attribute-is-a-Concept is case-insensitive), Individuals by
// exact name (default-is-a-Individual is case-sensitive).
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

// Resolve all crosslinks in a parsed document. Returns
// { connection, line, startCol, endCol, text, target } with 1-based
// lines and 0-based columns; target is the defining node.
function resolve(text, root, nodes) {
  const lines = text.split(/\r?\n/);
  const { concepts, individuals } = index(root, nodes);

  const links = [];
  for (const node of nodes) {
    const raw = lines[node.line - 1] || "";
    const nameStart = raw.length - raw.trimStart().length;

    if (node.kind === KIND.ATTRIBUTE || node.kind === KIND.DEFAULT) {
      // the longest trailing run of words that names a Concept wins
      for (const start of wordStarts(node.name)) {
        const suffix = node.name.slice(start);
        const target = concepts.get(suffix.toLowerCase());
        if (target && target !== node) {
          links.push({
            connection: "attribute-is-a-Concept",
            line: node.line,
            startCol: nameStart + start,
            endCol: nameStart + node.name.length,
            text: suffix,
            target,
          });
          break;
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
      const target = individuals.get(node.value);
      if (target && target !== node) {
        const colon = raw.indexOf(":", nameStart);
        const after = raw.slice(colon + 1);
        const valueStart = colon + 1 + (after.length - after.trimStart().length);
        links.push({
          connection: "default-is-a-Individual",
          line: node.line,
          startCol: valueStart,
          endCol: valueStart + node.value.length,
          text: node.value,
          target,
        });
      }
    }
  }
  return links;
}

module.exports = { resolve, index, wordStarts };
