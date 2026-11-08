# Hospital Management System (HMS) Workflow Rules

This reference outlines medical, administrative, and financial invariants for healthcare and clinic management software.

---

## 1. End-to-End Clinical & Billing Journey

```
[Patient Registration / KYC]
         │
         ▼
[Triage / Vitals Intake]
         │
         ▼
[Doctor Consultation / Encounter]
         │
         ├──► [Diagnostic Order (Lab/Radiology)] ──► [Lab Sample Collected] ──► [Result Verified]
         │
         ├──► [Electronic Prescription (eRx)] ────► [Pharmacy Verification] ──► [Medication Dispensed]
         │
         ▼
[Clinical Encounter Finalized / Signed]
         │
         ▼
[Centralized Patient Folio / Billing]
         │
         ├──► [Insurance Claim Pre-Auth / Copay / Deductible Calculation]
         │
         ▼
[Final Bill Settled & Cleared]
         │
         ▼
[Discharge Summary / Gate Pass Issued]
```

---

## 2. Clinical & Medical Integrity Invariants

1. **Practitioner Sign-off & Legal Attestation**:
   * Encounters, diagnoses, clinical notes, and surgical notes can only be finalized and signed by a licensed practitioner with an active medical registration number.
   * Once signed, clinical notes become read-only. Corrections must be recorded as append-only addenda with timestamps, practitioner ID, and change rationale.
2. **Prescription Safety Checks**:
   * **Drug-Drug & Allergy Interaction**: Prescriptions must cross-reference patient recorded allergies and current active medications before submission.
   * **Controlled Substances**: Regulated narcotics and controlled drugs must require dual-authorization or strict prescribing limits.
3. **Chain of Custody for Diagnostics**:
   * Lab test results must not be released to patient-facing portals or billing until verified and marked `APPROVED` by a pathologist/radiologist.

---

## 3. Healthcare Pharmacy & Medication Dispensation

1. **Dispense Against Valid Prescription Only**:
   * Outpatient and inpatient pharmacies cannot dispense prescription-grade pharmaceuticals without an active doctor prescription ID.
2. **Batch & Expiry Enforcement**:
   * The system must reject dispensing expired medicine batches.
   * Lot/Batch number and expiry date must be stamped on the patient dispensing invoice for recall traceability.
3. **Medication Administration Records (eMAR)**:
   * Inpatient dose administration must record: Patient ID, Nurse ID, Timestamp, Medication Batch, Dosage Given, and Route.

---

## 4. Inpatient Admission, Bed Allocation & Discharge

1. **Single Bed Occupancy**:
   * A bed/room can only be assigned to one admitted patient at any given time (unless categorized as multi-bed ward with discrete bed identifiers).
   * Patient admission status must be `ADMITTED` for room charges, nursing fees, and daily care items to accrue.
2. **Discharge Gate-Pass Lock**:
   * A patient cannot transition to `DISCHARGED` status until:
     1. Doctor has completed the medical Discharge Summary.
     2. Pharmacy, Lab, and Central Billing departments have reconciled all pending orders.
     3. Financial folio has balance $\le 0$ or an approved corporate/insurance guarantee letter is attached.

---

## 5. Medical Billing & Insurance Claims

1. **Charge Capture Integrity**:
   * No service, procedure, or consumable item can be billed at an arbitrary price; all items must link to an approved Hospital Tariff / Charge Master schedule.
2. **Insurance & TPA Claims Reconciliation**:
   * Adjudication records must separate: Total Claim Amount, Approved TPA Amount, Co-pay (Patient liability), Deductible, and Disallowed/Rejected Amount.
   * Rejected amounts must not be automatically written off without supervisor approval.
