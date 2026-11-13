/** Catalog keys for sign-in failures. The raw SDK message stays in the console. */
export type SignInErrorKey =
  | "auth.emailInvalid"
  | "auth.codeInvalid"
  | "auth.rateLimited"
  | "auth.network"
  | "auth.sendFailed"
  | "auth.verifyFailed";

function textOf(value: unknown) {
  return typeof value === "string" ? value : "";
}

function messageOf(cause: unknown) {
  if (!cause || (typeof cause !== "object" && typeof cause !== "function")) return "";
  return textOf((cause as { message?: unknown }).message);
}

function codeOf(cause: unknown) {
  if (!cause || typeof cause !== "object") return "";
  const record = cause as { privyErrorCode?: unknown; code?: unknown; data?: { code?: unknown; error?: unknown } };
  return textOf(record.privyErrorCode || record.code || record.data?.code || record.data?.error).toLowerCase();
}

/** Maps a Privy failure to a catalog key. Unknown failures use the stage fallback. */
export function signInErrorKey(cause: unknown, stage: "send" | "verify"): SignInErrorKey {
  console.error(cause);
  const code = codeOf(cause);
  const message = messageOf(cause).toLowerCase();
  if (code === "too_many_requests" || /too many requests|rate limit/.test(message)) return "auth.rateLimited";
  if (
    code === "invalid_credentials"
    || /invalid (or )?expired|expired code|invalid code|incorrect code|code is invalid|wrong code/.test(message)
  ) return "auth.codeInvalid";
  if (
    code === "invalid_data"
    || code === "disallowed_plus_email"
    || /invalid email|valid email address|email address is invalid/.test(message)
  ) return "auth.emailInvalid";
  if (
    code === "client_request_timeout"
    || /network|failed to fetch|load failed|offline|timed out|timeout|econn|enotfound/.test(message)
  ) return "auth.network";
  return stage === "send" ? "auth.sendFailed" : "auth.verifyFailed";
}
