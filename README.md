# Alpha (.aot)

Alpha is aimed at knowledge workers like analysts and architects. Alpha comes with tooling that checks its rules for you. The VS Code extension (`alphabet-of-thought-*.vsix`) adds syntax colouring for `.aot` files and an arithmetic linter after Leibniz. Every idea receives a prime and its ancestry is encoded as a product, so the linter can verify the tree as you type. Tabs, broken indentation, depth jumps, a Concept defined twice and identical siblings all appear as squiggles in the Problems panel. The extension also resolves the inline crosslinks. An attribute whose trailing words match a Concept, or a Attribute Value that names an Example, is underlined as a link, and Ctrl+click jumps to the defining line. The same linter runs from the command line with `node verify.js <file.aot>`. The CLI can also answer an is-a question by divisibility (`--ask`), find the genus of two ideas by gcd (`--genus`), print the characteristic number of any idea (`--number`), and audit the tree by Formal Concept Analysis (`--suggest`): it treats the Examples and their attributes as a formal context, computes the concept lattice, and reports groupings the data supports that no Concept names, Examples filed away from the Concept whose attributes they share, and sub-Concepts that fail to cover or distinguish their parent's Examples. The crosslinks deepen the analysis: a value that names an Example elsewhere in the file carries that Example's whole ancestry into the context, so `operation: Ratio` and `operation: Formula` group together when Ratio is filed under Formula. Where `--number` encodes only *where* a line sits, a second number encodes *what it says*: `--godel` prints the Gödel number of an idea — one prime per attribute, raised to a power that encodes the value — and `--clashes`, `--overrides`, `--find`, `--common`, `--near`, and `--diff` query that number arithmetically (see [Gödel numbering](#gödel-numbering)). Building on it, `--fd` infers the functional dependencies the Examples bear out and `--depends` walks a Concept's declared dependencies (see [Armstrong's axioms](#armstrongs-axioms-dependency-inference)).

Alpha is a text-based engineering language for working out what you mean in a way a machine can check.  You build knowledge as a tree of indented plain text, a human-first interface to a key-value store that makes strict design choices: single inheritance and only four types of ideas.

## The basic workflow

1. Pick a subject and name a file after it. The file name is the root concept — Thought.aot, Sales.aot, Payments.aot. Everything inside is a child of that one idea.
2. Write indented plain text using only four kinds of line: a capitalised line is a Concept (a kind of thing), a lowercase line is an attribute (a property), - Dash is an Example (a real instance), and name: value gives the term before the colon one inline value — an Attribute Value under a lowercase attribute, or, under a capitalised Concept, the Concept's single inline Example (`Run Command: code --install …` is the Concept `Run Command` described by the one Example `code --install …`). Indentation is the only relationship: one parent per idea, general at the top, specific at the bottom.
3. Let the tooling correct you as you type. The VS Code extension squiggles tabs, depth jumps, a Concept defined twice, identical siblings, an "and" in a Concept name — each one is a place where your model is ambiguous. Ctrl+click on a crosslink jumps to where a term is defined.
4. Verify and query from the command line. node verify.js file.aot checks the whole tree (exit 0 = the file verifies); --ask, --genus, --number answer questions about it arithmetically, as covered earlier; --suggest audits your Concepts against the concept lattice the Examples' attributes actually support.

## What you'd use it for

You can purely use it for your own thoughts, without describing the "why" of your thoughts, but Alpha has four primitives for the the four kinds of model knowledge work keeps producing anyway, usually scattered across slides and spreadsheets:

- Motivation — goals and KPIs with an beneficiary, an actual, a target, and a red/amber/green influence rolling up a tree. This is an OKR tree or a metrics dashboard as text: the README's sales example (Mike owns revenue growth, which decomposes into new clients, basket size, churn) is exactly what a quarterly business review tries to communicate.
- Graph — data modelling: which entities exist, where records reside, what depends on what. It even encodes normalisation reasoning (Armstrong's axioms) as tree shapes, so you can use it to design a schema before touching a database.
- Function — capability decomposition: what the system achieves, as a tree of verb-phrase objectives where each parent is achieved exactly by all its children together. The value-chain example is an org's capability map; the naming rules ("no and, no manage, no flow words") force each node to be one testable claim.
- Workflow — who does what in what order, including concurrency: locks, queues, race conditions, what's the bottleneck. The Thought.aot example models intuition vs. deliberation this way.

## Why bother with the strictness

The constraints are the product. Because every idea has exactly one parent, writing a line forces a decision — is this a kind, a property, or an instance, and of what? Those are exactly the decisions prose lets you dodge. The payoffs:

Two readers build the same mental model. No multiple inheritance means an idea never changes meaning depending on the path you took to it. A .aot file is a shared definition a team can extend instead of each human keeping a private version.

Disagreements become locatable. When a colleague disputes the model, the dispute is about a specific line — a wrong parent, a missing differentia — not about a vibe in a paragraph.
Arguments become checkable. This is the Leibniz point in the README: once "Socrates is a Human" is the divisibility of two integers, an is-a claim isn't an opinion, it's a computation the linter either confirms or refutes. V = 0 at the bottom of the CLI output means the file contains no structural contradictions.

AI can work on it reliably. Plain text is what language models consume, and the linter is an objective referee: you can ask an AI to extend or critique the model, then run verify.js to check the result mechanically rather than by re-reading. The tree gives the AI your actual ontology instead of letting it guess from prose.

A realistic first use: take something you currently explain badly in a document — your team's metrics, a domain model, a process with a known bottleneck — pick the matching primitive as a skeleton, write it as a .aot tree (1. Start with natural Concepts, 2. Build up from facts OR normalise an existing data structures and then Derive relations, establish attributes), and keep fixing squiggles until V = 0. The places where you can't decide on a parent are the places where you didn't actually know what you meant — which is the point. 

## Gödel numbering

The characteristic number `chi = prime × chi(parent)` is a squarefree product: it records a line's **ancestry** — *where* it sits — and nothing else. The Gödel number `G` is its complement, after Gödel (1931): it records a line's **content** — *what it says* — by raising **primes to powers**. Each attribute gets one prime; the exponent encodes the value that attribute is set to:

- exponent **0** — the attribute is absent (its prime does not divide `G`)
- exponent **1** — the attribute is present but unvalued
- exponent **k > 1** — the attribute carries a value, `k` a stable code for it

So a line that sets three attributes becomes one integer like `2³ × 3⁵ × 5²`. The two numbers cover both axes of a line — `chi` the *where*, `G` the *what* — and every question below is plain arithmetic on `G`, run with `node verify.js <file.aot> --godel X` (print the factorisation and legend) or the query flags in the table.

| What you ask | Arithmetic on `G` | CLI |
|--------------|-------------------|-----|
| Does idea *n* carry attribute *a*? | `prime(a)` divides `G(n)` | `--godel` (legend lists every attribute) |
| Do *n* and *m* carry the **same attributes**? | `radical(G(n)) == radical(G(m))` (exponents stripped) | `--clashes` |
| Are *n*'s attributes a **subset** of *m*'s? | `radical(G(n))` divides `radical(G(m))` | — |
| Which ideas match a **partial spec** (`a: v` AND `b: w` …)? | build a query number `Q`; an idea matches iff `Q` divides `G(n)` | `--find "a: v" ["b" …]` |
| Do *n* and *m* carry **identical content** (a clash)? | `G(n) == G(m)` | `--clashes` |
| What value does *a* take on *n*? | the exponent of `prime(a)` in `G(n)`, decoded | `--godel` |
| Which ideas **override** an inherited default? | `prime(a)` divides both `G(n)` and `G(ancestor)`, exponents ≥ 2 and unequal | `--overrides` |
| What does a child **add or change** over its parent? | the primes whose exponent grew or changed | `--overrides`, `--diff` |
| Which attributes are two ideas set to the **same value** (their shared core)? | the primes with the same exponent in both — `gcd`-style intersection | `--common X Y` |
| Which existing ideas are **most like** *n*? | fewest primes whose exponents differ — a content distance | `--near X [k]` |
| What changed between two **versions** of a file? | factor `G` under a shared table: a prime gained/lost is an attribute added/removed; a changed exponent is a changed value | `--diff old.aot new.aot` |
| Which attributes are present but **not yet valued** (a todo list)? | primes with exponent exactly 1 | `--godel` |

`--clashes` reports the two strengths separately: two ideas that share an attribute-name set but differ in their values (equal radicals), and the stronger case of two ideas with identical attributes *and* values (equal `G`). The strong, content-identical clash also surfaces in the ordinary lint pass as an advisory **hint** — like the `--suggest` findings, it appears only when the file already verifies (`V = 0`) and never counts toward `V`.

## Armstrong's axioms (dependency inference)

A functional dependency `X → Y` says "fix `X` and `Y` is fixed too". Armstrong's axioms are the inference rules for such dependencies, and `src/armstrong.js` makes them part of the linter in two ways, both reusing the Gödel numbers above.

**Inferred from the Examples.** Project every Example's `G` onto an attribute's prime — its value code — and group the Examples by it. `X → Y` holds when `Y`'s code is constant within every `X`-group, across enough Examples to be more than coincidence. A column thus determined by another is **derivable**: model it once rather than restating it on every Example (the normalisation reasoning the Graph primitive is about). When the dependency runs both ways (`X ↔ Y`) the two attributes are the **same distinction written twice**. An antecedent that is distinct on every Example (a key) is ignored — it determines everything vacuously, with no evidence — unless its partner is a key too, a genuine bijection. Like the clash hint, the strongest of these surface as advisory `V = 0` hints; `--fd` prints the full inferred set.

**Declared by the Concept references.** An attribute whose name ends in a Concept, and a Concept whose name contains another, are both read as "depends on" edges; their transitive closure (Armstrong transitivity) answers `--depends X` — what a Concept rests on directly, and what it inherits through a chain.

```
node verify.js <file.aot> --fd          # functional dependencies inferred from the Examples
node verify.js <file.aot> --depends X   # what Concept X depends on, direct and transitive
```

## The four idea types ontology

They are the crossing of **Said-of** and **Present-in** (*Categories* 2)

### Schemas (Acting on)

*Schemas* are the universal ideas: Concepts and Attributes. They define the form of the model, deciding what kinds of ideas exist and which properties each kind carries. They act on content in the sense that every Example and Attribute Value beneath them takes its meaning from them: a line like `- Socrates` only says something because the `Human` Concept and its attributes say what a human is.

| Idea Type | How to Recognise | Purpose | Extra Rules | Example | Said of (S) | Present in (P) |
|-----------|------------------|---------|-------------|---------|-------------|----------------|
| **Concept** (Universal Substance) | First letter is capitalised | Defines a class or type of idea | A Concept may reappear elsewhere only if a distinguishing qualifier prefix makes it unique | `Human` | **True (S)** | **False (~P)** |
| **Attribute** (Universal Accident) | All lowercase | Defines a property that a Concept has | Every attribute is itself a Concept that can be expanded on somewhere else, whether or not it is defined elsewhere | `full name` | **True (S)** | **True (P)** |

### Content (Being acted upon)

Filling a schema with content helps to understand the schema. *Content*, the acted-upon Examples, is the evidence a true schema stands on.

| Idea Type | How to Recognise | Purpose | Example | Said of (S) | Present in (P) |
|-----------|------------------|---------|---------|-------------|----------------|
| **Example** (Individual Substance) | A `- ` (dash + space) child, **or** the `value` in a capitalised `Concept: value` line | A concrete Example (instance) of the parent Concept or attribute, rather than a single Attribute Value. Usually a `- ` child — the `- ` prefix is what makes a line an Example, and without it a lowercase line is always an attribute. A single Example may instead ride inline on its Concept's own line as `Concept: value` (the `value` is the Example); this is the same kind, just written inline, and reads as an Example everywhere (counts, crosslinks, FCA) | `- Socrates`, or `Run Command: code --install …` | **False (~S)** | **False (~P)** |
| **Attribute Value** (Individual Accident) | The `value` after the colon in `attribute: value`; the term before the colon is **lowercase** | The concrete value an attribute takes. An `attribute: value` line is **two** ideas — the attribute (`colour`) and the value (`red`) that descends from it — written on one line, not one combined thing | `colour: red` (the value `red`, under the attribute `colour`) | **False (~S)** | **True (P)** | 

An `attribute: value` line is shorthand for **two** ideas, not one. `colour: red` says the attribute `colour` — a universal accident the Concept *has* — takes the individual value `red`. The inheritance runs **Concept/Example → attribute → value**: the value descends from its attribute, and the attribute from the idea that carries it. The value never descends from the Example directly, and `colour` is not part of the value's name — the attribute and its value merely share a line.

A `Concept: value` line is the same shorthand on the Substance side. The capitalised term stays an ordinary **Concept**; `value` is one Example of it — exactly what a `- value` child would be — written inline as a convenient first Example. The inheritance runs **Concept → Example**, just as with a dashed child. Like any Example, the inline one inherits **all** of the Concept's attributes *and* their values (defaults) — the value (`code --install`) is the Example's own identity, and everything the Concept defines accrues to that Example instance, exactly as for a `- ` child. The inheritance is the Example's, not the Concept's. Further Examples may follow as ordinary `- ` children below it, and the Concept may still divide into **sub-Concepts**, each with Examples of its own — the inline value is simply one Example among however many the Concept comes to have.

#### How to Decide: Concept vs Example vs Attribute

A model only communicates when its ideas are classified correctly. Apply these tests in order:

##### 1. Exhaustion test (Concept vs Example)

If the children together **partition** the parent, they are **Concepts** (subtypes): every child is a subtype of the parent, no two overlap, and nothing of the parent is left over. If the children are merely a selection of items drawn from the world, they are **Examples**.

##### 2. Abstraction test (Concept vs Example)

**Concepts** are abstract groupings humans invent to organise thinking. **Examples** are concrete, real-world instances of the parent you could point at or name. When in doubt: has someone defined a grouping? → Concept. Could you meet it, touch it, or look it up? → Example.

##### 3. Attributes describe, they don't classify

Attributes are lowercase properties a Concept **has**. They are not necessarily leaf nodes; an attribute may have its own children: Examples, Concepts, values, or further attributes.

#### Classical Style Rules

These rules keep a model readable and unambiguous, so that two readers of the same file build the same mental model.

- One Concept with two definitions is ambiguity Alpha forbids. When a Concept name must recur, a distinguishing qualifier prefix restores univocity.
- Use full words; never abbreviate or use synonyms
- Fix all misspellings
- Always singular form: `Human` not `Humans`
- Examples placed higher in the tree are preferable
- Provide as many Attribute Defaults and Examples as possible
- Remove redundant Concepts
- Only decompose further when detail adds meaningful value

## The Single Inheritance Connections

Every idea, no matter how elemental or complex, has exactly one connection, to exactly one other idea, and the chain runs from general (the file name) to specific until it terminates. There is no multiple inheritance, so an idea never means something different depending on which path you took to reach it.

The restriction is deliberate: like a type system, one parent per idea forces you to decide what an idea *is* before you can write it down, and that explicit commitment is one other people can share. Everyone who opens the file, including your future self, extends the same tree instead of rebuilding a private version in their head. Once the structure is that precise, AI can do the synthesis and abstraction with you instead of guessing at what you meant.

The single inheritance chain should not be confused with composition, which Alpha allows: an `Employee` can be composed of a `human`, a `contract`, a `role` attribute, all of which sit in its single-inheritance hierarchy, independently inherited as *Attribute* of the `Employee` *Concept*. Composition is how you assemble a complex idea from parts that each have their own definition, while inheritance is how you say what kind of thing the idea is. The two are independent: an idea has exactly one parent it descends from, but each idea can be further described elsewhere (even off-file).

The single inheritance should also not be confused with qualified Concepts. The concept of `Employee` maybe be used inside another concept, an objective from example `Train Employee`. The `Employee` and the `Train Employee` concepts are distinct and disambigous, but it is the same Concept of `Employee` is evoked in the write and readers mind for both. This is allowable in Alpha, infact it is celibrated inside the objective that the `Employee` was defined elsewhere, with a link. 


| Connections | Expression | Type | Example | Extra Rule |
|------------------------|----------------------------------|-----------|-------------------------------------------|-----------------------------------------------|
| **is-a** | Indent Concept under a term | Indented | `Organisation` → indent → `Business` | |
| **has-a** | Indent attribute under a term | Indented | `Human` → indent → `full name` | |
| **value-is** | Colon after a term | Indented | `full name: Gottfried Leibniz` | |
| **has-another-name** | Parentheses after a term. Provides an alternative or derived name for an idea.  | Indented | `Human (Natural Person)` | If some or all of an attribute's trailing words match a Concept, those words act as an alias, with no parentheses required |
| **has-Example** | Indent Dash prefix after a term | Indented | `Human` → indent → `- Gottfried Wilhelm Leibniz` | |
| **Maps-to** | Indent `...` followed by a note under a token | Indented | `... todo: list the remaining operations` | Marks **only** what is intentionally omitted, still a todo, or held at low confidence — **never a plain description of the line above it**. To explain or rename a term, use a `(parentheses)` alias instead. | 
| **Attribute-is-a-Concept** | Attribute name (or last words) matches a Concept name | Inline | `age integer: 5` → `integer` → `Integer` Concept | |
| **Default-is-a-Example** | Value matches an Example name exactly (case-sensitive) | Inline | `human: Gottfried Wilhelm Leibniz`, where the value references the Example | |

## Rules the tooling checks

Everything below is enforced mechanically by the same linter, whether you run `node verify.js <file.aot>` or edit in VS Code. The extension maps the three layers to three severities: **errors** squiggle red, **warnings** squiggle yellow, and **hints** carry no squiggle. Only errors count toward the violation total `V`; the file verifies when `V = 0`.

### Errors — red squiggle, counted in `V` (the file does not verify)

| # | Rule | What triggers it |
|---|------|------------------|
| 1 | **No tabs** | A tab character anywhere in a line. Indent with spaces only. |
| 2 | **Indent is a multiple of 4** | Leading spaces not divisible by 4 (`spaces mod 4 ≠ 0`). |
| 3 | **No depth jumps** | A line indented more than one level deeper than the line above it — there is no parent at the skipped depth. |
| 4 | **Well-formed Example** | A line starting with `-` but not `- ` (exactly one space after the dash). |
| 5 | **No empty default** | `name:` with nothing after the colon. Supply a value or drop the colon. |
| 6 | **Do not repeat the file name** | A top-level line whose name equals the file name. The file name is already the root Concept. |
| 7 | **A Map holds only Maps** | A `...` Map node with any non-Map child. A Map marks omitted, todo, or low-confidence information; it never describes its parent and does not contain content. |
| 8 | **No "and" in a Concept** | A Concept name containing the word `and` — that is two kinds under one prime. Split it. |
| 9 | **Univocity** | The same Concept name defined more than once. One name, one prime; a recurrence needs a distinguishing qualifier prefix. |
| 10 | **No identical siblings** | Two children of one parent with the same kind, name, **and** value. Siblings may share a slot only if their default values differ. |

Rules 1–10 are the syntactic and arithmetic checks (`src/linter.js`). On top of them, a **subsumption reasoner** (`src/subsumption.js`, after Description Logics' EL) re-derives the Concept hierarchy a *second* time — not from where each line is written, but from the facts each Concept declares (its attributes, defaults, the Concepts it crosslinks to, and any value's inherited ancestry) — and holds the written tree to it. A Concept's definition is read as a conjunction of those facts; `C is-a D` holds when D's whole definition is satisfied by C. A `...` Map child marks a Concept *open* (its facts are necessary but not yet sufficient), which excuses it from these checks. The placements the derived order contradicts are errors, also counted in `V`:

| # | Rule | What triggers it |
|---|------|------------------|
| 11 | **Misfiling** | A Concept's one most-specific genus (the Concept whose full definition it satisfies) is filed somewhere other than where this Concept sits — its facts say it is a kind of a Concept it is not written under. |
| 12 | **Multiple kinds** | A Concept's facts satisfy two genera, neither of which is under the other. A Concept must name one kind; file it under one and crosslink the other, or split it. This is the *real* single-inheritance check (it replaced the tautological gcd one). |
| 13 | **Equivalence** | Two Concepts, neither above the other, carry the identical definition — their facts cannot tell the two kinds apart. Give one a differentia, or merge them. |
| 14 | **Cycle** | A loop of mutual is-a in the derived order (`A is-a B is-a … is-a A`), which no hierarchy can hold. Break it by giving one member a differentia the others lack. |

A genus must rest on at least two declared attribute names — one shared word is coincidence, not a kind.

### Warnings — yellow squiggle, in the Problems panel, but do **not** affect `V`

| # | Rule | What triggers it |
|---|------|------------------|
| 1 | **Singular Concepts** | A Concept name that looks plural (suffix heuristic: catches `Humans`, `Categories`, not irregulars). Use the singular form. |
| 2 | **Measurement needs a target** | A node with an `actual:` default but no `target:`. |
| 3 | **Measurement needs an actual** | A node with a `target:` default but no `actual:`. |
| 4 | **At most eight sub-Concepts** | More than eight sub-Concepts under one node. Group some under an intermediate kind. (Examples and attributes may be any quantity.) |
| 5 | **No lone sub-Concept** | A Concept with exactly one sub-Concept — a kind with one subtype *is* that subtype. Have zero, or more than one. |
| 6 | **No lone sub-Example** | An Example with exactly one sub-Example, by the same reasoning. |
| 7 | **Differentia** | Two or more sibling sub-Concepts with an identical attribute/default *slot signature* — they are told apart by position only. Give each a distinguishing attribute or default. A sub-Concept that asserts no slot at all is excused: with no attributes its `...` is implied, so its differentia is still to come. |

A `...` Map child marks a node intentionally incomplete, which **excuses** warnings 4–7 for that node: the missing siblings or differentiae are declared, not forgotten. A Map says *what is still missing, a todo, or uncertain* — it is never a description of the line above it (use a `(parentheses)` alias to name or explain a term).

### Hints — no squiggle, advisory (the `--suggest` Formal Concept Analysis audit)

Hints come from the Formal Concept Analysis audit in `src/fca.js` (after Wille, 1982): your hand-written Concept tree is checked against the concept lattice your Examples' attributes actually support. The Examples are the formal context's objects; their attribute names and `attribute: value` pairs — direct, inherited, and pulled in through crosslinks — are its columns. Hints appear only when the file already verifies (`V = 0`) and it has **between 2 and 200 Examples** (below 2 there is nothing to analyse; above 200 the lattice is no longer cheap on every keystroke).

The audit also reports the positive case: a `confirmed` line names each Concept whose Examples are *exactly* a formal concept — a grouping the data supports precisely. The hints proper are the three mismatches it finds:

| # | Hint | What it means |
|---|------|---------------|
| 1 | **drift** | An Example carries every attribute the Examples of some Concept share, yet is filed elsewhere. Move it under that Concept, or give the Concept a differentia that genuinely excludes it. (Reported on the Example's line, at the most specific Concept it drifts toward.) |
| 2 | **exhaustion (overlap)** | Two sibling sub-Concepts read as different kinds but their Examples carry identical attributes. Differentiate them, or merge them. |
| 3 | **exhaustion (gaps)** | Some of a parent's Examples match none of its sub-Concepts by attributes. The division misses a kind, or the Example lacks the attributes of its kind. |

A `...` Map child marks a node intentionally incomplete and excuses it from the exhaustion checks; a Concept whose Examples share nothing beyond their ancestor's (a vacuous grouping) is skipped by drift.

Two further hints come from the Gödel numbering in `src/godel.js` and `src/armstrong.js`, under the same `V = 0` gate. A **clash** names two unrelated Concepts or Examples whose Gödel numbers are equal — identical attributes *and* values — so the data cannot tell them apart. Give one a differentia, or merge them. The weaker case (the same attribute *names* with differing values) is reported only on demand by `node verify.js <file.aot> --clashes`, never as an editor hint. A **dependency** names an attribute whose value the Examples always pin down from another — a derivable column worth modelling once; `node verify.js <file.aot> --fd` lists the full inferred set.

### Crosslinks — underlined, Ctrl+click jumps to the definition

The extension (`src/crosslinks.js`) underlines three inline connections and resolves them for go-to-definition; hovering shows the target and its line. They also deepen the `--suggest` analysis by carrying a referenced node's ancestry into the formal context. The two link kinds are told apart by underline style, not colour (the link keeps its token's syntax colour): a **solid** underline points at a Concept, a **dotted** underline at an Example.

| Connection | What links | Underline | Example |
|------------|-----------|-----------|---------|
| **attribute-is-a-Concept** | An attribute or default whose **trailing** words name a Concept (case-insensitive); the longest trailing run wins. | solid | `age integer: 5` → `integer` → `Integer` |
| **concept-contains-Concept** | A Concept whose name contains a run of words naming another Concept (case-insensitive); each longest, non-overlapping run links, but the whole name never does. | solid | `Independent Node` → `Node` → `Node` |
| **default-is-a-Example** | A default value that matches an Example name **exactly** (case-sensitive). | dotted | `human: Socrates` → `- Socrates` |

## What `verify.js` can do

The same linter, reasoner and FCA audit the extension runs are exposed on the command line through `verify.js`. Every invocation takes a `.aot` file as its first argument; the file name (without extension) is the root Concept. The optional flag selects what to do with the parsed, numbered tree.

| Command | What it does | Output |
|---------|--------------|--------|
| `node verify.js <file.aot>` | **Verify.** Runs the full lint pass — the syntactic/arithmetic checks plus the subsumption reasoner — and prints every error and warning as `file:line: …`. | Lists errors then warnings, then a summary: node and edge counts, the largest prime assigned, `violations V = <n>`, the subsumption line (`<n> derived is-a edges, hierarchy consistent/inconsistent`), and `V = 0: true — the file verifies` or `FALSE`. **Exit code 0 when `V = 0`, 1 otherwise** — so it drops straight into a script or CI gate. |
| `node verify.js <file.aot> --ask "X" "Y"` | **Is-a by divisibility.** Tests whether idea `X` is under idea `Y`, by checking `chi(Y)` divides `chi(X)`. | Prints both characteristic numbers and `'X' is [NOT] under 'Y'`. |
| `node verify.js <file.aot> --genus "X" "Y"` | **Genus by gcd.** Finds the nearest common kind of `X` and `Y` as `gcd(chi(X), chi(Y))`, then names the node with that characteristic number. | Prints the gcd, the genus's name, and its full ancestry path. |
| `node verify.js <file.aot> --number "X"` | **Characteristic number.** Prints idea `X`'s number as the product of the primes down its ancestry chain. | `chi(X) = p1 * p2 * … = <n>`, with the path. |
| `node verify.js <file.aot> --suggest` | **FCA audit.** Builds the concept lattice from the Examples' attributes and audits the written tree against it (drift, exhaustion, and `confirmed` groupings). Runs **only on a file that already verifies** — if `V ≠ 0` it prints the errors and exits 1 instead, since a lattice over a broken tree means nothing. Needs **at least 2 Examples**. | Prints the formal-context size (`objects × attributes, formal concepts`), the `confirmed` Concepts, each finding as `file:line: …`, and `suggestions S = <n>`. |

`--ask`, `--genus` and `--number` look the ideas up by exact name; an unknown name exits with code 2. These four arithmetic operations are the Leibniz point made runnable: an is-a claim, a common genus, or an idea's full ancestry is a computation over integers, not an opinion.

## Example

```aot
tbd
```

## File Format

- Extension: `.aot`
- Indentation: exactly 4 spaces per level (Do NOT use tabs)
- Every line is a node
- The **file name is the root Concept**. Do not repeat it as the first line; the file's top-level nodes are already its children. For example, `Human.aot` begins directly with `full name`, `age`, and so on.

## Design Rules

The following rules govern how Alpha handles inheritance, incomplete models, and the tension between structure and data.

### Aristotelian

- You never think from nothing. Every new thought extends structures you already know. (*Posterior Analytics* I.1)
- You place an idea by naming its nearest kind, the most general accurate term (the *genus*, its parent), together with the qualifier that sets it apart from its siblings (the *differentia*).
- **Essence and accident**: **Attributes** defined on a **Concept** are *essential*. They are part of what the idea is. So every child Concept and Example inherits them necessarily (attributes are inherited, never Examples). **Attribute**s an **Example** introduces on its own are *accidental*. True of that Example but not of its kind. A schema therefore introduces essence; an Example may add only accidents, never a new essential attribute (adding further essential attributes is the child Concept's prerogative, not the Example's). **Essence versus accident**: Concepts and Concept Attributes nodes are essentially the form of your ideas. Everything else in Alpha is accidental ideas (*Metaphysics* Z)
- **Assimilate facts**: Convert raw data into Example-attribute-value relationships under a Concept
- **The four causes complete every explanation**: final (motivation), material (graph), formal (function), efficient (workflow). The primitives of Alpha are built on them. (*Physics* II.3)
- The alphabet of thought primitives combines Aristotle's *Categories*, *Causes*, *Prior Analytics*, and Kipling's *Six Serving Men*.

### Gottfried Wilhelm Leibniz's proposed alphabet of human thought

- A universal vocabulary. Every idea reducible to primitive elements and every complex idea expressible as a combination of those elements
- A new way forward for AI. To allow argument to be verifiable like arithmetic

### Pragmatic

- **Plain text holds its shape**: prose hides structure and diagrams don't scale.
- **Truth shows in consequences**: a definition is good when it lets two actors work on with the meaning and verify it.
- **Content over structure**: Prefer Examples + attributes + defaults over creating new Concepts. Keep the Concept tree lean.



```aot
Parent
    essential parent attribute: normal value
    Child
        essential child attribute not in parent
        - Child Example
            essential parent attribute: new value
            essential child attribute not in parent: value
            child example attribute
        ... generally there is more than one example per Concept
    ... generally there is more than one child per parent
```

`Child` inherits `essential parent attribute: normal value` from `Parent`. The `- Child Example` overrides that inherited value with `new value`, assigns a default to `essential child attribute not in parent`, and adds `child example attribute` — an accidental attribute not present in the `Child` Concept. (The two `...` lines mark the example as deliberately incomplete, which is the only thing a Map does.)

## Primitives

Thoughts can be used as a tool. The tool is to transform, and to be able to transform, a clear understand of the subject (the file name) need to be defined.

Primitives require no special `.aot` syntax. They give you a checklist of questions any transforming process must answer. The Ideas and Connections say what an Idea *is*; the Causes say why it exists and how it is produced.

The primitives do not link to one another; each is a tree of its own, and no cause terminates in another. This is the general rule, not a special case. A complete explanation holds all four in balance, with each cause answered with respect to the others and none reduced to a pointer into its neighbour (*Physics* II.7: the formal, final and efficient causes often come to one, which is the file name in Alpha).

#### The four causes

Aristotle's complete answer to *why a thing is and how it comes to be* (*Physics* II.3). The primitive names are always grouped as examples (not said of, not present in).

Each of these Primitives has a said-of and a not-said-of part to guide the user on how to model. For example, the only concepts are Stakeholder, Entities, Objectives and Workflows, and these cannot be examples or Attribute Values, while measurements, records, classes and dependencies can only be examples or Attribute Values.

| Cause | Description | Native question | Primitive | Said of | Not Said Of |
|-----------|---------|------------------|--|------------------|------------------|
| **Final** | for the sake of which | Why, and for Whom | Motivation | Stakeholder (Who) | Measurement (How Much) |
| **Material** | that out of which | made of What | Graph | Entity (Where: the boundary that fixes where the Record resides in reality) | Record (What) |
| **Formal** | the form, the arrangement of parts | What it is, How it is achieved | Function | Objective (How: a parent's form is all its child objectives taken together) | Class (Which) |
| **Efficient** | the agent and the means | by Whom, in what order | Workflow | Operation (Item in use) | Dependency (When) |

The questions in the Function tree run in different directions. Ask *How* downward: a parent objective is achieved exclusively through all of its children together. No single child is the how; the complete set is, and that arrangement is the parent's form (*Metaphysics* Z: the form of a house is the arrangement of its bricks, not the bricks). Ask *Why* upward: the answer to a child objective's why is its parent. The root is one or more objectives that cannot be reduced any further; their why is not answered by another node but balanced with the How, the whole tree beneath them. Ask *Which* of an objective to reach a Class. Alpha follows Aristotle in taking the form of a working thing to be its function: an axe that cannot chop is an axe in name only (*De Anima* II.1).

The Function tree relates to it differently: it *is the form of the motivation*, the arrangement that realises it, built from the material the Graph provides and carried out in the order the Workflow makes most efficient. 

*Where* and *When* are not causes in their own right; they are the questions a cause's concepts answer. Matter is never placeless: everything that exists is somewhere, and place is the innermost boundary of what contains it (*Physics* IV). So the Entity is the Where: it bounds where a Record resides in reality, which is why the Graph primitive carries data residency, latency and disaster recovery. Likewise the Dependency is the When: it bounds when the efficient process may run. Kipling's six serving men label the columns, the four causes label the rows.

---

### Motivation Primitive

Focus: **what and why things are measured** by **who is the beneficiary of them**

The Motivation Primitive describes what you are trying to achieve and who owns it. It models the beneficiary alongside the measurements they use, so every measurement records its owner.

Every measurement carries both a `target` value and an `actual` value. Alpha requires both because a measurement only means something when you can compare the actual against the target.

Example

```aot
- Motivation
    last update time: 2026-03-31
    measurement interval: Quarterly
    Mike (Sales)
        - revenue growth
            actual: 5%
            target: 20%
            measurement operation used: Formula
            updating author: Mike
            - this year revenue
                actual: $105M
                target: $120M
                updated time: 2023-03-22
                updating author: Brett
                influence: Red
                measurement operation used: Formula
                - new clients onboarded
                    actual: 35
                    target: 20
                    measurement operation used: Sum
                    influence: Green
                    updating author: John
                - customer basket size
                    actual: $5,235,345
                    target: $6,000,000
                    influence: Red
                    updating author: Jake
                - existing customer revenue lost (churn)
                    actual: $21M
                    target: $0
                    influence: Red
                    updating author: Matt
            - last year revenue
                actual: $100M

    John (Development)
        - Functionality
            actual: C
            target: A
            number of grades: 5
            updated time: 2026-03-26
            updating author: John
            measurement operation used: Grading
            - lines of code
                actual: 265,235
                target: 200,000
                measurement operation used: Observation
                influence: Red
            - business cases handled
                actual: 23
                target: 56
                measurement operation used: Observation
                influence: Red
        - quality
            actual: A
            target: C
            number of grades: 5
            measurement operation used: Observation
            updating author: John
```

The Concepts used in the Motivation Primitive:

```aot
Beneficiary
    Human (Natural Person)
        first name: Alida
        surname: Zondo
        title
        date of birth
        gender
        home language
        nationality (country)
        is living: yes
    Organisation
        Business
        Government
        N G O
        Foundation
        trading name
        no terminology name
        is business unit
        is user classified
        incorporated country
        nickname
        tax number
Measurement
    beneficiary
    superordinate measurement: None
    name
    expected value
    actual value
    measurement operation used
        - Observation
            characteristic (trait)
            class
            stereotype
        - Formula
            - Arithmetic
                - Addition (Sum)
                - Subtraction
                - Multiplication (Product)
                - Division
                    - Ratio
                - ...
            - Statistical
                - Maximum
                - Minimum
                - Average
                    - Mean
                    - Mode
                    - Median
                - Standard Deviation
                - Sample Size
                - ...
        - Grading
            grade interval minimum
            grade interval maximum
            number of grades
        - Ranking
            minimum ranking
            maximum ranking
            is minimum ranking open: false
            is maximum ranking open: false
        - Rescaling
            - Fahrenheit to Celsius
            multiplier measurement: 1
            offset scaling magnitude: 0
            exponent (power)
        - Refinement
    data type
        - Numeric
            offset scaling magnitude
                - 0
                    is integer: Yes
                - ... anything other than 0
                    is integer: No
            numeric base: 10
            is signed: true
            relative zero point
            - Amount
                - Cyclomatic Complexity
                - Lines Of Code
            - Current
                - Amps
            - Length
                - Meter
            - Light
                - Candela
            - Mass
                - Kilogram
            - Temperature Unit
                - Kelvin
            - Time
                - Second
            - ...
        - Text (Characters)
        - Audio
        - Video
        - Image
        - Ignore
        minimum number of elements: 1
        maximum number of elements (length): 1
            - 1
            - container
                - 2
                - ...
            - stream (unknown quanity)
                end of stream
        validation rule
            - Valid Value Enumeration
            - ...
        minimum bit count: 0
        maximum bit count: infinite
        is constant value: No
    superordinate measurement influence
        - Red
        - Amber
        - Green
        - None
    instrument
    author
    start time
    updated time
    updating author

```
---
### Graph Primitive

Focus: **where things reside** (the *acting-on* Concepts) and **what data and entities exist** there (the *acted-upon* Examples).


Relevant when: data residency laws, latency, location-dependent processes, disaster recovery.

```aot
Repository
    path
    - Source code
        path: src/
    - Configuration
        path: config/
    - Tests
        path: tests/
...
```

---

### Function Primitive

Focus: **how the system does it**, decomposed as a tree.

### Example

```aot
    Do Value Chain Activity
        Primary
            Promote brand offerings (Marketing & Sales)
                - Launch social media ad campaigns
                - Negotiate vendor contracts with retail partners
                - Publish promotional discounts for seasonal sales
            Manage inbound materials (Inbound Logistics)
                - Unload raw steel from delivery trucks
                - Inspect organic ingredients for quality assurance
                - Store digital components in temperature-controlled warehouses
            Transform raw inputs (Operations)
                - Assemble electronic circuits on the production line
                - Bake artisan bread in commercial ovens
                - Package finished apparel into retail-ready boxes
            Distribute finished products (Outbound Logistics)
                - Load delivery fleets for regional distribution
                - Fulfill online orders via third-party couriers
                - Dispatch bulk cargo to international shipping ports
            Support final customers (Service)
                - Repair broken hardware under warranty agreements
                - Process product returns via customer service
                - Troubleshoot software glitches over live chat
        Support
            Govern company infrastructure (Firm Infrastructure)
                - Audit financial ledgers
                - Draft legal contracts
                - Secure internal networks (Against cyber threats)
            Develop human talent (Human Resource Management)
                - Interview engineering candidates
                - Conduct safety training
                - Administer employee benefits
                    - payroll systems
                    - ...
            Advance proprietary technology (Technological Development)
                - Code automated features
                - Test alternative materials
                - Upgrade database servers
            Source essential goods (Procurement)
                - Source raw fabrics
                - Purchase office equipment
                - Approve vendor bids
```
#### Naming Rules

- **Objective**: verb + qualified object → `Calculate Payment` (One verb per function, named objectively)
- **Types**: conventionally nouns only, expressed as Example ideas → `- Payment Type`

#### Forbidden in Functions

- "And" (always split the function into two siblings)
- Vague terms for services ("manage", "ensure")
- Performance related terms ("good", "acceptable")
- Information management ("information", "data", "content", "info")
- Political words ("Business", "IT", "Management", "Support", or "Execution")
- Flow words ("then", "next")

#### Decomposition Rules for Objectives

- 3 to 7 sub-objectives per parent objective
- Test each split with the **Why**, **How**, and **Which** questions described under [Primitives](#primitives)

#### Pitch Level

- Start two levels of granularity above the detail you need, then prune until every leaf is directly executable.
- Remove anything that does not serve the model.

#### Include attributes

Attributes may be attached to functions to describe their arguments and results.

---

### Workflow Primitive

Focus: **what items are used when**.


    
```
