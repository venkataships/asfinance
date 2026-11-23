import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Baby,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Circle,
  CreditCard,
  DollarSign,
  Flame,
  Globe,
  Layers,
  Scale,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  IRS_2026_LIMITS,
  computeHouseholdPaystubSummary,
  formatCurrency,
  formatPercent,
  getEmployerRestrictedTickers,
  getRealAssetType,
  todayIsoDate,
  toNumber,
} from '../lib/finance';
import { computePendingPayrollBatch, daysBetweenIso } from '../lib/payrollSync';

const COMPLETED_STORAGE_KEY = 'asfinance_completed_insights_v1';

function loadCompletedIds() {
  try {
    const raw = window.localStorage.getItem(COMPLETED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCompletedIds(map) {
  try {
    window.localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Pure CFO insights engine — evaluates live accounts, holdings, promos, expenses,
 * paystubs, OBBBA SALT/itemized deductions, capital losses, 2025 Safe Harbor,
 * 2027 Auto-Sync schedules, and upcoming baby planning.
 */
export function buildActionableInsights({
  accounts = [],
  equityHoldings = [],
  promos = [],
  expenses = [],
  recurringBills = [],
  budgets = [],
  taxProfile = null,
  householdNames = { primary_name: 'Me', spouse_name: 'Wife' },
}) {
  const today = todayIsoDate();
  const currentYear = parseInt(today.slice(0, 4), 10);
  const yearEndIso = `${currentYear}-12-31`;
  const daysLeftInYear = Math.max(0, daysBetweenIso(today, yearEndIso));

  const activeAccounts = (accounts || []).filter((a) => !a.is_archived);
  const activeAccountMap = new Map(activeAccounts.map((a) => [Number(a.id), a]));

  // Liquid cash, uninvested brokerage cash, high-APR debts, India assets
  const liquidBankCash = activeAccounts
    .filter((a) => !a.is_liability && a.category === 'bank')
    .reduce((s, a) => s + toNumber(a.current_balance), 0);
  const brokerageCash = activeAccounts
    .filter((a) => !a.is_liability && a.category === 'investment')
    .reduce((s, a) => s + toNumber(a.cash_balance), 0);
  const totalAssets = activeAccounts
    .filter((a) => !a.is_liability)
    .reduce((s, a) => s + toNumber(a.current_balance), 0);
  const totalLiabilities = activeAccounts
    .filter((a) => a.is_liability)
    .reduce((s, a) => s + toNumber(a.current_balance), 0);
  const netWorth = totalAssets - totalLiabilities;

  const hasIndiaAssets = activeAccounts.some((a) => getRealAssetType(a) === 'india_property');

  // Essential monthly baseline from recurring bills + recent expenses
  let recurringMonthlyNet = 0;
  for (const b of recurringBills || []) {
    if (!b.is_active) continue;
    const amt = Math.abs(toNumber(b.amount));
    const monthly = b.cadence === 'annual' ? amt / 12 : b.cadence === 'quarterly' ? amt / 3 : amt;
    recurringMonthlyNet += b.entry_type === 'credit' ? -monthly : monthly;
  }
  recurringMonthlyNet = Math.max(0, recurringMonthlyNet);

  // Average recent net monthly spend (up to last 3 months)
  const monthTotals = new Map();
  for (const e of expenses || []) {
    const mk = String(e.expense_date || '').slice(0, 7);
    if (!mk) continue;
    const delta = e.entry_type === 'credit' ? -Math.abs(toNumber(e.amount)) : Math.abs(toNumber(e.amount));
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
  const baselineMonthlyBurn = Math.max(recurringMonthlyNet, avgMonthlySpend, 1);

  // Active 0% promos
  const activePromos = (promos || [])
    .filter((p) => !p.is_paid_off && toNumber(p.promo_balance) > 0 && activeAccountMap.has(Number(p.account_id)))
    .map((p) => {
      const daysLeft = daysBetweenIso(today, p.expires_on);
      const monthsLeft = Math.max(1, Math.ceil(Math.max(1, daysLeft) / 30));
      const bal = toNumber(p.promo_balance);
      const revertApr = toNumber(p.standard_apr) || 24.99;
      return {
        ...p,
        accountName: activeAccountMap.get(Number(p.account_id))?.name || 'Credit Card',
        daysLeft,
        monthsLeft,
        bal,
        monthlyNeeded: bal / monthsLeft,
        annualInterestRisk: (bal * revertApr) / 100,
        revertApr,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const totalPromoBalance = activePromos.reduce((s, p) => s + p.bal, 0);

  // Employer-restricted tickers (RSU/ESPP/custom) — insider trading guardrail
  const restrictedInfo = getEmployerRestrictedTickers(equityHoldings, accounts, taxProfile);

  // Covered-call eligible lots (100+ vested shares, strictly excluding restricted/RSU/ESPP lots)
  const ccLots = (equityHoldings || [])
    .filter((h) => {
      if (!activeAccountMap.has(Number(h.account_id))) return false;
      if (toNumber(h.shares) < 100) return false;
      if (h.holding_type === 'rsu' || h.holding_type === 'espp') return false;
      const sym = String(h.symbol || '').trim().toUpperCase();
      return !restrictedInfo.restrictedSet.has(sym);
    })
    .map((h) => {
      const acc = activeAccountMap.get(Number(h.account_id));
      const shares = toNumber(h.shares);
      const price = toNumber(h.last_price);
      return {
        symbol: String(h.symbol || '').toUpperCase(),
        accountName: acc?.name || 'Brokerage',
        shares,
        contracts: Math.floor(shares / 100),
        value: shares * price,
      };
    });

  // High-APR non-0% debt
  const highAprDebts = activeAccounts
    .filter((a) => a.is_liability && toNumber(a.current_balance) > 500 && toNumber(a.interest_rate) >= 7)
    .sort((a, b) => toNumber(b.interest_rate) - toNumber(a.interest_rate));

  // Household Paystub & Tax Engine summary
  const paySummary = computeHouseholdPaystubSummary(taxProfile || {}, householdNames);
  const autoSyncState = taxProfile?.paystub_details?.payroll_autosync || { rules: [], history: [] };
  const pendingAutoSync = computePendingPayrollBatch(autoSyncState, taxProfile, accounts, today);
  const inFlightEsppCash = (autoSyncState.rules || [])
    .filter((r) => r.type === 'espp' && r.enabled)
    .reduce((s, r) => s + toNumber(r.accrued_cash), 0);

  const actions = [];
  let quantifiableOpportunityUsd = 0;

  // ------------------------------------------------------------------
  // 1. CRITICAL: HSA + Healthcare FSA IRS Conflict Detector
  // ------------------------------------------------------------------
  const totalHealthFsaAnnual =
    paySummary.primary.annualHealthFsa + paySummary.spouse.annualHealthFsa;
  const hsaActive =
    paySummary.hsaLimit > 0 || paySummary.hsaYtd > 0 || paySummary.hsaProjectedTotal > 0;

  if (hsaActive && totalHealthFsaAnnual > 0) {
    const exposedHsa = Math.max(paySummary.hsaYtd, paySummary.hsaProjectedTotal);
    const annualPenalty = Math.round(exposedHsa * 0.06);
    quantifiableOpportunityUsd += annualPenalty;
    const fsaOwner =
      paySummary.spouse.annualHealthFsa > 0
        ? householdNames.spouse_name
        : householdNames.primary_name;
    actions.push({
      id: 'hsa-fsa-irs-conflict',
      priority: 'critical',
      category: 'tax',
      title: `Verify ${fsaOwner}'s Healthcare FSA vs. Household HSA (IRS Excess Contribution Trap)`,
      impactLabel: annualPenalty > 0 ? `Avoid ${formatCurrency(annualPenalty, { decimals: 0 })}/yr 6% IRS Penalty` : 'IRS Compliance Risk',
      impactUsd: annualPenalty,
      summary: `An active Healthcare FSA (${formatCurrency(totalHealthFsaAnnual, { decimals: 0 })}/yr) alongside ${formatCurrency(exposedHsa, { decimals: 0 })} in HSA contributions violates IRS Pub 969 UNLESS the FSA is strictly a Limited-Purpose FSA (dental/vision only).`,
      steps: [
        `Check ${fsaOwner}'s benefits portal today: confirm whether the Healthcare FSA is a Limited-Purpose FSA (LPFSA) or General-Purpose FSA.`,
        'If General-Purpose FSA: stop remaining 2026 HSA payroll deductions immediately and request a "Return of Excess HSA Contribution" from your HSA custodian before April 15, 2027 to avoid the 6% recurring excise tax.',
        'For 2027 Open Enrollment / Baby QLE: do NOT elect a General-Purpose Healthcare FSA if you plan to contribute to a Family HDHP HSA ($8,750+).',
      ],
      navAction: { label: 'Check Pay & Taxes', tab: 'income' },
      aiPrompt: `Audit our HSA (${formatCurrency(exposedHsa, { decimals: 0 })}) vs ${fsaOwner}'s Healthcare FSA (${formatCurrency(totalHealthFsaAnnual, { decimals: 0 })}/yr) conflict under IRS Publication 969. Give us the exact step-by-step fix for 2026 if it's a general-purpose FSA, and the optimal 2027 health plan + HSA/FSA/DCFSA setup for our Jan 2027 baby.`,
    });
  }

  // ------------------------------------------------------------------
  // 2. CRITICAL / HIGH: Year-End Remaining 401(k) Cap & Uncaptured Match
  // ------------------------------------------------------------------
  const marginalRate = Math.max(0.22, (paySummary.fedTax.marginalRatePct || 24) / 100);
  const stateRateEst =
    taxProfile?.state_code && ['TX', 'FL', 'WA', 'NV', 'TN', 'NH', 'SD', 'WY', 'AK'].includes(String(taxProfile.state_code).toUpperCase())
      ? 0
      : 0.06;

  for (const side of [
    { key: 'primary', label: householdNames.primary_name, data: paySummary.primary },
    { key: 'spouse', label: householdNames.spouse_name, data: paySummary.spouse },
  ]) {
    const d = side.data;
    if (d.ytd401k <= 0 && d.annualEmployee401kProjected <= 0) continue;

    // Estimate remaining paychecks in current calendar year
    const periodDays = 365 / (d.periods || 26);
    const estRemainingChecks =
      daysLeftInYear > 0 ? Math.max(1, Math.min(d.periods, Math.floor((daysLeftInYear - 3) / periodDays))) : 0;
    const currentElectivePerCheck = d.trad401k + d.roth401k;
    const projectedFinalYtd =
      d.ytd401k > 0
        ? d.ytd401k + estRemainingChecks * currentElectivePerCheck
        : d.annualEmployee401kProjected;
    const unusedCap = Math.max(0, IRS_2026_LIMITS.employee401k - projectedFinalYtd);

    if (unusedCap >= 400 && daysLeftInYear > 0 && daysLeftInYear <= 90) {
      const remainingToCapNow = Math.max(0, IRS_2026_LIMITS.employee401k - d.ytd401k);
      const neededPerCheck = estRemainingChecks > 0 ? remainingToCapNow / estRemainingChecks : remainingToCapNow;
      const taxSaved = Math.round(unusedCap * (marginalRate + stateRateEst));

      // Detect proportional employer match upside (e.g., 50% match up to full $24,500 cap like Google)
      const impliedMatchRatio =
        d.employerMatchAnnual >= 10000 && d.ytd401k > 0
          ? Math.min(0.5, d.employerMatchAnnual / IRS_2026_LIMITS.employee401k)
          : 0;
      const potentialLostMatch = Math.round(unusedCap * impliedMatchRatio);
      const totalValue = taxSaved + potentialLostMatch;
      quantifiableOpportunityUsd += totalValue;

      const isCritical = potentialLostMatch >= 250 || unusedCap >= 1500;
      actions.push({
        id: `401k-yearend-gap-${side.key}`,
        priority: isCritical ? 'critical' : 'high',
        category: 'urgent',
        title: `${side.label}: On Track to Leave ${formatCurrency(unusedCap, { decimals: 0 })} of ${currentYear} 401(k) Unused`,
        impactLabel:
          potentialLostMatch > 0
            ? `+${formatCurrency(totalValue, { decimals: 0 })} (${formatCurrency(potentialLostMatch, { decimals: 0 })} Match + ${formatCurrency(taxSaved, { decimals: 0 })} Tax)`
            : `Save ~${formatCurrency(taxSaved, { decimals: 0 })} in ${currentYear} Tax`,
        impactUsd: totalValue,
        summary: `At ${formatCurrency(d.ytd401k, { decimals: 0 })} YTD with ~${estRemainingChecks} paycheck${estRemainingChecks === 1 ? '' : 's'} left at ${formatCurrency(currentElectivePerCheck)}/check, ${side.label} will finish at ${formatCurrency(projectedFinalYtd, { decimals: 0 })} vs. the ${formatCurrency(IRS_2026_LIMITS.employee401k, { decimals: 0 })} IRS cap.`,
        steps: [
          `Raise ${side.label}'s Pre-Tax 401(k) election to ~${formatCurrency(neededPerCheck, { decimals: 0 })}/check for the remaining ${estRemainingChecks} paycheck${estRemainingChecks === 1 ? '' : 's'} of December (payroll auto-stops at $24,500).`,
          d.afterTax401k > 0
            ? `Tip: Temporarily pause After-Tax 401(k) (${formatCurrency(d.afterTax401k)}/check) for those ${estRemainingChecks} checks so net take-home cash stays nearly unchanged while capturing the pre-tax deduction.`
            : 'Verify payroll cutoff date (usually 7–10 days before pay date) so the change lands on the next check.',
        ],
        navAction: { label: `Open ${side.label} Paystub`, tab: 'income' },
        aiPrompt: `${side.label} is at ${formatCurrency(d.ytd401k, { decimals: 0 })} YTD 401(k) with ~${estRemainingChecks} paychecks left in ${currentYear}. Calculate the exact election percentage to max $24,500, exact tax + employer match savings, and how to balance After-Tax MBDR cash flow.`,
      });
    }

    // Early max-out without true-up warning
    if (d.early401kMaxOutCheck && d.early401kMaxOutCheck < d.periods && !d.has401kTrueUp && d.employerMatchAnnual > 0) {
      actions.push({
        id: `401k-trueup-risk-${side.key}`,
        priority: 'high',
        category: 'tax',
        title: `${side.label}: Early 401(k) Max-Out Risk Without Employer True-Up`,
        impactLabel: `Protect Employer Match`,
        impactUsd: 0,
        summary: `Current run rate hits $24,500 on paycheck #${d.early401kMaxOutCheck} of ${d.periods}, and True-Up is marked OFF — missing later paychecks could forfeit employer match.`,
        steps: [
          `Spread contributions evenly at ~${formatCurrency(IRS_2026_LIMITS.employee401k / d.periods)}/check across all ${d.periods} checks, or confirm with HR whether a year-end true-up exists.`,
        ],
        navAction: { label: 'Review Paystub', tab: 'income' },
        aiPrompt: `Audit ${side.label}'s 401(k) contribution pacing and true-up match rules so we never forfeit employer matching dollars.`,
      });
    }

    // Mega Backdoor Roth unused room
    if (d.hasMegaBackdoor && d.remaining415cRoom >= 5000) {
      actions.push({
        id: `mbdr-room-${side.key}`,
        priority: 'opportunity',
        category: 'tax',
        title: `${side.label}: ${formatCurrency(d.remaining415cRoom, { decimals: 0 })} Mega Backdoor Roth Space Available`,
        impactLabel: `Tax-Free Roth Growth`,
        impactUsd: 0,
        summary: `Projected total 415(c) contributions (${formatCurrency(d.total401k415cProjected, { decimals: 0 })}) leave ${formatCurrency(d.remaining415cRoom, { decimals: 0 })} below the $72,000 IRS limit.`,
        steps: [
          'Only increase After-Tax 401(k) (with automatic in-plan Roth conversion) AFTER maxing Pre-Tax $24,500, covering 0% promos, and funding your Jan 2027 baby cash buffer.',
        ],
        navAction: { label: 'Open Pay & Taxes', tab: 'income' },
        aiPrompt: `Evaluate whether ${side.label} should put extra surplus into Mega Backdoor Roth (${formatCurrency(d.remaining415cRoom, { decimals: 0 })} remaining room) vs keeping cash liquid for our Jan 2027 baby and 0% promos.`,
      });
    }
  }

  // ------------------------------------------------------------------
  // 3. URGENT / HIGH: Active 0% Balance Transfer Promo Cliffs
  // ------------------------------------------------------------------
  for (const promo of activePromos.slice(0, 4)) {
    if (promo.daysLeft <= 180) {
      const isUrgent = promo.daysLeft <= 60;
      const avoidedInterest = Math.round(promo.annualInterestRisk * 0.5);
      quantifiableOpportunityUsd += avoidedInterest;
      actions.push({
        id: `promo-cliff-${promo.id}`,
        priority: isUrgent ? 'critical' : 'high',
        category: 'debt',
        title: `0% Promo Expiring in ${Math.max(0, promo.daysLeft)}d: ${promo.accountName} (${promo.label})`,
        impactLabel: `Avoid ${promo.revertApr.toFixed(1)}% APR (~${formatCurrency(avoidedInterest, { decimals: 0 })})`,
        impactUsd: avoidedInterest,
        summary: `Balance of ${formatCurrency(promo.bal, { decimals: 0 })} expires ${promo.expires_on}. Set aside ${formatCurrency(promo.monthlyNeeded, { decimals: 0 })}/mo to clear in full before revert APR hits.`,
        steps: [
          `Schedule automatic payoff of ${formatCurrency(promo.monthlyNeeded, { decimals: 0 })}/mo (or lump-sum from liquid cash: ${formatCurrency(liquidBankCash, { decimals: 0 })} available) at least 5 business days before ${promo.expires_on}.`,
        ],
        navAction: { label: 'Open Accounts & Promos', tab: 'accounts', categoryFilter: 'credit_card' },
        aiPrompt: `Build an exact payoff schedule for our 0% promo on ${promo.accountName} (${formatCurrency(promo.bal, { decimals: 0 })} expiring ${promo.expires_on}) alongside our other debts and Jan 2027 baby cash needs.`,
      });
    }
  }

  // ------------------------------------------------------------------
  // 4. TAX STRATEGY: OBBBA SALT, W-4 4(b), NY IT-2104 & Safe Harbor
  // ------------------------------------------------------------------
  if (paySummary.safeHarbor.fedSafeHarborMet === false || paySummary.safeHarbor.stateSafeHarborMet === false) {
    const gap = Math.max(paySummary.safeHarbor.fedSafeHarborGap, paySummary.safeHarbor.stateSafeHarborGap);
    actions.push({
      id: 'safe-harbor-gap',
      priority: 'high',
      category: 'urgent',
      title: `2026 Tax Safe Harbor Gap Detected (${formatCurrency(gap, { decimals: 0 })})`,
      impactLabel: 'Avoid IRS/State Penalty',
      impactUsd: Math.round(gap * 0.05),
      summary: `Projected withholding + estimated payments trail your 2025 Safe Harbor target. Remember: W-2 withholding is treated as paid evenly all year (even if added in December!), whereas 1040-ES payments only count from the payment date.`,
      steps: [
        'Verify your full-year YTD Federal & NY taxes withheld from your latest paystubs (bonuses & RSUs often add significant withholding above base run rate).',
        'If a real gap remains, add 1-time extra withholding on W-4 Step 4(c) for December paychecks or make a Q4 estimated tax payment by Jan 15, 2027.',
      ],
      navAction: { label: 'Check Safe Harbor', tab: 'income' },
      aiPrompt: 'Audit our exact 2026 Federal and NY Safe Harbor status including our W-4 Step 4(b) deductions, NY IT-2104 allowances, and YTD bonus/RSU withholding. Do we need any extra December withholding or Q4 payment?',
    });
  } else if (paySummary.deductions.hasItemizedInputs) {
    const magiHeadroomToSaltPhaseout =
      paySummary.deductions.saltPhaseoutThreshold - paySummary.fedTax.agiEstimate;
    actions.push({
      id: 'obbba-salt-status',
      priority: paySummary.deductions.inSaltPhaseoutZone ? 'high' : 'on_track',
      category: 'tax',
      title: paySummary.deductions.inSaltPhaseoutZone
        ? `OBBBA SALT Cap Phasing Down (${formatCurrency(paySummary.deductions.saltEffectiveCap, { decimals: 0 })} Effective Cap)`
        : `OBBBA 2026 SALT & Itemized Strategy: ${formatCurrency(paySummary.deductions.totalItemized, { decimals: 0 })} Total`,
      impactLabel: paySummary.fedTax.usingItemized
        ? `+${formatCurrency(paySummary.deductions.excessOverStandard, { decimals: 0 })} Above Standard`
        : 'Using Standard Ded.',
      impactUsd: 0,
      summary: paySummary.deductions.inSaltPhaseoutZone
        ? `Est. MAGI (${formatCurrency(paySummary.fedTax.agiEstimate, { decimals: 0 })}) exceeds $${paySummary.deductions.saltPhaseoutThreshold.toLocaleString()} — every $1 of extra Pre-Tax 401(k)/HSA saves both marginal tax AND restores 30¢ of SALT deduction!`
        : `Est. AGI (${formatCurrency(paySummary.fedTax.agiEstimate, { decimals: 0 })}) sits ${formatCurrency(Math.max(0, magiHeadroomToSaltPhaseout), { decimals: 0 })} below the $505,000 OBBBA SALT phaseout threshold, unlocking the full ${formatCurrency(paySummary.deductions.saltEffectiveCap, { decimals: 0 })} SALT cap.`,
      steps: [
        `Itemized deduction (${formatCurrency(paySummary.deductions.totalItemized, { decimals: 0 })}) beats Standard (${formatCurrency(paySummary.deductions.standardDeduction, { decimals: 0 })}) by ${formatCurrency(paySummary.deductions.excessOverStandard, { decimals: 0 })} — compare directly against W-4 Step 4(b) (${formatCurrency(paySummary.safeHarbor.combinedW4Deductions, { decimals: 0 })}).`,
        String(taxProfile?.state_code || '').toUpperCase() === 'NY' && paySummary.safeHarbor.maxStateAllowances >= 8
          ? `NY IT-2104 Check (${paySummary.safeHarbor.maxStateAllowances} allowances): NY Schedule A allows mortgage interest + property tax (not NY income tax) and phases out itemized deductions at higher NY AGI — confirm YTD NY tax withheld covers your NY liability.`
          : 'Confirm State & Local Income Tax Override reflects full-year YTD state withholding (including bonuses/RSUs).',
      ],
      navAction: { label: 'Review Deductions & W-4', tab: 'income' },
      aiPrompt: 'Audit our 2026 OBBBA SALT cap, mortgage interest + property tax itemized deductions, W-4 Step 4(b) setting, and NY IT-2104 allowances. Show our estimated 2026 Federal and NY tax liability vs actual YTD withholding.',
    });
  }

  // ------------------------------------------------------------------
  // 5. INVESTMENTS: Capital Loss Carryforward Deployment Strategy
  // ------------------------------------------------------------------
  if (paySummary.capLosses.remainingCarryforwardTo2027 >= 3000) {
    const cf = paySummary.capLosses.remainingCarryforwardTo2027;
    const estShieldValue = Math.round(cf * 0.238); // ~15%-20% Fed LTCG + 3.8% NIIT / NY state
    const yearsAt3k = Math.ceil(cf / 3000);
    quantifiableOpportunityUsd += Math.round(Math.min(cf, 25000) * 0.238);
    actions.push({
      id: 'cap-loss-deploy',
      priority: 'opportunity',
      category: 'investments',
      title: `Deploy ${formatCurrency(cf, { decimals: 0 })} Capital Loss Carryforward Tax-Free`,
      impactLabel: `Up to ~${formatCurrency(estShieldValue, { decimals: 0 })} Tax Shield`,
      impactUsd: estShieldValue,
      summary: `At $3,000/yr against ordinary income alone, this carryforward takes ~${yearsAt3k} years to use. Instead, it offsets short-term or long-term capital gains dollar-for-dollar with $0 tax.`,
      steps: [
        'Diversify appreciated vested RSUs/ESPP lots or rebalance concentrated positions tax-free up to your carryforward balance.',
        ccLots.length > 0
          ? `Covered Call synergy: You have ${ccLots.length} non-restricted lot${ccLots.length === 1 ? '' : 's'} eligible for Covered Calls (${ccLots.map((l) => l.symbol).join(', ')}${restrictedInfo.allRestrictedList.length > 0 ? `, excluding employer-restricted ${restrictedInfo.allRestrictedList.join(', ')}` : ''}) — any short-term option premiums or assignment gains are shielded 100% tax-free by your carryforward.`
          : restrictedInfo.allRestrictedList.length > 0
          ? `Employer-stock guardrail active: ${restrictedInfo.allRestrictedList.join(', ')} are excluded from options trades — diversify qualifying lots outright during open windows to absorb gains tax-free.`
          : 'Avoid unnecessary tax-loss harvesting that only piles onto an already large carryforward — consider harvesting gains to step up cost basis (no wash-sale rule on gains!).',
      ],
      navAction: { label: 'View Holdings', tab: 'accounts', categoryFilter: 'investment' },
      aiPrompt: `We have ${formatCurrency(cf, { decimals: 0 })} in capital loss carryforward remaining. Look at our actual stock/RSU/ESPP holdings and build a concrete tax-free gain harvesting, diversification, and covered-call plan to put this loss shield to work.`,
    });
  }

  // ------------------------------------------------------------------
  // 6. BABY & 2027 LIFE EVENT PLAYBOOK
  // ------------------------------------------------------------------
  if (paySummary.lifeEvents.expectingChild) {
    const targetBabyCash =
      paySummary.lifeEvents.deliveryOopBuffer +
      paySummary.lifeEvents.leaveIncomeDip +
      baselineMonthlyBurn * 3;
    const cashSurplusAfterBabyAndPromos = liquidBankCash - totalPromoBalance - targetBabyCash;
    const ctcHeadroom = IRS_2026_LIMITS.ctcPhaseoutMfj - paySummary.fedTax.agiEstimate;

    actions.push({
      id: 'baby-2027-playbook',
      priority: cashSurplusAfterBabyAndPromos < 0 ? 'high' : 'opportunity',
      category: 'life',
      title: `Baby Playbook (${paySummary.lifeEvents.dueMonth || 'Jan 2027'}): Cash Buffer, 30-Day QLE & Tax Moves`,
      impactLabel:
        ctcHeadroom > 0
          ? `$2,200 CTC + $1k Seed + $7.5k DCFSA`
          : `QLE + $1k Seed + $7.5k DCFSA`,
      impactUsd: 3200,
      summary: `Liquid bank cash (${formatCurrency(liquidBankCash, { decimals: 0 })}) vs. 3mo emergency + delivery OOP + leave dip + 0% promos (${formatCurrency(targetBabyCash + totalPromoBalance, { decimals: 0 })}) leaves ${cashSurplusAfterBabyAndPromos >= 0 ? `+${formatCurrency(cashSurplusAfterBabyAndPromos, { decimals: 0 })} cushion` : `${formatCurrency(Math.abs(cashSurplusAfterBabyAndPromos), { decimals: 0 })} to build up`}.`,
      steps: [
        'Jan 1 Paycheck Dip: Social Security (6.2%) + NY PFL ($411.91 each) reset Jan 1, reducing combined net take-home by ~$850–$1,000/mo right as delivery arrives — keep extra cash liquid in HYSA.',
        '30-Day QLE Window after birth: Add baby to optimal health plan, elect Dependent Care FSA ($7,500 MFJ tax-free), and resolve the Healthcare FSA vs. Family HSA ($8,750) choice cleanly.',
        'Claim the $1,000 OBBBA Section 530A newborn "Trump Account" federal seed (IRS Form 4547) and open/fund a NY 529 (up to $10,000/yr MFJ NY state tax deduction — saves ~$600/yr in NY tax!).',
        `Tax-Year Timing: Your est. AGI (${formatCurrency(paySummary.fedTax.agiEstimate, { decimals: 0 })}) is ${ctcHeadroom >= 0 ? `${formatCurrency(ctcHeadroom, { decimals: 0 })} below` : 'above'} the $400,000 MFJ Child Tax Credit ($2,200) phaseout. (Born Dec 31 = 2026 credit; Jan 1+ = starts 2027.)`,
      ],
      navAction: { label: 'Open Life Events', tab: 'income' },
      aiPrompt: `Build a month-by-month cash flow, benefits QLE, and tax checklist from now through June 2027 for our baby due ${paySummary.lifeEvents.dueMonth || 'Jan 2027'} — covering two-plan-year medical OOP max, Jan 1 Social Security/NY PFL reset, NY PFL + accrued PTO/sick leave, Family HSA vs FSA, $7,500 DCFSA, NY 529 $10k deduction, and $1,000 Form 4547 newborn seed.`,
    });
  }

  // ------------------------------------------------------------------
  // 7. ESPP IN-FLIGHT CASH & DISCOUNT GAIN
  // ------------------------------------------------------------------
  const totalAnnualEsppGain =
    paySummary.primary.annualEsppImpliedGain + paySummary.spouse.annualEsppImpliedGain;
  if (totalAnnualEsppGain > 0 || inFlightEsppCash > 0) {
    actions.push({
      id: 'espp-optimization',
      priority: 'opportunity',
      category: 'investments',
      title: `ESPP Engine: ~${formatCurrency(totalAnnualEsppGain, { decimals: 0 })}/yr Discount Gain${inFlightEsppCash > 0 ? ` • ${formatCurrency(inFlightEsppCash, { decimals: 0 })} Accrued` : ''}`,
      impactLabel: `+${formatCurrency(totalAnnualEsppGain, { decimals: 0 })}/yr Return`,
      impactUsd: Math.round(totalAnnualEsppGain),
      summary:
        'ESPP with 15% discount (+ lookback) delivers an immediate 17.6%+ risk-free return on purchase date. Remember to adjust 1099-B cost basis upward at tax time for any ESPP ordinary income already reported on W-2 so you never get double-taxed.',
      steps: [
        'Configure/verify your 2027 ESPP Auto-Sync rule so payroll accruals and semi-annual purchases update net worth automatically.',
        'Decide on purchase day whether to sell immediately (lock in guaranteed 15%+ cash for baby/debt) or hold for qualifying disposition.',
      ],
      navAction: { label: 'Open Auto-Sync (ESPP)', tab: 'autosync' },
      aiPrompt: 'Review our ESPP setup, in-flight accrued cash, W-2 qualifying disposition cost-basis tax trap, and whether we should sell immediately on Dec 31 purchase date or hold.',
    });
  }

  // ------------------------------------------------------------------
  // 8. IDLE BROKERAGE CASH / HIGH-APR DEBT / COVERED CALLS
  // ------------------------------------------------------------------
  if (highAprDebts.length > 0) {
    const topDebt = highAprDebts[0];
    const annualInterest = Math.round((toNumber(topDebt.current_balance) * toNumber(topDebt.interest_rate)) / 100);
    quantifiableOpportunityUsd += annualInterest;
    actions.push({
      id: `high-apr-${topDebt.id}`,
      priority: 'high',
      category: 'debt',
      title: `High-APR Debt Alert: ${topDebt.name} at ${toNumber(topDebt.interest_rate).toFixed(2)}% APR`,
      impactLabel: `Save ~${formatCurrency(annualInterest, { decimals: 0 })}/yr`,
      impactUsd: annualInterest,
      summary: `Carrying ${formatCurrency(topDebt.current_balance, { decimals: 0 })} at ${toNumber(topDebt.interest_rate).toFixed(2)}% APR costs ~${formatCurrency(annualInterest, { decimals: 0 })}/yr in after-tax interest (beating any risk-free yield).`,
      steps: [
        'Prioritize paying this down ahead of taxable investing once your emergency buffer and expiring 0% promos are secured.',
      ],
      navAction: { label: 'View Debt', tab: 'accounts', categoryFilter: topDebt.category },
      aiPrompt: `Compare paying off ${topDebt.name} (${formatCurrency(topDebt.current_balance, { decimals: 0 })} at ${toNumber(topDebt.interest_rate).toFixed(2)}%) vs keeping cash for 0% promos and Jan 2027 baby expenses.`,
    });
  }

  if (brokerageCash >= 2500) {
    const annualYield = Math.round(brokerageCash * 0.042);
    actions.push({
      id: 'idle-brokerage-cash',
      priority: 'opportunity',
      category: 'investments',
      title: `${formatCurrency(brokerageCash, { decimals: 0 })} Uninvested Brokerage Cash`,
      impactLabel: `~${formatCurrency(annualYield, { decimals: 0 })}/yr @ 4.2% T-Bills`,
      impactUsd: annualYield,
      summary: 'Confirm idle brokerage cash is swept into a Treasury money market fund (e.g., SGOV / USFR / SPAXX — NY state-tax exempt on Treasury interest!) or deployed toward your highest-priority goal.',
      steps: [
        'In NY, Treasury-only funds (SGOV/USFR/FDLXX) avoid NY state income tax (~6%+), boosting after-tax yield vs standard bank HYSA.',
      ],
      navAction: { label: 'Open Capital Desk', tab: 'strategies' },
      aiPrompt: `We have ${formatCurrency(brokerageCash, { decimals: 0 })} in uninvested brokerage cash. Should we park it in NY state-tax-exempt T-Bills (SGOV/USFR), run conservative CSPs, or allocate to index funds/0% promo payoff?`,
    });
  }

  if (ccLots.length > 0) {
    const totalContracts = ccLots.reduce((s, l) => s + l.contracts, 0);
    actions.push({
      id: 'covered-call-lots',
      priority: 'opportunity',
      category: 'investments',
      title: `${totalContracts} Covered Call Contract${totalContracts === 1 ? '' : 's'} Eligible Across ${ccLots.length} Position${ccLots.length === 1 ? '' : 's'}`,
      impactLabel: `${ccLots.map((l) => `${l.symbol} ${l.contracts}x`).slice(0, 3).join(', ')}`,
      impactUsd: 0,
      summary: `Vested 100-share lots can generate conservative 20–25 delta OTM income (30–45 DTE, avoiding earnings weeks).${paySummary.capLosses.remainingCarryforwardTo2027 > 0 ? ' Bonus: your capital loss carryforward shields short-term premiums & assignment gains tax-free!' : ''}`,
      steps: [
        'Only sell calls at strike prices where you are genuinely happy diversifying the shares.',
        ...(restrictedInfo.allRestrictedList.length > 0
          ? [
              `Compliance guardrail: employer tickers (${restrictedInfo.allRestrictedList.join(', ')}) are automatically excluded from Covered Call / CSP suggestions.`,
            ]
          : []),
      ],
      navAction: { label: 'Open Capital Desk', tab: 'strategies' },
      aiPrompt: `Design a conservative Covered Call plan for our eligible 100-share lots (${ccLots.map((l) => `${l.symbol}: ${l.shares} shares`).join(', ')}) factoring in earnings risk and our capital loss carryforward.`,
    });
  }

  // ------------------------------------------------------------------
  // 9. PAYROLL AUTO-SYNC READY REMINDER
  // ------------------------------------------------------------------
  if (pendingAutoSync.hasDueActions) {
    actions.push({
      id: 'payroll-autosync-due',
      priority: 'high',
      category: 'urgent',
      title: `Payroll Auto-Sync Pending: ${pendingAutoSync.totalDuePaydays} Pay Period${pendingAutoSync.totalDuePaydays === 1 ? '' : 's'} (+${formatCurrency(pendingAutoSync.totalDueDollars, { decimals: 0 })})`,
      impactLabel: '1-Click Balance Sync',
      impactUsd: 0,
      summary: 'Your configured 401(k) / ESPP auto-sync schedules have pending paycheck deposits ready to post.',
      steps: ['Review amounts (or skip any parental-leave check) and post in 1 click.'],
      navAction: { label: 'Review Auto-Sync', tab: 'autosync' },
      aiPrompt: 'Review our 2027 401(k) auto-investment allocations and ESPP schedule to ensure optimal tax and asset allocation.',
    });
  } else if ((autoSyncState.rules || []).length === 0 && paySummary.combinedGrossComp > 0) {
    actions.push({
      id: 'setup-2027-autosync',
      priority: 'opportunity',
      category: 'life',
      title: 'Automate Your 2027 401(k) & ESPP Tracking Before Newborn Life Starts',
      impactLabel: 'Zero Monthly Drudgery',
      impactUsd: 0,
      summary: 'Set up your 2027 start dates, 401(k) fund tickers, and ESPP accrual schedule once so balances stay fresh automatically every payday.',
      steps: ['Open Pay & Taxes → Auto-Sync (401k / ESPP) and use "Pull from Paystub" to configure in 60 seconds.'],
      navAction: { label: 'Configure 2027 Auto-Sync', tab: 'autosync' },
      aiPrompt: 'Help us pick the cleanest 2027 401(k) contribution pacing and ticker allocation for both of us.',
    });
  }

  // ------------------------------------------------------------------
  // 10. CROSS-BORDER INDIA ASSETS COMPLIANCE
  // ------------------------------------------------------------------
  if (hasIndiaAssets) {
    actions.push({
      id: 'india-fbar-reminder',
      priority: 'on_track',
      category: 'tax',
      title: 'US / India Cross-Border Reporting Check (FBAR & Form 8938)',
      impactLabel: 'Annual Compliance',
      impactUsd: 0,
      summary: 'Real estate held directly in your personal name in India is generally exempt from FBAR, but any Indian NRE/NRO bank accounts, FDs, mutual funds (PFIC rules!), or demat accounts aggregating over $10,000 require FinCEN 114 (FBAR).',
      steps: ['Confirm aggregate max balance of all Indian financial accounts before April 15 (auto-extended to Oct 15 for FBAR).'],
      navAction: { label: 'View Assets', tab: 'accounts', categoryFilter: 'real_asset' },
      aiPrompt: 'Review our US/India cross-border assets and summarize exact FBAR (FinCEN 114), Form 8938, and PFIC rules we should double-check with our CPA.',
    });
  }

  // Sort by severity priority
  const priorityRank = { critical: 0, high: 1, opportunity: 2, on_track: 3 };
  actions.sort((a, b) => {
    const r = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
    if (r !== 0) return r;
    return (b.impactUsd || 0) - (a.impactUsd || 0);
  });

  const urgentCount = actions.filter((a) => a.priority === 'critical' || a.priority === 'high').length;
  const criticalCount = actions.filter((a) => a.priority === 'critical').length;

  return {
    today,
    currentYear,
    daysLeftInYear,
    netWorth,
    liquidBankCash,
    brokerageCash,
    totalPromoBalance,
    baselineMonthlyBurn,
    runwayMonths: baselineMonthlyBurn > 0 ? liquidBankCash / baselineMonthlyBurn : 0,
    paySummary,
    actions,
    urgentCount,
    criticalCount,
    quantifiableOpportunityUsd,
    inFlightEsppCash,
  };
}

export default function ActionableInsightsDashboard({
  accounts,
  equityHoldings,
  promos,
  expenses,
  recurringBills,
  budgets,
  taxProfile,
  householdNames,
  privacyMode,
  onNavigateTab,
  onOpenAutoSync,
  onAskAdvisor,
}) {
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [completedMap, setCompletedMap] = useState(() => loadCompletedIds());

  useEffect(() => {
    saveCompletedIds(completedMap);
  }, [completedMap]);

  const mask = (str) => (privacyMode ? '••••••' : str);

  const report = useMemo(
    () =>
      buildActionableInsights({
        accounts,
        equityHoldings,
        promos,
        expenses,
        recurringBills,
        budgets,
        taxProfile,
        householdNames,
      }),
    [accounts, equityHoldings, promos, expenses, recurringBills, budgets, taxProfile, householdNames]
  );

  const toggleDone = (id) => {
    setCompletedMap((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = new Date().toISOString();
      return next;
    });
  };

  const filteredActions = useMemo(() => {
    return report.actions.filter((a) => {
      if (hideCompleted && completedMap[a.id]) return false;
      if (categoryFilter === 'all') return true;
      if (categoryFilter === 'urgent') return a.priority === 'critical' || a.priority === 'high';
      return a.category === categoryFilter;
    });
  }, [report.actions, categoryFilter, hideCompleted, completedMap]);

  const completedCount = report.actions.filter((a) => completedMap[a.id]).length;
  const { paySummary } = report;

  const filterTabs = [
    { key: 'all', label: `All (${report.actions.length})` },
    { key: 'urgent', label: `Urgent (${report.urgentCount})` },
    { key: 'tax', label: 'Tax & Benefits' },
    { key: 'debt', label: 'Debt & Cash' },
    { key: 'investments', label: 'Investments & ESPP' },
    { key: 'life', label: '2027 Baby & Life' },
  ];

  const handleActionNav = (nav) => {
    if (!nav) return;
    if (nav.tab === 'autosync') {
      if (onOpenAutoSync) onOpenAutoSync();
      else onNavigateTab('income');
      return;
    }
    onNavigateTab(nav.tab, nav.categoryFilter);
  };

  return (
    <div className="space-y-5">
      {/* Top Executive Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/10 text-amber-300">
              <Target className="h-4 w-4" />
            </div>
            <h1 className="text-base font-semibold text-zinc-100">
              Actionable Insights — Household CFO Command Center
            </h1>
            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 font-mono text-[10px] text-zinc-300">
              {report.daysLeftInYear} days left in {report.currentYear}
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            Live, prioritized money & tax actions synthesized automatically from both paystubs, OBBBA SALT/W-4 rules, 0% promos, capital losses, and your 2027 baby timeline.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigateTab('income')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-emerald-500/40"
          >
            <Briefcase className="h-3.5 w-3.5 text-emerald-400" />
            Edit Pay & Taxes
          </button>
          <button
            type="button"
            onClick={() =>
              onAskAdvisor(
                'Give us a crisp, prioritized top-5 action plan for the final weeks of 2026 and Q1 2027 based on our live paystubs, HSA/FSA status, remaining 401(k) headroom, OBBBA SALT/W-4 withholding, capital loss carryforward, 0% promos, and Jan 2027 baby cash needs.'
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Run Full CFO Audit
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 4 CFO KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>Quantified Opportunities</span>
            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-emerald-300 tabular-nums">
            {mask(formatCurrency(report.quantifiableOpportunityUsd, { decimals: 0 }))}
          </div>
          <div className="mt-1 text-[10px] text-zinc-400">
            Tax savings, match upside, ESPP gain & avoided penalties/APR
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>Priority Actions</span>
            <Flame className="h-3.5 w-3.5 text-amber-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono text-xl font-bold text-amber-300 tabular-nums">
            <span>{report.urgentCount} Urgent</span>
            <span className="text-xs font-normal text-zinc-400">
              ({completedCount}/{report.actions.length} done)
            </span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-400">
            {report.criticalCount > 0
              ? `${report.criticalCount} critical item${report.criticalCount === 1 ? '' : 's'} to verify before Dec 31`
              : 'No critical compliance issues detected'}
          </div>
        </div>

        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>2026 Tax & SALT Radar</span>
            <Scale className="h-3.5 w-3.5 text-violet-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono text-xl font-bold text-violet-200 tabular-nums">
            <span>
              {paySummary.combinedGrossComp > 0
                ? `${paySummary.fedTax.marginalRatePct}% Fed`
                : 'Add Paystubs'}
            </span>
            {paySummary.combinedGrossComp > 0 && (
              <span className="text-xs font-normal text-zinc-400">
                ({formatPercent(paySummary.fedTax.effectiveRatePct)} eff)
              </span>
            )}
          </div>
          <div className="mt-1 text-[10px] text-zinc-400 tabular-nums">
            {paySummary.combinedGrossComp > 0
              ? `Est. AGI ${mask(formatCurrency(paySummary.fedTax.agiEstimate, { decimals: 0 }))} • ${
                  paySummary.fedTax.usingItemized
                    ? `Itemized ${mask(formatCurrency(paySummary.fedTax.appliedDeduction, { decimals: 0 }))}`
                    : 'Standard Ded.'
                }`
              : 'Enter both paystubs for live tax radar'}
          </div>
        </div>

        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>Liquid Cash & Runway</span>
            <Wallet className="h-3.5 w-3.5 text-sky-400" />
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-sky-300 tabular-nums">
            {mask(formatCurrency(report.liquidBankCash, { decimals: 0 }))}
          </div>
          <div className="mt-1 text-[10px] text-zinc-400 tabular-nums">
            ~{report.runwayMonths.toFixed(1)} mo burn • 0% Promos:{' '}
            {mask(formatCurrency(report.totalPromoBalance, { decimals: 0 }))}
          </div>
        </div>
      </div>

      {/* Filter Bar & Checklist Progress */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/70 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {filterTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setCategoryFilter(t.key)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                categoryFilter === t.key
                  ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500"
          />
          Hide checked-off items ({completedCount})
        </label>
      </div>

      {/* Prioritized Action Cards */}
      {filteredActions.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-8 text-center text-xs text-zinc-400">
          All items in this filter are checked off or clear. Nice work!
        </div>
      ) : (
        <div className="space-y-3">
          {filteredActions.map((act) => {
            const isDone = Boolean(completedMap[act.id]);
            const borderCls = isDone
              ? 'border-zinc-800/80 bg-zinc-950/50 opacity-65'
              : act.priority === 'critical'
              ? 'border-rose-500/40 bg-rose-500/5'
              : act.priority === 'high'
              ? 'border-amber-500/35 bg-amber-500/5'
              : act.priority === 'opportunity'
              ? 'border-emerald-500/30 bg-zinc-950/85'
              : 'border-sky-500/25 bg-zinc-950/75';

            const badgeCls =
              act.priority === 'critical'
                ? 'bg-rose-500/20 text-rose-200 border-rose-500/40'
                : act.priority === 'high'
                ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                : act.priority === 'opportunity'
                ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/35'
                : 'bg-sky-500/15 text-sky-200 border-sky-500/35';

            const PriorityIcon =
              act.priority === 'critical'
                ? ShieldAlert
                : act.priority === 'high'
                ? AlertTriangle
                : act.category === 'life'
                ? Baby
                : act.category === 'debt'
                ? CreditCard
                : act.category === 'investments'
                ? TrendingUp
                : Sparkles;

            return (
              <div key={act.id} className={`rounded-xl border p-4 transition ${borderCls}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => toggleDone(act.id)}
                      title={isDone ? 'Mark as open' : 'Check off as completed'}
                      className="mt-0.5 shrink-0 text-zinc-400 hover:text-emerald-400"
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400" />
                      ) : (
                        <Circle className="h-4.5 w-4.5" />
                      )}
                    </button>

                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${badgeCls}`}
                        >
                          <PriorityIcon className="h-2.5 w-2.5" />
                          {act.priority.replace('_', ' ')}
                        </span>
                        <h3
                          className={`text-xs sm:text-sm font-semibold ${
                            isDone ? 'line-through text-zinc-500' : 'text-zinc-100'
                          }`}
                        >
                          {act.title}
                        </h3>
                        {act.impactLabel && (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                            {privacyMode ? '••••' : act.impactLabel}
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] sm:text-xs leading-relaxed text-zinc-300">
                        {privacyMode ? act.summary.replace(/\$[\d,]+(\.\d+)?/g, '••••') : act.summary}
                      </p>

                      {act.steps?.length > 0 && (
                        <ul className="mt-1.5 space-y-1 text-[11px] text-zinc-400">
                          {act.steps.map((st, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-500" />
                              <span>
                                {privacyMode ? st.replace(/\$[\d,]+(\.\d+)?/g, '••••') : st}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pl-7 sm:pl-0">
                    {act.navAction && (
                      <button
                        type="button"
                        onClick={() => handleActionNav(act.navAction)}
                        className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 hover:border-zinc-500"
                      >
                        {act.navAction.label}
                      </button>
                    )}
                    {act.aiPrompt && onAskAdvisor && (
                      <button
                        type="button"
                        onClick={() => onAskAdvisor(act.aiPrompt)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
                      >
                        <Sparkles className="h-3 w-3" />
                        Ask Claude CFO
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Side-by-Side Dual-Earner Paycheck & Cap Scorecard */}
      {paySummary.combinedGrossComp > 0 && (
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
              <Layers className="h-4 w-4 text-emerald-400" />
              Side-by-Side Household Paycheck & 2026 IRS Cap Scorecard
            </div>
            <span className="text-[11px] text-zinc-500">
              Live calculation from Pay & Taxes
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] tabular-nums">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="pb-2 pr-4 font-medium">Metric</th>
                  <th className="pb-2 pr-4 font-medium text-emerald-300">
                    {householdNames.primary_name}
                  </th>
                  <th className="pb-2 pr-4 font-medium text-fuchsia-300">
                    {householdNames.spouse_name}
                  </th>
                  <th className="pb-2 font-medium text-zinc-200">Combined Household</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                <tr>
                  <td className="py-2 pr-4 font-sans text-zinc-300">Gross Comp (Base + Bonus + RSU)</td>
                  <td className="py-2 pr-4 text-zinc-100">
                    {mask(formatCurrency(paySummary.primary.annualCashAndEquityComp, { decimals: 0 }))}
                  </td>
                  <td className="py-2 pr-4 text-zinc-100">
                    {mask(formatCurrency(paySummary.spouse.annualCashAndEquityComp, { decimals: 0 }))}
                  </td>
                  <td className="py-2 font-semibold text-emerald-300">
                    {mask(formatCurrency(paySummary.combinedGrossComp, { decimals: 0 }))}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-sans text-zinc-300">Net Base Take-Home / Check</td>
                  <td className="py-2 pr-4 text-zinc-100">
                    {mask(formatCurrency(paySummary.primary.netPerPaycheck))}
                  </td>
                  <td className="py-2 pr-4 text-zinc-100">
                    {mask(formatCurrency(paySummary.spouse.netPerPaycheck))}
                  </td>
                  <td className="py-2 font-semibold text-sky-300">
                    {mask(formatCurrency(paySummary.combinedAvgMonthlyNetBase, { decimals: 0 }))}/mo
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-sans text-zinc-300">401(k) YTD vs $24,500 Cap</td>
                  <td className="py-2 pr-4 text-zinc-100">
                    {mask(formatCurrency(paySummary.primary.ytd401k, { decimals: 0 }))}{' '}
                    <span className="text-zinc-500">
                      ({mask(formatCurrency(paySummary.primary.remaining401kByYtd, { decimals: 0 }))} left)
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-100">
                    {mask(formatCurrency(paySummary.spouse.ytd401k, { decimals: 0 }))}{' '}
                    <span className="text-zinc-500">
                      ({mask(formatCurrency(paySummary.spouse.remaining401kByYtd, { decimals: 0 }))} left)
                    </span>
                  </td>
                  <td className="py-2 text-zinc-200">
                    {mask(
                      formatCurrency(paySummary.primary.ytd401k + paySummary.spouse.ytd401k, {
                        decimals: 0,
                      })
                    )}{' '}
                    / $49,000
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-sans text-zinc-300">Employer 401(k) Match / yr</td>
                  <td className="py-2 pr-4 text-emerald-300">
                    {mask(formatCurrency(paySummary.primary.employerMatchAnnual, { decimals: 0 }))}
                  </td>
                  <td className="py-2 pr-4 text-fuchsia-300">
                    {mask(formatCurrency(paySummary.spouse.employerMatchAnnual, { decimals: 0 }))}
                  </td>
                  <td className="py-2 font-semibold text-emerald-300">
                    {mask(
                      formatCurrency(
                        paySummary.primary.employerMatchAnnual +
                          paySummary.spouse.employerMatchAnnual,
                        { decimals: 0 }
                      )
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-sans text-zinc-300">HSA / Healthcare FSA (Annual)</td>
                  <td className="py-2 pr-4 text-zinc-100">
                    {paySummary.primary.annualHsaTotal > 0
                      ? `HSA ${mask(formatCurrency(paySummary.primary.annualHsaTotal, { decimals: 0 }))}`
                      : paySummary.primary.annualHealthFsa > 0
                      ? `FSA ${mask(formatCurrency(paySummary.primary.annualHealthFsa, { decimals: 0 }))}`
                      : '—'}
                  </td>
                  <td className="py-2 pr-4 text-zinc-100">
                    {paySummary.spouse.annualHsaTotal > 0
                      ? `HSA ${mask(formatCurrency(paySummary.spouse.annualHsaTotal, { decimals: 0 }))}`
                      : paySummary.spouse.annualHealthFsa > 0
                      ? `FSA ${mask(formatCurrency(paySummary.spouse.annualHealthFsa, { decimals: 0 }))}`
                      : '—'}
                  </td>
                  <td className="py-2 text-zinc-200">
                    {paySummary.hsaYtd > 0
                      ? `HSA YTD ${mask(formatCurrency(paySummary.hsaYtd, { decimals: 0 }))}`
                      : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-sans text-zinc-300">ESPP Contribution (Annual)</td>
                  <td className="py-2 pr-4 text-zinc-100">
                    {paySummary.primary.annualEsppContribution > 0
                      ? mask(formatCurrency(paySummary.primary.annualEsppContribution, { decimals: 0 }))
                      : '—'}
                  </td>
                  <td className="py-2 pr-4 text-zinc-100">
                    {paySummary.spouse.annualEsppContribution > 0
                      ? mask(formatCurrency(paySummary.spouse.annualEsppContribution, { decimals: 0 }))
                      : '—'}
                  </td>
                  <td className="py-2 text-cyan-300">
                    {paySummary.primary.annualEsppImpliedGain +
                      paySummary.spouse.annualEsppImpliedGain >
                    0
                      ? `+${mask(
                          formatCurrency(
                            paySummary.primary.annualEsppImpliedGain +
                              paySummary.spouse.annualEsppImpliedGain,
                            { decimals: 0 }
                          )
                        )} est. gain`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
