// quick smoke: the closing pipe on render, and lenient parsing without one
const t = require("./src/table");

const show = (lines) => {
  const b = t.blockAt(lines, 0);
  console.log(JSON.stringify(t.render(b), null, 0).replace(/","/g, '"\n  "'));
};

console.log("--- old file, no closing pipes (the user's example) ---");
show([
  "    Repository   |path",
  "    Source code  |src/",
  "    Configuration|config/",
  "    Tests        |tests/",
]);

console.log("--- already closed: byte-for-byte round trip ---");
show([
  "    Repository   |path   |",
  "    Source code  |src/   |",
  "    Configuration|config/|",
  "    Tests        |tests/ |",
]);

console.log("--- one-column nested table ---");
show([
  "Org Structure|",
  "    Department A|",
  "        Team 1|",
  "            Alice|",
  "            Bob|",
  "        Team 2|",
  "            Charlie|",
]);

console.log("--- a row that stops short of the last columns ---");
show([
  "Thing       |age|colour",
  "Parent      |",
  "    Child 1 |10|red",
]);

console.log("--- cells() drops the closing pipe, keeps offsets ---");
console.log(JSON.stringify(t.cells("Repository   |path   |")));
console.log(JSON.stringify(t.cells("Repository   |path")));
console.log(JSON.stringify(t.cells("      |frag|")));
console.log("--- colAt past the closing pipe stays in the last cell ---");
console.log(t.colAt("a|b|", 4), t.colAt("a|b|", 3), t.colAt("a|b|", 2), t.colAt("a|b", 3));
console.log("--- a pre-1.12 bordered table migrates ---");
show(["|Otter |size|", "|Ollie |5   |", "|Pebble|3   |"]);
