// Compliant HMS Clinical Journey & Discharge
export interface PatientEncounter {
  id: string;
  doctorLicenseNo: string;
  clinicalNotes: string;
  isSigned: boolean;
  status: 'IN_CONSULTATION' | 'FINALIZED';
}

export interface PatientFolio {
  encounterId: string;
  totalCharges: number; // In minor cents
  totalPayments: number;
  unreconciledOrdersCount: number;
}

export function dischargePatient(
  encounter: PatientEncounter,
  folio: PatientFolio,
  currentStatus: 'ADMITTED' | 'READY_FOR_DISCHARGE'
): { status: 'DISCHARGED' } {
  // 1. Guard initial state
  if (currentStatus !== 'READY_FOR_DISCHARGE') {
    throw new Error('Patient is not marked ready for discharge');
  }
  // 2. Doctor attestation check
  if (!encounter.isSigned || !encounter.doctorLicenseNo) {
    throw new Error('Cannot discharge: Clinical encounter note unsigned by attending doctor');
  }
  // 3. Dept reconciliation check
  if (folio.unreconciledOrdersCount > 0) {
    throw new Error('Cannot discharge: Outstanding lab or pharmacy orders exist');
  }
  // 4. Financial balance clearance
  const balance = folio.totalCharges - folio.totalPayments;
  if (balance > 0) {
    throw new Error('Cannot discharge: Unsettled folio balance');
  }
  return { status: 'DISCHARGED' };
}
