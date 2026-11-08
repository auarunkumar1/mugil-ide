// Violating Construction: Direct state jump to COMPLETED, hard delete on contracts, float retainage
export function submitContractorBill(contract: any, db: any) {
  // Violation 1: Direct terminal state jump without engineer sign-off or DLP
  contract.status = 'COMPLETED';

  // Violation 2: Hard delete on contracts/boq_items
  db.query("DELETE FROM contracts WHERE id = ?", [contract.id]);

  // Violation 3: Float retainage amount
  const retainage: float = 5000.00;

  return { contract, retainage };
}
