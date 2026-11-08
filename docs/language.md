# The language

[Back to the README](../README.md)

## The notation in sixty seconds

Yes, the world sometimes feels like a tangled lattice: Socrates is an example of a human, but also a philosopher, and also an Athenian. Alphabet of Thought's discipline — one parent per idea, relationships modelled as crosslinked ideas of their own — is exactly what makes a file readable at a glance instead of a diagram you need a lie-down after.

```aot
- First Example
    Human
        is alive
        - Socrates
            is alive: No
    Occupation
        - Philosopher    
    City
        - Athens
            resident known as: Athenian
    City of Residence
        human
        city
        - Socrates' Residence
            human: Socrates
            city: Athens
    Employment
        human
        occupation
        - Socrates' Job
            human: Socrates
            occupation: Philosopher
    
```

Read it like this:

- Capitalised lines (`Human`, `City`) are **Concepts** — kinds of thing.
- Lowercase lines (`is alive`, `city`) are **attributes** — properties a Concept has.
- `- ` lines (`- Socrates`, `- Athens`) are **Examples** — concrete individuals.
- `attribute: value` lines (`is alive: No`) give an attribute a concrete **value**.
- `human: Socrates` is a **crosslink**: the value names an Example defined elsewhere, and the extension underlines it — Ctrl+click jumps to the definition. Socrates has exactly one parent (`Human`), yet participates in residence and employment through Concepts of their own. Single inheritance for what a thing *is*; crosslinks for what it *relates to*.

## Quick start

1. **Install the extension.** Search for **alphabet of thought** in VS Code's Extensions view, or run `code --install-extension Jakus.alphabet-of-thought`. To build the current source instead, `python install.py` packages it, installs it and tells you to reload the window. You get syntax colouring, the linter, crosslinks, and the table editor.
2. **Create a file.** Name it after the subject: `Human.aot`, `Sales.aot`. The **file name is the root Concept** — do not repeat it as the first line; the file's top-level lines are already its children.
3. **Pick a real subject.** Take something you currently explain badly in a document — your team's metrics, a domain model, a process with a known bottleneck — and pick the matching [rationale](why.md#the-four-rationales) as a skeleton.
4. **Write indented plain text using only four kinds of line** (see the [language reference](#language-reference)). Start with natural Concepts and build up from facts, or normalise an existing data structure and derive relations from it. Either way, the move is the same: generate the facts first, then branch out.
5. **Fix squiggles until `V = 0`.** The places where you can't decide on a parent are the places where you didn't actually know what you meant — which is the point. (The same check runs from the terminal: `node verify.js <file.aot>`. `node check.js` also calculates every formula and rule.)
6. **Ask an AI to explain what you wrote.** Paste the file into an LLM and ask for an explanation. You may learn something about a subject you thought you knew. (See [Using Alphabet of Thought with an LLM](llm.md).)

## Language reference

### File format

- Extension: `.aot`
- Indentation: exactly 4 spaces per level. A tab in the indentation is an error; a tab further along a line is only text.
- **Write in any language.** Upper and lower case are read from Unicode, so `Éclair` is a Concept and `één: 1` an attribute with its value, and the colours follow. A script with no capitals (Japanese, Arabic) has no case to go by: `名前: 太郎` is a value, a bare `名前` is a Concept, and table columns work as they always do. The extension's own messages stay in English, and its only dictionaries are English, so `Ctrl+.` turns spelling checks off (see [Settings](settings.md)).
- Every non-blank line is a node in the tree. A line's parent is the nearest line above it that is indented one level less.
- The **file name is the root Concept**. `Human.aot` begins directly with `full name`, `age`, and so on — never with a `Human` line.

### One parent per idea: the parent–child chain

Every idea in Alphabet of Thought has exactly one parent. A parent may have many children; a child never has two parents. The chain runs from the general (the file name) to the specific, until it terminates. An idea never means something different depending on which path you took to reach it.

The restriction is deliberate. The parent–child chain **is a type system** — not *like* one. Each Concept is a type, each sub-Concept a subtype, each Example a value inhabiting it, and the linter checks membership by divisibility of the characteristic numbers exactly as a type checker checks a term against its type. Because the primitives are this precise, you are not limited to Alphabet of Thought's own taxonomy: you can literally build the type system you want — a programming language's, a taxonomy's, a schema's — as a tree in Alphabet of Thought and have it mechanically checked. One parent per idea forces you to decide what an idea *is* before you can write it down, and that explicit commitment is one other people can share: everyone who opens the file extends the same tree instead of rebuilding a private version in their head. What a thing relates to, as opposed to what it *is*, is modelled with [crosslinks](#crosslinks).

### The four kinds of ideas

Alphabet of Thought agrees with Aristotle that everything you can think falls into four categories (*Categories* 2, 1a20–24), produced by crossing **said-of** (universal vs. individual) with **present-in** (substance vs. accident):

| Kind | Aristotle's name | How to recognise it | Said of (S) | Present in (P) | Example |
|------|------------------|---------------------|-------------|----------------|---------|
| **Concept** | Universal Substance | First letter capitalised | S | ~P | `Human` |
| **Example** | Individual Substance | `- ` (dash + space) prefix, or the value in a capitalised `Concept: value` line | ~S | ~P | `- Socrates` |
| **Attribute** | Universal Accident | All lowercase | S | P | `is alive` |
| **Attribute Value** | Individual Accident | The value after the colon in a lowercase `attribute: value` line | ~S | P | `is alive: No` |

#### Concept — a kind of thing

A Concept defines a class or type of idea. Indenting one Concept under another asserts the child **is a kind of** the parent — a sub-Concept is always an *is-a*, never a *has-a*.

- A Concept name may recur elsewhere only when a distinguishing qualifier prefix makes it unique (see [Univocity](checks.md#errors--red-squiggle-counted-in-v-the-file-does-not-verify), rule 9).
- Never put "and" in a Concept name — that is two kinds under one name. Split it into two sibling Concepts.
- Start two levels of granularity above the detail you need, then prune until every leaf is directly useful. Remove anything that does not serve the model.
- Prioritise Concepts by relevance; keep the Concept tree lean.

```aot
Mammal
    Human
```

#### Example — a concrete individual

An Example names a real, concrete instance of its parent — something you could point at, meet, or look up. Model data as sets of Examples.

```aot
Human
    - Socrates
```

**A Concept's default.** A capitalised `Concept: value` line states the Concept's **default**: what any attribute *typed by* that Concept reads wherever nothing values it.

```aot
Currency: EUR
Invoice
    currency
    - INV-1
    - INV-2
        currency: USD
```

`INV-1`'s currency is `EUR`, from the default. `INV-2` says `USD` itself.
- The attribute must be typed by the Concept: through its last words (`currency`, `home currency`), or through its `(alias)`.
- A value equal to the default links, dotted, to the Concept's line, and the completion offers it first.
- A default is **not an Example**: it is no row of the Concept's CSV, no `@Currency` row and no member of the Concept's extension. Examples are written as `- ` lines or as rows.
- A default is stated, not derived. `Currency: EUR =pick()` is an error for now. A literal `=` in it is doubled, as in any value.
- (Before 1.13 the value was an inline first Example. See the [CHANGELOG](../CHANGELOG.md) for what that changed.)

#### Attribute — a property a Concept has

An attribute is a lowercase line defining a property its parent **has**. Attributes describe; they never classify.

- Every attribute is itself a Concept that can be expanded elsewhere, whether or not it is defined elsewhere (see [Crosslinks](#crosslinks)).
- Non-nullable attributes are listed first; attribute order is otherwise meaningless.
- Attributes are not necessarily leaf nodes: an attribute may have its own children — Examples, Concepts, values, or further attributes.
- Remove attributes that do not serve the model.

```aot
Human
    is alive
```

#### Attribute Value — the concrete value an attribute takes

An `attribute: value` line is **two** ideas, not one: the attribute (`colour`) — a universal accident the Concept has — and the individual value (`red`) that descends from it, written on one line.

- The inheritance runs **Concept/Example → attribute → value**: the value descends from its attribute, and the attribute from the idea that carries it.
- The value never descends from the Example directly, and the attribute name is not part of the value's name. The attribute and its value merely share a line.

```aot
- Socrates
    is alive: No
```

### Classifying correctly: four tests

A model only communicates when its ideas are classified correctly (Concept vs. Example vs. attribute). Apply these tests in order:

1. **Unity test (Concept vs. Example).** If the children together **partition** the parent — every child is a subtype, no two overlap, nothing of the parent is left over — they are **Concepts** (subtypes). If the children are merely a selection of items drawn from the world, they are **Examples**.
2. **Abstraction test (Concept vs. Example).** Concepts are abstract groupings humans invent to organise thinking; Examples are concrete instances you could point at or name. When in doubt: has someone defined a grouping? → Concept. Could you meet it, touch it, or look it up? → Example.
3. **Attributes describe, they don't classify.** If a lowercase line is telling you *what kind* the parent is, it is a misfiled Concept. If a capitalised line is telling you a property the parent *has*, it is a misfiled attribute.
4. **Rigidity subtype test**: Must every instance always be this? a Person is always a Person; a Manager isn't always a Manager, so it is not a kind of Person

### Attribute inheritance

Attributes defined on a Concept are inherited by every child Concept and Example. The rules in one snippet:

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

`Child` inherits `essential parent attribute: normal value` from `Parent`. `- Child Example` **overrides** that inherited value with `new value`, assigns a value to `essential child attribute not in parent`, and adds `child example attribute` — an accidental attribute not present on the `Child` Concept. The two `...` lines mark the model as deliberately incomplete, which is the only thing a Map does.

**A part inherits nothing from its whole.** Inheritance runs down the kinds — a Concept, and the Concepts above it — never from one Example to the Example beneath it. A sub-Example is a part of its parent Example, or a finer instance of it, not a kind of it: `- Wheel` under `- Bicycle` does not weigh what the bicycle weighs. The Gödel numbers, the FCA audit, the CSV mirror and Python all read it so.

### Concepts across files

One subject per file is the rule, but a person, a system or a measure worth modelling turns up in more than one subject. When the same Concept is written in two files, Alphabet of Thought reads the two halves logic already gives it and treats them differently:

| | What it is | Across files |
|---|---|---|
| **Intension** | the definition: the attributes and values it declares, and the kind it is filed under | **must agree** — and the editor makes it agree on save. |
| **Extension** | the Examples it lists — the individuals it vouches for | **is a partial sample.** The repo-wide truth is the union, and differences are never a conflict. |

Every occurrence is a **peer**. No file owns a Concept, and none is exempt from saying it is partial. Two files each listing the motivations their own subject needs are not in conflict at all:

```aot
monthly close.aot                          bank recon.aot
- Motivation                               - Motivation
    Jakus                                      Jakus
        role: financial controller                 role: financial controller
        - Do Monthly Processing                    - All Transactions Are Reconciled
        ... 4 more in bank recon.aot:2             - Transactions Are Reconciled Correctly
                                                   - Incorrectly Reconciled Transactions ...
                                                   - Future Transactions Are Reconciled ...
                                                   ... 1 more in monthly close.aot:2
```

**Saving a file makes that file agree with the repo**, as far as agreement can be reached without a human deciding anything. It is additive: nothing you wrote is ever deleted, and no other file is touched — saving `monthly close.aot` writes to `monthly close.aot` and nothing else, so peers converge as you save each of them.

| Difference | On save |
|---|---|
| A peer declares an attribute or value this occurrence does not have in force | **written in.** `role: financial controller` above was declared in one file and appears in both. An attribute a peer merely *inherits* is already in force here too, and is not copied. |
| A same-named Example is given an attribute here that it lacks there | **written in** — an Example has an intension too, and the same rule settles it. |
| The Example lists differ | **one `...` line, kept true** (below). The Examples themselves stay where they are. |
| One attribute carries two values | **left alone, an error on every side.** Only you know which is right; the lightbulb offers *Set '`attr`' to '`value`' everywhere*. |
| One Concept is filed under two kinds | **left alone, an error on every side.** Moving a Concept between kinds is a modelling decision. |

**One side saying less is never disagreement.** A file silent about `role` does not contradict one that sets it — it simply says less, and the save fills the rest in.

#### The `...` line

Because the attributes are written into every file and a surviving disagreement is an error with its own squiggle, the `...` carries the one thing that cannot be filled in: how many Examples live elsewhere, and where.

```aot
... 4 more in bank recon.aot:14
... 7 more in bank recon.aot:14, payroll.aot:9
... 11 more in bank recon.aot:14, payroll.aot:9, vat return.aot:22, …
```

The total comes first: the Examples written elsewhere and not here, each counted once however many files list it. Then come `file:line` locations, a file name with spaces included.
- **Ctrl+click** a location to open that file at that Concept, on the line it stands on now, which a peer edited since may have moved.
- **Hover `N more`** for those Examples, grouped by the file each is written in.
- **Hover a file name** for that file's Examples of the Concept.
- **Hover anywhere else on the line** for the whole extension.

Every Example in a hover is a link to where it is written, and a long list ends with how many more it holds. Past three peer files the line stops growing and the rest moves to the hover.

A `...` line **you** wrote is never touched: only the maintained shape (`N more in …`) is rewritten, so `... still to do` sits beside it untouched. **A maintained line that has gone stale is deleted on save**: once no other file lists the Concept (the peer deleted, renamed, or its file gone), the note has nothing true left to say, and one left behind at the top of the file when its Concept's line was deleted goes too. Turn the whole thing off with `aot.autoReconcile`, and the drift is reported as a warning instead of being closed for you. Files that were never open when a peer changed catch up with **AOT: Reconcile Concepts Across Files**, or `node verify.js --workspace --reconcile`.

**A Concept written as a table carries its `...` one level under the grid.** A table's first header cell *is* the Concept, so one level under the grid is one level under the Concept — where its children belong — and a `...` written there is read as **the table's own**, never as a note about the row it happens to follow:

```aot
Employee|role     |department
Alice   |Developer|Engineering
Dave    |Writer   |Marketing
    ... 4 more in team roster.aot:12
```

That is where a table keeps the Concept's own Map, and it is why the note is found again on the next save and kept true rather than written a second time. A *row* that needs a `...` of its own carries it in a column headed `...`, its cell holding what the line would: `Bolt|200|... terms still open` is `- Bolt` with `... terms still open` under it, and a bare `...` in the cell is a bare `...`. The flip writes each as the other, and a `...` or `- ...` between Examples in line form becomes a `...` line in place in the table. Everything else applies to a table either way: attributes a peer declares arrive as new columns, and a row gains the values its Example was given elsewhere.

### Aliases and Maps

Alphabet of Thought is **not a word-explanation language**: a definition terminates in Examples and data, never in words explaining other words — a dictionary chain of synonyms proves nothing and checks nothing. What *is* possible is renaming: an alias gives the same idea a second name without pretending to define it.

| Notation | Syntax | Purpose |
|----------|--------|---------|
| **Alias** (has-another-name) | Parentheses after a term: `Human (Natural Person)` | Provides an alternative or derived name for an idea. If some or all of an attribute's trailing words match a Concept, those words already act as an alias — no parentheses required. |
| **Map** | An indented `...` line, optionally followed by a note: `... todo: list the remaining operations` | Marks **only** what is intentionally omitted, still a todo, or held at low confidence — **never** a plain description of the line above it. To explain or rename a term, use an alias instead. A Map excuses its parent from the completeness checks (see [Verification](checks.md)). One shape, `... N more in file.aot:12`, is [maintained for you](#concepts-across-files) and says where the rest of a Concept's Examples live; every other Map is yours alone. A table row carries one in its [`...` column](tables.md). |

**`Ctrl+/` takes a line out of the model and puts it back.** The comment mark is `...`, so a commented-out line is a Map. `... Rail|20` in a table is no row: the Example is gone from the model and its CSV, the table stays one table, and every redraw keeps the line where it stands, as written. A Map excuses its parent from the completeness checks, so a commented-out line does too, and commenting out a parent but not its children gives the usual "Map has children" error.

### Numbering

Lists and taxonomies often want visible order, so Alphabet of Thought maintains it for you — on **save** and on **Format Document**, never mid-keystroke:

- **Examples.** Give any Example an `N. ` prefix (`- 1. Mix`) and all of that Concept's Examples number sequentially in listed order — unnumbered names gain a number, stale numbers correct — and every same-file reference to a renamed Example (crosslink values, table name cells, the `@` references in derivations) follows, exactly as F2 would rename it. A list with no numbered Example is never touched.
- **Concepts.** Type `1. ` on any Concept and every Concept in its scope numbers in document order — top Concepts `1. `, `2. `, sub-Concepts dotted down the is-a chain (`1.1`, `1.1.1`). The scope is the whole file normally; a Concept filed under an Example or attribute numbers only that parent's Concepts. A fully numbered scope keeps its numbers true to position, so moving a Concept and saving corrects them.
- **The way out is one deletion.** Delete any one Concept's number and the whole scope's numbering comes off on the next save, parents included. (A new unnumbered Concept in a numbered scope reads the same as a deletion and switches numbering off; retype `1. ` on the top Concept to bring it back.)
- **Numbers are presentation, never identity.** Name resolution strips the prefix everywhere, so an attribute `trip` still types by the Concept `1. Trip`, `@Trip@column` still resolves, and `2. Animal` beside `Animal` is still a univocity error. Numbering — or un-numbering — a tree breaks no reference and rewrites none. A number without its dot is never a prefix: `- 35` and `3 Body Problem` keep their names whole.

See [`examples/numbering.aot`](../examples/numbering.aot) for a file to try it on.

### Crosslinks

Single inheritance answers what an idea *is*; crosslinks answer what it *refers to*. The extension (`src/crosslinks.js`) underlines three inline connections, resolves them for go-to-definition (Ctrl+click jumps; hover shows the target and its line), and carries a referenced node's ancestry into the FCA audit. Resolution is **repo-wide**: a reference whose target lives in another `.aot` in the workspace links to it, and Ctrl+click opens that file (the local file wins ties). Link kinds are told apart by underline style, not colour — the link keeps its token's syntax colour:

| Connection | What links | Underline | Example |
|------------|-----------|-----------|---------|
| **attribute-is-a-Concept** | An attribute or value whose **trailing** words name a Concept (case-insensitive); the longest trailing run wins. When the attribute carries a `(alias)`, the alias is the **only** link — the trailing-name run is suppressed. | solid | `age integer: 5` → the `Integer` Concept; `duration (time)` → `Time`, never `Duration` |
| **concept-contains-Concept** | A Concept whose name — or `(alias)` — contains a run of words naming another Concept or another Concept's alias (case-insensitive); each longest, non-overlapping run links, but the whole name never does. An alias that is wholly another Concept's name links whole instead, and is an error (rule 11). | solid | `Independent Node` → the `Node` Concept; `Human (Natural Person)` → `Person` |
| **value-is-an-Example** | A value that matches an Example name (case-insensitive, like every link). A table's parent cell links the row it names. | dotted | `human: Socrates` → `- Socrates` |
| **value-is-a-default** | A value equal to its type's default (`currency: EUR` beside `Currency: EUR`). | dotted | `currency: EUR` → `Currency: EUR` |
| **attribute-is-a-unit** | An attribute whose `(alias)` names a [unit](formulas.md#numbers-and-units), which every file already has. | none: hover says what it is | `distance (km)` → Unit ▸ Length ▸ km |

#### Composition

Attributes are sometimes atomic values, but Alphabet of Thought also allows an attribute to be defined as a Concept somewhere else. An `Employee` can be composed of a `human`, a `contract`, and a `role` attribute, each of which sits in its own parent–child chain and is independently inherited as an attribute of the `Employee` Concept. Crosslink composition is how you assemble a complex idea from parts that each have their own definition; inheritance is how you say what kind of thing the idea is.

#### Attribute alias

A relational attribute referencing another Concept uses that Concept's name, written lowercase: an attribute `human` on `City of Residence` links to the `Human` Concept automatically.

An `(alias)` types an attribute the same way, by the Concept it names: `type (category)` is typed by `Category`. A [unit](formulas.md#numbers-and-units) is such a Concept that every file already has, so `distance (km)` is typed by `km`, and a plain number in it is in kilometres.

#### Concept differentia

A Concept such as `Employee` may be used inside another Concept's name — for example `Train Employee`. The two Concepts are distinct and unambiguous, yet it is the same idea of `Employee` that is evoked in the writer's and reader's mind for both. Alphabet of Thought celebrates this: the containment crosslink records that `Employee` was defined elsewhere.

Every attribute the child adds must be a **differentia** — a fact that makes it a *narrower kind of the same genus*, answering "what kind of the parent is this?". A child may carry more attributes than its parent; what matters is not how many it adds but that they narrow the *same* kind. If the added facts instead describe a separate dimension the thing merely *has* — a format, a property on its own axis — then you have written a has-a as an is-a: the Concept now names two kinds at once, and the subsumption reasoner flags it (rule 12, Multiple kinds). Pull that has-a out into its own attribute or Concept and crosslink it, so the child's place in the tree stays purely about what it *is*.

#### Values against their Concept

When an attribute names a Concept and that Concept **lists its Examples**, the attribute's values are answerable to that list. Typing such a value pops a **dropdown of the Concept's Examples** — on a line-form value and in a typed column's table cell alike, archived CSV values listed after the live ones. `person: James`, on an attribute typed by a `Person` whose only Example is Socrates, says James is a Person while the file never says who James is. Alphabet of Thought hints the value and offers the Quick Fix that closes the gap — **Add 'James' as an Example of 'Person'** — which lists James where Person is already written: a row on its table, or a `- James` line under its last Example, cursor left on the new Example so you can carry straight on. Picking from the dropdown and coining a fresh Example both keep the model whole.

```
Person  |nationality
Socrates|RSA
Integer
    - 1
    - 35
Measurement
    person: James        <- hinted: not an Example of Person (Socrates)
    age integer: 5       <- hinted: not an Example of Integer (1, 35)
```

This is a **gap in the model, not a contradiction in it**, so it hints exactly as spelling does — on its own span and on hover, never in the Problems panel, never in `V` — and turns off with `aot.exampleHints`. `verify.js` prints it as a warning, and [`check.js`](cli.md#the-calculating-check) fails on it when the list is in the same file. A list in another file is that file's partial sample, so there it stays a warning. An attribute may mention a Concept without being valued by one, so three things keep the hint to values that were genuinely trying to name an Example:

- **The Concept must list Examples.** One that lists none states an open vocabulary, where any value is fair — `name: Socrates` is prose, not a claim against a listed set.
- **The value must be the same kind of value its Examples are.** `maximum worker pool: 1` measures the pool; it does not name one of Role/Asset/Function, and a number never could. `age integer: 5` *is* a number among the numbers 1 and 35, so it genuinely misses.
- **The value must not be a truth value.** `present in: False` says a fact holds; it does not nominate an Example.

## Starting a model

There are two ways in, and they meet in the middle:

- **Normalise an existing structure.** Take a schema, a spreadsheet, or a document you already have, file its rows as Examples, and derive the Concepts and attributes from what the data bears out.
- **Start axiomatically.** A flat list of Examples: file every Example directly under the file-name root. This is the [content-over-structure](why.md#pragmatic) rule taken to its limit, and the inverse of normalising. There is no hard part to an axiomatic start, because thinking is never complete — any checklist of the questions a subject must answer will do. Four good ones, in order of sophistication:
  - **Your todo list.** Each open item is an Example the model is missing; emptying the list and completing the model are the same act.
  - **Kipling's six serving-men.** *What, Why, When, How, Where, Who* ("I keep six honest serving-men; they taught me all I knew"). Six Examples to start with.
  - **Aristotle's ten categories.** Substance, quantity, quality, relation, place, time, position, having, action, being-acted-upon (*Categories* 4). The widest net for *what can be said of a thing*: each category is one more attribute to ask after.
  - **The Alphabet of Thought rationales.** Motivation, Graph, Function, Factor. All real knowledge straddles all four; if you cannot produce them all, you do not yet fully understand the subject.

Whichever you use, the move is the same: generate the facts first, then branch out from there.

## Style rules

These rules keep a model readable and unambiguous, so that two readers of the same file build the same mental model:

- One Concept with two definitions is ambiguity, and Alphabet of Thought forbids it. When a Concept name must recur, a distinguishing qualifier prefix restores univocity.
- Use full words; never abbreviate, and never use synonyms for a name already in the file.
- Fix all misspellings.
- Prefer placing Examples higher in the tree.
- Provide as many values and Examples as possible.
- Remove redundant Concepts.
- Only decompose further when the detail adds meaningful value.
