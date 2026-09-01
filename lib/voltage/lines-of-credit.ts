import { voltageConfig } from "@/lib/env";
import { voltageRequest } from "./client";

/**
 * A line of credit is what actually denominates a wallet: it carries a
 * required `currency` from the moment it exists, whereas a wallet's balances
 * array is empty until money has moved through it.
 */
export interface LineOfCreditSummary {
  id: string;
  currency: string;
  network: string;
  environment_id?: string;
  limit?: number;
}

export async function getLineOfCredit(lineId: string): Promise<LineOfCreditSummary> {
  const { organizationId } = voltageConfig();
  return voltageRequest<LineOfCreditSummary>(
    `/organizations/${organizationId}/lines_of_credit/${lineId}/summary`,
  );
}
