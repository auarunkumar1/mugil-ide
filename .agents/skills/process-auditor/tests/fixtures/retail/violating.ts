// Violating Retail: Direct jump to CLOSED, hard delete on shifts, float price
export function endCashierShift(shift: any, db: any) {
  // Violation 1: Direct terminal state jump without blind count
  shift.status = 'CLOSED';

  // Violation 2: Hard delete on shifts table
  db.query("DELETE FROM shifts WHERE id = ?", [shift.id]);

  // Violation 3: Float retail price
  const price: float = 12.99;

  return { shift, price };
}
