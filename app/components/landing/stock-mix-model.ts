export type MixSymbol = "NVDA" | "AAPL" | "MSFT" | "TSLA";
export type MixHolding = { symbol: MixSymbol; weight: number };

export const initialMix: MixHolding[] = [
  { symbol: "NVDA", weight: 40 },
  { symbol: "AAPL", weight: 35 },
  { symbol: "MSFT", weight: 25 },
];

// Largest remainders keep whole percentages and preserve the exact total.
function distribute(holdings: MixHolding[], total: number): MixHolding[] {
  if (!holdings.length) return [];
  const sum = holdings.reduce((value, holding) => value + holding.weight, 0);
  const shares = holdings.map((holding) => total * (sum ? holding.weight / sum : 1 / holdings.length));
  const weights = shares.map(Math.floor);
  const order = shares.map((share, index) => ({ index, remainder: share - weights[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = total - weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < remaining; index++) weights[order[index].index]++;
  return holdings.map((holding, index) => ({ ...holding, weight: weights[index] }));
}

export function setMixWeight(holdings: MixHolding[], symbol: MixSymbol, value: number): MixHolding[] {
  if (!holdings.some((holding) => holding.symbol === symbol) || !Number.isFinite(value)) return holdings;
  if (holdings.length === 1) return [{ symbol: holdings[0].symbol, weight: 100 }];
  const weight = Math.max(0, Math.min(100, Math.round(value)));
  const others = distribute(holdings.filter((holding) => holding.symbol !== symbol), 100 - weight);
  return holdings.map((holding) => holding.symbol === symbol ? { symbol, weight } : others.find((other) => other.symbol === holding.symbol)!);
}

export function toggleMixStock(holdings: MixHolding[], symbol: MixSymbol): MixHolding[] {
  if (holdings.some((holding) => holding.symbol === symbol)) {
    return holdings.length === 1 ? holdings : distribute(holdings.filter((holding) => holding.symbol !== symbol), 100);
  }
  const weight = Math.round(100 / (holdings.length + 1));
  return [...distribute(holdings, 100 - weight), { symbol, weight }];
}

export function equalMix(holdings: MixHolding[]): MixHolding[] {
  return distribute(holdings.map((holding) => ({ ...holding, weight: 1 })), 100);
}

export function mixAmounts(holdings: MixHolding[], budget: number): number[] {
  return distribute(holdings, Math.round(budget * 100)).map((holding) => holding.weight / 100);
}

export function applyMixRequest(holdings: MixHolding[], budget: number, prompt: string) {
  let next = holdings;
  let amount = budget;
  let recognized = false;
  const request = prompt.toLowerCase();
  const match = request.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (match) {
    const requested = Number(match[1].replaceAll(",", ""));
    if (requested >= 10 && requested <= 10000) { amount = requested; recognized = true; }
  }
  if (/equal|even/.test(request)) { next = equalMix(next); recognized = true; }
  if (/add.*tesla|add.*tsla/.test(request)) {
    if (!next.some((holding) => holding.symbol === "TSLA")) next = toggleMixStock(next, "TSLA");
    recognized = true;
  }
  if (/less.*nvidia|reduce.*nvidia|less.*nvda|reduce.*nvda/.test(request)) {
    const nvidia = next.find((holding) => holding.symbol === "NVDA");
    if (nvidia) next = setMixWeight(next, "NVDA", Math.max(0, nvidia.weight - 10));
    recognized = true;
  }
  return { holdings: next, budget: amount, recognized };
}
