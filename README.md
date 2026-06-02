# Alpha (.aot)

Alpha is the digital version of Gottfried Wilhelm Leibniz's proposed alphabet of human thought.
- every concept reducible to primitive elements,
- every complex idea expressible as a combination of those elements,
- every argument verifiable like arithmetic.

It is a text-based language for representing knowledge as a tree of indented text. Most tools try to organise information. Alpha doesn't. Organising assumes the thinking is already done and you just need somewhere to put it. But the hard part is never storage: it is working out what you mean, and getting someone else, including your future self, to mean the same thing. That is what Alpha is for.

## The Foundations


### Pragmatic
- An *idea* becomes clear after the *connections* to other ideas are defined.
- Knowledge holds its shape best as a *tree* of plain text, not prose or diagrams. Prose hides structure; diagrams don't scale.
### Aristotelian
- You never think from nothing. Every new thought extends structures you already know. (Posterior Analytics)

Alpha is a human-first interface. It compiles to an idea-connection key-value store, not binary. Each idea has one connection. Once this shared context is written down, complicated ideas become easy to state and easy to pass on, because everyone extends the same structure rather than rebuilding it in their heads. Once that structure is precise, AI can do the synthesis and abstraction with you instead of guessing at it.

Built for people who do this for a living: knowledge workers, business analysts, and enterprise architects.

## Example

```aot
Human (Natural Person)
    full name
    age
    - Gottfried Wilhelm Leibniz
        full name: Gottfried Wilhelm Leibniz
        known for: Alphabet of human thought
        age: 70
```

## File Format

- Extension: `.aot`
- Indentation: exactly 4 spaces per level (Do NOT use tabs)
- Every line is a node
- The **file name is the root concept**. Do not repeat it as the first line; the file's top-level nodes are already its children. For example, `Person.aot` begins directly with `full name`, `age`, and so on.

## Ideas and connections

Ideas and connections are determined entirely by capitalisation, punctuation, and indentation. The only keywords are the Category Examples.

### Ideas

#### Schemas (Acting on)

| Said of (S) | Present in (P) | Node Type | How to Recognise | Purpose | Extra Rules | Example |
|-------------|----------------|-----------|------------------|---------|-------------|---------|
| **True (S)** | **False (~P)**| **Concept** (Universal Substance) | First letter is capitalised | Defines a class or type of thing | A concept may reappear elsewhere only if a distinguishing qualifier prefix makes it unique | `Human` |
| **True (S)** | **True (P)**| **Attribute** (Universal Accident) | All lowercase | Defines a property that a concept has | Every attribute is itself a concept, whether or not it is defined elsewhere | `full name` |

#### Content (Being acted upon)

 We can't think of a concept without having a concrete example, or of an attribute without having a value for it. *Content*, the acted-upon individuals are not storage waiting to be filled; it is what true schema stands on.

| Said of (S) | Present in (P) | Node Type | How to Recognise | Purpose | Example |
|-------------|----------------|-----------|------------------|---------|---------|
| **False (~S)** | **False (~P)** | **Example** (Individual Substance) | **Must** start with `- ` (dash + space) | Lists concrete individuals (instances) of the parent concept or attribute, rather than a single default value. The `- ` prefix is what makes a line an example. Without it, a lowercase line is always an attribute | `- Socrates` |
| **False (~S)** | **True (P)** | **Default Value** (Individual Accident) | `attribute: value` (colon-separated) or `Concept: value` | Sets the expected/default value for an attribute or concept | `colour: red` |
| **False (~S)** | **False (~P) or True (P)** | **Map** | Starts with `...` followed by a description | Marks intentionally omitted or incomplete information | `...Especially useful for describing terms or recording supplementary information` |





### Connections

| Type | Connections | Expression | Example | Extra Rule |
|-----------|------------------------|----------------------------------|-------------------------------------------|-----------------------------------------------|
| Embedded | is-a | Indent Concept under a term | `Organisation` → indent → `Business` | *Said-of* is predication — the **is-a** connection |
| Embedded | has-a | Indent attribute under a term | `Person` → indent → `full name` | *Present-in* is inherence — the **has-a** connection |
| Embedded | value-is | Colon after a term | `full name: Gottfried Leibniz` | |
| Embedded | has-another-name | Parentheses after a term. Provides an alternative or derived name for an idea (a name taken from another, as *the brave* from *bravery*) If some or all of an attribute's trailing words match a concept, those words act as an alias, with no parentheses required | `Person (Natural Person)` | |
| Embedded | has-example | Indent Dash prefix after a term | `Person` → indent → `- Gottfried Wilhelm Leibniz` | |
| Reference | attribute-is-a-concept | Attribute name (or last words) matches a Concept name | `age integer: 5` → `integer` → `Integer` concept | |
| Reference | default-is-a-example | Value matches an example name exactly (case-sensitive) | `person: Gottfried Wilhelm Leibniz`, where the value references the example | |

## How to Decide: Concept vs Example vs Attribute

Correct classification here is what separates a model that communicates from one that merely stores. For a more pragmatic approach, apply these tests in order:

### 1. Exhaustion test (Concept vs Example)

If the children together **partition** the parent, such that every child is a subtype of the parent, they are **Concepts** (subtypes). If the children are merely a selection of items drawn from the world, they are **Examples**.

### 2. Abstraction test (Concept vs Example)

**Concepts** are abstract groupings humans invent to organise thinking. **Examples** are concrete, real-world instances of the parent you could point at or name. When in doubt: has someone defined a grouping? → Concept. Could you meet it, touch it, or look it up? → Example. Somewhere in between? → Example.

### 3. Attributes describe, they don't classify

Attributes are lowercase properties a concept **has**. They are not necessarily leaf nodes; an attribute may have its own children: examples, concepts, values, or further attributes.

## Classical Style Rules

These rules keep a model readable and unambiguous. Violating them is how two people end up with two different mental models of the same file.

- You place a thing by naming its nearest kind (the *genus*, its parent) together with the qualifier that sets it apart from its siblings (the *differentia*).
- One term with two definitions is ambiguity Alpha forbids. When a Concept name must recur, a distinguishing qualifier prefix restores univocity.
- Use full words, never abbreviate
- Fix all misspellings
- One name per thing; never give a single thing two names (forbid **homonymy** — one name, two meanings; require **synonymy** — one name applied with one and the same definition)
- Always singular form: `Person` not `People`
- Use the most general accurate term (the *genus*)
- Remove redundant concepts
- Add qualifiers to distinguish similar concepts (the *differentia*)
- Only decompose further when detail adds meaningful value
- Provide as many concept and attribute examples as possible
- Examples placed higher in the tree are preferable

## Design Rules

The following rules govern how Alpha handles inheritance, incomplete models, and the tension between structure and data.

- **Essence and accident**: **Attributes** defined on a **Concept** are *essential* — part of what the thing is — so every child concept and example inherits them necessarily. **Attribute**s an **Example** introduces on its own are *accidental* — true of that individual but not of its kind. A schema therefore introduces essence; an Example may add only accidents, never a new essential attribute (changing the essence is the Concept's prerogative, not the individual's).
- **Inheritance**: Child concepts and examples inherit all parent (essential) attributes (never examples)
- **Polymorphism**: Child concepts may add further essential attributes; examples may add only accidental ones
- **Incompleteness**: Use `... explanation` (Map) to mark intentionally incomplete sections. Normal and accepted.
- **Content over structure**: Prefer examples + attributes + defaults over creating new concepts. Keep the concept tree lean.
- **Assimilate facts**: Convert raw data into example-attribute-value relationships under a concept

```aot
Parent
    attribute: normal value
    Child
        ... inherits `attribute` and `normal value` from Parent
        extra attribute
        - Child Example
            attribute: new value
                ... `- Child Example` overrides `normal value` from `attribute` and replaces it with `new value`
            extra attribute: value
                ... `- Child Example` assigns a default for `extra attribute`
            child example attribute
                ... `- Child Example` adds a child example attribute that isn't present in the `Child` concept
            
```

## What NOT to Do

- Do NOT use tabs; 4 spaces only
- Do NOT abbreviate or use synonyms
- Do NOT create sub-concepts when examples + attributes suffice
- Do NOT use plural concept names
- Do NOT add structure without meaningful value
- Do NOT leave misspellings uncorrected
- Do NOT use explicit connection keywords; indentation, colons and parentheses express all connections
- Do NOT write examples without the `- ` prefix. A line like `deliver outcomes` is an attribute; write `- deliver outcomes` to make it an example

## Primitives

The alphabet of thought primitives combines Aristotle's *Categories*, *Causes*, *Prior Analytics*, and  Kipling's *Six Serving Men*,  to support disciplined, rigorous thought.

Primitives require no special `.aot` syntax. Alpha models things that *come to be*. The processes that transform resources. The categories (below) say what a thing *is*; the causes say why it exists and how it is produced. A modelling language for work needs both: the static anatomy and the dynamic aetiology.

#### The four causes plus one

Aristotle's complete answer to *why a thing is and how it comes to be* (*Physics* II.3).

| Cause | Primitive | Acting on | Being acted upon | Serving man's interrogative |
|-----------|-----------|------------------|------------------|-----------------------------|
| **Final** — for the sake of which | Motivation | Beneficiary | Measurement | Why |
| **Material** — that out of which | Timeline | Workload | Duration | When |
| **Formal** — the form, the essence | Function | Objective | Type | What |
| **Efficient** — the agent and the means | Workflow | Agent | Resource | How |
| **Paradigmatic** — the pattern conformed to | Network | Entity | Record | Where |

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

The concepts used in the Motivation Primitive:

```aot
Measurement
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
            ... example: gram as 0.001 of kilogram
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
                ... example: thermostat reporting 25 degree Celsius zero point to use bit space for plus or minus 10 degree Celsius
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
Beneficiary
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
    Employed By
        organisation
        person
        metadata
        job title
        payroll number
        everest system number
        risk salary
        basic salary
        employee contribution
        employer contribution
        time
        location
    Geographic Region
        Continent
        Country
            short name
            common monetary area
            dialling code
        Province
        Suburb
        Street And Number
    Address
        stakeholder
        usage purpose
            - Personal
            - Professional
            - Private
            - Flexible
            - Throw Away
        Telco
            telephone number
            is mobile
            is fax
            country
        Email
            is personally owned
            email address
            recipient name
        Physical Address
            code
            country
            line one (street)
            line two (street)
            line three (street)
            line four (street)
            line five (street)
            line six (street)
            is postable
        Web Address
            ip address
            url
        Box
            suburb
            postal box
            box qualifier
            box description
            postal code
```

---

### Timeline Primitive

Focus: **when and how things happen**.

```aot
Duration
    - Milestone
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
    - Period
        interval count: 1
    - Cycle
        interval count: 2 or more
        ... most expensive
    start condition
    interval: 5 seconds
    timeout
    polling duration
    precision: up to minutes
    displacement from Greenwich meridian hours: +0
    status
        - Time Set
        - Cleared
        - Triggered
        - Failed Trigger
        - Finalised
    ...
    Maintain a model of system variety
    Name the dependency
    
Workload (Exclusive Window)
    - Data Flow
        function
        result
        dependent function
        data store
    - Control Flow (Situation-Decision-Action)
        situation
            ... environmental condition
        decision
            ... rule triggered by situation
        action
            ... function to execute
        destination
    Concurrent (Single-Threading)
        Synchronous (Lock)
            - Lock
                ... only one thread may hold it at a time
            - Reentrant Lock
                ... the holding thread may acquire it repeatedly
            - Event
                ... one thread sets a flag, others wait on it
            - Condition
                ... a thread waits until another notifies it
            - Barrier
                ... releases all parties together once the count arrives
            fix dependency
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
            waiting for: external
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

---

### Function Primitive

Focus: **what the system does**, decomposed as a tree.

### Example

```aot
    Create Product
        Primary Activities
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
        Support Activities
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
- **Types**: conventionally nouns only, expressed as example ideas → `- Payment Type`

#### Forbidden in Names

- "And" (split the function)
- Vague words for services ("manage", "ensure"), performance ("good", "acceptable") and information management ("information", "data", "content", "info")
- Political words ("Business", "IT", "Management", "Support", or "Execution")
- Flow words ("then", "next")

#### Decomposition Rules for Objectives

- 3 to 7 sub-objectives per parent objective
- Ask **Why** does a sub-objective exist? The answer should be its parent
- Ask **How** is a parent objective achieved? Exclusively through its children
- All sub-objectives together fully achieve the parent objective

#### Pitch Level

Start two levels of granularity above the detail you need, then prune until every leaf is directly executable. Remove anything that does not serve the model.

#### Include attributes

Attributes may be attached to functions to describe them more precisely.

---

### Network Primitive

Focus: **where things reside** (the *acting-on* concepts) and **what data and entities exist** there (the *acted-upon* examples).


Relevant when: data residency laws, latency, location-dependent processes, disaster recovery.

```aot
Repository
    source code: src/
    configuration: config/
    tests: tests/
...
```

#### Abstract Structures

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
    - Example Object
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
- Every concept and attribute name must be unique

#### Cleanup Checklist

- Identify functional dependencies between attributes
- Use subset data to clarify scope
- Use aliases to describe concepts
- Use full, unabbreviated names; final names must be unique and implementable
- Prefer fewer concepts with more examples over many concepts with few examples
- Prioritise concepts by relevance
- Create parent concepts to group related children
- Look for likenesses and differences to form general structures
- Remove attributes that do not serve the model

#### Armstrong's Axioms (Dependency Inference)

| Rule | In Alpha Terms |
|------|----------------|
| Reflexivity | A concept determines any subset of its own attributes |
| Augmentation | Adding an attribute to a Concept referencing another concept preserves a dependency |
| Transitivity | If Concept Z depends on Concept Y and Concept Y depends on Concept X, then Concept Z depends on Concept X |
| Union | Multiple dependencies from same source combine into one |
| Decomposition | A composite dependency breaks into individual parts |
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

### Workflow Primitive

Focus: the **integration layer** that connects Entities to Objects, so they work together in a process that transforms resources.

A workflow is not a diagram or a flowchart. It is a precise specification that references the primitives. Think of it as the executable surface of a model.

#### Resources

Every function must specify inputs and outputs:

```aot
Function Resource
    Output
        result
        destination
        Data Segment
        Production Target
            quantity
            quality
            rate
    Input
        source object
        source
        Data Segment
...
```

#### Workflow Example

```aot
Acquire Stock
    Input
        - purchase order
            source: Supplier
        - raw material specification
            source: Product Catalogue
    Output
        - received stock record
            destination: Warehouse System
        - updated inventory
            destination: Stock Data Store
    Domain
        ... to be mapped to entities
    Responsibility
        role: Procurement Officer
    Timing
        trigger: Purchase Order Approved event
        frequency: daily
    Location
        execution location: Head Office
        data location: Central Data Centre
    Process
        validate purchase order
        receive goods
        inspect quality
        update inventory records
        notify warehouse
    Production Target
        quantity: 100 units per batch
        quality: 98 percent pass rate
...
```

#### Verification Checklist

- Every referenced element exists on its structural model
- Base-level flows support higher-level flows
- Every function references a valid metric, locality, and time
- Data is normalised (denormalised constructs need transformation specs)
- All data is located at some location
