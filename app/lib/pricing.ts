// Pricing (client-safe). A Compute Unit (CU) is the GPU and CPU work EDK-1 needs to process a request.
// Discover is metered by what it returns. Standard results cost 0.2 CU and spatial results cost 0.3 CU.
// One balance unit is 0.2 CU. Spatial results can spend half units.
export const UNITS_PER_CU = 5;
/** Free CU every account gets each calendar month. */
export const FREE_CU = 120;
export const FREE_UNITS = FREE_CU * UNITS_PER_CU;
/** US dollars per CU. */
export const CU_PRICE_USD = 0.005;
export const MIN_TOPUP_USD = 20;
export const MAX_TOPUP_USD = 5000;
export const TOPUP_PRESETS = [20, 50, 100, 250, 500, 1000];

export const unitsToCu = (units: number) => units / UNITS_PER_CU;
export const cuForDollars = (usd: number) => Math.floor(usd / CU_PRICE_USD);
export const formatCu = (units: number) => {
  const cu = unitsToCu(units);
  return Number.isInteger(cu) ? cu.toLocaleString("en-US") : cu.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};
export const formatUsd = (usd: number) => `$${usd.toLocaleString("en-US", { minimumFractionDigits: usd % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** One sentence on what a CU is, for pages that explain billing. */
export const CU_DEFINITION = "A Compute Unit (CU) is the GPU and CPU work EDK-1 needs to process a request.";


export const SIGNALS_MONTHLY_CENTS = 4999;
export const SIGNALS_ANNUAL_CENTS = SIGNALS_MONTHLY_CENTS * 12;
