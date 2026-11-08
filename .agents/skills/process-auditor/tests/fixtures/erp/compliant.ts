// Compliant ERP Procurement & Order Management
import { Decimal } from 'decimal.js';

interface PurchaseOrder {
  id: string;
  unitPrice: Decimal;
  quantity: Decimal;
  status: 'APPROVED';
}

interface GoodsReceiptNote {
  poId: string;
  receivedQty: Decimal;
}

interface VendorBill {
  id: string;
  poId: string;
  billedQty: Decimal;
  billedUnitPrice: Decimal;
  status: 'PENDING_MATCH' | 'APPROVED' | 'PAID' | 'VOIDED';
}

export function performThreeWayMatch(po: PurchaseOrder, grn: GoodsReceiptNote, bill: VendorBill): boolean {
  if (bill.status !== 'PENDING_MATCH') {
    throw new Error(`Invalid initial bill status: ${bill.status}`);
  }
  // 1. Qty check: billedQty <= receivedQty
  if (bill.billedQty.greaterThan(grn.receivedQty)) {
    return false;
  }
  // 2. Price check: unit price match within 0.5% tolerance
  const diff = bill.billedUnitPrice.minus(po.unitPrice).abs();
  const tolerance = po.unitPrice.times(0.005);
  if (diff.greaterThan(tolerance)) {
    return false;
  }
  bill.status = 'APPROVED';
  return true;
}

export function softCancelBill(bill: VendorBill, reason: string, cancelledBy: string) {
  bill.status = 'VOIDED';
  return { ...bill, cancelledReason: reason, cancelledBy, cancelledAt: new Date() };
}
