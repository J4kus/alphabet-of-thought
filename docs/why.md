# Why Alphabet of Thought

[Back to the README](../README.md)

Alphabet of Thought is a small notation for thinking in plain text: an indented tree with four kinds of line. A VS Code extension checks every `.aot` file as you type, using ideas from the history of logic: Aristotle's categories, Leibniz's arithmetic of concepts, Description Logic subsumption, Formal Concept Analysis, Gödel numbering, and Armstrong's dependency axioms. A file **verifies** when its violation total `V` reaches 0.

If your thoughts need to be bigger than one brain can hold at a time, or you just want your ideas to survive contact with an LLM, it gives you a way to write them so that anyone, including you six months from now, can read them and extend them without breaking them.

Knowledge work keeps producing the same artefacts — goal trees, domain models, capability maps, process diagrams — and keeps losing them in slides, prose, and diagrams that no tool can check and no two readers interpret the same way. Alphabet of Thought replaces those with one plain-text format that people can read, tools can check and LLMs can write.

- **Arguments become checkable.** This is the Leibniz point: once "Socrates is an example of Human" is encoded as the divisibility of two integers, an is-example-of claim is a computation the linter confirms or refutes against what the file says. `V = 0` means the file contains no structural contradictions.
- **Two readers build the same mental model.** A `.aot` file is a shared definition a team can extend. Nobody maintains a private version in their head.
- **Disagreements become locatable.** When a dispute arises, it is about a specific line — a wrong parent, a missing differentia — not about a vibe in a paragraph.
- **An LLM can work on it, and you can check what it did.** Plain text is what language models consume, and the checks don't depend on the LLM: ask it to extend or critique your model, let the checks find what disagrees, and read the diff yourself. The tree gives it your actual ontology rather than letting it guess from prose.
- **Your spreadsheets come along.** Every table in a model is mirrored to an ordinary CSV file, so the same knowledge is at once a checked model and a spreadsheet Excel can open.

Compared with the alternatives: prose hides structure, diagrams don't scale or diff, and formal ontology languages (OWL, UML) demand tooling and training that most teams never adopt. Alphabet of Thought starts from four kinds of line and an indent rule, and you can version it in git.

## Case study: a quarterly business review

Here is the artefact knowledge work produces most often — a status slide:

> **Q2 Sales: Growth and Retention.** Revenue growth on track (11%). New-client pipeline healthy. Basket size up. Churn improving. Owner: Mike.

Fifteen minutes of Alphabet of Thought later, the same claim is `Sales.aot`, written with the [Motivation rationale](#motivation):

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

What the notation caught before the meeting could:

1. **"Growth and Retention" is two kinds.** The first draft filed the measurements under a `Growth and Retention` Concept, and it squiggled red on the spot (error 8, no "and" in a Concept). Growth and retention have different levers and different measurements; the model forces the split the slide fudged.
2. **"Churn improving" had no definition of good.** `churn` carries an `actual:` but no `target:` (warning 2). The yellow squiggle is the question *"improving relative to what?"* asked mechanically, before anyone has to ask it out loud.
3. **"On track" contradicted its own children.** 11% against a target of 15%, with the leading driver Red — visible at a glance once every measurement is forced to carry `actual`, `target`, and `influence` side by side. No rule fired here, because nothing stated how the status follows from the numbers. State it, with `influence ="Green" if @actual>=@target else "Red"` on the attribute, and a status that contradicts its numbers reads `'Green' is written here, and its formula gives 'Red'`.

The file ends in the honest state: structure verified, one warning left on `churn` — an open question the team must answer, not a formatting task. And the review doesn't die in a deck: next quarter extends the same tree, and git shows exactly which line changed and who changed it.

## Incompleteness is a feature

No model is ever finished, and Alphabet of Thought is built so that an unfinished one still **verifies**. `V = 0` is not a claim that everything is written down — it is the claim that **nothing written down contradicts the model's structure**, and `0 problems` from [`check.js`](cli.md#the-calculating-check) says the same of its formulas and rules. Consistency is the property a machine can check; completeness is not, and a notation that demanded both would be unusable on the first day of any real subject.

That is a deliberate choice. Alphabet of Thought keeps consistency and hands completeness back to you as something you *declare* rather than something you are *caught* lacking. There is an echo of Gödel's 1931 incompleteness theorems here, but only an echo: they concern what a formal system can prove, not whether a model's data is finished. The [Gödel numbers](checks.md#gödel-numbering) make the choice concrete: exponent **0** means the attribute is simply absent. Silence is representable. A half-described idea is a well-formed number, not an error.

Four places in the language make this concrete:

| Where | What it means |
|---|---|
| **The `...` Map** | The one line whose whole job is to say *there is more here*. It marks what is intentionally omitted, still a todo, or held at low confidence — and it **excuses its parent** from the completeness checks: a lone sub-Concept, a Concept that would otherwise look like it had drifted from its kind. Missing is not the same as forgotten, and the `...` is how you tell the difference. |
| **Extension is a partial sample** | A Concept's Examples are never claimed to be all of them. Two files listing different Examples of one Concept are both right, the repo-wide truth is the [union](language.md#concepts-across-files), and the `... N more in bank recon.aot:14` line is maintained for you rather than reported against you. |
| **Advisory findings never count in `V`** | Spelling hints, Example hints, FCA suggestions, dependency findings — everything that says *you might be missing something* is a hint or a warning, never an error. Only the file's own contradictions reach `V`. |
| **Attributes are optional by default** | An attribute declared on a Concept and left unvalued on an Example is `present but unvalued`, a first-class state (exponent 1), not a hole to be filled before the file will pass. |

What incompleteness never excuses is **contradiction**. One attribute carrying two numbers on one Example, or two values across files, one Concept filed under two kinds, an `and` in a Concept name, a dependency cycle — those are errors wherever they appear, `...` or no `...`, because they are not gaps. A gap is a place you have not been yet; a contradiction is a place that cannot exist.

The practical consequence is the working style Alphabet of Thought is built for: **write the part you know, mark the part you don't, and keep the file green the whole way**. A model that had to be finished before it was correct would never be started.

## The four rationales

Alphabet of Thought is aimed at knowledge workers — analysts, architects, anyone whose job is to think in structures. You can use it purely for your own thoughts, but Alphabet of Thought ships four rationales for the four kinds of model knowledge work keeps producing anyway, usually scattered across slides and spreadsheets. They are built on Aristotle's four causes — his complete answer to *why a thing is and how it comes to be* (*Physics* II.3, 194b17–20) — combined with the *Categories*, the *Prior Analytics*, and Kipling's six serving-men. **The four causes complete every explanation**: final (motivation), material (graph), formal (function), efficient (factor).

| Cause | Aristotle's phrase | Native question | Rationale | Said of | Not said of |
|-------|--------------------|-----------------|-----------|---------|-------------|
| **Final** | for the sake of which | Why, and for whom | **Motivation** | Party (Who) | Measurement (How much) |
| **Material** | that out of which | made of What | **Graph** | Entity (Where: the boundary that fixes where the record resides in reality) | Record (What) |
| **Formal** | the form, the arrangement of parts | What it is, How it is achieved | **Function** | Objective (How) | Class (Which) |
| **Efficient** | the agent and the means | by Whom, in what order | **Factor** | Worker (Agent) | Time (When) |

Each rationale's names are always modelled as Examples (not said of, not present in). The "Said of" column names the only Concepts allowed inside that rationale — Stakeholders, Entities, Objectives, and Worker Pools can never be Examples or Attribute Values, while measurements, records, classes, and times can only be Examples or Attribute Values.

The rationales can — and are encouraged to — link to one another: a Motivation's measurement may name a Factor's worker, a Graph's entity may type a Function's argument, and every such crosslink makes the model more connected and more checkable. What no rationale may do is *terminate* in another: each remains a complete tree of its own, its cause fully answered in its own terms, never reduced to a pointer into its neighbour. A complete explanation holds all four in balance — linked freely, each still standing on its own.

See [`examples/thought.aot`](../examples/thought.aot) for one subject — thinking itself — modelled through all four rationales.

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

### Two ways to work

The four causes fall into two pairs. Matter and form are **intrinsic**: they are in the thing, and make it what it is. The agent and the end are **extrinsic**: they act on it from outside (*Metaphysics* Λ.4, 1070b22–23, where some causes are "present in" the thing and others, like the mover, "outside" it). Cross that with the oldest question about anything done, the end it serves or the means it takes, and each rationale has a square of its own:

| | Ends | Means |
|---|---|---|
| **Extrinsic:** what acts on the subject from outside | **Motivation** (final cause): why, and for whom | **Factor** (efficient cause): who acts, in what order |
| **Intrinsic:** what the subject is in itself | **Function** (formal cause): what it does | **Graph** (material cause): what it is made of |

The extrinsic pair informs the intrinsic one. What a subject is for, and who works on it, shape what it does and what it is made of. That is why a Function tree with no Motivation above it cannot say what any capability is worth, and a Graph that no Factor ever touches cannot say which records matter. So there are two ways into a subject, and a good model uses both.

**Go deep: one rationale, as far as it goes.** Take the rationale your question lives in and expand it, level by level, until you reach what you don't know, and write `...` there. A KPI tree that has to add up is a Motivation question; a schema to settle before anything is built is a Graph one. Depth is where the checks bite hardest: every level adds siblings that need a differentia, Examples that must be filed under the right kind, and columns that might be derivable. Expanding Motivation from *Grow Revenue* through *Win Enterprise Deals* to *Shorten Legal Review*, you reach a measure nobody owns, and that is the `...`: the file now says where your knowledge stops, and the checks hold everything above it.

**Go across: one Concept, in all four.** Take one Concept and write it in each rationale in turn. For an invoice:

| Rationale | The question | For an invoice |
|---|---|---|
| Motivation | Why does it exist, and for whom? | To be paid within 30 days, for Finance |
| Function | What does it do? | Requests a payment, and records what is owed |
| Graph | What is it made of? | Lines, a customer and a due date, kept in the ledger |
| Factor | Who acts on it, in what order? | Sales raises it, Finance sends it, the customer pays |

The row you can't fill in is the part you've been assuming. A team that writes the first three easily and stalls on Factor has never said who approves an invoice, or what waits on whom, and that is usually where the 30 days go. Going across suits a subject you are about to decide on; going deep suits one you are about to build.

### Motivation

Focus: **what is measured, why, and who benefits from it.**

The Motivation rationale describes what you are trying to achieve and who owns it: goals and KPIs with a beneficiary, an `actual`, a `target`, and a Red/Amber/Green `influence` at each level of the tree. This is an OKR tree or a metrics dashboard as text — exactly what a quarterly business review tries to communicate — with every measurement recording its owner.

Every measurement carries both a `target` value and an `actual` value. Alphabet of Thought requires both because a measurement only means something when you can compare the actual against the target (the linter warns when either is missing).

### Graph

Focus: **what the system is made of.**

Data modelling: which entities exist, where records reside, and what depends on what. The Graph rationale even encodes normalisation reasoning (Armstrong's axioms) as tree shapes, so you can use it to design a schema before touching a database — the linter's [dependency inference](checks.md#armstrongs-axioms-dependency-inference) tells you when a column is derivable.

### Function

Focus: **how the system does it**, decomposed as a tree of capabilities.

Capability decomposition: what the system achieves, as a tree of verb-phrase objectives where each parent is achieved exactly by all its children together. A value-chain model is an organisation's capability map; the naming rules below force each node to be one testable claim.

The questions in a Function tree run in different directions. Ask **How** downward: a parent objective is achieved exclusively through all of its children together — no single child is the how; the complete set is, and that arrangement is the parent's form (*Metaphysics* Z: the form of a house is the arrangement of its bricks, not the bricks). Ask **Why** upward: the answer to a child objective's why is its parent; the root is one or more objectives that cannot be reduced further, their why balanced by the whole tree beneath them. Ask **Which** of an objective to reach a Class. Alphabet of Thought follows Aristotle in taking the form of a working thing to be its function: an axe that cannot chop is an axe in name only (*De Anima* II.1). The Function tree *is the form of the Motivation* — the arrangement that realises it.

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

Who works on what, in what order, including concurrency: locks, queues, race conditions, and where the bottleneck is. [`examples/thought.aot`](../examples/thought.aot) models intuition versus deliberation this way — deliberation is the synchronous bottleneck that waits on a condition, holds working memory, and loses races to bias.

## Design principles

The following principles govern how Alphabet of Thought handles inheritance, incomplete models, and the tension between structure and data.

### Aristotelian

- You never think from nothing. Every new thought extends structures you already know (*Posterior Analytics* I.1).
- You place an idea by naming its nearest kind — the most general accurate term (the *genus*, its parent) — together with the qualifier that sets it apart from its siblings (the *differentia*).
- **Essence and accident.** Attributes defined on a **Concept** are *essential*: they are part of what the idea is, so every child Concept and Example inherits them necessarily (attributes are inherited; Examples never are). Attributes an **Example** introduces on its own are *accidental*: true of that Example but not of its kind. A Concept therefore introduces essence; an Example may add only accidents, never a new essential attribute — adding essential attributes is the child Concept's prerogative, not the Example's. Concepts and Concept attributes are the form of your ideas; everything else in Alphabet of Thought is accident (*Metaphysics* Z).
- **Assimilate facts.** Convert raw data into Example–attribute–value relationships under a Concept.

### Leibniz's alphabet of human thought

- A universal vocabulary: every idea reducible to primitive elements, and every complex idea expressible as a combination of those elements.
- A new way forward for AI: argument made verifiable, like arithmetic. *"Let us calculate."*

### Pragmatic

- **Plain text holds its shape**: prose hides structure, and diagrams don't scale.
- **Truth shows in consequences**: a definition is good when it lets two actors work on with the same meaning and verify it.
- **Content over structure**: prefer Examples, attributes, and values over new Concepts. Keep the Concept tree lean.
- **[Incompleteness is a feature](#incompleteness-is-a-feature)**: the referee checks for contradiction, never for coverage. Write the part you know, mark the part you don't with a `...`, and the file stays green the whole way.