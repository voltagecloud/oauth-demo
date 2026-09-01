/**
 * A hand-written subset of the Voltage API schema.
 *
 * Only the fields this app reads are modelled. The full spec is published at
 * https://voltageapi.com/v1/openapi/docs.json — regenerate from there if you
 * need more than this.
 */

export type PaymentStatus =
  | "generating"
  | "receiving"
  | "sending"
  | "approved"
  | "completed"
  | "expired"
  | "failed";

export type PaymentDirection = "send" | "receive";

/** Millisatoshis when `currency` is btc; cents when it is usd. */
export interface Amount {
  currency: string;
  amount: number;
  unit?: string;
}

export interface Payment {
  id: string;
  organization_id?: string;
  environment_id?: string;
  wallet_id?: string;
  direction: PaymentDirection;
  /** Rail: "bolt11", "onchain", "bip21", … */
  type?: string;
  status: PaymentStatus;
  currency?: string;
  error?: unknown;
  metadata?: Record<string, string> | null;
  /** Present on receives: the amount the invoice was minted for. */
  requested_amount?: Amount | null;
  created_at: string;
  updated_at: string;
  data?: {
    /** The bolt11 invoice. Null until Voltage finishes generating it. */
    payment_request?: string | null;
    /**
     * On a cross-currency payment this is the *display* currency — cents on a
     * USD wallet, not the bitcoin rail amount.
     */
    amount?: Amount;
    /**
     * Deprecated by Voltage, but the deprecated msat/sat fields are documented
     * to retain the bitcoin rail value where `amount` does not.
     */
    amount_msats?: number;
    memo?: string | null;
    expiration?: { expires_at?: string } | string | null;
  } | null;
}

/** `GET /payments` — cursor pagination. `total` is absent in cursor mode. */
export interface PaymentsPage {
  items: Payment[];
  next_cursor?: string | null;
  has_more?: boolean;
  limit?: number;
}

/** `GET /organizations/{org}/wallets/{wallet}/policies` */
export interface WalletPolicies {
  id: string;
  organization_id?: string | null;
  policies: WalletPolicy[];
  updated_at: string;
}

export type WalletPolicy =
  | { type: "max_payment_size"; data: { max_size_sats: number } }
  | { type: "transaction_velocity"; data: { transactions_per_minute: number } }
  | { type: "send_volume_limit"; data: { limit_sats: number } }
  | { type: "processing_fee"; data: { rates: { send_basis_points: number; receive_basis_points: number } } }
  | { type: string; data: unknown };
