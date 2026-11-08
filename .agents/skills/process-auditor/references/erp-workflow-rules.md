# ERP Workflow Rules & State Machine Invariants

This reference defines the strict business rules, state machines, and audit requirements for enterprise resource planning (ERP) workflows.

---

## 1. Procure-to-Pay (P2P) Lifecycle

The procurement flow must enforce strict sequential stages and 3-way matching:

```
[Purchase Requisition (PR)]
         │
         ▼ (Approved by Dept Head)
[Purchase Order (PO)]
         │
         ├──► [Goods Receipt Note (GRN) / Material Inward] ──► [Inventory / Stock In]
         │
         ▼ (Vendor submits bill)
[Vendor Bill / Invoice]
         │
         ▼ (3-Way Match: PO vs. GRN vs. Bill)
[Bill Approved for Payment]
         │
         ▼ (Payment Voucher & Bank Reconciled)
[Payment Executed]
```

### Invariants & Failure Conditions:
1. **No Bill without PO/Contract**: Direct vendor bills without PO references must be flagged unless routed through explicit "Direct Expense / Petty Cash" ledger accounts with authorized approval.
2. **3-Way Matching**:
   * **Quantity Match**: Invoiced quantity $\le$ Received quantity in GRN.
   * **Price Match**: Invoiced unit price must match approved PO unit price (within configurable variance tolerance, e.g. $\pm 0.5\%$).
   * **Item Match**: SKU codes, units of measurement (UoM), and tax rate codes must match.
3. **Goods Inward Verification**:
   * Inventory balances can only increment upon signed/verified GRN or Quality Inspection pass, never upon PO placement.
4. **Payment Voucher Immutability**:
   * A paid voucher cannot be deleted or reversed directly; an approved Credit Note or Reversal Debit Voucher with an explicit reason code must be issued.

---

## 2. Order-to-Cash (O2C) Lifecycle

The sales cycle must ensure inventory integrity, revenue recognition standards, and tax compliance:

```
[Customer Inquiry / Lead]
         │
         ▼
[Quotation / Estimate]
         │
         ▼ (Customer Acceptance)
[Sales Order (SO)]
         │
         ├──► [Inventory Allocation / Reserve Stock]
         │
         ▼ (Warehouse Picking & Packing)
[Delivery Challan / Dispatch Note] ──► [Inventory Stock Deducted]
         │
         ▼ (Revenue Recognition / Tax Point)
[Tax Invoice Issued]
         │
         ▼ (Accounts Receivable)
[Customer Payment Received]
         │
         ▼
[Bank Reconciliation]
```

### Invariants & Failure Conditions:
1. **Negative Stock Prevention**: An order cannot be dispatched if physically available stock is insufficient, unless the product is specifically flagged as "Allow Backorders" or "Service / Non-Stock".
2. **Tax Point Timing**: A Tax Invoice must be triggered either on dispatch of goods or receipt of payment (whichever is earlier, according to jurisdictional tax rules).
3. **Price Overrides**: Price discounts exceeding sales rep limits must enforce Maker-Checker authorization prior to order confirmation.
4. **Credit Limit Checks**: Customer credit limit and overdue invoice aging must be checked before confirming a Sales Order.

---

## 3. Inventory & Costing Invariants

1. **Valuation Method Consistency**: Cost of Goods Sold (COGS) and closing inventory must strictly use FIFO, Weighted Average Cost (WAC), or Standard Costing. Mixed methods on the same SKU category are forbidden.
2. **Batch / Lot & Expiry Tracking**:
   * Perishable and medical goods must track Lot/Batch numbers and Expiration Dates.
   * System must prevent allocation of expired batches to outbound delivery orders (FEFO - First Expired, First Out).
3. **Write-offs & Adjustments**:
   * Inventory adjustments, scrap, and shrinkage must require manager approval and credit/debit explicit shrinkage expense ledger accounts.

---

## 4. General Ledger (GL) & Financial Accounting Rules

1. **Double-Entry Balance**: Every journal entry must have $\sum \text{Debits} = \sum \text{Credits}$. Unbalanced entries must be rejected at the database constraint level.
2. **Closed Accounting Periods**:
   * Transactions dated in closed fiscal years/months cannot be created, modified, or backdated without administrative period unlocking and an explicit audit stamp.
3. **Currency & Precision**:
   * Store all currency amounts in integer minor units (e.g. cents) or high-precision fixed point `DECIMAL(18, 4)`. Floating point types (`FLOAT`, `DOUBLE`) are strictly disallowed.
   * Multi-currency transactions must store: Source Currency Amount, Target Currency Amount, Exchange Rate, and Exchange Rate Date.
