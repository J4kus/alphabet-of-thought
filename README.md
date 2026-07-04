# Alpha (.aot)

Alpha is the world's smallest engineering text-based notation for writing down what you your biggest, complicated thoughts — powered by an [tooling](#the-tooling) that checks your thoughts against the world's most powerful ideas about thinking. 

A language this small is why the tooling can be an exact referee instead of a guesser, and why an AI can work the model. The `.aot` file extension lints as you type and is **verified** when its violation total `V` reaches 0.

If your thoughts need to be bigger than one brain can handle at a time, or just want your ideas to survive contact with an LLM, Alpha gives you a way to write them so that anyone — including you, six months from now — can read them instantly. If you can draw a family tree, you already know how Alpha works.

**Contents:** [What you'd use it for](#what-youd-use-it-for) · [Why bother with the strictness](#why-bother-with-the-strictness) · [Quick start](#quick-start) · [The language](#the-language) · [Starting axiomatically](#starting-axiomatically) · [Tables](#tables--org-mode-spreadsheets-as-alpha) · [The four primitives](#the-four-primitives) · [The tooling](#the-tooling) · [Design rules](#design-rules) ...to be updated

## Example

Yes, the world sometimes feels like a tangled lattice: Socrates is a human, but also a philosopher, also an Athenian. Alpha makes you pick the one parent that matters. That choice is exactly what makes an Alpha file readable at a glance instead of a diagram you need a lie-down after.

```aot
- Alpha Example
    Human
        is alive
        - Socrates
            is alive: No
    Participation
        City of Residence
            city
            - Socrates' Residence
                human: Socrates
                city: Athena
        Employment
            occupation
            - Socrates' Job
                human: Socrates
                occupation: Philosopher
        human
    City
        - Athena
            residence known as: Athenian
    Occupation
        -  Philosopher
```

## Why bother with strictness?

- **Arguments become checkable.** This is the Leibniz point: once "Socrates is-example-of a Human" is the divisibility of two integers, an is-example-of claim isn't an opinion, it's a computation the linter either confirms or refutes. `V = 0` means the file contains no structural contradictions.
- **Two readers build the same mental model.** A `.aot` file is a shared definition a team can extend. No private version.
- **Disagreements become locatable.** When disputes arise, the dispute is about a specific line — a wrong parent, a missing differentia — not about a vibe in a paragraph.
- **AI can work on it reliably.** Plain text is what language models consume, and the linter is an objective referee: you can ask an AI to extend or critique the model, then let the linter check the result mechanically rather than by re-reading. The tree gives the AI your actual ontology instead of letting it guess from prose.

## Principles

### Parent-Children chain

Every idea in Alpha has exactly one parent. A parent can have many children; a child never has two parents called the "parent-children chain".

Every idea, no matter how elemental or complex, has exactly one parent, to exactly one other idea, and the chain runs from general (the file name) to specific until it terminates. An idea never means something different depending on which path you took to reach it.

The restriction is deliberate: like a type system, one parent per idea forces you to decide what an idea *is* before you can write it down, and that explicit commitment is one other people can share. Everyone who opens the file, including your future self, extends the same tree instead of rebuilding a private version in their head. Once the structure is that precise, AI can do the synthesis and abstraction with you instead of guessing at what you meant.

### Four kinds of ideas

Alpha agrees with Aristotle that everything you think falls into four categories (Aristotle, Categories 2, 1a20–24). They are the crossing of **Said-of** and **Present-in**.

    | Kind                                      | how to recognise                                                                              | expression                      | purpose                                                                                                                                                                                                 | extra Rules                                                                                                                                                                                                                                                                                                                                                                                                                                      | example                     | Said of (S)    | Present in (P) |
    |-------------------------------------------+-----------------------------------------------------------------------------------------------+---------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+-----------------------------+----------------+----------------|
    | **Example** (Individual Substance)        | A `- ` (dash + space) child, **or** the `value` in a capitalised `Concept: value` line        | Indent Dash prefix after a term | A concrete Example (instance) of the parent Concept or attribute, rather than a single Attribute Value.                                                                                                 | `- Socrates`, or `Run Command: code --install …` Usually a `- ` child — the `- ` prefix is what makes a line an Example, and without it a lowercase line is always an attribute. A single Example may instead ride inline on its Concept's own line as `Concept: value` (the `value` is the Example); this is the same kind, just written inline, and reads as an Example everywhere (counts, crosslinks, FCA)                                                                                                                                                                                                                                                                                                                                                                                                 | `Human` indent `- Socrates` | **False (~S)** | **False (~P)** |
    | **Concept** (Universal Substance)         | First letter is capitalised                                                                   | Indent Concept under a term     | Defines a class or type of idea                                                                                                                                                                         | A Concept may reappear elsewhere only if a distinguishing qualifier prefix makes it unique. A sub-Concept is an **is-a**, never a **has-a**. Indenting one Concept under another asserts the child *is a kind of* the parent. "And" (always split the function into two siblings). Start two levels of granularity above the detail you need, then prune until every leaf is directly executable. Remove anything that does not serve the model. | `Mammal` indent `Human`     | **True (S)**   | **False (~P)** |
    | **Attribute** (Universal Accident)        | All lowercase                                                                                 | Indent attribute under a term   | Defines a property that a Concept has                                                                                                                                                                   | Every attribute is itself a Concept that can be expanded on somewhere else, whether or not it is defined elsewhere                                                                                                                                                                                                                                                                                                                               | `Human` indent `is alive`   | **True (S)**   | **True (P)**   |
    | **Attribute Value** (Individual Accident) | The `value` after the colon in `attribute: value`; the term before the colon is **lowercase** | Colon after a term              | The concrete value an attribute takes. An `attribute: value` line is **two** ideas — the attribute (`colour`) and the value (`red`) that descends from it — written on one line, not one combined thing | `colour: red` (the value `red`, under the attribute `colour`)                                                                                                                                                                                                                                                                                                                                                                                    | `is alive: No`              | **False (~S)** | **True (P)**   |
                                                                                              | `is alive: No`              | **False (~S)** | **True (P)**   |


see [Tables](#tables--org-mode-spreadsheets-as-alpha) ... TO ELABORATE HERE

... to be added to Attribute Value Extra Rules
An `attribute: value` line is shorthand for **two** ideas, not one. `colour: red` says the attribute `colour` — a universal accident the Concept *has* — takes the individual value `red`. The inheritance runs **Concept/Example → attribute → value**: the value descends from its attribute, and the attribute from the idea that carries it. The value never descends from the Example directly, and `colour` is not part of the value's name — the attribute and its value merely share a line.

... to be added to Exmaple extra rules
A `Concept: value` line is the same shorthand on the Substance side. The capitalised term stays an ordinary **Concept**; `value` is one Example of it — exactly what a `- value` child would be — written inline as a convenient first Example. The inheritance runs **Concept → Example**, just as with a dashed child. Like any Example, the inline one inherits **all** of the Concept's attributes *and* their values (defaults) — the value (`code --install`) is the Example's own identity, and everything the Concept defines accrues to that Example instance, exactly as for a `- ` child. The inheritance is the Example's, not the Concept's. Further Examples may follow as ordinary `- ` children below it, and the Concept may still divide into **sub-Concepts**, each with Examples of its own — the inline value is simply one Example among however many the Concept comes to have.

A model only communicates when its ideas are classified correctly (Concept vs Example vs attribute). Apply these tests in order:

#### 1. Exhaustion test (Concept vs Example)

If the children together **partition** the parent, they are **Concepts** (subtypes): every child is a subtype of the parent, no two overlap, and nothing of the parent is left over. If the children are merely a selection of items drawn from the world, they are **Examples**.

#### 2. Abstraction test (Concept vs Example)

**Concepts** are abstract groupings humans invent to organise thinking. **Examples** are concrete, real-world instances of the parent you could point at or name. When in doubt: has someone defined a grouping? → Concept. Could you meet it, touch it, or look it up? → Example.

#### 3. Attributes describe, they don't classify

Attributes are lowercase properties a Concept **has**. They are not necessarily leaf nodes; an attribute may have its own children: Examples, Concepts, values, or further attributes.

### Attribute inheritance

The inheritance rules in one snippet:

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

### Cross-links

#### Composition

Attributes are sometimes atomic values, but also allowed in alpha is Attributes that is defined as a Concept somewhere else. An `Employee` can be composed of a `human`, a `contract`, a `role` attribute, all of which sit in its parent-children chain, independently inherited as *Attribute* of the `Employee` *Concept*. Cross-link composition is how you assemble a complex idea from parts that each have their own definition, while inheritance is how you say what kind of thing the idea is.

| **Attribute-is-a-Concept** | Attribute name (or last words) matches a Concept name | Inline | `age integer: 5` → `integer` → `Integer` Concept | |
| **Default-is-a-Example** | Value matches an Example name exactly (case-sensitive) | Inline | `human: Gottfried Wilhelm Leibniz`, where the value references the Example | |

#### Concept Differentia

The Concept of `Employee` may be used inside another Concept. For example `Train Employee`. The `Employee` and the `Train Employee` Concepts are distinct and unambiguous, but it is the same Concept of `Employee` that is evoked in the writer's and reader's mind for both. This is allowable in Alpha; in fact it is celebrated inside the objective that the `Employee` was defined elsewhere, with a link.

S every attribute the child adds must be a **differentia** — a fact that makes it a *narrower kind of the same genus*, answering "what kind of parent is this?". A child may of course carry more attributes than its parent; what matters is not how many it adds but that they narrow the *same* kind. If the added facts instead describe a separate dimension the thing merely *has* — a format, a property on its own axis — then you have written a has-a as an is-a: the Concept now names two kinds at once, and the subsumption reasoner flags it (rule 12, Multiple kinds). Pull that has-a out into its own attribute or Concept and crosslink it, so the child's place in the tree stays purely about what it *is*.

#### Attribute Alias

Attributes may be renamed 

### Confidence challenges

| **has-another-name** | Parentheses after a term. Provides an alternative or derived name for an idea.  | Indented | `Human (Natural Person)` | If some or all of an attribute's trailing words match a Concept, those words act as an alias, with no parentheses required |
| **Maps-to** | Indent `...` followed by a note under a token | Indented | `... todo: list the remaining operations` | Marks **only** what is intentionally omitted, still a todo, or held at low confidence — **never a plain description of the line above it**. To explain or rename a term, use a `(parentheses)` alias instead. |

### The four primitives

Alpha is aimed at knowledge workers like analysts and architects. You can use it purely for your own thoughts, without describing the "why" of your thoughts, but Alpha has four primitives for the four kinds of model knowledge work keeps producing anyway (Physics II.3, 194b17–20), usually scattered across slides and spreadsheets

Thoughts can be used as a tool. The tool is to transform, and to be able to transform, a clear understanding of the subject (the file name) needs to be defined.

Aristotle's complete answer to *why a thing is and how it comes to be*. The primitive names are always grouped as examples (not said of, not present in). **The four causes complete every explanation**: final (motivation), material (graph), formal (function), efficient (workflow). The primitives of Alpha are built on them. The alphabet of thought primitives combines Aristotle's *Categories*, *Causes*, *Prior Analytics*, and Kipling's *Six Serving Men*. Each of these Primitives has a said-of and a not-said-of part to guide the user on how to model. For example, the only concepts are Stakeholder, Entities, Objectives and Workflows, and these cannot be examples or Attribute Values, while measurements, records, classes and dependencies can only be examples or Attribute Values.

The primitives do not link to one another; each is a tree of its own, and no cause terminates in another. This is the general rule, not a special case. A complete explanation holds all four in balance, with each cause answered with respect to the others and none reduced to a pointer into its neighbour.

| Cause | Description | Native question | Primitive | Said of | Not Said Of |
|-----------|---------|------------------|--|------------------|------------------|
| **Final** | for the sake of which | Why, and for Whom | Motivation | Stakeholder (Who) | Measurement (How Much) |
| **Material** | that out of which | made of What | Graph | Entity (Where: the boundary that fixes where the Record resides in reality) | Record (What) |
| **Formal** | the form, the arrangement of parts | What it is, How it is achieved | Function | Objective (How) | Class (Which) |
| **Efficient** | the agent and the means | by Whom, in what order | Workflow | Worker Pool (Item in use) | Time (When) |

#### Motivation

Goals and KPIs with a beneficiary, an actual, a target, and a red/amber/green influence rolling up a tree. This is an OKR tree or a metrics dashboard as text: the sales example below (Mike owns revenue growth, which decomposes into new clients, basket size, churn) is exactly what a quarterly business review tries to communicate.

Focus: **what and why things are measured** by **who is the beneficiary of them**

The Motivation Primitive describes what you are trying to achieve and who owns it. It models the beneficiary alongside the measurements they use, so every measurement records its owner.

Every measurement carries both a `target` value and an `actual` value. Alpha requires both because a measurement only means something when you can compare the actual against the target.
#### Graph

data modelling: which entities exist, where records reside, what depends on what. It even encodes normalisation reasoning (Armstrong's axioms) as tree shapes, so you can use it to design a schema before touching a database.

#### Function
capability decomposition: what the system achieves, as a tree of verb-phrase objectives where each parent is achieved exactly by all its children together. The value-chain example is an org's capability map; the naming rules ("no and, no manage, no flow words") force each node to be one testable claim.
Focus: **how the system does it**, decomposed as a tree.

The questions in the Function tree run in different directions. Ask *How* downward: a parent objective is achieved exclusively through all of its children together. No single child is the how; the complete set is, and that arrangement is the parent's form (*Metaphysics* Z: the form of a house is the arrangement of its bricks, not the bricks). Ask *Why* upward: the answer to a child objective's why is its parent. The root is one or more objectives that cannot be reduced any further; their why is not answered by another node but balanced with the How, the whole tree beneath them. Ask *Which* of an objective to reach a Class. Alpha follows Aristotle in taking the form of a working thing to be its function: an axe that cannot chop is an axe in name only (*De Anima* II.1).

The Function tree relates to the other primitives differently: it *is the form of the motivation*, the arrangement that realises it.


##### Naming Rules

- **Objective**: verb + qualified object → `Calculate Payment` (One verb per function, named objectively)
- **Types**: conventionally nouns only, expressed as Example ideas → `- Payment Type`

##### Forbidden in Functions

- Vague terms for services ("manage", "ensure")
- Performance related terms ("good", "acceptable")
- Information management ("information", "data", "content", "info")
- Political words ("Business", "IT", "Management", "Support", or "Execution")
- Flow words ("then", "next")

##### Decomposition Rules for Objectives

- 3 to 7 sub-objectives per parent objective
- Test each split with the **Why**, **How**, and **Which** questions described under [The four primitives](#the-four-primitives)

##### Include attributes

Attributes may be attached to functions to describe their arguments and results.

#### Workflow

who works in what order, including concurrency: locks, queues, race conditions, what's the bottleneck. The Thought.aot example models intuition vs. deliberation this way.

### File format

- Extension: `.aot`
- Indentation: exactly 4 spaces per level (Do NOT use tabs)
- Every line is a node
- The **file name is the root Concept**. Do not repeat it as the first line; the file's top-level nodes are already its children. For example, `Human.aot` begins directly with `full name`, `age`, and so on.

### Classical style rules

These rules keep a model readable and unambiguous, so that two readers of the same file build the same mental model.

- One Concept with two definitions is ambiguity Alpha forbids. When a Concept name must recur, a distinguishing qualifier prefix restores univocity.
- Use full words; never abbreviate or use synonyms
- Fix all misspellings
- Always singular form: `Human` not `Humans`
- Examples placed higher in the tree are preferable
- Provide as many Attribute Defaults and Examples as possible
- Remove redundant Concepts
- Only decompose further when detail adds meaningful value


## Quick start

Install the VS Code extension (`alphabet-of-thought-*.vsix`) for the linter, the colouring and the table editor, then:

A realistic first use: take something you currently explain badly in a document — your team's metrics, a domain model, a process with a known bottleneck — pick the matching [primitive](#the-four-primitives) as a skeleton, write it as a `.aot` tree (start with natural Concepts and build up from facts, or normalise an existing data structure and then derive relations and establish attributes), and keep fixing squiggles until `V = 0`. The places where you can't decide on a parent are the places where you didn't actually know what you meant — which is the point.

2. **Write indented plain text using only four kinds of line**: An *axiomatic* start is a flat list of Examples: you file every Example directly under the file-name root. It is the [Content over structure](#pragmatic) rule taken to its limit, and the inverse of normalising an existing schema, where you start from structure. The good news is there is no hard part to the axiomatic start, because thinking is never complete. Any checklist of the questions a subject must answer will do, but there is one here that I recommend (in order of sophistication):

- **Your todo list** — Each open item is an Example the model is missing; emptying the list and completing the model are the same act.
- **Kipling's Six Serving Men** — *What, Why, When, How, Where, Who* ("I keep six honest serving-men; they taught me all I knew"). Six Examples to start with.
- **Aristotle's ten Categories** — substance, quantity, quality, relation, place, time, position, having, action, being-acted-upon (*Categories* 4). The widest net for *what can be said of a thing*: each category is one more attribute to ask after.
- **The Alpha primitives** — Motivation, Graph, Function, Workflow. All real knowledge straddles all the primitives; if you cannot produce them all, you do not yet fully understand the subject.
3. **Ask it to explain what it wrote**: Get an explanation of what it wrote. You'll be amazed at what you learn about something you thought you knew.

Whichever you use, the move is the same: generate the facts first, then branch out from there.

## Tables — org-mode spreadsheets as Alpha

Alpha recreates org-mode's plain-text spreadsheet: a pipe table the linter reads as ordinary Examples, so the axiomatic start above can be written as the grid it already is.

```aot
Order
    | name             | country | currency | basket size |
    |------------------+---------+----------+-------------|
    | Acme March Order | France  | EUR      | $1,200      |
    | Bolt March Order | Germany | EUR      | $3,100      |
    | Kite March Order | Japan   | JPY      | $780        |
```

- The header row's cells after the first declare the columns as **attributes** of the parent, exactly as bare lowercase lines would — so a capitalised column is an error. The first cell only labels the name column and asserts nothing.
- As in org, the `|---+---|` separator row directly beneath a row is what marks that row as the header; the separator is layout, never a node. A single-cell row above a separator heads a one-column table (its rows are plain Examples). And a **lone** multi-cell row — nothing tabular on the line after it — is a header being typed: it is assumed, the separator and data rows still to come, so a fresh table never squiggles mid-keystroke.
- Every data row is an **Example** named by its first cell, and every further cell is that Example's **Attribute Value** for its column. An empty cell asserts nothing. Two or more rows with no header above them, a row with more cells than the header names, and an empty name cell are all errors.
- A blank line, any non-pipe line, or a change of indent ends the table. A pipe row with a single cell stays a plain Example — the `- ` form written with `|`.
- **Format Document** (`Shift+Alt+F`) re-aligns every table as org's `TAB` does: each column padded to its widest cell, separator rows redrawn to match. Lone pipe Examples are left exactly as written.

### The table editor

Org's table automations are built in. While the cursor is on a table row (any pipe row with a second pipe, or a separator), the extension takes over these keys; every one of them re-aligns the whole table first, so a table never needs manual spacing:

| Key | What it does |
|-----|--------------|
| `Tab` | Re-align, then jump to the next field; at the table's last field a new empty row is appended |
| `Shift+Tab` | Previous field, wrapping to the row above |
| `Enter` | Same column, next row; appends a row at the bottom (`Shift+Enter` still inserts a plain newline to leave the table) |
| `Alt+←` / `Alt+→` | Move the cursor's column left / right, header and all |
| `Alt+↑` / `Alt+↓` | Move the cursor's row up / down (a row hops over the separator) |
| `Alt+Shift+→` | Insert an empty column where the cursor stands |
| `Alt+Shift+←` | Delete the cursor's column |
| `Alt+Shift+↓` | Insert an empty row above the cursor's |
| `Alt+Shift+↑` | Delete the cursor's row |
| `Alt+-` | Insert a separator line below the cursor's row |

Two more live in the Command Palette as **AOT Table**: *Sort Rows by Column at Cursor* (org's `C-c ^` — the run of data rows around the cursor, header safe behind its separator; numeric when every key reads as a number, `$`, `%` and thousands commas ignored, alphabetic otherwise) and *Create Table from Selected Lines* (org's `C-c |` — select CSV, TSV or multi-space-aligned lines and they become an aligned table, the first line lowercased into the header with the separator drawn beneath).

Creating a table is org's flow: type `| name | size |`, press `Enter` (a fresh empty row appears, aligned), type `-`, press `Tab` — the half-typed rule becomes a full separator and the cursor lands in the first cell of a new data row. A raw `|-` line expands the same way.

### Formulas

A cell may derive its value — org's spreadsheet folded into the cell itself, value first, formula visible after it:

```aot
Order
    | name             | country | currency | basket size     |
    |------------------+---------+----------+-----------------|
    | Acme March Order | France  | EUR      | $1,200          |
    | Bolt March Order | Germany | EUR      | $3,100          |
    | Kite March Order | Japan   | JPY      | $780            |
    | Total            |         |          | $5,080 =sum($4) |
```

- `$N` is the same row's column `N` (1 = the name column); `sum($N)`, `avg($N)`, `min($N)` and `max($N)` range over the table's other data rows; `+ - * / ( )` and plain numbers complete the grammar. `$` signs, thousands commas and `%` in referenced values are ignored, so a money column reads as its number.
- **Every table keystroke recalculates** — Tab, Enter, any table command, Format Document, and a CSV arriving through the mirror. Type just `=$2*$3` in a cell, press Tab, and the value materialises in front of the formula. A computed value keeps the old value's `$` and thousands commas.
- **The formula wears its own colour** — everything from the `=` to the cell's end is a distinct semantic token (`keyword.control`), so derivations read apart from data at a glance.
- **The linter audits it**: a formula that cannot compute (bad syntax, a non-numeric reference) is an **error** on exactly its span; a value that no longer matches its formula — someone edited a referenced cell — is a **warning** naming the fresh result, fixed by the next Tab or Format Document. A cell showing `#ERR` kept its formula and is waiting to be fixed.
- The model never sees the formula: the Attribute Value is the value part alone, so crosslinks, FCA, Gödel numbers and dependency inference all work on clean data. (The Armstrong warnings will still tell you when a whole *column* is derivable — a formula column is exactly that, made explicit.)

### The CSV mirror

Every table lives twice: as the pipe grid in the `.aot`, and as a CSV file named after its parent Concept in a sibling `<file>.tables` folder — `spreadsheet.aot` with an `Order` table keeps `spreadsheet.tables/Order.csv`. The two stay in sync automatically:

- **Saving the `.aot`** writes one CSV per complete table (header, separator, rows — an assumed lone header still being typed is left alone). Cells holding commas, quotes or newlines are quoted per RFC 4180; a top-level table is named by the file's root Concept.
- **Editing a CSV** — in Excel, a script, anything — folds the grid back into the matching Concept's table, aligned, and saves the file. A new CSV dropped into the folder inserts a table under its Concept if one doesn't exist yet.
- Both directions write only when the content genuinely differs, so the two mirrors never chase each other. Deleting a CSV never deletes the table. A pipe typed into a CSV cell is bent to a broken bar (`¦`), since it cannot survive inside a pipe grid.

The mirror means the same knowledge is at once a checked Alpha model and an ordinary spreadsheet any tool can read — turn it off with the `aot.tableCsvSync` setting.

### Tables are pure shorthand

The tree a table parses to is identical to writing each row as a `- Example` with `attribute: value` children, so everything that reads the tree works over a table unchanged — inheritance, the crosslinks (a header cell that names a Concept underlines solid, a value cell that names an Example underlines dotted, and both Ctrl+click to the definition), the FCA audit, the Gödel numbers, and the dependency inference.

Every editor feature of Alpha reaches inside the cells too:

- **Colouring**: header cells are painted as attributes, name cells as Examples, value cells as Attribute Values — the very colours their written-out line forms get (the extension's semantic tokens map back to the grammar's own scopes) — with the pipes and the name-column label left as quiet table chrome.
- **Aliases**: a header cell may carry a parenthetical alias, `size (length)`, which strips, colours and crosslinks exactly as it would on a bare attribute line.
- **Linting in place**: a table finding pins the offending cell rather than the whole line — a capitalised column, a row's extra cells, an empty name cell each squiggle where they sit.

That last point is how Alpha answers org's `#+TBLFM` formula line. Org's spreadsheet re-computes derived columns; Alpha's audits them. Two rows with the same name are an identical-siblings error; two rows with identical content are a Gödel clash; a row that carries every attribute another Concept's Examples share is drift; and a column whose values are pinned down by another column — the very thing org would compute with a formula — is what the Armstrong dependency warnings flag. In Alpha a computed column is not a formula to store but a dependency to model once, against its determinant. See [`examples/spreadsheet.aot`](examples/spreadsheet.aot).


## The tooling

Alpha comes with tooling that checks its rules for you. The VS Code extension (`alphabet-of-thought-*.vsix`) adds syntax colouring for `.aot` files and an arithmetic linter after Leibniz: every idea receives a prime and its ancestry is encoded as a product, so the linter can verify the tree as you type. The checks stack in layers:

- **Syntax and arithmetic** (`src/linter.js`) — tabs, broken indentation, depth jumps, a Concept defined twice and identical siblings all appear as squiggles in the Problems panel.
- **Crosslinks** (`src/crosslinks.js`) — an attribute whose trailing words match a Concept, or an Attribute Value that names an Example, is underlined as a link, and Ctrl+click jumps to the defining line.
- **Subsumption** (`src/subsumption.js`) — a reasoner re-derives the Concept hierarchy from the facts each Concept declares and holds the written tree to it.
- **Formal Concept Analysis** (`src/fca.js`) — the linter treats the Examples and their attributes as a formal context, computes the concept lattice, and flags groupings the data supports that no Concept names, Examples filed away from the Concept whose attributes they share, and sub-Concepts that fail to cover or distinguish their parent's Examples. The crosslinks deepen the analysis: a value that names an Example elsewhere in the file carries that Example's whole ancestry into the context, so `operation: Ratio` and `operation: Formula` group together when Ratio is filed under Formula.
- **Gödel numbering** (`src/godel.js`) — where a line's characteristic number encodes only *where* it sits, a second Gödel number encodes *what it says* — one prime per attribute, raised to a power that encodes the value — and the linter compares those numbers to catch content clashes (see [Gödel numbering](#gödel-numbering)).
- **Dependency inference** (`src/armstrong.js`) — the linter infers the functional dependencies the Examples bear out (see [Armstrong's axioms](#armstrongs-axioms-dependency-inference)).

Everything below is enforced mechanically by the same linter as you edit in VS Code. The extension maps the three layers to three severities: **errors** squiggle red, **warnings** squiggle yellow, and **hints** carry no squiggle. Only errors count toward the violation total `V`; the file verifies when `V = 0`.

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

On top of rules 1–14, a third tier of errors comes from the **Formal Concept Analysis audit** (`src/fca.js`) and the **Gödel numbering** (`src/godel.js`). A lattice or a content comparison over a broken tree means nothing, so these run **only once rules 1–14 are clean** (the syntactic/subsumption pass verifies); the FCA ones additionally need **between 2 and 200 Examples**. When they fire they are violations counted in `V` — the file does not verify until they are resolved:

| # | Rule | What triggers it |
|---|------|------------------|
| 15 | **Drift** | An Example carries every attribute the Examples of some Concept share, yet is filed elsewhere. Move it under that Concept, or give the Concept a differentia that genuinely excludes it. |
| 16 | **Exhaustion (overlap)** | Two sibling sub-Concepts read as different kinds but their Examples carry identical attributes. Differentiate them, or merge them. |
| 17 | **Exhaustion (gaps)** | Some of a parent's Examples match none of its sub-Concepts by attributes. The division misses a kind, or the Example lacks the attributes of its kind. |
| 18 | **Clash** | Two unrelated Concepts or Examples with equal Gödel numbers — identical attributes *and* values — so the data cannot tell them apart. Give one a differentia, or merge them. (The weaker same-name case — equal radicals, differing values — is not itself a violation.) |

A `...` Map child marks a node intentionally incomplete and excuses it from the drift and exhaustion checks (its missing siblings or attributes are declared, not forgotten). A Concept whose Examples share nothing beyond their ancestor's is skipped by drift, as is a Concept whose whole shared intent is inherited from above it — when neither the Concept nor its Examples declare any of it, there is nothing of its own to drift toward.

### Warnings — yellow squiggle, in the Problems panel, but do **not** affect `V`

| # | Rule | What triggers it |
|---|------|------------------|
| 1 | **Singular Concepts** | A Concept name whose last word is plural (checked with `pluralize`, so it catches irregulars too: `Humans`, `Categories`, `People`). Use the singular form. |
| 2 | **Measurement needs a target** | A node with an `actual:` default but no `target:`. |
| 3 | **Measurement needs an actual** | A node with a `target:` default but no `actual:`. |
| 4 | **At most eight sub-Concepts** | More than eight sub-Concepts under one node. Group some under an intermediate kind. (Examples and attributes may be any quantity.) |
| 5 | **No lone sub-Concept** | A Concept with exactly one sub-Concept — a kind with one subtype *is* that subtype. Have zero, or more than one. |
| 6 | **No lone sub-Example** | An Example with exactly one sub-Example, by the same reasoning. |
| 7 | **Differentia** | Two or more sibling sub-Concepts with an identical attribute/default *slot signature* — they are told apart by position only. Give each a distinguishing attribute or default. A sub-Concept that asserts no slot at all is excused: with no attributes its `...` is implied, so its differentia is still to come. |

A `...` Map child marks a node intentionally incomplete, which **excuses** warnings 4–7 for that node: the missing siblings or differentiae are declared, not forgotten. A Map says *what is still missing, a todo, or uncertain* — it is never a description of the line above it (use a `(parentheses)` alias to name or explain a term).

Two more warnings come from the dependency inference in `src/armstrong.js`. Like the FCA audit they mean nothing over a broken tree, so they run **only once rules 1–14 are clean** and need **between 2 and 200 Examples**; they reuse the Gödel numbers above. They are warnings, not errors — a derivable column is a modelling smell, not a contradiction — so they do **not** count toward `V`:

| # | Rule | What triggers it |
|---|------|------------------|
| 8 | **Dependency (equivalence)** | Two attributes determine each other across the Examples — "the same distinction written twice". Confirmed only when a value actually **repeats** (two Examples share it and still agree), so the collapse is witnessed and not coincidence. Model one and derive the other. |
| 9 | **Dependency (determination)** | One attribute's value is always pinned down by another across the Examples — a derivable column. Model it once against its determinant. |

Each finding carries a **confidence**: the number of *confirming repeats* (Examples beyond the first that share a value and still agree). A pure one-to-one **covariation** — every Example distinct on both sides, so no value ever repeats — has confidence 0: the attributes track each other but no collapse is witnessed, so it could be coincidence. The editor flags only findings at or above `MIN_CONFIDENCE` (2) — a single confirming repeat is not enough, so a 3-Example case never squiggles; weaker and covariation-only pairs stay off the squiggle channel. An ellipsis marker among the Examples — a `...` Map or a `- ...` Example — declares the sample intentionally incomplete (the same marker that excuses warnings 4–7), so any dependency read off those Examples is **provisional**: it is never flagged, however high its confidence, since more data is openly still to come.

#### No editor hints remain

Earlier versions surfaced three advisory hint kinds with no squiggle: the FCA audit (`src/fca.js`, after Wille, 1982), the content clash (`src/godel.js`), and the dependency inference (`src/armstrong.js`). The FCA audit and the content clash are now **errors** counted in `V` (rules 15–18); the dependencies are now **warnings** (rules 8–9). Nothing maps to the editor's Hint severity any more.

### Crosslinks — underlined, Ctrl+click jumps to the definition

The extension (`src/crosslinks.js`) underlines three inline connections and resolves them for go-to-definition; hovering shows the target and its line. They also deepen the FCA audit by carrying a referenced node's ancestry into the formal context. The two link kinds are told apart by underline style, not colour (the link keeps its token's syntax colour): a **solid** underline points at a Concept, a **dotted** underline at an Example.

| Connection | What links | Underline | Example |
|------------|-----------|-----------|---------|
| **attribute-is-a-Concept** | An attribute or default whose **trailing** words name a Concept (case-insensitive); the longest trailing run wins. | solid | `age integer: 5` → `integer` → `Integer` |
| **concept-contains-Concept** | A Concept whose name contains a run of words naming another Concept (case-insensitive); each longest, non-overlapping run links, but the whole name never does. | solid | `Independent Node` → `Node` → `Node` |
| **default-is-a-Example** | A default value that matches an Example name **exactly** (case-sensitive). | dotted | `human: Socrates` → `- Socrates` |

### Gödel numbering

The characteristic number `chi = prime × chi(parent)` is a squarefree product: it records a line's **ancestry** — *where* it sits — and nothing else. The Gödel number `G` is its complement, after Gödel (1931): it records a line's **content** — *what it says* — by raising **primes to powers**. Each attribute gets one prime; the exponent encodes the value that attribute is set to:

- exponent **0** — the attribute is absent (its prime does not divide `G`)
- exponent **1** — the attribute is present but unvalued
- exponent **k > 1** — the attribute carries a value, `k` a stable code for it

So a line that sets three attributes becomes one integer like `2³ × 3⁵ × 5²`. The two numbers cover both axes of a line — `chi` the *where*, `G` the *what*. Every question a model asks of its content is then plain arithmetic on `G`: whether idea *n* carries attribute *a* (`prime(a)` divides `G(n)`), whether two ideas carry the same attributes (equal radicals) or identical content (equal `G`), what value an attribute takes on a line (the exponent of its prime, decoded), which ideas override an inherited default (a prime dividing both `G(n)` and `G(ancestor)` with unequal exponents ≥ 2), and which attributes are present but not yet valued (primes with exponent exactly 1).

The linter puts this to work in the lint pass: two ideas with identical attributes *and* values (equal `G`) are a content **clash**, an **error** counted in `V`. Like the FCA findings it is meaningless over a tree that does not yet verify, so it runs only once the syntactic/subsumption pass is clean, but when it fires it is a violation, not an advisory.

### Armstrong's axioms (dependency inference)

A functional dependency `X → Y` says "fix `X` and `Y` is fixed too". Armstrong's axioms are the inference rules for such dependencies, and `src/armstrong.js` makes them part of the linter in two ways, both reusing the Gödel numbers above.

**Inferred from the Examples.** Project every Example's `G` onto an attribute's prime — its value code — and group the Examples by it. `X → Y` holds when `Y`'s code is constant within every `X`-group, across enough Examples to be more than coincidence. A column thus determined by another is **derivable**: model it once rather than restating it on every Example (the normalisation reasoning the Graph primitive is about). When the dependency runs both ways (`X ↔ Y`) the two attributes are the **same distinction written twice**. An antecedent that is distinct on every Example (a key) is ignored — it determines everything vacuously, with no evidence — unless its partner is a key too, a genuine bijection. The strongest of these surface as `V = 0` **warnings** (rules 8–9 above; they do not count toward `V`).

**Declared by the Concept references.** An attribute whose name ends in a Concept, and a Concept whose name contains another, are both read as "depends on" edges; their transitive closure (Armstrong transitivity) gave what a Concept rests on directly, and what it inherits through a chain. This view lived in the deleted `verify.js` CLI (`--depends`) and is currently gone — see the restore item in [TODO.md](TODO.md). Only the inferred-FD warnings above run in the editor today.

## Design rules

The following rules govern how Alpha handles inheritance, incomplete models, and the tension between structure and data.

### Aristotelian

- You never think from nothing. Every new thought extends structures you already know. (*Posterior Analytics* I.1)
- You place an idea by naming its nearest kind, the most general accurate term (the *genus*, its parent), together with the qualifier that sets it apart from its siblings (the *differentia*).
- **Essence and accident**: **Attributes** defined on a **Concept** are *essential*. They are part of what the idea is. So every child Concept and Example inherits them necessarily (attributes are inherited, never Examples). **Attribute**s an **Example** introduces on its own are *accidental*. True of that Example but not of its kind. A schema therefore introduces essence; an Example may add only accidents, never a new essential attribute (adding further essential attributes is the child Concept's prerogative, not the Example's). **Essence versus accident**: Concepts and Concept Attributes nodes are essentially the form of your ideas. Everything else in Alpha is accidental ideas (*Metaphysics* Z)
- **Assimilate facts**: Convert raw data into Example-attribute-value relationships under a Concept


### Gottfried Wilhelm Leibniz's proposed alphabet of human thought

- A universal vocabulary. Every idea reducible to primitive elements and every complex idea expressible as a combination of those elements
- A new way forward for AI. To allow argument to be verifiable like arithmetic

### Pragmatic

- **Plain text holds its shape**: prose hides structure and diagrams don't scale.
- **Truth shows in consequences**: a definition is good when it lets two actors work on with the meaning and verify it.
- **Content over structure**: Prefer Examples + attributes + defaults over creating new Concepts. Keep the Concept tree lean.


