import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  TradingCalendarAgentEvent,
  TradingCalendarContributor,
  TradingCalendarDayResponse,
  TradingCalendarDaySummary,
  TradingCalendarEvent,
  TradingCalendarQuery,
  TradingCalendarResponse,
  TradingCalendarTrade,
  TradingCalendarVaultEvent,
} from '../../types/calendar';
import type { ExecutionStatus, ExecutionType } from '../../types/execution';
import type { WalletTransaction } from '../../types/providers';
import { AlchemyService } from '../alchemy/alchemy.service';
import { routeVenueLabel } from '../execution/route-label';
import type {
  AgentMessageRow,
  ExecutionRow,
  SnapshotRow,
  VaultPositionRow,
} from './portfolio.repository';
import { equityValueFromSnapshot } from './portfolio.mapper';
import { PortfolioRepository } from './portfolio.repository';

const DAY_MS = 86_400_000;
const DEFAULT_TIME_ZONE = 'UTC';

@Injectable()
export class PortfolioCalendarService {
  private readonly logger = new Logger(PortfolioCalendarService.name);

  constructor(
    private readonly repository: PortfolioRepository,
    private readonly alchemy: AlchemyService,
  ) {}

  async getCalendar(
    walletAddress: string,
    query: TradingCalendarQuery = {},
  ): Promise<TradingCalendarResponse> {
    const range = parseCalendarRange(query);
    const data = await this.loadRange(walletAddress, range.startUtc, range.endUtc);
    const days = buildDaySummaries({
      dates: eachDate(range.startDate, range.endDate),
      timeZone: range.timeZone,
      snapshots: data.snapshots,
      previousSnapshot: data.previousSnapshot,
      executions: data.executions,
      vaultPositions: data.vaultPositions,
      agentMessages: data.agentMessages,
    });

    return {
      walletAddress,
      timeZone: range.timeZone,
      range: {
        start: range.startDate,
        end: range.endDate,
        month: range.month,
      },
      days,
      notes: calendarNotes(),
    };
  }

  async getDay(
    walletAddress: string,
    date: string,
    query: Pick<TradingCalendarQuery, 'timeZone'> = {},
  ): Promise<TradingCalendarDayResponse> {
    const timeZone = normalizeTimeZone(query.timeZone);
    assertDate(date, 'date');
    const startUtc = zonedDateToUtc(date, timeZone);
    const endUtc = addLocalDays(date, 1, timeZone);
    const data = await this.loadRange(walletAddress, startUtc, endUtc);
    const summary = buildDaySummaries({
      dates: [date],
      timeZone,
      snapshots: data.snapshots,
      previousSnapshot: data.previousSnapshot,
      executions: data.executions,
      vaultPositions: data.vaultPositions,
      agentMessages: data.agentMessages,
    })[0];
    const dayStart = zonedDateToUtc(date, timeZone);
    const dayEnd = addLocalDays(date, 1, timeZone);
    const walletActivity = await this.alchemy
      .getTransactionHistory(walletAddress, { limit: 50 })
      .then((items) =>
        items
          .filter((item) => isDateInWindow(item.blockTime, dayStart, dayEnd))
          .map(walletActivityToEvent),
      )
      .catch((err) => {
        this.logger.warn(
          `calendar wallet activity failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      });

    return {
      walletAddress,
      timeZone,
      date,
      summary: {
        ...summary,
        eventCount: summary.eventCount + walletActivity.length,
      },
      contributors: buildContributorsForDay(
        data.previousSnapshot,
        data.snapshots,
        date,
        timeZone,
      ),
      trades: data.executions
        .filter((row) => isDateInWindow(row.createdAt, dayStart, dayEnd))
        .map(executionToTrade),
      vaultEvents: vaultEventsForDay(data.vaultPositions, dayStart, dayEnd),
      agentEvents: data.agentMessages
        .filter((row) => isDateInWindow(row.createdAt, dayStart, dayEnd))
        .map(agentMessageToEvent),
      walletActivity,
      notes: calendarNotes(),
    };
  }

  private async loadRange(walletAddress: string, start: Date, end: Date) {
    const [previousSnapshot, snapshots, executions, vaultPositions, agentMessages] =
      await Promise.all([
        this.repository.getSnapshotBefore(walletAddress, start),
        this.repository.listSnapshotsInRange(walletAddress, start, end),
        this.repository.listExecutionsInRange(walletAddress, start, end),
        this.repository.listVaultPositionsInRange(walletAddress, start, end),
        this.repository.listAgentToolMessagesInRange(walletAddress, start, end),
      ]);

    return {
      previousSnapshot,
      snapshots,
      executions,
      vaultPositions,
      agentMessages,
    };
  }
}

export function parseCalendarRange(query: TradingCalendarQuery = {}) {
  const timeZone = normalizeTimeZone(query.timeZone);
  if (query.month) {
    if (!/^\d{4}-\d{2}$/.test(query.month)) {
      throw new BadRequestException('month must use YYYY-MM');
    }
    const [year, month] = query.month.split('-').map(Number);
    const startDate = `${year}-${pad2(month)}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endExclusiveDate = `${nextYear}-${pad2(nextMonth)}-01`;
    return {
      timeZone,
      month: query.month,
      startDate,
      endDate: formatDateKey(new Date(zonedDateToUtc(endExclusiveDate, timeZone).getTime() - DAY_MS), timeZone),
      startUtc: zonedDateToUtc(startDate, timeZone),
      endUtc: zonedDateToUtc(endExclusiveDate, timeZone),
    };
  }

  const now = new Date();
  const defaultMonth = formatDateKey(now, timeZone).slice(0, 7);
  const start = query.start ?? `${defaultMonth}-01`;
  const end = query.end ?? formatDateKey(now, timeZone);
  assertDate(start, 'start');
  assertDate(end, 'end');
  const startUtc = zonedDateToUtc(start, timeZone);
  const endUtc = addLocalDays(end, 1, timeZone);
  if (startUtc >= endUtc) {
    throw new BadRequestException('start must be on or before end');
  }

  return {
    timeZone,
    startDate: start,
    endDate: end,
    startUtc,
    endUtc,
  };
}

export function buildDaySummaries(input: {
  dates: string[];
  timeZone: string;
  snapshots: SnapshotRow[];
  previousSnapshot: SnapshotRow | null;
  executions: ExecutionRow[];
  vaultPositions: VaultPositionRow[];
  agentMessages: AgentMessageRow[];
}): TradingCalendarDaySummary[] {
  const chronological = [
    ...(input.previousSnapshot ? [input.previousSnapshot] : []),
    ...input.snapshots,
  ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return input.dates.map((date) => {
    const start = zonedDateToUtc(date, input.timeZone);
    const end = addLocalDays(date, 1, input.timeZone);
    const daySnapshots = input.snapshots.filter((row) =>
      isDateInWindow(row.timestamp, start, end),
    );
    const opening =
      [...chronological].reverse().find((row) => row.timestamp < start) ??
      daySnapshots[0] ??
      null;
    const closing = daySnapshots[daySnapshots.length - 1] ?? opening;
    const hasData = Boolean(daySnapshots.length || opening);
    const openingValue = opening ? equityValueFromSnapshot(opening) : 0;
    const closingValue = closing ? equityValueFromSnapshot(closing) : 0;
    const pnlUsd = roundMoney(closingValue - openingValue);
    const returnPct =
      openingValue > 0 ? roundPercent((pnlUsd / openingValue) * 100) : 0;
    const confirmedSales = input.executions.filter(
      (row) =>
        row.status === 'confirmed' &&
        row.type === 'stock_sale' &&
        isDateInWindow(row.createdAt, start, end),
    );
    const realizedActivityUsd = roundMoney(
      confirmedSales.reduce((sum, row) => sum + Number(row.amountUsd ?? 0), 0),
    );
    const contributors = opening && closing
      ? compareContributors(opening, closing)
      : [];
    const events = significantEventsForDay({
      start,
      end,
      pnlUsd,
      returnPct,
      executions: input.executions,
      vaultPositions: input.vaultPositions,
      agentMessages: input.agentMessages,
    });

    return {
      date,
      hasData,
      openingValueUsd: roundMoney(openingValue),
      closingValueUsd: roundMoney(closingValue),
      pnlUsd,
      returnPct,
      realizedActivityUsd,
      unrealizedMovementUsd: roundMoney(pnlUsd - realizedActivityUsd),
      availableValueUsd: closing ? roundMoney(Number(closing.availableValueUsd)) : 0,
      lockedValueUsd: closing ? roundMoney(Number(closing.lockedValueUsd)) : 0,
      cumulativeValueUsd: roundMoney(closingValue),
      eventCount: events.length,
      significantEvents: events.slice(0, 4),
      bestContributor: contributors[0],
      worstContributor: contributors.at(-1),
    };
  });
}

function significantEventsForDay(input: {
  start: Date;
  end: Date;
  pnlUsd: number;
  returnPct: number;
  executions: ExecutionRow[];
  vaultPositions: VaultPositionRow[];
  agentMessages: AgentMessageRow[];
}): TradingCalendarEvent[] {
  const events: TradingCalendarEvent[] = [];

  for (const row of input.executions) {
    if (!isDateInWindow(row.createdAt, input.start, input.end)) continue;
    events.push(executionToSignificantEvent(row));
  }
  for (const row of vaultEventsForDay(input.vaultPositions, input.start, input.end)) {
    events.push({
      id: row.id,
      type: row.type === 'lock_created' ? 'lock' : 'unlock',
      title: row.type === 'lock_created' ? 'Vault lock created' : 'Vault unlock due',
      ticker: row.ticker,
      assetId: row.assetId,
      detail: row.ticker ? `${row.ticker} vault event` : 'Vault event',
      occurredAt: row.occurredAt,
    });
  }
  for (const row of input.agentMessages) {
    if (!isDateInWindow(row.createdAt, input.start, input.end)) continue;
    events.push({
      id: row.id,
      type: 'agent',
      title: `Oren used ${row.toolName ?? 'a tool'}`,
      detail: summarizeToolPayload(row.toolPayload),
      occurredAt: row.createdAt,
    });
  }
  if (Math.abs(input.returnPct) >= 5 || Math.abs(input.pnlUsd) >= 100) {
    events.push({
      id: `movement-${input.start.toISOString()}`,
      type: 'movement',
      title: input.pnlUsd >= 0 ? 'Large portfolio gain' : 'Large portfolio drawdown',
      amountUsd: input.pnlUsd,
      detail: `${formatSignedPercent(input.returnPct)} observed daily move`,
      occurredAt: input.end,
    });
  }

  return events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

function buildContributorsForDay(
  previousSnapshot: SnapshotRow | null,
  snapshots: SnapshotRow[],
  date: string,
  timeZone: string,
): TradingCalendarContributor[] {
  const start = zonedDateToUtc(date, timeZone);
  const end = addLocalDays(date, 1, timeZone);
  const daySnapshots = snapshots.filter((row) =>
    isDateInWindow(row.timestamp, start, end),
  );
  const opening =
    previousSnapshot && previousSnapshot.timestamp < start
      ? previousSnapshot
      : daySnapshots[0];
  const closing = daySnapshots[daySnapshots.length - 1] ?? opening;
  return opening && closing ? compareContributors(opening, closing) : [];
}

function compareContributors(
  opening: SnapshotRow,
  closing: SnapshotRow,
): TradingCalendarContributor[] {
  const before = positionMap(opening);
  const after = positionMap(closing);
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys]
    .map((key) => {
      const a = before.get(key);
      const b = after.get(key);
      const openingValue = a?.valueUsd ?? 0;
      const closingValue = b?.valueUsd ?? 0;
      return {
        assetId: b?.assetId ?? a?.assetId ?? key,
        ticker: b?.ticker ?? a?.ticker ?? key,
        name: b?.name ?? a?.name,
        logo: b?.logo ?? a?.logo,
        valueChangeUsd: roundMoney(closingValue - openingValue),
        valueChangePct:
          openingValue > 0
            ? roundPercent(((closingValue - openingValue) / openingValue) * 100)
            : 0,
        openingValueUsd: roundMoney(openingValue),
        closingValueUsd: roundMoney(closingValue),
      };
    })
    .filter((item) => item.openingValueUsd > 0 || item.closingValueUsd > 0)
    .sort((a, b) => b.valueChangeUsd - a.valueChangeUsd);
}

function positionMap(snapshot: SnapshotRow) {
  const positions = Array.isArray(snapshot.positionsJson)
    ? snapshot.positionsJson
    : [];
  const map = new Map<
    string,
    {
      assetId: string;
      ticker: string;
      name?: string;
      logo?: string;
      valueUsd: number;
    }
  >();

  for (const item of positions) {
    const row = item as Record<string, unknown>;
    const assetId = String(row.assetId ?? row.ticker ?? '');
    if (!assetId) continue;
    map.set(assetId, {
      assetId,
      ticker: String(row.ticker ?? assetId),
      name: typeof row.name === 'string' ? row.name : undefined,
      logo: typeof row.logo === 'string' ? row.logo : undefined,
      valueUsd: Number(row.valueUsd ?? 0),
    });
  }
  return map;
}

function executionToSignificantEvent(row: ExecutionRow): TradingCalendarEvent {
  const type =
    row.type === 'basket_purchase'
      ? 'basket'
      : row.type === 'lock'
        ? 'lock'
        : row.type === 'unlock'
          ? 'unlock'
          : 'trade';
  return {
    id: row.id,
    type,
    title: titleForExecution(row.type as ExecutionType),
    detail: row.ticker ? `${row.ticker} ${row.status}` : row.status,
    ticker: row.ticker ?? undefined,
    assetId: row.assetId ?? undefined,
    amountUsd: row.amountUsd !== null ? Number(row.amountUsd) : undefined,
    status: row.status,
    route: routeVenueLabel(row.provider),
    occurredAt: row.createdAt,
  };
}

function executionToTrade(row: ExecutionRow): TradingCalendarTrade {
  return {
    id: row.id,
    type: row.type as ExecutionType,
    ticker: row.ticker ?? undefined,
    assetId: row.assetId ?? undefined,
    amount: row.amount !== null ? Number(row.amount) : undefined,
    amountUsd: row.amountUsd !== null ? Number(row.amountUsd) : undefined,
    status: row.status as ExecutionStatus,
    transactionSignature: row.transactionSignature ?? undefined,
    route: routeVenueLabel(row.provider),
    occurredAt: row.createdAt,
  };
}

function vaultEventsForDay(
  rows: VaultPositionRow[],
  start: Date,
  end: Date,
): TradingCalendarVaultEvent[] {
  const events: TradingCalendarVaultEvent[] = [];
  for (const row of rows) {
    if (isDateInWindow(row.createdAt, start, end)) {
      events.push(vaultEvent(row, 'lock_created', row.createdAt));
    }
    if (isDateInWindow(row.unlockAt, start, end)) {
      events.push(vaultEvent(row, 'unlock_due', row.unlockAt));
    }
  }
  return events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

function vaultEvent(
  row: VaultPositionRow,
  type: TradingCalendarVaultEvent['type'],
  occurredAt: Date,
): TradingCalendarVaultEvent {
  return {
    id: `${row.id}-${type}`,
    type,
    lockAddress: row.lockAddress,
    ticker: row.ticker ?? undefined,
    assetId: row.assetId ?? undefined,
    amount: Number(row.amount),
    occurredAt,
    transactionSignature: row.transactionSignature,
  };
}

function agentMessageToEvent(row: AgentMessageRow): TradingCalendarAgentEvent {
  return {
    id: row.id,
    toolName: row.toolName ?? 'tool',
    summary: summarizeToolPayload(row.toolPayload),
    occurredAt: row.createdAt,
  };
}

function walletActivityToEvent(tx: WalletTransaction): TradingCalendarEvent {
  return {
    id: tx.signature,
    type: 'wallet',
    title: 'Wallet transaction',
    detail: tx.status,
    status: tx.status,
    occurredAt: tx.blockTime ?? new Date(),
  };
}

function titleForExecution(type: ExecutionType): string {
  switch (type) {
    case 'stock_purchase': return 'Stock purchase';
    case 'stock_sale': return 'Stock sale';
    case 'basket_purchase': return 'Basket purchase';
    case 'lock': return 'Vault lock';
    case 'unlock': return 'Vault unlock';
    case 'limit_buy': return 'Limit buy';
    case 'limit_sell': return 'Limit sell';
    case 'limit_cancel': return 'Limit cancel';
  }
}

function summarizeToolPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'Tool result recorded';
  const record = payload as Record<string, unknown>;
  const target =
    record.assetIdOrTicker ?? record.ticker ?? record.slug ?? record.wallet;
  return target ? `Context: ${String(target)}` : 'Tool result recorded';
}

function calendarNotes() {
  return [
    'Calendar P&L tracks observed stock holdings only; idle cash is excluded.',
    'Realized activity is estimated from confirmed sale notional and is not tax or cost-basis accounting.',
    'Solana remains the financial source of truth; Postgres is Oren memory.',
  ];
}

function normalizeTimeZone(value?: string): string {
  const timeZone = value?.trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    throw new BadRequestException('timeZone must be a valid IANA timezone');
  }
}

function assertDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD`);
  }
}

function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function addLocalDays(date: string, days: number, timeZone: string): Date {
  const cursor = new Date(`${date}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return zonedDateToUtc(cursor.toISOString().slice(0, 10), timeZone);
}

function zonedDateToUtc(date: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = timeZoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - date.getTime();
}

function formatDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isDateInWindow(date: Date | undefined | null, start: Date, end: Date) {
  if (!date) return false;
  return date >= start && date < end;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${roundPercent(value)}%`;
}
