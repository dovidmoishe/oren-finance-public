import {
  json,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { mcpClientKind } from './oauth-runtime';

const parseMcpJson = json({ limit: '100kb' });
const parseRegistrationJson = json({ limit: '32kb' });

/**
 * Cursor registers its custom-scheme callback without application_type, so
 * oidc-provider would treat it as a web client and reject the scheme. Mark only
 * Cursor-only registrations as native; oidc-provider still validates every URI.
 */
export function markNativeMcpRegistration(body: unknown): void {
  if (!body || typeof body !== 'object') return;
  const metadata = body as {
    redirect_uris?: unknown;
    application_type?: unknown;
  };
  if (
    metadata.application_type === undefined &&
    Array.isArray(metadata.redirect_uris) &&
    metadata.redirect_uris.every((uri) => typeof uri === 'string') &&
    mcpClientKind(metadata.redirect_uris) === 'cursor'
  )
    metadata.application_type = 'native';
}

/** Route-level parser for POST /oauth/reg only; oidc-provider reads req.body. */
export function mcpRegistrationBody(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  parseRegistrationJson(req, res, (error?: unknown) => {
    if (error) return next(error);
    markNativeMcpRegistration(req.body);
    next();
  });
}

/**
 * Custom /mcp routes are mounted before Nest adds its parser in listen().
 *
 * The parser has to be scoped to /mcp so /oauth can keep reading the raw body.
 * It must not be the middleware function express.json() returns: that function
 * is named jsonParser, and Nest's ExpressAdapter treats any root middleware
 * with that name as the global JSON parser and then skips installing one.
 * Mounting it directly makes every other JSON POST, including both agent
 * message routes, arrive with an empty body.
 */
export function registerMcpJsonBodyParser(app: Express) {
  app.use(
    '/mcp',
    function mcpJsonParser(req: Request, res: Response, next: NextFunction) {
      parseMcpJson(req, res, next);
    },
  );
}
