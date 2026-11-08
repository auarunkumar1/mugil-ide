// Violating HMS: Dispenses without prescription, direct jump to DISCHARGED, hard delete
export function quickDischarge(patient: any, db: any) {
  // Violation 1: Direct terminal state jump without doctor sign-off or folio clearance
  patient.status = 'DISCHARGED';

  // Violation 2: Hard delete on prescriptions or patients
  db.query("DELETE FROM prescriptions WHERE patient_id = ?", [patient.id]);

  // Violation 3: Float tariff pricing
  const total: float = 450.75;

  return { patient, total };
}
