"use client";

import { useCallback } from "react";
import { usePortfolioStore, useWalletStore } from "@/store";
import type { PortfolioRange } from "@/types";

export function usePortfolioRefresh(range: PortfolioRange = "1W") {
  const wallet = useWalletStore((state) => state.address);
  const loadPortfolio = usePortfolioStore((state) => state.loadPortfolio);
  const loadHistory = usePortfolioStore((state) => state.loadHistory);
  const loadActivity = usePortfolioStore((state) => state.loadActivity);

  return useCallback(async () => {
    if (!wallet) {
      return;
    }

    await Promise.all([loadPortfolio(wallet), loadHistory(wallet, range), loadActivity(wallet)]);
  }, [loadActivity, loadHistory, loadPortfolio, range, wallet]);
}
