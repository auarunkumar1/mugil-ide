// Violating ERP: Bypasses 3-way match, float precision, hard delete, negative stock
export function processVendorBill(bill: any, db: any) {
  // Violation 1: Float type for money
  const amount: float = bill.unitPrice * bill.qty;

  // Violation 2: Direct state jump to PAID without 3-way matching
  bill.status = 'PAID';

  // Violation 3: Negative stock allowed without backorder check
  const config = { allow_negative_stock: true };

  // Violation 4: Direct hard deletion on orders table
  db.query("DELETE FROM orders WHERE id = ?", [bill.orderId]);

  return { amount, config };
}
