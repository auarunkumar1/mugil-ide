import type { Usage } from '../../types.js';

export interface ParsedUsageMetadata {
  cost?: number;
  listCost?: number;
  allowance?: Usage['allowance'];
  billingSource?: Usage['billingSource'];
}

function normalizeAllowance(value: unknown): Usage['allowance'] | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // OpenCode reports a dollar amount in `opencode.allowance`, not used/total.
    return { used: value };
  }
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const used = Number(obj.used ?? obj.percent);
  if (!Number.isFinite(used)) return undefined;
  const totalRaw = obj.total;
  const total = typeof totalRaw === 'number' && Number.isFinite(totalRaw) ? totalRaw : undefined;
  const resetAt =
    typeof obj.reset_at === 'string'
      ? obj.reset_at
      : typeof obj.resetsAt === 'string'
        ? obj.resetsAt
        : undefined;
  return { used, ...(total !== undefined ? { total } : {}), ...(resetAt ? { resetAt } : {}) };
}

/**
 * Parses standard and OpenCode-specific cost, allowance, and billing source
 * fields from a usage object. Safe for both JSON responses and final SSE
 * usage chunks.
 */
export function parseUsageMetadata(
  u: Record<string, any> | undefined,
): ParsedUsageMetadata {
  if (!u) return {};
  const opencode = u.opencode as Record<string, any> | undefined;

  const costRaw = u.cost ?? u.total_cost;
  const cost =
    costRaw !== undefined && Number.isFinite(Number(costRaw)) ? Number(costRaw) : undefined;

  const listCostRaw = opencode?.list_cost ?? u.list_cost;
  const listCost =
    listCostRaw !== undefined && Number.isFinite(Number(listCostRaw))
      ? Number(listCostRaw)
      : undefined;

  const allowance = normalizeAllowance(opencode?.allowance ?? u.allowance);

  let billingSource =
    opencode?.billing_source ?? u.billing_source ?? u.billingSource;
  if (billingSource === 'zen') billingSource = 'balance';

  return {
    ...(cost !== undefined ? { cost } : {}),
    ...(listCost !== undefined ? { listCost } : {}),
    ...(allowance ? { allowance } : {}),
    ...(billingSource ? { billingSource } : {}),
  };
}
