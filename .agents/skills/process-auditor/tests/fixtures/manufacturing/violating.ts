// Violating Manufacturing: Direct state jump to COMPLETED, hard delete on work orders, float cost
export function completeProduction(workOrder: any, db: any) {
  // Violation 1: Direct jump to COMPLETED without QA quarantine
  workOrder.status = 'COMPLETED';

  // Violation 2: Hard delete on work_orders table
  db.query("DELETE FROM work_orders WHERE id = ?", [workOrder.id]);

  // Violation 3: Float unit cost
  const cost: float = 78.45;

  return { workOrder, cost };
}
