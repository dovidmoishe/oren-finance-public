const configuredApi = process.env.NEXT_PUBLIC_OREN_API_URL;

/** Preview uses a relative API path; resolve its origin only in the browser. */
export function mcpApiOrigin(): string | undefined {
  if (!configuredApi) return undefined;
  if (configuredApi.startsWith('/')) {
    return typeof window === 'undefined' ? undefined : window.location.origin;
  }
  try {
    return new URL(configuredApi).origin;
  } catch {
    return undefined;
  }
}
