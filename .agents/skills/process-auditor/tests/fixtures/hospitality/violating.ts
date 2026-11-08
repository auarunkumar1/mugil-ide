// Violating Hospitality PMS: Check-in to dirty room, direct jump to CHECKED_OUT, hard delete
export function fastCheckOut(folio: any, db: any) {
  // Violation 1: Direct terminal state jump without balance or night audit verification
  folio.status = 'CHECKED_OUT';

  // Violation 2: Hard delete on folios or reservations
  db.query("DELETE FROM folios WHERE id = ?", [folio.id]);

  // Violation 3: Float room tariff
  const price: float = 189.99;

  return { folio, price };
}
