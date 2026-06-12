const fs = require("fs");
const path = require("path");
const { analyze, formatReport, BLOAT_PATTERNS, SIZE_THRESHOLDS } = require("./index.js");

const passed = [];
const failed = [];

function assert(condition, name) {
  if (condition) {
    passed.push(name);
  } else {
    failed.push(name);
    console.error("  FAIL:", name);
  }
}

function createTempPackage(structure) {
  const tmpDir = path.join("/tmp", "npmsiz-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = path.join(tmpDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return tmpDir;
}

function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

// Test 1: Basic lean package
console.log("Test 1: Lean package analysis");
{
  const tmp = createTempPackage({
    "package.json": JSON.stringify({ name: "test-pkg", version: "1.0.0", main: "index.js" }),
    "index.js": "module.exports = function() { return 42; };",
    "README.md": "# test",
  });
  const r = analyze(tmp);
  assert(r.summary.name === "test-pkg", "name detected");
  assert(r.summary.fileCount >= 2, "files counted");
  assert(r.summary.totalSizeKB > 0, "size > 0");
  assert(r.summary.gzipSizeKB > 0, "gzip > 0");
  assert(r.verdict === "lean", "lean verdict");
  assert(typeof formatReport(r) === "string", "report is string");
  cleanup(tmp);
}

// Test 2: Bloated package
console.log("Test 2: Bloated package");
{
  const big = "x".repeat(600 * 1024); // 600KB to trigger chubby
  const tmp = createTempPackage({
    "package.json": JSON.stringify({ name: "bloated", version: "1.0.0" }),
    "lib/big.map": big,
    "test/index.test.js": "describe('test', () => {});",
    "__tests__/unit.spec.js": "test('x', () => {});",
    ".DS_Store": "junk",
    "src/index.js": "module.exports = {}",
  });
  const r = analyze(tmp);
  assert(r.verdict !== "lean", "not lean for big package");
  assert(r.allIssues.length > 0, "issues found");
  assert(r.allIssues.some(f => f.issues.some(i => i.type === "bloat")), "bloat detected");
  cleanup(tmp);
}

// Test 3: files field
console.log("Test 3: files field whitelist");
{
  const tmp = createTempPackage({
    "package.json": JSON.stringify({ name: "scoped", version: "2.0.0", files: ["dist"] }),
    "dist/index.js": "module.exports = {};",
    "src/index.ts": "export {};",
    "test/test.ts": "test",
  });
  const r = analyze(tmp);
  assert(r.summary.name === "scoped", "name ok");
  assert(r.summary.fileCount === 2, "only dist + pkgjson");
  cleanup(tmp);
}

// Test 4: No package.json
console.log("Test 4: Missing package.json");
{
  const r = analyze("/tmp/nope-" + Date.now());
  assert(r.error !== undefined, "error returned");
  assert(formatReport(r).includes("Error"), "report shows error");
}

// Test 5: Report format
console.log("Test 5: Report formatting");
{
  const tmp = createTempPackage({
    "package.json": JSON.stringify({ name: "fmt", version: "3.0.0", main: "i.js" }),
    "i.js": "export default {}",
  });
  const r = analyze(tmp);
  const report = formatReport(r);
  assert(report.includes("fmt"), "has name");
  assert(report.includes("3.0.0"), "has version");
  assert(/LEAN|CHUBBY|BLOATED/.test(report), "has verdict");
  cleanup(tmp);
}

// Test 6: Gzip < raw
console.log("Test 6: Gzip smaller than raw");
{
  const tmp = createTempPackage({
    "package.json": JSON.stringify({ name: "gz", version: "1.0.0" }),
    "data.js": "module.exports = " + JSON.stringify(Array(500).fill("hello world")) + ";",
  });
  const r = analyze(tmp);
  assert(r.summary.gzipSizeKB > 0 && r.summary.gzipSizeKB < r.summary.totalSizeKB, "gzip < raw");
  cleanup(tmp);
}

// Test 7: Bloat patterns are valid
console.log("Test 7: Bloat patterns valid");
{
  assert(Array.isArray(BLOAT_PATTERNS), "is array");
  assert(BLOAT_PATTERNS.length > 10, "10+ patterns");
  for (const bp of BLOAT_PATTERNS) {
    const re = bp.pattern instanceof RegExp ? bp.pattern : new RegExp(bp.pattern);
    assert(re instanceof RegExp, "valid regex");
    assert(typeof bp.reason === "string" && bp.reason.length > 0, "has reason");
  }
}

// Test 8: Thresholds
console.log("Test 8: Size thresholds");
{
  assert(SIZE_THRESHOLDS.file.warn < SIZE_THRESHOLDS.file.error, "file");
  assert(SIZE_THRESHOLDS.total.warn < SIZE_THRESHOLDS.total.error, "total");
  assert(SIZE_THRESHOLDS.gzip.warn < SIZE_THRESHOLDS.gzip.error, "gzip");
}

// Test 9: .npmignore
console.log("Test 9: .npmignore support");
{
  const tmp = createTempPackage({
    "package.json": JSON.stringify({ name: "ni", version: "1.0.0" }),
    ".npmignore": "test/\n*.test.js",
    "index.js": "module.exports = {};",
    "test/a.test.js": "test",
    "test/b.js": "test",
  });
  const r = analyze(tmp);
  const paths = r.topFiles.map(f => f.path);
  assert(!paths.some(p => p.includes("test/")), "test excluded");
  cleanup(tmp);
}

// Test 10: Huge package is bloated
console.log("Test 10: Huge package verdict");
{
  const big = "x".repeat(1024 * 1024 * 6);
  const tmp = createTempPackage({
    "package.json": JSON.stringify({ name: "huge", version: "1.0.0" }),
    "huge.dat": big,
  });
  const r = analyze(tmp);
  assert(r.verdict === "bloated", "bloated for huge");
  cleanup(tmp);
}

console.log("\n" + "=".repeat(40));
console.log(`Passed: ${passed.length} | Failed: ${failed.length}`);
if (failed.length > 0) { console.log("Failed:", failed); process.exit(1); }
console.log("All tests passed ✅");
