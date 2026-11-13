import Image from "next/image";
import { stockLogos } from "./stock-logo-assets";

export function StockLogo({ ticker, size = 28 }: { ticker: string; size?: number }) {
  const logo = stockLogos[ticker.toUpperCase() as keyof typeof stockLogos];
  return logo ? <Image src={logo} alt={`${ticker} logo`} width={size} height={size} className="shrink-0 rounded-full" /> : null;
}
