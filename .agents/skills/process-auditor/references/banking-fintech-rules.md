# Banking & FinTech Business Logic & Invariants

This reference defines financial, regulatory, and transaction processing invariants for core banking, digital wallets, payment gateways, and lending systems.

---

## 1. Core Banking & Ledger Invariants

```
[KYC / AML Verified Customer]
         │
         ▼
[Deposit / Transfer Initiation (Idempotency Key)]
         │
         ├──► [Risk & Fraud Engine Check]
         │
         ▼ (Atomic Database Transaction)
[Double-Entry General Ledger Post]
         ├── Debit Origin Account
         └── Credit Destination / Clearing Account
         │
         ▼
[Event Emitted & Immutable Audit Log Stamped]
         │
         ▼
[Statement / Transaction Receipt Generated]
```

### Invariants:
1. **Double-Entry Equilibrium:**
   * Every balance movement must consist of at least one debit and one credit where:
     $$\sum \text{Debits} = \sum \text{Credits}$$
   * Single-sided account balance mutations (`UPDATE accounts SET balance = balance - 100`) without a paired journal entry are strictly prohibited.
2. **Account Balances as Derived / Snapshot State:**
   * An account's true balance is the running sum of all cleared journal entries:
     $$\text{Balance} = \sum \text{Credits} - \sum \text{Debits}$$
   * Snapshot balances stored in account tables must be reconciled periodically against the immutable journal.
3. **Overdraft & Negative Balance Guards:**
   * Accounts must reject debit transactions that breach `(Balance + Approved Overdraft Limit < Debit Amount)` unless an explicit authorized lending facility is active.
4. **Currency Mismatch Prevention:**
   * Direct ledger transfers between accounts of different currency codes (e.g., USD to EUR) without an explicit FX conversion leg (Foreign Exchange clearing account + exchange rate timestamp) are invalid.

---

## 2. Payments & Transaction Processing

1. **Strict Idempotency:**
   * Every financial mutation endpoint must mandate a unique `Idempotency-Key` header with TTL tracking. Retried network calls must return the original settled result without re-executing debits.
2. **Atomic Locking & Race Condition Prevention:**
   * Fund reservations and transfers must execute within strict transactional boundaries with row-level locks (`SELECT ... FOR UPDATE` or optimistic version locking) to prevent "double spending" across concurrent threads or distributed nodes.
3. **Reversible Only via Offset Vouchers:**
   * Settled financial transactions can **never** be updated or deleted. Reversals must be executed as separate contra-entries (Chargeback, Refund, or Reversal Journal) referencing the original transaction ID.

---

## 3. Statutory & Compliance Standards

1. **KYC / AML Thresholds:**
   * Cash transactions exceeding statutory limits (e.g. \$10,000 / ₹10,00,000) must automatically generate a Suspicious Activity / Cash Transaction Report (CTR/STR) flag.
2. **Interest Accrual vs. Application:**
   * Interest calculations (e.g. daily accrual, monthly capitalization) must store formulas, intermediate daily accruals, and capitalization dates distinctly.
3. **Audit Trail Immutability (WORM):**
   * Financial audit logs must be append-only (Write Once, Read Many). Any attempt to modify `created_at`, transaction amounts, or user IDs must be rejected at the database trigger/constraint level.
