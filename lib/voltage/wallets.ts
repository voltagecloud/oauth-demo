import { voltageConfig } from "@/lib/env";
import { voltageRequest } from "./client";

export interface Balance {
  currency: string;
  network?: string;
}

export interface Wallet {
  id: string;
  name: string;
  network: string;
  line_of_credit_id?: string | null;
  balances: Balance[];
}

export async function getWallet(walletId: string): Promise<Wallet> {
  const { organizationId } = voltageConfig();
  return voltageRequest<Wallet>(`/organizations/${organizationId}/wallets/${walletId}`);
}
