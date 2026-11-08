---
name: process-auditor
description: >-
  Audits and verifies business logic workflows, state machine integrity, and audit-ready document formats
  in ERP, Hospital Management (HMS), Banking & FinTech, Hospitality & Hotels, Logistics & Transport,
  Manufacturing & Engineering, Retail POS & Grocery, Construction & Contracting, and Events & Catering.
  Use when developing, reviewing, or generating code that manages business transactions, state lifecycles,
  database constraints, UI interaction flows, and legally compliant, tax-audit-ready printouts.
---

# Universal Business Logic & Process Integrity Auditor

This skill guides the agent in rigorously evaluating operational workflows, state machines, accounting invariants, data integrity, and statutory tax/audit compliance across multiple business verticals.

---

## Supported Industry Verticals & Workflow Specifications

For detailed state machine diagrams, failure modes, and domain-specific rules, consult the reference guides:

| Industry Vertical | Core Workflows & Invariants | Reference Guide |
| :--- | :--- | :--- |
| **ERP & Supply Chain** | Procure-to-Pay (P2P), Order-to-Cash (O2C), 3-Way Matching, Negative Stock Guards | [ERP Workflow Rules](./references/erp-workflow-rules.md) |
| **Hospital & Clinic (HMS)** | Patient Intake, Doctor Sign-off, e-Prescriptions, Pharmacy Dispensing, Discharge Gate | [HMS Workflow Rules](./references/hms-workflow-rules.md) |
| **Banking & FinTech** | Double-Entry Equilibrium, Atomicity / Row-Locking, Overdrafts, WORM Audit Logs | [Banking & FinTech Rules](./references/banking-fintech-rules.md) |
| **Hospitality & Hotels** | Room Cleanliness State Machine, Overbooking Guards, Night Audit Rollover, Folio Splits | [Hospitality & Hotel Rules](./references/hospitality-hotel-rules.md) |
| **Logistics & Freight** | Consignment Notes (LR / BL), GVWR Payload Checks, Proof of Delivery (POD), Detention | [Logistics & Transport Rules](./references/logistics-transport-rules.md) |
| **Manufacturing & Engineering** | Bill of Materials (BOM) Locking, WIP Absorption Costing, QA/QC Quarantine Gate | [Manufacturing & Engineering Rules](./references/manufacturing-engineering-rules.md) |
| **Retail POS & Grocery** | Blind Cash Count, Fiscal Z-Report, Scale Barcodes, FEFO Expiry, Offline Sync | [Retail & Grocery POS Rules](./references/retail-pos-grocery-rules.md) |
| **Construction & Contracting** | Bill of Quantities (BOQ) Over-Measurement, Retention Money, Variation Orders, POC | [Construction & Contracting Rules](./references/construction-contracting-rules.md) |
| **Events & Catering** | Headcount Lock (Attrition), Advance Booking Escrow, BEO Broadcasts, Per-Plate Costs | [Events & Catering Rules](./references/events-catering-rules.md) |
| **Universal Tax & Print** | Gapless Sequential Series, Multi-Tax Breakup (GST/VAT), `@media print` Layout Engine | [Tax Audit & Print Spec](./references/tax-audit-invoice-spec.md) |

---

## 1. Universal Business Invariants Checklist

Regardless of the industry vertical, the agent must enforce these universal invariants across the code:

### A. Financial & Decimal Precision
- **Strict Prohibition of Floating Points:** Never use `FLOAT`, `DOUBLE`, `REAL`, or JavaScript standard `number` without a decimal library for monetary figures, tariffs, unit prices, or inventory counts.
- **Accepted Types:** Use `DECIMAL(18, 4)` / `NUMERIC(15, 2)`, high-precision Decimal classes (`decimal.js`, Python `Decimal`, Java `BigDecimal`), or integer minor units (cents, paise).
- **Rounding Convention:** Round only at final line items and invoice summaries; never round intermediate multiplicative quantities.

### B. Append-Only Immutability & Audit Trails
- **Zero Hard Deletions:** Invoices, journal entries, bills of lading, medical encounters, and bank transactions must **never** be deleted using raw `DELETE FROM`.
- **Soft Deletions & Voids:** Use status updates (`CANCELLED`, `VOIDED`, `REVERSED`) with mandatory fields: `cancelled_by`, `cancelled_at`, and `cancellation_reason`.
- **Reversal via Contra-Entries:** Settled transactions can only be altered by issuing offsetting documents (Credit Notes, Reversal Vouchers, Addenda).

### C. State Machine Transition Guards
- **No State Jumping:** Validate that entities cannot skip lifecycle stages (e.g. an order cannot jump directly to `PAID` or a room to `OCCUPIED` without passing through mandatory prerequisite statuses).
- **Separation of Duties (Maker-Checker):** Critical operational thresholds (discounts $> 15\%$, credit limit overrides, change orders, quarantine overrides) must require a supervisor role different from the creator.

### D. Concurrency & Idempotency
- **Race Condition Prevention:** High-contention operations (stock decrement, room booking, seat reservations, bank debits) must use atomic transactions with row-level locks (`SELECT ... FOR UPDATE`) or optimistic version checks.
- **Idempotency Keys:** Payment and dispatch APIs must mandate an `Idempotency-Key` header with TTL tracking to prevent duplicate transactions on network retries.

---

## 2. Professional Printout & Tax Audit Readiness

When reviewing or generating document templates (Invoices, Folios, Consignment Notes, BEOs, Discharge Summaries):

1. **Gapless Sequential Numbering:** Must use strictly increasing, uninterrupted sequential numbers per financial period (e.g. `INV/2026-27/0001`). Random UUIDs or timestamps as external document numbers are forbidden.
2. **Statutory Tax Breakdown:** Line items must display HSN/SAC codes, taxable values, applicable tax rates, and component tax splits (e.g. CGST/SGST/IGST or Federal/State VAT).
3. **Totals in Words:** Grand totals must be converted to spelled-out currency text to prevent alteration tampering.
4. **Print CSS Standards (`@media print`):**
   - Clean A4 / Letter page setup: `@page { size: A4 portrait; margin: 12mm 15mm; }`.
   - Page break protection: `tr, .totals-table, .signature-block { page-break-inside: avoid; break-inside: avoid; }`.
   - Repeating table headers: `thead { display: table-header-group; }`.
   - Clean removal of on-screen UI buttons, navbars, and sidebars (`display: none !important`).

---

## 3. Automated Codebase Verification & Industry Testing

### Scan a Target Project or Directory
Run the multi-industry auditor script against any project or subfolder:

```bash
node .agents/skills/process-auditor/scripts/verify-business-logic.mjs [path-to-target] [--industry=<name>]
```

### Validate Skill Rules Across All Verticals
Run the comprehensive automated test suite across paired compliant/violating fixtures:

```bash
# Test all industry verticals
node .agents/skills/process-auditor/tests/test-industry-audits.mjs

# Or test a specific vertical individually
node .agents/skills/process-auditor/tests/test-industry-audits.mjs --industry=banking
node .agents/skills/process-auditor/tests/test-industry-audits.mjs --industry=erp
node .agents/skills/process-auditor/tests/test-industry-audits.mjs --industry=hms
node .agents/skills/process-auditor/tests/test-industry-audits.mjs --industry=hospitality
node .agents/skills/process-auditor/tests/test-industry-audits.mjs --industry=logistics
node .agents/skills/process-auditor/tests/test-industry-audits.mjs --industry=manufacturing
node .agents/skills/process-auditor/tests/test-industry-audits.mjs --industry=retail
node .agents/skills/process-auditor/tests/test-industry-audits.mjs --industry=construction
node .agents/skills/process-auditor/tests/test-industry-audits.mjs --industry=catering
node .agents/skills/process-auditor/tests/test-industry-audits.mjs --industry=tax-print
```

---

## 4. Audit Report Scorecard

When executing an audit, output findings using this structured scorecard:

```markdown
### 📋 Multi-Industry Business Logic & Compliance Report

#### 1. Executive Summary & Verdict
- **Industry Vertical:** [ERP | Banking | HMS | Hotel PMS | Logistics | Manufacturing | Retail | Construction | Catering]
- **State Machine Integrity:** [PASS | AT RISK | FAIL]
- **Financial & Data Precision:** [PASS | AT RISK | FAIL]
- **Print & Tax Audit Readiness:** [PASS | AT RISK | FAIL]

#### 2. Domain Workflow Violations
| Lifecycle Stage | Expected Business Guard | Observed Code Behavior | Severity |
| :--- | :--- | :--- | :--- |
| e.g. Stock Dispatch | Require approved Delivery Challan | Decrements on Quote creation | CRITICAL |
| e.g. Hotel Check-In | Room status must be INSPECTED | Allows check-in to DIRTY room | HIGH |

#### 3. Full-Stack Data & Schema Violations
- [List findings: Float currency, missing soft delete, race conditions, missing idempotency]

#### 4. Document & Print Compliance
- [List findings: Missing tax breakup, non-sequential numbering, print CSS breaking rows]

#### 5. Prioritized Remediation Plan
1. **[CRITICAL]** ...
2. **[HIGH]** ...
3. **[MEDIUM]** ...
```
