"use client";

import { useEffect } from "react";
import { RouteErrorPage } from "@/components/errors";

export default function TerminalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <RouteErrorPage reset={reset} />;
}
