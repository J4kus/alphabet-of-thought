# How Alpha computes its Gödel numbers

Every node of an Alpha model carries a Gödel number, `G`: one integer that encodes everything the node says. Since 1.13 the extension computes these numbers without ever building the integers, unless a person asks to see one. This note explains what `G` encodes, why it can be computed without being built, what that buys, and what was considered and turned down.

The code is [`src/godel.js`](../src/godel.js) and [`src/primes.js`](../src/primes.js). The measurements below come from [`out/bench-godel.js`](../out/bench-godel.js).

## What `G` encodes

Each attribute in the repository is given its own prime, and each value of that attribute is given a small code. A node's number is the product, over the attributes in force at the node, of the attribute's prime raised to the value's code:

```
G(node) = ∏ p(attribute) ^ code(value)
```

So `G` is a factorisation the linter reads, never a number anyone computes with. It answers questions such as:
- Does this node state that attribute? Does `p` divide `G`?
- What value does it state? The exponent of `p` in `G`.
- Do two nodes say the same thing? Is `G(a) = G(b)`?
- What do two nodes share? `gcd(G(a), G(b))`.

That is Leibniz's characteristic-number idea (1679), with Gödel's prime-power encoding (1931) carrying the values. Since 1.12 the primes and codes are stable across edits, files and branches ([`aot.files/godel.tsv`](../README.md#gödel-numbering)).

## Why it can be computed without being built

The fundamental theorem of arithmetic says every positive integer has exactly one factorisation into primes. So the map from finite exponent vectors to positive integers is an isomorphism:

```
(ℕ⁺, ×)  ≅  (finite vectors of exponents, +)
```

Nothing about `G` is lost by keeping its exponent vector instead of the integer. Every question the linter asks has an exact answer in the vector:

| On the integer (before 1.13) | On the exponent vector (1.13) | Cost |
|---|---|---|
| `G(a) × G(b)` | add the exponents | O(k) |
| the exponent of `p` in `G` (repeated `%` and `/`) | look `p` up | O(log k) |
| which primes divide `G` (one `G % p` per prime in the repository) | the vector's support | O(k) |
| `G(a) = G(b)` | compare interned canonical keys (`2^3.13^2.19^4`) | O(1) |
| gcd, lcm, divisibility | componentwise min, max, ≤ (one merge walk) | O(k) |
| how many attributes two nodes disagree on | merge walk counting differing exponents | O(k₁ + k₂) |
| how many digits `G` has | ⌊Σ e·log₁₀ p⌋ + 1 | O(k) |
| the integer itself | built on demand, by a balanced product tree | O(M(n) log k) |

Here `k` is the number of attributes a node carries (about 5 to 30), not the size of the repository's attribute universe (300 primes and more), and nothing depends on how large the integer is.

Computer algebra keeps integers and monomials the same way, for the same reason. Polynomial libraries such as Singular, FLINT's `mpoly` modules and Groebner.jl store a monomial as its exponent vector. Axiom's `Factored` domain keeps an integer factored "as long as possible", because multiplication, gcd and divisibility are cheap in that form. The one operation the factored form cannot do cheaply is addition, and the linter never adds two Gödel numbers. Factoring is the other hard problem, and it never arises: every prime is known in advance, because the registry assigned it.

### The vector

`applyGodel` gives each node `gvec = { p[], e[], key, support, log10 }`:
- the primes and their exponents, as plain JavaScript numbers (each guarded with `Number.isSafeInteger`);
- `key`, a canonical string used for equality and grouping;
- `support`, the key of the primes alone, which says what is stated without saying what value;
- `log10`, the size estimate.

`node.godel` is still the exact `BigInt`, behind a getter that builds and memoises it on first touch. So `verify.js --godel`, and every older test written with `===`, `> 1n` and `% p`, read the same integer as before.

Every hot path works on the vectors and walks a node's own primes, or the union of two nodes' primes, never the whole attribute universe:
- `clashes` (rule 20) groups by identity plus support key and compares keys.
- `hoists` (rules 15–16) intersects the children's supports.
- `overrides`, `distance`, `near`, `profile` (the hover), `diff` and `twins` (rule 17) compare vectors.
- `armstrong.inferFDs` reads each object's own vector.
- The merge's arithmetic check walks the union of four supports.

### Showing the integer

When a person asks to see an integer, it is built from its factors with a balanced product tree. The leaves are `p ** e`, multiplied pairwise up the tree, so the large multiplications happen between operands of similar size. That is where V8's `BigInt` multiplication uses its faster algorithms: Karatsuba from 34 machine words, Toom-Cook from 193, and FFT from 1,500 (V8's `src/bigint`). Building the integers one factor at a time multiplies a huge partial product by a small one, over and over, and never reaches those thresholds.

At the sizes the extension meets, the product tree is only a small gain (73 ms against 81 ms for 2,000 numbers averaging 6,188 digits). The real gain is not building the integer at all.

The hover prints an integer in full while it has at most 30 digits. Past that it prints the factorisation and the size, as `≈ 4.12 × 10^1,234 (1,235 digits)`. The digit count comes from the logarithm sum, and is checked against an exact `BigInt` only when the sum lands within rounding of a power of ten. A clash (rule 20) is reported by its factorisation, never by a thousand-digit integer. `verify.js --godel` prints the exact integer and its digit count.

### The primes

Before 1.13, `linter.primes()` found primes by trial division against every prime found so far, and started over on every lint. It now draws from one cached Sieve of Eratosthenes, kept for the life of the process. The sieve is odd numbers only, and is sized by the Rosser–Schoenfeld bound pₙ < n(ln n + ln ln n), valid for n ≥ 6, so one pass always reaches the n-th prime. When more primes are needed it grows by doubling. The first 20,000 primes took 282 ms by trial division and take 5.4 ms sieved: the same list, and later lints pay nothing.

## What it buys

The benchmark builds a synthetic file shaped like real data: one wide table with a unique reference column, whose value codes and so exponents grow with every row, a few low-cardinality columns, and a second Concept declaring enough attributes to give a repository-sized prime universe. Node 24, one lint pass:

| | 1,000 rows, before | after | 2,000 rows, before | after |
|---|---:|---:|---:|---:|
| lint (parse, primes, rules) | 265.6 ms | 59.5 ms | 888.1 ms | 101.3 ms |
| number every node | 32.3 ms | 27.4 ms | 77.3 ms | 52.9 ms |
| clashes (rule 20) | 153.7 ms | 2.4 ms | 550.4 ms | 4.6 ms |
| hoists (rules 15–16) | 700.5 ms | 4.0 ms | 3,539.5 ms | 6.8 ms |
| dependency inference (rules 12–13) | 713.7 ms | 47.7 ms | 3,383.1 ms | 98.2 ms |
| one hover | 869.6 ms | 0.4 ms | 6,659.0 ms | 0.6 ms |
| twins (rule 17, two files) | 14.4 ms | 11.5 ms | 51.5 ms | 19.0 ms |

The widest numbers in those files have 3,681 and 6,951 digits. A further measurement, 2,000 vectors of 10–30 attributes over 300 primes with codes up to 200 (6,188 digits on average):
- decoding every number over every prime took 11,999 ms on integers, and takes 2 ms on vectors;
- grouping by decimal string took 244 ms, and grouping by canonical key takes 4 ms;
- the log-sum digit counts matched `String(G).length` for all 2,000.

Before 1.13 the cost grew with the number of nodes times the attribute universe times the value codes. A hover on a 2,000-row table took nearly seven seconds. The cost now grows with the attributes each node carries, and nothing in the editor waits on the size of an integer.

## Considered and turned down

- **Fingerprints modulo a few large primes (the Chinese remainder theorem).** These would make equality cheap on the integers. Canonical keys already make it O(1), exactly and with no chance of a collision.
- **Divisibility bit masks.** A mask per node over the attribute universe speeds up "which primes divide `G`". Nothing scans for divisibility any more: the support is the answer.
- **Pairing functions, Gödel's β-function, and Zeckendorf/Fibonacci encodings.** These give compact integers, but they lose the reading that makes the number worth having: one prime per attribute, one exponent per value.
- **Squarefree "Leibniz pairs".** A pair of numbers per node, with containment read as divisibility, gives smaller integers. It would change what `G` is, and the encoding stays as it was. The change is only in how it is computed.

## How it is tested

[`out/test-godel.js`](../out/test-godel.js) blocks 15 and 16, on every fixture node, check that:
- the vector and the integer agree: `toBigInt` equals the product, every valuation, key equality matches integer equality, and `digits` matches `String(G).length`;
- the product tree gives the same integer as the sequential product, on random vectors;
- the sieve gives the same primes as trial division for the first 10,000 primes.

Every assertion written before 1.13 is unchanged and still passes. `node out/bench-godel.js [rows]` repeats the measurements above; it is not part of `npm test`.

## Sources

- G. W. Leibniz, *Elementa characteristicae universalis* (1679): characteristic numbers, a concept's number the product of its parts'.
- K. Gödel, "Über formal unentscheidbare Sätze der Principia Mathematica und verwandter Systeme I", *Monatshefte für Mathematik und Physik* 38 (1931): prime-power encoding.
- J. B. Rosser and L. Schoenfeld, "Approximate formulas for some functions of prime numbers", *Illinois Journal of Mathematics* 6 (1962), 64–94: the bound pₙ < n(ln n + ln ln n).
- D. J. Bernstein, "Fast multiplication and its applications", in *Algorithmic Number Theory*, MSRI Publications 44 (2008): product trees.
- The Axiom computer algebra system's `Factored` domain; FLINT's `fmpz_mpoly`; Singular; Groebner.jl: exponent-vector representations.
- V8's `BigInt` implementation (`src/bigint`): Karatsuba, Toom-Cook and FFT multiplication thresholds.
