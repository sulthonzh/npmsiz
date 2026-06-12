#!/usr/bin/env node
'use strict';

const { analyze, formatReport } = require('./index');

const args = process.argv.slice(2);
const dir = args[0] || '.';
const options = { full: args.includes('--full'), showDirs: args.includes('--dirs') };
const topIdx = args.indexOf('--top');
if (topIdx !== -1 && args[topIdx + 1]) options.top = parseInt(args[topIdx + 1], 10);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
npmsiz — Analyze what's bloating your npm package

Usage:
  npmsiz [path] [options]

Options:
  --full     Analyze all files (ignore "files" field in package.json)
  --dirs     Show directory breakdown
  --top N    Show top N largest files (default: 10)
  -h, --help Show this help

Examples:
  npmsiz                # Analyze current directory
  npmsiz ./my-pkg       # Analyze specific directory
  npmsiz --full --dirs  # Full analysis with directory breakdown
`);
  process.exit(0);
}

try {
  const result = analyze(dir, options);
  console.log(formatReport(result, options));
  const errors = result.issues.filter(i => i.severity === 'error').length;
  process.exit(errors > 0 ? 1 : 0);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
