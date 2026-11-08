# Events Management & Catering Workflow Rules

This reference outlines business processes, deposit management, Banquet Event Orders (BEO), and catering service execution.

---

## 1. Event & Banquet Lifecycle

```
[Inquiry & Date Availability Check]
         │
         ▼
[Tentative Booking (Hold with Expiry Countdown)]
         │
         ▼ (Non-Refundable Deposit Received)
[Confirmed Booking & Signed Contract]
         │
         ▼ (T - 14 Days to T - 48 Hours)
[Banquet Event Order (BEO) / Function Sheet Finalized]
         │
         ├── Guaranteed Minimum Guest Count Locked
         ├── Menu, Dietary Restrictions & Per-Plate Pricing Agreed
         │
         ▼ (T - 24 Hours)
[Kitchen Production Sheet Dispatched & Perishable Sourcing]
         │
         ▼ (Event Day)
[Event Execution & Actual Headcount Tracking]
         │
         ▼
[Post-Event Reconciled Billing]
         │
         ├── Max(Guaranteed Headcount, Actual Headcount) × Per-Plate Price
         ├── Add Incidentals (Additional Hours, Corkage, Bar Tab, Damage)
         ├── Subtract Advance Deposits
         └── Net Balance Invoiced & Cleared
```

---

## 2. Invariants & Guardrails

1. **Guaranteed Headcount Lock (Attrition Protection):**
   * Contracts specify a cutoff date (e.g., 72 hours prior to the event) after which the customer's guaranteed guest count cannot be reduced.
   * Billing calculation must enforce:
     $$\text{Billable Headcount} = \max(\text{Contracted Guaranteed Headcount}, \text{Actual Headcount Checked In})$$
2. **Deposit & Escrow Accounting:**
   * Advance booking deposits must be held in a Customer Advance Deposit liability account, not booked as earned income until the event is executed.
   * Cancellation fees must strictly follow the sliding scale defined in the contract (e.g. 100% forfeiture if canceled $< 7$ days).
3. **Banquet Event Order (BEO) Distribution:**
   * Any change made to the BEO within 48 hours of an event (dietary allergies, room layout, VIP arrival times) must trigger a notification broadcast to Kitchen, Banqueting Floor, and Audio-Visual leads with explicit acknowledgment timestamps.
4. **Per-Plate Costing & Food Safety Traceability:**
   * Catering menus must store ingredient allergen declarations (Nuts, Gluten, Dairy, Shellfish) and cross-contamination alerts.
   * Food sample preservation logs (holding food samples for 48 hours post-event for municipal health inspector testing in case of foodborne illness complaints) must be logged.
