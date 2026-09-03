// Run the formatter over the given .aot files, exactly as Format Document
// does, and write the result back.
const fs = require("fs");
const path = require("path");
const table = require("../src/table");
const { lint } = require("../src/linter");
const { conceptRegistry } = require("../src/derive");

for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "utf8");
  const name = path.basename(file).replace(/\.[^.]*$/, "");
  let root, nodes;
  try { ({ root, nodes } = lint(text, name)); } catch (e) { console.log("SKIP", file, e.message); continue; }
  const reg = table.mergeRegistries(conceptRegistry(root, nodes));
  const lines = text.split(/\r?\n/);
  const edits = table.align(text, reg, name);
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    if (e.to !== undefined) lines.splice(e.line - 1, e.to - e.line + 1, ...e.text.split("\n"));
    else lines[e.line - 1] = e.text;
  }
  const out = lines.join("\n");
  if (out !== text) {
    fs.writeFileSync(file, out);
    console.log("formatted", file);
  }
}
