# Manufacturing & Engineering Workflow Rules

This reference outlines production, assembly, process manufacturing, quality control (QA/QC), and job costing invariants.

---

## 1. Production Lifecycle & Job Costing

```
[Sales Demand / Forecast / Reorder Point]
         │
         ▼
[Material Requirements Planning (MRP Run)]
         │
         ▼
[Production Work Order (WO) Created]
         │
         ├──► Bill of Materials (BOM) Exploded & Raw Materials Reserved
         │
         ▼ (Warehouse Issues Materials to Shop Floor)
[Material Issue Slip (Raw Material Stock Decremented / WIP Incremented)]
         │
         ▼ (Operations & Machine Routing Stages)
[Shop Floor Execution (Labor Time + Machine Hours Tracked)]
         │
         ▼ (Quality Control Station)
[QA/QC Inspection]
         ├── Pass: Finished Goods (FG) Accepted
         └── Fail: Rework or Scrap with Reason Code
         │
         ▼
[Work Order Closed & Cost Settled]
         ├── Raw Material Cost + Direct Labor + Machine Overhead = Finished Good Unit Cost
         └── Finished Goods Moved to Commercial Warehouse
```

---

## 2. Manufacturing Invariants & Guardrails

1. **Bill of Materials (BOM) Immutability in Active Runs:**
   * A multi-level BOM version must be locked when a Work Order is released to the shop floor. Mid-production BOM engineering changes (ECO) must generate a new revision or require authorized deviations.
2. **Work-In-Progress (WIP) Accounting Balance:**
   * Material issued to production must be transferred from Raw Materials Account to WIP Inventory Account:
     $$\text{WIP Balance} = \sum \text{Raw Materials Issued} + \sum \text{Direct Labor} + \sum \text{Factory Overhead} - \sum \text{Finished Goods Cost} - \sum \text{Approved Scrap}$$
   * Finished goods cannot be received into saleable inventory at an arbitrary valuation; unit cost must reconcile with actual or standard absorbed costs.
3. **Scrap & Yield Variance Reporting:**
   * Production yield $\frac{\text{Actual Finished Goods}}{\text{Expected Output}}$ below the approved engineering tolerance must trigger a scrap variance report and supervisor review before closing the work order.

---

## 3. Quality Assurance (QA/QC) Gate:
1. **Quarantine State Enforcement:**
   * Finished products or inbound raw materials subject to mandatory inspection must be placed in a `QUARANTINE` bin status and blocked from customer order picking or production dispatch until the QC inspector inputs test readings and electronically signs `APPROVED`.
2. **Calibration & Batch Traceability:**
   * Serialized and batch-tracked components must retain full upstream (supplier lot) and downstream (customer delivery) traceability in case of a product recall.
