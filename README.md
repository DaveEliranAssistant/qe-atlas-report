# QE Atlas Report

A product-neutral composite GitHub Action. Every producer emits the [v1 contract](schema/qe-result-v1.schema.json). The reporter discovers files, not product names: adding a new producer needs no renderer change.

```yaml
permissions:
  contents: read
  pull-requests: write
steps:
  # Run product tools first in an isolated, trusted analysis job.
  - uses: DaveEliranAssistant/qe-atlas-report@<reviewed-full-commit-sha>
    if: always()
    with:
      results: product-reports/qe-result*.json
      expected-files: |
        product-reports/qe-result-a11ygate.json
        product-reports/qe-result-flakelens.json
        product-reports/qe-result-specgate.json
      mode: report-only
```

## Outputs

One updating `github-actions[bot]` PR comment, a consolidated section prepended to the current step summary, and one `qe-atlas-report` artifact containing self-contained `report.html`, `report.json` and `report.md`. HTML is escaped, script-free and includes keyboard-accessible collapsible product details. Native Markdown is displayed literally, not executed as HTML. The artifact is retained 14 days. A run without a PR number explicitly skips the comment; set `comment: 'false'` for read-only/fork workflows.

Inputs: `results` (newline-separated globs), `expected-files` (newline-separated expected paths/globs), `mode` (`report-only` or `enforce`), `comment`, `token`, `pr-number`, `output-dir`, `artifact-name`. Outputs: `verdict`, `exit-code`, `comment-url`, `artifact-url`.

## Semantics

- Product `fail` always makes overall FAIL, even when another file is an operational error. Otherwise: error, warn, pass in that order. `hasErrors` separately records incomplete evidence.
- Malformed, missing expected, oversized, symlink and unreadable files appear as explicit ERROR rows. Zero discovered files is ERROR. A glob cannot know an absent producer existed: list expected paths to enforce that contract.
- `report-only` reports all product verdicts without failing on them; it does not override prior job failures. `enforce` returns 1 for findings and 2 for incomplete evidence. Comment/API failures always fail the Action. Artifact upload happens before recorded enforcement.
- Findings are capped at 100 per product. Producers retain total counts/native output. Limits: 100 result files, 256 KiB per file, 4 MiB combined, 20 directory levels/20,000 entries, 30 metrics/artifacts per result. Discovery excludes .git and node_modules. Globs support `*`, `**`, `?`; no brace/extglob syntax.
- Oversized PR comments fail visibly rather than silently dropping checks; full HTML/JSON remains uploaded. No overall PASS means universal accessibility, API compatibility or flake-free execution.

## Trust and permissions

Pin this Action and producer tools to reviewed full SHAs. Run untrusted app/browser code in a separate read-only job; analyze downloaded evidence with trusted tooling in the comment-capable job. Do not use `pull_request_target`, privileged PATs, or execute uploaded source/scripts. Results are untrusted data; metadata must not contain secrets. This bounded filesystem reader is not an OS sandbox; do not allow concurrent mutation of its trusted workspace. Only the reporter's marker on GitHub Actions bot comments is updated; human comments are never edited. No product list is compiled into the reporter.

## Local development

Node 22 or 24, no runtime dependencies:

```
node --test test/*.test.mjs
node src/validate.mjs path/to/qe-result.json
QE_RESULTS='product-reports/qe-result*.json' QE_COMMENT=false node src/run.mjs
```

The JSON Schema documents the portable contract; `src/validate.mjs` additionally enforces safe HTTP(S) URLs and rejects credentials/control characters. Future schema versions must be explicitly supported, never guessed.

MIT license. This Action does not publish or modify Hermes operational data.
