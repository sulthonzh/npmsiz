const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Files/patterns that commonly bloat packages
const BLOAT_PATTERNS = [
  { pattern: /\.test\.(js|ts|mjs|cjs)$/, reason: "Test file — consider excluding from publish" },
  { pattern: /\.spec\.(js|ts|mjs|cjs)$/, reason: "Spec file — consider excluding from publish" },
  { pattern: /\.map$/, reason: "Source map — usually not needed in production packages" },
  { pattern: /\.d\.ts$/, reason: "TypeScript declarations — include only if shipping types" },
  { pattern: /\.md$/, reason: "Markdown file", warnAtKB: 20 },
  { pattern: /\.ts$/, reason: "TypeScript source — consider publishing compiled JS only" },
  { pattern: /\.(png|jpg|jpeg|gif|svg|ico)$/, reason: "Image asset" },
  { pattern: /\.(mp4|mp3|wav|ogg|flac)$/, reason: "Media file — very large, consider CDN hosting" },
  { pattern: /\.wasm$/, reason: "WebAssembly binary" },
  { pattern: /(?:^|[\\/])(?:CHANGELOG|HISTORY|CHANGES)(?:\.md)?$/i, reason: "Changelog file", warnAtKB: 50 },
  { pattern: /(?:^|[\\/])\.eslintrc/, reason: "ESLint config — dev dependency" },
  { pattern: /(?:^|[\\/])\.prettierrc/, reason: "Prettier config — dev dependency" },
  { pattern: /(?:^|[\\/])tsconfig\.json$/, reason: "TypeScript config — dev dependency" },
  { pattern: /(?:^|[\\/])jest\.config/, reason: "Jest config — dev dependency" },
  { pattern: /(?:^|[\\/])\.github[\\/]/, reason: "GitHub workflows — dev files" },
  { pattern: /(?:^|[\\/])__tests__[\\/]/, reason: "Test directory" },
  { pattern: /(?:^|[\\/])test[\\/]/, reason: "Test directory" },
  { pattern: /(?:^|[\\/])tests[\\/]/, reason: "Test directory" },
  { pattern: /(?:^|[\\/])\.git[\\/]/, reason: "Git directory" },
  { pattern: /(?:^|[\\/])node_modules[\\/]/, reason: "node_modules — should never be published" },
  { pattern: /(?:^|[\\/])\.DS_Store$/, reason: "macOS junk file" },
  { pattern: /(?:^|[\\/])Thumbs\.db$/, reason: "Windows junk file" },
  { pattern: /\.bak$/, reason: "Backup file" },
  { pattern: /\.orig$/, reason: "Merge conflict artifact" },
];

const SIZE_THRESHOLDS = {
  file: { warn: 50, error: 200 },       // KB per file
  total: { warn: 500, error: 5000 },     // KB total
  gzip: { warn: 200, error: 2000 },      // KB gzipped
};

function matchesPattern(filePath, pattern) {
  const regex = new RegExp(pattern.source, pattern.flags);
  return regex.test(filePath);
}

function getFilesForPublish(pkgDir) {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    return { error: "No package.json found in " + pkgDir };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  const files = pkg.files;
  const mainFile = pkg.main;
  const bin = pkg.bin;

  // Use npm pack logic: read .npmignore or files field
  let result = [];

  function walkDir(dir, relPath) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const entryRelPath = relPath ? relPath + "/" + entry.name : entry.name;

      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.name === "package.json" || entry.name === "package-lock.json") {
        result.push({ path: entryRelPath, fullPath, size: fs.statSync(fullPath).size });
        continue;
      }

      if (entry.isDirectory()) {
        walkDir(fullPath, entryRelPath);
      } else {
        const stat = fs.statSync(fullPath);
        result.push({ path: entryRelPath, fullPath, size: stat.size });
      }
    }
  }

  // If "files" field exists, only include those
  if (files && Array.isArray(files)) {
    for (const pattern of files) {
      const fullPatternPath = path.join(pkgDir, pattern);
      if (fs.existsSync(fullPatternPath)) {
        const stat = fs.statSync(fullPatternPath);
        if (stat.isDirectory()) {
          walkDir(fullPatternPath, pattern);
        } else {
          result.push({ path: pattern, fullPath: fullPatternPath, size: stat.size });
        }
      }
    }
    // Always include package.json
    result.push({ path: "package.json", fullPath: pkgJsonPath, size: fs.statSync(pkgJsonPath).size });
    // Deduplicate
    const seen = new Set();
    result = result.filter(f => {
      if (seen.has(f.path)) return false;
      seen.add(f.path);
      return true;
    });
  } else {
    // Walk everything (except node_modules, .git)
    walkDir(pkgDir, "");

    // Apply .npmignore if it exists
    const npmIgnorePath = path.join(pkgDir, ".npmignore");
    if (fs.existsSync(npmIgnorePath)) {
      const ignorePatterns = fs.readFileSync(npmIgnorePath, "utf-8")
        .split("\n")
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("#"));
      result = result.filter(f => {
        for (const ig of ignorePatterns) {
          if (f.path === ig || f.path.startsWith(ig + "/") || f.path.startsWith(ig)) {
            return false;
          }
        }
        return true;
      });
    }
  }

  return { files: result, pkg };
}

function analyzeFile(fileEntry) {
  const issues = [];
  const relPath = fileEntry.path;
  const sizeKB = fileEntry.size / 1024;

  for (const bp of BLOAT_PATTERNS) {
    const regex = new RegExp(bp.pattern);
    if (regex.test(relPath) || regex.test("/" + relPath)) {
      const warnAt = bp.warnAtKB || SIZE_THRESHOLDS.file.warn;
      if (sizeKB > warnAt * 0.5) {  // Flag bloat patterns at half the warning size
        issues.push({
          type: "bloat",
          pattern: bp.pattern,
          reason: bp.reason,
          sizeKB: Math.round(sizeKB * 100) / 100,
        });
      }
    }
  }

  // Check individual file size
  if (sizeKB > SIZE_THRESHOLDS.file.error) {
    issues.push({
      type: "size-error",
      reason: `File is ${Math.round(sizeKB)}KB — very large for a published package`,
      sizeKB: Math.round(sizeKB * 100) / 100,
    });
  } else if (sizeKB > SIZE_THRESHOLDS.file.warn) {
    issues.push({
      type: "size-warn",
      reason: `File is ${Math.round(sizeKB)}KB — consider if this needs to be published`,
      sizeKB: Math.round(sizeKB * 100) / 100,
    });
  }

  return issues;
}

function estimateGzipSize(files) {
  let totalRaw = 0;
  let totalGzip = 0;

  for (const f of files) {
    try {
      const content = fs.readFileSync(f.fullPath);
      const gzipped = zlib.gzipSync(content);
      totalRaw += content.length;
      totalGzip += gzipped.length;
    } catch {
      // Binary or unreadable, estimate gzip as 85% of raw
      totalRaw += f.size;
      totalGzip += Math.round(f.size * 0.85);
    }
  }

  return { totalRaw, totalGzip };
}

function analyze(pkgDir) {
  pkgDir = path.resolve(pkgDir || ".");

  const { files, pkg, error } = getFilesForPublish(pkgDir);
  if (error) return { error };

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const totalKB = totalBytes / 1024;
  const { totalRaw, totalGzip } = estimateGzipSize(files);
  const gzipKB = totalGzip / 1024;

  const fileAnalysis = files.map(f => ({
    path: f.path,
    sizeKB: Math.round((f.size / 1024) * 100) / 100,
    issues: analyzeFile(f),
  }));

  // Sort by size descending
  fileAnalysis.sort((a, b) => b.sizeKB - a.sizeKB);

  const allIssues = fileAnalysis.filter(f => f.issues.length > 0);

  // Summary
  const summary = {
    name: pkg.name,
    version: pkg.version,
    fileCount: files.length,
    totalSizeKB: Math.round(totalKB * 100) / 100,
    gzipSizeKB: Math.round(gzipKB * 100) / 100,
    totalSizeHuman: formatSize(totalBytes),
    gzipSizeHuman: formatSize(totalGzip),
  };

  // Verdict
  let verdict = "lean";
  const criticalIssues = allIssues.filter(f => f.issues.some(i => i.type === "size-error" || (i.type === "bloat" && i.sizeKB > 100)));
  const warnings = allIssues.filter(f => f.issues.some(i => i.type === "size-warn" || i.type === "bloat"));

  if (totalKB > SIZE_THRESHOLDS.total.error || criticalIssues.length > 3) {
    verdict = "bloated";
  } else if (totalKB > SIZE_THRESHOLDS.total.warn || warnings.length > 5) {
    verdict = "chubby";
  }

  return { summary, topFiles: fileAnalysis.slice(0, 20), allIssues, verdict };
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatReport(result) {
  if (result.error) return "Error: " + result.error;

  const { summary, topFiles, allIssues, verdict } = result;
  const lines = [];

  const verdictEmoji = { lean: "🟢", chubby: "🟡", bloated: "🔴" };
  lines.push(`${verdictEmoji[verdict] || "⚪"} ${summary.name}@${summary.version} — ${verdict.toUpperCase()}`);
  lines.push(`   ${summary.fileCount} files | ${summary.totalSizeHuman} raw | ${summary.gzipSizeHuman} gzipped`);
  lines.push("");

  if (allIssues.length > 0) {
    lines.push("⚠️  Issues found:");
    for (const f of allIssues.slice(0, 15)) {
      for (const issue of f.issues) {
        lines.push(`   ${f.path} (${issue.sizeKB}KB) — ${issue.reason}`);
      }
    }
    if (allIssues.length > 15) {
      lines.push(`   ... and ${allIssues.length - 15} more`);
    }
    lines.push("");
  }

  lines.push("📦 Top files by size:");
  for (const f of topFiles.slice(0, 10)) {
    const bar = "█".repeat(Math.max(1, Math.min(30, Math.round(f.sizeKB / (summary.totalSizeKB / 30)))));
    lines.push(`   ${bar} ${f.sizeKB}KB — ${f.path}`);
  }

  lines.push("");

  if (verdict === "bloated") {
    lines.push("💡 Tips to reduce size:");
    lines.push("   • Add a \"files\" field to package.json to whitelist what gets published");
    lines.push("   • Create .npmignore to exclude test files, configs, and docs");
    lines.push("   • Consider moving large assets to a CDN");
    lines.push("   • Run 'npm pack --dry-run' to preview what would be published");
  } else if (verdict === "chubby") {
    lines.push("💡 Consider using .npmignore or \"files\" field to trim unnecessary files");
  } else {
    lines.push("✨ Package looks lean — good to publish!");
  }

  return lines.join("\n");
}

module.exports = { analyze, formatReport, BLOAT_PATTERNS, SIZE_THRESHOLDS };
