// Two names for one idea.
//
// Alpha's first rule is univocity: one name, one meaning. The linter enforces
// the half it can prove — the *same* name written twice must mean the same
// thing. The other half cannot be proved at all: two *different* names may
// still be one idea, and no arithmetic over the tree will ever say so, because
// nothing in the tree records that 'Client' and 'Customer' are the same word
// in two dialects. That is a fact about English, not about the model.
//
// So this module does the only honest thing available offline: it recognises
// the collisions that actually happen when people model, and it *asks*. Every
// finding is advisory — a warning, never counted in `V` — and every one is
// dismissible, because the writer is the only one who knows whether a
// distinction is real. A model that deliberately separates `Supplier` from
// `Vendor` says so once and is never asked again.
//
// Two rules, both conservative:
//
//   vocabulary   the two names match word for word once each word is mapped
//                to its synonym group — 'Sales Client' and 'Sales Customer',
//                'Fix Defect' and 'Repair Bug'.
//
//   stem         the names match word for word once each word is cut to a
//                long shared prefix — 'Reconciliation' and 'Reconciled',
//                'Governance' and 'Government'. Six characters, so short
//                words that merely start alike never collide.
//
// Pure: no I/O, no vscode. Concepts only — an attribute named two ways is a
// column, and the dependency inference already reports two columns that
// record the same distinction.

const pluralize = require("pluralize");
const { numberless } = require("./table");

// The shortest shared prefix that counts as one stem. Six is chosen to clear
// the common short words that start alike ('price'/'prime', 'state'/'stated'
// would pass at four) while still catching the derivational pairs that matter
// ('govern|ance'/'govern|ment', 'reconcil|ed'/'reconcil|iation').
const MIN_STEM = 6;

// The words that collide when people model. Each group is one idea spelled
// several ways; a word may appear in one group only. Single words only —
// matching runs word by word, so a multi-word phrase would never be reached.
//
// This list is deliberately small and domain-shaped rather than a thesaurus:
// a general thesaurus makes near-synonyms of words a model needs to keep
// apart ('cost' and 'price', 'target' and 'goal'), and every false finding
// spends the reader's attention. Add to it through `aot.acceptedWords`'
// opposite number, `aot.distinctConcepts`, when a pair here is wrong for you.
const GROUPS = [
  // who
  ["client", "customer", "buyer", "purchaser"],
  ["employee", "staff", "personnel"],
  ["supplier", "vendor"],
  ["company", "firm", "organisation", "organization", "enterprise"],
  ["owner", "holder", "proprietor"],
  ["team", "crew", "squad"],
  ["person", "individual"],
  // what
  ["invoice", "bill"],
  ["product", "article", "merchandise"],
  ["document", "paper", "papers"],
  ["record", "entry"],
  ["attribute", "property", "field"],
  ["category", "classification", "grouping"],
  ["type", "kind", "sort"],
  ["link", "connection", "association", "relationship"],
  ["limit", "threshold", "cap", "ceiling"],
  ["source", "origin"],
  ["reason", "motive", "rationale"],
  ["outcome", "result", "effect"],
  ["method", "technique", "approach"],
  ["tool", "instrument", "implement"],
  ["risk", "hazard", "threat"],
  ["error", "fault", "defect", "bug"],
  ["question", "query", "enquiry", "inquiry"],
  ["answer", "response", "reply"],
  ["step", "stage", "phase"],
  ["location", "place", "site"],
  ["income", "revenue", "turnover"],
  ["expense", "expenditure", "outlay"],
  ["payment", "remittance"],
  ["delivery", "shipment", "consignment"],
  ["approval", "authorisation", "authorization"],
  ["speed", "velocity"],
  ["size", "magnitude"],
  // done to it
  ["create", "make", "build", "generate", "produce"],
  ["remove", "delete", "erase"],
  ["update", "amend", "revise"],
  ["check", "verify", "validate"],
  ["show", "display", "present"],
  ["get", "fetch", "retrieve", "obtain"],
  ["send", "transmit"],
  ["begin", "start", "commence"],
  ["finish", "complete", "conclude"],
  ["fix", "repair", "remedy"],
  ["copy", "duplicate", "replicate"],
  ["choose", "select", "pick"],
  ["join", "merge", "combine"],
  ["split", "divide", "separate"],
];

// word -> the group's first word, its representative.
const REPRESENTATIVE = new Map();
for (const group of GROUPS) {
  for (const word of group) REPRESENTATIVE.set(word, group[0]);
}

// A name's words, lowercased, numbering prefix and possessive off, each
// singular: the form both rules compare. Punctuation other than an in-word
// apostrophe is dropped — 'Aristotle's Ethics' keeps its apostrophe as a
// letter of the name, exactly as the linter reads it.
function words(name) {
  return numberless(String(name).trim())
    .toLowerCase()
    .split(/[^a-z0-9'’]+/)
    .filter(Boolean)
    .map((w) => w.replace(/['’]s$/, ""))
    .map((w) => pluralize.singular(w));
}

// The vocabulary key: each word replaced by its group's representative.
const vocabularyKey = (name) =>
  words(name).map((w) => REPRESENTATIVE.get(w) || w).join(" ");

// Whether two words are one word with different endings: a shared prefix of
// at least MIN_STEM characters, and neither word merely the other with a
// plural already folded away (words() singularises first, so an equal pair
// here is one word, not two).
function sameStem(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i >= MIN_STEM;
}

// Whether two names match word for word under sameStem.
function stemMatch(a, b) {
  const x = words(a), y = words(b);
  if (x.length !== y.length || !x.length) return false;
  return x.every((w, i) => sameStem(w, y[i]));
}

// The pair key both the finding and the dismissal list use: the two names,
// lowercased and sorted, joined with a '|'. Order-free, so a writer who
// dismissed 'Client|Customer' is not asked again about 'Customer|Client'.
const pairKey = (a, b) => [String(a).toLowerCase(), String(b).toLowerCase()].sort().join("|");

// The Concepts a model holds, as [{ name, line, file, alias }], judged
// pairwise. `dismissed` is a Set of pairKey strings the writer has declared
// distinct (aot.distinctConcepts).
//
// Returns [{ line, file, name, other, why, message, related }] — one finding
// per occurrence of the pair, so both sides squiggle and each points at the
// other, exactly as the duplicate findings do.
function findings(concepts, dismissed) {
  const out = [];
  const seen = new Set();
  const list = concepts.filter((c) => c && c.name && words(c.name).length);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const an = String(a.name).toLowerCase(), bn = String(b.name).toLowerCase();
      // the same name twice is univocity's business (rule 9 / the repo pass),
      // not this module's
      if (an === bn) continue;
      // an alias is a second name *declared* to be the same idea: it is the
      // supported way to say what this check is asking about, so saying it
      // ends the question
      if (aliases(a, bn) || aliases(b, an)) continue;
      const key = pairKey(a.name, b.name);
      if (dismissed && dismissed.has(key)) continue;
      // 'Person' beside 'People' is one name written singular and plural, not
      // two names for one idea: that is the appears-plural warning's business,
      // and saying it twice would only make the same nag louder
      if (words(a.name).join(" ") === words(b.name).join(" ")) continue;
      const why = vocabularyKey(a.name) === vocabularyKey(b.name) ? "vocabulary"
        : stemMatch(a.name, b.name) ? "stem"
        : null;
      if (!why) continue;
      // one pair, reported once at each of its two places
      if (seen.has(key)) continue;
      seen.add(key);
      for (const [self, other] of [[a, b], [b, a]]) {
        out.push({
          line: self.line,
          file: self.file,
          name: self.name,
          other: other.name,
          why,
          message: message(self, other, why),
          related: [{
            file: other.file, line: other.line,
            message: `'${other.name}' is written here`,
          }],
        });
      }
    }
  }
  return out;
}

const aliases = (node, name) => !!node.alias && String(node.alias).toLowerCase() === name;

const where = (self, other) =>
  other.file && self.file && other.file !== self.file
    ? ` (${baseName(other.file)}:${other.line})`
    : ` (line ${other.line})`;

const baseName = (file) => String(file).split(/[\\/]/).pop();

function message(self, other, why) {
  const at = where(self, other);
  const cause = why === "vocabulary"
    ? `'${self.name}' and '${other.name}'${at} are two words for one idea`
    : `'${self.name}' and '${other.name}'${at} are one word with two endings`;
  return `${cause} — one idea takes one name, so a reader cannot tell whether these are the same thing `
    + `written twice or two things that happen to sound alike; rename one to the other, or write `
    + `'${self.name} (${other.name})' to say they are the same idea. If they are genuinely different, `
    + `the lightbulb records that and stops asking.`;
}

module.exports = { findings, pairKey, words, vocabularyKey, sameStem, stemMatch, GROUPS, MIN_STEM };
