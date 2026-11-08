// Compliant Hospitality PMS Check-In & Room State Machine
export type RoomStatus = 'VACANT_DIRTY' | 'CLEAN' | 'INSPECTED' | 'OCCUPIED';

export function checkInGuest(
  room: { id: string; status: RoomStatus },
  guest: { name: string; idVerified: boolean; creditCardPreAuth: boolean }
) {
  // 1. Mandatory guest verification
  if (!guest.idVerified || !guest.creditCardPreAuth) {
    throw new Error('Mandatory KYC ID verification and credit card pre-auth required');
  }
  // 2. Room cleanliness state machine invariant
  if (room.status !== 'INSPECTED') {
    throw new Error(`Cannot check in guest: Room status is ${room.status}, must be INSPECTED`);
  }
  room.status = 'OCCUPIED';
  return { success: true, room };
}
