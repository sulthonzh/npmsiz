# npmsiz

Analyze what's bloating your npm package before you publish.

## Why?

Ever published a package and realized it was 10x bigger than expected? Tests, configs, source maps, `.DS_Store` files — they all sneak in. `npmsiz` scans your package the same way `npm publish` would and tells you exactly what's going to ship.

## Install

```bash
npm install -g npmsiz
```

Or use without installing:

```bash
npx npmsiz ./my-package
```

## Usage

```bash
# Analyze current directory
npmsiz

# Analyze a specific package
npmsiz ./path/to/package
```

## Example Output

```
🟢 my-lib@2.1.0 — LEAN
   12 files | 45.2 KB raw | 12.8 KB gzipped

📦 Top files by size:
   ████████████████████ 18.5KB — dist/index.js
   ██████████ 9.2KB — dist/utils.js
   ████ 3.1KB — README.md
   ██ 1.8KB — package.json
   █ 0.9KB — LICENSE

✨ Package looks lean — good to publish!
```

## What It Checks

- **Bloat patterns**: Test files, source maps, configs, IDE files that shouldn't ship
- **File sizes**: Flags individual files over 50KB (warn) or 200KB (error)
- **Total size**: Warns if package is over 500KB, errors at 5MB
- **Gzip estimate**: Shows compressed size so you know what users actually download
- **Missing publish config**: Detects if you're missing `files` or `.npmignore`

## Verdicts

| Verdict | Meaning |
|---------|---------|
| 🟢 LEAN | Package is clean and small |
| 🟡 CHUBBY | Some unnecessary files, worth cleaning up |
| 🔴 BLOATED | Too big, fix before publishing |

## How It Works

1. Reads your `package.json` — respects the `files` field if present
2. Falls back to `.npmignore` if no `files` field
3. Scans all files that would be included in `npm publish`
4. Checks each file against bloat patterns and size thresholds
5. Estimates gzip size for the full package
6. Exits with code 1 if bloated (useful in CI)

## CI Integration

```yaml
# GitHub Actions
- name: Check package size
  run: npx npmsiz .
```

The command exits with code 1 if the package is bloated, so your CI will fail if things get too big.

## Zero Dependencies

No external dependencies. Uses only Node.js built-in modules (`fs`, `path`, `zlib`).

## License

MIT
