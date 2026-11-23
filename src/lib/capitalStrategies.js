import {
  computeHouseholdPaystubSummary,
  getEmployerRestrictedTickers,
  getOwnerDisplayName,
  todayIsoDate,
  toNumber,
} from './finance.js';
import { daysBetweenIso } from './payrollSync.js';
import {
  createDefaultOptionsDesk,
  normalizeOptionsDesk,
  sanitizeOptionsDeskForDb,
} from './optionsDeskSchema.js';

export { createDefaultOptionsDesk, normalizeOptionsDesk, sanitizeOptionsDeskForDb };

export const RISK_PROFILES = {
  low: {
    key: 'low',
    label: 'Low Risk',
    subtitle: 'Ultra-conservative income • 15–18Δ • 30–45 DTE • T-Bill heavy',
    targetDelta: 0.16,
    defaultDte: 35,
    tbillPct: 55,
    cspPct: 30,
    coreIndexPct: 15,
    maxSingleTickerPct: 15,
    profitTakePct: 50,
    manageDte: 21,
    stopLossMultiple: 2.0,
    maxIvAllowed: 0.28,
  },
  low_medium: {
    key: 'low_medium',
    label: 'Low–Medium',
    subtitle: 'Balanced cash yield + Wheel • 20–25Δ • 30–45 DTE',
    targetDelta: 0.22,
    defaultDte: 35,
    tbillPct: 40,
    cspPct: 40,
    coreIndexPct: 20,
    maxSingleTickerPct: 20,
    profitTakePct: 50,
    manageDte: 21,
    stopLossMultiple: 2.0,
    maxIvAllowed: 0.36,
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    subtitle: 'Active premium capture • 25–30Δ • 28–35 DTE • Strict roll rules',
    targetDelta: 0.27,
    defaultDte: 30,
    tbillPct: 25,
    cspPct: 50,
    coreIndexPct: 25,
    maxSingleTickerPct: 25,
    profitTakePct: 50,
    manageDte: 21,
    stopLossMultiple: 2.0,
    maxIvAllowed: 0.5,
  },
};

export const TBILL_BENCHMARK_YIELD = 0.042; // ~4.2% T-Bill / SGOV / FDLXX benchmark

export const NO_STATE_INCOME_TAX_STATES = new Set([
  'AK',
  'FL',
  'NV',
  'NH',
  'SD',
  'TN',
  'TX',
  'WA',
  'WY',
]);

// Curated liquid underlyings for Low-to-Medium risk CSP / Wheel / Credit Spread deployment.
// Any ticker detected as employer-restricted (e.g., GOOG/GOOGL/CSCO) is automatically excluded at runtime.
export const CSP_CANDIDATE_UNIVERSE = [
  {
    symbol: 'SCHD',
    name: 'Schwab US Dividend Equity ETF',
    kind: 'etf',
    riskTier: 'low',
    typicalIv: 0.14,
    fallbackPrice: 29,
    note: 'Low-beta dividend ETF (~$2.9k/contract) — ideal starter Wheel',
  },
  {
    symbol: 'JEPQ',
    name: 'JPMorgan Nasdaq Equity Premium',
    kind: 'etf',
    riskTier: 'low',
    typicalIv: 0.16,
    fallbackPrice: 56,
    note: 'Monthly income Nasdaq ETF (~$5.6k/contract), steady volatility',
  },
  {
    symbol: 'SPLG',
    name: 'SPDR Portfolio S&P 500 ETF',
    kind: 'etf',
    riskTier: 'low',
    typicalIv: 0.15,
    fallbackPrice: 71,
    note: 'Low-cost S&P 500 (~$7.1k/contract) — easiest way to Wheel the S&P 500',
  },
  {
    symbol: 'KO',
    name: 'Coca-Cola Co.',
    kind: 'stock',
    riskTier: 'low',
    typicalIv: 0.16,
    fallbackPrice: 68,
    note: 'Defensive consumer staple with 3%+ dividend cushion',
  },
  {
    symbol: 'QQQM',
    name: 'Invesco Nasdaq-100 ETF',
    kind: 'etf',
    riskTier: 'low_medium',
    typicalIv: 0.21,
    fallbackPrice: 218,
    note: 'Liquid Nasdaq-100 ETF (~$21.8k/contract), solid premium/risk ratio',
  },
  {
    symbol: 'IWM',
    name: 'iShares Russell 2000 ETF',
    kind: 'etf',
    riskTier: 'low_medium',
    typicalIv: 0.23,
    fallbackPrice: 225,
    note: 'Broad small-cap index — rich option liquidity & zero single-stock earnings shock',
  },
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    kind: 'stock',
    riskTier: 'low_medium',
    typicalIv: 0.24,
    fallbackPrice: 230,
    note: 'Mega-cap balance sheet; avoid selling across quarterly earnings week',
  },
  {
    symbol: 'AMZN',
    name: 'Amazon.com Inc.',
    kind: 'stock',
    riskTier: 'low_medium',
    typicalIv: 0.29,
    fallbackPrice: 210,
    note: 'High liquidity, strong CSP premiums; avoid earnings binary weeks',
  },
  {
    symbol: 'JPM',
    name: 'JPMorgan Chase & Co.',
    kind: 'stock',
    riskTier: 'low_medium',
    typicalIv: 0.22,
    fallbackPrice: 245,
    note: 'Quality financial leader with ~2% dividend & steady IV',
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corp.',
    kind: 'stock',
    riskTier: 'low_medium',
    typicalIv: 0.23,
    fallbackPrice: 430,
    note: 'Blue-chip cloud leader; use Put Credit Spread if $43k/contract is too large',
  },
  {
    symbol: 'BRK-B',
    name: 'Berkshire Hathaway Class B',
    kind: 'stock',
    riskTier: 'low',
    typicalIv: 0.16,
    fallbackPrice: 465,
    note: 'Ultra-defensive conglomerate; consider credit spread for smaller accounts',
  },
  {
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    kind: 'etf',
    riskTier: 'low',
    typicalIv: 0.15,
    fallbackPrice: 595,
    note: 'Deepest option market on earth; use SPLG or $5/$10 Put Credit Spreads for smaller sizing',
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    kind: 'stock',
    riskTier: 'medium',
    typicalIv: 0.44,
    fallbackPrice: 140,
    note: 'High-IV tech leader — medium risk only; keep delta ≤ 0.18 and skip earnings',
  },
];

const TICKER_RE = /^[A-Z0-9.\-^=]{1,14}$/;

/**
 * Safely persists `options_desk` inside `tax_comp_profiles.paystub_details` under AAL2 RLS
 * without disturbing primary/spouse paystubs, tax_planning, or payroll_autosync.
 */
export async function persistOptionsDeskState(supabase, userId, nextOptionsDesk) {
  const { data: existingRow, error: fetchErr } = await supabase
    .from('tax_comp_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  const existingDetails =
    existingRow?.paystub_details && typeof existingRow.paystub_details === 'object'
      ? existingRow.paystub_details
      : {};

  const sanitizedDesk = sanitizeOptionsDeskForDb(nextOptionsDesk);
  const nextDetails = {
    ...existingDetails,
    options_desk: sanitizedDesk,
  };

  if (existingRow) {
    const { error: updErr } = await supabase
      .from('tax_comp_profiles')
      .update({
        paystub_details: nextDetails,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    if (updErr) throw updErr;
  } else {
    const { error: insErr } = await supabase.from('tax_comp_profiles').upsert(
      {
        user_id: userId,
        paystub_details: nextDetails,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (insErr) throw insErr;
  }

  return sanitizedDesk;
}

// ============================================================================
// BLACK-SCHOLES OPTION PRICING & DELTA ENGINE
// ============================================================================

function normCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * erf);
}

// Rational approximation to inverse standard normal CDF (Acklam's method)
function normInv(p) {
  const clamped = Math.max(1e-6, Math.min(1 - 1e-6, p));
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q;
  let r;
  if (clamped < pLow) {
    q = Math.sqrt(-2 * Math.log(clamped));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (clamped <= pHigh) {
    q = clamped - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - clamped));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

export function roundToStandardStrike(price, direction = 'nearest') {
  const p = Math.max(0.5, toNumber(price));
  const step = p < 25 ? 0.5 : p < 100 ? 1 : p < 200 ? 2.5 : 5;
  if (direction === 'up') return Number((Math.ceil(p / step) * step).toFixed(2));
  if (direction === 'down') return Number((Math.floor(p / step) * step).toFixed(2));
  return Number((Math.round(p / step) * step).toFixed(2));
}

export function blackScholesOption({
  spot,
  strike,
  dte,
  iv = 0.22,
  r = TBILL_BENCHMARK_YIELD,
  type = 'put',
}) {
  const S = Math.max(0.01, toNumber(spot));
  const K = Math.max(0.01, toNumber(strike));
  const T = Math.max(0, toNumber(dte)) / 365;
  const sigma = Math.max(0.05, Math.min(2.0, toNumber(iv) || 0.22));

  if (T <= 0.0001) {
    const intrinsic = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
    const delta =
      type === 'call'
        ? S > K
          ? 1
          : 0
        : S < K
        ? -1
        : 0;
    return {
      price: Number(intrinsic.toFixed(2)),
      intrinsic: Number(intrinsic.toFixed(2)),
      extrinsic: 0,
      delta: Number(delta.toFixed(3)),
      probOtmPct: Math.round((1 - Math.abs(delta)) * 100),
    };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const discK = K * Math.exp(-r * T);

  const price =
    type === 'call'
      ? Math.max(0.01, S * normCdf(d1) - discK * normCdf(d2))
      : Math.max(0.01, discK * normCdf(-d2) - S * normCdf(-d1));
  const intrinsic = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
  const extrinsic = Math.max(0, price - intrinsic);
  const delta = type === 'call' ? normCdf(d1) : normCdf(d1) - 1;

  return {
    price: Number(price.toFixed(2)),
    intrinsic: Number(intrinsic.toFixed(2)),
    extrinsic: Number(extrinsic.toFixed(2)),
    delta: Number(delta.toFixed(3)),
    probOtmPct: Math.max(1, Math.min(99, Math.round((1 - Math.abs(delta)) * 100))),
  };
}

export function solveStrikeForDelta({
  spot,
  targetAbsDelta = 0.22,
  dte = 35,
  iv = 0.22,
  r = TBILL_BENCHMARK_YIELD,
  type = 'put',
}) {
  const S = Math.max(1, toNumber(spot));
  const T = Math.max(7, toNumber(dte)) / 365;
  const sigma = Math.max(0.08, Math.min(1.5, toNumber(iv) || 0.22));
  const deltaClamped = Math.max(0.05, Math.min(0.45, toNumber(targetAbsDelta) || 0.22));

  // For call: N(d1) = delta -> d1 = inv(delta)
  // For put: N(-d1) = absDelta -> d1 = -inv(absDelta) = inv(1 - absDelta)
  const d1 = type === 'call' ? normInv(deltaClamped) : normInv(1 - deltaClamped);
  const rawStrike = S * Math.exp((r + 0.5 * sigma * sigma) * T - d1 * sigma * Math.sqrt(T));
  let rounded = roundToStandardStrike(rawStrike, 'nearest');
  if (type === 'call' && rounded <= S) rounded = roundToStandardStrike(S, 'up');
  if (type === 'put' && rounded >= S) rounded = roundToStandardStrike(S, 'down');
  return rounded;
}

export function estimateTypicalIv(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  const hit = CSP_CANDIDATE_UNIVERSE.find((c) => c.symbol === sym);
  if (hit) return hit.typicalIv;
  if (['VOO', 'IVV', 'VTI', 'ITOT', 'SGOV', 'USFR', 'BND', 'VXUS'].includes(sym)) return 0.15;
  if (['QQQ', 'VGT', 'XLK', 'SOXX'].includes(sym)) return 0.22;
  if (['TSLA', 'MSTR', 'COIN', 'PLTR', 'AMD'].includes(sym)) return 0.52;
  return 0.26;
}

// ============================================================================
// HOUSEHOLD BROKERAGE CAPITAL & DEPLOYMENT ENGINE
// ============================================================================

export function isOptionEligibleAccount(acc) {
  if (!acc || acc.is_archived || acc.is_liability) return false;
  if (acc.category === 'investment') {
    const sub = String(acc.subtype || '').toLowerCase();
    if (sub.includes('529') || sub.includes('real estate') || sub.includes('crypto')) return false;
    return true;
  }
  if (acc.category === 'retirement_401k') {
    const sub = `${acc.subtype || ''} ${acc.name || ''}`.toLowerCase();
    if (sub.includes('ira') || sub.includes('hsa')) return true;
  }
  return false;
}

export function getAccountTaxTreatment(acc) {
  const sub = `${acc?.subtype || ''} ${acc?.name || ''}`.toLowerCase();
  if (sub.includes('roth ira') || sub.includes('hsa')) {
    return { key: 'tax_free', label: 'Tax-Free (Roth/HSA)', isTaxAdvantaged: true };
  }
  if (sub.includes('traditional ira') || sub.includes('rollover ira') || sub.includes('ira')) {
    return { key: 'tax_deferred', label: 'Tax-Deferred (IRA)', isTaxAdvantaged: true };
  }
  return { key: 'taxable', label: 'Taxable Brokerage', isTaxAdvantaged: false };
}

export function analyzeCapitalDeployment({
  accounts = [],
  equityHoldings = [],
  promos = [],
  expenses = [],
  recurringBills = [],
  taxProfile = null,
  householdNames = { primary_name: 'Me', spouse_name: 'Wife' },
  riskProfileKey = 'low_medium',
  reserveMonths = 6,
  customDeployBudget = '',
  customWatchlist = '',
  liveQuotes = {},
}) {
  const risk = RISK_PROFILES[riskProfileKey] || RISK_PROFILES.low_medium;
  const today = todayIsoDate();
  const activeAccounts = (accounts || []).filter((a) => !a.is_archived);
  const activeAccountMap = new Map(activeAccounts.map((a) => [Number(a.id), a]));

  const holdingsByAcc = new Map();
  for (const h of equityHoldings || []) {
    const aid = Number(h.account_id);
    if (!activeAccountMap.has(aid)) continue;
    if (!holdingsByAcc.has(aid)) holdingsByAcc.set(aid, []);
    holdingsByAcc.get(aid).push(h);
  }

  // Employer-restricted tickers guardrail
  const restrictedInfo = getEmployerRestrictedTickers(equityHoldings, accounts, taxProfile);
  const paySummary = computeHouseholdPaystubSummary(taxProfile || {}, householdNames);
  const stateCode = String(taxProfile?.state_code || '').trim().toUpperCase();
  const isStateIncomeTaxFree = stateCode ? NO_STATE_INCOME_TAX_STATES.has(stateCode) : false;
  const estStateTaxRate = isStateIncomeTaxFree ? 0 : stateCode === 'CA' ? 0.093 : 0.065;
  const estFedMarginalRate = Math.max(0.22, (paySummary.fedTax.marginalRatePct || 24) / 100);
  const capLossShield = paySummary.capLosses?.remainingCarryforwardTo2027 || 0;

  // Protected household cash obligations (Emergency Fund + 0% Promos + Baby/Life Buffer)
  let recurringMonthlyNet = 0;
  for (const b of recurringBills || []) {
    if (!b.is_active) continue;
    const amt = Math.abs(toNumber(b.amount));
    const monthly = b.cadence === 'annual' ? amt / 12 : b.cadence === 'quarterly' ? amt / 3 : amt;
    recurringMonthlyNet += b.entry_type === 'credit' ? -monthly : monthly;
  }
  recurringMonthlyNet = Math.max(0, recurringMonthlyNet);

  const monthTotals = new Map();
  for (const e of expenses || []) {
    const mk = String(e.expense_date || '').slice(0, 7);
    if (!mk) continue;
    const delta =
      e.entry_type === 'credit' ? -Math.abs(toNumber(e.amount)) : Math.abs(toNumber(e.amount));
    monthTotals.set(mk, (monthTotals.get(mk) || 0) + delta);
  }
  const recentMonthVals = Array.from(monthTotals.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3)
    .map(([, v]) => Math.max(0, v));
  const avgMonthlySpend =
    recentMonthVals.length > 0
      ? recentMonthVals.reduce((a, b) => a + b, 0) / recentMonthVals.length
      : recurringMonthlyNet;
  const baselineMonthlyBurn = Math.max(recurringMonthlyNet, avgMonthlySpend, 4000);

  const emergencyTarget = Math.round(baselineMonthlyBurn * Math.max(3, Math.min(18, reserveMonths)));

  const activePromos = (promos || [])
    .filter(
      (p) => !p.is_paid_off && toNumber(p.promo_balance) > 0 && activeAccountMap.has(Number(p.account_id))
    )
    .map((p) => ({
      ...p,
      bal: toNumber(p.promo_balance),
      daysLeft: daysBetweenIso(today, p.expires_on),
      accountName: activeAccountMap.get(Number(p.account_id))?.name || 'Credit Card',
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const totalPromoBalance = activePromos.reduce((s, p) => s + p.bal, 0);
  const lifeBuffer = paySummary.lifeEvents?.expectingChild
    ? Math.max(0, toNumber(paySummary.lifeEvents.deliveryOopBuffer)) +
      Math.max(0, toNumber(paySummary.lifeEvents.leaveIncomeDip))
    : 0;
  const totalProtectedObligations = emergencyTarget + totalPromoBalance + lifeBuffer;

  const liquidBankCash = activeAccounts
    .filter((a) => !a.is_liability && a.category === 'bank')
    .reduce((s, a) => s + toNumber(a.current_balance), 0);

  const highAprDebts = activeAccounts
    .filter((a) => a.is_liability && toNumber(a.current_balance) > 500 && toNumber(a.interest_rate) >= 7)
    .sort((a, b) => toNumber(b.interest_rate) - toNumber(a.interest_rate));

  // Classify every option-eligible brokerage / IRA account
  const brokerageAccounts = activeAccounts
    .filter(isOptionEligibleAccount)
    .map((acc) => {
      const accHoldings = holdingsByAcc.get(Number(acc.id)) || [];
      const hasHoldings = accHoldings.length > 0;
      const explicitCash = Math.max(0, toNumber(acc.cash_balance));
      const flatBalance = !hasHoldings ? Math.max(0, toNumber(acc.current_balance)) : 0;
      const isEmployerStockPlan = /rsu|espp/i.test(`${acc.subtype || ''} ${acc.name || ''}`);
      // For employer stock plan accounts, uninvested cash is typically in-flight ESPP or dividend sweep;
      // still show it transparently but mark whether it's a stock plan account.
      const deployableCash = hasHoldings
        ? explicitCash
        : isEmployerStockPlan
        ? 0
        : flatBalance;
      const equityValue = accHoldings.reduce(
        (s, h) => s + toNumber(h.shares) * toNumber(h.last_price),
        0
      );
      const taxTreatment = getAccountTaxTreatment(acc);
      return {
        id: acc.id,
        name: acc.name,
        institution: acc.institution || '',
        subtype: acc.subtype || '',
        ownerProfile: acc.owner_profile || 'primary',
        ownerLabel: getOwnerDisplayName(acc.owner_profile, householdNames),
        totalBalance: toNumber(acc.current_balance),
        explicitCash,
        flatBalance,
        deployableCash,
        equityValue,
        hasHoldings,
        isEmployerStockPlan,
        taxTreatment,
        holdingsCount: accHoldings.length,
      };
    })
    .sort((a, b) => b.totalBalance - a.totalBalance);

  const totalBrokerageExplicitCash = brokerageAccounts
    .filter((a) => !a.isEmployerStockPlan)
    .reduce((s, a) => s + a.explicitCash, 0);
  const totalEmployerPlanCash = brokerageAccounts
    .filter((a) => a.isEmployerStockPlan)
    .reduce((s, a) => s + a.explicitCash, 0);
  const totalFlatBrokerageBalances = brokerageAccounts
    .filter((a) => !a.hasHoldings && !a.isEmployerStockPlan)
    .reduce((s, a) => s + a.flatBalance, 0);
  const totalBrokerageDeployableCash = brokerageAccounts
    .filter((a) => !a.isEmployerStockPlan)
    .reduce((s, a) => s + a.deployableCash, 0);
  const totalBrokerageValue = brokerageAccounts.reduce((s, a) => s + a.totalBalance, 0);

  const bankSurplusCash = Math.max(0, liquidBankCash - totalProtectedObligations);
  const reserveShortfall = Math.max(0, totalProtectedObligations - liquidBankCash);

  // Track active open option collateral already committed
  const desk = normalizeOptionsDesk(taxProfile?.paystub_details?.options_desk);
  const committedOptionCollateral = desk.positions
    .filter((p) => p.status === 'open')
    .reduce((s, p) => {
      if (p.strategy === 'csp') return s + p.strike * 100 * p.contracts;
      if (p.strategy === 'put_spread') {
        const width = Math.max(0, p.strike - p.long_strike);
        return s + width * 100 * p.contracts;
      }
      return s;
    }, 0);

  const defaultWorkingCapital = Math.max(
    0,
    totalBrokerageDeployableCash + bankSurplusCash - committedOptionCollateral
  );
  const hasCustomBudget = customDeployBudget !== '' && toNumber(customDeployBudget) > 0;
  const deployableCapital = hasCustomBudget
    ? toNumber(customDeployBudget)
    : defaultWorkingCapital;

  // Covered-Call eligible lots vs Restricted employer lots
  const ccSuggestions = [];
  const restrictedLots = [];

  for (const h of equityHoldings || []) {
    const acc = activeAccountMap.get(Number(h.account_id));
    if (!acc || !isOptionEligibleAccount(acc)) continue;
    const shares = toNumber(h.shares);
    if (shares < 100) continue;
    const sym = String(h.symbol || '').trim().toUpperCase();
    const liveSpot =
      liveQuotes[sym]?.price && toNumber(liveQuotes[sym].price) > 0
        ? toNumber(liveQuotes[sym].price)
        : toNumber(h.last_price);
    const contracts = Math.floor(shares / 100);
    const isRestricted =
      h.holding_type === 'rsu' ||
      h.holding_type === 'espp' ||
      restrictedInfo.restrictedSet.has(sym);

    if (isRestricted) {
      restrictedLots.push({
        symbol: sym,
        accountName: acc.name,
        ownerLabel: getOwnerDisplayName(acc.owner_profile, householdNames),
        shares,
        contracts,
        value: shares * liveSpot,
        holdingType: h.holding_type,
      });
      continue;
    }

    if (liveSpot <= 0) continue;
    const iv = estimateTypicalIv(sym);
    const costBasis = toNumber(h.cost_basis_per_share);
    let suggestedStrike = solveStrikeForDelta({
      spot: liveSpot,
      targetAbsDelta: risk.targetDelta,
      dte: risk.defaultDte,
      iv,
      type: 'call',
    });

    // Protect against accidentally selling calls below cost basis
    let belowBasisWarning = false;
    if (costBasis > 0 && suggestedStrike < costBasis) {
      if (costBasis <= liveSpot * 1.2) {
        suggestedStrike = roundToStandardStrike(costBasis, 'up');
      } else {
        belowBasisWarning = true;
      }
    }

    const opt = blackScholesOption({
      spot: liveSpot,
      strike: suggestedStrike,
      dte: risk.defaultDte,
      iv,
      type: 'call',
    });
    const positionValue = contracts * 100 * liveSpot;
    const cyclePremiumTotal = opt.price * 100 * contracts;
    const annualizedYieldPct =
      positionValue > 0 ? (cyclePremiumTotal / positionValue) * (365 / risk.defaultDte) * 100 : 0;
    const upsideToStrike = Math.max(0, (suggestedStrike - liveSpot) * 100 * contracts);
    const taxTreatment = getAccountTaxTreatment(acc);

    ccSuggestions.push({
      id: `${acc.id}-${sym}`,
      accountId: acc.id,
      accountName: acc.name,
      ownerLabel: getOwnerDisplayName(acc.owner_profile, householdNames),
      taxTreatment,
      symbol: sym,
      shares,
      contracts,
      suggestedContracts: contracts >= 2 ? Math.max(1, Math.floor(contracts * 0.5)) : 1,
      spot: liveSpot,
      costBasis,
      iv,
      dte: risk.defaultDte,
      suggestedStrike,
      estPremiumPerShare: opt.price,
      estCyclePremiumTotal: Number(cyclePremiumTotal.toFixed(2)),
      delta: opt.delta,
      probOtmPct: opt.probOtmPct,
      annualizedYieldPct: Number(annualizedYieldPct.toFixed(1)),
      upsideToStrike: Number(upsideToStrike.toFixed(0)),
      rollTriggerPrice: Number((suggestedStrike * 0.99).toFixed(2)),
      belowBasisWarning,
    });
  }

  // Sleeve dollar targets
  const tbillAllocation = Math.round((deployableCapital * risk.tbillPct) / 100);
  const cspAllocation = Math.round((deployableCapital * risk.cspPct) / 100);
  const coreIndexAllocation = Math.max(0, Math.round(deployableCapital - tbillAllocation - cspAllocation));
  const maxPerTickerCollateral = Math.max(
    3000,
    Math.round((deployableCapital * risk.maxSingleTickerPct) / 100)
  );

  // Build CSP / Wheel candidate list (curated + optional custom watchlist tickers), strictly filtering restricted tickers
  const customSymbols = String(customWatchlist || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => TICKER_RE.test(s) && !CSP_CANDIDATE_UNIVERSE.some((c) => c.symbol === s))
    .slice(0, 6);

  const combinedCandidates = [
    ...CSP_CANDIDATE_UNIVERSE,
    ...customSymbols.map((sym) => ({
      symbol: sym,
      name: `${sym} (Custom Watchlist)`,
      kind: 'custom',
      riskTier: 'low_medium',
      typicalIv: estimateTypicalIv(sym),
      fallbackPrice: 0,
      note: 'User watchlist ticker — verify earnings calendar & option liquidity before selling',
    })),
  ].filter((c) => !restrictedInfo.restrictedSet.has(c.symbol));

  const cspCandidates = combinedCandidates
    .map((cand) => {
      const liveQ = liveQuotes[cand.symbol];
      const spot =
        liveQ && toNumber(liveQ.price) > 0 ? toNumber(liveQ.price) : cand.fallbackPrice;
      if (spot <= 0) return null;

      const isLiveQuote = Boolean(liveQ && toNumber(liveQ.price) > 0);
      const strike = solveStrikeForDelta({
        spot,
        targetAbsDelta: risk.targetDelta,
        dte: risk.defaultDte,
        iv: cand.typicalIv,
        type: 'put',
      });
      const opt = blackScholesOption({
        spot,
        strike,
        dte: risk.defaultDte,
        iv: cand.typicalIv,
        type: 'put',
      });

      const collateralPerContract = strike * 100;
      const premiumPerContract = opt.price * 100;
      const cycleReturnPct =
        collateralPerContract > 0 ? (premiumPerContract / collateralPerContract) * 100 : 0;
      const annualizedOptYieldPct = cycleReturnPct * (365 / risk.defaultDte);
      const doubleDipAnnualYieldPct = annualizedOptYieldPct + TBILL_BENCHMARK_YIELD * 100;
      const effectiveEntry = Number((strike - opt.price).toFixed(2));
      const discountBelowSpotPct = Number((((spot - effectiveEntry) / spot) * 100).toFixed(1));
      const maxContractsByBudget =
        deployableCapital > 0 ? Math.floor(deployableCapital / collateralPerContract) : 0;
      const maxContractsBySleeve =
        cspAllocation > 0 ? Math.floor(cspAllocation / collateralPerContract) : 0;
      const fitsRiskCap =
        collateralPerContract <= Math.max(maxPerTickerCollateral, cspAllocation) &&
        collateralPerContract <= deployableCapital;
      const fitsRiskTier = cand.typicalIv <= risk.maxIvAllowed || cand.kind === 'custom';

      // Defined-risk Put Credit Spread alternative (e.g., $5 or $10 wide) for expensive underlyings
      const spreadWidth = spot >= 300 ? 10 : spot >= 100 ? 5 : 2;
      const longStrike = Math.max(1, Number((strike - spreadWidth).toFixed(2)));
      const longOpt = blackScholesOption({
        spot,
        strike: longStrike,
        dte: risk.defaultDte,
        iv: cand.typicalIv,
        type: 'put',
      });
      const spreadCredit = Math.max(0.05, Number((opt.price - longOpt.price).toFixed(2)));
      const spreadMaxRisk = Math.max(50, Number(((spreadWidth - spreadCredit) * 100).toFixed(0)));
      const spreadReturnPct = Number((((spreadCredit * 100) / spreadMaxRisk) * 100).toFixed(1));

      return {
        ...cand,
        spot,
        isLiveQuote,
        strike,
        dte: risk.defaultDte,
        delta: opt.delta,
        probOtmPct: opt.probOtmPct,
        estPremiumPerShare: opt.price,
        estPremiumPerContract: Number(premiumPerContract.toFixed(0)),
        collateralPerContract: Number(collateralPerContract.toFixed(0)),
        cycleReturnPct: Number(cycleReturnPct.toFixed(2)),
        annualizedOptYieldPct: Number(annualizedOptYieldPct.toFixed(1)),
        doubleDipAnnualYieldPct: Number(doubleDipAnnualYieldPct.toFixed(1)),
        effectiveEntry,
        discountBelowSpotPct,
        maxContractsByBudget,
        maxContractsBySleeve,
        fitsRiskCap,
        fitsRiskTier,
        spreadAlternative: {
          shortStrike: strike,
          longStrike,
          width: spreadWidth,
          creditPerShare: spreadCredit,
          maxRiskPerContract: spreadMaxRisk,
          cycleReturnPct: spreadReturnPct,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      // Prioritize candidates that fit user's risk tier & collateral budget
      const scoreA = (a.fitsRiskTier ? 4 : 0) + (a.fitsRiskCap ? 3 : a.maxContractsByBudget > 0 ? 1 : 0);
      const scoreB = (b.fitsRiskTier ? 4 : 0) + (b.fitsRiskCap ? 3 : b.maxContractsByBudget > 0 ? 1 : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.collateralPerContract - b.collateralPerContract;
    });

  // Tax-equivalent T-Bill yield (e.g., NY state-tax exemption boost!)
  const tbillTaxEquivHysaPct =
    estStateTaxRate > 0
      ? Number(((TBILL_BENCHMARK_YIELD / (1 - estStateTaxRate)) * 100).toFixed(2))
      : Number((TBILL_BENCHMARK_YIELD * 100).toFixed(2));

  // Projected annualized income summary across the recommended sleeves
  const estTbillAnnualIncome = Math.round((tbillAllocation + cspAllocation) * TBILL_BENCHMARK_YIELD);
  const avgCspYield = risk.key === 'low' ? 0.065 : risk.key === 'medium' ? 0.12 : 0.09;
  const estCspAnnualIncome = Math.round(cspAllocation * avgCspYield);
  const estCcAnnualIncome = Math.round(
    ccSuggestions.reduce(
      (s, c) => s + c.estCyclePremiumTotal * (c.suggestedContracts / Math.max(1, c.contracts)) * (365 / c.dte),
      0
    )
  );
  const estTotalAnnualIncome = estTbillAnnualIncome + estCspAnnualIncome + estCcAnnualIncome;

  // Evaluate active tracked positions for live health badges
  const evaluatedPositions = desk.positions.map((pos) => {
    const liveQ = liveQuotes[pos.symbol];
    const holdingMatch = (equityHoldings || []).find(
      (h) => String(h.symbol || '').trim().toUpperCase() === pos.symbol && toNumber(h.last_price) > 0
    );
    const spot =
      liveQ && toNumber(liveQ.price) > 0
        ? toNumber(liveQ.price)
        : holdingMatch
        ? toNumber(holdingMatch.last_price)
        : 0;
    const dteLeft = pos.expiration ? daysBetweenIso(today, pos.expiration) : null;
    const iv = estimateTypicalIv(pos.symbol);

    let isItm = false;
    let moneynessPct = 0;
    let estCurrentOptPrice = null;
    let estUnrealizedPnl = null;
    let collateral = 0;

    if (pos.strategy === 'csp') {
      collateral = pos.strike * 100 * pos.contracts;
    } else if (pos.strategy === 'put_spread') {
      collateral = Math.max(0, pos.strike - pos.long_strike) * 100 * pos.contracts;
    } else if (pos.strategy === 'cc') {
      collateral = (spot > 0 ? spot : pos.strike) * 100 * pos.contracts;
    }

    if (spot > 0 && pos.strike > 0 && (pos.strategy === 'cc' || pos.strategy === 'csp' || pos.strategy === 'put_spread')) {
      if (pos.strategy === 'cc') {
        isItm = spot > pos.strike;
        moneynessPct = Number((((pos.strike - spot) / spot) * 100).toFixed(1)); // positive = OTM cushion
      } else {
        isItm = spot < pos.strike;
        moneynessPct = Number((((spot - pos.strike) / spot) * 100).toFixed(1)); // positive = OTM cushion
      }

      if (dteLeft !== null && dteLeft >= 0) {
        const shortOpt = blackScholesOption({
          spot,
          strike: pos.strike,
          dte: Math.max(0, dteLeft),
          iv,
          type: pos.strategy === 'cc' ? 'call' : 'put',
        });
        if (pos.strategy === 'put_spread' && pos.long_strike > 0) {
          const longOpt = blackScholesOption({
            spot,
            strike: pos.long_strike,
            dte: Math.max(0, dteLeft),
            iv,
            type: 'put',
          });
          estCurrentOptPrice = Math.max(0.01, Number((shortOpt.price - longOpt.price).toFixed(2)));
        } else {
          estCurrentOptPrice = shortOpt.price;
        }
        estUnrealizedPnl = Number(
          ((pos.premium_per_share - estCurrentOptPrice) * 100 * pos.contracts).toFixed(0)
        );
      }
    }

    let alertState = 'healthy'; // 'healthy' | 'take_profit' | 'manage' | 'itm' | 'expired'
    let alertLabel = 'On Track';
    if (pos.status === 'open') {
      if (dteLeft !== null && dteLeft < 0) {
        alertState = 'expired';
        alertLabel = 'Past Expiry — Update Status';
      } else if (isItm) {
        alertState = 'itm';
        alertLabel = `ITM (${Math.abs(moneynessPct)}%) — Evaluate Roll / Loss`;
      } else if (
        estCurrentOptPrice !== null &&
        pos.premium_per_share > 0 &&
        estCurrentOptPrice <= pos.premium_per_share * 0.5
      ) {
        alertState = 'take_profit';
        alertLabel = 'Est. ≥50% Profit — Consider Closing';
      } else if (dteLeft !== null && dteLeft <= 21) {
        alertState = 'manage';
        alertLabel = `${dteLeft} DTE — Manage / Roll Window`;
      }
    }

    const totalCreditReceived = Number((pos.premium_per_share * 100 * pos.contracts).toFixed(2));
    const acc = pos.account_id ? activeAccountMap.get(Number(pos.account_id)) : null;

    return {
      ...pos,
      accountName: acc?.name || 'Brokerage',
      spot,
      dteLeft,
      isItm,
      moneynessPct,
      estCurrentOptPrice,
      estUnrealizedPnl,
      collateral,
      totalCreditReceived,
      alertState,
      alertLabel,
      isRestrictedSymbol: restrictedInfo.restrictedSet.has(pos.symbol),
    };
  });

  const openAlertsCount = evaluatedPositions.filter(
    (p) => p.status === 'open' && (p.alertState === 'itm' || p.alertState === 'expired' || (p.dteLeft !== null && p.dteLeft <= 7))
  ).length;

  return {
    risk,
    stateCode,
    isStateIncomeTaxFree,
    estStateTaxRate,
    estFedMarginalRate,
    capLossShield,
    tbillTaxEquivHysaPct,
    restrictedInfo,

    // Cash & reserve breakdown
    baselineMonthlyBurn,
    emergencyTarget,
    totalPromoBalance,
    activePromos,
    lifeBuffer,
    totalProtectedObligations,
    liquidBankCash,
    bankSurplusCash,
    reserveShortfall,
    highAprDebts,

    // Brokerage capital breakdown
    brokerageAccounts,
    totalBrokerageExplicitCash,
    totalEmployerPlanCash,
    totalFlatBrokerageBalances,
    totalBrokerageDeployableCash,
    totalBrokerageValue,
    committedOptionCollateral,
    defaultWorkingCapital,
    deployableCapital,

    // Recommended deployment sleeves
    sleeves: {
      tbillAllocation,
      cspAllocation,
      coreIndexAllocation,
      maxPerTickerCollateral,
    },
    estTbillAnnualIncome,
    estCspAnnualIncome,
    estCcAnnualIncome,
    estTotalAnnualIncome,

    // Strategy candidates
    ccSuggestions,
    restrictedLots,
    cspCandidates,

    // Tracked positions
    evaluatedPositions,
    openAlertsCount,
  };
}

// ============================================================================
// ROLL VS. ASSIGNMENT VS. TAKE-LOSS DECISION ENGINE
// ============================================================================

export function evaluateRollVsLoss({
  strategy = 'csp', // 'cc' | 'csp'
  symbol = '',
  contracts = 1,
  spot = 0,
  currentStrike = 0,
  originalPremium = 0,
  currentBtcCost = 0,
  currentDte = 10,
  costBasis = 0,
  newStrike = 0,
  newDte = 42,
  newPremium = 0,
  capLossCarryforward = 0,
  marginalCombinedTaxRate = 0.3,
  isTaxAdvantaged = false,
}) {
  const qty = Math.max(1, Math.floor(toNumber(contracts) || 1));
  const S = Math.max(0.01, toNumber(spot));
  const K1 = Math.max(0.01, toNumber(currentStrike));
  const origCredit = Math.max(0, toNumber(originalPremium));
  const btc = Math.max(0, toNumber(currentBtcCost));
  const dte1 = Math.max(0, toNumber(currentDte));
  const K2 = Math.max(0.01, toNumber(newStrike) || K1);
  const dte2 = Math.max(dte1 + 1, toNumber(newDte) || dte1 + 30);
  const rollPrem = Math.max(0, toNumber(newPremium));
  const basis = Math.max(0, toNumber(costBasis));
  const lossShield = Math.max(0, toNumber(capLossCarryforward));
  const taxRate = isTaxAdvantaged ? 0 : Math.max(0, Math.min(0.55, toNumber(marginalCombinedTaxRate)));

  const isCall = strategy === 'cc';
  const intrinsic = isCall ? Math.max(0, S - K1) : Math.max(0, K1 - S);
  const extrinsicLeft = Math.max(0, btc - intrinsic);
  const isItm = intrinsic > 0;
  const itmPct = Number(((intrinsic / K1) * 100).toFixed(1));
  const addedDays = Math.max(1, dte2 - dte1);

  // Path A: Roll Out (or Up/Down & Out)
  const netRollPerShare = Number((rollPrem - btc).toFixed(2));
  const netRollDollars = Number((netRollPerShare * 100 * qty).toFixed(0));
  const cumulativeCreditPerShare = Number((origCredit + netRollPerShare).toFixed(2));
  const strikeImprovementPerShare = isCall ? K2 - K1 : K1 - K2; // positive = better strike!
  const strikeImprovementDollars = Number((strikeImprovementPerShare * 100 * qty).toFixed(0));
  const newCollateral = (isCall ? S : K2) * 100 * qty;
  const rollAnnualizedYieldPct =
    newCollateral > 0
      ? Number(((netRollDollars / newCollateral) * (365 / addedDays) * 100).toFixed(1))
      : 0;
  const newBreakeven = isCall
    ? Number((K2 + cumulativeCreditPerShare).toFixed(2))
    : Number((K2 - cumulativeCreditPerShare).toFixed(2));
  const isNetCreditRoll = netRollPerShare >= -0.005;

  // Path B: Accept Assignment (CC = shares called away; CSP = buy 100 shares/contract)
  let assignmentSummary;
  if (isCall) {
    const effectiveBasis = basis > 0 ? basis : S;
    const stockGainDollars = (K1 - effectiveBasis) * 100 * qty;
    const totalRealizedDollars = Math.round(stockGainDollars + origCredit * 100 * qty);
    const opportunityCostMissed = Math.round(Math.max(0, (S - K1 - origCredit) * 100 * qty));
    const taxableGain = Math.max(0, totalRealizedDollars);
    const shieldedByLoss = Math.min(taxableGain, lossShield);
    const estTaxDue = isTaxAdvantaged
      ? 0
      : Math.round(Math.max(0, taxableGain - shieldedByLoss) * taxRate);
    assignmentSummary = {
      headline: totalRealizedDollars >= 0 ? 'Lock In Max Profit & Free Cash' : 'Realize Stock Loss on Call-Away',
      totalRealizedDollars,
      opportunityCostMissed,
      shieldedByLoss: Math.round(shieldedByLoss),
      estTaxDue,
      netAfterTaxDollars: totalRealizedDollars - estTaxDue,
      cashFreed: Math.round((K1 + origCredit) * 100 * qty),
    };
  } else {
    const effectiveEntryPerShare = Number((K1 - origCredit).toFixed(2));
    const totalCashRequired = Math.round(K1 * 100 * qty);
    const paperDrawdownDollars = Math.round((S - effectiveEntryPerShare) * 100 * qty);
    const paperDrawdownPct =
      effectiveEntryPerShare > 0
        ? Number((((S - effectiveEntryPerShare) / effectiveEntryPerShare) * 100).toFixed(1))
        : 0;
    // Estimate next-step Covered Call at or above effective entry basis
    const wheelCcStrike = roundToStandardStrike(Math.max(effectiveEntryPerShare, S * 1.03), 'up');
    const wheelCcOpt = blackScholesOption({
      spot: S,
      strike: wheelCcStrike,
      dte: 35,
      iv: estimateTypicalIv(symbol),
      type: 'call',
    });
    assignmentSummary = {
      headline: 'Take Shares & Transition to Covered Call (Wheel)',
      effectiveEntryPerShare,
      totalCashRequired,
      paperDrawdownDollars,
      paperDrawdownPct,
      wheelCcStrike,
      wheelCcEstPremium: Math.round(wheelCcOpt.price * 100 * qty),
    };
  }

  // Path C: Close & Take the Loss Now
  const closeNetPnlPerShare = Number((origCredit - btc).toFixed(2));
  const closeNetPnlDollars = Math.round(closeNetPnlPerShare * 100 * qty);
  const isClosingAtLoss = closeNetPnlDollars < 0;
  const estTaxSavings =
    isClosingAtLoss && !isTaxAdvantaged ? Math.round(Math.abs(closeNetPnlDollars) * taxRate) : 0;
  const netAfterTaxLoss = closeNetPnlDollars + estTaxSavings;
  const freedCapital = (isCall ? S : K1) * 100 * qty;
  // How many conservative 20-delta 35-DTE cycles (~0.8% return) to recover the loss
  const estFreshCycleCredit = Math.max(50, Math.round(freedCapital * 0.008));
  const cyclesToRecover = isClosingAtLoss
    ? Math.ceil(Math.abs(closeNetPnlDollars) / estFreshCycleCredit)
    : 0;

  // Quantitative Verdict Engine
  let recommendedPath = 'roll'; // 'roll' | 'assign' | 'close'
  let verdictBadge = '';
  let verdictTone = 'emerald'; // 'emerald' | 'sky' | 'amber' | 'rose'
  const reasons = [];

  if (!isItm && closeNetPnlPerShare >= origCredit * 0.5 && origCredit > 0) {
    recommendedPath = 'close';
    verdictBadge = 'Take Early Profit (≥50% Winner)';
    verdictTone = 'emerald';
    reasons.push(
      `You already captured ${Math.round((closeNetPnlPerShare / origCredit) * 100)}% of max profit. Closing now locks in +$${closeNetPnlDollars.toLocaleString()} and eliminates remaining tail risk.`
    );
  } else if (isCall) {
    if (isItm && itmPct >= 12 && (!isNetCreditRoll || rollAnnualizedYieldPct < 6)) {
      recommendedPath = 'assign';
      verdictBadge = 'Let Assigned — Avoid Deep-ITM Capital Trap';
      verdictTone = 'sky';
      reasons.push(
        `${symbol || 'Stock'} is ${itmPct}% above your $${K1} strike. Rolling yields only ${rollAnnualizedYieldPct}% annualized and ties up capital for ${addedDays} extra days.`
      );
      if (assignmentSummary.shieldedByLoss > 0) {
        reasons.push(
          `Your capital loss carryforward shields ~$${assignmentSummary.shieldedByLoss.toLocaleString()} of this realized gain tax-free.`
        );
      }
    } else if (isNetCreditRoll && (strikeImprovementPerShare > 0 || rollAnnualizedYieldPct >= 8)) {
      recommendedPath = 'roll';
      verdictBadge =
        strikeImprovementPerShare > 0
          ? 'Roll Up & Out for Net Credit'
          : 'Roll Out for Net Credit';
      verdictTone = 'emerald';
      reasons.push(
        `Rolling to $${K2} (${dte2} DTE) collects ${netRollDollars >= 0 ? `+$${netRollDollars.toLocaleString()}` : `-$${Math.abs(netRollDollars).toLocaleString()}`} net credit (${rollAnnualizedYieldPct}% annualized on added ${addedDays}d)${strikeImprovementPerShare > 0 ? ` AND unlocks +$${strikeImprovementDollars.toLocaleString()} extra stock upside` : ''}.`
      );
    } else if (!isNetCreditRoll && btc > origCredit * 2.5 && basis > 0 && S > basis * 1.15) {
      recommendedPath = 'assign';
      verdictBadge = 'Accept Max Profit on Call-Away';
      verdictTone = 'sky';
      reasons.push(
        'Avoid paying a net debit to chase a covered call — taking assignment locks in your planned max gain cleanly.'
      );
    } else {
      recommendedPath = isNetCreditRoll ? 'roll' : 'assign';
      verdictBadge = isNetCreditRoll
        ? 'Roll Out for Credit (Watch Extrinsic)'
        : 'Prefer Assignment Over Net-Debit Roll';
      verdictTone = isNetCreditRoll ? 'emerald' : 'amber';
      reasons.push(
        isNetCreditRoll
          ? `Still collects a small credit (+$${netRollDollars.toLocaleString()}) while buying ${addedDays} days.`
          : `Proposed roll requires a $${Math.abs(netRollDollars).toLocaleString()} net debit — either widen duration for a credit or let shares be called away.`
      );
    }
  } else {
    // Cash-Secured Put (CSP)
    if (isItm && itmPct >= 15) {
      recommendedPath = 'close';
      verdictBadge = 'Deep ITM Drawdown — Cut Loss or Re-Underwrite Thesis';
      verdictTone = 'rose';
      reasons.push(
        `${symbol || 'Stock'} dropped ${itmPct}% below your $${K1} strike. Never blindly roll into a broken thesis — if fundamentals deteriorated, closing for -$${Math.abs(closeNetPnlDollars).toLocaleString()} frees $${freedCapital.toLocaleString()} cleanly (avoiding dead capital).`
      );
      reasons.push(
        `Only choose "Take Assignment & Wheel" if you have high conviction owning ${qty * 100} shares of ${symbol || 'this asset'} long-term at $${assignmentSummary.effectiveEntryPerShare}/sh.`
      );
    } else if (isNetCreditRoll && strikeImprovementPerShare >= 0 && rollAnnualizedYieldPct >= 8) {
      recommendedPath = 'roll';
      verdictBadge =
        strikeImprovementPerShare > 0
          ? 'Roll Down & Out for Net Credit'
          : 'Roll Out for Net Credit';
      verdictTone = 'emerald';
      reasons.push(
        `Rolling to $${K2} (${dte2} DTE) lowers your breakeven to $${newBreakeven}/sh while adding +$${netRollDollars.toLocaleString()} credit (${rollAnnualizedYieldPct}% annualized on added ${addedDays}d).`
      );
      if (extrinsicLeft <= origCredit * 0.25) {
        reasons.push('Most time value has decayed — ideal timing to roll before assignment risk spikes.');
      }
    } else if (isItm && itmPct < 10 && !isNetCreditRoll) {
      recommendedPath = 'assign';
      verdictBadge = 'Accept Assignment & Sell Covered Call (Wheel)';
      verdictTone = 'sky';
      reasons.push(
        `Drawdown is modest (${itmPct}% ITM). Rather than rolling for a debit, taking assignment at $${assignmentSummary.effectiveEntryPerShare}/sh net basis lets you immediately sell a $${assignmentSummary.wheelCcStrike} Covered Call for ~$${assignmentSummary.wheelCcEstPremium.toLocaleString()}.`
      );
    } else if (isClosingAtLoss && Math.abs(closeNetPnlPerShare) >= origCredit * 2.0 && !isNetCreditRoll) {
      recommendedPath = 'close';
      verdictBadge = '2× Stop-Loss Hit — Close & Redeploy';
      verdictTone = 'amber';
      reasons.push(
        `Loss exceeds 2× initial credit and cannot be rolled for a credit. Closing caps risk at -$${Math.abs(closeNetPnlDollars).toLocaleString()} (~${cyclesToRecover} conservative cycles to recover).`
      );
    } else {
      recommendedPath = isNetCreditRoll ? 'roll' : 'assign';
      verdictBadge = isNetCreditRoll ? 'Roll Down & Out for Credit' : 'Accept Assignment (Wheel)';
      verdictTone = isNetCreditRoll ? 'emerald' : 'sky';
      reasons.push(
        isNetCreditRoll
          ? `Collects +$${netRollDollars.toLocaleString()} net credit and extends duration by ${addedDays} days.`
          : `Avoid paying a debit to roll a CSP — take quality shares at $${assignmentSummary.effectiveEntryPerShare} or close cleanly.`
      );
    }
  }

  return {
    isCall,
    isItm,
    itmPct,
    intrinsic: Number(intrinsic.toFixed(2)),
    extrinsicLeft: Number(extrinsicLeft.toFixed(2)),
    addedDays,
    recommendedPath,
    verdictBadge,
    verdictTone,
    reasons,
    roll: {
      newStrike: K2,
      newDte: dte2,
      netRollPerShare,
      netRollDollars,
      cumulativeCreditPerShare,
      strikeImprovementPerShare: Number(strikeImprovementPerShare.toFixed(2)),
      strikeImprovementDollars,
      rollAnnualizedYieldPct,
      newBreakeven,
      isNetCreditRoll,
    },
    assign: assignmentSummary,
    close: {
      closeNetPnlPerShare,
      closeNetPnlDollars,
      isClosingAtLoss,
      estTaxSavings,
      netAfterTaxLoss,
      freedCapital: Math.round(freedCapital),
      cyclesToRecover,
    },
  };
}
