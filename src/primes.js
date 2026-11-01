// The primes, from one sieve kept for the life of the process.
//
// Every node of a parse takes a prime for its characteristic number
// (linter.js, chi = prime * chi(parent)), and every attribute one for its
// Gödel number (godel.js). A lint asks for them on every keystroke, and a
// table of two thousand rows is twelve thousand nodes — so the list is
// sieved once, kept, and only ever extended. It used to be re-derived on
// every lint by trial division against every prime found so far, which
// cost 282 ms for the first 20,000 primes; the sieve takes about 5 ms, once.
//
// How far to sieve for the n-th prime is the Rosser–Schoenfeld bound
// p(n) < n (ln n + ln ln n), true for every n >= 6, so one pass always
// reaches it; the limit is at least doubled when it grows, so a run of
// requests costs one sieve of the final size, not one per request.
//
// Pure, and a leaf: it requires nothing, so linter.js and godel.js can
// both depend on it without a cycle.

let found = [2, 3, 5, 7, 11, 13]; // every prime up to `limit`, ascending
let limit = 13;
const bigs = []; // BigInt twins of `found`, made as they are asked for

// A sieve of Eratosthenes over the odd numbers up to `max`.
function sieveTo(max) {
  if (max <= limit) return;
  const size = Math.floor((max - 1) / 2); // index i stands for 2i + 1
  const composite = new Uint8Array(size + 1);
  for (let i = 1; ; i++) {
    const p = 2 * i + 1;
    if (p * p > max) break;
    if (composite[i]) continue;
    for (let j = (p * p - 1) / 2; j <= size; j += p) composite[j] = 1;
  }
  const out = [2];
  for (let i = 1; i <= size; i++) if (!composite[i]) out.push(2 * i + 1);
  found = out;
  limit = max;
}

// Enough of the list to hold the n-th prime (counting from 0).
function reach(index) {
  if (index < found.length) return;
  const n = index + 1;
  const bound = n < 6 ? 13 : Math.ceil(n * (Math.log(n) + Math.log(Math.log(n))));
  sieveTo(Math.max(bound, limit * 2));
}

// The prime at `index` (0 -> 2, 1 -> 3, ...), as a Number.
function nth(index) {
  reach(index);
  return found[index];
}

// The same prime as a BigInt, the type the characteristic and Gödel
// numbers are multiplied in.
function nthBig(index) {
  if (bigs[index] === undefined) bigs[index] = BigInt(nth(index));
  return bigs[index];
}

// The first `n` primes, as Numbers.
function firstN(n) {
  if (n > 0) reach(n - 1);
  return found.slice(0, n);
}

// Whether `p` (a Number or a BigInt) is prime: a lookup in the sieved list
// while it reaches that far, trial division by the sieved primes beyond.
function isPrime(p) {
  const n = typeof p === "bigint" ? Number(p) : p;
  if (!Number.isSafeInteger(n) || n < 2) return false;
  if (n <= limit) {
    let lo = 0, hi = found.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (found[mid] === n) return true;
      if (found[mid] < n) lo = mid + 1; else hi = mid - 1;
    }
    return false;
  }
  sieveTo(Math.ceil(Math.sqrt(n)));
  for (const q of found) {
    if (q * q > n) break;
    if (n % q === 0) return false;
  }
  return true;
}

// Every prime in order, as BigInts, forever — the generator linter.js and
// godel.js hand out primes from.
function* bigPrimes() {
  for (let i = 0; ; i++) yield nthBig(i);
}

module.exports = { nth, nthBig, firstN, isPrime, bigPrimes };
