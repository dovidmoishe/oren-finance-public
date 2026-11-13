import { ProductWalkthrough } from "./product-walkthrough";

export function ProductIntroduction() {
  return (
    <div aria-label="Oren product preview" className="relative z-10 scroll-mt-24 pb-16 sm:pb-24" id="product">
      <ProductWalkthrough />
      <p className="mt-3 text-center text-xs text-[#676762]">Illustrative demo. Prices, scores, allocations, and fees are examples, not live market data.</p>
    </div>
  );
}
