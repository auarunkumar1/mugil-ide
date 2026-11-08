// Violating Banking: Single-sided update, float balance, direct state jump, hard delete
export async function directTransfer(db: any, fromAcc: string, toAcc: string) {
  // Violation 1: Float balance
  const balance: float = 1200.50;

  // Violation 2: Direct single-sided mutation without double-entry journal or locking
  await db.query("UPDATE accounts SET balance = balance - 100 WHERE id = ?", [fromAcc]);

  // Violation 3: Direct jump to SETTLED without clearing
  const tx: any = {};
  tx.status = 'SETTLED';

  // Violation 4: Hard delete on transactions table
  await db.query("DELETE FROM transactions WHERE id = 99", []);

  return { balance, tx };
}
