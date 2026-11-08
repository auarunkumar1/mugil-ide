# Hospitality & Hotel Management (PMS) Workflow Rules

This reference outlines the business processes, state machines, and billing invariants for property management systems (PMS), hotels, resorts, and vacation rentals.

---

## 1. Guest Lifecycle & Room State Machine

```
[Inquiry / Direct / OTA Booking]
         │
         ▼
[Reservation Confirmed (Advance Deposit Captured)]
         │
         ▼ (Day of Arrival)
[Guest Check-In (KYC / Passport & Credit Card Pre-Auth)]
         │
         ├──► Room Status: DIRTY/INSPECTED ──► OCCUPIED
         │
         ├──► Incremental Folio Postings (Room Charges, Minibar, Restaurant, Spa)
         │
         ▼ (Day of Departure)
[Guest Check-Out & Folio Settlement]
         │
         ├──► Balance Must Equal Zero
         ├──► Room Status: OCCUPIED ──► VACANT DIRTY
         └──► Housekeeping Workflow Dispatched
```

### Room State Transition Invariants:
1. **Cleanliness Verification Before Check-In:**
   * A guest cannot be checked into a room with status `DIRTY` or `OUT_OF_ORDER`. The room must transition through:
     $$\text{VACANT DIRTY} \to \text{CLEAN} \to \text{INSPECTED (Supervisor Approved)} \to \text{OCCUPIED}$$
2. **Double Booking Prevention:**
   * Room assignment dates cannot overlap:
     $$\max(\text{CheckIn}_A, \text{CheckIn}_B) < \min(\text{CheckOut}_A, \text{CheckOut}_B)$$
   * Overbooking is strictly prohibited at the room-inventory level unless managed by explicit overbooking allowance rules on room categories.

---

## 2. Folio Billing & Night Audit Rollover

1. **Daily Night Audit Process:**
   * The PMS must enforce a daily **Night Audit** rollover routine that:
     * Posts daily room charges and city/tourist taxes to occupied folios automatically.
     * Reconciles front desk cash, card, and POS terminals for the business day.
     * Rolls the active financial business date forward ($T \to T+1$).
     * Locks the previous business day against retroactive charge insertion.
2. **Guest Folio Multi-Split:**
   * Folios must support splitting charges (e.g. Room rent billed to Corporate Account, Extras/Minibar billed to Guest Personal Credit Card).
   * Total balance across all split folios must be verified prior to key return and check-out confirmation.
3. **Advance Deposits & Incidental Holds:**
   * Pre-authorizations on credit cards must not be recorded as finalized revenue; they remain earmarked holds until converted to settled charges at check-out or released.

---

## 3. Statutory Hotel Documents & Compliance

1. **Police Registration / Foreigner Registration (Form C):**
   * Foreign guests must have passport number, visa details, and nationality recorded before room check-in is complete.
2. **Guest Folio Printout Standards:**
   * Standard folio printout must display:
     * Room Number, Guest Name, Arrival & Departure timestamps.
     * Itemized daily charges with date stamps, voucher references, and statutory taxes (Luxury tax, City tax, VAT/GST).
     * Advance payment receipt reference and net balance.
