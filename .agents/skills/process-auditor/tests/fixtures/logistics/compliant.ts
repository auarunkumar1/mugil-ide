// Compliant Logistics & Freight Billing
export interface Consignment {
  id: string;
  tareWeightKg: number;
  cargoWeightKg: number;
  vehicleGvwrKg: number;
  podUploaded: boolean;
  podSigned: boolean;
  status: 'DISPATCHED' | 'ARRIVED' | 'POD_VERIFIED' | 'BILLED';
}

export function verifyDispatchWeight(consignment: Consignment): boolean {
  const grossWeight = consignment.tareWeightKg + consignment.cargoWeightKg;
  if (grossWeight > consignment.vehicleGvwrKg) {
    throw new Error(`Gross vehicle weight ${grossWeight}kg exceeds legal GVWR ${consignment.vehicleGvwrKg}kg`);
  }
  return true;
}

export function generateFreightBill(consignment: Consignment) {
  // Gate check: Bill cannot be generated without verified Proof of Delivery
  if (consignment.status !== 'POD_VERIFIED' || !consignment.podUploaded || !consignment.podSigned) {
    throw new Error('Cannot issue freight bill: Proof of Delivery (POD) missing or unverified');
  }
  consignment.status = 'BILLED';
  return { billed: true, consignment };
}
