// Compliant Banking & Ledger Transfer
import { Decimal } from 'decimal.js';

interface JournalEntryLeg {
  accountId: string;
  debit: Decimal;
  credit: Decimal;
}

export async function postDoubleEntryTransfer(
  txManager: any,
  sourceAccId: string,
  destAccId: string,
  amount: Decimal
) {
  return await txManager.transaction(async (trx: any) => {
    // 1. Row-level locks to prevent double-spending
    const source = await trx('accounts').where({ id: sourceAccId }).forUpdate().first();
    const dest = await trx('accounts').where({ id: destAccId }).forUpdate().first();

    const currentBalance = new Decimal(source.balance);
    const overdraftLimit = new Decimal(source.overdraftLimit || 0);

    // 2. Overdraft validation
    if (currentBalance.plus(overdraftLimit).lessThan(amount)) {
      throw new Error('Insufficient funds and overdraft ceiling breached');
    }

    // 3. Double-entry leg verification
    const legs: JournalEntryLeg[] = [
      { accountId: sourceAccId, debit: amount, credit: new Decimal(0) },
      { accountId: destAccId, debit: new Decimal(0), credit: amount }
    ];

    const totalDebits = legs.reduce((acc, l) => acc.plus(l.debit), new Decimal(0));
    const totalCredits = legs.reduce((acc, l) => acc.plus(l.credit), new Decimal(0));

    if (!totalDebits.equals(totalCredits)) {
      throw new Error('Double entry unbalanced');
    }

    await trx('journal_entries').insert(legs);
    await trx('accounts').where({ id: sourceAccId }).update({ balance: currentBalance.minus(amount).toString() });
    await trx('accounts').where({ id: destAccId }).update({ balance: new Decimal(dest.balance).plus(amount).toString() });
  });
}
