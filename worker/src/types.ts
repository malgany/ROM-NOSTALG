export type ParticipantRole = "host" | "guest";
export type SignalKind = "offer" | "answer" | "ice";

export interface Env {
  ROOMS: DurableObjectNamespace;
  ROOM_CREATE_RATE_LIMITER: RateLimit;
  ALLOWED_ORIGINS: string;
  ROOM_TTL_SECONDS?: string;
  TURNSTILE_SECRET_KEY: string;
  TURN_KEY_ID: string;
  TURN_KEY_API_TOKEN: string;
  TURN_CREDENTIAL_TTL_SECONDS?: string;
}

export interface RoomRecord extends Record<string, SqlStorageValue> {
  host_token_hash: string;
  guest_token_hash: string;
  expires_at: number;
  host_absent_since: number | null;
}

export interface SocketAttachment {
  role: ParticipantRole | null;
  authDeadline: number;
  cleaned: boolean;
}

export interface TurnstileResult {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}
