// Compliant Manufacturing Work Order & QA Gate
export interface WorkOrder {
  id: string;
  bomVersion: string;
  bomLocked: boolean;
  qcInspectionStatus: 'PENDING' | 'PASSED' | 'FAILED';
  status: 'DRAFT' | 'RELEASED' | 'IN_PRODUCTION' | 'QC_QUARANTINE' | 'COMPLETED';
}

export function releaseWorkOrderToShopFloor(wo: WorkOrder) {
  if (wo.status !== 'DRAFT') {
    throw new Error('Work order must be in DRAFT to release');
  }
  // 1. Lock BOM revision
  wo.bomLocked = true;
  wo.status = 'RELEASED';
  return wo;
}

export function acceptFinishedGoods(wo: WorkOrder) {
  if (wo.status !== 'QC_QUARANTINE') {
    throw new Error('Only quarantined work orders can be inspected');
  }
  // 2. QA/QC Gate
  if (wo.qcInspectionStatus !== 'PASSED') {
    throw new Error('Cannot accept finished goods: QA/QC inspection has not passed');
  }
  wo.status = 'COMPLETED';
  return wo;
}
