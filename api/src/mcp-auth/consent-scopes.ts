/** OAuth identity/refresh scopes never become MCP resource permissions. */
export function mcpConsentScopes(scope: string, executeEnabled: boolean) {
  const requested = [...new Set(scope.split(/\s+/).filter(Boolean))];
  const resource = [
    'oren.read',
    'oren.trade.prepare',
    ...(executeEnabled ? ['oren.trade.execute'] : []),
  ];
  const allowed = new Set(['openid', 'offline_access', ...resource]);
  if (requested.some((value) => !allowed.has(value))) return undefined;
  const resourceScopes = requested.filter((value) => resource.includes(value));
  if (!resourceScopes.length) return undefined;
  return {
    requested,
    resourceScopes,
    oidcScopes: requested.filter(
      (value) =>
        value === 'openid' ||
        value === 'offline_access' ||
        resource.includes(value),
    ),
  };
}
