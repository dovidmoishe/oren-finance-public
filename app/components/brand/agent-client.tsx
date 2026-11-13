import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ComputerIcon } from "@hugeicons/core-free-icons";

import { mcpConnectorForKind } from "@/services/mcp-connector";

export const agentClient = mcpConnectorForKind;

export function AgentClientLogo({ kind, size = 28 }: { kind?: string | null; size?: number }) {
  const client = agentClient(kind);
  return client ? <Image alt="" src={client.logo} width={size} height={size} />
    : <HugeiconsIcon icon={ComputerIcon} size={size} aria-hidden="true" />;
}
