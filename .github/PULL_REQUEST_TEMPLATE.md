## What does this PR do?

<!-- One sentence summary -->

## Type of change

- [ ] Bug fix
- [ ] New feature (new command, flag, or model)
- [ ] Breaking change (changes existing behavior)
- [ ] Documentation only
- [ ] Refactor (no behavior change)

## Related issue

Closes #

## Changes made

<!-- List the files changed and what was changed in each -->

## Testing done

<!-- Describe how you tested this manually. No automated test suite yet - manual verification is fine. -->

```bash
# Commands you ran to verify this works
schemalock define ...
schemalock test ...
```

## Checklist

- [ ] All errors use `console.error()` and `process.exit(1)` (not `console.log` + implicit exit)
- [ ] `--output json` on `test` still produces clean JSON (no stray console.log to stdout)
- [ ] Chalk padding uses `str.padEnd(n)` before colorizing, not after
- [ ] New flags are documented in README.md
- [ ] CHANGELOG.md updated under `## [Unreleased]`
- [ ] If a new model was added: pricing sourced from official provider docs (include link)
- [ ] If a new provider was added: `.env.example` updated with the new key name
