// Pricing (client-safe). One Compute Unit (CU) covers five locations or areas returned.
// Balances are kept in units: one unit is one returned location or area, so 5 units = 1 CU.
export const UNITS_PER_CU = 5;
export const FREE_CU = 500;
export const FREE_UNITS = FREE_CU * UNITS_PER_CU;
/** US dollars per CU. */
export const CU_PRICE_USD = 0.005;
export const MIN_TOPUP_USD = 20;
export const MAX_TOPUP_USD = 5000;
export const TOPUP_PRESETS = [20, 50, 100, 250];

export const unitsToCu = (units: number) => units / UNITS_PER_CU;
export const cuForDollars = (usd: number) => Math.floor(usd / CU_PRICE_USD);
export const formatCu = (units: number) => {
  const cu = unitsToCu(units);
  return Number.isInteger(cu) ? cu.toLocaleString("en-US") : cu.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};
export const formatUsd = (usd: number) => `$${usd.toLocaleString("en-US", { minimumFractionDigits: usd % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
