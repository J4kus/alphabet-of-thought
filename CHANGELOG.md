# Change Log

All notable changes to the "aot" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.1.14] - 2026-06-11

- Crosslinks: the two inline connections are now highlighted as links and navigable
  - `attribute-is-a-Concept`: an attribute's (or default's) trailing words matching a Concept name are underlined in the link colour, with the defining line shown on hover
  - `default-is-a-Individual`: a default value exactly matching an Individual name is underlined likewise
  - Ctrl+click (Go to Definition) on either jumps to the defining node's line

## [1.1.0] - 2026-06-10

- Linter: `.aot` files are now verified arithmetically (after Leibniz) as you type, with findings shown as squiggles and in the Problems panel
  - errors: tabs, indent not a multiple of 4, depth jumps, Maps with children, a Concept defined twice (univocity), identical siblings
  - warnings: a parent with exactly one child, a parent with more than twelve children
- `verify.js` command line: `node verify.js <file.aot>`, plus `--ask X Y` (is-a by divisibility), `--genus X Y` (genus by gcd), `--number X` (characteristic number)

## [Unreleased]

- Initial release