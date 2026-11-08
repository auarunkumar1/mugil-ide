# Tax-Audit-Ready Document & Invoice Specification

This specification defines the mandatory data fields, numbering rules, tax calculation constraints, and print styling required for enterprise-ready and audit-compliant commercial documents (Tax Invoices, Bills of Supply, Credit/Debit Notes, and Medical Discharge Bills).

---

## 1. Statutory Invoice Data Schema Requirements

A compliant commercial tax invoice must contain:

| Section | Mandatory Fields | Audit / Tax Purpose |
| :--- | :--- | :--- |
| **Document Identity** | Document Title ("TAX INVOICE"), Unique Invoice Number, Issue Date, Due Date, Time of Supply. | Prevents duplicate claiming of expenses/input tax. |
| **Issuer Details (Seller)** | Registered Legal Entity Name, Trade Name, Registered Physical Address, Contact Info, Tax ID (GSTIN / VAT / EIN / TIN), Corporate Identity / Registration Number. | Identifies the taxable legal entity liable for tax remittance. |
| **Recipient Details (Buyer)** | Buyer Legal Name, Billing Address, Shipping / Delivery Address, Tax ID (if B2B), Place of Supply / Jurisdiction code. | Establishes input tax credit (ITC) eligibility. |
| **Line Item Details** | Item Description, HSN/SAC code, Quantity, Unit of Measure (UoM), Unit Price, Discount %, Taxable Amount, Tax Rate %, Tax Breakup (e.g. CGST+SGST or IGST / State vs Federal VAT), Total Line Item Amount. | Granular audit trail for tax categorization. |
| **Summary & Round-off** | Gross Subtotal, Total Discounts, Tax Breakup Table, Shipping & Handling, Round-off amount (nearest unit), Net Payable Total (both in Numbers and Words). | Eliminates rounding ambiguity and tampering. |
| **Payment & Banking** | Bank Name, Account Name, Account/IBAN Number, SWIFT/BIC/IFSC Code, UPI/QR Code / Payment Link. | Direct electronic settlement trail. |
| **Legal & Sign-off** | Authorized Signatory name & digital signature/seal, Declaration ("This is a computer-generated invoice..."), Jurisdiction of legal disputes. | Legal enforceability in commercial court. |

---

## 2. Document Numbering & Sequence Invariants

1. **Gapless Sequential Numbering**:
   * Invoice numbers must follow an uninterrupted, strictly increasing sequential series per fiscal year / financial period (e.g., `INV/2026-27/0001`, `INV/2026-27/0002`).
   * Gaps in invoice numbers (e.g., jump from 0012 to 0015) trigger statutory tax audit penalties.
2. **Cancellation Rules**:
   * An invoice number can never be deleted from the database.
   * If an invoice is cancelled prior to dispatch, its status is changed to `CANCELLED`, preserving the row and sequence position with cancellation reason and auditor timestamp.
   * If cancelled after dispatch, a separate `CREDIT NOTE` with its own unique sequential number must be issued referencing the original invoice.

---

## 3. Financial Calculation & Rounding Precision

1. **Rounding Order**:
   * Calculate line item taxable value: `round(Qty * UnitPrice * (1 - Discount%), 2)`
   * Calculate line item tax amount: `round(LineTaxable * TaxRate%, 2)`
   * Never round before line-level multiplication; do not accumulate intermediate float rounding errors.
2. **Currency in Words**:
   * Document must display total payable amount spelled out in words (e.g., "US Dollars Two Thousand Four Hundred and Fifty Cents Only" or "Rupees Two Thousand...").

---

## 4. Professional Printout & PDF Styling Guidelines (`@media print`)

All business documents rendered via HTML/CSS must conform to standard business print styling:

```css
@media print {
  @page {
    size: A4 portrait; /* or Letter */
    margin: 15mm 12mm 15mm 12mm;
  }

  /* Hide navigation, buttons, sidebars */
  nav, .sidebar, .no-print, .action-buttons {
    display: none !important;
  }

  body {
    background: #ffffff !important;
    color: #111827 !important;
    font-size: 10pt;
    line-height: 1.4;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  /* Prevent awkward page breaks inside critical blocks */
  .invoice-header,
  .invoice-footer,
  .totals-table,
  .signature-block,
  tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  /* Table readability */
  table {
    width: 100%;
    border-collapse: collapse;
  }

  thead {
    display: table-header-group; /* Repeat headers across multiple pages */
  }

  tfoot {
    display: table-footer-group;
  }

  th, td {
    padding: 6px 8px;
    border-bottom: 1px solid #e5e7eb;
  }

  /* Number formatting alignment */
  .numeric-col {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
}
```
