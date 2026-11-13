'use client';

import { useEffect, useId, useState } from 'react';
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { AGENT_CLIENTS, AgentLogo, isAgentClient, type AgentClient } from './agent-clients';

const PRODUCTION_MCP_URL = 'https://api.oren.finance/mcp';

type Client = AgentClient;

const CLIENTS: { id: Client; label: string; where: string }[] = [
  { id: 'claude', label: 'Claude', where: 'In Claude settings' },
  { id: 'cursor', label: 'Cursor', where: 'In ~/.cursor/mcp.json' },
  { id: 'codex', label: 'Codex', where: 'In your terminal' },
];

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return <div className="agents-code">
    <div className="agents-code-bar">
      <span>{label}</span>
      <button aria-label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`} className="agents-copy" onClick={() => void copy()} type="button">
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={15} aria-hidden="true" />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
    <pre><code>{code}</code></pre>
  </div>;
}

export function AgentSetup() {
  const id = useId();
  const [client, setClient] = useState<Client>('claude');
  useEffect(() => {
    // /agents#cursor (from the nav or hero links) opens that app's setup.
    const openFromHash = () => {
      const hash = window.location.hash.slice(1);
      if (!isAgentClient(hash)) return;
      setClient(hash);
      document.getElementById('setup')?.scrollIntoView({ block: 'start' });
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);
  // Setup instructions always connect external clients to the public MCP server.
  const url = PRODUCTION_MCP_URL;

  const cursorConfig = JSON.stringify({ mcpServers: { oren: { url } } }, null, 2);

  return <div className="agents-setup">
    <div aria-label="Choose your agent app" className="flex justify-center [gap:4px] [padding:8px] [border-bottom:1px_solid_#ece8df] [background:#f7f6f2]" role="tablist">
      {CLIENTS.map(item => <button
        aria-controls={`${id}-${item.id}`}
        aria-selected={client === item.id}
        className="agents-tab"
        id={`${id}-${item.id}-tab`}
        key={item.id}
        onClick={() => setClient(item.id)}
        role="tab"
        type="button"
      ><AgentLogo src={AGENT_CLIENTS.find(entry => entry.id === item.id)!.logo} />{item.label}</button>)}
    </div>
    <div aria-labelledby={`${id}-${client}-tab`} className="agents-panel" id={`${id}-${client}`} role="tabpanel" tabIndex={0}>
      {client === 'claude' && <>
        <ol className="agents-mini-steps">
          <li>Open <strong>Settings → Connectors</strong> in Claude and choose <strong>Add custom connector</strong>.</li>
          <li>Name it <strong>Oren</strong> and paste the server URL below.</li>
          <li>Select <strong>Connect</strong>, sign in to Oren with your email, and approve access.</li>
        </ol>
        <CodeBlock label="Server URL" code={url} />
      </>}
      {client === 'cursor' && <>
        <ol className="agents-mini-steps">
          <li>Add Oren to <strong>~/.cursor/mcp.json</strong>, or to <strong>.cursor/mcp.json</strong> in one project.</li>
          <li>Restart Cursor, then open <strong>Settings → MCP</strong>.</li>
          <li>Select <strong>Connect</strong> next to Oren, sign in with your email, and approve access.</li>
        </ol>
        <CodeBlock label="mcp.json" code={cursorConfig} />
      </>}
      {client === 'codex' && <>
        <ol className="agents-mini-steps">
          <li>Add the Oren server, then sign in. Codex opens Oren in your browser.</li>
          <li>Approve access, then run <strong>/mcp</strong> in Codex to check it&apos;s connected.</li>
        </ol>
        <CodeBlock label="In your terminal" code={`codex mcp add oren --url ${url}\ncodex mcp login oren`} />
      </>}
      <p className="agents-panel-note">{CLIENTS.find(item => item.id === client)?.where}. No API key to paste: your app signs in to Oren for you.</p>
    </div>
  </div>;
}
