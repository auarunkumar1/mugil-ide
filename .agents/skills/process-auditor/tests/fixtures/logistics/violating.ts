// Violating Logistics: Direct jump to DELIVERED, float fare, hard delete on manifests
export function closeDispatch(manifest: any, db: any) {
  // Violation 1: Direct terminal state jump without POD
  manifest.status = 'DELIVERED';

  // Violation 2: Hard delete on manifests/consignments
  db.query("DELETE FROM manifests WHERE id = ?", [manifest.id]);

  // Violation 3: Float freight fare
  const fare: float = 1250.00;

  return { manifest, fare };
}
