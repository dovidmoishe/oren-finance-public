"use client";

import { create } from "zustand";
import { sessionSetter } from "@/services/wallet-session";
import {
  getPortfolio,
  getPortfolioActivity,
  getPortfolioHistory,
  getTradingCalendar,
  getTradingCalendarDay,
} from "@/services";
import type {
  PortfolioActivityItem,
  PortfolioRange,
  PortfolioSnapshot,
  PortfolioSummary,
  TradingCalendarDayResponse,
  TradingCalendarResponse,
} from "@/types";

interface PortfolioState {
  wallet?: string;
  portfolio?: PortfolioSummary;
  history: PortfolioSnapshot[];
  activity: PortfolioActivityItem[];
  calendar?: TradingCalendarResponse;
  calendarDay?: TradingCalendarDayResponse;
  isLoading: boolean;
  isCalendarLoading: boolean;
  error?: string;
  loadPortfolio: (wallet: string) => Promise<void>;
  loadHistory: (wallet: string, range?: PortfolioRange) => Promise<void>;
  loadActivity: (wallet: string) => Promise<void>;
  loadCalendar: (wallet: string, input: { month?: string; start?: string; end?: string; timeZone?: string }) => Promise<void>;
  loadCalendarDay: (wallet: string, date: string, input: { timeZone?: string }) => Promise<void>;
  reset: () => void;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  history: [],
  activity: [],
  isLoading: false,
  isCalendarLoading: false,
  async loadPortfolio(wallet) {
    const update = sessionSetter(set);
    update({ wallet, isLoading: true, error: undefined });
    try {
      const portfolio = await getPortfolio(wallet);
      update({ portfolio, isLoading: false });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to load portfolio", isLoading: false });
    }
  },
  async loadHistory(wallet, range) {
    const update = sessionSetter(set);
    try {
      const history = await getPortfolioHistory(wallet, range);
      update({ history });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to load portfolio history" });
    }
  },
  async loadActivity(wallet) {
    const update = sessionSetter(set);
    try {
      const activity = await getPortfolioActivity(wallet);
      update({ activity });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to load portfolio activity" });
    }
  },
  async loadCalendar(wallet, input) {
    const update = sessionSetter(set);
    update({ wallet, isCalendarLoading: true, error: undefined });
    try {
      const calendar = await getTradingCalendar(wallet, input);
      update({ calendar, isCalendarLoading: false });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to load trading calendar", isCalendarLoading: false });
    }
  },
  async loadCalendarDay(wallet, date, input) {
    const update = sessionSetter(set);
    update({ isCalendarLoading: true, error: undefined });
    try {
      const calendarDay = await getTradingCalendarDay(wallet, date, input);
      update({ calendarDay, isCalendarLoading: false });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to load calendar day", isCalendarLoading: false });
    }
  },
  reset() {
    set({ wallet: undefined, portfolio: undefined, history: [], activity: [], calendar: undefined, calendarDay: undefined, error: undefined, isLoading: false, isCalendarLoading: false });
  },
}));
