import { normalizePayrollAutoSync, sanitizePayrollAutoSyncForDb } from './payrollSync.js';
import { normalizeOptionsDesk, sanitizeOptionsDeskForDb } from './optionsDeskSchema.js';

export const ACCOUNT_CATEGORIES = {
  retirement_401k: {
    key: 'retirement_401k',
    label: '401(k) & Retirement',
    shortLabel: '401(k) / IRA',
    isLiability: false,
    accent: 'emerald',
    colorHex: '#10b981',
    subtypes: [
      'Traditional 401(k)',
      'Roth 401(k)',
      'Roth IRA',
      'Traditional IRA',
      'HSA (Health Savings)',
      '403(b) / 457(b)',
      'SEP / Solo 401(k)',
      'Pension',
    ],
  },
  bank: {
    key: 'bank',
    label: 'Banks & Cash',
    shortLabel: 'Banks',
    isLiability: false,
    accent: 'sky',
    colorHex: '#0ea5e9',
    subtypes: [
      'Checking',
      'High-Yield Savings (HYSA)',
      'Emergency Fund',
      'Savings',
      'Money Market',
      'Certificate of Deposit (CD)',
      'Cash / Treasury Money Market',
    ],
  },
  investment: {
    key: 'investment',
    label: 'Investments & Equity',
    shortLabel: 'Investments',
    isLiability: false,
    accent: 'violet',
    colorHex: '#8b5cf6',
    subtypes: [
      'Taxable Brokerage',
      'Treasuries / I-Bonds',
      'Employer RSUs / ESPP',
      'Real Estate Equity',
      '529 Education Plan',
      'Crypto / Digital Assets',
    ],
  },
  credit_card: {
    key: 'credit_card',
    label: 'Credit Cards',
    shortLabel: 'Credit Cards',
    isLiability: true,
    accent: 'amber',
    colorHex: '#f59e0b',
    subtypes: [
      'Rewards Card',
      'Travel Card',
      'Cash Back Card',
      '0% Intro APR Card',
      'Charge Card',
      'Business Card',
    ],
  },
  loan: {
    key: 'loan',
    label: 'Active Loans',
    shortLabel: 'Loans',
    isLiability: true,
    accent: 'rose',
    colorHex: '#f43f5e',
    subtypes: [
      'Mortgage',
      'Auto Loan',
      'Student Loan',
      'Personal Loan',
      'HELOC',
      'Home Improvement Loan',
    ],
  },
  other_asset: {
    key: 'other_asset',
    label: 'Property, Gold & Vehicles',
    shortLabel: 'Real Assets',
    isLiability: false,
    accent: 'teal',
    colorHex: '#14b8a6',
    subtypes: [
      'US Home / Real Estate',
      'India Property / Land',
      'Physical Gold / Jewelry',
      'Vehicle / Car',
      'Other Asset',
    ],
  },
  other_liability: {
    key: 'other_liability',
    label: 'Other Liabilities',
    shortLabel: 'Other Debt',
    isLiability: true,
    accent: 'orange',
    colorHex: '#f97316',
    subtypes: ['Tax Payable', 'Medical Installment', 'BNPL Plan', 'Other Liability'],
  },
};

export const EXPENSE_CATEGORIES = [
  'Housing',
  'Groceries',
  'Dining & Coffee',
  'Utilities & Internet',
  'Transportation & Gas',
  'Insurance',
  'Healthcare',
  'Debt & Loan Payments',
  'Subscriptions & Software',
  'Shopping & Household',
  'Entertainment',
  'Travel',
  'Fitness & Wellness',
  'Education',
  'Taxes & Fees',
  'Gifts & Charity',
  'Other',
];

export const CATEGORY_COLORS = {
  Housing: '#10b981',
  Groceries: '#0ea5e9',
  'Dining & Coffee': '#f59e0b',
  'Utilities & Internet': '#6366f1',
  'Transportation & Gas': '#14b8a6',
  Insurance: '#8b5cf6',
  Healthcare: '#ec4899',
  'Debt & Loan Payments': '#f43f5e',
  'Subscriptions & Software': '#a855f7',
  'Shopping & Household': '#eab308',
  Entertainment: '#f97316',
  Travel: '#06b6d4',
  'Fitness & Wellness': '#22c55e',
  Education: '#3b82f6',
  'Taxes & Fees': '#64748b',
  'Gifts & Charity': '#d946ef',
  Other: '#71717a',
};

export function toNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export function formatCurrency(value, { compact = false, showSign = false, decimals = 2 } = {}) {
  const num = toNumber(value);
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : showSign && num > 0 ? '+' : '';

  if (compact) {
    if (abs >= 1_000_000) {
      return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    }
    if (abs >= 10_000) {
      return `${sign}$${(abs / 1_000).toFixed(1)}k`;
    }
  }

  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatPercent(value, decimals = 1) {
  const num = toNumber(value);
  return `${num.toFixed(decimals)}%`;
}

export function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentMonthKey() {
  return todayIsoDate().slice(0, 7);
}

export function shiftMonthKey(monthKey, deltaMonths) {
  const [yStr, mStr] = monthKey.split('-');
  const d = new Date(Number(yStr), Number(mStr) - 1 + deltaMonths, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function formatMonthLabel(monthKey) {
  const [yStr, mStr] = monthKey.split('-');
  const d = new Date(Number(yStr), Number(mStr) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function formatShortDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export function formatLastSaved(isoTimestamp) {
  if (!isoTimestamp) return '';
  const dt = new Date(isoTimestamp);
  if (Number.isNaN(dt.getTime())) return '';
  const now = new Date();
  const sameDay =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  const timeStr = dt.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (sameDay) {
    return `Today, ${timeStr}`;
  }
  const sameYear = dt.getFullYear() === now.getFullYear();
  const dateStr = dt.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${dateStr}, ${timeStr}`;
}

export function ordinalDay(day) {
  const n = Number(day);
  if (!n) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function computeNetWorthSummary(accounts) {
  const active = (accounts || []).filter((a) => !a.is_archived);

  let retirement401k = 0;
  let banks = 0;
  let investments = 0;
  let otherAssets = 0;
  let creditCards = 0;
  let loans = 0;
  let otherLiabilities = 0;

  let totalCardLimit = 0;
  let totalLoanOriginal = 0;
  let monthlyMinDebtService = 0;
  let weightedDebtNumerator = 0;
  let weightedDebtDenominator = 0;
  let weightedBankApyNumerator = 0;

  for (const acc of active) {
    const bal = toNumber(acc.current_balance);
    const rate = toNumber(acc.interest_rate);
    const minPay = toNumber(acc.minimum_payment);

    switch (acc.category) {
      case 'retirement_401k':
        retirement401k += bal;
        break;
      case 'bank':
        banks += bal;
        if (bal > 0 && rate > 0) weightedBankApyNumerator += bal * rate;
        break;
      case 'investment':
        investments += bal;
        break;
      case 'other_asset':
        otherAssets += bal;
        break;
      case 'credit_card':
        creditCards += bal;
        totalCardLimit += toNumber(acc.credit_limit);
        monthlyMinDebtService += minPay;
        if (bal > 0 && rate > 0) {
          weightedDebtNumerator += bal * rate;
          weightedDebtDenominator += bal;
        }
        break;
      case 'loan':
        loans += bal;
        totalLoanOriginal += toNumber(acc.original_principal) || bal;
        monthlyMinDebtService += minPay;
        if (bal > 0 && rate > 0) {
          weightedDebtNumerator += bal * rate;
          weightedDebtDenominator += bal;
        }
        break;
      case 'other_liability':
        otherLiabilities += bal;
        monthlyMinDebtService += minPay;
        break;
      default:
        break;
    }
  }

  const totalAssets = retirement401k + banks + investments + otherAssets;
  const totalLiabilities = creditCards + loans + otherLiabilities;
  const netWorth = totalAssets - totalLiabilities;

  const creditUtilizationPct =
    totalCardLimit > 0 ? Math.min(999, (creditCards / totalCardLimit) * 100) : null;

  const loanPaidOffPct =
    totalLoanOriginal > 0
      ? Math.max(0, Math.min(100, ((totalLoanOriginal - loans) / totalLoanOriginal) * 100))
      : null;

  const weightedDebtApr =
    weightedDebtDenominator > 0 ? weightedDebtNumerator / weightedDebtDenominator : 0;

  const weightedCashApy = banks > 0 ? weightedBankApyNumerator / banks : 0;

  return {
    totalAssets,
    totalLiabilities,
    netWorth,
    retirement401k,
    banks,
    investments,
    otherAssets,
    creditCards,
    loans,
    otherLiabilities,
    totalCardLimit,
    creditUtilizationPct,
    totalLoanOriginal,
    loanPaidOffPct,
    monthlyMinDebtService,
    weightedDebtApr,
    weightedCashApy,
    activeCount: active.length,
  };
}

/**
 * Builds an accurate carry-forward time series across all snapshot dates + live balances.
 */
export function buildNetWorthTimeSeries(accounts, snapshots) {
  if (!accounts || accounts.length === 0) return [];

  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const validSnaps = (snapshots || [])
    .filter((s) => accountMap.has(s.account_id) && s.snapshot_date)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  const dateSet = new Set(validSnaps.map((s) => s.snapshot_date));
  const today = todayIsoDate();
  dateSet.add(today);

  const sortedDates = Array.from(dateSet).sort();

  // Group snapshots by date
  const snapsByDate = new Map();
  for (const s of validSnaps) {
    if (!snapsByDate.has(s.snapshot_date)) snapsByDate.set(s.snapshot_date, []);
    snapsByDate.get(s.snapshot_date).push(s);
  }

  const latestByAccount = new Map();
  const points = [];

  for (const dt of sortedDates) {
    const daySnaps = snapsByDate.get(dt) || [];
    for (const s of daySnaps) {
      latestByAccount.set(s.account_id, toNumber(s.balance));
    }

    // On today's point, reflect live current_balance for all non-archived accounts
    if (dt === today) {
      for (const acc of accounts) {
        if (!acc.is_archived) {
          latestByAccount.set(acc.id, toNumber(acc.current_balance));
        } else if (latestByAccount.has(acc.id)) {
          latestByAccount.set(acc.id, toNumber(acc.current_balance));
        }
      }
    }

    let assets = 0;
    let liabilities = 0;
    let retirement401k = 0;
    let banks = 0;
    let investments = 0;
    let loans = 0;
    let creditCards = 0;

    for (const [accId, bal] of latestByAccount.entries()) {
      const acc = accountMap.get(accId);
      if (!acc) continue;
      if (acc.is_liability) {
        liabilities += bal;
        if (acc.category === 'loan') loans += bal;
        if (acc.category === 'credit_card') creditCards += bal;
      } else {
        assets += bal;
        if (acc.category === 'retirement_401k') retirement401k += bal;
        if (acc.category === 'bank') banks += bal;
        if (acc.category === 'investment') investments += bal;
      }
    }

    points.push({
      date: dt,
      label: formatShortDate(dt),
      assets: Number(assets.toFixed(2)),
      liabilities: Number(liabilities.toFixed(2)),
      netWorth: Number((assets - liabilities).toFixed(2)),
      retirement401k: Number(retirement401k.toFixed(2)),
      banks: Number(banks.toFixed(2)),
      investments: Number(investments.toFixed(2)),
      loans: Number(loans.toFixed(2)),
      creditCards: Number(creditCards.toFixed(2)),
    });
  }

  return points;
}

/**
 * Standard amortization payoff estimate for an active loan.
 */
export function estimateLoanPayoff(balance, annualRatePct, monthlyPayment) {
  const P = toNumber(balance);
  const M = toNumber(monthlyPayment);
  const apr = toNumber(annualRatePct);

  if (P <= 0) {
    return { months: 0, totalInterest: 0, payoffDateLabel: 'Paid off', warning: null };
  }
  if (M <= 0) {
    return { months: null, totalInterest: null, payoffDateLabel: 'Set monthly payment', warning: null };
  }

  const r = apr / 100 / 12;
  if (r === 0) {
    const months = Math.ceil(P / M);
    const dt = new Date();
    dt.setMonth(dt.getMonth() + months);
    return {
      months,
      totalInterest: 0,
      payoffDateLabel: dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      warning: null,
    };
  }

  const monthlyInterest = P * r;
  if (M <= monthlyInterest) {
    return {
      months: null,
      totalInterest: null,
      payoffDateLabel: 'Payment < interest',
      warning: `Monthly interest is ${formatCurrency(monthlyInterest)} — payment must exceed this to reduce principal.`,
    };
  }

  const exactMonths = -Math.log(1 - (r * P) / M) / Math.log(1 + r);
  const months = Math.ceil(exactMonths);
  const totalPaid = exactMonths * M;
  const totalInterest = Math.max(0, totalPaid - P);

  const dt = new Date();
  dt.setMonth(dt.getMonth() + months);

  return {
    months,
    totalInterest,
    payoffDateLabel: dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    warning: null,
  };
}

export const OWNER_PROFILES = {
  primary: {
    key: 'primary',
    defaultLabel: 'Me',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  spouse: {
    key: 'spouse',
    defaultLabel: 'Wife',
    badgeClass: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300',
  },
  joint: {
    key: 'joint',
    defaultLabel: 'Joint',
    badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
};

export const HOLDING_TYPES = {
  rsu: { key: 'rsu', label: 'RSU' },
  stock: { key: 'stock', label: 'Stock' },
  etf: { key: 'etf', label: 'ETF' },
  espp: { key: 'espp', label: 'ESPP' },
};

export function getOwnerDisplayName(ownerProfile, householdNames) {
  const key = ownerProfile || 'primary';
  if (key === 'primary') return householdNames?.primary_name || 'Me';
  if (key === 'spouse') return householdNames?.spouse_name || 'Wife';
  if (key === 'joint') return 'Joint';
  return householdNames?.primary_name || 'Me';
}

export function filterByHouseholdScope(items, scope) {
  if (!items) return [];
  if (!scope || scope === 'combined') return items;
  return items.filter((item) => (item.owner_profile || 'primary') === scope);
}

export function computeHouseholdBreakdown(accounts) {
  const buckets = {
    primary: { assets: 0, liabilities: 0, netWorth: 0, count: 0 },
    spouse: { assets: 0, liabilities: 0, netWorth: 0, count: 0 },
    joint: { assets: 0, liabilities: 0, netWorth: 0, count: 0 },
    combined: { assets: 0, liabilities: 0, netWorth: 0, count: 0 },
  };

  for (const acc of accounts || []) {
    if (acc.is_archived) continue;
    const owner = buckets[acc.owner_profile] ? acc.owner_profile : 'primary';
    const bal = toNumber(acc.current_balance);

    if (acc.is_liability) {
      buckets[owner].liabilities += bal;
      buckets.combined.liabilities += bal;
    } else {
      buckets[owner].assets += bal;
      buckets.combined.assets += bal;
    }
    buckets[owner].count += 1;
    buckets.combined.count += 1;
  }

  for (const key of Object.keys(buckets)) {
    buckets[key].netWorth = buckets[key].assets - buckets[key].liabilities;
  }
  return buckets;
}

export function computePromoStatus(promo) {
  const promoBalance = toNumber(promo?.promo_balance);
  const originalAmount = toNumber(promo?.original_amount);

  if (!promo?.expires_on) {
    return {
      daysLeft: 0,
      monthsLeft: 1,
      requiredMonthlyPayment: promoBalance,
      paidOffPct: 0,
      urgency: promo?.is_paid_off || promoBalance <= 0 ? 'paid' : 'ok',
    };
  }

  const [ey, em, ed] = promo.expires_on.split('-').map(Number);
  const expDate = new Date(ey, em - 1, ed);
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLeft = Math.ceil((expDate.getTime() - todayMidnight.getTime()) / 86400000);

  const monthsLeft = Math.max(1, daysLeft / 30.4375);
  const isPaid = Boolean(promo.is_paid_off) || promoBalance <= 0;
  const requiredMonthlyPayment = isPaid
    ? 0
    : daysLeft <= 0
    ? promoBalance
    : promoBalance / monthsLeft;

  const paidOffPct =
    originalAmount > 0
      ? Math.max(0, Math.min(100, ((originalAmount - promoBalance) / originalAmount) * 100))
      : 0;

  let urgency = 'ok';
  if (isPaid) urgency = 'paid';
  else if (daysLeft < 0) urgency = 'expired';
  else if (daysLeft <= 45) urgency = 'urgent';
  else if (daysLeft <= 90) urgency = 'warning';

  return {
    daysLeft,
    monthsLeft,
    requiredMonthlyPayment,
    paidOffPct,
    urgency,
  };
}

export function computeAccountEquitySummary(account, holdingsForAccount) {
  const holdings = holdingsForAccount || [];
  const cashBalance = toNumber(account?.cash_balance);

  if (holdings.length === 0) {
    return {
      hasHoldings: false,
      vestedValue: 0,
      unvestedValue: 0,
      dayChangeValue: 0,
      dayChangePct: 0,
      cashBalance,
      computedBalance: toNumber(account?.current_balance),
      lastPriceAt: null,
    };
  }

  let vestedValue = 0;
  let unvestedValue = 0;
  let prevVestedValue = 0;
  let lastPriceAt = null;

  for (const h of holdings) {
    const shares = toNumber(h.shares);
    const unvested = toNumber(h.unvested_shares);
    const price = toNumber(h.last_price);
    const prev = toNumber(h.prev_close) > 0 ? toNumber(h.prev_close) : price;

    vestedValue += shares * price;
    unvestedValue += unvested * price;
    prevVestedValue += shares * prev;

    if (h.last_price_at && (!lastPriceAt || h.last_price_at > lastPriceAt)) {
      lastPriceAt = h.last_price_at;
    }
  }

  const dayChangeValue = vestedValue - prevVestedValue;
  const dayChangePct = prevVestedValue > 0 ? (dayChangeValue / prevVestedValue) * 100 : 0;

  return {
    hasHoldings: true,
    vestedValue: Number(vestedValue.toFixed(2)),
    unvestedValue: Number(unvestedValue.toFixed(2)),
    dayChangeValue: Number(dayChangeValue.toFixed(2)),
    dayChangePct: Number(dayChangePct.toFixed(2)),
    cashBalance,
    computedBalance: Number((cashBalance + vestedValue).toFixed(2)),
    lastPriceAt,
  };
}

// --- Real & International Assets (US House, Physical Gold, India Property, Vehicles) ---

export const TROY_OZ_IN_GRAMS = 31.1034768;
export const TOLA_IN_GRAMS = 11.6638038;

export const GOLD_PURITY_OPTIONS = {
  '24k': { key: '24k', label: '24K (99.9%)', short: '24K', factor: 1 },
  '22k': { key: '22k', label: '22K (91.7%)', short: '22K', factor: 22 / 24 },
  '18k': { key: '18k', label: '18K (75.0%)', short: '18K', factor: 18 / 24 },
};

export const GOLD_UNIT_OPTIONS = {
  grams: { key: 'grams', label: 'Grams (g)', short: 'g', toGrams: 1 },
  tolas: { key: 'tolas', label: 'Tolas (11.66g)', short: 'tolas', toGrams: TOLA_IN_GRAMS },
  oz: { key: 'oz', label: 'Troy Oz (31.1g)', short: 'oz', toGrams: TROY_OZ_IN_GRAMS },
};

export const INR_UNIT_OPTIONS = {
  crores: { key: 'crores', label: 'Crores (Cr)', short: 'Cr', multiplier: 10_000_000 },
  lakhs: { key: 'lakhs', label: 'Lakhs (L)', short: 'L', multiplier: 100_000 },
  inr: { key: 'inr', label: 'Rupees (₹)', short: '', multiplier: 1 },
};

export function subtypeToRealAssetType(subtype) {
  if (subtype === 'US Home / Real Estate') return 'real_estate';
  if (subtype === 'India Property / Land') return 'india_property';
  if (subtype === 'Physical Gold / Jewelry') return 'gold';
  if (subtype === 'Vehicle / Car') return 'vehicle';
  return 'other';
}

export function getRealAssetType(account) {
  if (!account || account.category !== 'other_asset') return null;
  if (account.metadata?.real_asset_type) return account.metadata.real_asset_type;
  return subtypeToRealAssetType(account.subtype);
}

export function computeGoldUsdValue(weight, unit = 'grams', purity = '22k', goldSpotUsdPerOz = 0) {
  const w = Math.max(0, toNumber(weight));
  const spot = Math.max(0, toNumber(goldSpotUsdPerOz));
  const unitDef = GOLD_UNIT_OPTIONS[unit] || GOLD_UNIT_OPTIONS.grams;
  const purityDef = GOLD_PURITY_OPTIONS[purity] || GOLD_PURITY_OPTIONS['22k'];

  const grams = w * unitDef.toGrams;
  const pureTroyOz = (grams / TROY_OZ_IN_GRAMS) * purityDef.factor;
  const usdValue = Number((pureTroyOz * spot).toFixed(2));
  const perGramUsd = spot > 0 ? (spot / TROY_OZ_IN_GRAMS) * purityDef.factor : 0;

  return {
    usdValue,
    grams,
    pureTroyOz,
    perGramUsd,
  };
}

export function computeInrToUsdValue(amount, unit = 'crores', usdInrRate = 85) {
  const amt = Math.max(0, toNumber(amount));
  const rate = toNumber(usdInrRate);
  const unitDef = INR_UNIT_OPTIONS[unit] || INR_UNIT_OPTIONS.crores;
  const totalInr = amt * unitDef.multiplier;
  const usdValue = rate > 0 ? Number((totalInr / rate).toFixed(2)) : 0;

  return {
    usdValue,
    totalInr,
  };
}

export function formatInrDisplay(amount, unit = 'crores') {
  const amt = toNumber(amount);
  if (unit === 'crores') {
    return `₹${amt.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  }
  if (unit === 'lakhs') {
    return `₹${amt.toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  }
  return `₹${Math.round(amt).toLocaleString('en-IN')}`;
}

export function computeRealAssetLiveBalance(account, quotesMap, nowIso = new Date().toISOString()) {
  if (!account || account.is_archived || account.category !== 'other_asset') return null;
  const meta = account.metadata || {};
  const assetType = getRealAssetType(account);

  if (assetType === 'gold') {
    const q = quotesMap?.['GC=F'];
    const spot = Number(q?.price);
    const weight = toNumber(meta.gold_weight);
    if (!Number.isFinite(spot) || spot <= 0 || weight <= 0) return null;

    const { usdValue } = computeGoldUsdValue(
      weight,
      meta.gold_unit || 'grams',
      meta.gold_purity || '22k',
      spot
    );
    return {
      nextBalance: usdValue,
      nextMetadata: {
        ...meta,
        real_asset_type: 'gold',
        last_gold_oz_price: Number(spot.toFixed(2)),
        last_fx_at: q?.fetchedAt || nowIso,
      },
    };
  }

  if (assetType === 'india_property') {
    const q = quotesMap?.['INR=X'];
    const rate = Number(q?.price);
    const inrAmount = toNumber(meta.inr_amount);
    if (!Number.isFinite(rate) || rate <= 0 || inrAmount <= 0) return null;

    const { usdValue } = computeInrToUsdValue(
      inrAmount,
      meta.inr_unit || 'crores',
      rate
    );
    return {
      nextBalance: usdValue,
      nextMetadata: {
        ...meta,
        real_asset_type: 'india_property',
        last_usd_inr_rate: Number(rate.toFixed(4)),
        last_fx_at: q?.fetchedAt || nowIso,
      },
    };
  }

  return null;
}

export async function decodeVehicleVin(rawVin) {
  const vin = String(rawVin || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (vin.length !== 17) {
    throw new Error('Please enter a standard 17-character VIN.');
  }

  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) {
    throw new Error(`NHTSA VIN lookup failed (HTTP ${resp.status}).`);
  }

  const json = await resp.json();
  const row = json?.Results?.[0];
  const year = String(row?.ModelYear || '').trim();
  const make = String(row?.Make || '').trim();
  const model = String(row?.Model || '').trim();
  const trim = String(row?.Trim || '').trim();
  const bodyClass = String(row?.BodyClass || '').trim();

  if (!make && !model) {
    throw new Error('Could not decode this VIN. Double-check all 17 characters or enter details manually.');
  }

  // Title-case ALL-CAPS makes from NHTSA (e.g., TOYOTA -> Toyota, keep BMW/GMC/MINI/RAM)
  const formatMake = (m) => {
    if (!m) return '';
    if (m.length <= 3) return m.toUpperCase();
    if (m === m.toUpperCase()) {
      return m
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }
    return m;
  };

  const cleanMake = formatMake(make);
  const displayName = [year, cleanMake, model, trim].filter(Boolean).join(' ');

  return {
    vin,
    year,
    make: cleanMake,
    model,
    trim,
    bodyClass,
    displayName,
  };
}

// ============================================================================
// 2026 US W-2 Paystub & Compensation Engine (Zero-PII)
// ============================================================================

export const IRS_2026_LIMITS = {
  employee401k: 24500,
  total401k415c: 72000,
  hsaSelf: 4400,
  hsaFamily: 8750,
  healthFsa: 3400,
  depCareFsaMfj: 7500,
  depCareFsaMfs: 3750,
  esppFmvCap: 25000,
  ssWageBase: 184500,
  ssRate: 0.062,
  medicareRate: 0.0145,
  // OBBBA 2026 SALT, Capital Loss, Child Tax Credit, Safe Harbor & Newborn rules
  saltBaseCap: 40400,
  saltBaseCapMfs: 20200,
  saltFloor: 10000,
  saltFloorMfs: 5000,
  saltPhaseoutThreshold: 505000,
  saltPhaseoutThresholdMfs: 252500,
  saltPhaseoutRate: 0.3,
  capLossOrdinaryLimit: 3000,
  capLossOrdinaryLimitMfs: 1500,
  ctcPerChild: 2200,
  ctcPhaseoutMfj: 400000,
  ctcPhaseoutOther: 200000,
  safeHarborHighAgiThreshold: 150000,
  safeHarborHighAgiThresholdMfs: 75000,
  newbornTrumpAccountSeed: 1000,
  ny529DeductionMfj: 10000,
  ny529DeductionSingle: 5000,
  standardDeduction: {
    married_filing_jointly: 32200,
    married_filing_separately: 16100,
    single: 16100,
    head_of_household: 24150,
  },
  federalBrackets: {
    married_filing_jointly: [
      [24800, 0.1],
      [100800, 0.12],
      [211400, 0.22],
      [403550, 0.24],
      [512450, 0.32],
      [768700, 0.35],
      [Infinity, 0.37],
    ],
    single: [
      [12400, 0.1],
      [50400, 0.12],
      [105700, 0.22],
      [201775, 0.24],
      [256225, 0.32],
      [640600, 0.35],
      [Infinity, 0.37],
    ],
    married_filing_separately: [
      [12400, 0.1],
      [50400, 0.12],
      [105700, 0.22],
      [201775, 0.24],
      [256225, 0.32],
      [384350, 0.35],
      [Infinity, 0.37],
    ],
    head_of_household: [
      [17700, 0.1],
      [67450, 0.12],
      [105700, 0.22],
      [201750, 0.24],
      [256200, 0.32],
      [640600, 0.35],
      [Infinity, 0.37],
    ],
  },
};

export const PAY_FREQUENCIES = [
  { id: 'biweekly', label: 'Bi-Weekly (26/yr)', periods: 26 },
  { id: 'semimonthly', label: 'Semi-Monthly (24/yr)', periods: 24 },
  { id: 'monthly', label: 'Monthly (12/yr)', periods: 12 },
  { id: 'weekly', label: 'Weekly (52/yr)', periods: 52 },
];

export function getPayFrequencyMeta(freqId) {
  return PAY_FREQUENCIES.find((f) => f.id === freqId) || PAY_FREQUENCIES[0];
}

export function createDefaultPersonPaystub() {
  return {
    pay_frequency: 'biweekly',
    other_earnings_per_check: '',
    employer_401k_match_annual: '',
    has_401k_true_up: true,
    employer_hsa_annual: '',
    bonus_withholding_pct: '22',
    rsu_withholding_pct: '22',
    trad_401k_per_check: '',
    medical_per_check: '',
    dental_vision_per_check: '',
    hsa_employee_per_check: '',
    health_fsa_per_check: '',
    dep_care_fsa_per_check: '',
    other_pretax_per_check: '',
    fed_tax_per_check: '',
    state_tax_per_check: '',
    fica_per_check: '',
    roth_401k_per_check: '',
    after_tax_401k_per_check: '',
    espp_per_check: '',
    espp_discount_pct: '15',
    other_posttax_per_check: '',
  };
}

function normalizeOnePersonPaystub(raw) {
  const defaults = createDefaultPersonPaystub();
  if (!raw || typeof raw !== 'object') return defaults;

  const numStr = (val, fallback = '') => {
    if (val === '' || val === null || val === undefined) return fallback;
    const n = Number(val);
    return Number.isFinite(n) ? String(n) : fallback;
  };

  return {
    pay_frequency: PAY_FREQUENCIES.some((f) => f.id === raw.pay_frequency)
      ? raw.pay_frequency
      : defaults.pay_frequency,
    other_earnings_per_check: numStr(raw.other_earnings_per_check),
    employer_401k_match_annual: numStr(raw.employer_401k_match_annual),
    has_401k_true_up:
      raw.has_401k_true_up === undefined ? defaults.has_401k_true_up : Boolean(raw.has_401k_true_up),
    employer_hsa_annual: numStr(raw.employer_hsa_annual),
    bonus_withholding_pct: numStr(raw.bonus_withholding_pct, defaults.bonus_withholding_pct),
    rsu_withholding_pct: numStr(raw.rsu_withholding_pct, defaults.rsu_withholding_pct),
    trad_401k_per_check: numStr(raw.trad_401k_per_check),
    medical_per_check: numStr(raw.medical_per_check),
    dental_vision_per_check: numStr(raw.dental_vision_per_check),
    hsa_employee_per_check: numStr(raw.hsa_employee_per_check),
    health_fsa_per_check: numStr(raw.health_fsa_per_check),
    dep_care_fsa_per_check: numStr(raw.dep_care_fsa_per_check),
    other_pretax_per_check: numStr(raw.other_pretax_per_check),
    fed_tax_per_check: numStr(raw.fed_tax_per_check),
    state_tax_per_check: numStr(raw.state_tax_per_check),
    fica_per_check: numStr(raw.fica_per_check),
    roth_401k_per_check: numStr(raw.roth_401k_per_check),
    after_tax_401k_per_check: numStr(raw.after_tax_401k_per_check),
    espp_per_check: numStr(raw.espp_per_check),
    espp_discount_pct: numStr(raw.espp_discount_pct, defaults.espp_discount_pct),
    other_posttax_per_check: numStr(raw.other_posttax_per_check),
  };
}

export function createDefaultTaxPlanning() {
  return {
    // 1. 2026 Itemized Deductions (Schedule A + OBBBA SALT)
    deduction_mode: 'auto', // 'auto' | 'itemized' | 'standard'
    mortgage_interest_annual: '',
    property_tax_annual: '',
    state_local_income_tax_override: '',
    charitable_donations_annual: '',
    other_itemized_annual: '',
    // 2. W-4 & State Withholding Adjustments + Estimated Payments
    primary_w4_deductions: '',
    primary_w4_extra_per_check: '',
    primary_state_allowances: '',
    spouse_w4_deductions: '',
    spouse_w4_extra_per_check: '',
    spouse_state_allowances: '',
    fed_estimated_payments_ytd: '',
    state_estimated_payments_ytd: '',
    withholding_notes: '',
    // 3. Capital Loss Carryforward & 2026 Realized Gains/Losses (Schedule D)
    cap_loss_carryforward_st: '',
    cap_loss_carryforward_lt: '',
    cap_gains_realized_ytd_st: '',
    cap_gains_realized_ytd_lt: '',
    cap_losses_realized_ytd_st: '',
    cap_losses_realized_ytd_lt: '',
    // 4. 2025 Prior-Year Tax Return Baseline (Zero-PII Safe Harbor)
    prior_year_agi: '',
    prior_year_fed_total_tax: '',
    prior_year_state_total_tax: '',
    prior_year_refund_or_owed: '',
    prior_year_itemized: false,
    prior_year_notes: '',
    // 5. Upcoming Life Events (Baby / Family Planning)
    expecting_child: false,
    expected_child_due_month: '',
    planned_529_annual: '',
    expected_leave_income_dip: '',
    expected_delivery_oop_buffer: '',
    life_event_notes: '',
    // 6. Employer Compliance Guardrail (No Options/Hedging on Employer Stock)
    restricted_option_tickers: '',
  };
}

function normalizeTaxPlanning(raw) {
  const defaults = createDefaultTaxPlanning();
  if (!raw || typeof raw !== 'object') return defaults;

  const numStr = (val, fallback = '') => {
    if (val === '' || val === null || val === undefined) return fallback;
    const n = Number(val);
    return Number.isFinite(n) ? String(n) : fallback;
  };
  const strVal = (val, maxLen = 1000) =>
    typeof val === 'string' ? val.slice(0, maxLen) : '';

  const validModes = ['auto', 'itemized', 'standard'];

  return {
    deduction_mode: validModes.includes(raw.deduction_mode)
      ? raw.deduction_mode
      : defaults.deduction_mode,
    mortgage_interest_annual: numStr(raw.mortgage_interest_annual),
    property_tax_annual: numStr(raw.property_tax_annual),
    state_local_income_tax_override: numStr(raw.state_local_income_tax_override),
    charitable_donations_annual: numStr(raw.charitable_donations_annual),
    other_itemized_annual: numStr(raw.other_itemized_annual),
    primary_w4_deductions: numStr(raw.primary_w4_deductions),
    primary_w4_extra_per_check: numStr(raw.primary_w4_extra_per_check),
    primary_state_allowances: numStr(raw.primary_state_allowances),
    spouse_w4_deductions: numStr(raw.spouse_w4_deductions),
    spouse_w4_extra_per_check: numStr(raw.spouse_w4_extra_per_check),
    spouse_state_allowances: numStr(raw.spouse_state_allowances),
    fed_estimated_payments_ytd: numStr(raw.fed_estimated_payments_ytd),
    state_estimated_payments_ytd: numStr(raw.state_estimated_payments_ytd),
    withholding_notes: strVal(raw.withholding_notes, 500),
    cap_loss_carryforward_st: numStr(raw.cap_loss_carryforward_st),
    cap_loss_carryforward_lt: numStr(raw.cap_loss_carryforward_lt),
    cap_gains_realized_ytd_st: numStr(raw.cap_gains_realized_ytd_st),
    cap_gains_realized_ytd_lt: numStr(raw.cap_gains_realized_ytd_lt),
    cap_losses_realized_ytd_st: numStr(raw.cap_losses_realized_ytd_st),
    cap_losses_realized_ytd_lt: numStr(raw.cap_losses_realized_ytd_lt),
    prior_year_agi: numStr(raw.prior_year_agi),
    prior_year_fed_total_tax: numStr(raw.prior_year_fed_total_tax),
    prior_year_state_total_tax: numStr(raw.prior_year_state_total_tax),
    prior_year_refund_or_owed: numStr(raw.prior_year_refund_or_owed),
    prior_year_itemized: Boolean(raw.prior_year_itemized),
    prior_year_notes: strVal(raw.prior_year_notes, 1000),
    expecting_child: Boolean(raw.expecting_child),
    expected_child_due_month: strVal(raw.expected_child_due_month, 20),
    planned_529_annual: numStr(raw.planned_529_annual),
    expected_leave_income_dip: numStr(raw.expected_leave_income_dip),
    expected_delivery_oop_buffer: numStr(raw.expected_delivery_oop_buffer),
    life_event_notes: strVal(raw.life_event_notes, 1000),
    restricted_option_tickers: strVal(raw.restricted_option_tickers, 200),
  };
}

export function normalizePaystubDetails(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    primary: normalizeOnePersonPaystub(src.primary),
    spouse: normalizeOnePersonPaystub(src.spouse),
    tax_planning: normalizeTaxPlanning(src.tax_planning),
    payroll_autosync: normalizePayrollAutoSync(src.payroll_autosync),
    options_desk: normalizeOptionsDesk(src.options_desk),
  };
}

export function sanitizePaystubDetailsForDb(raw) {
  const norm = normalizePaystubDetails(raw);
  const cleanPerson = (p) => ({
    pay_frequency: p.pay_frequency,
    other_earnings_per_check: Math.max(0, toNumber(p.other_earnings_per_check)),
    employer_401k_match_annual: Math.max(0, toNumber(p.employer_401k_match_annual)),
    has_401k_true_up: Boolean(p.has_401k_true_up),
    employer_hsa_annual: Math.max(0, toNumber(p.employer_hsa_annual)),
    bonus_withholding_pct: Math.max(0, Math.min(55, toNumber(p.bonus_withholding_pct))),
    rsu_withholding_pct: Math.max(0, Math.min(55, toNumber(p.rsu_withholding_pct))),
    trad_401k_per_check: Math.max(0, toNumber(p.trad_401k_per_check)),
    medical_per_check: Math.max(0, toNumber(p.medical_per_check)),
    dental_vision_per_check: Math.max(0, toNumber(p.dental_vision_per_check)),
    hsa_employee_per_check: Math.max(0, toNumber(p.hsa_employee_per_check)),
    health_fsa_per_check: Math.max(0, toNumber(p.health_fsa_per_check)),
    dep_care_fsa_per_check: Math.max(0, toNumber(p.dep_care_fsa_per_check)),
    other_pretax_per_check: Math.max(0, toNumber(p.other_pretax_per_check)),
    fed_tax_per_check: Math.max(0, toNumber(p.fed_tax_per_check)),
    state_tax_per_check: Math.max(0, toNumber(p.state_tax_per_check)),
    fica_per_check: Math.max(0, toNumber(p.fica_per_check)),
    roth_401k_per_check: Math.max(0, toNumber(p.roth_401k_per_check)),
    after_tax_401k_per_check: Math.max(0, toNumber(p.after_tax_401k_per_check)),
    espp_per_check: Math.max(0, toNumber(p.espp_per_check)),
    espp_discount_pct: Math.max(0, Math.min(50, toNumber(p.espp_discount_pct))),
    other_posttax_per_check: Math.max(0, toNumber(p.other_posttax_per_check)),
  });

  const tp = norm.tax_planning;
  const cleanTaxPlanning = {
    deduction_mode: tp.deduction_mode,
    mortgage_interest_annual: Math.max(0, toNumber(tp.mortgage_interest_annual)),
    property_tax_annual: Math.max(0, toNumber(tp.property_tax_annual)),
    state_local_income_tax_override: Math.max(0, toNumber(tp.state_local_income_tax_override)),
    charitable_donations_annual: Math.max(0, toNumber(tp.charitable_donations_annual)),
    other_itemized_annual: Math.max(0, toNumber(tp.other_itemized_annual)),
    primary_w4_deductions: Math.max(0, toNumber(tp.primary_w4_deductions)),
    primary_w4_extra_per_check: Math.max(0, toNumber(tp.primary_w4_extra_per_check)),
    primary_state_allowances: Math.max(0, Math.min(99, Math.floor(toNumber(tp.primary_state_allowances)))),
    spouse_w4_deductions: Math.max(0, toNumber(tp.spouse_w4_deductions)),
    spouse_w4_extra_per_check: Math.max(0, toNumber(tp.spouse_w4_extra_per_check)),
    spouse_state_allowances: Math.max(0, Math.min(99, Math.floor(toNumber(tp.spouse_state_allowances)))),
    fed_estimated_payments_ytd: Math.max(0, toNumber(tp.fed_estimated_payments_ytd)),
    state_estimated_payments_ytd: Math.max(0, toNumber(tp.state_estimated_payments_ytd)),
    withholding_notes: tp.withholding_notes.trim().slice(0, 500),
    cap_loss_carryforward_st: Math.max(0, toNumber(tp.cap_loss_carryforward_st)),
    cap_loss_carryforward_lt: Math.max(0, toNumber(tp.cap_loss_carryforward_lt)),
    cap_gains_realized_ytd_st: Math.max(0, toNumber(tp.cap_gains_realized_ytd_st)),
    cap_gains_realized_ytd_lt: Math.max(0, toNumber(tp.cap_gains_realized_ytd_lt)),
    cap_losses_realized_ytd_st: Math.max(0, toNumber(tp.cap_losses_realized_ytd_st)),
    cap_losses_realized_ytd_lt: Math.max(0, toNumber(tp.cap_losses_realized_ytd_lt)),
    prior_year_agi: Math.max(0, toNumber(tp.prior_year_agi)),
    prior_year_fed_total_tax: Math.max(0, toNumber(tp.prior_year_fed_total_tax)),
    prior_year_state_total_tax: Math.max(0, toNumber(tp.prior_year_state_total_tax)),
    prior_year_refund_or_owed:
      tp.prior_year_refund_or_owed === '' ? 0 : toNumber(tp.prior_year_refund_or_owed),
    prior_year_itemized: Boolean(tp.prior_year_itemized),
    prior_year_notes: tp.prior_year_notes.trim().slice(0, 1000),
    expecting_child: Boolean(tp.expecting_child),
    expected_child_due_month: tp.expected_child_due_month.trim().slice(0, 20),
    planned_529_annual: Math.max(0, toNumber(tp.planned_529_annual)),
    expected_leave_income_dip: Math.max(0, toNumber(tp.expected_leave_income_dip)),
    expected_delivery_oop_buffer: Math.max(0, toNumber(tp.expected_delivery_oop_buffer)),
    life_event_notes: tp.life_event_notes.trim().slice(0, 1000),
    restricted_option_tickers: tp.restricted_option_tickers.trim().toUpperCase().slice(0, 200),
  };

  return {
    primary: cleanPerson(norm.primary),
    spouse: cleanPerson(norm.spouse),
    tax_planning: cleanTaxPlanning,
    payroll_autosync: sanitizePayrollAutoSyncForDb(norm.payroll_autosync),
    options_desk: sanitizeOptionsDeskForDb(norm.options_desk),
  };
}

export function estimate2026FederalTax(
  grossAnnualIncome,
  totalPreTaxAnnual,
  filingStatus,
  options = {}
) {
  const statusKey = IRS_2026_LIMITS.federalBrackets[filingStatus]
    ? filingStatus
    : 'married_filing_jointly';
  const stdDeduction = IRS_2026_LIMITS.standardDeduction[statusKey];
  const brackets = IRS_2026_LIMITS.federalBrackets[statusKey];

  const {
    itemizedDeduction = 0,
    deductionMode = 'auto',
    capLossOrdinaryDeduction = 0,
    netTaxableCapGain = 0,
    dependentsCount = 0,
  } = options || {};

  const gross = Math.max(0, toNumber(grossAnnualIncome));
  const preTax = Math.max(0, toNumber(totalPreTaxAnnual));
  const capLossDed = Math.max(0, toNumber(capLossOrdinaryDeduction));
  const netCapGain = Math.max(0, toNumber(netTaxableCapGain));
  const cleanItemized = Math.max(0, toNumber(itemizedDeduction));

  const ordinaryAgi = Math.max(0, gross - preTax - capLossDed);
  const agiEstimate = ordinaryAgi + netCapGain;

  const usingItemized =
    deductionMode === 'itemized'
      ? true
      : deductionMode === 'standard'
      ? false
      : cleanItemized > stdDeduction;
  const appliedDeduction = usingItemized ? cleanItemized : stdDeduction;
  const excessOverStandard = Math.max(0, cleanItemized - stdDeduction);

  const ordinaryTaxableIncome = Math.max(0, ordinaryAgi - appliedDeduction);
  const taxableIncome = ordinaryTaxableIncome + netCapGain;

  let ordinaryTax = 0;
  let prevCap = 0;
  let marginalRate = brackets[0][1];

  for (const [cap, rate] of brackets) {
    if (ordinaryTaxableIncome <= prevCap) break;
    const slice = Math.min(ordinaryTaxableIncome, cap) - prevCap;
    if (slice > 0) {
      ordinaryTax += slice * rate;
      marginalRate = rate;
    }
    prevCap = cap;
  }

  const ltcgHighThreshold = statusKey === 'married_filing_jointly' ? 600000 : 533000;
  const ltcgRate = agiEstimate > ltcgHighThreshold ? 0.2 : 0.15;
  const capGainTax = netCapGain * ltcgRate;
  const estimatedTaxBeforeCredits = ordinaryTax + capGainTax;

  // OBBBA 2026 Child Tax Credit ($2,200/child, phased out $50/$1k above $400k MFJ / $200k other)
  const deps = Math.max(0, Math.floor(toNumber(dependentsCount)));
  const ctcThreshold =
    statusKey === 'married_filing_jointly'
      ? IRS_2026_LIMITS.ctcPhaseoutMfj
      : IRS_2026_LIMITS.ctcPhaseoutOther;
  const ctcExcessThousands =
    agiEstimate > ctcThreshold ? Math.ceil((agiEstimate - ctcThreshold) / 1000) : 0;
  const ctcCredit = Math.max(0, deps * IRS_2026_LIMITS.ctcPerChild - ctcExcessThousands * 50);

  const estimatedTax = Math.max(0, estimatedTaxBeforeCredits - ctcCredit);
  const marginalRatePct = ordinaryTaxableIncome > 0 ? Math.round(marginalRate * 100) : 0;
  const effectiveRatePct = gross > 0 ? (estimatedTax / gross) * 100 : 0;

  return {
    filingStatus: statusKey,
    stdDeduction,
    itemizedDeduction: cleanItemized,
    usingItemized,
    appliedDeduction,
    excessOverStandard,
    agiEstimate,
    taxableIncome,
    estimatedTaxBeforeCredits,
    ctcCredit,
    estimatedTax,
    marginalRatePct,
    effectiveRatePct,
  };
}

export function computePersonPaystub(annualFields, paystubFields) {
  const baseSalary = Math.max(0, toNumber(annualFields?.baseSalary));
  const bonusAnnual = Math.max(0, toNumber(annualFields?.bonusAnnual));
  const rsuAnnual = Math.max(0, toNumber(annualFields?.rsuAnnual));
  const ytd401k = Math.max(0, toNumber(annualFields?.ytd401k));
  const hasMegaBackdoor = Boolean(annualFields?.hasMegaBackdoor);
  const esppEnrolled = Boolean(annualFields?.esppEnrolled);

  const p = normalizeOnePersonPaystub(paystubFields);
  const freqMeta = getPayFrequencyMeta(p.pay_frequency);
  const periods = freqMeta.periods;

  const basePerPaycheck = baseSalary / periods;
  const otherEarningsPerPaycheck = Math.max(0, toNumber(p.other_earnings_per_check));
  const grossPerPaycheck = basePerPaycheck + otherEarningsPerPaycheck;

  // Pre-tax per check
  const trad401k = Math.max(0, toNumber(p.trad_401k_per_check));
  const medical = Math.max(0, toNumber(p.medical_per_check));
  const dentalVision = Math.max(0, toNumber(p.dental_vision_per_check));
  const hsaEmployee = Math.max(0, toNumber(p.hsa_employee_per_check));
  const healthFsa = Math.max(0, toNumber(p.health_fsa_per_check));
  const depCareFsa = Math.max(0, toNumber(p.dep_care_fsa_per_check));
  const otherPreTax = Math.max(0, toNumber(p.other_pretax_per_check));

  const section125PreTaxPerPaycheck = medical + dentalVision + hsaEmployee + healthFsa + depCareFsa;
  const preTaxPerPaycheck = trad401k + section125PreTaxPerPaycheck + otherPreTax;
  const taxablePerPaycheck = Math.max(0, grossPerPaycheck - preTaxPerPaycheck);

  // Taxes per check
  const fedTax = Math.max(0, toNumber(p.fed_tax_per_check));
  const stateTax = Math.max(0, toNumber(p.state_tax_per_check));
  const fica = Math.max(0, toNumber(p.fica_per_check));
  const taxesPerPaycheck = fedTax + stateTax + fica;

  // Post-tax per check
  const roth401k = Math.max(0, toNumber(p.roth_401k_per_check));
  const afterTax401k = Math.max(0, toNumber(p.after_tax_401k_per_check));
  const esppPerCheck = Math.max(0, toNumber(p.espp_per_check));
  const esppDiscountPct = Math.max(0, Math.min(50, toNumber(p.espp_discount_pct)));
  const otherPostTax = Math.max(0, toNumber(p.other_posttax_per_check));
  const postTaxPerPaycheck = roth401k + afterTax401k + esppPerCheck + otherPostTax;

  const netPerPaycheck = grossPerPaycheck - preTaxPerPaycheck - taxesPerPaycheck - postTaxPerPaycheck;

  const annualFicaTaxableEstimate = Math.max(0, grossPerPaycheck - section125PreTaxPerPaycheck) * periods;
  const estAnnualSs =
    Math.min(annualFicaTaxableEstimate, IRS_2026_LIMITS.ssWageBase) * IRS_2026_LIMITS.ssRate;
  const estAnnualMed =
    annualFicaTaxableEstimate * IRS_2026_LIMITS.medicareRate +
    Math.max(0, annualFicaTaxableEstimate - 200000) * 0.009;
  const estimatedFicaPerPaycheck =
    grossPerPaycheck > 0 ? Number(((estAnnualSs + estAnnualMed) / periods).toFixed(2)) : 0;

  const effectiveWithholdingPct =
    grossPerPaycheck > 0 ? (taxesPerPaycheck / grossPerPaycheck) * 100 : 0;

  // Annual & monthly aggregates
  const annualBaseWithOther = grossPerPaycheck * periods;
  const annualCashAndEquityComp = annualBaseWithOther + bonusAnnual + rsuAnnual;
  const annualNetBase = netPerPaycheck * periods;
  const avgMonthlyNetBase = annualNetBase / 12;
  const typicalTwoCheckMonthlyNet =
    p.pay_frequency === 'biweekly' ? netPerPaycheck * 2 : avgMonthlyNetBase;
  const extraBiweeklyPaychecksAnnual = p.pay_frequency === 'biweekly' ? netPerPaycheck * 2 : 0;

  // Annualized deductions & benefits
  const annualTrad401k = trad401k * periods;
  const annualRoth401k = roth401k * periods;
  const annualEmployee401kProjected = annualTrad401k + annualRoth401k;
  const annualAfterTax401k = afterTax401k * periods;
  const employerMatchAnnual = Math.max(0, toNumber(p.employer_401k_match_annual));
  const total401k415cProjected =
    Math.min(annualEmployee401kProjected, IRS_2026_LIMITS.employee401k) +
    employerMatchAnnual +
    annualAfterTax401k;

  const remaining401kByYtd = Math.max(0, IRS_2026_LIMITS.employee401k - ytd401k);
  const remaining415cRoom = Math.max(0, IRS_2026_LIMITS.total401k415c - total401k415cProjected);
  const maxPerCheck401kTarget = Number((IRS_2026_LIMITS.employee401k / periods).toFixed(2));
  const electivePerCheck = trad401k + roth401k;
  const early401kMaxOutCheck =
    electivePerCheck > 0 && annualEmployee401kProjected > IRS_2026_LIMITS.employee401k + 1
      ? Math.ceil(IRS_2026_LIMITS.employee401k / electivePerCheck)
      : null;

  const annualMedical = medical * periods;
  const annualDentalVision = dentalVision * periods;
  const annualHealthPremiums = annualMedical + annualDentalVision;

  const annualHsaEmployee = hsaEmployee * periods;
  const employerHsaAnnual = Math.max(0, toNumber(p.employer_hsa_annual));
  const annualHsaTotal = annualHsaEmployee + employerHsaAnnual;

  const annualHealthFsa = healthFsa * periods;
  const annualDepCareFsa = depCareFsa * periods;
  const annualOtherPreTax = otherPreTax * periods;
  const annualPreTaxTotal = preTaxPerPaycheck * periods;

  const annualFedTaxFromBase = fedTax * periods;
  const annualStateTaxFromBase = stateTax * periods;
  const annualFicaFromBase = fica * periods;
  const annualTaxesFromBase = taxesPerPaycheck * periods;

  const annualEsppContribution = esppPerCheck * periods;
  const discountDecimal = esppDiscountPct / 100;
  const esppMaxCashContrib =
    discountDecimal < 1
      ? IRS_2026_LIMITS.esppFmvCap * (1 - discountDecimal)
      : IRS_2026_LIMITS.esppFmvCap;
  const annualEsppImpliedGain =
    discountDecimal > 0 && discountDecimal < 1
      ? annualEsppContribution * (discountDecimal / (1 - discountDecimal))
      : 0;

  const annualOtherPostTax = otherPostTax * periods;
  const annualPostTaxTotal = postTaxPerPaycheck * periods;

  const bonusWithholdingPct = Math.max(0, Math.min(55, toNumber(p.bonus_withholding_pct)));
  const rsuWithholdingPct = Math.max(0, Math.min(55, toNumber(p.rsu_withholding_pct)));
  const estFedWithheldFromSupplemental =
    bonusAnnual * (bonusWithholdingPct / 100) + rsuAnnual * (rsuWithholdingPct / 100);

  const totalAnnualWealthBuilding =
    Math.min(annualEmployee401kProjected, IRS_2026_LIMITS.employee401k) +
    employerMatchAnnual +
    annualAfterTax401k +
    annualHsaTotal +
    annualEsppContribution +
    annualEsppImpliedGain;

  const totalCompWithEmployerBenefits =
    annualCashAndEquityComp + employerMatchAnnual + employerHsaAnnual + annualEsppImpliedGain;

  return {
    baseSalary,
    bonusAnnual,
    rsuAnnual,
    ytd401k,
    hasMegaBackdoor,
    esppEnrolled,
    payFrequency: p.pay_frequency,
    payFrequencyLabel: freqMeta.label,
    periods,
    has401kTrueUp: Boolean(p.has_401k_true_up),

    // Per paycheck
    basePerPaycheck,
    otherEarningsPerPaycheck,
    grossPerPaycheck,
    preTaxPerPaycheck,
    section125PreTaxPerPaycheck,
    taxablePerPaycheck,
    taxesPerPaycheck,
    postTaxPerPaycheck,
    netPerPaycheck,
    hasPaystubDeductions: preTaxPerPaycheck > 0 || taxesPerPaycheck > 0 || postTaxPerPaycheck > 0,
    hasTaxWithholding: taxesPerPaycheck > 0,
    hasFedWithholding: fedTax > 0,
    estimatedFicaPerPaycheck,
    effectiveWithholdingPct,

    // Itemized per paycheck
    trad401k,
    medical,
    dentalVision,
    hsaEmployee,
    healthFsa,
    depCareFsa,
    otherPreTax,
    fedTax,
    stateTax,
    fica,
    roth401k,
    afterTax401k,
    esppPerCheck,
    otherPostTax,

    // Monthly & annual
    annualBaseWithOther,
    annualCashAndEquityComp,
    annualNetBase,
    avgMonthlyNetBase,
    typicalTwoCheckMonthlyNet,
    extraBiweeklyPaychecksAnnual,

    // Annualized items & caps
    annualTrad401k,
    annualRoth401k,
    annualEmployee401kProjected,
    annualAfterTax401k,
    employerMatchAnnual,
    total401k415cProjected,
    remaining401kByYtd,
    remaining415cRoom,
    maxPerCheck401kTarget,
    early401kMaxOutCheck,

    annualMedical,
    annualDentalVision,
    annualHealthPremiums,
    annualHsaEmployee,
    employerHsaAnnual,
    annualHsaTotal,
    annualHealthFsa,
    annualDepCareFsa,
    annualOtherPreTax,
    annualPreTaxTotal,

    annualFedTaxFromBase,
    annualStateTaxFromBase,
    annualFicaFromBase,
    annualTaxesFromBase,

    annualEsppContribution,
    esppDiscountPct,
    esppMaxCashContrib,
    annualEsppImpliedGain,
    annualOtherPostTax,
    annualPostTaxTotal,

    bonusWithholdingPct,
    rsuWithholdingPct,
    estFedWithheldFromSupplemental,
    totalAnnualWealthBuilding,
    totalCompWithEmployerBenefits,
  };
}

export function computeHouseholdPaystubSummary(profileForm, names = { primary_name: 'Me', spouse_name: 'Wife' }) {
  const details = normalizePaystubDetails(profileForm?.paystub_details);

  const primary = computePersonPaystub(
    {
      baseSalary: profileForm?.primary_base_salary,
      bonusAnnual: profileForm?.primary_bonus_annual,
      rsuAnnual: profileForm?.primary_rsu_annual,
      ytd401k: profileForm?.primary_401k_ytd,
      hasMegaBackdoor: profileForm?.primary_has_mega_backdoor,
      esppEnrolled: profileForm?.primary_espp_enrolled,
    },
    details.primary
  );

  const spouse = computePersonPaystub(
    {
      baseSalary: profileForm?.spouse_base_salary,
      bonusAnnual: profileForm?.spouse_bonus_annual,
      rsuAnnual: profileForm?.spouse_rsu_annual,
      ytd401k: profileForm?.spouse_401k_ytd,
      hasMegaBackdoor: profileForm?.spouse_has_mega_backdoor,
      esppEnrolled: profileForm?.spouse_espp_enrolled,
    },
    details.spouse
  );

  const filingStatus = profileForm?.filing_status || 'married_filing_jointly';
  const stateCode = String(profileForm?.state_code || '').trim().toUpperCase();
  const isMfs = filingStatus === 'married_filing_separately';
  const hsaPlanType = profileForm?.hsa_plan_type || 'none';
  const hsaYtd = Math.max(0, toNumber(profileForm?.hsa_contrib_ytd));
  const tp = details.tax_planning;

  const combinedGrossComp = primary.annualCashAndEquityComp + spouse.annualCashAndEquityComp;
  const combinedTotalCompWithBenefits =
    primary.totalCompWithEmployerBenefits + spouse.totalCompWithEmployerBenefits;
  const combinedAnnualPreTax = primary.annualPreTaxTotal + spouse.annualPreTaxTotal;
  const combinedAnnualTaxesFromBase = primary.annualTaxesFromBase + spouse.annualTaxesFromBase;
  const combinedAnnualPostTax = primary.annualPostTaxTotal + spouse.annualPostTaxTotal;
  const combinedAnnualNetBase = primary.annualNetBase + spouse.annualNetBase;
  const combinedAvgMonthlyNetBase = combinedAnnualNetBase / 12;
  const combinedTypicalMonthlyNet =
    primary.typicalTwoCheckMonthlyNet + spouse.typicalTwoCheckMonthlyNet;
  const combinedWealthBuildingAnnual =
    primary.totalAnnualWealthBuilding + spouse.totalAnnualWealthBuilding;

  const hasAnyTaxWithholding = primary.hasTaxWithholding || spouse.hasTaxWithholding;
  const hasAnyFedWithholding = primary.hasFedWithholding || spouse.hasFedWithholding;

  const hsaLimit =
    hsaPlanType === 'family'
      ? IRS_2026_LIMITS.hsaFamily
      : hsaPlanType === 'self'
      ? IRS_2026_LIMITS.hsaSelf
      : 0;
  const hsaProjectedTotal = primary.annualHsaTotal + spouse.annualHsaTotal;
  const hsaRemainingByYtd = Math.max(0, hsaLimit - hsaYtd);

  const depCareFsaLimit = isMfs
    ? IRS_2026_LIMITS.depCareFsaMfs
    : IRS_2026_LIMITS.depCareFsaMfj;
  const depCareFsaProjectedTotal = primary.annualDepCareFsa + spouse.annualDepCareFsa;

  // Capital Loss Carryforward & 2026 Realized Gains/Losses (Schedule D)
  const carryforwardSt = Math.max(0, toNumber(tp.cap_loss_carryforward_st));
  const carryforwardLt = Math.max(0, toNumber(tp.cap_loss_carryforward_lt));
  const totalCarryforward = carryforwardSt + carryforwardLt;
  const ytdGainsSt = Math.max(0, toNumber(tp.cap_gains_realized_ytd_st));
  const ytdGainsLt = Math.max(0, toNumber(tp.cap_gains_realized_ytd_lt));
  const totalYtdGains = ytdGainsSt + ytdGainsLt;
  const ytdLossesSt = Math.max(0, toNumber(tp.cap_losses_realized_ytd_st));
  const ytdLossesLt = Math.max(0, toNumber(tp.cap_losses_realized_ytd_lt));
  const totalYtdLosses = ytdLossesSt + ytdLossesLt;
  const totalLossesAvailable = totalCarryforward + totalYtdLosses;
  const netCapitalPosition = totalYtdGains - totalLossesAvailable;
  const capLossOrdinaryLimit = isMfs
    ? IRS_2026_LIMITS.capLossOrdinaryLimitMfs
    : IRS_2026_LIMITS.capLossOrdinaryLimit;
  const capLossOrdinaryDeduction =
    netCapitalPosition < 0 ? Math.min(capLossOrdinaryLimit, Math.abs(netCapitalPosition)) : 0;
  const capGainsShielded = Math.min(totalYtdGains, totalLossesAvailable);
  const remainingCarryforwardTo2027 =
    netCapitalPosition < 0
      ? Math.max(0, Math.abs(netCapitalPosition) - capLossOrdinaryDeduction)
      : 0;
  const netTaxableCapGain = netCapitalPosition > 0 ? netCapitalPosition : 0;
  const capLosses = {
    carryforwardSt,
    carryforwardLt,
    totalCarryforward,
    ytdGainsSt,
    ytdGainsLt,
    totalYtdGains,
    ytdLossesSt,
    ytdLossesLt,
    totalYtdLosses,
    totalLossesAvailable,
    netCapitalPosition,
    ordinaryLimit: capLossOrdinaryLimit,
    ordinaryDeduction: capLossOrdinaryDeduction,
    gainsShielded: capGainsShielded,
    remainingCarryforwardTo2027,
    netTaxableCapGain,
    hasActivity: totalCarryforward > 0 || totalYtdGains > 0 || totalYtdLosses > 0,
  };

  // Estimated 2026 AGI/MAGI & OBBBA Dynamic SALT Cap ($40,400 w/ 30% phaseout above $505k MAGI)
  const estAgi = Math.max(
    0,
    combinedGrossComp - combinedAnnualPreTax - capLossOrdinaryDeduction + netTaxableCapGain
  );
  const saltBaseCap = isMfs ? IRS_2026_LIMITS.saltBaseCapMfs : IRS_2026_LIMITS.saltBaseCap;
  const saltFloor = isMfs ? IRS_2026_LIMITS.saltFloorMfs : IRS_2026_LIMITS.saltFloor;
  const saltPhaseoutThreshold = isMfs
    ? IRS_2026_LIMITS.saltPhaseoutThresholdMfs
    : IRS_2026_LIMITS.saltPhaseoutThreshold;
  const saltPhaseoutReduction =
    Math.max(0, estAgi - saltPhaseoutThreshold) * IRS_2026_LIMITS.saltPhaseoutRate;
  const saltEffectiveCap = Math.max(saltFloor, saltBaseCap - saltPhaseoutReduction);
  const inSaltPhaseoutZone = estAgi > saltPhaseoutThreshold && saltEffectiveCap > saltFloor;
  const approachingSaltPhaseout =
    estAgi >= saltPhaseoutThreshold - 25000 && estAgi <= saltPhaseoutThreshold;

  const autoStateTaxFromPaystubs =
    primary.annualStateTaxFromBase + spouse.annualStateTaxFromBase;
  const stateTaxOverride = Math.max(0, toNumber(tp.state_local_income_tax_override));
  const stateLocalTaxForSalt =
    stateTaxOverride > 0 ? stateTaxOverride : autoStateTaxFromPaystubs;
  const mortgageInterest = Math.max(0, toNumber(tp.mortgage_interest_annual));
  const propertyTax = Math.max(0, toNumber(tp.property_tax_annual));
  const charitable = Math.max(0, toNumber(tp.charitable_donations_annual));
  const otherItemized = Math.max(0, toNumber(tp.other_itemized_annual));
  const rawSaltPaid = propertyTax + stateLocalTaxForSalt;
  const deductibleSalt = Math.min(rawSaltPaid, saltEffectiveCap);
  const saltCappedLoss = Math.max(0, rawSaltPaid - deductibleSalt);
  const totalItemized = mortgageInterest + deductibleSalt + charitable + otherItemized;
  const standardDeduction =
    IRS_2026_LIMITS.standardDeduction[filingStatus] ??
    IRS_2026_LIMITS.standardDeduction.married_filing_jointly;
  const excessOverStandard = Math.max(0, totalItemized - standardDeduction);
  const hasItemizedInputs =
    mortgageInterest > 0 ||
    propertyTax > 0 ||
    stateTaxOverride > 0 ||
    charitable > 0 ||
    otherItemized > 0;

  const deductions = {
    mode: tp.deduction_mode || 'auto',
    estAgi,
    saltBaseCap,
    saltFloor,
    saltPhaseoutThreshold,
    saltEffectiveCap,
    inSaltPhaseoutZone,
    approachingSaltPhaseout,
    autoStateTaxFromPaystubs,
    stateTaxOverride,
    stateLocalTaxForSalt,
    mortgageInterest,
    propertyTax,
    charitable,
    otherItemized,
    rawSaltPaid,
    deductibleSalt,
    saltCappedLoss,
    totalItemized,
    standardDeduction,
    excessOverStandard,
    hasItemizedInputs,
  };

  const fedTax = estimate2026FederalTax(combinedGrossComp, combinedAnnualPreTax, filingStatus, {
    itemizedDeduction: totalItemized,
    deductionMode: tp.deduction_mode || 'auto',
    capLossOrdinaryDeduction,
    netTaxableCapGain,
    dependentsCount: profileForm?.dependents_count,
  });

  const fedEstimatedYtd = Math.max(0, toNumber(tp.fed_estimated_payments_ytd));
  const stateEstimatedYtd = Math.max(0, toNumber(tp.state_estimated_payments_ytd));
  const projectedTotalFedWithheld =
    primary.annualFedTaxFromBase +
    spouse.annualFedTaxFromBase +
    primary.estFedWithheldFromSupplemental +
    spouse.estFedWithheldFromSupplemental;
  const projectedTotalFedPayments = projectedTotalFedWithheld + fedEstimatedYtd;

  const estFedWithholdingDiff =
    hasAnyFedWithholding || fedEstimatedYtd > 0
      ? projectedTotalFedPayments - fedTax.estimatedTax
      : null;

  const marginalDecimal = fedTax.marginalRatePct / 100;
  const computeSupplementalGap = (p) =>
    p.bonusAnnual * Math.max(0, marginalDecimal - p.bonusWithholdingPct / 100) +
    p.rsuAnnual * Math.max(0, marginalDecimal - p.rsuWithholdingPct / 100);
  const estSupplementalWithholdingGap =
    fedTax.marginalRatePct > 0
      ? computeSupplementalGap(primary) + computeSupplementalGap(spouse)
      : 0;

  // W-4, State Withholding & 2025 Safe Harbor Checks
  const primaryW4Deductions = Math.max(0, toNumber(tp.primary_w4_deductions));
  const spouseW4Deductions = Math.max(0, toNumber(tp.spouse_w4_deductions));
  const combinedW4Deductions = primaryW4Deductions + spouseW4Deductions;
  const primaryStateAllowances = Math.max(0, Math.floor(toNumber(tp.primary_state_allowances)));
  const spouseStateAllowances = Math.max(0, Math.floor(toNumber(tp.spouse_state_allowances)));

  const priorYearAgi = Math.max(0, toNumber(tp.prior_year_agi));
  const priorYearFedTax = Math.max(0, toNumber(tp.prior_year_fed_total_tax));
  const priorYearStateTax = Math.max(0, toNumber(tp.prior_year_state_total_tax));
  const highAgiThreshold = isMfs
    ? IRS_2026_LIMITS.safeHarborHighAgiThresholdMfs
    : IRS_2026_LIMITS.safeHarborHighAgiThreshold;
  const safeHarborMultiplier =
    priorYearAgi > highAgiThreshold || (priorYearAgi === 0 && estAgi > highAgiThreshold)
      ? 1.1
      : 1.0;

  const fedSafeHarborPriorYear = priorYearFedTax > 0 ? priorYearFedTax * safeHarborMultiplier : 0;
  const fedSafeHarborCurrentYear = fedTax.estimatedTax * 0.9;
  const fedSafeHarborRequired =
    priorYearFedTax > 0
      ? Math.min(fedSafeHarborPriorYear, fedSafeHarborCurrentYear)
      : fedSafeHarborCurrentYear;
  const fedSafeHarborMet =
    priorYearFedTax > 0 && (hasAnyFedWithholding || fedEstimatedYtd > 0)
      ? projectedTotalFedPayments >= fedSafeHarborRequired
      : null;
  const fedSafeHarborGap =
    fedSafeHarborMet === false
      ? Math.max(0, fedSafeHarborRequired - projectedTotalFedPayments)
      : 0;

  const projectedStatePayments = autoStateTaxFromPaystubs + stateEstimatedYtd;
  const stateSafeHarborTarget =
    priorYearStateTax > 0 ? priorYearStateTax * safeHarborMultiplier : 0;
  const stateSafeHarborMet =
    priorYearStateTax > 0 && projectedStatePayments > 0
      ? projectedStatePayments >= stateSafeHarborTarget
      : null;
  const stateSafeHarborGap =
    stateSafeHarborMet === false
      ? Math.max(0, stateSafeHarborTarget - projectedStatePayments)
      : 0;

  const safeHarbor = {
    priorYearAgi,
    priorYearFedTax,
    priorYearStateTax,
    safeHarborMultiplier,
    fedSafeHarborPriorYear,
    fedSafeHarborCurrentYear,
    fedSafeHarborRequired,
    projectedTotalFedPayments,
    fedSafeHarborMet,
    fedSafeHarborGap,
    projectedStatePayments,
    stateSafeHarborTarget,
    stateSafeHarborMet,
    stateSafeHarborGap,
    combinedW4Deductions,
    primaryStateAllowances,
    spouseStateAllowances,
    fedEstimatedYtd,
    stateEstimatedYtd,
  };

  const lifeEvents = {
    expectingChild: Boolean(tp.expecting_child),
    dueMonth: tp.expected_child_due_month || '',
    planned529Annual: Math.max(0, toNumber(tp.planned_529_annual)),
    expectedLeaveDip: Math.max(0, toNumber(tp.expected_leave_income_dip)),
    expectedDeliveryBuffer: Math.max(0, toNumber(tp.expected_delivery_oop_buffer)),
    notes: tp.life_event_notes || '',
  };

  const hasTaxPlanningInputs =
    hasItemizedInputs ||
    capLosses.hasActivity ||
    combinedW4Deductions > 0 ||
    primaryStateAllowances > 0 ||
    spouseStateAllowances > 0 ||
    priorYearFedTax > 0 ||
    priorYearStateTax > 0 ||
    lifeEvents.expectingChild ||
    Boolean(tp.prior_year_notes) ||
    Boolean(tp.life_event_notes);

  // Smart household paystub & IRS cap alerts
  const alerts = [];
  const earners = [
    { label: names?.primary_name || 'Primary', data: primary },
    { label: names?.spouse_name || 'Spouse', data: spouse },
  ];

  for (const { label, data } of earners) {
    if (data.early401kMaxOutCheck && data.early401kMaxOutCheck < data.periods) {
      if (!data.has401kTrueUp && data.employerMatchAnnual > 0) {
        alerts.push({
          level: 'danger',
          title: `${label}: Early 401(k) max-out risk (no employer true-up)`,
          detail: `At $${Math.round(data.trad401k + data.roth401k).toLocaleString()}/check, ${label} hits the $24,500 IRS cap on paycheck #${data.early401kMaxOutCheck} of ${data.periods} and could forfeit employer match on the remaining ${data.periods - data.early401kMaxOutCheck} checks. Target ~$${Math.floor(data.maxPerCheck401kTarget).toLocaleString()}/check.`,
        });
      } else {
        alerts.push({
          level: 'info',
          title: `${label}: Projected 401(k) hits $24,500 cap on check #${data.early401kMaxOutCheck}`,
          detail: `Run rate ($${Math.round(data.annualEmployee401kProjected).toLocaleString()}/yr) reaches the $24,500 IRS elective limit before year-end; payroll will auto-cap unless Mega Backdoor after-tax spillover is enabled.`,
        });
      }
    }

    if (data.annualEsppContribution > data.esppMaxCashContrib + 25) {
      alerts.push({
        level: 'warn',
        title: `${label}: ESPP contribution above §423 $25,000 FMV limit`,
        detail: `Projected ESPP payroll deduction ($${Math.round(data.annualEsppContribution).toLocaleString()}/yr) exceeds the ~$${Math.round(data.esppMaxCashContrib).toLocaleString()} max cash cap at a ${data.esppDiscountPct}% discount; payroll typically refunds or caps excess.`,
      });
    }
  }

  if (hsaLimit > 0 && hsaProjectedTotal > hsaLimit + 1) {
    alerts.push({
      level: 'danger',
      title: 'Household HSA projected over 2026 IRS limit',
      detail: `Combined employee + employer HSA run rate ($${Math.round(hsaProjectedTotal).toLocaleString()}/yr) exceeds your $${hsaLimit.toLocaleString()} limit. Remember employer HSA seed counts toward the IRS cap!`,
    });
  }

  const combinedHealthFsa = primary.annualHealthFsa + spouse.annualHealthFsa;
  if ((hsaLimit > 0 || hsaProjectedTotal > 0) && combinedHealthFsa > 0) {
    alerts.push({
      level: 'warn',
      title: 'HSA + Healthcare FSA active simultaneously',
      detail: `Verify your Healthcare FSA ($${Math.round(combinedHealthFsa).toLocaleString()}/yr) is a Limited-Purpose FSA (dental/vision only); a general-purpose FSA disqualifies HSA eligibility for both spouses.`,
    });
  }

  if (depCareFsaProjectedTotal > depCareFsaLimit + 1) {
    alerts.push({
      level: 'danger',
      title: 'Dependent Care FSA exceeds IRS household cap',
      detail: `Combined DCFSA ($${Math.round(depCareFsaProjectedTotal).toLocaleString()}/yr) exceeds the $${depCareFsaLimit.toLocaleString()} household cap — excess becomes taxable income.`,
    });
  }

  // OBBBA 2026 SALT Phaseout Torpedo Alerts
  if (rawSaltPaid > saltFloor + 500) {
    if (inSaltPhaseoutZone) {
      alerts.push({
        level: 'warn',
        title: `OBBBA SALT cap phased down to $${Math.round(saltEffectiveCap).toLocaleString()} (MAGI > $${saltPhaseoutThreshold.toLocaleString()})`,
        detail: `Est. MAGI ($${Math.round(estAgi).toLocaleString()}) is inside the 30% SALT phaseout zone — every extra $1 of income loses $0.30 of SALT deduction. Pre-tax 401(k)/HSA/DCFSA and $3k capital loss directly reclaim lost SALT!`,
      });
    } else if (approachingSaltPhaseout) {
      alerts.push({
        level: 'info',
        title: `Approaching $${saltPhaseoutThreshold.toLocaleString()} OBBBA SALT phaseout threshold`,
        detail: `Est. MAGI ($${Math.round(estAgi).toLocaleString()}) is within $25k of the SALT phaseout cliff. Maximizing pre-tax deductions protects your full $${saltBaseCap.toLocaleString()} SALT cap.`,
      });
    }
  }

  // W-4 Step 4(b) Deductions vs Excess Itemized Sanity Check
  if (combinedW4Deductions > 0 && hasItemizedInputs) {
    const w4Diff = combinedW4Deductions - excessOverStandard;
    if (w4Diff > 3000) {
      alerts.push({
        level: 'warn',
        title: `W-4 Step 4(b) deductions ($${Math.round(combinedW4Deductions).toLocaleString()}) exceed excess itemized ($${Math.round(excessOverStandard).toLocaleString()})`,
        detail: `IRS W-4 Step 4(b) is meant for itemized deductions ABOVE the $${standardDeduction.toLocaleString()} standard deduction. Claiming ~$${Math.round(w4Diff).toLocaleString()} extra may under-withhold federal tax — verify against your 2025 Safe Harbor.`,
      });
    }
  }

  // High State Allowances (e.g., NY IT-2104 14 allowances) & State Safe Harbor Check
  const maxStateAllowances = Math.max(primaryStateAllowances, spouseStateAllowances);
  if (stateSafeHarborMet === false && stateSafeHarborGap >= 250) {
    alerts.push({
      level: 'warn',
      title: `${stateCode || 'State'} Safe Harbor shortfall (~$${Math.round(stateSafeHarborGap).toLocaleString()})`,
      detail: `Projected ${stateCode || 'state'} withholding + est. payments ($${Math.round(projectedStatePayments).toLocaleString()}) are below ${Math.round(safeHarborMultiplier * 100)}% of 2025 state tax ($${Math.round(stateSafeHarborTarget).toLocaleString()}).${stateCode === 'NY' ? ' Note: NY Schedule A excludes NY state income tax and phases out itemized deductions at high NY AGI — double-check IT-2104 allowances.' : ''}`,
    });
  } else if (maxStateAllowances >= 6) {
    alerts.push({
      level: 'info',
      title: `High ${stateCode || 'state'} withholding allowances (${maxStateAllowances}) active`,
      detail:
        stateCode === 'NY'
          ? `Reminder on NY IT-2104 (${maxStateAllowances} allowances): NY Schedule A allows mortgage interest + property tax (not NY income tax) and phases out itemized deductions at higher NY AGI. Enter 2025 NY Total Tax to track 110% NY Safe Harbor.`
          : `With ${maxStateAllowances} state allowances claimed, enter 2025 State Total Tax in the Deductions/2025 tab to verify you remain within 110% state safe harbor.`,
    });
  }

  // 2026 Federal IRS Safe Harbor Check
  if (fedSafeHarborMet === false && fedSafeHarborGap >= 500) {
    alerts.push({
      level: 'warn',
      title: `Federal IRS Safe Harbor gap (~$${Math.round(fedSafeHarborGap).toLocaleString()})`,
      detail: `Projected federal withholding + est. payments ($${Math.round(projectedTotalFedPayments).toLocaleString()}) are below the $${Math.round(fedSafeHarborRequired).toLocaleString()} IRS safe harbor (${Math.round(safeHarborMultiplier * 100)}% of 2025 tax or 90% of est. 2026 tax).`,
    });
  }

  if (estSupplementalWithholdingGap >= 500) {
    const rateNotes = [];
    if (primary.rsuAnnual > 0) rateNotes.push(`${names?.primary_name || 'Primary'} RSU ${primary.rsuWithholdingPct}%`);
    if (primary.bonusAnnual > 0) rateNotes.push(`${names?.primary_name || 'Primary'} bonus ${primary.bonusWithholdingPct}%`);
    if (spouse.rsuAnnual > 0) rateNotes.push(`${names?.spouse_name || 'Spouse'} RSU ${spouse.rsuWithholdingPct}%`);
    if (spouse.bonusAnnual > 0) rateNotes.push(`${names?.spouse_name || 'Spouse'} bonus ${spouse.bonusWithholdingPct}%`);
    alerts.push({
      level: 'warn',
      title: `Bonus / RSU supplemental withholding gap (~$${Math.round(estSupplementalWithholdingGap).toLocaleString()})`,
      detail: `Your est. marginal federal bracket is ${fedTax.marginalRatePct}%, above supplemental withholding (${rateNotes.join(', ') || '22% default'}).${fedTax.usingItemized ? ' (Your itemized deductions are already factored into your net W/H estimate above.)' : ' Consider extra W-4 withholding or quarterly safe-harbor payments.'}`,
    });
  }

  // Capital Loss Carryforward Shield Opportunity
  if (remainingCarryforwardTo2027 >= 3000) {
    alerts.push({
      level: 'info',
      title: `$${Math.round(remainingCarryforwardTo2027).toLocaleString()} capital loss carryforward shield into 2027`,
      detail: `After deducting $${capLossOrdinaryDeduction.toLocaleString()} against 2026 ordinary income, you can offset up to $${Math.round(remainingCarryforwardTo2027).toLocaleString()} of post-vest RSU gains, covered call assignments, or portfolio rebalancing at 0% capital gains tax.`,
    });
  }

  // Upcoming Baby / 2027 Planning Alert
  if (lifeEvents.expectingChild) {
    const dueLabel = lifeEvents.dueMonth || 'upcoming';
    const is2027Due = dueLabel.startsWith('2027');
    alerts.push({
      level: 'info',
      title: `Baby planning active (Due: ${dueLabel})`,
      detail: is2027Due
        ? `Tax-year cutoff: A Jan 2027 birth starts the $2,200 Child Tax Credit ($400k MFJ phaseout), 30-day QLE Family HSA & $7,500 DCFSA window, and $1,000 federal newborn Trump Account in 2027 (or 2026 if baby arrives before Dec 31!).${stateCode === 'NY' ? ' NY 529 offers up to $10,000/yr MFJ NY deduction and can be opened early.' : ''}`
        : `Plan for hospital OOP max across plan years, 30-day QLE switch to Family HSA & $7,500 DCFSA, $2,200 Child Tax Credit, and $1,000 federal newborn Trump Account (Form 4547).`,
    });
  }

  if (combinedGrossComp > 0 && !hasAnyTaxWithholding) {
    alerts.push({
      level: 'info',
      title: 'Add paycheck tax & benefit deductions for exact Net Deposit',
      detail:
        'Open the individual Paystub tabs above to enter Federal, State, FICA, Medical/Dental, 401(k), HSA, and ESPP per paycheck — then sync Monthly Net Take-Home directly to the Expenses tab.',
    });
  }

  return {
    primary,
    spouse,
    combinedGrossComp,
    combinedTotalCompWithBenefits,
    combinedAnnualPreTax,
    combinedAnnualTaxesFromBase,
    combinedAnnualPostTax,
    combinedAnnualNetBase,
    combinedAvgMonthlyNetBase,
    combinedTypicalMonthlyNet,
    combinedWealthBuildingAnnual,
    hasAnyTaxWithholding,
    hasAnyFedWithholding,
    hsaPlanType,
    hsaYtd,
    hsaLimit,
    hsaProjectedTotal,
    hsaRemainingByYtd,
    depCareFsaLimit,
    depCareFsaProjectedTotal,
    capLosses,
    deductions,
    fedTax,
    projectedTotalFedWithheld,
    projectedTotalFedPayments,
    estFedWithholdingDiff,
    estSupplementalWithholdingGap,
    safeHarbor,
    lifeEvents,
    hasTaxPlanningInputs,
    alerts,
  };
}

// ============================================================================
// Expenses & Money-Back Reimbursement Credit Helpers
// ============================================================================

export function isCreditEntry(item) {
  return item?.entry_type === 'credit';
}

export function getSignedExpenseAmount(item) {
  const amt = Math.abs(toNumber(item?.amount));
  return isCreditEntry(item) ? -amt : amt;
}

export function summarizeExpensesList(items) {
  let grossTotal = 0;
  let creditsTotal = 0;
  let grossNeeds = 0;
  let grossWants = 0;
  let creditNeeds = 0;
  let creditWants = 0;
  let expenseCount = 0;
  let creditCount = 0;

  const byCategoryNet = {};
  const byCategoryGross = {};
  const byCategoryCredits = {};

  for (const item of items || []) {
    const amt = Math.abs(toNumber(item?.amount));
    const cat = item?.category || 'Other';
    const isNeed = Boolean(item?.is_essential);

    if (isCreditEntry(item)) {
      creditsTotal += amt;
      creditCount += 1;
      if (isNeed) creditNeeds += amt;
      else creditWants += amt;
      byCategoryCredits[cat] = (byCategoryCredits[cat] || 0) + amt;
      byCategoryNet[cat] = (byCategoryNet[cat] || 0) - amt;
    } else {
      grossTotal += amt;
      expenseCount += 1;
      if (isNeed) grossNeeds += amt;
      else grossWants += amt;
      byCategoryGross[cat] = (byCategoryGross[cat] || 0) + amt;
      byCategoryNet[cat] = (byCategoryNet[cat] || 0) + amt;
    }
  }

  const netTotal = grossTotal - creditsTotal;
  const netNeeds = Math.max(0, grossNeeds - creditNeeds);
  const netWants = Math.max(0, grossWants - creditWants);

  const allCategories = new Set([
    ...Object.keys(byCategoryNet),
    ...Object.keys(byCategoryGross),
    ...Object.keys(byCategoryCredits),
  ]);

  const categoriesSorted = Array.from(allCategories)
    .map((category) => ({
      category,
      net: byCategoryNet[category] || 0,
      gross: byCategoryGross[category] || 0,
      credits: byCategoryCredits[category] || 0,
    }))
    .sort((a, b) => b.net - a.net || b.gross - a.gross);

  return {
    grossTotal,
    creditsTotal,
    netTotal,
    grossNeeds,
    grossWants,
    creditNeeds,
    creditWants,
    netNeeds,
    netWants,
    expenseCount,
    creditCount,
    byCategoryNet,
    byCategoryGross,
    byCategoryCredits,
    categoriesSorted,
  };
}

const OPTION_TICKER_RE = /^[A-Z0-9.\-^=]{1,14}$/;

function expandEmployerShareClassTwins(tickerSet) {
  if (tickerSet.has('GOOG')) tickerSet.add('GOOGL');
  if (tickerSet.has('GOOGL')) tickerSet.add('GOOG');
}

export function getEmployerRestrictedTickers(holdings = [], accounts = [], taxProfile = null) {
  const activeAccounts = (accounts || []).filter((a) => !a.is_archived);
  const hasAccountsFilter = (accounts || []).length > 0;
  const activeIds = new Set(activeAccounts.map((a) => Number(a.id)));

  const autoSet = new Set();
  for (const h of holdings || []) {
    if (hasAccountsFilter && !activeIds.has(Number(h.account_id))) continue;
    if (h.holding_type === 'rsu' || h.holding_type === 'espp') {
      const sym = String(h.symbol || '').trim().toUpperCase();
      if (OPTION_TICKER_RE.test(sym)) autoSet.add(sym);
    }
  }

  const syncRules = taxProfile?.paystub_details?.payroll_autosync?.rules;
  if (Array.isArray(syncRules)) {
    for (const rule of syncRules) {
      if (rule && rule.type === 'espp' && rule.enabled !== false && rule.symbol) {
        const sym = String(rule.symbol).trim().toUpperCase();
        if (OPTION_TICKER_RE.test(sym)) autoSet.add(sym);
      }
    }
  }
  expandEmployerShareClassTwins(autoSet);

  const customSet = new Set();
  const rawCustom = taxProfile?.paystub_details?.tax_planning?.restricted_option_tickers || '';
  for (const token of String(rawCustom).split(/[\s,;]+/)) {
    const sym = token.trim().toUpperCase();
    if (sym && OPTION_TICKER_RE.test(sym)) customSet.add(sym);
  }
  expandEmployerShareClassTwins(customSet);

  const restrictedSet = new Set([...autoSet, ...customSet]);

  return {
    restrictedSet,
    autoDetectedList: Array.from(autoSet).sort(),
    customList: Array.from(customSet).sort(),
    allRestrictedList: Array.from(restrictedSet).sort(),
  };
}



