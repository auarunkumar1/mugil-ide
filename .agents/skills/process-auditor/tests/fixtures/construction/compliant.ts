// Compliant Construction Progress Billing & Retention
import { Decimal } from 'decimal.js';

export interface BoqItem {
  id: string;
  contractQty: Decimal;
  approvedVariationQty: Decimal;
  billedQtyToDate: Decimal;
  unitRate: Decimal;
}

export function certifyProgressBilling(
  item: BoqItem,
  currentClaimQty: Decimal,
  retentionPercent: Decimal = new Decimal(0.05)
) {
  const maxAllowableQty = item.contractQty.plus(item.approvedVariationQty);
  const newCumulativeQty = item.billedQtyToDate.plus(currentClaimQty);

  // 1. BOQ Ceiling Guard
  if (newCumulativeQty.greaterThan(maxAllowableQty)) {
    throw new Error(`Claimed quantity exceeds approved BOQ limit of ${maxAllowableQty}`);
  }

  const grossAmount = currentClaimQty.times(item.unitRate);
  const retentionDeduction = grossAmount.times(retentionPercent);
  const certifiedPayment = grossAmount.minus(retentionDeduction);

  item.billedQtyToDate = newCumulativeQty;

  return {
    grossAmount,
    retentionDeduction,
    certifiedPayment
  };
}
