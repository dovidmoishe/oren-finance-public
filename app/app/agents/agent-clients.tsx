'use client';

import { useCallback, useState } from 'react';

import { AGENT_CLIENTS, type AgentClient } from './agent-client-data';
export { AGENT_CLIENTS, type AgentClient } from './agent-client-data';

export function isAgentClient(value: string): value is AgentClient {
  return AGENT_CLIENTS.some((item) => item.id === value);
}

/** Official logo files live in public/integrations; hide the slot if one is missing. */
export function AgentLogo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  // An image that failed before hydration never fires onError, so check it on attach.
  const check = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" aria-hidden="true" className="agents-client-logo" height={18} onError={() => setFailed(true)} ref={check} src={src} width={18} />
  );
}

/** Each link opens that app's setup tab on this page. */
export function AgentClientLinks() {
  return (
    <ul aria-label="Set up Oren in your agent app" className="agents-nav-clients">
      {AGENT_CLIENTS.map((item) => (
        <li key={item.id}>
          <a aria-label={`Set up Oren in ${item.label}`} href={`/agents#${item.id}`} title={item.label}>
            <AgentLogo src={item.logo} />
            <span>{item.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
