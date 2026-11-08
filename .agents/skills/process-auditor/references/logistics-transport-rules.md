# Transport, Logistics & Fleet Management Workflow Rules

This reference defines invariants for transportation management systems (TMS), freight forwarding, 3PL logistics, and dispatch tracking.

---

## 1. Consignment Lifecycle & Cargo Chain of Custody

```
[Booking / Shipper Order]
         │
         ▼
[Consignment Note (LR / e-Way Bill / Bill of Lading) Issued]
         │
         ├──► Vehicle Allocation & Driver Fitness Check
         │
         ▼ (Warehouse Loading & Weighbridge Verification)
[Manifest Dispatched]
         │
         ├──► In-Transit Tracking & Checkpoint Halts
         │
         ▼ (Consignee Destination Arrival)
[Cargo Offloaded & Inspection]
         │
         ├── Shortage / Damaged Goods Marked (Damage Certificate)
         │
         ▼ (Digital Signature / Physical Stamp)
[Proof of Delivery (POD) Uploaded]
         │
         ▼
[Freight Freight Bill & Detention Invoiced]
```

---

## 2. Weight, Capacity & Safety Invariants

1. **Payload & Axle Weight Overload Prevention:**
   * Inward cargo weight + vehicle tare weight cannot exceed the vehicle's Gross Vehicle Weight Rating (GVWR):
     $$\text{Gross Weight} = \text{Tare Weight} + \sum \text{Cargo Weight} \le \text{Permissible Gross Weight}$$
   * The TMS must block manifest creation if calculated or weighbridge weight exceeds vehicle registered legal capacity.
2. **Driver Duty Hour Compliance (HOS / Driver Fatigue):**
   * A driver cannot be assigned to a dispatch trip without checking rest periods (e.g. maximum consecutive driving hours without statutory rest).
   * Active driver license expiry and hazardous material (Hazmat) certification must be validated.

---

## 3. Statutory Transport Documents & Billing

1. **E-Way Bill & Consignment Note (Lorry Receipt / LR):**
   * Interstate or commercial freight must carry a valid e-Way bill and sequential Consignment Note number.
   * Goods in transit without an active e-Way Bill validity period are liable to confiscation and tax penalties.
2. **Proof of Delivery (POD) Gate for Billing:**
   * In freight billing, client invoices cannot be generated or approved for payment without an attached, verified POD (digital signature or stamped physical copy).
3. **Demurrage & Detention Invariants:**
   * Free holding time (e.g. 24 or 48 hours) must be tracked from vehicle arrival timestamp to offloading timestamp. Detention billing must calculate only billable hours exceeding the contract free allowance.
