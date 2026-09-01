import { voltageConfig } from "@/lib/env";
import { voltageRequest } from "./client";
import type { WalletPolicies } from "./types";

/**
 * Wallet policies are addressed by organization *and wallet* — unlike the
 * payments endpoints they are not environment-scoped. Easy to get wrong.
 */
function walletPath(walletId: string): string {
  const { organizationId } = voltageConfig();
  return `/organizations/${organizationId}/wallets/${walletId}/policies`;
}

export async function getWalletPolicies(walletId: string): Promise<WalletPolicies> {
  return voltageRequest<WalletPolicies>(walletPath(walletId));
}

export interface WalletPolicySummary {
  /** Voltage rejects any single payment above this. */
  maxPaymentSizeSats?: number;
  transactionsPerMinute?: number;
  sendVolumeLimitSats?: number;
  updatedAt?: string;
}

export function summarisePolicies(policies: WalletPolicies): WalletPolicySummary {
  const find = <T>(type: string): T | undefined =>
    policies.policies?.find((policy) => policy.type === type)?.data as T | undefined;

  return {
    maxPaymentSizeSats: find<{ max_size_sats: number }>("max_payment_size")?.max_size_sats,
    transactionsPerMinute: find<{ transactions_per_minute: number }>("transaction_velocity")
      ?.transactions_per_minute,
    sendVolumeLimitSats: find<{ limit_sats: number }>("send_volume_limit")?.limit_sats,
    updatedAt: policies.updated_at,
  };
}
