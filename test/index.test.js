#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { analyze, formatReport, formatBytes, walkDir, groupByExtension, detectIssues } = require('../src/index');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// Create test fixtures
const testDir = path.join(__dirname, 'fixtures', 'sample-pkg');
fs.rmSync(testDir, { recursive: true, force: true });
fs.mkdirSync(testDir, { recursive: true });

// package.json
fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({
  name: 'sample-pkg',
  version: '1.0.0',
  description: 'A sample package',
  license: 'MIT',
  main: 'src/index.js',
  files: ['src'],
}, null, 2));

// Source files
fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(testDir, 'src', 'index.js'), 'module.exports = {};\n'.repeat(20));
fs.writeFileSync(path.join(testDir, 'src', 'utils.js'), 'function helper() {}\n'.repeat(10));
fs.writeFileSync(path.join(testDir, 'src', 'large.js'), 'x'.repeat(50000));

// Files that should be excluded by "files" field
fs.writeFileSync(path.join(testDir, 'big-test.test.js'), 'test stuff '.repeat(100));
fs.writeFileSync(path.join(testDir, '.npmignore'), 'big-test.test.js');
fs.writeFileSync(path.join(testDir, 'README.md'), '# Sample Package\n');
fs.writeFileSync(path.join(testDir, 'LICENSE'), 'MIT License\n');

// Test fixtures for another test
const fullDir = path.join(__dirname, 'fixtures', 'full-pkg');
fs.rmSync(fullDir, { recursive: true, force: true });
fs.mkdirSync(fullDir, { recursive: true });
fs.writeFileSync(path.join(fullDir, 'package.json'), JSON.stringify({
  name: 'full-pkg', version: '2.0.0',
}));
fs.writeFileSync(path.join(fullDir, 'index.js'), 'x'.repeat(200000));
fs.mkdirSync(path.join(fullDir, 'assets'), { recursive: true });
fs.writeFileSync(path.join(fullDir, 'assets', 'logo.png'), 'x'.repeat(300000));
fs.writeFileSync(path.join(fullDir, 'assets', 'icon.svg'), '<svg></svg>'.repeat(1000));
fs.mkdirSync(path.join(fullDir, '__tests__'), { recursive: true });
fs.writeFileSync(path.join(fullDir, '__tests__', 'index.test.js'), 'test()'.repeat(500));

console.log('Testing npmsiz...\n');

// Test 1: Basic analysis
console.log('1. Basic analysis with "files" field');
const r1 = analyze(testDir);
assert(r1.packageJson.name === 'sample-pkg', 'package.json loaded');
assert(r1.fileCount > 0, 'has files');
assert(r1.totalSize > 0, 'has total size');
assert(r1.byExtension.length > 0, 'has extension groups');
assert(r1.largest.length > 0, 'has largest files');
assert(r1.files.every(f => f.relativePath.startsWith('src/') || f.relativePath === 'package.json' || f.relativePath === 'README.md' || f.relativePath === 'LICENSE'), 'respects files field');

// Test 2: Full analysis
console.log('2. Full analysis (--full)');
const r2 = analyze(fullDir, { full: true });
assert(r2.fileCount >= 5, 'full analysis includes all files');
assert(r2.totalSize > 500000, 'large total size');

// Test 3: formatBytes
console.log('3. formatBytes utility');
assert(formatBytes(0) === '0 B', '0 bytes');
assert(formatBytes(100) === '100 B', '100 bytes');
assert(formatBytes(1024) === '1.0 KB', '1 KB');
assert(formatBytes(1048576) === '1.0 MB', '1 MB');
assert(formatBytes(1073741824) === '1.0 GB', '1 GB');

// Test 4: walkDir
console.log('4. walkDir');
const walked = walkDir(fullDir);
assert(walked.length > 0, 'walked files exist');
assert(walked.every(f => f.path && f.relativePath && f.size !== undefined && f.extension !== undefined), 'file objects have required fields');

// Test 5: groupByExtension
console.log('5. groupByExtension');
const groups = groupByExtension(walked);
assert(groups.length > 0, 'has groups');
assert(groups[0].totalSize >= (groups[1]?.totalSize || 0), 'sorted by size desc');
assert(groups.every(g => g.extension && g.count > 0 && g.totalSize > 0), 'groups have required fields');

// Test 6: Issue detection — large files
console.log('6. Issue detection');
const issues = detectIssues(walked, r2.packageJson, r2.totalSize);
assert(issues.some(i => i.type === 'large_file'), 'detects large files');
assert(issues.some(i => i.type === 'media_asset'), 'detects media assets');
assert(issues.some(i => i.type === 'test_files'), 'detects test files');
assert(issues.some(i => i.type === 'no_files_field'), 'detects missing files field');

// Test 7: Issue detection — missing package.json fields
console.log('7. Missing fields detection');
const minimalPkg = { name: 'minimal' };
const fieldIssues = detectIssues([], minimalPkg, 0);
assert(fieldIssues.some(i => i.type === 'missing_fields'), 'detects missing required fields');

// Test 8: formatReport
console.log('8. formatReport');
const report = formatReport(r1);
assert(report.includes('sample-pkg'), 'report includes package name');
assert(report.includes('files'), 'report mentions files');
assert(typeof report === 'string' && report.length > 0, 'report is non-empty string');

// Test 9: Error on missing directory
console.log('9. Error handling');
try {
  analyze('/nonexistent/path');
  assert(false, 'should throw on missing dir');
} catch (e) {
  assert(e.message.includes('not found'), 'throws descriptive error');
}

// Test 10: CLI --help
console.log('10. CLI help');
const { execSync } = require('child_process');
const help = execSync('node ' + path.join(__dirname, '..', 'src', 'cli.js') + ' --help', { encoding: 'utf-8' });
assert(help.includes('npmsiz'), 'help mentions npmsiz');
assert(help.includes('--full'), 'help mentions --full');

// Test 11: CLI on test dir
console.log('11. CLI execution');
const output = execSync('node ' + path.join(__dirname, '..', 'src', 'cli.js') + ' ' + testDir, { encoding: 'utf-8' });
assert(output.includes('sample-pkg'), 'CLI output includes package name');

// Clean up
fs.rmSync(path.join(__dirname, 'fixtures'), { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
