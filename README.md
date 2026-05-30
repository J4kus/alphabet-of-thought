# Alpha (.aot)

In the 17th century, Gottfried Wilhelm Leibniz proposed an *alphabetum cogitationum humanarum*, an alphabet of human thought. His idea: every concept reducible to primitive elements, every complex idea expressible as a combination of those elements, every argument verifiable like arithmetic. He never built it.

Alpha is the digital version of that idea.

It is a text-based language for representing knowledge as a tree of indented text. Most tools try to organise information. Alpha doesn't. Organising assumes the thinking is already done and you just need somewhere to put it. But the hard part was never storage: it is working out what you mean, and getting someone else, including your future self, to mean the same thing. That is what Alpha is for.

Three observations drove its design:

- You never think from nothing. Every new thought extends structures you already know.
- A thought only becomes clear once it connects to other thoughts. An *idea* in isolation is not yet an idea; the *connections* make it one.
- Knowledge holds its shape best as a *tree* of plain text, not prose or diagrams. Prose hides structure; diagrams don't scale.

Alpha is a human-first interface. It compiles to a token-connection-value triple, not binary.

Once a shared context is written down, complicated ideas become easy to state and easy to pass on, because everyone extends the same structure rather than rebuilding it in their heads. Once that structure is precise, AI can do the synthesis and abstraction with you instead of guessing at it.

Built for people who do this for a living: knowledge workers, business analysts, and enterprise architects.

## Example

```aot
Person (Natural Person)
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

## Node Types

Node types and relationships are determined entirely by capitalisation, punctuation, and indentation, never by explicit keywords.

### Context (Structure)

| Node Type | How to Recognise | Purpose | Extra Rules | Example |
|-----------|------------------|---------|-------------|---------|
| **Concept** | First letter is capitalised | Defines a class or type of thing | A concept may reappear elsewhere only if a distinguishing qualifier prefix makes it unique | `Person` |
| **Attribute** | All lowercase | Defines a property that a concept has | Every attribute is itself a concept, whether or not it is defined elsewhere | `full name` |
| **Alias** | Parenthesised text following a concept or example, or a lowercase term within an attribute that matches an existing concept name | Provides an alternative name or description for an idea | If some or all of an attribute's trailing words match a concept, those words act as an alias, with no parentheses required | `(Natural Person)`, `(natural person)` |
| **Map** | Starts with `...` followed by a description | Marks intentionally omitted or incomplete information | Especially useful for describing terms or recording supplementary information | `... irrelevant data not included` |

### Content (Data)

| Node Type | How to Recognise | Purpose | Example |
|-----------|------------------|---------|---------|
| **Default Value** | `attribute: value` (colon-separated) or `Concept: value` | Sets the expected/default value for an attribute | `age: 42` |
| **Example** | **Must** start with `- ` (dash + space), or precede a concept | Lists concrete instances (objects) of the parent concept or attribute, rather than a single default value | `- Gottfried Wilhelm Leibniz` or `Gottfried Wilhelm Leibniz` |

> **Critical**: The `- ` prefix is what makes a line an example. Without it, a lowercase line is always an attribute, even if it reads like a sentence or a list item. Plain indented text like `outcomes` is an **attribute**, not an example. To make it an example, write `- outcomes`.

## Relationships

| Relationship | Expression | Example |
|--------------|------------|---------|
| is-a | Indent Concept under Concept | `Organisation` → indent → `Business` |
| has-a | Indent attribute under Concept | `Person` → indent → `full name` |
| value-is | Colon after term | `full name: Gottfried Leibniz` |
| has-another-name | Parentheses | `Person (Natural Person)` |
| has-example | Dash prefix under concept | `Person` → indent → `- Gottfried Wilhelm Leibniz` |
| attribute-is-a-concept | Attribute name (or last word) matches a Concept name | `age integer: 5` → `integer` → `Integer` concept |
| default-is-a-example | Value matches an example name exactly (case-sensitive) | `person: Gottfried Wilhelm Leibniz`, where the value references the example |

## How to Decide: Concept vs Example vs Attribute

Correct classification here is what separates a model that communicates from one that merely stores. Apply these tests in order:

### 1. Exhaustion test (Concept vs Example)

If the children together **partition** the parent, such that every instance of the parent falls into exactly one child, they are **Concepts** (subtypes). If the children are merely a selection of items drawn from the world, they are **Examples**.

### 2. Abstraction test (Concept vs Example)

**Concepts** are abstract groupings humans invent to organise thinking. **Examples** are concrete, real-world instances you could point at or name. When in doubt: is it a category someone defined? → Concept. Could you meet it, touch it, or look it up? → Example. Somewhere in between? → Example.

### 3. Attributes describe, they don't classify

Attributes are lowercase properties a concept **has**. They are not necessarily leaf nodes; an attribute may have its own children: examples, concepts, values, or further attributes.

## Style Rules

These rules keep a model readable and unambiguous. Violating them is how two people end up with two different mental models of the same file.

- Use full words, never abbreviate
- Fix all misspellings
- One name per thing, never use synonyms
- Always singular form: `Person` not `People`
- Use the most general accurate term
- Remove redundant concepts
- Add qualifiers to distinguish similar concepts
- Only decompose further when detail adds meaningful value
- Provide as many concept and attribute examples as possible
- Examples placed higher in the tree are preferable

## Design Rules

The following rules govern how Alpha handles inheritance, incomplete models, and the tension between structure and data.

- **Inheritance**: Child concepts inherit all parent attributes (never examples)
- **Polymorphism**: Child concepts may add attributes beyond the parent
- **Incompleteness**: Use `... explanation` (Map) to mark intentionally incomplete sections. Normal and accepted.
- **Data over structure**: Prefer examples + attributes + defaults over creating new sub-concepts. Keep the concept tree lean.
- **Assimilate facts**: Convert raw data into example-attribute-value relationships

```aot
Parent
    attribute: normal value
    Child
        ... inherits `attribute` and `normal value` from Parent
        extra attribute
        - Child Example
            attribute: suprising value
            extra attribute: value
            ... Child Example overrides `normal value` from `attribute` and replaces it with `suprising value` 
```

## What NOT to Do

- Do NOT use tabs; 4 spaces only
- Do NOT abbreviate or use synonyms
- Do NOT create sub-concepts when examples + attributes suffice
- Do NOT use plural concept names
- Do NOT add structure without meaningful value
- Do NOT leave misspellings uncorrected
- Do NOT use explicit relationship keywords; indentation expresses all relationships
- Do NOT write examples without the `- ` prefix. A line like `deliver outcomes` is an attribute; write `- deliver outcomes` to make it an example

## Aspects

The aspect taxonomy derives from Aristotle's *Categories* and modern interpretations. Adopting it brings discipline and rigour to your modelling. Aspects require no special `.aot` syntax; this section explains how to apply them.

---

## Motivation Aspect

Focus: **what and why things are measured**, and who is responsible for them.

The Motivation Aspect answers two questions at once: what are we trying to achieve, and who owns it? It models stakeholders alongside their measurements, so that every number has a name behind it and every name has a number in front of it.

Example

```aot
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
            actual: 105MIL
            target: 120MILL
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
                actual: $ 5,235,345
                target: $ 6,000,000
                influence: Red
                updating author: Jake
            - existing customer revenue lost (churn)
                actual: $ 21Mill
                target: $ 0
                influence: Red
                updating author: Matt
        - last year revenue
            actual: $100MIL

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
            superordinate influence: Negative
        - business cases handled
            actual: 23
            target: 56
            measurement operation used: Observation
            influence on superordinate measure: Negative
    - quality
        actual: A
        target: C
        number of grades: 5
        measurement operation used: Observation
        updating author: John
```

The concepts used in the Motivation aspect:

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
                    Mean
                    Mode
                    Median
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
        - Invariant
        - Variant
            - Positive
            - Negative
        - Unknown
        - None
    instrument
    author
    start time
    updated time
    updating author
Stakeholder
    Person
        cell: 0837108178
        email: jvanrooyen@10x.co.za
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

## Timeline Aspect

Focus: **when and how things happen**.

```aot
Duration
    - Milestone
        interval count: 0
        Time: 15:00
            precision: no seconds
            date: today
                Date
                precision:  no time component
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
    displacement from greenwich meridian hours: +0
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
                    - coordiante once, offline, by convention
                        ... not at runtime
                    - pass messages and isolate (gaurd)
                        - separate service
                        - hide information
                    - reduce costs
                        - free riding
                        - unreliable channels sacrifice consistancy or availablity
                - externalise
                    - precompute
                    - parallelise
                    - asyncrononise
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
                    - fastest gun redundency
                        - fire at several replicas and take first answer
                        - multiple nodes with same data
                    - speculate and reconcile on rare miss
                        - optimistic concurrency
                - decorrelate the need (activity based costing)
                - satisficing (good enough optimisation of requirements)
                    - net and clear, collapse the obligation graph
                - outsource dependency to whoever can handle it better
                - substituate collateral
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

## Function Aspect

Focus: **what the system does**, decomposed as a tree.

### Naming Rules

- **Objective ("action")**: verb + qualified object → `Calculate Payment` (One verb per function, named objectively)
- **Types ("passion")**: conventionally nouns only, expressed as example ideas → `- Payment Type`

### Forbidden in Names

- "And" (split the function)
- Vague words for services ("manage", "ensure"), performance ("good", "acceptable") and information management ("information", "data", "content", "info")
- Political words ("Business", "IT", "Management", "Support", or "Execution")
- Flow words ("then", "next")

### Decomposition Rules for Objectives

- 3 to 7 sub-objectives per parent objective
- Ask **Why** does a sub-objectives exist? The answer should be its parent
- Ask **How** is a parent objectives achieved? Exclusively through its children
- All sub-objectives together fully achieve the parent objectives

### Pitch Level

Start two levels of granularity above the detail you need, then prune until every leaf is directly executable. Remove anything that does not serve the model.

### Include attributes

Attributes may be attached to functions to describe them more precisely.

---

## Domain Aspect

Focus: **what data and things exist** — concepts, attributes, business rules, and the events that trigger them.

### Non-Tree Structures

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

### Core Rules

- Model data as sets of facts
- Each Concept = one record type with a fixed number of attributes
- Non-nullable attributes listed first; attribute order otherwise meaningless
- A relational attribute referencing another Concept uses that Concept's name (lowercase)
- No many-to-many relations on attributes; use Event Associations
- Every concept and attribute name must be unique

### Cleanup Checklist

- Identify functional dependencies between attributes
- Use subset data to clarify scope
- Use aliases to describe concepts
- Use full, unabbreviated names; final names must be unique and implementable
- Prefer fewer concepts with more examples over many concepts with few examples
- Prioritise concepts by relevance
- Create parent concepts to group related children
- Look for likenesses and differences to form general structures
- Remove attributes that do not serve the model

### Armstrong's Axioms (Dependency Inference)

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

### Modelling Approach

1. Start with natural business entities
2. Build up from facts OR normalise existing data structures
3. Derive relations, establish attributes

---

## Network Aspect

Focus: **where things reside**, both physically and logically.

```aot
Location
    Region
        country
    Office
        region
        address
    Data Centre
        region
        tier
...
```

Relevant when: data residency laws, latency, location-dependent processes, disaster recovery.

```aot
Repository Structure
    Source Code
        path: src/
    Configuration
        path: config/
    Tests
        path: tests/
...
```

---

## Workflow Aspect

Focus: the **integration layer** that connects all other aspects into executable specifications.

A workflow is not a diagram or a flowchart. It is a precise specification of a function that references the domain, timing, stakeholders, and location that make it real. Think of it as the executable surface of a model.

### Core Questions

| Question | Aspect | Specify |
|----------|--------|---------|
| What must be done? | Function | The function being executed |
| What data is needed? | Domain | Inputs, outputs, data stores |
| Who must do it? | Motivation | Role, ownership |
| When must it be done? | Timing | Schedule, triggers |
| Where must it be done? | Network | Execution and data location |
| In what format? | Object | Delivery mechanism, format |
| How must it be done? | Process | Logic, algorithms |

### Function Resources

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

### Workflow Flow (3 Layers)

**1. Data Flow:**
```aot
Data Dependency
    function
    result
    dependent function
    data store
...
```

**2. Synchronisation:**
```aot
Process Synchronisation
    interprocess dependency
    synchronisation reason
    coordination mechanism
...
```

**3. Control Flow (Situation-Decision-Action):**
```aot
Control Flow
    Situation
        ... environmental condition
    Decision
        ... rule triggered by situation
    Action
        ... function to execute
        destination
...
```

### Workflow Example

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

### Verification Checklist

- Every referenced element exists on its structural model
- Base-level flows support higher-level flows
- Every function references a valid metric, locality, and time
- Data is normalised (denormalised constructs need transformation specs)
- All data is located at some location
