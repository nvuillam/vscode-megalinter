# Changelog

All notable changes to the MegaLinter Configuration extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-02

- Handle EXTENDS property and highlight inherited variables in the configuration editor
- Use `x-doc-key` when mentioned in JSON Schema to build links to documentation
- Fix duplicate label "Config values"
- Improve responsiveness of the configuration editor on small screens
- Implement Run MegaLinter UI panel (with container image selection/cleanup, linter selection, runner version, flavor defaults, parallel cores, and apply-fixes toggle)
- Load `.env` to hydrate Run panel settings and improve log path resolution/messaging (including "no matching linters" notice)
- Allow configuring or hiding recommended VS Code extensions in the Run panel
- Enhance status and navigation visuals (active descriptor/linter tabs and navigation items, clearer configured-state styling, loading spinners)

## [0.0.1] - 2026-01-12

- Initial release of MegaLinter Configuration extension
  - Install/Upgrade MegaLinter
  - Visual configuration editor
  - Custom flavor builder


