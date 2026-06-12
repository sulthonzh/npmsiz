#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * npmsiz — Analyze what's bloating your npm package before publish.
 * Zero dependencies.
 */

const DEFAULT_IGNORE = ['.git', 'node_modules', '.DS_Store'];

/**
 * Format bytes into human-readable string.
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

/**
 * Recursively walk a directory, collecting file info.
 */
function walkDir(dir, options = {}) {
  const ignore = options.ignore || DEFAULT_IGNORE;
  const followLinks = options.followLinks || false;
  const files = [];

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue;
      // Ignore common patterns
      if (entry.name.endsWith('.map') && !options.includeSourceMaps) continue;

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() || (followLinks && entry.isSymbolicLink())) {
        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }
        files.push({
          path: fullPath,
          relativePath: path.relative(dir, fullPath),
          size: stat.size,
          extension: path.extname(entry.name).toLowerCase(),
        });
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Group files by extension and compute stats.
 */
function groupByExtension(files) {
  const groups = {};

  for (const file of files) {
    const ext = file.extension || '(no ext)';
    if (!groups[ext]) {
      groups[ext] = { extension: ext, files: [], totalSize: 0, count: 0 };
    }
    groups[ext].files.push(file);
    groups[ext].totalSize += file.size;
    groups[ext].count += 1;
  }

  return Object.values(groups).sort((a, b) => b.totalSize - a.totalSize);
}

/**
 * Group files by directory and compute stats.
 */
function groupByDirectory(files, baseDir) {
  const groups = {};

  for (const file of files) {
    const relDir = path.dirname(file.relativePath);
    const dir = relDir === '.' ? '(root)' : relDir;
    if (!groups[dir]) {
      groups[dir] = { directory: dir, files: [], totalSize: 0, count: 0 };
    }
    groups[dir].files.push(file);
    groups[dir].totalSize += file.size;
    groups[dir].count += 1;
  }

  return Object.values(groups).sort((a, b) => b.totalSize - a.totalSize);
}

/**
 * Find the largest files.
 */
function findLargest(files, limit = 10) {
  return [...files].sort((a, b) => b.size - a.size).slice(0, limit);
}

/**
 * Detect common bloat issues.
 */
function detectIssues(files, packageJson, totalSize) {
  const issues = [];
  const maxSize = 1024 * 100; // 100KB per file warning
  const totalWarn = 1024 * 1024; // 1MB total warning

  // Large files
  const largeFiles = files.filter(f => f.size > maxSize);
  for (const f of largeFiles) {
    issues.push({
      type: 'large_file',
      severity: f.size > 1024 * 500 ? 'error' : 'warning',
      message: `Large file: ${f.relativePath} (${formatBytes(f.size)})`,
      file: f.relativePath,
      size: f.size,
    });
  }

  // Total size check
  if (totalSize > totalWarn) {
    issues.push({
      type: 'total_size',
      severity: totalSize > 5 * 1024 * 1024 ? 'error' : 'warning',
      message: `Package total size is ${formatBytes(totalSize)}. Consider splitting or trimming.`,
      size: totalSize,
    });
  }

  // Non-JS assets that might not belong
  const mediaExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.mp4', '.mp3', '.wav', '.avi', '.mov', '.woff', '.woff2', '.ttf', '.eot'];
  const mediaFiles = files.filter(f => mediaExts.includes(f.extension));
  for (const f of mediaFiles) {
    issues.push({
      type: 'media_asset',
      severity: 'info',
      message: `Media/asset file: ${f.relativePath} (${formatBytes(f.size)}) — consider CDN hosting`,
      file: f.relativePath,
    });
  }

  // Test files in package
  const testPatterns = ['.test.', '.spec.', '__tests__', 'test/', 'tests/'];
  const testFiles = files.filter(f =>
    testPatterns.some(p => f.relativePath.includes(p))
  );
  if (testFiles.length > 0) {
    const testSize = testFiles.reduce((s, f) => s + f.size, 0);
    issues.push({
      type: 'test_files',
      severity: 'warning',
      message: `${testFiles.length} test file(s) found (${formatBytes(testSize)}) — add to .npmignore`,
      count: testFiles.length,
      size: testSize,
    });
  }

  // Documentation files
  const docFiles = files.filter(f =>
    f.relativePath.endsWith('.md') && f.relativePath !== 'README.md' && f.relativePath !== 'LICENSE'
  );
  if (docFiles.length > 5) {
    issues.push({
      type: 'docs_bloat',
      severity: 'info',
      message: `${docFiles.length} markdown files found — consider trimming docs from package`,
    });
  }

  // Missing package.json fields
  if (packageJson) {
    const required = ['name', 'version', 'description', 'license', 'repository'];
    const missing = required.filter(f => !packageJson[f]);
    if (missing.length > 0) {
      issues.push({
        type: 'missing_fields',
        severity: 'info',
        message: `package.json missing: ${missing.join(', ')}`,
      });
    }

    // Check for files field
    if (!packageJson.files) {
      issues.push({
        type: 'no_files_field',
        severity: 'info',
        message: 'No "files" field in package.json — npm will include everything except .npmignore entries',
      });
    }
  }

  // Duplicates by name pattern (e.g., .js and .min.js of same file)
  const jsFiles = files.filter(f => f.extension === '.js');
  const baseNames = {};
  for (const f of jsFiles) {
    const base = f.relativePath.replace(/\.min\.js$/, '.js').replace(/\.js$/, '');
    if (!baseNames[base]) baseNames[base] = [];
    baseNames[base].push(f);
  }
  for (const [base, group] of Object.entries(baseNames)) {
    if (group.length > 1) {
      issues.push({
        type: 'duplicate',
        severity: 'warning',
        message: `Possible duplicate: ${group.map(f => f.relativePath).join(', ')}`,
      });
    }
  }

  return issues.sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });
}

/**
 * Build a text bar chart for size breakdown.
 */
function buildBarChart(groups, totalSize, width = 30) {
  const lines = [];
  const maxNameLen = Math.max(...groups.map(g => {
    const name = g.extension || g.directory;
    return name.length;
  }));

  for (const group of groups.slice(0, 12)) {
    const name = (group.extension || group.directory).padEnd(maxNameLen + 1);
    const pct = totalSize > 0 ? group.totalSize / totalSize : 0;
    const barLen = Math.max(1, Math.round(pct * width));
    const bar = '█'.repeat(barLen) + '░'.repeat(width - barLen);
    const pctStr = (pct * 100).toFixed(1) + '%';
    lines.push(`  ${name} ${bar} ${pctStr}  (${formatBytes(group.totalSize)}, ${group.count} files)`);
  }
  return lines.join('\n');
}

/**
 * Main analysis function.
 */
function analyze(dir, options = {}) {
  dir = path.resolve(dir);

  if (!fs.existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  // Load package.json
  let packageJson = null;
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch {}
  }

  // If package.json has "files", analyze only those + package.json + README + LICENSE
  let files;
  if (packageJson && packageJson.files && packageJson.files.length > 0 && !options.full) {
    const includePatterns = [...packageJson.files, 'package.json', 'README.md', 'LICENSE', 'LICENSE.md'];
    const allFiles = walkDir(dir, options);
    files = allFiles.filter(f => {
      return includePatterns.some(pattern => {
        if (pattern.includes('*')) {
          // Simple glob: convert to regex
          const re = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
          return re.test(f.relativePath) || f.relativePath.startsWith(pattern.replace(/\/?\*$/, ''));
        }
        return f.relativePath === pattern || f.relativePath.startsWith(pattern + '/');
      });
    });
  } else {
    files = walkDir(dir, options);
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const byExtension = groupByExtension(files);
  const byDirectory = groupByDirectory(files);
  const largest = findLargest(files, options.top || 10);
  const issues = detectIssues(files, packageJson, totalSize);

  return {
    dir,
    packageJson,
    totalSize,
    fileCount: files.length,
    files,
    byExtension,
    byDirectory,
    largest,
    issues,
  };
}

/**
 * Format analysis result as readable report.
 */
function formatReport(result, options = {}) {
  const lines = [];
  const pkgName = result.packageJson
    ? `${result.packageJson.name}@${result.packageJson.version}`
    : path.basename(result.dir);

  lines.push(`📦 ${pkgName}`);
  lines.push(`   ${result.fileCount} files · ${formatBytes(result.totalSize)}`);
  lines.push('');

  // Extension breakdown
  if (result.byExtension.length > 0) {
    lines.push('By extension:');
    lines.push(buildBarChart(result.byExtension, result.totalSize));
    lines.push('');
  }

  // Top largest files
  if (result.largest.length > 0) {
    lines.push(`Top ${result.largest.length} largest files:`);
    for (const f of result.largest) {
      const pct = result.totalSize > 0 ? ((f.size / result.totalSize) * 100).toFixed(1) : '0.0';
      lines.push(`  ${formatBytes(f.size).padStart(10)}  ${pct.padStart(5)}%  ${f.relativePath}`);
    }
    lines.push('');
  }

  // Directory breakdown (if more than 1 dir)
  if (result.byDirectory.length > 1 && options.showDirs) {
    lines.push('By directory:');
    lines.push(buildBarChart(result.byDirectory, result.totalSize));
    lines.push('');
  }

  // Issues
  if (result.issues.length > 0) {
    const icons = { error: '❌', warning: '⚠️', info: '💡' };
    lines.push('Issues:');
    for (const issue of result.issues) {
      lines.push(`  ${icons[issue.severity] || '•'} ${issue.message}`);
    }
    lines.push('');
  }

  // Summary
  const errors = result.issues.filter(i => i.severity === 'error').length;
  const warnings = result.issues.filter(i => i.severity === 'warning').length;
  if (errors > 0) {
    lines.push(`⛔ ${errors} error(s), ${warnings} warning(s) — fix before publishing`);
  } else if (warnings > 0) {
    lines.push(`✅ Package looks publishable, ${warnings} warning(s) to consider`);
  } else {
    lines.push('✅ Clean package, ready to publish');
  }

  return lines.join('\n');
}

module.exports = { analyze, formatReport, formatBytes, walkDir, groupByExtension, groupByDirectory, findLargest, detectIssues };
