# Alpha (.aot)

Alpha is a text-based knowledge-representation language that organises ideas as indented trees. A companion [VS Code extension](https://marketplace.visualstudio.com/items?itemName=Jakus.alphabet-of-thought) provides syntax support.

## Example

```aot
Person
    full name
    age
    - Mark Zuckerberg
        full name: Mark Zuckerberg
        age: 40
```

## File Format

- Extension: `.aot`
- Indentation: exactly 4 spaces per level (Do NOT use tabs)
- Every line is a node
- The **file name is the root concept**. Do not repeat it as the first line — the file's top-level nodes are already its children. For example, `Person.aot` begins directly with `full name`, `age`, and so on.

## Node Types

Node types and relationships are determined entirely by capitalisation, punctuation, and indentation — never by explicit keywords.

### Context (Structure)

| Node Type | How to Recognise | Purpose | Extra Rules | Example |
|-----------|------------------|---------|-------------|---------|
| **Concept** | First letter is capitalised | Defines a class or type of thing | A concept may reappear elsewhere only if a distinguishing qualifier prefix makes it unique | `Person` |
| **Attribute** | All lowercase | Defines a property that a concept has | Every attribute is itself a concept, whether or not it is defined elsewhere | `full name` |
| **Alias** | Parenthesised text following a concept or example, or a lowercase term within an attribute that matches an existing concept name | Provides an alternative name or description for an idea | If some or all of an attribute's trailing words match a concept, those words act as an alias — no parentheses required | `(Natural Person)`, `(natural person)` |
| **Map** | Starts with `...` followed by a description | Marks intentionally omitted or incomplete information | Especially useful for describing terms or recording supplementary information | `... irrelevant data not included` |

### Content (Data)

| Node Type | How to Recognise | Purpose | Example |
|-----------|------------------|---------|---------|
| **Default Value** | `attribute: value` (colon-separated) or `Concept: value` | Sets the expected/default value for an attribute | `age: 42` |
| **Example** | **Must** start with `- ` (dash + space), or precede a concept | Lists concrete instances (objects) of the parent concept or attribute, rather than a single default value | `- Mark Zuckerberg` or `Mark Zuckerberg` |

> **Critical**: The `- ` prefix is what makes a line an example. Without it, a lowercase line is always an attribute — even if it reads like a sentence or a list item. Plain indented text like `outcomes` is an **attribute**, not an example. To make it an example, write `- outcomes`.

## Relationships

| Relationship | Expression | Example |
|--------------|------------|---------|
| is-a | Indent Concept under Concept | `Organisation` → indent → `Business` |
| has-a | Indent attribute under Concept | `Person` → indent → `full name` |
| value-is | Colon after term | `full name: Gottfried Leibniz` |
| has-another-name | Parentheses | `Person (Natural Person)` |
| has-example | Dash prefix under concept | `Person` → indent → `- Mark Zuckerberg` |
| attribute-is-a-concept | Attribute name (or last word) matches a Concept name | `age integer: 5` → `integer` → `Integer` concept |
| default-is-a-example | Value matches an example name exactly (case-sensitive) | `person: Mark Zuckerberg` — value references the example |

## How to Decide: Concept vs Example vs Attribute

This is the hardest part. Apply these tests in order:

### 1. Exhaustion test (Concept vs Example)

If the children together **partition** the parent — every instance of the parent falls into exactly one child — they are **Concepts** (subtypes). If the children are merely a selection of items drawn from the world, they are **Examples**.

### 2. Abstraction test (Concept vs Example)

**Concepts** are abstract groupings humans invent to organise thinking. **Examples** are concrete, real-world instances you could point at or name. When in doubt: is it a category someone defined? → Concept. Could you meet it, touch it, or look it up? → Example. Somewhere in between? → Example.

### 3. Attributes describe, they don't classify

Attributes are lowercase properties a concept **has**. They are not necessarily leaf nodes — an attribute may have its own children: examples, concepts, values, or further attributes.

## Style Rules

- Use full words — never abbreviate
- Fix all misspellings
- One name per thing — never use synonyms
- Always singular form: `Person` not `People`
- Use the most general accurate term
- Remove redundant concepts
- Add qualifiers to distinguish similar concepts
- Only decompose further when detail adds meaningful value
- Provide as many concept and attribute examples as possible
- Examples placed higher in the tree are preferable

## Design Rules

- **Inheritance**: Child concepts inherit all parent attributes (never examples)
- **Polymorphism**: Child concepts may add attributes beyond the parent
- **Incompleteness**: Use `... explanation` (Map) to mark intentionally incomplete sections. Normal and accepted.
- **Data over structure**: Prefer examples + attributes + defaults over creating new sub-concepts. Keep the concept tree lean.
- **Assimilate facts**: Convert raw data into example-attribute-value relationships

```aot
Parent
    attribute
    Child
        ... inherits `attribute` from Parent
        extra attribute
        - Child Example
            attribute: value
            extra attribute: value
```

## What NOT to Do

- Do NOT use tabs — 4 spaces only
- Do NOT abbreviate or use synonyms
- Do NOT create sub-concepts when examples + attributes suffice
- Do NOT use plural concept names
- Do NOT add structure without meaningful value
- Do NOT leave misspellings uncorrected
- Do NOT use explicit relationship keywords — indentation expresses all relationships
- Do NOT write examples without the `- ` prefix — a line like `deliver outcomes` is an attribute; write `- deliver outcomes` to make it an example

## Aspects
The aspect taxonomy derives from Aristotle's *Categories*; and modern interpretations. Adopting it brings discipline and rigour to your modelling. Aspects require no special `.aot` syntax — this section explains how to apply them.

---

## Motivation Aspect

Example

```
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
            superordiate influance: Negative
        - business cases handled
            actual: 23
            target: 56
            measurement operation used: Observation
            influence on superordiate measure: Negative
    - quality
        actual: A
        target: C
        number of grades: 5
        measurement operation used: Observation
        updating author: John
```

The concepts used in the Motivation aspect:

```
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
                - ... anything other then 0
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
                ... more then one
                - 2
                - ...
            - stream
                ... unknown quanity
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
        residencial country
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
            common monetory area
            dailing code
        Provice
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
            receipent name
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

## Timing Aspect

Focus: **when and how things happen**.

```aot
Time: 12:00
    Syncronuous
        Fire and Forget Time
            Date
                - 2026-03-15
                precision: no time component
            Date And Time
                - 2026-03-15 12:00
                precision: no seconds
            Precise Date And Time: 2026-03-15 12:00:00:00000
                precision: microseconds
        Period
            Time Box
            Fire and Wait (Synchronous)
                end response event
                timeout duration: 0 seconds
                - Trade
                    execution start precise date and time
                    settlement end date
            Polling
                end response event
                timeout duration: 30 seconds
                polling interval: 24 hours
            start time
            end time
            status
                - Time Set
                - Cleared
                - Triggered
                - Failed Trigger
                - Finalised
            Interval
                - Scheduled Interval
                    - Cron
                    - Batch
                    interval: 24 hours
                    - ...
                start time: now
                interval: 5 minutes
            precision: in today but no seconds
            displacement from greenwich meridian hours: +0
        Duration: 5 hours
            average duration
            modal duration
            minimum duration
            maximum duration
    Concurrent
        Asyncronous
        Multithread
        ...
    timeline
Event
    time
    ...
```

---

## Function Aspect

Focus: **what the system does**, decomposed as a tree.

### Naming Rules

- **Classifications** (types): conventionally nouns only, expressed as example ideas → `- Payment Type`
- **Functions** (actions): verb + qualified object → `Calculate Payment`
- One verb per function, matched to its object
- Name every function objectively, according to its essence

### Forbidden in Names

- "And" (split the function)
- Vague words for services ("manage", "ensure"), performance ("good", "acceptable") and information management ("information", "data", "content", "info")
- no policically loaded words ("Business", "IT", "Management", "Support", or "Execution")
- Flow words ("then", "next")

### Decomposition Rules

- 3 to 7 sub-functions per parent
- Ask **Why** does a sub-function exist? The answer should be its parent
- Ask **How** is a parent achieved? Exclusively through its children
- All sub-functions together fully achieve the parent function

### Pitch Level

Start two levels of granularity above the detail you need, then prune until every leaf is directly executable. Remove anything that does not serve the model.

### Include attributes

Attributes may be attached to functions to describe them more precisely.

---

## Domain Aspect

Focus: **what data and things exist** (concepts, attributes, business rules) and the events that trigger them.

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
- No many-to-many relations on attributes — use Event Associations
- Every concept and attribute name must be unique

### Cleanup Checklist

- Identify functional dependencies between attributes
- Use subset data to clarify scope
- Use aliases to describe concepts
- Use full (unabbreviated) names — final names must be unique and implementable
- Prefer fewer concepts with more examples over many concepts with few examples
- Prioritise concepts by relevance
- Create parent concepts to group related children
- Look for likeness/differences to form general structures
- Remove attributes that do not serve the model

### Armstrong's Axioms (Dependency Inference)

| Rule | In Alpha Terms |
|------|----------------|
| Reflexivity | A concept determines any subset of its own attributes |
| Augmentation | Adding an attribute to a Concept referenceing another concept preserves a dependency |
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

Focus: **where things reside** (physical and logical).

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

### Core Questions

| Question | Aspect | Specify |
|----------|--------|---------|
| What must be done? | Function | The function being executed |
| What data is needed? | Domain | Inputs, outputs, data stores |
| Who must do it? | Metric | Role, ownership |
| When must it be done? | Event | Schedule, triggers |
| Where must it be done? | Location | Execution and data location |
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
