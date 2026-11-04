# Alpha (`.aot`)

**Write your thinking as plain text a machine can prove consistent.**

Alpha is the world's smallest knowledge-representation notation: an indented tree of plain text with only four kinds of line. Because the language is that small, its tooling can be an exact referee instead of a guesser — a VS Code extension lints every `.aot` file as you type, checking it against the strongest ideas the history of logic has produced: Aristotle's categories, Leibniz's arithmetic of concepts, Description Logic subsumption, Formal Concept Analysis, Gödel numbering, and Armstrong's dependency axioms. The file is **verified** when its violation total `V` reaches 0.

If your thoughts need to be bigger than one brain can hold at a time — or you just want your ideas to survive contact with an LLM — Alpha gives you a way to write them so that anyone, including you six months from now, can read them instantly and extend them without breaking them.

![A Sales.aot file in VS Code: syntax colouring, a red squiggle on an "and" Concept, a yellow squiggle on a target-less measurement, a dotted crosslink under an Example reference, and the violation total V in the status bar](docs/edit-loop.png)

**Contents:** [Why Alpha](#why-alpha) · [Alpha in sixty seconds](#alpha-in-sixty-seconds) · [Quick start](#quick-start) · [Case study](#case-study-a-quarterly-business-review) · [Language reference](#language-reference) · [Incompleteness is a feature](#incompleteness-is-a-feature) · [Numbering](#numbering) · [The four rationales](#the-four-rationales) · [Starting a model](#starting-a-model) · [Tables](#tables) · [Python](#python) · [Parking the derivations](#parking-the-derivations) · [Verification: the tooling](#verification-the-tooling) · [Style rules](#style-rules) · [Design principles](#design-principles) · [Using Alpha with an LLM](#using-alpha-with-an-llm) · [Alpha in a team](#alpha-in-a-team) · [Repository layout](#repository-layout)

## Why Alpha

Knowledge work keeps producing the same artefacts — goal trees, domain models, capability maps, process diagrams — and keeps losing them in slides, prose, and diagrams that no tool can check and no two readers interpret the same way. Alpha replaces those with one plain-text format that is simultaneously human-readable, machine-verifiable, and AI-native.

- **Arguments become checkable.** This is the Leibniz point: once "Socrates is an example of Human" is encoded as the divisibility of two integers, an is-example-of claim isn't an opinion — it's a computation the linter either confirms or refutes. `V = 0` means the file contains no structural contradictions.
- **Two readers build the same mental model.** A `.aot` file is a shared definition a team can extend. Nobody maintains a private version in their head.
- **Disagreements become locatable.** When a dispute arises, it is about a specific line — a wrong parent, a missing differentia — not about a vibe in a paragraph.
- **AI can work on it reliably.** Plain text is what language models consume, and the linter is an objective referee: ask an AI to extend or critique your model, then let the linter check the result mechanically instead of re-reading it yourself. The tree gives the AI your actual ontology rather than letting it guess from prose.
- **Your spreadsheets come along.** Every table in a model is mirrored to an ordinary CSV file, so the same knowledge is at once a checked Alpha model and a spreadsheet Excel can open.

Compared with the alternatives: prose hides structure, diagrams don't scale or diff, and formal ontology languages (OWL, UML) demand tooling and training that most teams never adopt. Alpha is four line-kinds and an indent rule — you can teach it in a coffee break and version it in git.

## Alpha in sixty seconds

Yes, the world sometimes feels like a tangled lattice: Socrates is an example of a human, but also a philosopher, and also an Athenian. Alpha's discipline — one parent per idea, relationships modelled as crosslinked ideas of their own — is exactly what makes a file readable at a glance instead of a diagram you need a lie-down after.

```aot
- Alpha Example
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

1. **Install the extension.** Download the newest `alphabet-of-thought-*.vsix` — from [Releases](https://github.com/Jakus23/alphabet-of-thought/releases) or the copy at the root of this repository — and run `code --install-extension <the .vsix>`. Or build the current source in one step with `python install.py`, which packages, installs, and tells you to reload the window. (The extension is not yet on the VS Code Marketplace.) You get syntax colouring, the linter, crosslinks, and the table editor.
2. **Create a file.** Name it after the subject: `Human.aot`, `Sales.aot`. The **file name is the root Concept** — do not repeat it as the first line; the file's top-level lines are already its children.
3. **Pick a real subject.** Take something you currently explain badly in a document — your team's metrics, a domain model, a process with a known bottleneck — and pick the matching [rationale](#the-four-rationales) as a skeleton.
4. **Write indented plain text using only four kinds of line** (see the [language reference](#language-reference)). Start with natural Concepts and build up from facts, or normalise an existing data structure and derive relations from it. Either way, the move is the same: generate the facts first, then branch out.
5. **Fix squiggles until `V = 0`.** The places where you can't decide on a parent are the places where you didn't actually know what you meant — which is the point. (The same check runs from the terminal: `node verify.js <file.aot>`.)
6. **Ask an AI to explain what you wrote.** Paste the file into an LLM and ask for an explanation. You'll be amazed at what you learn about something you thought you knew. (See [Using Alpha with an LLM](#using-alpha-with-an-llm).)

## Case study: a quarterly business review

Here is the artefact knowledge work produces most often — a status slide:

> **Q2 Sales: Growth and Retention.** Revenue growth on track (11%). New-client pipeline healthy. Basket size up. Churn improving. Owner: Mike.

Fifteen minutes of Alpha later, the same claim is `Sales.aot`, written with the [Motivation rationale](#motivation):

```aot
- Motivation
    measurement interval: quarterly
    Mike
        role: Head of Sales
        - revenue growth
            actual: 11%
            target: 15%
            influence: Amber
            - new client count
                actual: 46
                target: 60
                influence: Red
            - average basket size
                actual: $2,510
                target: $2,400
                influence: Green
            - churn
                actual: 3.1%
                influence: Amber
```

What the linter caught before the meeting could:

1. **"Growth and Retention" is two kinds.** The first draft filed the measurements under a `Growth and Retention` Concept, and it squiggled red on the spot (error 8, no "and" in a Concept). Growth and retention have different levers and different measurements; the model forces the split the slide fudged.
2. **"Churn improving" had no definition of good.** `churn` carries an `actual:` but no `target:` (warning 2). The yellow squiggle is the question *"improving relative to what?"* asked mechanically, before anyone has to ask it out loud.
3. **"On track" contradicted its own children.** 11% against a target of 15%, with the leading driver Red — visible at a glance once every measurement is forced to carry `actual`, `target`, and `influence` side by side. No linter rule fired here; the notation itself removed the room to hide.

The file ends in the honest state: structure verified, one warning left on `churn` — an open question the team must answer, not a formatting task. And the review doesn't die in a deck: next quarter extends the same tree, `owner: Mike` still crosslinks to the same `- Mike`, and git shows exactly which line changed and who changed it.

## Language reference

### File format

- Extension: `.aot`
- Indentation: exactly 4 spaces per level. Tabs are forbidden.
- Every non-blank line is a node in the tree. A line's parent is the nearest line above it that is indented one level less.
- The **file name is the root Concept**. `Human.aot` begins directly with `full name`, `age`, and so on — never with a `Human` line.

### One parent per idea: the parent–child chain

Every idea in Alpha has exactly one parent. A parent may have many children; a child never has two parents. The chain runs from the general (the file name) to the specific, until it terminates. An idea never means something different depending on which path you took to reach it.

The restriction is deliberate. The parent–child chain **is a type system** — not *like* one. Each Concept is a type, each sub-Concept a subtype, each Example a value inhabiting it, and the linter checks membership by divisibility of the characteristic numbers exactly as a type checker checks a term against its type. Because the primitives are this precise, you are not limited to Alpha's own taxonomy: you can literally build the type system you want — a programming language's, a taxonomy's, a schema's — as a tree in Alpha and have it mechanically checked. One parent per idea forces you to decide what an idea *is* before you can write it down, and that explicit commitment is one other people can share: everyone who opens the file extends the same tree instead of rebuilding a private version in their head. What a thing relates to, as opposed to what it *is*, is modelled with [crosslinks](#crosslinks).

### The four kinds of ideas

Alpha agrees with Aristotle that everything you can think falls into four categories (*Categories* 2, 1a20–24), produced by crossing **said-of** (universal vs. individual) with **present-in** (substance vs. accident):

| Kind | Aristotle's name | How to recognise it | Said of (S) | Present in (P) | Example |
|------|------------------|---------------------|-------------|----------------|---------|
| **Concept** | Universal Substance | First letter capitalised | S | ~P | `Human` |
| **Example** | Individual Substance | `- ` (dash + space) prefix, or the value in a capitalised `Concept: value` line | ~S | ~P | `- Socrates` |
| **Attribute** | Universal Accident | All lowercase | S | P | `is alive` |
| **Attribute Value** | Individual Accident | The value after the colon in a lowercase `attribute: value` line | ~S | P | `is alive: No` |

#### Concept — a kind of thing

A Concept defines a class or type of idea. Indenting one Concept under another asserts the child **is a kind of** the parent — a sub-Concept is always an *is-a*, never a *has-a*.

- A Concept name may recur elsewhere only when a distinguishing qualifier prefix makes it unique (see [Univocity](#errors--red-squiggle-counted-in-v-the-file-does-not-verify), rule 9).
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
- (Before 1.13 the value was an inline first Example. See the [CHANGELOG](CHANGELOG.md) for what that changed.)

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

One subject per file is the rule, but a person, a system or a measure worth modelling turns up in more than one subject. When the same Concept is written in two files, Alpha reads the two halves logic already gives it and treats them differently:

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

That is the only place a table has for a Map, and it is why the note is found again on the next save and kept true rather than written a second time. (A *row* that needs a `...` of its own is written in line form, where it has a line to hang one under.) Everything else applies to a table either way: attributes a peer declares arrive as new columns, and a row gains the values its Example was given elsewhere.

### Aliases and Maps

Alpha is **not a word-explanation language**: a definition terminates in Examples and data, never in words explaining other words — a dictionary chain of synonyms proves nothing and checks nothing. What *is* possible is renaming: an alias gives the same idea a second name without pretending to define it.

| Notation | Syntax | Purpose |
|----------|--------|---------|
| **Alias** (has-another-name) | Parentheses after a term: `Human (Natural Person)` | Provides an alternative or derived name for an idea. If some or all of an attribute's trailing words match a Concept, those words already act as an alias — no parentheses required. |
| **Map** | An indented `...` line, optionally followed by a note: `... todo: list the remaining operations` | Marks **only** what is intentionally omitted, still a todo, or held at low confidence — **never** a plain description of the line above it. To explain or rename a term, use an alias instead. A Map excuses its parent from the completeness checks (see [Verification](#verification-the-tooling)). One shape, `... N more in file.aot:12`, is [maintained for you](#concepts-across-files) and says where the rest of a Concept's Examples live; every other Map is yours alone. |

### Incompleteness is a feature

No model is ever finished, and Alpha is built so that an unfinished one still **verifies**. `V = 0` is not a claim that everything is written down — it is the claim that **nothing written down contradicts anything else**. Consistency is the property a machine can check; completeness is not, and a notation that demanded both would be unusable on the first day of any real subject.

That is a deliberate choice, and it is the oldest result in the toolbox. Gödel (1931) showed that a system rich enough to say interesting things cannot be both complete and consistent. Alpha keeps consistency and hands completeness back to you as something you *declare* rather than something you are *caught* lacking. The [Gödel numbers](#gödel-numbering) say the same thing arithmetically: exponent **0** means the attribute is simply absent. Silence is representable. A half-described idea is a well-formed number, not an error.

Four places in the language make this concrete:

| Where | What it means |
|---|---|
| **The `...` Map** | The one line whose whole job is to say *there is more here*. It marks what is intentionally omitted, still a todo, or held at low confidence — and it **excuses its parent** from the completeness checks: a lone sub-Concept, a Concept that would otherwise look like it had drifted from its kind. Missing is not the same as forgotten, and the `...` is how you tell the difference. |
| **Extension is a partial sample** | A Concept's Examples are never claimed to be all of them. Two files listing different Examples of one Concept are both right, the repo-wide truth is the [union](#concepts-across-files), and the `... N more in bank recon.aot:14` line is maintained for you rather than reported against you. |
| **Advisory findings never count in `V`** | Spelling hints, Example hints, FCA suggestions, dependency findings — everything that says *you might be missing something* is a hint or a warning, never an error. Only the file's own contradictions reach `V`. |
| **Attributes are optional by default** | An attribute declared on a Concept and left unvalued on an Example is `present but unvalued`, a first-class state (exponent 1), not a hole to be filled before the file will pass. |

What incompleteness never excuses is **contradiction**. One attribute carrying two values, one Concept filed under two kinds, an `and` in a Concept name, a dependency cycle — those are errors wherever they appear, `...` or no `...`, because they are not gaps. A gap is a place you have not been yet; a contradiction is a place that cannot exist.

The practical consequence is the working style Alpha is built for: **write the part you know, mark the part you don't, and keep the file green the whole way**. A model that had to be finished before it was correct would never be started.

### Numbering

Lists and taxonomies often want visible order, so Alpha maintains it for you — on **save** and on **Format Document**, never mid-keystroke:

- **Examples.** Give any Example an `N. ` prefix (`- 1. Mix`) and all of that Concept's Examples number sequentially in listed order — unnumbered names gain a number, stale numbers correct — and every same-file reference to a renamed Example (crosslink values, table name cells, the `@` references in derivations) follows, exactly as F2 would rename it. A list with no numbered Example is never touched.
- **Concepts.** Type `1. ` on any Concept and every Concept in its scope numbers in document order — top Concepts `1. `, `2. `, sub-Concepts dotted down the is-a chain (`1.1`, `1.1.1`). The scope is the whole file normally; a Concept filed under an Example or attribute numbers only that parent's Concepts. A fully numbered scope keeps its numbers true to position, so moving a Concept and saving corrects them.
- **The way out is one deletion.** Delete any one Concept's number and the whole scope's numbering comes off on the next save, parents included. (A new unnumbered Concept in a numbered scope reads the same as a deletion and switches numbering off; retype `1. ` on the top Concept to bring it back.)
- **Numbers are presentation, never identity.** Name resolution strips the prefix everywhere, so an attribute `trip` still types by the Concept `1. Trip`, `@Trip@column` still resolves, and `2. Animal` beside `Animal` is still a univocity error. Numbering — or un-numbering — a tree breaks no reference and rewrites none. A number without its dot is never a prefix: `- 35` and `3 Body Problem` keep their names whole.

See [`examples/numbering.aot`](examples/numbering.aot) for a file to try it on.

### Crosslinks

Single inheritance answers what an idea *is*; crosslinks answer what it *refers to*. The extension (`src/crosslinks.js`) underlines three inline connections, resolves them for go-to-definition (Ctrl+click jumps; hover shows the target and its line), and carries a referenced node's ancestry into the FCA audit. Resolution is **repo-wide**: a reference whose target lives in another `.aot` in the workspace links to it, and Ctrl+click opens that file (the local file wins ties). Link kinds are told apart by underline style, not colour — the link keeps its token's syntax colour:

| Connection | What links | Underline | Example |
|------------|-----------|-----------|---------|
| **attribute-is-a-Concept** | An attribute or value whose **trailing** words name a Concept (case-insensitive); the longest trailing run wins. When the attribute carries a `(alias)`, the alias is the **only** link — the trailing-name run is suppressed. | solid | `age integer: 5` → the `Integer` Concept; `duration (time)` → `Time`, never `Duration` |
| **concept-contains-Concept** | A Concept whose name — or `(alias)` — contains a run of words naming another Concept or another Concept's alias (case-insensitive); each longest, non-overlapping run links, but the whole name never does. An alias that is wholly another Concept's name links whole instead, and is an error (rule 11). | solid | `Independent Node` → the `Node` Concept; `Human (Natural Person)` → `Person` |
| **value-is-an-Example** | A value that matches an Example name (case-insensitive, like every link). A table's parent cell links the row it names. | dotted | `human: Socrates` → `- Socrates` |
| **value-is-a-default** | A value equal to its type's default (`currency: EUR` beside `Currency: EUR`). | dotted | `currency: EUR` → `Currency: EUR` |

#### Composition

Attributes are sometimes atomic values, but Alpha also allows an attribute to be defined as a Concept somewhere else. An `Employee` can be composed of a `human`, a `contract`, and a `role` attribute, each of which sits in its own parent–child chain and is independently inherited as an attribute of the `Employee` Concept. Crosslink composition is how you assemble a complex idea from parts that each have their own definition; inheritance is how you say what kind of thing the idea is.

#### Attribute alias

A relational attribute referencing another Concept uses that Concept's name, written lowercase: an attribute `human` on `City of Residence` links to the `Human` Concept automatically.

#### Concept differentia

A Concept such as `Employee` may be used inside another Concept's name — for example `Train Employee`. The two Concepts are distinct and unambiguous, yet it is the same idea of `Employee` that is evoked in the writer's and reader's mind for both. Alpha celebrates this: the containment crosslink records that `Employee` was defined elsewhere.

Every attribute the child adds must be a **differentia** — a fact that makes it a *narrower kind of the same genus*, answering "what kind of the parent is this?". A child may carry more attributes than its parent; what matters is not how many it adds but that they narrow the *same* kind. If the added facts instead describe a separate dimension the thing merely *has* — a format, a property on its own axis — then you have written a has-a as an is-a: the Concept now names two kinds at once, and the subsumption reasoner flags it (rule 12, Multiple kinds). Pull that has-a out into its own attribute or Concept and crosslink it, so the child's place in the tree stays purely about what it *is*.

#### Values against their Concept

When an attribute names a Concept and that Concept **lists its Examples**, the attribute's values are answerable to that list. Typing such a value pops a **dropdown of the Concept's Examples** — on a line-form value and in a typed column's table cell alike, archived CSV values listed after the live ones. `person: James`, on an attribute typed by a `Person` whose only Example is Socrates, says James is a Person while the file never says who James is. Alpha hints the value and offers the Quick Fix that closes the gap — **Add 'James' as an Example of 'Person'** — which lists James where Person is already written: a row on its table, or a `- James` line under its last Example, cursor left on the new Example so you can carry straight on. Picking from the dropdown and coining a fresh Example both keep the model whole.

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

This is a **gap in the model, not a contradiction in it**, so it hints exactly as spelling does — on its own span and on hover, never in the Problems panel, never in `V` — and turns off with `aot.exampleHints`. An attribute may mention a Concept without being valued by one, so three things keep the hint to values that were genuinely trying to name an Example:

- **The Concept must list Examples.** One that lists none states an open vocabulary, where any value is fair — `name: Socrates` is prose, not a claim against a listed set.
- **The value must be the same kind of value its Examples are.** `maximum worker pool: 1` measures the pool; it does not name one of Role/Asset/Function, and a number never could. `age integer: 5` *is* a number among the numbers 1 and 35, so it genuinely misses.
- **The value must not be a truth value.** `present in: False` says a fact holds; it does not nominate an Example.

## The four rationales

Alpha is aimed at knowledge workers — analysts, architects, anyone whose job is to think in structures. You can use it purely for your own thoughts, but Alpha ships four rationales for the four kinds of model knowledge work keeps producing anyway, usually scattered across slides and spreadsheets. They are built on Aristotle's four causes — his complete answer to *why a thing is and how it comes to be* (*Physics* II.3, 194b17–20) — combined with the *Categories*, the *Prior Analytics*, and Kipling's six serving-men. **The four causes complete every explanation**: final (motivation), material (graph), formal (function), efficient (factor).

| Cause | Aristotle's phrase | Native question | Rationale | Said of | Not said of |
|-------|--------------------|-----------------|-----------|---------|-------------|
| **Final** | for the sake of which | Why, and for whom | **Motivation** | Party (Who) | Measurement (How much) |
| **Material** | that out of which | made of What | **Graph** | Entity (Where: the boundary that fixes where the record resides in reality) | Record (What) |
| **Formal** | the form, the arrangement of parts | What it is, How it is achieved | **Function** | Objective (How) | Class (Which) |
| **Efficient** | the agent and the means | by Whom, in what order | **Factor** | Worker (Agent) | Time (When) |

Each rationale's names are always modelled as Examples (not said of, not present in). The "Said of" column names the only Concepts allowed inside that rationale — Stakeholders, Entities, Objectives, and Worker Pools can never be Examples or Attribute Values, while measurements, records, classes, and times can only be Examples or Attribute Values.

The rationales can — and are encouraged to — link to one another: a Motivation's measurement may name a Factor's worker, a Graph's entity may type a Function's argument, and every such crosslink makes the model more connected and more checkable. What no rationale may do is *terminate* in another: each remains a complete tree of its own, its cause fully answered in its own terms, never reduced to a pointer into its neighbour. A complete explanation holds all four in balance — linked freely, each still standing on its own.

See [`examples/thought.aot`](examples/thought.aot) for one subject — thinking itself — modelled through all four rationales.

### The model is unbalanced until all four are used

The four causes are Aristotle's *complete* answer to why a thing is: drop one and the explanation is not merely shorter, it is **lopsided**. The missing cause's work does not disappear — it is smuggled into the rationales that remain, where it reads as noise, and the model quietly starts answering a question nobody asked.

| Missing rationale | How the imbalance shows |
|---|---|
| **Motivation** | Objectives with no *why* above them and measurements with no one who benefits. The tree grows detail nobody can prioritise, because nothing says what it is worth. |
| **Graph** | Records masquerading as Concepts. Attributes multiply on ideas that should have been Examples of an entity, and the same fact ends up written in three places with nothing to reconcile it. |
| **Function** | The *how* hides inside factor steps: the order of work stands in for the arrangement of work, so you cannot tell which capability a step realises, or what would break if it were removed. |
| **Factor** | Everything reads as simultaneous and unowned. No agent, no order, no contention — so no bottleneck is visible and no schedule can be derived. |

A file using one rationale can still reach `V = 0`. That is not a loophole: consistency is what the linter checks, and coverage is [something you declare, not something you are caught lacking](#incompleteness-is-a-feature). **Balance is the reader's check, not the linter's** — and it is the one worth making a habit. If you cannot produce all four for a subject, you do not yet understand it; the rationale you cannot write is exactly the part you have been assuming.

The counsel of perfection is not "finish all four before you write anything". It is: start where the knowledge is, and treat each rationale you have not reached yet as a `...` — a declared gap, in the model and in your understanding of the subject alike.

### Motivation

Focus: **what is measured, why, and who benefits from it.**

The Motivation rationale describes what you are trying to achieve and who owns it: goals and KPIs with a beneficiary, an `actual`, a `target`, and a Red/Amber/Green `influence` rolling up the tree. This is an OKR tree or a metrics dashboard as text — exactly what a quarterly business review tries to communicate — with every measurement recording its owner.

Every measurement carries both a `target` value and an `actual` value. Alpha requires both because a measurement only means something when you can compare the actual against the target (the linter warns when either is missing).

### Graph

Focus: **what the system is made of.**

Data modelling: which entities exist, where records reside, and what depends on what. The Graph rationale even encodes normalisation reasoning (Armstrong's axioms) as tree shapes, so you can use it to design a schema before touching a database — the linter's [dependency inference](#armstrongs-axioms-dependency-inference) tells you when a column is derivable.

### Function

Focus: **how the system does it**, decomposed as a tree of capabilities.

Capability decomposition: what the system achieves, as a tree of verb-phrase objectives where each parent is achieved exactly by all its children together. A value-chain model is an organisation's capability map; the naming rules below force each node to be one testable claim.

The questions in a Function tree run in different directions. Ask **How** downward: a parent objective is achieved exclusively through all of its children together — no single child is the how; the complete set is, and that arrangement is the parent's form (*Metaphysics* Z: the form of a house is the arrangement of its bricks, not the bricks). Ask **Why** upward: the answer to a child objective's why is its parent; the root is one or more objectives that cannot be reduced further, their why balanced by the whole tree beneath them. Ask **Which** of an objective to reach a Class. Alpha follows Aristotle in taking the form of a working thing to be its function: an axe that cannot chop is an axe in name only (*De Anima* II.1). The Function tree *is the form of the Motivation* — the arrangement that realises it.

**Naming rules**

- **Objective**: verb + qualified object → `Calculate Payment`. One verb per objective, named objectively.
- **Types**: nouns only, expressed as Examples → `- Payment Type`.

**Forbidden in Function names**

- Vague service verbs: "manage", "ensure"
- Performance terms: "good", "acceptable"
- Information-management words: "information", "data", "content", "info"
- Political words: "Business", "IT", "Management", "Support", "Execution"
- Flow words: "then", "next"

**Decomposition rules**

- 3 to 7 sub-objectives per parent objective.
- Test each split with the **Why**, **How**, and **Which** questions above.
- Attributes may be attached to objectives to describe their arguments and results.

### Factor

Focus: **who acts, in what order.**

Who works on what, in what order, including concurrency: locks, queues, race conditions, and where the bottleneck is. [`examples/thought.aot`](examples/thought.aot) models intuition versus deliberation this way — deliberation is the synchronous bottleneck that waits on a condition, holds working memory, and loses races to bias.

## Starting a model

There are two ways in, and they meet in the middle:

- **Normalise an existing structure.** Take a schema, a spreadsheet, or a document you already have, file its rows as Examples, and derive the Concepts and attributes from what the data bears out.
- **Start axiomatically.** A flat list of Examples: file every Example directly under the file-name root. This is the [content-over-structure](#pragmatic) rule taken to its limit, and the inverse of normalising. There is no hard part to an axiomatic start, because thinking is never complete — any checklist of the questions a subject must answer will do. Four good ones, in order of sophistication:
  - **Your todo list.** Each open item is an Example the model is missing; emptying the list and completing the model are the same act.
  - **Kipling's six serving-men.** *What, Why, When, How, Where, Who* ("I keep six honest serving-men; they taught me all I knew"). Six Examples to start with.
  - **Aristotle's ten categories.** Substance, quantity, quality, relation, place, time, position, having, action, being-acted-upon (*Categories* 4). The widest net for *what can be said of a thing*: each category is one more attribute to ask after.
  - **The Alpha rationales.** Motivation, Graph, Function, Factor. All real knowledge straddles all four; if you cannot produce them all, you do not yet fully understand the subject.

Whichever you use, the move is the same: generate the facts first, then branch out from there.

## Tables

Alpha recreates org-mode's plain-text spreadsheet: a pipe table the linter reads as ordinary Examples, so an axiomatic start can be written as the grid it already is. **The pipe divides, it never borders** — one between each pair of cells and none at either end, so a table is exactly as wide as its content and its first column starts where every other line of the language starts. (One table has no pair of cells to divide — a Concept with **no attributes**, one column of names and nothing else — and there the pipe *closes* the row instead, `Alice|`, which is what keeps such a table a table rather than plain outline lines.) **The first header cell names the Concept the table describes** — the table stands exactly where that Concept's own line would, with no separate heading above it and no extra indent:

```aot
Order           |country|currency|basket size
Acme March Order|France |EUR     |$1,200
Bolt March Order|Germany|EUR     |$3,100
Kite March Order|Japan  |JPY     |$780
```

- The header row's **first cell names the Concept** — capitalised, like any Concept — and the cells after it declare the columns as **attributes** of that Concept, exactly as bare lowercase lines would. So a capitalised column, or a lowercase first cell, is an error. *(Before 1.9 the table was indented beneath a separate `Concept` line and its first cell was a `name` label; that label is gone — write the Concept's name in its place.)*
- **A Concept can still carry line-form facts beside its grid.** Give the Concept its own line and repeat its name in the first header cell: the table then *fills that Concept in* rather than declaring a twin, so its default values, its `- ` Examples, and the grid's rows all belong to the one Concept — and a cell's derivation reads the line-form defaults by name (`=@price*@tax rate`):

  ```aot
  Order
      tax rate: 0.2
      - Loose
          price: 50
      Order|price|vat
      Acme |100  |20 =@price*@tax rate
  ```
- **The header is the row that stands first.** Nothing declares it: the first row of a table names the Concept and its columns, and every row under it is an Example. So a table being typed is never wrong yet — one row is a header with its rows still to come.
- **A header states defaults as the Concept's lines would.** `Currency: EUR|symbol` gives the Concept its [default](#example--a-concrete-individual) in the first cell. `Order|price|tax rate: 0.2` gives the column `tax rate` the default `0.2`, which every empty cell under it reads, exactly as the line `tax rate: 0.2` under `Order` would. A header default is stated, not derived. A capitalised `Name: value|…` line is a header; a lowercase or `- ` line with a colon before its first pipe stays a value holding a pipe.
- Every data row is an **Example** named by its first cell — filed under the Concept the header names — and every further cell is that Example's **Attribute Value** for its column. An empty cell asserts nothing. A row with more cells than the header names, and an empty name cell, are both errors.
- **A row sits under another by naming it, and that is an Example hierarchy.** A table never nests by indentation. A sub-Example names the row it sits under in the table's **`parent (thing)`** column: named `parent`, its `(alias)` the table's own Concept, lowercased, so by the alias rule every cell under it names one of the table's rows. That is exactly what `- Child` under `- Parent` says in free text, so a grid can hold a tree and not only a list:

  ```aot
  Thing       |parent (thing)|age
  Parent      |              |
  Child 1     |Parent        |10
  Child 2     |Parent        |12
  Other Parent|              |
  Child 3     |Other Parent  |7
  ```

  - A parent cell names the nearest row *above* it with that name, case and numbering aside, else the first one below. A sort can leave a parent below its child, and the tree is the same.
  - It never names the row itself, so a child named like its parent is still filed under it, and meets [rule 24](#errors--red-squiggle-counted-in-v-the-file-does-not-verify).
  - A name no row of the table carries, a row naming itself, and a circle of parents are errors.
  - The column is structure, not an attribute: no value, no Gödel prime, no default.
  - Its cells link to the rows they name, so Ctrl+click, hover and rename follow them.
  - It is the column the [CSV mirror](#the-csv-mirror) has always written the tree in, so the table, its spreadsheet and a DataFrame of it are one shape.
  - A row's cells are its own: a child inherits none of its parent's.
  - A row's indent means nothing: this column is the only way a table nests. An indented row is only a row, and Format Document draws it flush.
- **A divider groups rows.** Dashes between the pipes, `-----|---`, group a table's rows as a blank line groups an outline's lines; [the flip](#flipping-between-a-table-and-free-text) turns one into the other. A divider is drawn to its columns' widths, and holds no cells. Every key steps over it, and a sort stays within the group the cursor is in.
- **One pipe is what makes a row — unless a colon stands before it.** A blank line, any line carrying no `|`, or a row *shallower* than the header ends the table. A name never holds a colon, so a lowercase or `- ` line whose first pipe comes *after* a colon is a `name: value` line with a pipe in its value — `rule: a | b`, `- Ann: x|y` — and never a row; a row's own colons stand in its cells, after the first divider (`|12:30`, `Ollie|http://…`). Only inside a table **cell**, where a pipe divides, is a literal pipe written `¦`, the broken bar the CSV mirror already bends it to. **Two standalone tables in a row need a blank line between them**, or the second's header reads as more data rows of the first.
- **Format Document** (`Shift+Alt+F`) re-aligns every table as org's `TAB` does: each column padded to its widest cell. Columns carry **no gutter spaces** around the pipes — a file's width is precious — but stay vertically aligned. A row ends at its last written cell, since padding past it is only trailing whitespace: a row that stops short keeps the dividers of the empty cells it stops before, and a row whose *name* cell is empty — one still being filled — opens with the spaces of that cell, so the columns below still line up. A table with no attributes has no divider to draw, so its rows close with the pipe instead (`Org Structure|` over `Department A |`), and that pipe reads back as the empty last cell it looks like — which is why re-drawing it changes nothing.
- **One row is one line, and a cell is never broken to fit.** A column is as wide as its widest cell, however long that is. *(Between 1.8 and 1.12 a header cell could carry a width cookie — `description <24>` — capping its column and wrapping longer values onto continuation rows. It is gone: a cookie bought a narrow table at the price of the plainest rule the language has, and `<24>` is now nothing but part of a column's name.)*

### The table editor

Org's table automations are built in. While the cursor is on a table row — any line carrying a divider — the extension takes over these keys; every one of them re-aligns the whole table first, so a table never needs manual spacing:

| Key | What it does |
|-----|--------------|
| `Tab` | Re-align, then jump to the next field; at the table's last field a new empty row is appended |
| `Shift+Tab` | Previous field, wrapping to the row above |
| `Enter` | Same column, next row; appends a row at the bottom (`Shift+Enter` still inserts a plain newline to leave the table) |
| `Alt+←` / `Alt+→` | Move the cursor's column left / right, header and all |
| `Alt+↑` / `Alt+↓` | Move the cursor's row up / down |
| `Alt+Shift+→` | Insert an empty column where the cursor stands (on the name column, just after it) |
| `Alt+Shift+←` | Delete the cursor's column. The first column, which names the Concept and its Examples, is never moved, copied or deleted by a column key |
| `Alt+Shift+↓` | Insert an empty row above the cursor's |
| `Alt+Shift+↑` | Delete the cursor's row |
| `Ctrl+Alt+↑` / `Ctrl+Alt+↓` | **Copy** the cursor's whole row above / below it — the next Example is usually the last one with two fields changed |
| `Ctrl+Alt+←` / `Ctrl+Alt+→` | **Copy** the cursor's whole column to its left / right, header and every value |
| `Ctrl+Alt+Shift+` arrow | **Copy the cell** into its neighbour in that direction and follow it there, so holding the key fills a run |
| `Ctrl+]` / `Ctrl+[` | VS Code's own indent / outdent of the selected lines — how a whole table is re-filed under a different parent. `Tab` in a table always travels the cells, lines selected or not |
| `Ctrl+Alt+T` or `Ctrl+K T` | Write the Concept at the cursor out as free text, and the same key writes it back as a table — see [Flipping between a table and free text](#flipping-between-a-table-and-free-text). Also on the right-click menu and in the Command Palette, for a keyboard that loses the chord |

The keys a spreadsheet hand reaches for without looking work here too, inside a table row:

| Key | What it does |
|-----|--------------|
| `Ctrl+`arrow | Jump to the **edge of the data**: from a filled cell, to the last filled cell before a gap; from an empty one, to the next filled cell; with nothing that way, to the table's edge. Moves the cursor only — nothing is re-aligned |
| `Ctrl+Shift+`arrow | The same jump, **selecting** as it goes |
| `Ctrl+Home` / `Ctrl+End` | The table's first cell (the Concept's name) / its last (the last row's last column); pressed again from there, the top or bottom of the file. With `Shift`, selecting |
| `Ctrl+A` | Select the table; pressed again, the whole file |
| `Ctrl+D` | **Fill down**: the cell above into the cursor's cell — or, with rows selected, the first selected row into the rest, across every selected column |
| `Ctrl+R` | **Fill right**: the cell to the left into the cursor's cell — or, with cells selected, the first selected column into the rest of each row |
| `Ctrl+'` | Copy the **derivation** from the cell above, without a value until `Ctrl+Enter` runs it |
| `Ctrl+Shift+'` | Copy the **value** from the cell above, its derivation left behind |
| `Ctrl+;` / `Ctrl+Shift+;` | Today's date (`YYYY-MM-DD`, the form a date constraint reads) / the time now — anywhere in a `.aot`, not only in tables |
| `F9` | Run every stale [Python](#python) derivation and check every constraint — anywhere in a `.aot` |

Fills move a cell's text as written — a derivation arrives alone, its value left for the next run to compute in the new place — and never take the header or the name column as their source — an attribute's name or an Example's is no value a cell means to hold. Inside a table row — and on an Example's line or value in free text, [below](#the-table-editor) — `Ctrl+←`/`Ctrl+→` no longer steps a word at a time (it jumps cells instead), `Ctrl+D` no longer adds the next match to the selection, `Ctrl+R` no longer opens a recent folder, and `Alt+↑`/`↓` and `Ctrl+Alt+↑`/`↓` move and copy rows instead of lines and cursors; anywhere else every one of them is VS Code's own again. Deliberately left out: `Ctrl+Space` / `Shift+Space` (they would cost the suggestion list and a Shift-held space), `Ctrl+PgUp` / `Ctrl+PgDn` (editor tabs), and `Ctrl+-` / `Ctrl++` (zoom — `Alt+Shift+`arrows already insert and delete).

**The same keys work in free text.** A table is [pure shorthand](#tables-are-pure-shorthand) for the `- Example` lines it parses to, so a Concept written as lines is a grid too: each **Example is a row** (its `- Name` line and the lines under it, sub-Examples after their parent), each **attribute a column** (in the order the Examples write them), and a **cell is an Example's `attribute: value` line** — a cell nobody wrote is a line nobody wrote. With the cursor on an Example's line or one of its values, every table key above but `Enter` works on that grid:

```aot
Person
    age
    - Ann             <- Tab: to 'age: 30'; Alt+↓: Ann, values and sub-Examples, below Bob
        age: 30       <- Ctrl+Alt+Shift+↓: 'age: 30' into Bob, in column order
        city: Paris
    - Bob
        city: Rome    <- Ctrl+D: 'city: Paris', from the Example above
```

- **`Tab` / `Shift+Tab`** walk the Examples' names and values in order, and past the last one grow a new `- ` Example. On a bare attribute line (`age`), the Concept's own line, or an empty line, `Tab` indents exactly as it always has.
- **Rows:** `Alt+↑`/`↓` moves an Example over its neighbour (sub-Examples travel with it, a blank line between them stays between them), `Ctrl+Alt+↑`/`↓` copies one, `Alt+Shift+↓` inserts an empty `- ` above, `Alt+Shift+↑` deletes one with its sub-Examples.
- **Columns:** `Alt+←`/`→` swaps the attribute's lines with its neighbour's in every Example that states both, `Alt+Shift+←` deletes the attribute everywhere (declaration included), `Alt+Shift+→` opens an empty declaration line for a new one, `Ctrl+Alt+←`/`→` duplicates it. These column keys work from the attribute's **declaration line** too (`age` under the Concept), which is the column's header, while `Tab` there still indents.
- **Cells and the spreadsheet keys** behave as in a table: a value filled or copied into an Example that lacks the attribute gets a new line, placed in column order under the name; a value emptied loses its line, since an empty cell asserts nothing. A derivation a key copies arrives alone and computes on the next `Ctrl+Enter`.

Every operation edits the lines it is about and nothing else — no line is reordered, re-indented, declared or re-spelled that the key did not ask for (flipping the Concept to a table and back would do all four). Where the text looks like an Example's line but the parse says otherwise (an attribute's allowed values, `- draft` under `status`), the key does what VS Code does with it.

**Keyboard layouts.** VS Code does not tell a left modifier from a right one — but on a layout where the right `Alt` is **AltGr** (United Kingdom, US-International, most European layouts) that key is not `Alt` at all, and VS Code on Windows reads neither `Right Alt+↑` as `Alt+↑` nor `Right Ctrl+Right Alt+T` as `Ctrl+Alt+T`. No extension keybinding can tell AltGr apart, so use the left `Alt`, or switch the layout to US (*Settings → Time & language → Language & region →* your language *→ Language options → Keyboards*). The flip has `Ctrl+K T` and the right-click menu, which need no `Alt` at all. Windows' own **Left Alt+Shift** switches input languages, which is also the start of every `Alt+Shift+`arrow table key — if the layout seems to change under you, change that hotkey under *Settings → Time & language → Typing → Advanced keyboard settings → Input language hot keys*.

**`Tab` never moves the data.** Inside a table it travels the cells and nothing else — pressed in the leading spaces, at the head of a name cell, anywhere past it, or with lines selected. A table nests through its parent column, so there is no indent there for a key to mean. The cursor's row is nested or lifted by name from the Command Palette:
- **AOT Table: Nest Row Under the Row Above** writes the row above's name into the parent cell, and adds the column, second, when the table has none.
- **Lift Row Out of Its Parent Row** writes its parent's parent, or empties the cell.

The row's own sub-Examples name it, so they travel along. In line form a selection still indents with `Tab`, since there the indent *is* the nesting.

**Every column is drawn left.** A value is padded on its right to its column's width and nothing else, so the one thing a reader has to know about a cell is its text.

**A row moves alone, and its place in the tree goes with it.** A row names its parent rather than standing under it, so `Alt+↑` / `Alt+↓` move one row, hopping a divider into the next group, and **Sort Rows** orders the rows of the cursor's group as the flat list they are. A child sorted above its parent still names it. `Alt+Shift+↑` deletes a row with every row whose parents lead back to it, wherever they stand, as deleting a `- Parent` line takes the lines under it; one `Ctrl+Z` brings the branch back. A copied row (`Ctrl+Alt+↑`/`↓`) keeps its parent cell, so it lands as a sibling.

**Copy, cut, and move are three different keys.** `Alt+`arrow **moves** a row or column, `Ctrl+Alt+`arrow **copies** it, and `Ctrl+Alt+Shift+`arrow copies the **cell** — text and derivation exactly as written, unlike the derivation copies and fills, which carry the derivation alone. Cutting a *cell* into its neighbour (the value typed into the wrong column) is four more Command Palette entries, **AOT Table: Cut Cell Up / Down / Left / Right**, unbound by default. Nothing here is clever about what it copies: a duplicated row or column will report as a repeated Example name or a repeated attribute until you rename it, and that rename is usually the point of the copy.

Copying a cell **down past the last row appends one**, so a column fills into a table that is still growing. Sideways never grows the table — a new column needs an attribute name of its own.

Three more commands live in the Command Palette under **AOT Table**: *Sort Rows by Column at Cursor* (org's `C-c ^` — sorts the data rows around the cursor, the header safe where it stands; numeric when every key reads as a number, with `$`, `%`, and thousands commas ignored, alphabetic otherwise), *Create Table from Selected Lines* (org's `C-c |` — select CSV, TSV, or multi-space-aligned lines and they become an aligned table, the first line the header: its **first cell is kept as written** — that names the Concept — and the rest are lowercased into attribute columns), and *Copy Formula Down the Column* (see [Running](#running); also offered by the lightbulb on any derivation in a cell).

**Creating a table takes one keystroke**: type `|` on an empty line and a skeleton grows in place — a header and an empty data row — and one `Ctrl+Z` undoes the whole thing. Typed under an existing Concept line, the first header cell is **filled with that Concept's name** and the cursor waits in the data row; typed at the top level, the first cell is left empty for you to name the Concept, and the cursor waits there:

```aot
Otter|
     |     <- cursor lands here (the Concept 'Otter' already filled in above)
```

Attributes the enclosing line **inherits from its ancestors arrive as ready-made columns** — under an `Otter` filed beneath an `Animal` that declares `legs` and `habitat`, the skeleton grows as `Otter|legs|habitat`. With nothing to inherit it still grows one empty column beside the Concept, since a table without a divider is not a table. Creation-time only: a table is never re-columned when attributes are declared later, and the parent's own attribute lines stay out (they already declare — a same-named column would be a duplicate). A `|` typed beside an existing table, or mid-line, is just a pipe. There is nothing else to draw: press `Enter` at the end of the header and the cursor is in the first cell of a new row.

#### Keeping your place in a long or wide table

A text editor cannot freeze a column the way a spreadsheet does: there is one scroll surface and it carries the whole line. Two things stand in for it, and between them they answer both directions.

**Down the table, the header pins itself.** The extension publishes the parsed tree as document symbols, which makes a grid's header line the **parent** of its rows — so VS Code's own **sticky scroll** holds it at the top of the viewport while you scroll the rows, exactly as it holds an enclosing Concept. That is the freeze, done by the editor rather than faked, and it costs nothing because the tree is already parsed. Turn it on with `editor.stickyScroll.enabled` (VS Code ≥ 1.84 has it on by default); the same symbols also fill the **Outline** view and the **breadcrumbs**, which are worth having on an indented tree in their own right.

**Across the table, the status bar says where you are.** Nothing can pin the name column, so the right-hand end of the status bar names the cell instead — `Person ▸ Socrates ▸ occupation`: the Concept, the Example the row names, and the attribute the column declares. It reads the same however far right you have scrolled, and it tells you the *column* too, which a frozen name column never would.

### Python

A value may be **derived** rather than typed, and what derives it is **Python**, written behind `=` after the value it computes. What Python produces lands in the file as ordinary text: a value in front of its derivation, a table where a Concept stood, or a picture or long text in `aot.files` with its path as the value. An attribute's **constraint** is Python too, so a bound can say anything Python can. When you have finished writing derivations and want the data back, `Ctrl+Shift+`` [parks every derivation](#parking-the-derivations) out of the file, and the same key puts them back.

```aot
Sales Report
    tax rate: 0.2
    raw: <DataFrame 1,204 rows × 4 cols> =load()
    revenue: 53,760 =@Sales.amount.sum()
    vat: 10,752 =@revenue*@tax rate
    best: Q2 =@Sales.amount.idxmax()
    chart: aot.files/Sales Report.chart.png =plot(@Sales)
    Sales =by_month(@raw)|month  |amount
    P1                   |2026-01|15,000
    Q1                   |2026-01|18,060
    Q2                   |2026-04|20,700
```

Before its first run, the last Concept was the line `Sales =by_month(@raw)`. The run made that line the header of the table its Python returned.

**Every derivation runs only when asked** (`Ctrl+Enter`), and Python is **off by default** (see [Trust](#trust) below).

*The spreadsheet formula language is gone.* It covered `sum()`, `xlookup()`, backtick text and `or()`, and recomputed on every keystroke. Python says everything it said, and one language behind one `=` is the simpler rule. A formula left in a file stays as text until it runs, and then Python says on its line what it makes of it. Backtick text does not parse, and `sum(@price)` is Python's `sum` over one value, which fails. Rewrite such a formula as Python: `"text"` for `` `text` ``, `@Order@price.sum()` for a column's total, `("draft", "sent")` for `or(`draft`, `sent`)`.

#### Where it goes

- **On a value**, as in `total: =load()`, or **in a grid cell**, as in `|=math.prod([@width, @height])`, it computes the value in front of it.
  - **A row may carry several**, one per cell, side by side. A `|` inside a cell's brackets or strings belongs to its Python, as in `|=",".join(@tags)|=len("a|b")`; a cell whose Python is still open reads every pipe as a divider, so the row stays a row.
  - **A column every row derives alike is a calculated column.** The lightbulb on such a cell offers **Define 'vat' for the whole column**, which moves the derivation onto the header as `vat =@price*0.2` and leaves each cell its value alone (see [`=` naming one value defines](#constraints)). Two formula columns then read as plain numbers.
- **On a Concept line**, as in `Sales =by_month(@raw)`, it writes the Concept's **table**. The derivation can return a DataFrame, a list of dicts, or `aot.grid(header, rows)`. **The table is the Concept.** The run turns the Concept's line into the table's header, with the Concept and its derivation in the first cell (`Sales =by_month(@raw)|month|amount`). The rows stand at the Concept's own indent. The table names its Concept in its first cell; it never sits beneath the Concept repeating its name.
  - **Python owns the rows outright.** Each run replaces them, including a row typed into the table, and removes the Concept's `- ` Examples too.
  - **The rows are the Concept's Examples, numbered `1`, `2`, `3` …** Every column of the frame is a column of the table, and an index that means something (a groupby's months) becomes the first column.
  - **A column named after the Concept names the Examples instead.** For example, a `quarter` column under `Quarter` supplies the Example names, and it is not written as a column. This does not happen when two rows would share a name or one would have none; then the rows are numbered and the column stays. `aot.grid(header, rows)` names the rows directly.
  - **Columns are written the language's way:** lowercased, with `_` as a space, since a capitalised column is an error.
  - **The name column is as wide as the derivation** until it is [parked](#parking-the-derivations).
  - **Pipes in the derivation:** a `|` inside the derivation's brackets or strings belongs to the Python. One outside every bracket divides the header, so wrap it, as in `Flags =(a() | b())`.
  - **A Concept that states attributes of its own keeps its line**, with the table beneath it, because a table has no line for them. A table written beneath its Concept by an earlier version becomes the header on its next run.
- **On a line of its own**, as in `=load_all()`, with nothing before the `=`, it writes **several Concepts** at once. It returns its tables by name — a dict, `{"Sales": df, "Region": rows}`, or a list of `aot.grid(header, rows)`, each naming its Concept in its header's first cell — and each is written as that Concept's table:
  ```aot
  =load_all()
  Sales|month  |amount
  1    |2026-01|15,000

  Region|code
  1     |EU
  ```
  - **A new name** is written as a table at the line's own indent, directly beneath it (after the tables it already wrote), so a bare line at the top of a file writes top-level Concepts, and one under a Concept writes Concepts filed under it.
  - **A name the file already has hooks into that Concept**: its rows are replaced where it stands, exactly as its own derivation would write them. One with a derivation of its own (`Plan =p()`) is left to it. That is no failure — the line ran and wrote the rest, and its inlay says `'Plan' left to its own derivation` — but one Concept returned from two places is a warning on the line: keep one.
  - **Names are read as the language writes a Concept**: `_` as a space and the first letter capitalised, so `{"sales_report": df}` writes `Sales report`.
  - **Nothing is ever deleted.** A Concept it no longer returns stays, and its inlay says `'Old' no longer written`.
  - **`@Sales` elsewhere reads the live table** the line's Python made, and runs after it, as a Concept's own derivation is read. Its inlay says how many Concepts it wrote, `✓ 2 Concepts · 2 rows · 4 ms · 16:04`, and the rows it wrote are tinted as Python's.
  - **The line is no idea of the model's**, so it is no node: the linter reads past it. A lone `=` is an error, and so is a bound with no attribute in front of it (`==("a", "b")`). A pipe on the line is its Python's.
- **One line, one expression.** Statements, loops and `def`s live in a Python file. That can be **`aot.files/<file>.py`**, the file's *sidecar*, whose public names are in every derivation's scope, or [any other Python file of the repository](#the-repositorys-python). It is ordinary Python, with ordinary tooling.
- **On a bare attribute** it is a [definition](#constraints), not a value: `vat =@price*0.2` says what every value of `vat` is. A tail that does not read as Python (`note = some words`) defines nothing and is an error; to make it the value's own derivation, add the colon. Not in a `...` Map either.
- **A value may hold a literal `=`** by doubling it: `note: a == b` is the value `a = b`, not a derivation of `a`. Only an `=` where a derivation could open — at the start of the value or after a space — needs it, and there any run is read one shorter, so `a === b` is the value `a == b`. One inside a word (`a=b`) was never a derivation. The value is read shorter everywhere, while the line keeps what was typed through every rewrite.

#### `@` references

`@` names things **by name**, as a spreadsheet's references do. It is resolved **before Python sees the source**, and each reference arrives as a typed Python value:

| Reference | Names | Arrives as |
|-----------|-------|-----------|
| `@price`, `@basket size` | The same Example's (or row's) attribute. This is the longest case-insensitive match, spaces allowed, an `(alias)` too. On an Example, a value its Concept states is read when the Example states none | The value, typed **strictly**: `$1,204` is `1204`, `2026-09-22` a `date`, `Yes`/`No` a `bool`, empty `None`. `2026-01` is not a whole number, so it stays text |
| `@price@Acme` / `@Acme@price` | The named sibling Example's value, in either order — or, from a value on an Example, one of the sub-Examples beneath it | The value |
| `@Order@price@Acme` | Another Concept's cell: the Concept first, then a column and an Example in either order. It may live in any `.aot` in the workspace; the current file's own names win a shared name | The value |
| `@Measurement@alias` | A Concept's **own** value, the default its Examples inherit | The value |
| `@Order` | A Concept, with its Examples written as rows or as `- ` lines — **sub-Examples included**, depth-first | A **DataFrame** (a list of dicts without pandas); a column of dates is a datetime column. Where the Examples nest, a `parent` column names the row each one sits under, exactly as the [CSV mirror](#the-csv-mirror) writes it |
| `@Order@price` | A Concept's column | A **Series** |
| `@Acme` | A sibling Example, or a sub-Example of the value's own Example | A `dict` of its values |
| `@raw`, `@Sales` | Another derivation | Its **live result**: the DataFrame itself, not its summary. It runs first when it is stale |

- **The local reading is tried first.** A Concept's name gets its turn when the local reading names nothing, or when the Concept reading goes further. In `@Integer@is prime`, `integer` may also be a local alias, but only the Concept Integer has an `is prime`.
- **A number after `@` names an Example** (`- 35`), never a column position.
- **An `@` inside a string or a comment is text.** An `@` straight after an operand is Python's matrix operator.
- **Typing `@` pops a completion** of the columns, then the Examples, then the repository's Concepts. A rename, by F2 or by typing over a name, follows through every reference, in every file.

#### Constraints

**Constraints live on the attribute; derivations live on the value.** A constraint is schema, so it is declared once, on the attribute: a bare line (`age >=18`) or a table header cell (`Order|qty >=1`). **Every value the attribute takes is held to it**: the Concept's Examples, its table's cells, and everything deeper in the subtree. A nearer declaration shadows an outer one.

- **Bounds chain.** `age >=18 <=65` holds the attribute both ways.
- **The bound is Python**, for example `cap <=@price*1.5`, `start <=date(2026, 12, 31)` or `status =("draft", "sent")`. Its references resolve *per value*, against that value's own Example or row, so `Order|price|margin >=@price*0.1` holds each row's margin to that row's price.
- **It is checked when Python runs** (`Ctrl+Enter`, `F9`, the park key), all of a file's bounds in one round trip. It is never checked on a keystroke.
- **A breach is a warning** on the offending value, in the `aot-python` collection, and never counts in `V`. It stands until the value is edited or the next run. A bound that cannot compute is one error, on the clause that wrote it.
- **An empty value asserts nothing**, so it is held to nothing.
- **Values never carry bounds.** `age: 25 >=18` is just the value `25 >=18`.
- **Prose is safe.** `speed > none noted` and `age >= 18 years` stay plain names, because a bound is believed only when the text after the operator reads as a Python expression, without running it: brackets and strings closed, no two words side by side ([`src/pyshape.js`](src/pyshape.js)).

**`=` naming one value defines.** A `>=` says a value must be *at least* something. An `=` on the attribute whose bound computes **one value** says what the value **is**, so it derives every value of that attribute, written once where the attribute is declared:

```aot
Order
    tax rate: 0.2
    Order|price|vat =@price*@tax rate
    A    |100  |20
    B    |40   |8
```

Each run writes the definition into every value of the attribute that has no derivation of its own. That includes an empty cell, and it corrects one that drifted. The cells carry the **value alone**, because the definition lives in the header. The same holds in line form: `vat =@price*0.2` on the attribute fills the `vat:` of every Example beneath it that has a `vat:` line. A value's **own `=` derivation wins**, as the nearer word, and a value it computes that differs from the definition is a warning.

**`=` naming a collection lists the allowed values.** A tuple, list or set of values names no single value, so it is membership, not a definition, and fills nothing in:

```
Order
    status =("draft", "sent", "paid")
    - A
        status: sent          <- one of the three; nothing to report
    - B
        status: void          <- after Ctrl+Enter: 'void' breaks 'status =("draft", "sent", "paid")'
                                 — it is not one of 'draft', 'sent', 'paid'
```

An ordering against a collection holds when the value meets any of its members: `>=(1, 9)`.

#### The repository's Python

**Any Python file in the repository serves a derivation**, in `aot.files` or anywhere else. It is named as a module, with no `import` to write:

| Written | Reaches |
|---------|---------|
| `=finance.revenue(@Sales)` | `finance.py` in `aot.files`, else at the repository's root, else the one file of that name anywhere else in it |
| `=tools.finance.revenue(@Sales)` | `tools/finance.py`, by its dotted path from the root. A folder holding Python is a package, with or without `__init__` |
| `=aot.use("tools/my helpers.py").total(@Sales)` | A file by its path, for one whose name is not an identifier |
| `=csv.QUOTE_ALL`, `=scipy.stats.norm.cdf(1)` | Any module of the standard library or an installed package, with submodules imported as they are reached |

- **The standard library and installed packages come first**, so no file in the repository can stand in for one. An `os.py` anywhere shadows nothing.
- **Two files of one name are an error** that names both and the dotted path to write instead.
- **Some folders are never searched:** a virtual environment, `node_modules`, `__pycache__` and hidden folders. They are not the repository's own code.
- **A module changed on disk is imported again on the next run**, and every derivation naming it fades as stale until then. A module it imports in turn is not followed, so run the line to take in a change there.

#### What comes back

| Result | Written |
|--------|---------|
| A number | `3,628,800`: separated, two decimals at most, keeping a `$` from the value it replaces |
| A date, a datetime | `2026-09-22`, `2026-09-22 14:30` |
| `True` / `False` | `Yes` / `No` |
| `None`, NaN | An empty value |
| Short text | The value, with any pipe bent to `¦` |
| Text over `aot.python.maxInlineText` (120), or holding a line break | `aot.files/<address>.md`, and the value is its path |
| A matplotlib Figure or Axes, a PIL image, image bytes | `aot.files/<address>.png`, and the value is its path. Hover shows the picture |
| A DataFrame **on an attribute** | `<DataFrame 1,204 rows × 4 cols>`. The frame stays live for `@` |
| Anything else | `<list 3 items>`, `<dict 2 keys>`, `<ndarray 3 × 4>` … |

The file name is the value's `@` address, reduced to safe characters. It is never a path of Python's choosing.

**A computed number is always written with thousands separators**, with two decimals at most, while a value you *typed* is never reformatted: a typed `1815` stays `1815`. One surprise follows: a computed year reads `2,026`. When you mean a year, return text (`str(y)`) or a `date`.

#### Running

- **`Ctrl+Enter` on a derivation** runs it, any stale derivations it reads, and **everything that reads it**, in place, so nothing is left half up to date. It then checks every constraint.
  - **In a table row holding several derivations**, it runs the one in the cell the cursor stands in; on the row's name, or a cell with none, every derivation on the row.
  - **Anywhere else in the file**, `Ctrl+Enter` (or `F9`) runs every stale derivation and checks every constraint.
  - **A derivation is stale** when its source, what it reads, or the Python files it names (the sidecar among them) changed since it last ran. A fresh one is not run again.
  - **In a file with no derivation and no constraint**, `Ctrl+Enter` inserts a line as it always did.
- **`Ctrl+Shift+``** runs every derivation **fresh** and checks every constraint, then [parks](#parking-the-derivations) them all, so what parks is current. Putting them back runs nothing.
- **AOT: Run All Python (Fresh)** starts from a new session.
- **Nothing runs on a keystroke**: not typing, Tab, Format Document, a save or a CSV arriving. A value holds its last result until it is asked for.
- **A copied derivation arrives without a value** and waits for the next run. This covers `Ctrl+'`, a fill, *Copy Formula Down the Column*, *Across the Row* and *to Sibling Examples*. The value in front of the original was computed where it stood, not where the copy lands.
- **Each run is a single pass**, dependencies first. A cycle runs nothing and names its members.
- **A failure** leaves the value as it was and says why on its line, and whatever reads it is not run. Nothing is written over a good value.
- **There is one Python session per document**, kept between runs along with its live results. It ends after `aot.python.idleTimeoutMs` idle, when the file closes, and when a derivation exceeds `aot.python.timeoutMs`. A hung expression holds the interpreter, so stopping the process is the only way to end it.

#### Libraries

- **Always there:** `math`, `statistics`, `re`, `json`, `random`, `itertools`, `functools`, `Path`, `date`, `datetime`, `timedelta`, `Decimal`, `Counter` and `defaultdict`.
- **Imported in the background once Python is on:** **`pd`** (pandas) and **`np`** (numpy).
- **Imported the first time a derivation uses them:** **`plt`** (matplotlib, on the non-interactive `Agg` backend, so no window ever opens), **`sns`** (seaborn), **`stats`** (scipy.stats), **`Image`** (PIL), **`requests`** and **`relativedelta`**.
- **A missing library fails only on the line that uses it**, naming what installs it. **AOT: Show Python Environment** lists the interpreter, what it has, and what it is held to.
- **Worth installing:** `openpyxl` for `pd.read_excel` and `pyarrow` for parquet.
- **Anything else is there by its name.** See [the repository's Python](#the-repositorys-python).

#### The environment (uv)

A repository can carry its own Python environment, set up with [uv](https://docs.astral.sh/uv/), so every writer runs the derivations with the same libraries.

**AOT: Set Up Python Environment (uv)** does it in four steps:

1. **The project.** It asks which libraries you want (pandas, numpy and matplotlib come ticked) and writes `aot.files/pyproject.toml`. A repository that is already a uv project (a `uv.lock` beside a `pyproject.toml` at its root) is used as it is.
2. **The lock.** `uv lock` resolves the project into `uv.lock` from built wheels only. Commit both files.
3. **The review.** Before anything is installed, it shows what the lock would install: every package, and by name any that comes from outside PyPI (a git repository, a URL, another index). Nothing installs without "Install".
4. **The install.** `uv sync --locked --no-build --no-install-project --compile-bytecode` installs exactly what the lock says into `aot.files/.venv`, from built wheels alone, so nothing is built or run to install it. uv keeps the environment out of git itself.
   - **One environment per operating system.** On Linux and macOS it goes to `.venv-linux` / `.venv-darwin` instead. A checkout on `C:` used from Windows and from WSL keeps one of each, and neither setup ever replaces the other's.
   - It compiles the environment to bytecode as it installs. The runtime never writes `.pyc` files itself, so without them every session would compile pandas from source, 40 seconds and more, before its first derivation could run.

- **An unchanged project installs again without asking.** One whose `pyproject.toml` or `uv.lock` changed since (a pull) is reviewed again first.
- **A run never installs anything.** When the project has moved on since the setup, the run says so, once, and goes on with the packages as they were installed. Run the setup to bring it up to date.
- **To add a library,** add it to `aot.files/pyproject.toml` and run the setup again. A missing library's message says exactly that.

**Which Python runs** (`aot.python.manager`):
- **`auto`** (the default): `aot.python.path` when it is set, else the uv environment set up here, else Python on PATH: `python` on Windows, and `python3` then `python` elsewhere, since Debian, Ubuntu and WSL ship no bare `python`.
- **`uv`**: the environment only; a run with none says to set one up.
- **`python`**: never an environment.

A uv environment is started **isolated** (`-I`): no `PYTHON*` variables, no user site-packages, no current directory on the path.

**An environment is used only as it was set up here.** The setup records a hash of the environment's interpreter, and a run starts that interpreter only while the hash still matches.
- A `.venv` a repository arrived with is never run.
- An interpreter that changed since the setup is never run either; the run says to set up again.
- The setup replaces a `.venv` it did not make rather than taking it over.

#### In the editor

- **Every Python finding is in a collection of its own** (`aot-python`), and **none counts in `V`**: a failed run or a broken bound is a verdict on a run, not on the model. A derivation that has not run yet says so, as information.
- **An inlay at the end of each line says how it last ran, and when:** `✓ 3 rows · 12 ms · 16:04`, `✗ KeyError: 'units' · 16:04`, `– not run · 16:04`, `✎ edited since 16:04`.
  - A table row holding several derivations has **one** inlay that names its cells: `✓ vat, net · 3 ms · 16:04`, or the first cell in trouble, `✗ net: NameError… · 16:04`. Its tooltip has a line for each cell, and hover on a cell's value says what computed that cell.
  - A run from an earlier day shows its date, `2026-09-23 16:04`, and the hover gives the time to the second.
  - The time is kept with the run records, so it outlasts the session and a restart of the editor.
  - A value older than its derivation (edited, or something it reads changed) is **faded**.
  - A table Python wrote is tinted, and its hover says every row of it is the derivation's.
- **The function a derivation calls is underlined when a Python file here defines it**, and **Ctrl+click** opens that file at its `def`. That can be the sidecar's own function, one the sidecar imports (`from helpers import load`), or a module's (`finance.revenue`, `tools.finance.revenue`, `aot.use("…").total`). A function of the standard library or an installed package has no file here, so it is not underlined.
- **Hover** a function for its signature, docstring and file.
- **Completion:** after `=` it offers the sidecar's functions and the repository's modules, after `finance.` that module's functions, and after `@Sales.` the table's columns.
- **The derivation wears its own colour.** Everything from the operator to its end, a constraint's bound included, is painted as Python, so code reads apart from data at a glance.
- **The model never sees a derivation.** The Attribute Value is the value part alone, so crosslinks, FCA, Gödel numbers and dependency inference all work on clean data.
- **The lightbulb** runs the derivation, creates a stub for a function the sidecar lacks, or **moves the expression into the sidecar**. Each `@` reference becomes a parameter, and the line calls the new function.
- **The `.aot` holds what you know; the `.py` holds how you got it.** Every attribute is part of the model, so a pipeline's intermediate steps belong in the sidecar, and only facts should surface in the file.

#### Parking the derivations

A file that computes holds two things in one place:

- the **values**, which are what you read;
- the **derivations**, which you wrote once and mostly never want to look at again.

`20 =@price*@tax rate` in every cell of a column makes it three times as wide as its data and buries the number under the code that produced it.

**`Ctrl+Shift+`` takes every `=` derivation, and every constraint on an attribute declaration, out of the data**, and the same key puts them back. The order is the whole design:

1. **Python runs first**, every derivation fresh and every constraint checked, so every derived value is materialised where it stood. With Python off, or in an untrusted workspace, the values park as they stand, and the status bar says so.
2. Only then do the derivations leave, for `aot.files/<file>.formulas`, which records the interpreter and library versions that computed them.
3. The tables re-align, so the columns narrow to their data. One `Ctrl+Z` undoes the lot.

```aot
before                                    after Ctrl+Shift+`
Invoice|price >=0|vat           |        |Invoice|price|vat
INV-1  |100      |20 =@price*0.2|        |INV-1  |100  |20
INV-2  |250      |50 =@price*0.2|        |INV-2  |250  |50
```

```
aot.files/Ledger.formulas
    @Invoice@price: >=0
    @Invoice@vat@INV-1: =@price*0.2
    @Invoice@vat@INV-2: =@price*0.2
```

**The parked file still stands on its own.** Every value is present, so it still says exactly what it said. The derivations are done with, since their results are already written in the data. The **constraints are not**: a bound computes nothing that could stand in its place, so taking it out of the file would silently switch it off. So **a parked constraint is still checked**. The editor reads the constraints back out of the store, and each run holds every value to them exactly as when they stood on the declaration: `price: -5` still warns, now as a breach of the *parked* bound. A parked `==` definition still defines. `verify.js` runs no Python, so it checks neither. Nothing in the CSV mirror or the cross-file reconcile knows the store exists.

**Each derivation is addressed with the `@` path the language already uses.** `@Invoice@vat@INV-1` is the `vat` of the Example `INV-1` of the Concept `Invoice`. [A table and a `- ` list are one idea in two spellings](#tables-are-pure-shorthand), so that one address finds the Example whichever way it is written.

- A value on the Concept itself is two segments (`@Invoice@tax rate`).
- An Example nested inside another adds a segment, outermost first.
- A Concept's own derivation is filed under the Concept alone (`@Sales`).
- A bare `=` line comes off **whole**, and is filed by where it stood and what it wrote, `@=Sales@Region: =load_all()`. It comes home on the line above the Concept that stood directly beneath it — normally the first table it wrote; one it did not write is marked `^` (`@=^Notes`), so its rows are never tinted as the line's. A line with no Concept beneath it has nowhere to come home to, so it stays in the file, and the park key says so.

**A parked value says so.** The same plainness that lets a parked file stand on its own sets one trap: `20` in a cell looks exactly like a `20` somebody typed, so it invites being typed over, and that edit stands only until the derivations come home and run again. So every value the store owns is **tinted where it stands**, in the editor's inlay-hint colours: it is a number the editor is showing you rather than one you wrote.

- Hover names the derivation, the address it is filed under and the store it is in. It offers to put the derivations back in one click, which is where you change what a value computes.
- The mark is a background and never added text, so a marked cell keeps the width its column aligned it to.
- It is drawn from the store rather than the data. It appears the moment the store lands and goes the moment the store is deleted, whether by the key, by hand, or by a pull.
- Turn it off with `aot.parkedValueMarks`.

More about parking:

- **Constraints park with the derivations.** `age >=18`, `status =("draft", "sent")` and `vat =@price*0.2` leave their declarations: a header cell narrows to its column's bare name, and a bare attribute line to its term. Each is filed under the declaration's own address, `@Person@age: >=18`. A stored entry shows which it is by how it opens: a derivation with one `=`, a constraint with its operator. The attribute's name is tinted like a parked value, and its hover names the constraint and says it is still checked.
- **A cell holding only a derivation parks too**, and leaves its computed value behind. That is what step 1 is for.
- **Nothing is ever invented back.** Rename or delete a row while its derivation is parked and that address no longer names anything. It is reported and **kept in the store** rather than guessed at, and the store stays until it resolves.
- **The store's existence is the state.** A file is parked when it has one, and putting the derivations back deletes it. Commit it beside the `.aot`, since it is the only copy of the derivations while they are out. **It may hold Python**, so review a change to it as you would code.
- **An address that no longer names anything is not marked**, for the same reason it is never invented back. The mark is drawn by the resolution that puts the derivations home, so what the editor tints is exactly what unparking would rewrite.

#### Trust

A `.aot` with Python in it is **a program**, and it runs with your permissions. It can read your files, reach the network, and write what it finds into the document, where a commit and the CSV mirror carry it on. Python cannot be sandboxed inside its own process, so this is a **marked trust boundary**, not a sandbox. The boundary is drawn in layers:

**What may run at all**
- **`aot.python.enabled` is off by default**, and nothing runs in a workspace VS Code does not trust.
- **The settings that decide what runs are yours alone.** `aot.python.enabled`, `aot.python.manager`, `aot.python.path`, `aot.uv.path` and every guard below are user settings, so no repository's `.vscode/settings.json` can turn Python on, choose the program that runs, or loosen a guard.
- **A program is found on PATH and nowhere else.** On Windows, launching `python` by its bare name also looks in the folder the process starts in, and a run starts in `aot.files`, where a repository could leave a `python.exe` of its own. So `python` and `uv` are resolved to absolute paths from PATH's absolute entries before anything is launched.

**What is asked about first**
- **The Python a `.aot` carries is asked about piece by piece.** Each derivation and each constraint's bound is known by a hash of its text.
  - One written in this editor is yours and runs without asking, saved or not.
  - One that arrived from outside is asked about before anything starts. That covers code on disk that never ran here (a pull, a clone, another tool), and code the editor brought in itself: a store coming home, a CSV folded back, a peer file reconciled.
  - The question names the lines and the code; **Show Them** lists them all.
- **Every Python file is asked about by its path the first time a run reaches it.** That includes the sidecar, a module a derivation names, and a module those import, because a file's top-level code runs the moment it loads.
  - The answer is kept per file, by a SHA-256 hash of its content.
  - A change saved **in this editor** is yours and runs without asking. A change that arrives from **outside** is asked about again, and **Show Changes** opens the version you allowed beside the one that is there now.
  - No folder is put on Python's import path. The runtime finds the repository's files itself, after the standard library and installed packages, so nothing in the repository can stand in for them.
- **An install is asked about before it happens**, listing what it will install (see [the environment](#the-environment-uv)), since an installed package runs whenever Python starts.
- **Every answer is kept in VS Code's workspace state**, never in the repository, so no repository can ship its own.

**What the process is held to** (checked at start, before any repository code runs, and never lifted; **Show Python Environment** reports them):

| Setting | Default | What it does |
|---|---|---|
| `aot.python.maxMemoryMb` | 4096 | Memory is capped by the operating system: a job object on Windows, a data-size limit on Linux (the memory actually used, not the address space numpy and pyarrow reserve, so they import under it on a many-core machine). Past the cap an allocation fails instead of the machine grinding. numpy's BLAS is also held to four threads unless `OPENBLAS_NUM_THREADS` / `OMP_NUM_THREADS` / `MKL_NUM_THREADS` say otherwise. |
| `aot.python.allowSubprocess` | off | The process may not start another program. On Windows this is the operating system's refusal (the job object admits no second process), which nothing inside Python can undo. Elsewhere Python refuses the calls that start one. |
| `aot.python.allowNetwork` | on | When off, Python refuses connections beyond this machine. |
| `aot.python.protectCredentials` | on | Python refuses the places credentials are kept: `~/.ssh`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.kube`, `~/.docker`, `~/.gnupg`, `.netrc`, `.git-credentials`, the browsers' profiles, and the Windows credential store. The process also starts without the editor's secrets: variables such as `GITHUB_TOKEN` and `AWS_SECRET_ACCESS_KEY`, the ssh agent's socket, and VS Code's own askpass handles are withheld. |

Python's own refusals are its audit hooks. They stop the calls that make them, not code written to get round them (ctypes, an extension module), so they guard against the ordinary payload and the honest mistake. Only the operating system's limits hold against anything.

**What a result may write**
- **Data never becomes code.** A value Python writes has any `=` that would open a derivation doubled (`==`, which a reader sees as the one `=` it is). A column or row name that would read as a bound or a derivation has its operators made full-width. A CSV folded back is escaped the same way. So a downloaded table holding `x =os.system(…)`, or a column named `n >=evil()`, stays text.
- **A result that looks like a credential is not written.** That covers a private key, and AWS, GitHub, Slack, Anthropic, OpenAI-style or Google keys and tokens. What is written into the file is committed and pushed, so such a result is refused with a message saying why.

**What it does not do**
- **`verify.js` never runs Python**, so a CI job checking a pull request cannot be made to. Nor should CI run `uv sync` for a pull request it has not reviewed. The `.formulas` store says it may hold Python.
- **What it costs:** "the file stands on its own" holds in letter, since every value is written and `V` judges them. But a Python value's provenance is no longer checkable from the text alone. The run records the interpreter and library versions, and the hover shows them.
- **Real containment is not done here.** Running the process in a container or an operating-system sandbox, with no network and a read-only repository, is the only way to hold code that is written to escape. Until then, the switch, workspace trust and the questions above are the protection.

[`examples/python edge cases.aot`](examples/python%20edge%20cases.aot) is a catalogue of the cases worth knowing, each with what should happen. Run it with its sidecar, [`aot.files/python edge cases.py`](aot.files/python%20edge%20cases.py), to see.

### The CSV mirror

Every Concept with Examples lives twice: as the notation in the `.aot` — a table, `- ` lines, or both — and as **one union CSV named after the Concept** in **one `aot.files` folder at the repository root**, shared by every `.aot` in the repo. The CSV is per **Concept**, not per table (unified in 1.6): its rows are every Example in the Concept's scope — table rows and `- ` Examples together, and a table filed under an `- Example` mirrors into the **first Concept up the tree** — and its columns are the **union of every attribute** any of them carries. A row silent on a column answers the inherited default, else stays blank, so Examples carrying different attributes all fit one file. A Concept written in several files mirrors **their union**, and each row's edit goes back to the file that lists it.

**The file saved last overrides the other** (`src/csvsync.js`). That is the whole rule, and it holds even where the other file was edited too. The two files' save times decide, so nothing is merged and nothing is remembered. It works the same on a fresh clone, in a moved folder and on a new profile.

| Saved last | What happens |
|---|---|
| the `.aot` | the CSV is rewritten from it, whatever the CSV said |
| the CSV | the `.aot` takes every cell where the two differ, and loses every row the CSV no longer lists |

So:
- **An edit in the other file is overwritten**, in any cell, and no notice says so. In a `.aot` open in the editor, `Ctrl+Z` brings it back. Otherwise only git can.
- **Only the time counts.** A CSV saved last wins even where it says an older value. A CSV whose time is older than the `.aot`'s loses, even one just copied into the folder, since a copy can keep its old time.
- An **emptied** cell empties, and a **new row** arrives.
- A row the CSV no longer lists is **deleted from the `.aot`** with nothing asked, along with everything written under it. The one exception is a row whose sub-row the CSV still lists: it stays, and a notice says so.
- A column comes from the `.aot` alone. One the CSV adds is not read.

Every sync point applies the same rule:
- **Saving the `.aot`** writes one CSV per Concept with Examples in its scope — a table, `- ` lines, or both (an assumed lone header still being typed is left alone) — over whatever the CSV says. Cells holding commas, quotes, or newlines are quoted per RFC 4180.
- **A `.aot` saved by another program, or a pull,** does the same as soon as the file watcher hears it.
- **Saving a CSV** — in Excel, a script, anything — folds it back **by Example name, wherever each lives**: a table row updates cell by cell within its table's own columns (redrawn aligned, dividers where they stood), a line-form Example updates attribute by attribute, and a fresh name lands in the Concept's own shape — a row of its table when it has one, else a `- ` block (under its parent's `- ` line, when its `parent` cell names one). A value the Example already reads from a default is not written down as its own. Columns arrive when a table is created, never from the mirror. A value carrying a **formula** is left to its formula.
- **Unsaved text is no save, so a CSV saved last overrides it too.** The table in the open `.aot` ends up saying what the CSV says, cells and rows alike, your unsaved edits to it included. `Ctrl+Z` brings them back. Anything else unsaved in that file stays, and the file is left for you to save. Saving it makes the `.aot` the file saved last, and the CSV is written.
- **A CSV with nothing new overrides nothing.** A CSV saying what the saved `.aot` says has no word of its own, however late it was saved. The mirror writes the CSV after every `.aot` save, so this is what keeps it from wiping what you type next.
- **When the editor starts**, the folder is caught up by the same rule, so an edit made with VS Code closed, to either file, is not missed. A folder already in step costs nothing.
- **AOT: Sync CSVs Now** (`Ctrl+K Y`) applies the rule by hand, to every CSV. With `aot.tableCsvSyncMode` set to `manual`, it is the only sync there is.

- **A nested scope carries its shape in a `parent` column.** Every reader of a CSV trims its cells, so an indent would not survive the trip out to a spreadsheet and back. Where a Concept's Examples nest, the mirror writes one extra column — `parent`, naming the row each row sits under, empty for a top-level one — which a spreadsheet cannot damage. It is the column a [table](#tables) nests through too, `parent (thing)`, so merging it back writes the row's parent cell, and re-parenting a row in Excel re-files it. A **flat** scope nests nothing and gains no column; a Concept that already states its own `parent` attribute keeps that one column, since it is the same fact under the same name.
- **Hover a Concept to open its CSV.** Hovering its name, or anything that links to it, offers **Open Order.csv**, once the CSV exists.
- **Saving also tidies**: a CSV whose Concept no file *anywhere in the repo* still speaks for is not deleted — it is archived with a `_` prefix (`_Order.csv`) and skipped by the fold-back watcher.
- **One folder, one repository.** The root is the nearest `.git` above the `.aot` — so a subfolder opened on its own, a repository opened as several workspace folders, and a file opened with no folder at all all write to the same place, and a repository nested in another (a submodule) keeps its own. A file in no repository falls back to the workspace root.
- **Only `.csv` files are the mirror's business.** `aot.files` is the repo's one side-folder, so it also holds the [`.formulas` stores](#parking-the-derivations) and any file a value cites by path. The mirror writes, archives, and folds back `*.csv` and nothing else.
- **What Excel writes is read as what it means.** A **byte-order mark** in front of the first cell (Excel's *CSV UTF-8*) is dropped rather than carried into the cell that names the Concept, and a **semicolon-delimited** file — all Excel writes where the comma is the decimal mark — is read as cells. The mirror itself always writes plain commas and LF. Excel holds a **lock** on the workbook it has open, so a save that cannot write the CSV says so and leaves it alone instead of failing silently (a workbook then saved over it is the file saved last, and overrides the `.aot`); and because Excel saves by renaming a temp file over the target, a fold-back that catches the file mid-swap retries rather than dropping the edit.
- Both directions write only when the content genuinely differs, so the two mirrors never chase each other. Line endings and a byte-order mark are not a difference: a CSV that came back from Excel or git with CRLF is the same data, and is left alone. A CSV you have open with **unsaved edits** is never overwritten — you get a warning to save or revert it first. A pipe typed into a CSV cell is bent to a broken bar (`¦`), since it cannot survive inside a pipe grid. Two files with a same-named Concept share one CSV — the repo-wide duplicate-Concept warning makes that visible; two same-named Examples at different levels of one Concept's scope merge by name on the fold, first one wins.

**A Concept written purely line-form mirrors exactly as a table does.** A table and a `- ` list are one idea in two spellings, so the Concept below writes `Integer.csv` on its first save with nothing placed there beforehand — and a Concept listing **bare names** writes its one-column CSV just as a table of names would.

Save the Concept below and it keeps `aot.files/Integer.csv` up to date; edit that CSV and the rows fold back — merged by name, so an Example already there is updated attribute by attribute and one that is not is appended whole:

```
aot.files/Integer.csv          Integer
    Integer,is prime               - 1
    1,Yes                              is prime: Yes
    35,No                          - 35
    7,Yes      <- added                is prime: No
                                   - 7            <- folded in
                                       is prime: Yes
```

A CSV arriving is data, and data is no reason to restructure a tree you wrote deliberately: the Concept keeps the form it is written in. A value carrying a **formula** is left to its formula. A blank cell empties a value only when it held one the last time the two agreed; otherwise it says nothing, since a CSV cannot tell "empty" from "unsaid".

**Archived CSVs are still worth reading.** A `_Person.csv` is never folded back — that would silently undo the archiving — but the values in it were real once, so they are offered as **completions** where a `person:` value is typed — line form or a typed column's table cell alike — listed after the Concept's live Examples and marked `archived in _Person.csv`.

**A file you cite can be brought in.** Put the cursor on any file-path value pointing outside `aot.files` and the lightbulb offers **Copy '<name>' into aot.files**: the file is copied in and the value rewritten to `aot.files/<name>`, so the model travels with its evidence instead of pointing into somebody's Desktop. A file already there with the same bytes is simply relinked; one that differs asks before replacing, and offers to keep both. A CSV that any value points at counts as claimed, so the tidy-up never archives the very file a link names.

The mirror means the same knowledge is at once a checked Alpha model and an ordinary spreadsheet any tool can read. Turn it off with the `aot.tableCsvSync` setting.

### Tables are pure shorthand

The tree a table parses to is identical to writing each row as a `- Example` with `attribute: value` children, so everything that reads the tree works over a table unchanged — inheritance, the crosslinks (a header cell that names a Concept underlines solid, a value cell that names an Example underlines dotted, and both Ctrl+click to the definition), the FCA audit, the Gödel numbers, and the dependency inference.

Every editor feature reaches inside the cells too:

- **Colouring**: the first header cell is painted as the **Concept** it names, the header cells after it as attributes, each row's first cell as an **Example**, and the rest as Attribute Values — the very colours their written-out line forms get — with the pipes left as quiet table chrome.
- **Aliases**: a header cell may carry a parenthetical alias, `size (length)`, which strips, colours, and crosslinks exactly as it would on a bare attribute line — the first header cell's `(alias)` naming the Concept.
- **Linting in place**: a table finding pins the offending cell rather than the whole line — a lowercase or empty first cell, a capitalised column, a row's extra cells, and an empty name cell each squiggle where they sit.

That last point is how Alpha answers org's `#+TBLFM` formula line. Org's spreadsheet re-computes derived columns; Alpha's linter audits them (a [Python](#python) derivation computes a value when asked, and the linter judges what it wrote like any other value). Two rows with the same name are an identical-siblings error; two rows with identical content are a Gödel clash; a row that carries every attribute another Concept's Examples share is drift; and a column whose values are pinned down by another column — the very thing org would compute with a formula — is what the Armstrong dependency warnings flag. In Alpha a computed column is not a formula to store but a dependency to model once, against its determinant. See [`examples/spreadsheet.aot`](examples/spreadsheet.aot).

### Flipping between a table and free text

If the two forms say the same thing, the choice between them is a question about the *data*, not about the model — and it is a question you answer differently as the data grows. Six short attributes across twenty Examples want to be a grid; two Examples carrying a paragraph each want to be lines. **`Ctrl+Alt+T` writes the Concept at the cursor out in the other form, and the same key writes it back.** Where the operating system or the keyboard layout takes `Ctrl+Alt+T` for itself, `Ctrl+K T` does the same, and so do the right-click menu and the Command Palette (**AOT: Flip Concept Between Table and Free Text**). It is not on the lightbulb: offered on every line of every Concept, it lit the bulb everywhere. The cursor may stand anywhere inside the Concept — its own line, a header cell, a row, an attribute name, a value — and **it stays on the same idea**. A value line's cursor lands in that value's cell, as far in as it was. A declaration's lands on its header cell, and an Example's line on its row's name, and back. An empty cell writes no line, so its cursor lands on the Example's name, and comes back to that cell.

```aot
Person                                  Person   |first name|age
    first name                          Aristotle|A         |10
    age                        <-->     Socrates |Sokrates  |20 =10+10
    - Aristotle
        first name: A
        age: 10
    - Socrates
        first name: Sokrates
        age: 20 =10+10
```

- **No Example and no value is ever lost**, and a derivation moves exactly as typed — `20 =@price*@tax rate` travels whole. An attribute's `(alias)` and its constraints ride on the header cell going out and on the declaration line coming back; a bound never lands on a value line, because it governs the attribute rather than each value of it. A `|` arriving from a CSV bends to a broken bar, since the divider cannot live inside a cell.
- **One thing does move: an attribute a single Example only *declares*.** A bare `nickname` under `- Socrates` states an attribute without giving it a value, and a table has exactly one place for an attribute name — the header — so it becomes a column of the Concept with Socrates's cell empty. The declaration widens from the one Example to all of them; the empty cell still asserts nothing. It is the one reading a grid cannot express, and it is why the flip tells you what it did rather than doing it silently.
- **What is presentation of a grid comes off with it** — a column is padded to its widest cell, and in free text there is no column to pad.
- **The flip computes nothing.** Every value stays exactly as it was written, and each derivation travels whole beside it; the next `Ctrl+Enter` runs them where they have landed.
- **A sub-Example is a row too.** An Example carrying Examples of its own flips to a row naming its parent in the `parent (thing)` column — added, second, only when something nests — and back to a `- ` line under its parent's, so a tree written as lines and the same tree written as a grid are one idea in two spellings:

  ```aot
  Thing                                   Thing       |parent (thing)|age
      age                                 Parent      |              |
      - Parent                   <-->     Child 1     |Parent        |10
          - Child 1                       Child 2     |Parent        |12
              age: 10
          - Child 2
              age: 12
  ```

- **A blank line above an Example is a divider above its row**, and back: the blank between a Concept's declarations and its first Example is a divider under the header. Blank lines anywhere else (inside one Example's lines) are presentation and do not survive the round trip.
- **A Concept with no Examples flips too**, to its header alone (`Person|age|city`, or `Person|` with no attribute either), and back.
- **The Concept's defaults ride in the header.** `Invoice: EUR` becomes the first cell, `Invoice: EUR|…`, and `tax rate: 0.2` a header cell, `tax rate: 0.2`.
- **Nothing the flip cannot convert is restructured.** A Concept's `...` Maps, its sub-Concepts, and any Example carrying a Map or a sub-*Concept* (which a grid has no row for) keep their lines, and the grid is filed beneath them — the [merge form](#tables) the language already has. So does an attribute with children of its own, or one both bounded and given a default (one cell cannot hold both). Only a Concept whose subtree is nothing but attributes, defaults and Examples flips to a **standalone** table, naming itself in its first header cell exactly where its line stood. The maintained `... N more in a.aot:3` note does not count against that: a table has a place for it, one level under its last row, so a table carrying one flips and flips back unchanged. A table written straight after the Concept is kept apart from the new grid by a blank line, so the two never merge.
- Coming back, **a header cell is a declaration**, so it returns as the attribute line that declares the same column — which is why a Concept whose attributes were only ever stated on its Examples gains those declarations on the way back. That is the tree the table always parsed to, now written down. A row with no name keeps its values, under a `- ` that waits for one.

## Verification: the tooling

The VS Code extension adds syntax colouring for `.aot` files and an arithmetic linter after Leibniz: every idea receives a prime and its ancestry is encoded as a product, so the linter can verify the tree as you type. The checks stack in layers:

- **Syntax and arithmetic** (`src/linter.js`) — tabs, broken indentation, depth jumps, a Concept defined twice, and identical siblings all appear as squiggles in the Problems panel. A finding that names two places — a duplicate, a clash, a case-twin — squiggles **at both**, each diagnostic carrying the other location as clickable related information.
- **Crosslinks** (`src/crosslinks.js`) — an attribute whose trailing words match a Concept, or an Attribute Value that names an Example (case-insensitive, like every link), is underlined as a link; Ctrl+click jumps to the defining line, Shift+F12 lists every place a Concept or Example is referenced, hovering a linked Example shows its full details (owner, defining line, every value it carries), and hovering an Example's own `- ` line adds where it is used. A `https://` URL in a value is Ctrl+clickable too, and hovering it fetches its status, content type, and last-modified date (off with `aot.urlMetadata`). A value that resolves to a **real file** — an absolute path, one relative to the `.aot`, one relative to the workspace root, or a `~/` path from your home directory — is Ctrl+clickable as well, and so is a **`- ` Example whose name is such a path** (an Example may *be* a file, exactly as a table row may). A cited file living outside `aot.files` whose name is also held there clicks and hovers through to the **copy in `aot.files`** — the one that travels with the repo. Hovering an **image** (a `.png` or the like, whether URL, file value, cell, or `- ` Example) previews the picture inline.
- **Rename that keeps the model whole** — F2 on a Concept, an Example, or an attribute (line-form or a table's header or first-column cell) renames it everywhere it is meant: the declaration, every crosslink that resolves to it, and every `@` reference inside a derivation or a constraint's bound — the rename follows the same resolver that hands Python its references, so `@price`, `@total@Acme` and `@Order@price@Acme` all follow their declaration and no derivation is left pointing at yesterday's name. An attribute renames with its whole scope (the same-named copies its host's Examples carry, and the ancestor constraint that governs it); an attribute wearing a renamed Concept's name follows it, and the derivations reading that attribute follow in turn. Case follows the span: a span that is lowercase today (an attribute name, its alias) takes the new name lowercased, every other span takes it as typed — so Concepts stay capitalised and attributes stay lowercase through any rename. A span that resolves by another text — an alias, a plural — keeps its own spelling.
  - **Across the workspace.** A Concept written in another file is renamed there too, and so is every crosslink and `@` reference in another file that resolves to what is renamed, the same Concept's spelling in any file included. Other files are edited and left unsaved, for you to review.
  - **Rename by typing.** Typing over a used name is a rename in progress. Once the cursor leaves the name — or you save, or switch editors — the uses still saying the old name are counted across the workspace, and one notice offers to update them all: *'Socrates' is now 'Sokrates' — 3 uses still say 'Socrates' — 2 here, 1 in bank.aot*, with **Update 3 Uses** and **Dismiss**. It is one edit and one undo. The offer stays on the declaration's lightbulb until taken, dismissed, or moot. When the new name already names another of its kind, the notice says the update would merge the two, and **Dismiss** comes first. Undo and redo never start one.
  - Standing in a used name shows faint ghost text at the end of the line, *2 uses elsewhere*. Standing in a usage (an attribute wearing a Concept's name, a value naming an Example), it names what that usage points at, *names 'Person' — typing changes just this one*, since typing over a usage re-points that one reference rather than renaming anything.
- **Parking the derivations** (`src/park.js`) — `Ctrl+Shift+`` runs every Python derivation fresh, writes the values it computed where they stood, and *then* lifts the derivations out to `aot.files/<file>.formulas`, each addressed with the `@` path the language already uses. The grid narrows to its data; the same key puts them back. The parked file still stands on its own, so nothing else in this list — nor `verify.js` — knows the store exists. The one thing that does is the editor's own marking: a parked value is tinted where it stands and hovers with the derivation that owns it (`aot.parkedValueMarks`), so plain data never reads as data you may retype. See [Parking the derivations](#parking-the-derivations).
- **Two names for one idea** (`src/synonyms.js`) — the one half of univocity a linter cannot prove: two *different* names may still be one idea, and nothing in the tree records that `Client` and `Customer` are the same word in two dialects. So it asks, repo-wide and on both sides, with a lightbulb to rename one into the other or to record that they are genuinely different. Advisory, never in `V` (see [Two names for one idea](#two-names-for-one-idea)).
- **Subsumption** (`src/subsumption.js`) — a reasoner re-derives the Concept hierarchy from the facts each Concept declares and holds the written tree to it.
- **Formal Concept Analysis** (`src/fca.js`) — the linter treats the Examples and their attributes as a formal context, computes the concept lattice, and flags groupings the data supports that no Concept names, Examples filed away from the Concept whose attributes they share, and sub-Concepts that fail to cover or distinguish their parent's Examples. The crosslinks deepen the analysis: a value that names an Example elsewhere in the file carries that Example's whole ancestry into the context, so `operation: Ratio` and `operation: Formula` group together when Ratio is filed under Formula.
- **Gödel numbering** (`src/godel.js`) — where a line's characteristic number encodes only *where* it sits, a second Gödel number encodes *what it says* — one prime per attribute, raised to a power that encodes the value — and the linter compares those numbers to catch content clashes, values every child states, defaults no child keeps, and one content under two names across files. The numbers are stable (`aot.files/godel.tsv`), hover shows a node's content, `--diff` recognises renames, and git can merge an `.aot` by meaning (see [Gödel numbering](#gödel-numbering) and [Merging with git](#merging-with-git)).
- **Dependency inference** (`src/armstrong.js`) — the linter infers the functional dependencies the Examples bear out (see [Armstrong's axioms](#armstrongs-axioms-dependency-inference)).

The extension maps its findings to two severities: **errors** squiggle red and **warnings** squiggle yellow. Only errors count toward the violation total `V`; the file **verifies** when `V = 0`.

The same referee runs headless: `node verify.js <file.aot>` performs the identical check from the terminal — same rules, same gates, same `V` — and exits `0` exactly when the file verifies, so it drops straight into CI or an agent loop. See [The command line](#the-command-line).

### Settings

| Setting | Default | What it does |
|---------|---------|--------------|
| `aot.tableCsvSync` | `true` | Mirror every Concept with Examples to one union `aot.files/<Concept>.csv` (one folder at the repository root), kept in step both ways: [the file saved last overrides the other](#the-csv-mirror); an orphaned CSV is archived `_<name>.csv`, never deleted. |
| `aot.tableCsvSyncMode` | `auto` | When the mirror syncs: `auto` on every `.aot` save, every CSV edit and when the editor starts; `manual` only on **AOT: Sync CSVs Now** (`Ctrl+K Y`). The merge is the same either way. |
| `aot.spellingHints` | `true` | Hint words no English dialect knows, on their span and on hover, never in the Problems panel. A lowercase word passes if its Capitalised form is known (`december` / `December`). Each suggestion is a **Replace with 'X'** Quick Fix; a lone suggestion is preferred, so `Ctrl+.` `Enter` applies it in one stroke. |
| `aot.acceptedWords` | `[]` | Your own vocabulary, case-insensitive — fed by the Quick Fix on a spelling hint or a plural warning. |
| `aot.exampleHints` | `true` | Hint a value that names no Example of the Concept typing its attribute, with a Quick Fix that lists it. See [Values against their Concept](#values-against-their-concept). |
| `aot.synonymWarnings` | `true` | Warn when two Concepts look like two names for one idea (rule 14). Repo-wide. |
| `aot.distinctConcepts` | `[]` | Pairs you have declared genuinely different, written `client\|customer` — fed by the Quick Fix on a synonym warning. |
| `aot.godelRegistry` | `true` | Keep the [Gödel numbers](#gödel-numbering) stable in `aot.files/godel.tsv`, written on save when the repository gains an attribute or a value. Commit it; **AOT: Set Up Git Merge for .aot Files** merges it with git's union driver. Safe to delete: it is rebuilt, with new numbers. |
| `aot.dependencyFindings` | `false` | Surface the inferred functional-dependency warnings (rules 12–13) as squiggles. Off by default: correlated attributes are allowed; `verify.js --fd` always prints the full set. |
| `aot.chainHints` | `true` | Write the first dependency chain in small print (an inlay hint) at the end of each crosslinked line; the full chains stay on hover. |
| `aot.urlMetadata` | `true` | Hovering a URL fetches its status, content type, and last-modified date (one cached HEAD request); Ctrl+click opens it regardless. |
| `aot.parkedValueMarks` | `true` | Tint every value whose derivation is [parked](#parking-the-derivations), so a computed number is never mistaken for a typed one; hover names the derivation and offers the key back. |
| `aot.python.enabled` | `false` | Run the [Python](#python) a file carries, when asked (`Ctrl+Enter`, `F9`, or the park key). A user setting only, and never in an untrusted workspace. |
| `aot.python.manager` | `auto` | Which Python runs: `auto` (the path below if set, else the [uv environment](#the-environment-uv) set up here, else `python3` or `python` on PATH), `uv`, or `python`. User setting only. |
| `aot.python.path` | `""` | The interpreter, as an absolute path. Empty uses the uv environment or `python` on PATH, never one in the folder the run starts in. User setting only. |
| `aot.uv.path` | `""` | uv, for **AOT: Set Up Python Environment**. Empty finds `uv` on PATH. User setting only. |
| `aot.python.maxMemoryMb` | `4096` | The memory Python may take, enforced by the operating system; `0` for no limit. User setting only. See [Trust](#trust). |
| `aot.python.allowSubprocess` | `false` | Let Python start other programs. User setting only. |
| `aot.python.allowNetwork` | `true` | Let Python open connections beyond this machine. User setting only. |
| `aot.python.protectCredentials` | `true` | Refuse Python the places credentials are kept, and withhold the secrets in the editor's environment. User setting only. |
| `aot.python.timeoutMs` | `15000` | How long one derivation may run before its session is stopped. |
| `aot.python.idleTimeoutMs` | `300000` | How long an idle session — and the live results it holds — is kept. |
| `aot.python.maxResultBytes` | `8000000` | The largest result a derivation may send back; a bigger one stops the session with a message. |
| `aot.python.maxInlineText` | `120` | Longer text (or any with a line break) is written to `aot.files/<address>.md`, the value its path. |

### Errors — red squiggle, counted in `V` (the file does not verify)

| # | Rule | What triggers it |
|---|------|------------------|
| 1 | **No tabs** | A tab character anywhere in a line. Indent with spaces only. |
| 2 | **Indent is a multiple of 4** | Leading spaces not divisible by 4 (`spaces mod 4 ≠ 0`). |
| 3 | **No depth jumps** | A line indented more than one level deeper than the line above it — there is no parent at the skipped depth. |
| 4 | **Well-formed Example** | A line starting with `-` but not `- ` (exactly one space after the dash). |
| 5 | **No empty value** | `name:` with nothing after the colon. Supply a value or drop the colon. |
| 6 | **Do not repeat the file name** | A top-level line whose name equals the file name. The file name is already the root Concept. |
| 7 | **A Map holds only Maps** | A `...` Map node with any non-Map child. A Map marks omitted, todo, or low-confidence information; it never describes its parent and does not contain content. |
| 8 | **No "and" in a Concept** | A Concept name containing the word `and` — that is two kinds under one prime. Split it. |
| 9 | **Univocity** | The same Concept name defined more than once — case-insensitively, and numbering prefixes ignored (`Foo`, `FOO`, and `2. Foo` are one name). Every definition squiggles, each pointing at the others. One name, one prime; a recurrence needs a distinguishing qualifier prefix. |
| 10 | **No identical siblings** | Two children of one parent with the same kind, name, **and** value — compared case-insensitively, as references resolve. Siblings may share a slot only if their values differ. |
| 11 | **One alias, one target** | A Concept's alias must be a genuinely new name: two Concepts sharing an alias, an alias repeating its own Concept's name, or an alias that is the name of **another** Concept (`Home Address (Location)` where `Location` is also a Concept) — the last makes the two a single duplicated identity. If one is a *kind* of the other, file it under it in the tree; otherwise merge or rename. (Attribute aliases like `duration (time)` are unaffected — they are the attribute's crosslink.) |
| 12 | **Well-placed derivations** | A definition on a bare attribute that does not read as Python (`note = some words` — it defines nothing; add the colon to make it the value's own derivation), a derived default (`Currency: EUR =pick()`, or `tax rate: =x` in a header — a default is stated), a Concept's `=` with nothing after it, a lone `=` on a line of its own, or a bound with no attribute in front of it (`==("a", "b")`). What a derivation or a bound *computes* is never the linter's to judge: it is [Python](#python), which runs only when asked, and its findings — a failure, a breached constraint — are in a collection of their own that never counts in `V`. |
| 24 | **A part is not its whole** | A sub-Example carrying the name of an Example it sits under — directly or further up, in `- ` lines or table rows, case and numbering aside. One name cannot be both the whole and its part, and every path that names it (`@Order@total@X@X`, the CSV mirror's `parent` column naming its own row) would say nothing. The error is on the child, pointing at the parent. |
| 25 | **A parent cell names a row** | A table's [`parent (thing)`](#tables) cell naming no row of its table, naming its own row, or one of a circle of rows each naming the next — a circle has no top, so none of its rows has a place in the tree. Each such row stays a row of the table's own Concept. Also: a second parent column, or one carrying a default or a bound. |

Rules 1–12 and 24 are the syntactic and arithmetic checks (`src/linter.js`). On top of them, a **subsumption reasoner** (`src/subsumption.js`, after Description Logics' EL) re-derives the Concept hierarchy a *second* time — not from where each line is written, but from the facts each Concept declares (its attributes, values, the Concepts it crosslinks to, and any value's inherited ancestry) — and holds the written tree to it. A Concept's definition is read as a conjunction of those facts; `C is-a D` holds when D's whole definition is satisfied by C. A `...` Map child marks a Concept *open* (its facts are necessary but not yet sufficient), which excuses it from these checks. Placements the derived order contradicts are errors, also counted in `V`:

| # | Rule | What triggers it |
|---|------|------------------|
| 13 | **Misfiling** | A Concept's one most-specific genus (the Concept whose full definition it satisfies) is filed somewhere other than where this Concept sits — its facts say it is a kind of a Concept it is not written under. |
| 14 | **Multiple kinds** | A Concept's facts satisfy two genera, neither of which is under the other. A Concept must name one kind; file it under one and crosslink the other, or split it. This is the real single-inheritance check. |
| 15 | **Equivalence** | Two Concepts, neither above the other, carry identical definitions — their facts cannot tell the two kinds apart. Give one a differentia, or merge them. |
| 16 | **Cycle** | A loop of mutual is-a in the derived order (`A is-a B is-a … is-a A`), which no hierarchy can hold. Break it by giving one member a differentia the others lack. |

A genus must rest on at least two declared attribute names — one shared word is coincidence, not a kind.

On top of rules 1–16, a third tier of errors comes from the **Formal Concept Analysis audit** (`src/fca.js`) and the **Gödel numbering** (`src/godel.js`). A lattice or a content comparison over a broken tree means nothing, so these run **only once rules 1–16 are clean**; the FCA rules additionally need **between 2 and 200 Examples**. When they fire they are violations counted in `V` — the file does not verify until they are resolved:

| # | Rule | What triggers it |
|---|------|------------------|
| 17 | **Drift** | An Example carries every attribute the Examples of some Concept share, yet is filed elsewhere. Move it under that Concept, or give the Concept a differentia that genuinely excludes it. |
| 18 | **Exhaustion (overlap)** | Two sibling sub-Concepts read as different kinds but their Examples carry identical attributes. Differentiate them, or merge them. |
| 19 | **Exhaustion (gaps)** | Some of a parent's Examples match none of its sub-Concepts by attributes. The division misses a kind, or the Example lacks the attributes of its kind. |
| 20 | **Clash** | Two unrelated Concepts with equal Gödel numbers — identical attributes *and* values — so the data cannot tell them apart; or two Examples that share their **name** as well. An Example's name is part of what it is, so `P1` and `P2` carrying the same amount to the same payee are two payments, never a clash. Give one a differentia, or merge them. (The weaker same-name case — equal radicals, differing values — is not itself a violation.) |

A `...` Map child marks a node intentionally incomplete and excuses it from the drift and exhaustion checks (its missing siblings or attributes are declared, not forgotten) — for drift on **either side** since 1.8: no drift toward an open Concept, and none away from an open home, whether the marker is a Map or the Example form `- ...`. Drift needs **both sides of the fence to assert something explicitly** — inherited attributes never count. A Concept whose Examples share nothing beyond their ancestor's is skipped as a target, as is a Concept whose whole shared intent is inherited from above; and since 1.6 the Concept the Example is filed **under** must own at least one explicit attribute too (declared on it or beneath it) — a home that declares nothing states no differentia to hold or release an Example by, so no drift is reported from it.

One more error comes from the **declared dependency graph** (`src/armstrong.js` — see [Armstrong's axioms](#armstrongs-axioms-dependency-inference)). It is structural: it needs no Examples, reads the current file only (like the subsumption pass), and is **not** gated behind rules 1–16 — a loop shows in the same pass as any other error:

| # | Rule | What triggers it |
|---|------|------------------|
| 21 | **Dependency cycle** | A Concept rests on itself through other Concepts — `Shares Outstanding ─tensor→ Tensor ─shares outstanding→ Shares Outstanding`. A dependency chain must ground out, and a loop derives only `X → X` (Reflexivity, trivially true), so it asserts nothing while leaving every member defined through the others. One error per attribute carrying an edge of the loop — removing any one breaks it. An attribute of a Concept's **own** kind (`parent measurement` on `Measurement`) is direct self-reference: legitimate recursion, never flagged. |

Two more come from the **repo** (`src/repo.js` — see [Concepts across files](#concepts-across-files)). They apply only when the caller supplies the rest of the workspace, so a file judged on its own never sees them, and they are the only two disagreements a save does not simply close:

| # | Rule | What triggers it |
|---|------|------------------|
| 22 | **Contradicted value** | The same Concept, written in two files, carries two values for one attribute — `Jakus` with `role: analyst` here and `role: bookkeeper` there. One name means one thing, so it cannot mean both. Reported on every side, at the line that disagrees, each pointing at the others. One side saying nothing about the attribute is **not** this rule — silence is filled in on save, not flagged. |
| 23 | **Contradicted kind** | The same Concept filed under two different kinds — `Jakus` under `Motivation` here and `Team` there. A Concept is one kind. Only the *nearest* named ancestor is compared (how deeply each file nests its own subject is its own business), and a Concept at the top of one file contradicts nothing: that is silence again, not a second kind. |

### Warnings — yellow squiggle, in the Problems panel, but not counted in `V`

| # | Rule | What triggers it |
|---|------|------------------|
| 1 | **Singular Concepts** | A Concept name whose last word is plural (checked with `pluralize`, so it catches irregulars too: `Humans`, `Categories`, `People`). Use the singular form. |
| 2 | **Measurement needs a target** | A node with an `actual:` value but no `target:`. |
| 3 | **Measurement needs an actual** | A node with a `target:` value but no `actual:`. |
| 4 | **At most eight sub-Concepts** | More than eight sub-Concepts under one node. Group some under an intermediate kind. (Examples and attributes may be any quantity.) |
| 5 | **No lone sub-Concept** | A Concept with exactly one sub-Concept — a kind with one subtype *is* that subtype. Have zero, or more than one. |
| 6 | **No lone sub-Example** | An Example with exactly one sub-Example, by the same reasoning. |
| 7 | **Differentia** | Two or more sibling sub-Concepts with an identical attribute/value *slot signature* — they are told apart by position only. Give each a distinguishing attribute or value. A sub-Concept that asserts no slot at all is excused: with no attributes its `...` is implied, so its differentia is still to come. |
| 8 | **Case-twin Examples** | Two Examples whose names differ only in case (`- Socrates` / `- socrates`). Example references resolve case-insensitively, so they are one name to every link and audit — align the spelling. |
| 9 | **Stale derivation** | *No longer the linter's.* A derivation edited since it last ran, or reading something that changed, is an information note in the `aot-python` collection, and its value is faded until `Ctrl+Enter` runs it — see [In the editor](#in-the-editor). Nothing recomputes on its own. |
| 10 | **Breached constraint** | *Found when Python runs.* A value that fails its attribute's constraint (`age: 15` under `age >=18`, `status: void` under `status =("draft", "sent", "paid")`) is a warning in the `aot-python` collection, pinned to the offending value, naming the bound — worth knowing, but data out of bounds is not a broken file, so it never counts in `V`. It stands until the value is edited or the next run. See [Constraints](#constraints). |
| 11 | **Redundant dependency** | A direct dependency edge that a chain through another Concept already implies (Armstrong Transitivity): `share` on `Shares Outstanding` when `Shares Outstanding ─tensor→ Tensor ─share→ Share` already holds. The declaration adds nothing — drop the direct slot, or drop an intermediate link if the direct dependency is the one meant. Two attributes of the same type (`from node` / `to node`, both a `Node`) never imply each other: the witnessing chain must pass through an intermediate Concept. |
| 15 | **State a fact once** | Every child of a node sets one attribute to one value for itself — `wheels: 4` under both `Car` and `Van` — so it is a fact about the parent written once per child. The lightbulb **moves it up**: written once under the parent, taken off every child; a table column holding it in every row is dropped, the table taking the [merge form](#tables). Needs two children that are kinds, or three that are Examples (two rows agreeing is as often chance), and no `...` Map (an open division may yet gain a child that differs). A derived value is its own row's, never lifted. |
| 16 | **A default nothing keeps** | A node sets `temperature: cold` and every child overrides it — the default is in force for nothing under it. The lightbulb keeps just the attribute; when the children agree on one value instead, rule 15 offers to write that one in its place. |

Rules 15 and 16 are Gödel arithmetic (`godel.hoists`: every child's valuation of one prime equal, and the parent's not), so like the clash they run only once rules 1–16 are clean.

A `...` Map child marks a node intentionally incomplete, which **excuses** warnings 4–7 for that node: the missing siblings or differentiae are declared, not forgotten. A Map says *what is still missing, a todo, or uncertain* — it is never a description of the line above it (use a parenthetical alias to name or explain a term).

Two more warnings come from the dependency inference in `src/armstrong.js`. They are **off by default** — correlated attributes are allowed; opt in with the `aot.dependencyFindings` setting (`node verify.js --fd` always prints the full set). Like the FCA audit they mean nothing over a broken tree, so they run **only once rules 1–16 are clean** and need **between 2 and 200 Examples**; they reuse the Gödel numbers. They are warnings, not errors — a derivable column is a modelling smell, not a contradiction — so they do **not** count toward `V`:

| # | Rule | What triggers it |
|---|------|------------------|
| 12 | **Dependency (equivalence)** | Two attributes determine each other across the Examples — the same distinction written twice. Confirmed only when a value actually **repeats** (two Examples share it and still agree), so the collapse is witnessed, not coincidence. Model one and derive the other. |
| 13 | **Dependency (determination)** | One attribute's value is always pinned down by another across the Examples — a derivable column. Model it once, against its determinant. |

Each finding carries a **confidence**: the number of *confirming repeats* (Examples beyond the first that share a value and still agree). A pure one-to-one **covariation** — every Example distinct on both sides, so no value ever repeats — has confidence 0: the attributes track each other but no collapse is witnessed, so it could be coincidence. The editor (when `aot.dependencyFindings` is on) flags only findings at or above `MIN_CONFIDENCE` (2) — a single confirming repeat is not enough, so a 3-Example case never squiggles; weaker and covariation-only pairs stay off the squiggle channel. An ellipsis marker among the Examples — a `...` Map or a `- ...` Example — declares the sample intentionally incomplete (the same marker that excuses warnings 4–7), so any dependency read off those Examples is **provisional**: it is never flagged, however high its confidence, since more data is openly still to come.

#### Two names for one idea

One name, one meaning is the first rule, and the linter proves the half that can be proved: the *same* name written twice must mean the same thing. The other half is not provable at all — two *different* names may still be one idea, and no arithmetic over the tree will ever say so, because nothing in the tree records that `Client` and `Customer` are the same word in two dialects. That is a fact about English, not about the model.

So the check does the only honest thing available offline: it recognises the collisions that actually happen when people model, and it **asks**. It is repo-wide — `Client` here and `Customer` in the file next door is exactly the pair worth catching — and it reports on **both** sides, each carrying a Ctrl+clickable link to the other.

| # | Rule | What triggers it |
|---|------|------------------|
| 14 | **Two names for one idea** | Two Concepts whose names match word for word once each word is mapped to its synonym group (`Sales Client` / `Sales Customer`, `Fix Defect` / `Repair Bug`), or once each word is cut to a shared prefix of six characters or more (`Governance` / `Government`, `Reconciled Item` / `Reconciliation Item`). |
| 17 | **One content, two names** | Two Concepts in **different files** carrying exactly the same attributes and values (equal [Gödel numbers](#gödel-numbering), numbered as one over the repository) under names that share nothing — `Kettle` here, `Boiler` there. Within one file this is the content clash, an error (rule 20); across files it is a warning, since one file may still be writing its differentia. Asked only of a file that is itself clean, and only in a workspace. |

Three things end the question, and each is a decision only you can make:

- **Rename one to the other** — the lightbulb's first, preferred fix. It goes through the rename engine, so every reference follows exactly as `F2` would move them.
- **Write the alias**: `Human (Natural Person)` *declares* that the two names are one idea, which is the supported way to say what the check is asking about. A pair where one is the other's alias is never raised.
- **Say they are different**: the second lightbulb records the pair in `aot.distinctConcepts` and never asks again, in either order and in any file.

The same two lightbulbs — rename one to the other, or keep them apart — answer rule 17, the same content under two names in two files, which asks the same question from the other side.

It is advisory and never counted in `V` — a naming collision is a question, not a contradiction — and it is off entirely with `aot.synonymWarnings`. The vocabulary (`src/synonyms.js`) is deliberately small and domain-shaped rather than a thesaurus: a general thesaurus makes near-synonyms of words a model needs to keep apart (`cost` and `price`, `target` and `goal`), and every false finding spends the reader's attention. Names that differ only in **number** (`Person` / `People`) are left to the singular-Concept warning above, and names that differ only in **case** are univocity's business.

**Findings elsewhere wait while you write.** Typing a child sets off findings that are not about the line being typed. The parent has "1 sub-Concept" the instant its first child exists. A sibling now overlaps, an ancestor reads as misfiled, a name elsewhere has a duplicate. Most of these are gone a line later, and flashing them mid-thought only interrupts. So, from the first edit of a burst:
- A finding already on screen when you began keeps showing, so nothing flickers.
- One that goes away goes at once, so a fix shows.
- One on a line you edited shows at the usual debounce: your own lines speak.
- Every other new finding **waits**.

The wait ends, and what waited shows, when:
- the cursor leaves the **family** of what you edited: the edited node's parent and everything under it, the parent's own line aside, so typing three siblings in a row keeps the parent quiet; at the top of the file, the edited node's own subtree;
- you save;
- another editor takes over.

There is no timer: you say you are done by moving on. Nothing is hidden silently. While findings wait, the status bar says `$(clock) 2 waiting — leave 'Parent' to see them`, its tooltip lists them, and a click shows them now. `verify.js` is unaffected: on the command line every finding is always reported.

Earlier versions surfaced three advisory hint kinds with no squiggle: the FCA audit (after Wille, 1982), the content clash, and the dependency inference. The FCA audit and the content clash are now **errors** counted in `V` (rules 17–20); the dependencies are now opt-in **warnings** (rules 12–13). Spelling is the one finding that maps to the editor's Hint severity.

### Gödel numbering

The characteristic number `chi = prime × chi(parent)` is a squarefree product: it records a line's **ancestry** — *where* it sits — and nothing else. The Gödel number `G` is its complement, after Gödel (1931): it records a line's **content** — *what it says* — by raising **primes to powers**. Each attribute gets one prime; the exponent encodes the value that attribute is set to:

- exponent **0** — the attribute is absent (its prime does not divide `G`)
- exponent **1** — the attribute is present but unvalued
- exponent **k > 1** — the attribute carries a value, `k` a stable code for it

So a line that sets three attributes becomes one integer like `2³ × 3⁵ × 5²`. The two numbers cover both axes of a line — `chi` the *where*, `G` the *what*. Every question a model asks of its content is then plain arithmetic on `G`: whether idea *n* carries attribute *a* (`prime(a)` divides `G(n)`), whether two ideas carry the same attributes (equal radicals) or identical content (equal `G`), what value an attribute takes on a line (the exponent of its prime, decoded), which ideas override an inherited default (a prime dividing both `G(n)` and `G(ancestor)` with unequal exponents ≥ 2), and which attributes are present but not yet valued (primes with exponent exactly 1).

The linter puts this to work in the lint pass: two ideas with identical attributes *and* values (equal `G`) are a content **clash**, an **error** counted in `V` (rule 20) — two Concepts whatever they are called, since a kind *is* its definition, but two Examples only when they share their name too, since an individual is told apart by what it is called before anything it carries (case and a numbering prefix aside, as everywhere). Like the FCA findings, it is meaningless over a tree that does not yet verify, so it runs only once the syntactic and subsumption passes are clean — but when it fires, it is a violation, not an advisory. Three warnings read the same arithmetic: a value **every child states** belongs on the parent (15), a default **every child overrides** is in force for nothing (16), and the same content under **two names in two files** is one idea twice (17).

**The numbers are stable.** Primes and value codes are handed out once and kept in `aot.files/godel.tsv` — `a⇥legs⇥2` gives an attribute its prime, `v⇥legs⇥3⇥4` a value its code — and a save adds what is new without renumbering anything (`aot.godelRegistry`). So the number you read today is the one you read after an unrelated attribute is added, and one attribute has one prime in every file and on every branch, which is what lets two files, or two sides of a merge, be compared at all. No file stores `G` itself, so the registry is safe to delete: it is rebuilt with new numbers. It merges with git's union driver, and a merge's duplicate claims are settled when it is read — a prime claimed twice goes to the name that sorts first, conflict markers are skipped. `node verify.js --workspace [dir] --primes` writes it from the command line.

**Hover shows it.** Hovering a Concept's or an Example's name adds its **content**: `G` as a factorisation (`G = 2 · 13² · 19⁴`; the integer itself while it has thirty digits or fewer, past that its size, `≈ 4.12 × 10^1,234 (1,235 digits)`), one line per attribute with where an inherited one came from (`` `legs`: `4` — from 'Pet' (line 2) ``), what it overrides, and the **nearest sibling** of its kind with how the two differ — or *identical in content to …*, which is the clash seen from the inside.

**How the numbers are computed.** By the fundamental theorem of arithmetic, a positive integer *is* its factorisation, so `G` is kept as its exponent vector — the primes a node carries and their exponents — and never built as an integer unless one is shown. Every question above becomes arithmetic on a handful of exponents: equality a comparison of keys, divisibility and gcd a merge walk, a value an exponent looked up, the size a sum of logarithms. Nothing in the editor waits on how large an integer is: on a 2,000-row table a hover went from 6.7 s to 0.6 ms and rules 15–16 from 3.5 s to 7 ms. The primes come from a cached sieve. [docs/godel-numbers.md](docs/godel-numbers.md) has the method, the measurements, and the alternatives turned down.

### Armstrong's axioms (dependency inference)

A functional dependency `X → Y` says "fix `X` and `Y` is fixed too". Armstrong's axioms are the inference rules for such dependencies, and `src/armstrong.js` makes them part of the linter in two ways, both reusing the Gödel numbers above.

The six axioms, and what the linter does with each. **Reflexivity** (`Y ⊆ X ⊢ X → Y`) makes every `X → X` trivially true — a self-edge asserts nothing, so the graph drops it, and an attribute of a Concept's own kind stays legitimate recursion, never flagged. **Transitivity** (`X → Y, Y → Z ⊢ X → Z`) is the working axiom: it builds the closure behind `--depends`, the hover and the inlay chains; a chain that leads back to its start is a **dependency cycle** (error rule 21); a direct edge that a chain through another Concept already implies is a **redundant dependency** (warning rule 11); and over the inferred set it prunes the implied statements to a minimal cover. **Augmentation** (`X → Y ⊢ XZ → YZ`), **Union**, **Decomposition** and **Pseudotransitivity** speak of *sets* of attributes on a side; the dependencies here are single-attribute edges, so Augmentation and Pseudotransitivity have nothing to attach to, Union never arises, and Decomposition holds by construction — every right side is already atomic.

**Inferred from the Examples.** Project every Example's `G` onto an attribute's prime — its value code — and group the Examples by it. `X → Y` holds when `Y`'s code is constant within every `X`-group, across enough Examples to be more than coincidence. A column thus determined by another is **derivable**: model it once rather than restating it on every Example (the normalisation reasoning the Graph rationale is about). When the dependency runs both ways (`X ↔ Y`), the two attributes are the same distinction written twice. An antecedent that is distinct on every Example (a key) is ignored — it determines everything vacuously, with no evidence — unless its partner is a key too, a genuine bijection. The set is pruned to a **minimal cover**: an `X → Z` that `X → Y` and `Y → Z` already give follows by Transitivity, so it is held off the squiggle channel — `--fd` still prints it, tagged `[implied by 'x' → 'y' → 'z']` — and a member of an equivalence is never pruned. The strongest of the rest surface as opt-in warnings (rules 12–13 above; off by default via `aot.dependencyFindings`, never counted toward `V`).

**Declared by the crosslinks.** A dependency is a Concept resting on another through an **attribute** — an attribute whose name ends in a Concept, or a **value that names another Concept's Example** (`person: Socrates` with Socrates under `Human`; the value edge matters, or linking through a value would hide the dependency it creates). A Concept that merely *contains* another in its name (`Recurring Tree`), or is *aliased* to one, is a **kind** of that Concept, not a dependency on it — those crosslinks still navigate, but they are not dependency edges. The transitive closure (Armstrong transitivity) gives what a Concept rests on directly and what it inherits through a chain — `node verify.js <file> --depends "X"` prints both, each transitive dependency with one witnessing path. In the editor the chains are visible twice over: **hovering** a Concept (or any crosslink) lists every chain in full (`Trip ─driver person→ Person ─home address→ Address — 3 Concepts`), and an **inlay hint** writes the first chain in small print at the end of each **attribute** crosslink's line (`→Person→Address`, off with `aot.chainHints`) — only an attribute typed by a Concept *depends* on it, so a Concept that merely contains or aliases another carries no arrow. The same graph is held to the axioms in the lint pass, current file only: a chain leading back to its start is a **dependency cycle** (error rule 21, counted in `V`, one error on each attribute carrying the loop), and a direct edge a chain through another Concept already implies is a **redundant dependency** (warning rule 11, on the declaring attribute).

**Across files.** Every `.aot` in the workspace is indexed, so all of the above resolves repo-wide, and a Concept written in two files is held to [one meaning](#concepts-across-files). Most of what used to be reported is now simply closed on save — an attribute one file declares is written into the other, and the `...` line saying where the rest of the Examples live is kept true — so only the two decisions a tool may not take for you reach the Problems panel, as **errors counted in `V`**, on every file involved and with each other's lines as clickable related locations:

- **one attribute carrying two values** (rule 22) — the lightbulb offers *Set '`attr`' to '`value`' everywhere*, which rewrites every file at once;
- **one Concept filed under two kinds** (rule 23) — the lightbulb offers the rename, for when two different ideas merely collided on a word.

`V` is therefore the file's violations *given the repo it sits in*: a repo-wide error is always reported on both sides, at the lines that disagree, never inferred from a file you cannot see. A file linted on its own — a lone file outside a workspace, or `lint(text, rootName)` with no repo argument — is judged entirely on its own terms, exactly as before. Every open `.aot` re-analyses when the index changes, so resolving a disagreement clears it live on both sides. `node verify.js --workspace [dir]` reports the same from the terminal and exits `1` on a contradiction; `--reconcile` writes the agreement in first.

### The command line

`verify.js` is the extension's referee without the editor: it wraps the same `src/` modules, applies the same gates and filters, and prints every finding with its `file:line`. The whole-file check ends in a verdict and an exit code, which makes `V = 0` scriptable — in CI, in a git hook, or as the acceptance test in an LLM loop. It judges **what is in front of it** and nothing else — a file whose derivations are [parked](#parking-the-derivations) is judged on the values it carries, and the store is never read:

```
$ node verify.js examples/thought.aot
127 nodes, 127 edges, largest prime 719, violations V = 0
subsumption: 13 derived is-a edges, hierarchy consistent
V = 0: true — the file verifies
$ echo $?
0
```

The flags turn the arithmetic into queries:

| Flag | What it does |
|------|--------------|
| `node verify.js <file>` | Whole-file check with a `V = 0` verdict; exit code `0` iff the file verifies |
| `--ask X Y` | Is-a test by divisibility: does `chi(Y)` divide `chi(X)`? |
| `--genus X Y` | The nearest common kind of two ideas, via gcd |
| `--number X` | An idea's characteristic number as a prime product, with its ancestry |
| `--godel X` | An idea's Gödel factorisation, with a prime-by-prime legend of its attributes and values, the exact integer and its digit count |
| `--clashes` | Both strengths of content clash (the editor flags only the strong, content-identical case) |
| `--overrides` | Every node overriding an inherited default, detected arithmetically |
| `--find "a: v" ["b" …]` | Query by example: every idea whose content satisfies the terms, by one divisibility test |
| `--common X Y` | The shared content core of two ideas — every attribute both carry at the same value |
| `--near X [k]` | The `k` nearest ideas by content distance, with the slots that differ |
| `--fd` | The full set of inferred functional dependencies, including the covariations, provisional findings, and transitively implied ones (tagged `[implied by …]`) the editor holds back |
| `--depends X` | A Concept's declared dependencies, direct and transitive with a witnessing path |
| `--diff old new` | Version diff as factorisation comparison: added, removed, and changed nodes per attribute — and **renamed** and **moved** ones recognised, when the pairing is unambiguous, so a renamed Concept is one finding rather than everything under it removed and added again |
| `--diff-rev REV file` | The same, against the file as it stood at a git revision (`--diff-rev HEAD~1 "examples/godel.aot"`) |
| `--suggest` | The FCA audit, plus the positive report the editor never shows: which Concepts the Examples' attributes *confirm* |
| `--workspace [dir]` | The repo-wide check: every Concept written in more than one `.aot` under `dir` (default the current directory) is listed, file and line, and every [contradiction](#concepts-across-files) — one attribute with two values, one Concept under two kinds — is reported on both sides. **Exits `1` when there is one**, so CI can gate on it |
| `--workspace [dir] --reconcile` | Writes the agreement in first, then checks: attributes a peer declares are filled in, the `...` line saying where the rest of a Concept's Examples live is kept true — and a stale one removed. Additive otherwise — nothing you wrote is deleted — and idempotent, so a second run over a repo already in step changes nothing. The headless form of what a save does in the editor. `--workspace` also prints the one-content-two-names warnings (rule 17), which never change the exit code |
| `--workspace [dir] --primes` | Extends the [stable Gödel numbers](#gödel-numbering) with every attribute and value under `dir` and writes `aot.files/godel.tsv` |
| `--merge %O %A %B %P` | git's merge driver — see [Merging with git](#merging-with-git) |

Two views are CLI-exclusive: `--suggest`'s `confirmed` line (the lattice agreeing with your tree is worth seeing, but it is not a squiggle), and the full `--fd` / `--clashes` sets (the editor surfaces only the confident, strong cases).

### Merging with git

A line merge sees text; two people who edit one Concept see an idea. **AOT: Set Up Git Merge for .aot Files** makes git merge an `.aot` by meaning:

- it adds `*.aot merge=aot` and `aot.files/godel.tsv merge=union` to `.gitattributes` (commit it: the repository says how its files merge), and
- it points the repository's **local** git config at `node "<extension>/verify.js" --merge %O %A %B %P` — a program on your machine, so never committed. It needs Node.js on PATH. Nothing is configured without the command, and a driver left pointing at an older copy of the extension is repointed on activation.

The driver tries **git's own line merge first**: when that is clean it is kept (and any error the merge brought that neither side had is printed). When it conflicts, the **semantic merge** (`src/merge.js`) reads both sides against the ancestor as changes to Concepts and Examples — found by name, and where a name changed, by content — and replays theirs onto ours:

| One side | The other | Result |
|---|---|---|
| renames `Dog` to `Hound` | changes Dog's `sound` on the next line | both apply — the case a line merge conflicts on |
| sets `sound: woof` | sets `colour: black` two lines down | both apply |
| changes one cell of a row | changes another cell of the same row | both apply, cell by cell |
| adds `- Fish` | adds `- Bird` | both land, each after the sibling it follows on its own side |
| sets `sound: woof` | sets `sound: yap` | **conflict**, marked on that one line |
| removes `Cat` | changes Cat's `sound` | **conflict**, marked on Cat's block |
| moves a Concept, reorders, edits a `...` | anything | **git's own merge**, conflicts and all |

Three checks decide whether it may answer at all. **Replay**: each side's changes, applied to the ancestor alone, must give back that side exactly — an edit it has no word for fails it. **Arithmetic**: every node's Gödel number in the result must be, prime by prime, theirs where theirs changed it, else ours — so a rename that would cut a link the other side made fails it. **No new errors**: two edits each fine alone can be wrong together — a rename onto the name the other side gave a new Concept — so a result with an error neither side had fails too. Whatever a check cannot vouch for goes back to git's own conflicted text — so the driver is never worse than git's default. A row added above every other row of a table is one of those: it has no row to follow, and git places it. Run by hand, it is `node verify.js --merge base.aot ours.aot theirs.aot path.aot`, writing into `ours.aot` and exiting `0` when clean.

### The conformance examples

The prose above describes the rules; a handful of files in [`examples/`](examples/) *are* the rules — the linter's specification of record:

- [`examples/lint.aot`](examples/lint.aot) plants one violation per syntactic and style rule: a tab, a six-space indent, a depth jump, an empty value, a `-nospace` Example, the file name repeated as a line, an "and" Concept, a duplicated Concept name, identical siblings, a Map that leaks content, plural Concept names, a target-less and an actual-less measurement, a ninth sub-Concept, lone subtypes, and sibling sub-Concepts told apart by position only. It ends with a `Clean` subtree that must stay squiggle-free.
- [`examples/warning.aot`](examples/warning.aot) exercises the analytical passes: a Gödel content clash (two Examples with identical attributes and values), FCA drift (a Goldfish filed under `Fowl` while carrying `Fish`'s attributes), an exhaustion gap (a Sponge matching no sub-Concept), differentia twins, and dependency pairs with enough witnessed repeats to trip the Armstrong warnings.
- [`examples/thought.aot`](examples/thought.aot) and [`examples/spreadsheet.aot`](examples/spreadsheet.aot) are the clean pair: real models (all four rationales; tables and the CSV mirror) that must verify at `V = 0`. Their derivations were written in the formula language before it was removed; they still verify, since the linter judges values, not derivations, but they are not Python and fail when run.
- [`examples/monthly close.aot`](examples/monthly%20close.aot) and [`examples/bank recon.aot`](examples/bank%20recon.aot) are the clean *repo* pair: one Concept, `Jakus`, written in two files — the same definition in both, the Examples split between them, and a maintained `...` line in each. Both must verify at `V = 0`, and `node verify.js --workspace examples --reconcile` must leave them exactly as they stand.

- [`examples/godel.aot`](examples/godel.aot) and [`examples/godel twins.aot`](examples/godel%20twins.aot) verify at `V = 0` and carry the Gödel warnings on purpose: a value every child states (`Vehicle`'s `wheels: 4`, `Payment`'s `EUR` column), a default no child keeps (`Drink`), and `Kettle` / `Boiler`, one content under two names. Hover `Pet`'s kinds for their content.
- [`examples/release 1.12.aot`](examples/release%201.12.aot) is 1.12's hands-on checklist as a file — entries A01–A32, each saying what to do in the editor and what you should see — and verifies at `V = 0` with its three Gödel warnings; [`examples/release 1.12 peer.aot`](examples/release%201.12%20peer.aot) is its other file for the cross-file entries; [`examples/release 1.12 errors.aot`](examples/release%201.12%20errors.aot) must fail at `V = 5` (an Example named like the Example it sits under, a lone `=`, a bound with no attribute).
- [`examples/release 1.13.aot`](examples/release%201.13.aot) is 1.13's checklist — entries B01–B19 — and verifies at `V = 0`. [`examples/release 1.13 errors.aot`](examples/release%201.13%20errors.aot) must fail at `V = 7`: a parent cell naming no row, one naming its own row, two rows naming each other (rule 25), a derived Concept default, a definition that does not read as Python, and a derived header default (rule 12).

A change to the linter is correct when it flags every planted violation in the first two files and nothing in the clean pair. The check is one command per file: `node verify.js examples/thought.aot` must exit `0`, `node verify.js examples/lint.aot` must not — and `node out/test-<module>.js` runs each module's smoke tests.

## Style rules

These rules keep a model readable and unambiguous, so that two readers of the same file build the same mental model:

- One Concept with two definitions is ambiguity, and Alpha forbids it. When a Concept name must recur, a distinguishing qualifier prefix restores univocity.
- Use full words; never abbreviate, and never use synonyms for a name already in the file.
- Fix all misspellings.
- Prefer placing Examples higher in the tree.
- Provide as many values and Examples as possible.
- Remove redundant Concepts.
- Only decompose further when the detail adds meaningful value.

## Design principles

The following principles govern how Alpha handles inheritance, incomplete models, and the tension between structure and data.

### Aristotelian

- You never think from nothing. Every new thought extends structures you already know (*Posterior Analytics* I.1).
- You place an idea by naming its nearest kind — the most general accurate term (the *genus*, its parent) — together with the qualifier that sets it apart from its siblings (the *differentia*).
- **Essence and accident.** Attributes defined on a **Concept** are *essential*: they are part of what the idea is, so every child Concept and Example inherits them necessarily (attributes are inherited; Examples never are). Attributes an **Example** introduces on its own are *accidental*: true of that Example but not of its kind. A Concept therefore introduces essence; an Example may add only accidents, never a new essential attribute — adding essential attributes is the child Concept's prerogative, not the Example's. Concepts and Concept attributes are the form of your ideas; everything else in Alpha is accident (*Metaphysics* Z).
- **Assimilate facts.** Convert raw data into Example–attribute–value relationships under a Concept.

### Leibniz's alphabet of human thought

- A universal vocabulary: every idea reducible to primitive elements, and every complex idea expressible as a combination of those elements.
- A new way forward for AI: argument made verifiable, like arithmetic. *"Let us calculate."*

### Pragmatic

- **Plain text holds its shape**: prose hides structure, and diagrams don't scale.
- **Truth shows in consequences**: a definition is good when it lets two actors work on with the same meaning and verify it.
- **Content over structure**: prefer Examples, attributes, and values over new Concepts. Keep the Concept tree lean.
- **[Incompleteness is a feature](#incompleteness-is-a-feature)**: the referee checks for contradiction, never for coverage. Write the part you know, mark the part you don't with a `...`, and the file stays green the whole way.

## What it costs to think in Alpha

Alpha is terser than prose, but the interesting question is *where* and *by how much* — so it was measured rather than asserted. [`out/token-experiment.js`](out/token-experiment.js) tokenises the same knowledge written both ways and prints the table below; run it yourself:

```
npm install --no-save gpt-tokenizer     # the extension itself needs no tokenizer
node out/token-experiment.js
```

The prose it compares against is what a careful person would actually type — complete sentences, no padding, no repetition beyond the repetition prose itself forces. Counts are `o200k_base` (GPT-4o/4.1); Claude's tokenizer is not public and differs in detail, but the *ratio* between two English texts is stable across byte-pair encoders.

**The saving is mostly in the tree, not the table.** These are the two shapes a model is made of, and they behave very differently:

| Shape | Alpha | Prose | Alpha saves |
|-------|-------|-------|-------------|
| **Taxonomy**, 155 ideas (`- Bicycle` under `Land Vehicle` under `Vehicle`) | 666 | 1,565 | **57%** |
| **Grid**, 100 Examples × 4 attributes (400 facts) | 2,330 | 3,007 | **23%** |
| **Grid**, 5 Examples × 4 attributes (20 facts) | 151 | 163 | **7%** |
| **Grid**, 1 Example × 4 attributes (4 facts) | 55 | 38 | **−45%** |

Why the tree wins so much harder: an is-a edge costs Alpha **four spaces of indentation**, while prose has no way to write it but a whole sentence — "A Bicycle is a kind of Land Vehicle." That is 4.3 tokens per edge against 10.1, and it holds steady at every size. The reference model, [`examples/alphabet of thought.aot`](examples/alphabet%20of%20thought.aot), is 3,262 tokens for 555 ideas — **5.88 tokens per idea, with all 555 is-a edges included free**.

The grid's saving is real but modest, and it **grows with size**: the header names each attribute once, so the more Examples you add the more prose's per-fact repetition ("Ada Lovelace was born on…, Alan Turing was born on…") costs it. Below about five Examples Alpha genuinely costs *more* than prose — the header is overhead a single row cannot pay off. Alpha is not a compression trick for small facts; it earns its keep on structure and on scale.

**Three places the tokens land:**

- **Input** — the numbers above. For bulk data there is a cheaper form you already have: the [CSV mirror](#the-csv-mirror) writes every table to `aot.files/<Concept>.csv` unaligned, and that same 100-Example grid is **1,892 tokens as CSV against 2,330 as an aligned table** — the column padding is 19% of the table's cost. Hand a model the tree for structure and the CSV for rows.
- **Processing** — the one that actually dominates, and the one Alpha changes in kind rather than degree. Ten questions over the 100-Example record cost prose 10 × 3,007 = **30,070 tokens**, because every question re-reads the text. In Alpha the questions a model is *for* — is-a, genus, dependencies, contradictions — are arithmetic over the tree, so `verify.js --ask X Y` answers by dividing two integers at **zero** tokens and with no chance of a plausible wrong answer. This is the real economy: not that the file is smaller, but that the questions never reach the model.
- **Output** — one change to the 100-Example record is **21 tokens in Alpha (one row) against 30 in prose (one sentence)**, ~30% less. The deeper saving is that Alpha's unit of change is a line: a fact edited mid-paragraph takes the whole paragraph with it, and a line-sized diff is one git reviews and an agent can loop on.

## Using Alpha with an LLM

Alpha was designed so that a language model can read, extend, and critique a model, with the linter as the objective referee. The workflow:

1. Give the model this README (or just the [language reference](#language-reference) and [verification](#verification-the-tooling) sections) as its instructions.
2. Paste your `.aot` file and ask it to extend, critique, or explain the model.
3. Let the linter judge the result — in VS Code, or headless with `node verify.js <file.aot>`, whose exit code is the acceptance test (`0` = verifies). An agent can loop on that code until `V = 0`; you never have to take the model's word for it.

The rules an LLM must follow, in brief:

```
You are writing Alpha (.aot): an indented plain-text tree. Indent exactly 4 spaces
per level; never use tabs. The file name is the root Concept — never repeat it as
a line. Four kinds of line only:
  Capitalised name            = Concept (a kind; child Concept is-a parent, never has-a)
  lowercase name              = attribute (a property the parent has)
  - Name                      = Example (a concrete individual of the parent)
  attribute: value            = the attribute plus its concrete value on one line
Concepts define essence: their attributes are inherited by all children. Examples
may override inherited values and add accidental attributes, never essential ones.
Every idea has exactly one parent; model relationships as their own Concepts whose
attributes name the linked Concepts (lowercase) and whose Example values name the
linked Examples (case-insensitive). File an Example only under a kind nothing stops
being (Human, not Manager); write roles and phases as Examples of their own Concept,
joined by a relation Concept. No "and" in a Concept name. Never define the same
Concept name twice. Singular Concept names. 3–7 children per objective; at most 8
sub-Concepts per node. Give every pair of sibling sub-Concepts a distinguishing
attribute or value (a differentia). Mark anything intentionally incomplete with an
indented "..." Map line. Every measurement carries both target: and actual:.
```

## Alpha in a team

Alpha's discipline pays off most when more than one mind works the same model:

- **One subject per file, and the file name is the root Concept** — so ownership maps cleanly onto files, and a model's scope is visible in the repository tree.
- **Models are reviewed like code.** A `.aot` file diffs line by line, so a pull request shows exactly which idea changed, and a review comment lands on a specific parent, attribute, or value — the "disagreements become locatable" promise, operationalised.
- **The linter is the first reviewer.** A contributor — human or LLM — cannot merge a structural contradiction past `V = 0`. The referee runs in the editor as you type and headless in CI: `node verify.js <file>` exits `0` exactly when the file verifies, so a one-line pipeline step blocks unverified models from merging.
- **Univocity is governance.** One Concept name, one meaning — enforced by the checker rather than by a single location. A term may be written in as many files as need it; what a save guarantees is that they all say the same thing, and what `V` guarantees is that any real disagreement is an error on every side at once. When a team disputes a term, the dispute has an address — every place the term is written, all of them squiggling until it is settled, and one lightbulb that settles it everywhere.
- **Stakeholders who live in Excel still contribute.** The [CSV mirror](#the-csv-mirror) means a domain expert can edit `aot.files/Order.csv` in a spreadsheet; saving folds it back into the model, where the linter re-audits it like any other edit.

## Repository layout

| Path | What it is |
|------|------------|
| [`verify.js`](verify.js) | [The command line](#the-command-line): whole-file check with exit code, plus the query flags |
| [`src/linter.js`](src/linter.js) | Syntactic and arithmetic checks (error rules 1–12, 24 and 25) |
| [`src/primes.js`](src/primes.js) | The primes every number is made of: one cached Sieve of Eratosthenes, sized by the Rosser–Schoenfeld bound |
| [`src/subsumption.js`](src/subsumption.js) | Subsumption reasoner (error rules 13–16) |
| [`src/fca.js`](src/fca.js) | Formal Concept Analysis audit (error rules 17–19) |
| [`src/godel.js`](src/godel.js) | Gödel numbering: the content clash (error rule 20), values every child states and defaults no child keeps (warning rules 15–16), one content under two names across files (warning rule 17), the stable numbers of `aot.files/godel.tsv`, a node's content for the hover, and the rename-aware diff |
| [`src/merge.js`](src/merge.js) | [Merging with git](#merging-with-git): the semantic three-way merge, its replay guard and its arithmetic check |
| [`src/git.js`](src/git.js) | The two git calls the command line makes: a file at a revision, and git's own line merge |
| [`src/armstrong.js`](src/armstrong.js) | Dependency inference (warning rules 12–13), the declared dependency graph, and the axiom checks (error rule 21, warning rule 11) |
| [`src/synonyms.js`](src/synonyms.js) | Two names for one idea (warning rule 14): the synonym vocabulary, the stem rule, and the dismissal key |
| [`src/park.js`](src/park.js) | Taking the `=` derivations out of the data and putting them back: the `@` addresses, the round trip, and the `.formulas` store |
| [`src/crosslinks.js`](src/crosslinks.js) | Underlines, hover, references, and go-to-definition for crosslinks |
| [`src/table.js`](src/table.js) | The table editor, the parent column and dividers, reading a cell's value and its derivation or bound apart, and the CSV mirror's grids |
| [`src/csvsync.js`](src/csvsync.js) | [The CSV mirror](#the-csv-mirror)'s one rule: what a `.aot` takes from a CSV saved after it (cells, erasures, new rows, the rows to ask about), and a Concept's union across files |
| [`src/derive.js`](src/derive.js) | Derivations on line-form values, the constraint that holds each value, the Example edits and the table/line flip |
| [`src/pyshape.js`](src/pyshape.js) | Whether text reads as a Python expression, without running it — what tells a constraint's bound from prose (`speed > none noted`) |
| [`src/python.js`](src/python.js) | The Python derivations and constraint checks of a file, their `@` references resolved, the functions they call, the order they run in, the JSON-lines session, what a result may write back (never code, never a credential), and a program found on PATH alone |
| [`src/uvenv.js`](src/uvenv.js) | The [uv environment](#the-environment-uv): where the project is, what a lock would install and what in it comes from outside PyPI, and uv run as a child process |
| [`src/aot_runtime.py`](src/aot_runtime.py) | The Python side: one process per document, the typed values in and out, the lazy libraries, the sidecar loaded by its path, the constraint checks, and the guards it is held to |
| [`src/urls.js`](src/urls.js) | URL and file-path spans, their hover metadata, and image detection |
| [`src/hold.js`](src/hold.js) | [Findings elsewhere wait while you write](#warnings--yellow-squiggle-in-the-problems-panel-but-not-counted-in-v): which wait, the edited lines followed through edits, and the family whose leaving ends the wait |
| [`src/repo.js`](src/repo.js) | [Concepts across files](#concepts-across-files): the save-time reconcile and the two contradictions (error rules 22–23) |
| [`examples/thought.aot`](examples/thought.aot), [`examples/spreadsheet.aot`](examples/spreadsheet.aot) | Worked models that verify at `V = 0` (all four rationales; tables, and derivations written in the removed formula language) |
| [`examples/features.aot`](examples/features.aot) | A `V = 0` showcase of the 1.3 additions — `@` references, cross-cell formulas, constraints, string functions — in the formula language since removed; it verifies, but its derivations are not Python |
| [`examples/lint.aot`](examples/lint.aot), [`examples/warning.aot`](examples/warning.aot) | The [conformance examples](#the-conformance-examples) — one planted violation per rule |
| [`examples/numbering.aot`](examples/numbering.aot) | A file to try [Numbering](#numbering) on: save it and watch the Examples and Concepts number themselves |
| [`examples/monthly close.aot`](examples/monthly%20close.aot), [`examples/bank recon.aot`](examples/bank%20recon.aot) | One Concept written in two files: the same definition in both, the Examples split, a maintained `...` line in each |
| [`examples/godel.aot`](examples/godel.aot), [`examples/godel twins.aot`](examples/godel%20twins.aot) | The Gödel warnings to try by hand, in two files that verify |
| [`examples/python edge cases.aot`](examples/python%20edge%20cases.aot) | The [Python](#python) edge cases, each with what should happen — live where running it is harmless, escaped where it would break the file — with its sidecar in `aot.files` |
| [`out/test-*.js`](out/) | Per-module smoke tests, plain Node scripts (`npm test` runs all seventeen, `test-merge.js` a real git merge when there is a `git`; `test-python.js` runs the real Python runtime when there is a `python` on PATH, and `test-uv.js` the real uv when there is a `uv`, and each skips it when there is not) |
| [`docs/features-1.1-1.2.md`](docs/features-1.1-1.2.md) | Per-feature reference for the 1.1 → 1.2 line: what changed, a snippet to exercise it, and its edge cases |
| [`docs/features-1.3-1.5.md`](docs/features-1.3-1.5.md) | The same for 1.3 → 1.5: how each feature worked *before*, a snippet for the case that works and the neighbouring one that does not, and the test that holds it |
| [`docs/features-1.6.md`](docs/features-1.6.md) | The same for 1.6: tables and free text as one notation — the unified registry, the outer scope, the union CSV mirror, chained constraints |
| [`docs/features-1.13.md`](docs/features-1.13.md) | The same for 1.13: flat tables and the parent column, dividers, the flip that keeps your place, the CSV mirror's last-save rule, rename by typing, findings that wait while you write, Concept defaults, `=` and `==` |
| [`docs/godel-numbers.md`](docs/godel-numbers.md) | How the Gödel numbers are computed as exponent vectors: the method, the measurements, and the alternatives turned down |
| [`docs/features-1.12.md`](docs/features-1.12.md) | The same for 1.12: Python across sub-Examples, table rows and bare `=` lines; the column keys; stable Gödel numbers, the hover, the Gödel warnings, the rename-aware diff and the git merge driver — with a merge walkthrough |
| [`docs/features-1.8.md`](docs/features-1.8.md) | The same for 1.8: two-sided duplicates and reconcile, case- and number-insensitive names, [Numbering](#numbering), width cookies and wrapped cells, the in-cell Example dropdown, one-stroke spelling fixes |
| [`out/token-experiment.js`](out/token-experiment.js) | The measurement behind [What it costs to think in Alpha](#what-it-costs-to-think-in-alpha) — re-derive the numbers rather than trust them |
| [`docs/`](docs/) | README assets (`edit-loop.svg` is the editable source of the header image) |
| [`install.py`](install.py) | Build and install the extension locally (`python install.py`) |

## License

MIT — see [License.md](License.md).
