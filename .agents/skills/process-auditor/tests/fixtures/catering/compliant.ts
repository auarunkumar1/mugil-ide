// Compliant Catering & Banquet Event Billing
export interface BanquetEvent {
  id: string;
  contractedGuaranteedHeadcount: number;
  actualHeadcountCheckedIn: number;
  perPlateRateCents: number;
  advanceDepositHeldCents: number;
  status: 'CONFIRMED' | 'IN_PROGRESS' | 'RECONCILED';
}

export function computeFinalBanquetInvoice(event: BanquetEvent) {
  if (event.status !== 'IN_PROGRESS') {
    throw new Error('Event must be in progress to reconcile final bill');
  }

  // 1. Guaranteed Headcount Invariant (Attrition Protection)
  const billableHeadcount = Math.max(
    event.contractedGuaranteedHeadcount,
    event.actualHeadcountCheckedIn
  );

  const grossFoodCharges = billableHeadcount * event.perPlateRateCents;
  const netPayable = grossFoodCharges - event.advanceDepositHeldCents;

  event.status = 'RECONCILED';

  return {
    billableHeadcount,
    grossFoodCharges,
    advanceDeducted: event.advanceDepositHeldCents,
    netPayable
  };
}
