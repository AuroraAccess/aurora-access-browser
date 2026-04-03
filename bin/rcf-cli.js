#!/usr/bin/env node

/**
 * NOTICE: This file is protected under RCF-PL v1.2.8
 * [RCF:RESTRICTED]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = "1.2.8";
const NOTICE_HEADER = "NOTICE: This file is protected under RCF-PL v1.2.8";

const HELP_TEXT = `
RCF Protocol — Node.js CLI & SDK
The official Command Line Interface for RCF-PL v${VERSION}

Usage:
  rcf-cli <command> [options]

Commands:
  init             Initialize RCF in the current directory (creates NOTICE.md, .rcfignore)
  scan <path>      Scan project for RCF compliance and extract markers
  audit <path>     Generate a cryptographically signed compliance report (rcf-audit.json)
  verify <path>    Compare current file hashes against the latest audit report
  version          Show version information

Example:
  node bin/rcf-cli.js scan .
`;

// Default ignore list
const DEFAULT_IGNORE = [
  'node_modules',
  'dist',
  'release',
  '.git',
  '.DS_Store',
  'rcf-audit.json',
  '.env'
];

/**
 * Utility to walk directory recursively
 */
function walk(dir, ignoreList) {
  let results = [];
  const list = fs.readdirSync(dir);
  
  list.forEach(file => {
    if (ignoreList.includes(file)) return;
    
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(filePath, ignoreList));
    } else {
      results.push(filePath);
    }
  });
  return results;
}

/**
 * COMMAND: init
 */
function init() {
  console.log("Initializing RCF Project...");
  
  const noticeMd = `# RCF Protection Notice
This project is protected under Restricted Correlation Framework Protocol (RCF-PL) v${VERSION}.

Author: Aladdin Aliyev
Project: Aurora Access Browser

Usage of this repository's protected logic without explicit permission is strictly prohibited.
`;
  
  const rcfIgnore = DEFAULT_IGNORE.join('\n');
  
  fs.writeFileSync('NOTICE.md', noticeMd);
  fs.writeFileSync('.rcfignore', rcfIgnore);
  
  console.log("✅ Created NOTICE.md");
  console.log("✅ Created .rcfignore");
  console.log("\nProject is now RCF-Ready.");
}

/**
 * COMMAND: scan
 */
function scan(targetPath) {
  if (!fs.existsSync(targetPath)) {
    console.error(`Error: Path ${targetPath} does not exist.`);
    process.exit(1);
  }

  const ignoreList = fs.existsSync('.rcfignore') 
    ? fs.readFileSync('.rcfignore', 'utf8').split('\n').filter(Boolean)
    : DEFAULT_IGNORE;

  const files = walk(targetPath, ignoreList);
  let totalFiles = 0;
  let protectedFiles = 0;
  let issues = 0;

  console.log(`\nScanning RCF Protocol in: ${path.resolve(targetPath)}`);
  console.log("--------------------------------------------------");

  files.forEach(file => {
    if (!file.match(/\.(js|jsx|ts|tsx|html|css|py)$/)) return;
    totalFiles++;
    
    const content = fs.readFileSync(file, 'utf8');
    const hasHeader = content.includes(NOTICE_HEADER);
    const markers = content.match(/\[RCF:[A-Z]+\]/g) || [];
    
    if (hasHeader || markers.length > 0) {
      protectedFiles++;
      const markerStr = markers.length > 0 ? `(${markers.join(', ')})` : '';
      console.log(`[PROTECTED] ${file} ${markerStr}`);
    } else {
      // console.log(`[PUBLIC   ] ${file}`);
    }
  });

  console.log("--------------------------------------------------");
  console.log(`Total Files Scanned: ${totalFiles}`);
  console.log(`RCF Protected Files: ${protectedFiles}`);
  console.log("Status: COMPLIANT");
}

/**
 * COMMAND: audit
 */
function audit(targetPath) {
  console.log(`\nGenerating RCF-Audit Report...`);
  
  const ignoreList = fs.existsSync('.rcfignore') 
    ? fs.readFileSync('.rcfignore', 'utf8').split('\n').filter(Boolean)
    : DEFAULT_IGNORE;

  const files = walk(targetPath, ignoreList);
  const report = {
    project: "Aurora Access Browser",
    timestamp: new Date().toISOString(),
    rcf_version: VERSION,
    audit_id: `RCF-AUDIT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    files: {}
  };

  files.forEach(file => {
    if (fs.statSync(file).isDirectory()) return;
    const content = fs.readFileSync(file);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const relativePath = path.relative(targetPath, file);
    report.files[relativePath] = hash;
  });

  fs.writeFileSync('rcf-audit.json', JSON.stringify(report, null, 2));
  console.log(`✅ Audit complete: rcf-audit.json generated.`);
  console.log(`Signed ID: ${report.audit_id}`);
}

/**
 * COMMAND: verify
 */
function verify(targetPath) {
  if (!fs.existsSync('rcf-audit.json')) {
    console.error("Error: rcf-audit.json not found. Run 'audit' first.");
    process.exit(1);
  }

  const auditData = JSON.parse(fs.readFileSync('rcf-audit.json', 'utf8'));
  console.log(`\nVerifying Integrity against Audit: ${auditData.audit_id}`);
  console.log(`Audit Date: ${auditData.timestamp}`);
  console.log("--------------------------------------------------");

  let success = 0;
  let failures = 0;

  Object.entries(auditData.files).forEach(([relPath, storedHash]) => {
    const fullPath = path.join(targetPath, relPath);
    if (!fs.existsSync(fullPath)) {
      console.log(`[MISSING] ${relPath}`);
      failures++;
      return;
    }

    const content = fs.readFileSync(fullPath);
    const currentHash = crypto.createHash('sha256').update(content).digest('hex');

    if (currentHash === storedHash) {
      success++;
    } else {
      console.log(`[TAMPERED] ${relPath}`);
      failures++;
    }
  });

  console.log("--------------------------------------------------");
  if (failures === 0) {
    console.log(`✅ Integrity Verified: ${success} files match.`);
    console.log("Status: SECURE");
  } else {
    console.log(`❌ Integrity Failure: ${failures} issues found.`);
    console.log("Status: COMPROMISED");
    process.exit(1);
  }
}

// Main Execution
const args = process.argv.slice(2);
const command = args[0];
const target = args[1] || '.';

switch (command) {
  case 'init':
    init();
    break;
  case 'scan':
    scan(target);
    break;
  case 'audit':
    audit(target);
    break;
  case 'verify':
    verify(target);
    break;
  case 'version':
    console.log(`RCF-CLI v${VERSION} (Aurora Native)`);
    break;
  default:
    console.log(HELP_TEXT);
}
