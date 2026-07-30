// Unit tests for the synonym check (src/synonyms.js): the two rules
// (vocabulary and stem), what each deliberately does not fire on, and the
// dismissal key.
//
// Plain Node script, no framework — run with: node out/test-synonyms.js
const { findings, pairKey, words, vocabularyKey, sameStem, stemMatch } = require("../src/synonyms");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

const at = (name, line, file, alias) => ({ name, line, file: file || "World.aot", alias: alias || null });
const pairsOf = (found) => new Set(found.map((f) => pairKey(f.name, f.other)));

// ---------------------------------------------------------------------------
// words / vocabularyKey: the form both rules compare
// ---------------------------------------------------------------------------
{
  check("words: a numbering prefix is presentation, not part of the name",
    words("1.2 Sales Client").join(" ") === "sale client");
  check("words: a possessive is a letter of the name, not a word of its own",
    words("Aristotle's Ethics").join(" ") === "aristotle ethic");
  check("vocabularyKey: each word maps to its group's representative",
    vocabularyKey("Sales Customer") === vocabularyKey("Sales Client"));
  check("vocabularyKey: a word in no group is itself",
    vocabularyKey("Otter") === "otter");
}

// ---------------------------------------------------------------------------
// sameStem / stemMatch
// ---------------------------------------------------------------------------
{
  check("sameStem: six shared characters is one word with two endings",
    sameStem("governance", "government"));
  check("sameStem: a short shared start is two words",
    !sameStem("price", "prime") && !sameStem("paying", "payment"));
  check("stemMatch: every word must match, and the counts with them",
    stemMatch("Reconciled Item", "Reconciliation Item")
    && !stemMatch("Reconciled Item", "Reconciled"));
}

// ---------------------------------------------------------------------------
// findings: both rules, reported at both places
// ---------------------------------------------------------------------------
{
  const found = findings([at("Client", 1), at("Customer", 8)], new Set());
  check("findings: two words for one idea are found",
    pairsOf(found).has("client|customer"));
  check("findings: the pair reports at each of its two places, each naming the other",
    found.length === 2
    && found.some((f) => f.line === 1 && f.other === "Customer" && f.related[0].line === 8)
    && found.some((f) => f.line === 8 && f.other === "Client" && f.related[0].line === 1));
  check("findings: the message says which rule fired",
    found.every((f) => f.why === "vocabulary" && /two words for one idea/.test(f.message)));

  const stems = findings([at("Governance", 1), at("Government", 4)], new Set());
  check("findings: one word with two endings is found, and says so",
    stems.length === 2 && stems[0].why === "stem" && /two endings/.test(stems[0].message));
}

// ---------------------------------------------------------------------------
// what it deliberately leaves alone
// ---------------------------------------------------------------------------
{
  check("findings: the same name twice is univocity's business, not this check's",
    findings([at("Client", 1), at("client", 4)], new Set()).length === 0);
  check("findings: singular beside plural is the appears-plural warning's business",
    findings([at("Person", 1), at("People", 4)], new Set()).length === 0);
  check("findings: an alias is the supported way to say it, so saying it ends the question",
    findings([at("Human", 1, "World.aot", "Client"), at("Client", 4)], new Set()).length === 0);
  check("findings: unrelated names are left alone",
    findings([at("Otter", 1), at("Fowl", 4)], new Set()).length === 0);
}

// ---------------------------------------------------------------------------
// dismissal
// ---------------------------------------------------------------------------
{
  const key = pairKey("Customer", "Client");
  check("pairKey: the key is order-free and case-free",
    key === "client|customer" && key === pairKey("client", "CUSTOMER"));
  check("findings: a dismissed pair is never asked about again",
    findings([at("Client", 1), at("Customer", 8)], new Set([key])).length === 0);
}

// ---------------------------------------------------------------------------
// across files: the finding carries the other file, and says so
// ---------------------------------------------------------------------------
{
  const found = findings([at("Supplier", 3, "buying.aot"), at("Vendor", 9, "selling.aot")], new Set());
  const mine = found.find((f) => f.file === "buying.aot");
  check("findings: a pair split across two files reports in both",
    found.length === 2 && mine && mine.related[0].file === "selling.aot");
  check("findings: the message names the other file when it is another file",
    /selling\.aot:9/.test(mine.message));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
