import type { Request, Response, NextFunction } from 'express';

/** Oren already requires browser consent; preserve requested renewal access. */
export function mcpOfflineConsentUrl(value: string): string {
  const url = new URL(value, 'https://oren.invalid');
  if (
    url.searchParams.get('response_type') !== 'code' ||
    !url.searchParams.get('scope')?.split(/\s+/).includes('offline_access') ||
    url.searchParams.has('prompt') ||
    url.searchParams.has('request') ||
    url.searchParams.has('request_uri')
  )
    return value;
  url.searchParams.set('prompt', 'consent');
  return `${url.pathname}${url.search}`;
}

/** Run only on GET /oauth/auth, before oidc-provider checks offline scopes. */
export function requireMcpOfflineConsent(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  req.url = mcpOfflineConsentUrl(req.url);
  next();
}
