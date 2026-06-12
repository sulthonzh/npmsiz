# npmsiz

Analyze what's bloating your npm package before you publish. Zero dependencies.

Ever run `npm publish` and realize your tiny library is 5MB? Yeah. This tool catches that before it happens.

## Install

```bash
npm install -g npmsiz
# or run directly
npx npmsiz
```

## Use

```bash
# Analyze current directory
npmsiz

# Analyze a specific package
npmsiz ./my-package

# Full analysis (ignore "files" field, show directory breakdown)
npmsiz --full --dirs

# Show top 20 largest files
npmsiz --top 20
```

## What it does

- **Scans your package** using the `files` field from package.json (same rules npm uses)
- **Breaks down size by file extension** with a visual bar chart
- **Lists the largest files** so you know what's eating space
- **Detects common bloat**: test files, media assets, missing .npmignore, duplicate files
- **Warns about missing package.json fields** (repository, license, etc.)

## Example output

```
📦 my-lib@1.2.3
   24 files · 187.3 KB

By extension:
  .js  ████████████████████████████░░  82.3%  (154.1 KB, 18 files)
  .d.ts ████░░░░░░░░░░░░░░░░░░░░░░░░  12.1%  (22.6 KB, 4 files)
  .json ██░░░░░░░░░░░░░░░░░░░░░░░░░░   5.6%  (10.5 KB, 2 files)

Top 10 largest files:
     85.2 KB   56.2%  src/bundle.js
     22.1 KB   14.5%  src/index.d.ts
      8.3 KB    5.5%  src/utils.js

Issues:
  ⚠️  Large file: src/bundle.js (85.2 KB)
  💡 No "files" field in package.json — npm will include everything

✅ Package looks publishable, 1 warning(s) to consider
```

## Why

I got tired of publishing packages and finding out later they were 10x larger than expected. Most of the time it was a test file, a stray asset, or forgetting the `files` field. This catches all of that in one command.

## API

```javascript
const { analyze, formatReport } = require('npmsiz');

const result = analyze('./my-package');
console.log(formatReport(result));

// Access raw data
result.totalSize;      // bytes
result.fileCount;      // number
result.byExtension;    // [{ extension, totalSize, count }]
result.byDirectory;    // [{ directory, totalSize, count }]
result.largest;        // [{ relativePath, size }]
result.issues;         // [{ type, severity, message }]
```

## Options

| Flag | Description |
|------|-------------|
| `--full` | Analyze all files, ignore `files` field |
| `--dirs` | Show directory breakdown |
| `--top N` | Show top N largest files (default 10) |

## License

MIT
