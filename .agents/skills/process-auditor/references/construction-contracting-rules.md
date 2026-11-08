# Construction, Contracting & Engineering Workflow Rules

This reference defines business logic, cost engineering, and progress billing invariants for civil contracting, construction, and engineering project management.

---

## 1. Project Lifecycle & Progress Billing Flow

```
[Tender & Estimation]
         │
         ▼
[Approved Bill of Quantities (BOQ) & Contract Awarded]
         │
         ▼
[Site Execution & Daily Site Diary / Work Logs]
         │
         ▼ (Periodic Milestone / End of Month)
[Joint Measurement & Quantity Survey Verification]
         │
         ▼ (Engineer / Architect Sign-Off)
[Interim Payment Certificate (IPC) Approved]
         │
         ├── Retention Money Deducted (e.g. 5% - 10%)
         ├── Mobilization Advance Recovered
         │
         ▼
[Progress Tax Invoice Issued]
         │
         ▼ (Substantial Completion & Snagging List Rectified)
[Practical Completion Certificate Issued]
         │
         ▼ (Defects Liability Period - e.g. 12 Months)
[Final Certificate & Retention Money Released]
```

---

## 2. Invariants & Financial Guardrails

1. **Bill of Quantities (BOQ) Over-Measurement Guard:**
   * Cumulative certified quantities billed across all IPCs cannot exceed the approved contract BOQ quantity without an approved **Variation Order / Change Order (VO)**:
     $$\sum_{i=1}^{n} \text{Quantity Billed}_i \le \text{Contract BOQ Quantity} + \sum \text{Approved Variation Quantities}$$
2. **Retention Money Custody:**
   * Contracts routinely mandate retaining a percentage (typically 5%–10%) of each progress billing until the expiry of the Defects Liability Period (DLP).
   * Retention deduction must be held in a dedicated liability ledger account, separated from trade accounts payable/receivable, and must not be marked as taxable turnover until final release conditions are met.
3. **Change Order (Variation Order) Authorization:**
   * Extra site works or material substitutions cannot be invoiced without:
     1. Formal Site Instruction (SI) / Change Order reference.
     2. Mutual rate agreement signed by Project Manager / Client Engineer.
4. **Percentage of Completion (ASC 606 / IFRS 15 Revenue Recognition):**
   * Revenue recognized to date must reflect actual cost incurred relative to total estimated contract costs:
     $$\text{POC} = \frac{\text{Total Cumulative Costs Incurred}}{\text{Estimated Total Project Cost}}$$
     Recognizing revenue prematurely before cost accumulation is a statutory accounting breach.
