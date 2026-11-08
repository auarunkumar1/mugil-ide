#!/usr/bin/env node

/**
 * Industry-Specific Skill Audit & Validation Test Harness
 * Tests each industry vertical individually against paired fixtures:
 * 1. Compliant fixture -> Must pass with 0 issues
 * 2. Violating fixture -> Must fail with expected violation categories
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCodebase } from '../scripts/verify-business-logic.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const VERTICALS = [
  { id: 'erp', name: 'ERP & Supply Chain' },
  { id: 'banking', name: 'Banking & FinTech' },
  { id: 'hms', name: 'Hospital Management (HMS)' },
  { id: 'hospitality', name: 'Hospitality & Hotel PMS' },
  { id: 'logistics', name: 'Transport & Fleet Logistics' },
  { id: 'manufacturing', name: 'Manufacturing & Engineering' },
  { id: 'retail', name: 'Retail POS & Grocery' },
  { id: 'construction', name: 'Construction & Contracting' },
  { id: 'catering', name: 'Events & Catering' },
  { id: 'tax-print', name: 'Tax Audit & Print Formats' }
];

let targetIndustry = 'all';
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--industry=')) {
    targetIndustry = arg.split('=')[1].toLowerCase();
  }
}

const activeVerticals = targetIndustry === 'all'
  ? VERTICALS
  : VERTICALS.filter(v => v.id === targetIndustry);

if (activeVerticals.length === 0) {
  console.error(`❌ Unknown industry vertical: "${targetIndustry}". Valid options: ${VERTICALS.map(v => v.id).join(', ')}`);
  process.exit(1);
}

console.log(`\n======================================================================`);
console.log(`🧪 AUDITING PROCESS-AUDITOR INDUSTRY SKILLS (Total: ${activeVerticals.length})`);
console.log(`======================================================================\n`);

let passedCount = 0;
let failedCount = 0;
const resultsTable = [];

for (const vertical of activeVerticals) {
  const fixturePath = path.join(FIXTURES_DIR, vertical.id);

  // 1. Audit Compliant Fixture
  const compliantIssues = scanCodebase(fixturePath, vertical.id)
    .filter(i => i.file.includes('compliant'));

  // 2. Audit Violating Fixture
  const violatingIssues = scanCodebase(fixturePath, vertical.id)
    .filter(i => i.file.includes('violating'));

  const compliantPassed = compliantIssues.length === 0;
  const violatingCaught = violatingIssues.length > 0;
  const verticalSuccess = compliantPassed && violatingCaught;

  if (verticalSuccess) {
    passedCount++;
  } else {
    failedCount++;
  }

  resultsTable.push({
    Vertical: vertical.name,
    'Compliant Check': compliantPassed ? '✅ 0 False Positives' : `❌ ${compliantIssues.length} False Flags`,
    'Violation Check': violatingCaught ? `✅ ${violatingIssues.length} Caught` : '❌ Failed to Catch',
    Result: verticalSuccess ? 'PASSED' : 'FAILED'
  });
}

console.table(resultsTable);

console.log(`\n----------------------------------------------------------------------`);
console.log(`SUMMARY: ${passedCount} PASSED / ${failedCount} FAILED out of ${activeVerticals.length} Industry Verticals.`);
console.log(`----------------------------------------------------------------------\n`);

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log(`🎉 All industry-specific skills successfully validated!\n`);
  process.exit(0);
}
