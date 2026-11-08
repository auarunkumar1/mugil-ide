// Violating Catering: Direct state jump to COMPLETED, hard delete on events, float deposit
export function finalizeEvent(event: any, db: any) {
  // Violation 1: Direct terminal state jump without attrition check
  event.status = 'COMPLETED';

  // Violation 2: Hard delete on events table
  db.query("DELETE FROM events WHERE id = ?", [event.id]);

  // Violation 3: Float deposit
  const deposit: float = 1500.00;

  return { event, deposit };
}
