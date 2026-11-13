import type { StockAnalysis, TechnicalBrief } from '../../../types/analysis';
import { plainTechnicalRead } from './plain-read';

export function buildTechnicalSummary(input: {
  ticker: string;
  opportunityScore: number;
  riskLabel?: StockAnalysis['riskLabel'];
  technicalBrief: TechnicalBrief;
}): string {
  const read = plainTechnicalRead(input);
  return [read.lead, ...read.bullets].join(' ');
}
