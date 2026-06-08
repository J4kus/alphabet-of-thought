# Alpha (.aot)

Alpha is the digital version of Gottfried Wilhelm Leibniz's proposed alphabet of human thought.
- every idea  reducible to primitive element,
- every complex idea expressible as a combination of those elements,
- every argument verifiable like arithmetic.

It is a text-based language for representing knowledge as a tree of indented text. Most tools try to organise information. Alpha doesn't. Organising assumes the thinking is already done and you just need somewhere to put it. But the hard part is never storage: it is working out what you mean, and getting someone else, including your future self, to mean the same thing. That is what Alpha is for.

## The Foundations

### Pragmatic
- **Meaning is use**: an *idea* becomes clear only after its *connections* to other ideas are defined. A idea with no connections has no content.
- **Plain text holds its shape**: knowledge is best kept as a *tree* of plain text, not prose or diagrams. Prose hides structure; diagrams don't scale.
- **Shared context beats private notes**: a model earns its keep when someone else, including your future self, extends the same structure rather than rebuilding it in their head.
- **Truth shows in consequences**: a definition is good when it lets two people act on the same meaning and verify it, not when it merely sounds right.
### Aristotelian
- You never think from nothing. Every new thought extends structures you already know. (*Posterior Analytics* I.1)
- **Essence versus accident**: Concepts, Concept Attributes and Individual Attributes inherited from concepts are essentail, everything else in Alpha is accidental. Alpha take this further and claim that Universals acts on Individuals and Individuals are being acted apon by Universals (*Metaphysics* Z)
- The four node of Alpha's ontology are the crossing of **Said-of** and **Present-in** (*Categories* 2).
- **Definition is by genus and differentia**: name the nearest kind, then the difference that sets a idea apart from its siblings. (*Topics*)
- **The four causes answer every *why***: final (motiviation), formal (network), material (functional), efficient (workflow). The primitives of Alpha are built on them. (*Physics* II.3)
- The alphabet of thought primitives combines Aristotle's *Categories*, *Causes*, *Prior Analytics*, and  Kipling's *Six Serving Men* (plus 2).

Alpha is a human-first interface. It compiles to an idea-connection key-value store, not binary. Each idea has one connection. Once this shared context is written down, complicated ideas become easy to state and easy to pass on, because everyone extends the same structure rather than rebuilding it in their heads. Once that structure is precise, AI can do the synthesis and abstraction with you instead of guessing at it.

Built for people who do this for a living: knowledge workers, business analysts, and enterprise architects.

## Example

```aot
Human (Natural Person)
    full name
    age
    - Gottfried Wilhelm Leibniz
        full name: Gottfried Wilhelm Leibniz
        known for: Alphabet of Human Thought
        age: 70
```

## File Format

- Extension: `.aot`
- Indentation: exactly 4 spaces per level (Do NOT use tabs)
- Every line is a node
- The **file name is the root Concept**. Do not repeat it as the first line; the file's top-level nodes are already its children. For Individual, `Person.aot` begins directly with `full name`, `age`, and so on.

## Ideas and connections

Ideas and connections are determined entirely by capitalisation, punctuation, and indentation. The only keywords are the primitives.

### Ideas

#### Schemas (Acting on)

| Node Type | How to Recognise | Purpose | Extra Rules | Example | Said of (S) | Present in (P) |
|-----------|------------------|---------|-------------|---------|-------------|----------------|
| **Concept** (Universal Substance) | First letter is capitalised | Defines a class or type of idea | A Concept may reappear elsewhere only if a distinguishing qualifier prefix makes it unique | `Human` | **True (S)** | **False (~P)** |
| **Attribute** (Universal Accident) | All lowercase | Defines a property that a Concept has | Every attribute is itself a Concept, whether or not it is defined elsewhere | `full name` | **True (S)** | **True (P)** |

#### Content (Being acted upon)

 We can't think of a Concept without having a concrete Individual, or of an attribute without having a value for it. *Content*, the acted-upon Individuals are not storage waiting to be filled; it is what true schema stands on.

| Node Type | How to Recognise | Purpose | Example | Said of (S) | Present in (P) |
|-----------|------------------|---------|---------|-------------|----------------|
| **Individual** (Individual Substance) | **Must** start with `- ` (dash + space) | Lists concrete Individuals (instances) of the parent Concept or attribute, rather than a single default value. The `- ` prefix is what makes a line an Individual. Without it, a lowercase line is always an attribute | `- Socrates` | **False (~S)** | **False (~P)** |
| **Default Value** (Individual Accident) | `attribute: value` (colon-separated) or `Concept: value` | Sets the expected/default value for an attribute or Concept | `colour: red` | **False (~S)** | **True (P)** | 

### Connections

| Connections | Expression | Type | Individual | Extra Rule |
|------------------------|----------------------------------|-----------|-------------------------------------------|-----------------------------------------------|
| **is-a** | Indent Concept under a term | Indented | `Organisation` → indent → `Business` | |
| **has-a** | Indent attribute under a term | Indented | `Person` → indent → `full name` | |
| **value-is** | Colon after a term | Indented | `full name: Gottfried Leibniz` | |
| **has-another-name** | Parentheses after a term. Provides an alternative or derived name for an idea.  | Indented | `Person (Natural Person)` |If some or all of an attribute's trailing words match a Concept, those words act as an alias, with no parentheses required |
| **has-Individual** | Indent Dash prefix after a term | Indented | `Person` → indent → `- Gottfried Wilhelm Leibniz` | |
| **maps-to** | Indent `...` followed by a description under a token | Indented | `... Especially useful for describing terms or recording supplementary information` | Marks intentionally omitted or incomplete information | 
| **attribute-is-a-Concept** | Attribute name (or last words) matches a Concept name | Inline | `age integer: 5` → `integer` → `Integer` Concept | |
| **default-is-a-Individual** | Value matches an Individual name exactly (case-sensitive) | Inline | `person: Gottfried Wilhelm Leibniz`, where the value references the Individual | |

## How to Decide: Concept vs Individual vs Attribute

Correct classification here is what separates a model that communicates from one that merely stores. For a more pragmatic approach, apply these tests in order:

### 1. Exhaustion test (Concept vs Individual)

If the children together **partition** the parent, such that every child is a subtype of the parent, they are **Concepts** (subtypes). If the children are merely a selection of items drawn from the world, they are **Individuals**.

### 2. Abstraction test (Concept vs Individual)

**Concepts** are abstract groupings humans invent to organise thinking. **Individuals** are concrete, real-world instances of the parent you could point at or name. When in doubt: has someone defined a grouping? → Concept. Could you meet it, touch it, or look it up? → Individual. Individuals? → Individual.

### 3. Attributes describe, they don't classify

Attributes are lowercase properties a Concept **has**. They are not necessarily leaf nodes; an attribute may have its own children: Individuals, Concepts, values, or further attributes.

## Classical Style Rules

These rules keep a model readable and unambiguous. Violating them is how two people end up with two different mental models of the same file.

- You place a idea by naming its nearest kind (the *genus*, its parent) together with the qualifier that sets it apart from its siblings (the *differentia*).
- One term with two definitions is ambiguity Alpha forbids. When a Concept name must recur, a distinguishing qualifier prefix restores univocity.
- Use full words, never abbreviate
- Fix all misspellings
- One name per idea; never give a single idea two names (forbid **homonymy** — one name, two meanings; require **synonymy** — one name applied with one and the same definition)
- Always singular form: `Person` not `People`
- Use the most general accurate term (the *genus*)
- Remove redundant Concepts
- Add qualifiers to distinguish similar Concepts (the *differentia*)
- Only decompose further when detail adds meaningful value
- Provide as many Concept and attribute Individuals as possible
- Individuals placed higher in the tree are preferable

## Design Rules

The following rules govern how Alpha handles inheritance, incomplete models, and the tension between structure and data.

- **Essence and accident**: **Attributes** defined on a **Concept** are *essential*. It is part of what the idea is. So every child Concept and Individual inherits them necessarily. **Attribute**s an **Individual** introduces on its own are *accidental*. True of that Individual but not of its kind. A schema therefore introduces essence; an Individual may add only accidents, never a new essential attribute (changing the essence is the Concept's prerogative, not the Individual's).
- **Inheritance**: Child Concepts and Individuals inherit all parent (essential) attributes (never Individuals)
- **Polymorphism**: Child Concepts may add further essential attributes; Individuals may add only accidental ones
- **Incompleteness**: Use `... explanation` (Map) to mark intentionally incomplete sections. Normal and accepted.
- **Content over structure**: Prefer Individuals + attributes + defaults over creating new Concepts. Keep the Concept tree lean.
- **Assimilate facts**: Convert raw data into Individual-attribute-value relationships under a Concept

```aot
Parent
    attribute: normal value
    Child
        ... inherits `attribute` and `normal value` from Parent
        extra attribute
        - Child Individual
            attribute: new value
                ... `- Child Individual` overrides `normal value` from `attribute` and replaces it with `new value`
            extra attribute: value
                ... `- Child Individual` assigns a default for `extra attribute`
            child Individual attribute
                ... `- Child Individual` adds a child Individual attribute that isn't present in the `Child` Concept
            
```

## What NOT to Do

- Do NOT use tabs; 4 spaces only
- Do NOT abbreviate or use synonyms
- Do NOT create sub-Concepts when Individuals + attributes suffice
- Do NOT use plural Concept names
- Do NOT add structure without meaningful value
- Do NOT leave misspellings uncorrected
- Do NOT use explicit connection keywords; indentation, colons and parentheses express all connections
- Do NOT write Individuals without the `- ` prefix. A line like `deliver outcomes` is an attribute; write `- deliver outcomes` to make it an Individual

## Primitives

Primitives require no special `.aot` syntax, but it will make you smarter at any process that transform. The Ideas and Connections say what an Idea *is*; the Causes say why it exists and how it is produced. A modelling language for work needs both: the static and the dynamic.

#### The four causes

Aristotle's complete answer to *why a thing is and how it comes to be* (*Physics* II.3). The primitive names are always grouped as individuals (not said of, not present in).

Each of these Primitives have a said of and not said of part to guide for the user on how to model. For example, the only concepts are Beneficiaries, Entities, Objectives, Timelines and cannot be individuals or defualt values, while only individuals can be defualt values are measurements, records, classes and dependencies.

| Cause | Description | Primitive | Said of | Not Said Of |
|-----------|---------|--|------------------|------------------|
| **Final** | for the sake of which | Motivation | Beneficiary (Who) | Measurement (Why) |
| **Material** | that out of which| Network | Entity (Where) | Record (What) |
| **Formal** | the form, the essence | Function | Objective (How) | Class (Which)  |
| **Efficient** | the agent and the means | Workflow | Instrument (With What) | Dependency (When) | 

---

### Motivation Primitive

Focus: **what and why things are measured** by **who is the beneficiary of them**

The Motivation Primitive answers two questions at once: what are we trying to achieve, and who owns it? It models beneficiary alongside the measurements they use, so that every number has a name behind it.

Every measurement carries both a `target` value and an `actual` value. A target without an actual is potential; an actual without a target has no standard. To measure is to weigh the one against the other, so Alpha requires both.

Example

```aot
- Motivation
    last update time: 2026-03-31
    measurement interval: Quarterly
    Mike
        ... looking after sales
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

    John
        ... looking after development
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
                superordinate influence: Red
            - business cases handled
                actual: 23
                target: 56
                measurement operation used: Observation
                superordinate influence: Red
        - quality
            actual: A
            target: C
            number of grades: 5
            measurement operation used: Observation
            updating author: John
```

The Concepts used in the Motivation Primitive:

```aot
Beneficiary (Who)
    Person
        cell: 0830000000
        email: jakusvanrooyen@gmail.com
        id number: 9003262449080
        passport number: None
        first name: Alida
        surname: Zondo
        title
        date of birth
        gender
        home language
        nationality (country)
        residential country
        is living
        is sa citizen
        occupation status
            - Employed
                - Contributor
                - Manager
                - Executive
                - Non Executive
                - Independent
            - Self Employed
            - Unemployed
            - Retired
        residential status
            - Renting
            - Home Owner
        education standard classification
            - Childhood
            - Primary
            - Lower Secondary
            - Upper Secondary
            - Postsecondary Non Tertiary
            - Short Cycle Tertiary
            - Bachelors
            - Masters
            - Doctors
        marital status
        minor child count
    Organisation
        Business
        Government
        N G O
        Foundation
        operating status type
        trading name
        no terminology name
        is business unit
        is user classified
        incorporated country
        nickname
        impact (power and interest normally listed from most to least)
        is participant
        tax number
        tax office
Measurement (Why)
    ... of Quality and Quantity
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
                ... combines two dimensional measures
                - Addition
                    ... Sum
                - Subtraction
                - Multiplication
                    ... Product
                - Division
                    - Ratio
                        ... a binary measure specifically for ratios
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
            ... maps a dimensional measure to symbolic grades via intervals
        - Ranking
            minimum ranking
            maximum ranking
            is minimum ranking open: false
            is maximum ranking open: false
            ... maps a dimensional measure to discrete rank values via intervals
        - Rescaling
            - Fahrenheit to Celsius
            ... declares two measures produce semantically equivalent results, with a mapping operation that defines the conversion between them. Useful when different tools or teams define the same metric differently and you need to declare they're interchangeable.
            multiplier measurement: 1
            offset scaling magnitude: 0
            ... takes base Unit and scaling factor to create new unit of same dimensionality
            ... Individual: gram as 0.001 of kilogram
            exponent (power)
            ... raises a Unit to a given power
            ... signed to provide division via negative
        - Refinement
            ... indicates one measure is a more detailed version of another. The measures share the same trait but at different granularity
            ... Think "revenue by region" refining "total revenue".
    data type
        - Numeric
            ... any single dimensional numeric value
            offset scaling magnitude
                - 0
                    is integer: Yes
                - ... anything other than 0
                    is integer: No
            numeric base: 10
            is signed: true
            relative zero point
                ... establishes quantity as relative measure
                ... Individual: thermostat reporting 25 degree Celsius zero point to use bit space for plus or minus 10 degree Celsius
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
        - Text
            ... characters
        - Audio
        - Video
        - Image
        - Ignore
            ... skip these bits
        minimum number of elements: 1
        maximum number of elements (length): 1
            - 1
                ... quantity
            - container
                ... more than one
                - 2
                - ...
            - stream
                ... unknown quantity
                end of stream
                    ... signifier for simple value streams
                    ... for complex streams like video or audio, use reference to external specification
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
### Network Primitive

Focus: **where things reside** (the *acting-on* Concepts) and **what data and entities exist** there (the *acted-upon* Individuals).


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

#### 5th Formal Form Structures

We will need to model entities in a network.

**Graph:**
```aot
Graph
    Node
    Edge
        node from
        node to
...
```

**Recursive Tree:**
```aot
Tree
    tree
        ... root Object has no object value
```

**Event Association (many-to-many):**
```aot
Entity
    - One
    - Two
Event
    - Event Association
        from entity: One
        to entity: Two
...
```

**Subordinate Association (sibling-to-sibling via junction):**
```aot
Object
    - Individual Object
    Child Object
    Child Linking Event
        from child object
        to child object
...
```

#### Core Rules

- Model data as sets of facts
- Each Concept = one record type with a fixed number of attributes
- Non-nullable attributes listed first; attribute order otherwise meaningless
- A relational attribute referencing another Concept uses that Concept's name (lowercase)
- No many-to-many relations on attributes; use Event Associations
- Every Concept and attribute name must be unique

#### Cleanup Checklist

- Identify functional dependencies between attributes
- Use subset data to clarify scope
- Use aliases to describe Concepts
- Use full, unabbreviated names; final names must be unique and implementable
- Prefer fewer Concepts with more Individuals over many Concepts with few Individuals
- Prioritise Concepts by relevance
- Create parent Concepts to group related children
- Look for likenesses and differences to form general structures
- Remove attributes that do not serve the model

#### Armstrong's Axioms (Dependency Inference)

| Rule | In Alpha Terms |
|------|----------------|
| Reflexivity | A Concept determines any subset of its own attributes |
| Augmentation | Adding an attribute to a Concept referencing another Concept preserves a dependency |
| Transitivity | If Concept Z depends on Concept Y and Concept Y depends on Concept X, then Concept Z depends on Concept X |
| Union | Multiple dependencies from same source combine into one |
| Decomposition | A composite dependency breaks into Individual parts |
| Pseudotransitivity | A transitive chain extends by adding context to bridge a gap |

```aot
X
Y
    X
Z
    Y
    ... Z is transitively dependent on X (through Y)
```

#### Modelling Approach

1. Start with natural business entities
2. Build up from facts OR normalise existing data structures
3. Derive relations, establish attributes
---

### Function Primitive

Focus: **how the system does does it**, decomposed as a tree.

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
                - Dispatched bulk cargo to international shipping ports
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
- **Types**: conventionally nouns only, expressed as Individual ideas → `- Payment Type`

#### Forbidden in Functions

- "And" (always split the function into two siblings)
- Vague terms for services ("manage", "ensure")
- Performance related terms ("good", "acceptable")
- Information management ("information", "data", "content", "info")
- Political words ("Business", "IT", "Management", "Support", or "Execution")
- Flow words ("then", "next")

#### Decomposition Rules for Objectives

- 3 to 7 sub-objectives per parent objective
- Ask **Why** does a sub-objective exist? The answer should be the parent objective
- Ask **How** is a parent objective achieved? Exclusively through every and all of it's children
- Ask **Which** of an objective to get to a class.

#### Pitch Level

- Start two levels of granularity above the detail you need, then prune until every leaf is directly executable.
- Remove anything that does not serve the model.

#### Include attributes

Attributes may be attached to functions to describe their arguments and results.

---

### Timeline Primitive

Focus: **What instrument are used when**.

```
Instrument
    is bottleneck: yes
    is tangable: no
    useful life: infinite
    write-off method: not applicable
    
    
Dependency (Time)
    Concurrent (Single-Threading)
        Lock
            Milestone
                interval count: 0
                Time: 15:00
                    precision: no seconds
                    date: today
                        Date
                        precision: no time component
                        Date and Time
                            precision: no seconds
                        Precise Date and Time
                            precision: microseconds
            Duration
                interval count: 1
            Cycle
                interval count: 2 or more
                ... most expensive
            mechanism
                - Synchronisation
                    ... only one thread may hold it at a time
                - Reentrant Lock
                    ... the holding thread may acquire it repeatedly
                - Event
                    ... one thread sets a flag, others wait on it
                - Condition
                    ... a thread waits until another notifies it
                - Barrier
                    ... releases all parties together once the count arrives
            start condition
            interval: 5 seconds
            timeout
            polling duration
            precision: up to minutes
            displacement from greenwich meridian hours: +0
            fixes
                - shared state
                    - delete (design away)
                    - clamp into single complex
                        - no shared medium
                    - coordinate once, offline, by convention
                        ... not at runtime
                    - pass messages and isolate (guard)
                        - separate service
                        - hide information
                    - reduce costs
                        - free riding
                        - unreliable channels sacrifice consistency or availability
                - externalise
                    - precompute
                    - parallelise
                    - asynchronise
                    - defer
                - add cheaper resources
                    ... the bill arrives later
                    - diversified copies
                        - multiversion concurrency
                        - readers never block writers
                        - (no lock at all)
                        - validate on commit only
                    - buffer ("Slack")
                        - me
                        - another party
                    - fastest gun redundancy
                        - fire at several replicas and take first answer
                        - multiple nodes with same data
                    - speculate and reconcile on rare miss
                        - optimistic concurrency
                - decorrelate the need (activity based costing)
                - satisficing (good enough optimisation of requirements)
                    - net and clear, collapse the obligation graph
                - outsource dependency to whoever can handle it better
                - substitute collateral
        Asynchronous
            wrapped synchronous
            waiting for: external instrument
            suspension event
            awaiting event
            wrapped coroutine
        maximum worker pool: 1
    Parallel (Multithreading)
        maximum worker pool: many
        is worker pool count known: no
        processing rule
            - Queue
                has lock: yes
            - Dedicated
                has lock: no
            - Semaphore
                permit count
                ... allows a fixed number of threads through at once
        is memory shared in pool of workers
            - Thread
            - Process
        risk
            - Race Condition
                ... unsynchronised access to shared memory corrupts state
            - Deadlock
                ... two threads each wait on a lock the other holds
    result
    is done
    exception
```
