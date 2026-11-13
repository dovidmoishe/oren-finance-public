import type {
  AgentPageContext,
  AgentPortfolioContext,
} from '../../types/agent';
import type { Portfolio } from '../../types/portfolio';
import { DRIP_AGENT_GUIDANCE, OREN_AGENT_PROMPT } from './agent.prompt';

export function portfolioToContext(
  portfolio: Portfolio,
): AgentPortfolioContext {
  return {
    totalValueUsd: portfolio.totalValueUsd,
    availableValueUsd: portfolio.availableValueUsd,
    lockedValueUsd: portfolio.lockedValueUsd,
    cashValueUsd: portfolio.cashValueUsd,
    changeUsd: portfolio.absoluteChangeUsd,
    changePct: portfolio.percentChange,
    positions: portfolio.positions.map((position) => ({
      assetId: position.assetId,
      ticker: position.ticker,
      name: position.name,
      quantity: position.quantity,
      valueUsd: position.valueUsd,
      allocationPct: position.allocationPercent,
      change24hPct: position.priceChange24h,
    })),
    updatedAt: portfolio.updatedAt.toISOString(),
  };
}

export function buildInstructions(
  walletAddress: string,
  context?: AgentPageContext,
  portfolio?: AgentPortfolioContext,
  options?: { includeDrip?: boolean },
): string {
  const sections = [OREN_AGENT_PROMPT];
  if (options?.includeDrip) sections.push(DRIP_AGENT_GUIDANCE);
  else
    sections.push(
      'Writer opinions are not available on this turn. If the user asks what people or writers are saying, or for sentiment, say that plainly. Do not answer from the news feed, from Oren technical analysis, or from an opportunity score and present it as those opinions, Drip, Drip Stack, or sentiment.',
    );
  sections.push(walletSection(walletAddress));

  if (portfolio) {
    sections.push(portfolioSection(portfolio));
  } else {
    sections.push(
      'Portfolio snapshot: unavailable for this turn. Call getPortfolio with the connected wallet before sizing trades or giving holdings-specific advice.',
    );
  }

  if (context) {
    const asset =
      context.page === 'stock' && context.assetId
        ? ` The user is viewing stock asset ${context.assetId}.`
        : '';
    sections.push(
      `Interface context: the user is currently on the ${context.page} page.${asset} Use this only to make the response more relevant; do not claim you inspected page data without a tool call.`,
    );
  }

  return sections.join('\n\n');
}

function walletSection(walletAddress: string): string {
  return [
    'Connected wallet context:',
    `- Solana wallet: ${walletAddress}`,
    '- The user is already connected in the Oren app. Never ask them to paste a wallet address or connect a wallet.',
    '- Tools always act on this connected wallet; you never pass a wallet address to a tool.',
  ].join('\n');
}

function portfolioSection(portfolio: AgentPortfolioContext): string {
  const topHoldings = [...portfolio.positions]
    .sort((left, right) => right.valueUsd - left.valueUsd)
    .slice(0, 8)
    .map(
      (position) =>
        `${position.ticker} ${position.allocationPct.toFixed(1)}% ($${formatUsd(position.valueUsd)})`,
    )
    .join(', ');

  const lines = [
    'Observed portfolio snapshot (from Oren services):',
    `- Total value: $${formatUsd(portfolio.totalValueUsd)}`,
    `- Available: $${formatUsd(portfolio.availableValueUsd)} | Locked: $${formatUsd(portfolio.lockedValueUsd)} | Cash: $${formatUsd(portfolio.cashValueUsd ?? 0)}`,
  ];

  if (portfolio.changeUsd !== undefined && portfolio.changePct !== undefined) {
    lines.push(
      `- Recent change: ${portfolio.changeUsd >= 0 ? '+' : ''}$${formatUsd(Math.abs(portfolio.changeUsd))} (${portfolio.changePct >= 0 ? '+' : ''}${portfolio.changePct.toFixed(2)}%)`,
    );
  }

  if (topHoldings) {
    lines.push(`- Top holdings: ${topHoldings}`);
  } else {
    lines.push('- Top holdings: none (cash-only or empty portfolio)');
  }

  if (portfolio.updatedAt) {
    lines.push(`- Snapshot time: ${portfolio.updatedAt}`);
  }

  lines.push(
    '- Use this snapshot for concentration, sizing, and personalized advice. Call getPortfolio before preparing trades or quotes if balances may have changed.',
  );

  return lines.join('\n');
}

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
