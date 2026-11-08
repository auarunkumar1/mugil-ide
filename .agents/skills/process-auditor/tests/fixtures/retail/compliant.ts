// Compliant Retail POS Shift & Blind Count Close
export interface CashierShift {
  id: string;
  openingFloat: number; // in cents
  totalCashSales: number;
  totalCashDrops: number;
  isBlindCountCompleted: boolean;
  actualCashCounted?: number;
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
}

export function submitBlindCashCount(shift: CashierShift, physicalCashCounted: number) {
  if (shift.status !== 'OPEN') {
    throw new Error('Shift must be OPEN to initiate close');
  }
  // Cashier inputs counted currency without knowing expected system totals
  shift.actualCashCounted = physicalCashCounted;
  shift.isBlindCountCompleted = true;
  shift.status = 'CLOSING';
  return shift;
}

export function generateFiscalZReport(shift: CashierShift) {
  if (shift.status !== 'CLOSING' || !shift.isBlindCountCompleted) {
    throw new Error('Cannot issue fiscal Z-report: Blind cash count is incomplete');
  }
  const expectedTotal = shift.openingFloat + shift.totalCashSales - shift.totalCashDrops;
  const variance = (shift.actualCashCounted || 0) - expectedTotal;

  shift.status = 'CLOSED';
  return {
    zReportNumber: 1042,
    expectedTotal,
    actualTotal: shift.actualCashCounted,
    variance,
    clearedAt: new Date()
  };
}
