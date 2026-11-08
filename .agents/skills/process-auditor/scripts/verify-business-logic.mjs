#!/usr/bin/env node

/**
 * Universal Multi-Industry Business Logic & Audit Scanner
 * Evaluates business workflows, state machines, and data integrity across:
 * - ERP, Banking, HMS, Hospitality, Logistics, Manufacturing, Retail, Construction, Catering, Tax-Print
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.sql', '.prisma', '.go', '.rs', '.html'
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.cache'
]);

const SENSITIVE_TABLES = [
  'invoices', 'bills', 'orders', 'transactions', 'journal_entries', 'vouchers',
  'patients', 'prescriptions', 'clinical_notes',
  'reservations', 'folios', 'rooms',
  'consignments', 'manifests', 'bills_of_lading',
  'work_orders', 'bom', 'production_runs',
  'shifts', 'z_reports', 'cash_drawers',
  'contracts', 'boq_items', 'variation_orders',
  'events', 'beo_records'
];

const TERMINAL_STATUSES = [
  'PAID', 'DISCHARGED', 'CHECKED_OUT', 'DELIVERED', 'COMPLETED', 'CLOSED', 'SETTLED'
];

export function scanCodebase(targetDir, selectedIndustry = 'all') {
  const issues = [];

  function checkFile(filePath) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    const relPath = path.relative(targetDir, filePath);
    const lines = content.split('\n');
    const ext = path.extname(filePath).toLowerCase();

    // Industry tag deduction
    let inferredIndustry = 'universal';
    if (relPath.includes('erp')) inferredIndustry = 'erp';
    else if (relPath.includes('banking')) inferredIndustry = 'banking';
    else if (relPath.includes('hms')) inferredIndustry = 'hms';
    else if (relPath.includes('hospitality')) inferredIndustry = 'hospitality';
    else if (relPath.includes('logistics')) inferredIndustry = 'logistics';
    else if (relPath.includes('manufacturing')) inferredIndustry = 'manufacturing';
    else if (relPath.includes('retail')) inferredIndustry = 'retail';
    else if (relPath.includes('construction')) inferredIndustry = 'construction';
    else if (relPath.includes('catering')) inferredIndustry = 'catering';
    else if (relPath.includes('tax-print')) inferredIndustry = 'tax-print';

    if (selectedIndustry !== 'all' && inferredIndustry !== 'universal' && inferredIndustry !== selectedIndustry) {
      return;
    }

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;

      // 1. Float in Currency / Tariffs / Quantities
      const moneyFloatRegex = /(price|amount|total|cost|tax|subtotal|balance|salary|deposit|fare|retainage|margin)\s*[:=]\s*(float|double|number|types\.Float|Float\(\))/i;
      const sqlFloatMoneyRegex = /(price|amount|total|cost|tax|subtotal|balance|deposit|fare|retainage)\s+(FLOAT|REAL|DOUBLE)/i;
      if (moneyFloatRegex.test(line) || sqlFloatMoneyRegex.test(line)) {
        issues.push({
          severity: 'CRITICAL',
          category: 'Precision / Monetary Loss',
          industry: inferredIndustry,
          file: relPath,
          line: lineNum,
          message: 'Floating-point type used for monetary or price calculation. Use Decimal(18, 4), BigInt, or minor integer units (cents/paise).'
        });
      }

      // 2. Direct Hard Deletion on Sensitive Tables
      const tablePattern = SENSITIVE_TABLES.join('|');
      const hardDeleteRegex = new RegExp(`DELETE\\s+FROM\\s+(${tablePattern})`, 'i');
      const ormHardDeleteRegex = new RegExp(`\\.(destroy|delete)\\s*\\(\\s*\\{.*(${tablePattern})`, 'i');
      if (hardDeleteRegex.test(line) || ormHardDeleteRegex.test(line)) {
        issues.push({
          severity: 'CRITICAL',
          category: 'Statutory Audit Trail Violation',
          industry: inferredIndustry,
          file: relPath,
          line: lineNum,
          message: 'Hard deletion detected on transactional/audit entity. Business & tax audit regulations mandate append-only or soft-delete (status = VOIDED / CANCELLED).'
        });
      }

      // 3. Unguarded State Jumps to Terminal Status
      const statusPattern = TERMINAL_STATUSES.join('|');
      const directStateJumpRegex = new RegExp(`\\.(status|state)\\s*=\\s*['"](${statusPattern})['"]`, 'i');
      if (directStateJumpRegex.test(line)) {
        // Look back up to 20 lines to see if status was validated by a preceding guard
        const startLookback = Math.max(0, idx - 20);
        const precedingLines = lines.slice(startLookback, idx).join('\n');
        const hasGuard = /(if|switch|case|assert|guard|require).*(status|state)/i.test(precedingLines) ||
                         /(\.status|\.state)\s*(!==|===|!=|==)/.test(precedingLines) ||
                         line.includes('if') || line.includes('?');
        if (!hasGuard) {
          issues.push({
            severity: 'HIGH',
            category: 'State Machine Bypass',
            industry: inferredIndustry,
            file: relPath,
            line: lineNum,
            message: `Direct terminal status assignment to ${line.trim()} without preceding state guard.`
          });
        }
      }

      // 4. Random / Non-Sequential Invoice Numbering
      const randomInvoiceRegex = /(invoice|bill|receipt|consignment|voucher)[_]?num(ber)?\s*=\s*(Math\.random|uuid|crypto\.randomUUID)/i;
      if (randomInvoiceRegex.test(line)) {
        issues.push({
          severity: 'HIGH',
          category: 'Tax & Audit Numbering Non-Compliance',
          industry: inferredIndustry,
          file: relPath,
          line: lineNum,
          message: 'Random/UUID invoice or voucher number detected. Commercial tax and audit compliance requires strictly increasing gapless sequential numbering per fiscal period.'
        });
      }

      // 5. Unbounded Negative Balance or Stock Bypass
      const negativeBalanceRegex = /(allow_negative_stock|allow_negative_balance|bypass_credit_limit)\s*[:=]\s*true/i;
      if (negativeBalanceRegex.test(line)) {
        issues.push({
          severity: 'MEDIUM',
          category: 'Inventory / Financial Risk Exposure',
          industry: inferredIndustry,
          file: relPath,
          line: lineNum,
          message: 'Unrestricted negative balance or negative inventory enabled without explicit supervisor authorization or backorder policy.'
        });
      }

      // 6. Industry-specific heuristics
      if (inferredIndustry === 'banking') {
        if (/UPDATE\s+accounts\s+SET\s+balance\s*=\s*balance/i.test(line) && !line.includes('journal')) {
          issues.push({
            severity: 'CRITICAL',
            category: 'Single-Sided Ledger Mutation',
            industry: 'banking',
            file: relPath,
            line: lineNum,
            message: 'Single-sided account balance modification without paired double-entry journal entry.'
          });
        }
      }
    });

    // File-level HTML print template checks
    if (ext === '.html' && (inferredIndustry === 'tax-print' || relPath.includes('invoice') || relPath.includes('bill'))) {
      if (!content.includes('@media print') && (content.includes('invoice') || content.includes('receipt') || content.includes('bill'))) {
        issues.push({
          severity: 'HIGH',
          category: 'Missing Print Engine Styling',
          industry: inferredIndustry,
          file: relPath,
          line: 1,
          message: 'Commercial document template is missing @media print styling rules (A4 page setup, page-break protection, repeating thead).'
        });
      }
    }
  }

  function traverse(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SCAN_EXTENSIONS.has(ext)) {
          checkFile(fullPath);
        }
      }
    }
  }

  traverse(targetDir);
  return issues;
}

// CLI Execution Support
const currentFilePath = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath);

if (invokedDirectly) {
  let targetPath = process.cwd();
  let industryFilter = 'all';

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--industry=')) {
      industryFilter = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      targetPath = path.resolve(arg);
    }
  }

  console.log(`\n🔍 Scanning [${targetPath}] (Industry: ${industryFilter})...\n`);
  const foundIssues = scanCodebase(targetPath, industryFilter);

  if (foundIssues.length === 0) {
    console.log('✅ No high-severity business logic anti-patterns detected.');
    process.exit(0);
  }

  console.log(`⚠️  Found ${foundIssues.length} business logic & compliance issues:\n`);
  foundIssues.forEach((issue, idx) => {
    console.log(`[${idx + 1}] [${issue.severity}] [${issue.industry.toUpperCase()}] ${issue.category}`);
    console.log(`    Location: ${issue.file}:${issue.line}`);
    console.log(`    Issue:    ${issue.message}\n`);
  });

  process.exit(0);
}
