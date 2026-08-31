import { ApiError } from "./http";
import type { Env, TurnstileResult } from "./types";

export const TURNSTILE_ACTION = "create-room";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURN_CREDENTIAL_MIN_TTL_SECONDS = 60;
const TURN_CREDENTIAL_MAX_TTL_SECONDS = 21_600;

export async function verifyTurnstile(
  token: unknown,
  request: Request,
  origin: string,
  env: Env,
): Promise<void> {
  if (typeof token !== "string" || token.length < 1 || token.length > 2048) {
    throw new ApiError(400, "turnstile_token_required", "Conclua a verificação Turnstile.");
  }

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: request.headers.get("CF-Connecting-IP") ?? undefined,
      idempotency_key: crypto.randomUUID(),
    }),
  });

  if (!response.ok) {
    throw new ApiError(502, "turnstile_unavailable", "Não foi possível validar o Turnstile.");
  }

  const result = await response.json<TurnstileResult>();
  const expectedHostname = new URL(origin).hostname;
  if (!result.success || result.hostname !== expectedHostname || result.action !== TURNSTILE_ACTION) {
    throw new ApiError(403, "turnstile_rejected", "Verificação Turnstile recusada.");
  }
}

export function turnCredentialTtl(
  env: Env,
  maximumTtlSeconds = TURN_CREDENTIAL_MAX_TTL_SECONDS,
): number {
  const parsed = Number.parseInt(env.TURN_CREDENTIAL_TTL_SECONDS ?? "21600", 10);
  const configuredTtl = Number.isFinite(parsed) ? parsed : TURN_CREDENTIAL_MAX_TTL_SECONDS;
  const roomTtl = Math.min(
    TURN_CREDENTIAL_MAX_TTL_SECONDS,
    Math.max(TURN_CREDENTIAL_MIN_TTL_SECONDS, Math.floor(maximumTtlSeconds)),
  );
  return Math.min(roomTtl, Math.max(TURN_CREDENTIAL_MIN_TTL_SECONDS, configuredTtl));
}

export async function generateIceServers(
  env: Env,
  maximumTtlSeconds?: number,
): Promise<unknown[]> {
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: turnCredentialTtl(env, maximumTtlSeconds) }),
    },
  );

  if (!response.ok) {
    console.error("Cloudflare TURN credential request failed", response.status);
    throw new ApiError(502, "turn_unavailable", "Não foi possível obter credenciais TURN.");
  }

  const payload = await response.json<{ iceServers?: unknown }>();
  if (!Array.isArray(payload.iceServers) || payload.iceServers.length === 0) {
    throw new ApiError(502, "turn_invalid_response", "Resposta inválida do serviço TURN.");
  }
  return payload.iceServers;
}
