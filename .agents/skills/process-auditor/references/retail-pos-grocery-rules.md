# Retail, Wholesale, POS & Grocery Workflow Rules

This reference outlines business logic and statutory requirements for point-of-sale (POS) systems, retail stores, wholesale distribution, and grocery supermarkets.

---

## 1. Cashier Shift & Register Balancing Lifecycle

```
[Cashier Shift Start]
         │
         ▼
[Declare Opening Cash Float (Opening Balance Verified)]
         │
         ▼
[Sales Operations (Barcode Scans, Weigh Scales, Discounts, Multi-Tender Payments)]
         │
         ├── Mid-Shift: X-Report (Non-clearing snapshot of current session totals)
         │
         ▼
[Cashier Shift Close]
         │
         ▼
[Blind Cash Count (Cashier enters physical currency counted without seeing expected totals)]
         │
         ▼
[Z-Report Generated (Clearing report, fiscal sequence incremented, variance computed)]
         │
         ├── Cash Over / Short Recorded
         └── Day End Book Closing
```

---

## 2. Invariants for Retail & Grocery POS

1. **Blind Count & Cash Drawer Float Discrepancy:**
   * Cashiers must perform a "blind count" when closing a shift. The POS must not reveal the expected system total to the cashier before they input actual counted cash, preventing concealment of shortages.
   * Cash variance:
     $$\text{Variance} = \text{Actual Cash Counted} - (\text{Opening Float} + \text{Cash Sales} + \text{Cash In} - \text{Cash Drops})$$
     Any difference must be logged to a Cash Over/Short ledger account.
2. **Fiscal Z-Report Immutability:**
   * Generating a Z-Report is a non-reversible fiscal event. It seals the register session, increments the sequential Z-counter, resets the running shift totals to zero, and exports the data to the central general ledger.
3. **Weight Scale & Perishables Integrity:**
   * Embedded barcode reading for weighed items (e.g. 24-prefix EAN-13 barcodes containing embedded weight or price) must validate check-digits.
   * Supermarket products must track expiration dates with strict FEFO (First Expired, First Out) inventory rotation alerts.
4. **Promotion & Discount Stacking Constraints:**
   * Rules engines must strictly enforce whether promotions stack or if only the highest discount applies.
   * Discount cannot exceed line-item gross price or push total transaction value below cost without manager override.
5. **Offline Mode & Sync Conflict Resolution:**
   * If the POS operates in offline mode during network disruption:
     * Transactions must be signed locally with cryptographic sequence chaining.
     * On reconnection, offline sales must be queued and reconciled chronologically without overwriting central inventory counters erroneously.
