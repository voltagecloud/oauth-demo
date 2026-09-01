import { createHash, randomBytes } from "node:crypto";
import { googleConfig } from "@/lib/env";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export function callbackUrl(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

/** RFC 7636 S256. The verifier never leaves the server; only its hash is sent. */
export function challengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: challengeFromVerifier(verifier) };
}

export function authorizeUrl(params: {
  origin: string;
  state: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const { clientId } = googleConfig();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl(params.origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Always show the chooser: a demo gets shown repeatedly, often by someone who
  // wants to switch accounts to prove the limits are per-identity.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** Exchanges the authorization code and returns the verified identity. */
export async function exchangeCode(params: {
  code: string;
  codeVerifier: string;
  origin: string;
}): Promise<GoogleIdentity> {
  const { clientId, clientSecret } = googleConfig();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl(params.origin),
      grant_type: "authorization_code",
      code_verifier: params.codeVerifier,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google token exchange failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const { id_token: idToken } = (await response.json()) as { id_token?: string };
  if (!idToken) throw new Error("Google token response contained no id_token");

  return verifyIdToken(idToken, clientId);
}

/**
 * Validates the id_token's claims.
 *
 * The signature is deliberately not re-checked: the token came straight from
 * Google's token endpoint over TLS in direct response to our own code exchange,
 * which is exactly the case OpenID Connect lets a confidential client skip
 * signature verification for. Were this token accepted from anywhere else —
 * a client POST, a redirect fragment — the JWKS check would be mandatory.
 */
function verifyIdToken(idToken: string, clientId: string): GoogleIdentity {
  const [, payload] = idToken.split(".");
  if (!payload) throw new Error("Malformed id_token");

  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;

  if (!ISSUERS.has(String(claims.iss))) throw new Error(`Unexpected id_token issuer: ${claims.iss}`);
  if (claims.aud !== clientId) throw new Error("id_token audience does not match this client");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) {
    throw new Error("id_token has expired");
  }
  if (!claims.sub) throw new Error("id_token contained no subject");

  return {
    sub: String(claims.sub),
    email: String(claims.email ?? ""),
    name: claims.name ? String(claims.name) : undefined,
    picture: claims.picture ? String(claims.picture) : undefined,
  };
}
