import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Compass,
  Landmark,
  Layers,
  Plus,
  RefreshCw,
  Repeat,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { formatCurrency, formatLastSaved, todayIsoDate, toNumber } from '../lib/finance';
import { addDaysIso, formatShortDate } from '../lib/payrollSync';
import {
  CSP_CANDIDATE_UNIVERSE,
  RISK_PROFILES,
  TBILL_BENCHMARK_YIELD,
  analyzeCapitalDeployment,
  blackScholesOption,
  estimateTypicalIv,
  evaluateRollVsLoss,
  normalizeOptionsDesk,
  persistOptionsDeskState,
  roundToStandardStrike,
} from '../lib/capitalStrategies';

const ROLL_PRESETS = [
  {
    key: 'csp_mild',
    label: 'Sample: CSP Down 5% (Roll vs Wheel)',
    values: {
      strategy: 'csp',
      symbol: 'SPLG',
      contracts: '2',
      spot: '66.50',
      currentStrike: '70',
      originalPremium: '1.15',
      currentDte: '12',
      currentBtcCost: '3.85',
      costBasis: '',
      newStrike: '69',
      newDte: '45',
      newPremium: '4.25',
      isTaxAdvantaged: false,
    },
  },
  {
    key: 'csp_deep',
    label: 'Sample: CSP Deep Drop -18% (Cut Loss?)',
    values: {
      strategy: 'csp',
      symbol: 'AMZN',
      contracts: '1',
      spot: '164.00',
      currentStrike: '200',
      originalPremium: '3.40',
      currentDte: '14',
      currentBtcCost: '36.80',
      costBasis: '',
      newStrike: '195',
      newDte: '49',
      newPremium: '35.20',
      isTaxAdvantaged: false,
    },
  },
  {
    key: 'cc_breached',
    label: 'Sample: Covered Call Breached +6% (Roll Up?)',
    values: {
      strategy: 'cc',
      symbol: 'AAPL',
      contracts: '1',
      spot: '254.00',
      currentStrike: '240',
      originalPremium: '3.10',
      currentDte: '10',
      currentBtcCost: '15.20',
      costBasis: '215',
      newStrike: '245',
      newDte: '45',
      newPremium: '16.10',
      isTaxAdvantaged: false,
    },
  },
];

export default function CapitalDeskTab({
  supabase,
  session,
  accounts = [],
  equityHoldings = [],
  promos = [],
  expenses = [],
  recurringBills = [],
  taxProfile = null,
  householdNames = { primary_name: 'Me', spouse_name: 'Wife' },
  privacyMode = false,
  onDataChanged,
  onNavigateTab,
  onAskAdvisor,
}) {
  const mask = (str) => (privacyMode ? '••••••' : str);
  const savedDesk = useMemo(
    () => normalizeOptionsDesk(taxProfile?.paystub_details?.options_desk),
    [taxProfile]
  );

  // Sub-tab navigation: 'deploy' | 'roll_lab' | 'positions'
  const [subTab, setSubTab] = useState('deploy');

  // Desk preferences (synced from savedDesk, persistable under AAL2 RLS)
  const [riskProfile, setRiskProfile] = useState(savedDesk.risk_profile);
  const [reserveMonths, setReserveMonths] = useState(savedDesk.reserve_months);
  const [customBudgetInput, setCustomBudgetInput] = useState(savedDesk.custom_deploy_budget);
  const [customWatchlist, setCustomWatchlist] = useState(savedDesk.custom_watchlist);
  const [positions, setPositions] = useState(savedDesk.positions);
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [savingDesk, setSavingDesk] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(taxProfile?.updated_at || null);
  const [deskError, setDeskError] = useState('');
  const [deskNotice, setDeskNotice] = useState('');

  // Sync when taxProfile updates externally
  useEffect(() => {
    setRiskProfile(savedDesk.risk_profile);
    setReserveMonths(savedDesk.reserve_months);
    setCustomBudgetInput(savedDesk.custom_deploy_budget);
    setCustomWatchlist(savedDesk.custom_watchlist);
    setPositions(savedDesk.positions);
    setPrefsDirty(false);
    if (taxProfile?.updated_at) setLastSavedAt(taxProfile.updated_at);
  }, [savedDesk, taxProfile?.updated_at]);

  // Live quotes for CSP universe + custom watchlist + active positions
  const [liveQuotes, setLiveQuotes] = useState({});
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [quotesSyncedAt, setQuotesSyncedAt] = useState(null);

  // Filters on Deployment Plan
  const [cspFilter, setCspFilter] = useState('fits'); // 'fits' | 'etf' | 'all'
  const [accountsExpanded, setAccountsExpanded] = useState(false);

  // Roll vs. Take-Loss Lab state
  const [rollForm, setRollForm] = useState(() => ROLL_PRESETS[0].values);
  const [fetchingRollPrice, setFetchingRollPrice] = useState(false);

  // Active Positions tracker form
  const [showAddPos, setShowAddPos] = useState(false);
  const [closingPosId, setClosingPosId] = useState('');
  const [closePnlInput, setClosePnlInput] = useState('');
  const [newPos, setNewPos] = useState({
    account_id: '',
    strategy: 'csp',
    symbol: '',
    contracts: '1',
    strike: '',
    long_strike: '',
    expiration: addDaysIso(todayIsoDate(), 35),
    premium_per_share: '',
    cost_basis: '',
    notes: '',
  });

  const allSymbolsToQuote = useMemo(() => {
    const syms = new Set(['SGOV']);
    for (const c of CSP_CANDIDATE_UNIVERSE) syms.add(c.symbol);
    for (const tok of String(customWatchlist || '').split(/[\s,;]+/)) {
      const s = tok.trim().toUpperCase();
      if (/^[A-Z0-9.\-^=]{1,14}$/.test(s)) syms.add(s);
    }
    for (const p of positions) {
      if (p.symbol) syms.add(p.symbol.toUpperCase());
    }
    for (const h of equityHoldings || []) {
      if (h.symbol) syms.add(String(h.symbol).trim().toUpperCase());
    }
    return Array.from(syms).slice(0, 38);
  }, [customWatchlist, positions, equityHoldings]);

  const fetchDeskQuotes = useCallback(async () => {
    if (!supabase || allSymbolsToQuote.length === 0) return;
    setLoadingQuotes(true);
    try {
      const { data, error } = await supabase.functions.invoke('stock-quotes', {
        body: { symbols: allSymbolsToQuote },
      });
      if (!error && data?.quotes) {
        setLiveQuotes((prev) => ({ ...prev, ...data.quotes }));
        setQuotesSyncedAt(new Date().toISOString());
      }
    } catch {
      // Non-blocking fallback to baseline prices
    } finally {
      setLoadingQuotes(false);
    }
  }, [supabase, allSymbolsToQuote]);

  useEffect(() => {
    fetchDeskQuotes();
  }, [fetchDeskQuotes]);

  // Run full deployment analysis
  const analysis = useMemo(
    () =>
      analyzeCapitalDeployment({
        accounts,
        equityHoldings,
        promos,
        expenses,
        recurringBills,
        taxProfile: {
          ...(taxProfile || {}),
          paystub_details: {
            ...(taxProfile?.paystub_details || {}),
            options_desk: {
              risk_profile: riskProfile,
              reserve_months: reserveMonths,
              custom_deploy_budget: customBudgetInput,
              custom_watchlist: customWatchlist,
              positions,
            },
          },
        },
        householdNames,
        riskProfileKey: riskProfile,
        reserveMonths,
        customDeployBudget: customBudgetInput,
        customWatchlist,
        liveQuotes,
      }),
    [
      accounts,
      equityHoldings,
      promos,
      expenses,
      recurringBills,
      taxProfile,
      householdNames,
      riskProfile,
      reserveMonths,
      customBudgetInput,
      customWatchlist,
      positions,
      liveQuotes,
    ]
  );

  const persistDesk = async (overrideObj = null, noticeMsg = '') => {
    if (!supabase || !session?.user?.id) return;
    setSavingDesk(true);
    setDeskError('');
    setDeskNotice('');
    try {
      const payload = overrideObj || {
        risk_profile: riskProfile,
        reserve_months: reserveMonths,
        custom_deploy_budget: customBudgetInput,
        custom_watchlist: customWatchlist,
        positions,
      };
      await persistOptionsDeskState(supabase, session.user.id, payload);
      const nowIso = new Date().toISOString();
      setLastSavedAt(nowIso);
      setPrefsDirty(false);
      if (noticeMsg) setDeskNotice(noticeMsg);
      if (onDataChanged) await onDataChanged();
    } catch (err) {
      setDeskError(err?.message || 'Failed to save Capital Desk settings.');
    } finally {
      setSavingDesk(false);
    }
  };

  // Filtered CSP candidate list
  const visibleCspCandidates = useMemo(() => {
    if (cspFilter === 'etf') {
      return analysis.cspCandidates.filter((c) => c.kind === 'etf');
    }
    if (cspFilter === 'fits') {
      const fitting = analysis.cspCandidates.filter(
        (c) => c.fitsRiskTier && (c.fitsRiskCap || c.maxContractsByBudget > 0)
      );
      return fitting.length > 0 ? fitting : analysis.cspCandidates.slice(0, 6);
    }
    return analysis.cspCandidates;
  }, [analysis.cspCandidates, cspFilter]);

  // Roll Lab live verdict
  const rollVerdict = useMemo(
    () =>
      evaluateRollVsLoss({
        strategy: rollForm.strategy,
        symbol: rollForm.symbol,
        contracts: rollForm.contracts,
        spot: rollForm.spot,
        currentStrike: rollForm.currentStrike,
        originalPremium: rollForm.originalPremium,
        currentBtcCost: rollForm.currentBtcCost,
        currentDte: rollForm.currentDte,
        costBasis: rollForm.costBasis,
        newStrike: rollForm.newStrike,
        newDte: rollForm.newDte,
        newPremium: rollForm.newPremium,
        capLossCarryforward: analysis.capLossShield,
        marginalCombinedTaxRate: analysis.estFedMarginalRate + analysis.estStateTaxRate,
        isTaxAdvantaged: rollForm.isTaxAdvantaged,
      }),
    [rollForm, analysis.capLossShield, analysis.estFedMarginalRate, analysis.estStateTaxRate]
  );

  // Auto-estimate Black-Scholes BTC & Roll target inside Roll Lab
  const handleAutoEstimateRollPrices = () => {
    const sym = String(rollForm.symbol || '').trim().toUpperCase();
    const spot = toNumber(rollForm.spot);
    const k1 = toNumber(rollForm.currentStrike);
    const dte1 = Math.max(1, toNumber(rollForm.currentDte) || 10);
    if (spot <= 0 || k1 <= 0) return;

    const iv = estimateTypicalIv(sym);
    const type = rollForm.strategy === 'cc' ? 'call' : 'put';
    const curOpt = blackScholesOption({ spot, strike: k1, dte: dte1, iv, type });

    // Propose rolling out +35 days and improving strike by ~1–2 standard steps when feasible
    const nextDte = Math.max(dte1 + 28, 42);
    const targetK2 =
      type === 'call'
        ? roundToStandardStrike(Math.max(k1 + (spot >= 100 ? 5 : 1), spot * 0.98), 'up')
        : roundToStandardStrike(Math.min(k1 - (spot >= 100 ? 2.5 : 1), spot * 1.02), 'down');
    const nextOpt = blackScholesOption({ spot, strike: targetK2, dte: nextDte, iv, type });

    // If moving strike causes a debit, fall back to rolling straight out at same strike for credit
    let chosenK2 = targetK2;
    let chosenPrem = nextOpt.price;
    if (nextOpt.price < curOpt.price) {
      const flatOpt = blackScholesOption({ spot, strike: k1, dte: nextDte, iv, type });
      if (flatOpt.price >= curOpt.price) {
        chosenK2 = k1;
        chosenPrem = flatOpt.price;
      }
    }

    setRollForm((prev) => ({
      ...prev,
      currentBtcCost: String(curOpt.price),
      newStrike: String(chosenK2),
      newDte: String(nextDte),
      newPremium: String(chosenPrem),
    }));
  };

  const handleFetchRollSpot = async () => {
    const sym = String(rollForm.symbol || '').trim().toUpperCase();
    if (!sym || !supabase) return;
    setFetchingRollPrice(true);
    try {
      const { data } = await supabase.functions.invoke('stock-quotes', {
        body: { symbols: [sym] },
      });
      const p = Number(data?.quotes?.[sym]?.price);
      if (Number.isFinite(p) && p > 0) {
        setLiveQuotes((prev) => ({ ...prev, [sym]: data.quotes[sym] }));
        setRollForm((prev) => ({ ...prev, spot: String(Number(p.toFixed(2))) }));
      }
    } finally {
      setFetchingRollPrice(false);
    }
  };

  // Prefill Roll Lab from a CSP/CC suggestion or an active tracked position
  const openInRollLab = ({
    strategy,
    symbol,
    contracts = 1,
    spot,
    strike,
    premium,
    dte = 12,
    costBasis = 0,
    isTaxAdvantaged = false,
    simulateAdverseMove = false,
  }) => {
    const iv = estimateTypicalIv(symbol);
    const type = strategy === 'cc' ? 'call' : 'put';
    const baseSpot = toNumber(spot) || toNumber(strike);
    // If launching from a fresh suggestion, simulate a 5% adverse move so user immediately sees how a roll behaves!
    const testSpot = simulateAdverseMove
      ? Number((type === 'call' ? strike * 1.04 : strike * 0.95).toFixed(2))
      : baseSpot;
    const curOpt = blackScholesOption({ spot: testSpot, strike, dte, iv, type });
    const nextDte = Math.max(dte + 30, 42);
    const nextStrike =
      type === 'call'
        ? roundToStandardStrike(strike * 1.03, 'up')
        : roundToStandardStrike(strike * 0.98, 'down');
    const nextOpt = blackScholesOption({ spot: testSpot, strike: nextStrike, dte: nextDte, iv, type });

    setRollForm({
      strategy: type === 'call' ? 'cc' : 'csp',
      symbol,
      contracts: String(contracts),
      spot: String(testSpot),
      currentStrike: String(strike),
      originalPremium: String(Number(toNumber(premium).toFixed(2))),
      currentDte: String(Math.max(1, dte)),
      currentBtcCost: String(curOpt.price),
      costBasis: costBasis > 0 ? String(costBasis) : '',
      newStrike: String(nextStrike),
      newDte: String(nextDte),
      newPremium: String(nextOpt.price),
      isTaxAdvantaged: Boolean(isTaxAdvantaged),
    });
    setSubTab('roll_lab');
  };

  // Prefill Track Trade form from a CC or CSP suggestion
  const openTrackFromSuggestion = ({ strategy, accountId, symbol, contracts, strike, premium, costBasis, dte }) => {
    setNewPos({
      account_id: accountId ? String(accountId) : String(analysis.brokerageAccounts[0]?.id || ''),
      strategy,
      symbol,
      contracts: String(contracts || 1),
      strike: String(strike || ''),
      long_strike: '',
      expiration: addDaysIso(todayIsoDate(), dte || 35),
      premium_per_share: String(premium || ''),
      cost_basis: costBasis ? String(costBasis) : '',
      notes: '',
    });
    setShowAddPos(true);
    setSubTab('positions');
  };

  const handleAddPosition = async (e) => {
    e.preventDefault();
    const sym = String(newPos.symbol || '').trim().toUpperCase();
    if (!sym) return;
    if (analysis.restrictedInfo.restrictedSet.has(sym)) {
      setDeskError(
        `${sym} is on your Employer-Restricted Ticker list (no options/hedging allowed). Update restricted tickers in Pay & Taxes only if permitted by company compliance.`
      );
      return;
    }

    const created = {
      id: `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      account_id: newPos.account_id ? Number(newPos.account_id) : null,
      strategy: newPos.strategy,
      symbol: sym,
      contracts: Math.max(1, parseInt(newPos.contracts || '1', 10) || 1),
      strike: Math.max(0, toNumber(newPos.strike)),
      long_strike: newPos.strategy === 'put_spread' ? Math.max(0, toNumber(newPos.long_strike)) : 0,
      expiration: newPos.expiration || '',
      premium_per_share: Math.max(0, toNumber(newPos.premium_per_share)),
      cost_basis: Math.max(0, toNumber(newPos.cost_basis)),
      status: 'open',
      realized_pnl: 0,
      roll_count: 0,
      opened_at: todayIsoDate(),
      notes: newPos.notes.trim().slice(0, 240),
    };

    const nextPositions = [created, ...positions];
    setPositions(nextPositions);
    setShowAddPos(false);
    setNewPos({
      account_id: newPos.account_id,
      strategy: 'csp',
      symbol: '',
      contracts: '1',
      strike: '',
      long_strike: '',
      expiration: addDaysIso(todayIsoDate(), 35),
      premium_per_share: '',
      cost_basis: '',
      notes: '',
    });
    await persistDesk(
      {
        risk_profile: riskProfile,
        reserve_months: reserveMonths,
        custom_deploy_budget: customBudgetInput,
        custom_watchlist: customWatchlist,
        positions: nextPositions,
      },
      `Logged ${created.strategy.toUpperCase()} position on ${sym} under AAL2 RLS.`
    );
  };

  const handleUpdatePositionStatus = async (posId, nextStatus, realizedPnlVal = null) => {
    const nextPositions = positions.map((p) => {
      if (p.id !== posId) return p;
      const defaultFullProfit = Number((p.premium_per_share * 100 * p.contracts).toFixed(2));
      return {
        ...p,
        status: nextStatus,
        realized_pnl:
          realizedPnlVal !== null && realizedPnlVal !== ''
            ? toNumber(realizedPnlVal)
            : nextStatus === 'closed' || nextStatus === 'assigned'
            ? defaultFullProfit
            : p.realized_pnl,
      };
    });
    setPositions(nextPositions);
    setClosingPosId('');
    setClosePnlInput('');
    await persistDesk(
      {
        risk_profile: riskProfile,
        reserve_months: reserveMonths,
        custom_deploy_budget: customBudgetInput,
        custom_watchlist: customWatchlist,
        positions: nextPositions,
      },
      `Updated position status to "${nextStatus}".`
    );
  };

  const handleDeletePosition = async (posId) => {
    const nextPositions = positions.filter((p) => p.id !== posId);
    setPositions(nextPositions);
    await persistDesk(
      {
        risk_profile: riskProfile,
        reserve_months: reserveMonths,
        custom_deploy_budget: customBudgetInput,
        custom_watchlist: customWatchlist,
        positions: nextPositions,
      },
      'Removed option position.'
    );
  };

  const buildMasterAiPrompt = () => {
    const ccList = analysis.ccSuggestions
      .map((c) => `${c.symbol} (${c.contracts}x @ $${c.suggestedStrike}, ${c.dte}d)`)
      .join(', ');
    const restrictedList = analysis.restrictedInfo.allRestrictedList.join(', ');
    return `Act as our conservative Options & Capital Deployment CFO. Our risk tolerance is ${analysis.risk.label} (${Math.round(
      analysis.risk.targetDelta * 100
    )} delta, ${analysis.risk.defaultDte} DTE). We have ${formatCurrency(
      analysis.deployableCapital,
      { decimals: 0 }
    )} deployable capital (${formatCurrency(analysis.totalBrokerageDeployableCash, {
      decimals: 0,
    })} in brokerage/IRA accounts + ${formatCurrency(analysis.bankSurplusCash, {
      decimals: 0,
    })} bank surplus after protecting ${formatCurrency(analysis.totalProtectedObligations, {
      decimals: 0,
    })} for ${reserveMonths}mo emergency fund, 0% promos, and baby buffer).${
      restrictedList
        ? ` Strictly exclude employer-restricted tickers (${restrictedList}) from any options.`
        : ''
    }${ccList ? ` Eligible CC lots: ${ccList}.` : ''}${
      analysis.capLossShield > 0
        ? ` We also have ${formatCurrency(analysis.capLossShield, {
            decimals: 0,
          })} capital loss carryforward shielding short-term option premiums.`
        : ''
    } Build a concrete capital allocation across NY-tax-exempt T-Bills/SGOV collateral, Cash-Secured Puts / Wheel, Covered Calls, and Defined-Risk Credit Spreads, plus our exact mechanical roll-vs-take-loss exit rules.`;
  };

  const openPositions = analysis.evaluatedPositions.filter((p) => p.status === 'open');
  const closedPositions = analysis.evaluatedPositions.filter((p) => p.status !== 'open');
  const openCreditTotal = openPositions.reduce((s, p) => s + p.totalCreditReceived, 0);
  const realizedYtdPnl = closedPositions.reduce((s, p) => s + toNumber(p.realized_pnl), 0);

  return (
    <div className="space-y-5">
      {/* TOP COMMAND HEADER */}
      <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                <Compass className="h-4 w-4" />
              </div>
              <h1 className="text-base font-semibold text-zinc-100">
                Capital Deployment & Options Strategy Desk
              </h1>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                {analysis.risk.label} ({Math.round(analysis.risk.targetDelta * 100)}Δ • {analysis.risk.defaultDte} DTE)
              </span>
              {analysis.restrictedInfo.allRestrictedList.length > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigateTab && onNavigateTab('income')}
                  title="Employer-restricted tickers are excluded from all Covered Call & CSP suggestions. Click to review in Pay & Taxes."
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-amber-500/20"
                >
                  <ShieldAlert className="h-3 w-3" />
                  Options Blocked: {analysis.restrictedInfo.allRestrictedList.join(', ')}
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-400">
              Put idle brokerage & surplus capital to work with Covered Calls, Cash-Secured Puts, T-Bill double-dip collateral, defined-risk spreads, and a quantitative Roll vs. Take-Loss rescue lab.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loadingQuotes}
              onClick={fetchDeskQuotes}
              title={
                quotesSyncedAt
                  ? `Quotes refreshed ${formatLastSaved(quotesSyncedAt)}`
                  : 'Refresh live prices for strategy candidates'
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingQuotes ? 'animate-spin' : ''}`} />
              {loadingQuotes ? 'Pricing…' : 'Refresh Prices'}
            </button>

            {onAskAdvisor && (
              <button
                type="button"
                onClick={() => onAskAdvisor(buildMasterAiPrompt())}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Ask Claude CFO
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* RISK, RESERVE & BUDGET CONTROLS */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/80 pt-3.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {/* Risk Tier Selector */}
            <div className="inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1">
              {Object.values(RISK_PROFILES).map((rp) => (
                <button
                  key={rp.key}
                  type="button"
                  onClick={() => {
                    setRiskProfile(rp.key);
                    setPrefsDirty(true);
                  }}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                    riskProfile === rp.key
                      ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {rp.label}
                </button>
              ))}
            </div>

            {/* Emergency Reserve Slider/Selector */}
            <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
              <span>Cash Reserve:</span>
              <select
                value={reserveMonths}
                onChange={(e) => {
                  setReserveMonths(Number(e.target.value));
                  setPrefsDirty(true);
                }}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-100"
              >
                {[3, 6, 9, 12].map((m) => (
                  <option key={m} value={m}>
                    {m} mo
                  </option>
                ))}
              </select>
            </label>

            {/* Target Deployable Budget Override */}
            <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
              <span>Deploy Budget ($):</span>
              <input
                type="number"
                min="0"
                step="1000"
                placeholder={String(Math.round(analysis.defaultWorkingCapital))}
                value={customBudgetInput}
                onChange={(e) => {
                  setCustomBudgetInput(e.target.value);
                  setPrefsDirty(true);
                }}
                className="w-28 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] text-zinc-100"
              />
              {customBudgetInput !== '' && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomBudgetInput('');
                    setPrefsDirty(true);
                  }}
                  className="text-[10px] text-sky-300 hover:underline"
                >
                  Auto
                </button>
              )}
            </label>
          </div>

          <div className="flex items-center gap-2">
            {lastSavedAt && !prefsDirty && (
              <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                Saved: {formatLastSaved(lastSavedAt)}
              </span>
            )}
            {prefsDirty && (
              <button
                type="button"
                disabled={savingDesk}
                onClick={() => persistDesk(null, 'Capital Desk preferences saved under AAL2 RLS.')}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {savingDesk ? 'Saving…' : 'Save Settings'}
              </button>
            )}
          </div>
        </div>

        {/* TAX & COMPLIANCE CONTEXT CHIPS */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-sky-200">
            <Landmark className="h-3 w-3" />
            {analysis.isStateIncomeTaxFree
              ? `T-Bill Collateral: ~${(TBILL_BENCHMARK_YIELD * 100).toFixed(1)}% yield`
              : `${analysis.stateCode || 'State'} Tax-Free T-Bills: ${(
                  TBILL_BENCHMARK_YIELD * 100
                ).toFixed(1)}% ≈ ${analysis.tbillTaxEquivHysaPct}% bank HYSA`}
          </span>

          {analysis.capLossShield > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-200">
              <ShieldCheck className="h-3 w-3" />
              Loss Shield: {mask(formatCurrency(analysis.capLossShield, { decimals: 0 }))} offsets short-term option premiums 0% tax
            </span>
          )}

          {analysis.highAprDebts.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/10 px-2.5 py-0.5 text-rose-200">
              <AlertTriangle className="h-3 w-3" />
              High-APR Debt ({toNumber(analysis.highAprDebts[0].interest_rate).toFixed(1)}%) beats low-risk option yield — pay down first
            </span>
          )}

          {analysis.reserveShortfall > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-0.5 text-amber-200">
              <AlertTriangle className="h-3 w-3" />
              Bank cash is {mask(formatCurrency(analysis.reserveShortfall, { decimals: 0 }))} below {reserveMonths}mo + promo/baby buffer — keep bank cash protected
            </span>
          )}
        </div>
      </div>

      {deskError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{deskError}</span>
        </div>
      )}
      {deskNotice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{deskNotice}</span>
        </div>
      )}

      {/* 4-CARD CAPITAL KPI STRIP */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4">
          <div className="text-[11px] text-zinc-400">Deployable Working Capital</div>
          <div className="mt-1 font-mono text-xl font-semibold text-emerald-300 tabular-nums">
            {mask(formatCurrency(analysis.deployableCapital, { decimals: 0 }))}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500 tabular-nums">
            Brokerage/IRA: {mask(formatCurrency(analysis.totalBrokerageDeployableCash, { decimals: 0 }))}
            {analysis.bankSurplusCash > 0
              ? ` • Bank Surplus: ${mask(formatCurrency(analysis.bankSurplusCash, { decimals: 0 }))}`
              : ' • Bank cash reserved'}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4">
          <div className="text-[11px] text-zinc-400">Protected Cash Shield</div>
          <div className="mt-1 font-mono text-xl font-semibold text-sky-300 tabular-nums">
            {mask(formatCurrency(analysis.totalProtectedObligations, { decimals: 0 }))}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500 tabular-nums">
            {reserveMonths}mo ({mask(formatCurrency(analysis.emergencyTarget, { decimals: 0 }))})
            {analysis.totalPromoBalance > 0
              ? ` + 0% Promos (${mask(formatCurrency(analysis.totalPromoBalance, { decimals: 0 }))})`
              : ''}
            {analysis.lifeBuffer > 0
              ? ` + Baby (${mask(formatCurrency(analysis.lifeBuffer, { decimals: 0 }))})`
              : ''}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4">
          <div className="text-[11px] text-zinc-400">Covered-Call Eligible Lots</div>
          <div className="mt-1 font-mono text-xl font-semibold text-violet-300 tabular-nums">
            {analysis.ccSuggestions.reduce((s, c) => s + c.contracts, 0)} contracts
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            {analysis.ccSuggestions.length > 0
              ? analysis.ccSuggestions.map((c) => `${c.symbol} (${c.contracts}x)`).join(', ')
              : analysis.restrictedLots.length > 0
              ? `${analysis.restrictedLots.length} employer lot(s) excluded for compliance`
              : 'Build 100-share ETF lots via CSP Wheel'}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4">
          <div className="text-[11px] text-zinc-400">Est. Annualized Income ({analysis.risk.label})</div>
          <div className="mt-1 font-mono text-xl font-semibold text-cyan-300 tabular-nums">
            +{mask(formatCurrency(analysis.estTotalAnnualIncome, { decimals: 0 }))}
            <span className="text-xs font-normal text-zinc-500">/yr</span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-500 tabular-nums">
            T-Bills {mask(formatCurrency(analysis.estTbillAnnualIncome, { decimals: 0 }))} + CSP{' '}
            {mask(formatCurrency(analysis.estCspAnnualIncome, { decimals: 0 }))}
            {analysis.estCcAnnualIncome > 0
              ? ` + CC ${mask(formatCurrency(analysis.estCcAnnualIncome, { decimals: 0 }))}`
              : ''}
          </div>
        </div>
      </div>

      {/* INNER SUB-TAB SWITCHER */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 text-xs">
          <button
            type="button"
            onClick={() => setSubTab('deploy')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-medium transition ${
              subTab === 'deploy'
                ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            1. Deployment Plan (CC / CSP / Yield)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('roll_lab')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-medium transition ${
              subTab === 'roll_lab'
                ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Repeat className="h-3.5 w-3.5" />
            2. Roll vs. Take-Loss Lab
          </button>
          <button
            type="button"
            onClick={() => setSubTab('positions')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-medium transition ${
              subTab === 'positions'
                ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            3. Active Positions ({openPositions.length})
            {analysis.openAlertsCount > 0 && (
              <span className="rounded-full bg-amber-400 px-1.5 py-0.2 font-mono text-[9px] font-bold text-zinc-950">
                {analysis.openAlertsCount}
              </span>
            )}
          </button>
        </div>

        <span className="text-[11px] text-zinc-500">
          Model estimates use Black-Scholes + live spot prices — verify live bid/ask & earnings dates in your broker before trading.
        </span>
      </div>

      {/* =================================================================== */}
      {/* SUB-TAB 1: DEPLOYMENT PLAN                                          */}
      {/* =================================================================== */}
      {subTab === 'deploy' && (
        <div className="space-y-5">
          {/* A. MULTI-SLEEVE CAPITAL ALLOCATION BLUEPRINT */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">
                  Recommended Capital Blueprint — {analysis.risk.label}
                </h2>
                <p className="text-xs text-zinc-400">{analysis.risk.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setAccountsExpanded(!accountsExpanded)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-[11px] font-medium text-zinc-300 hover:border-zinc-700"
              >
                {accountsExpanded
                  ? 'Hide Brokerage Accounts'
                  : `Inspect ${analysis.brokerageAccounts.length} Eligible Brokerage / IRA Account${
                      analysis.brokerageAccounts.length === 1 ? '' : 's'
                    }`}
              </button>
            </div>

            {/* Proportional Bar */}
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-900">
              <div
                style={{ width: `${analysis.risk.tbillPct}%` }}
                className="bg-sky-500"
                title={`T-Bills / SGOV: ${analysis.risk.tbillPct}%`}
              />
              <div
                style={{ width: `${analysis.risk.cspPct}%` }}
                className="bg-emerald-500"
                title={`Cash-Secured Puts / Wheel: ${analysis.risk.cspPct}%`}
              />
              <div
                style={{ width: `${analysis.risk.coreIndexPct}%` }}
                className="bg-violet-500"
                title={`Core Index DCA / Spreads: ${analysis.risk.coreIndexPct}%`}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-sky-200">
                  <span>Sleeve 1: T-Bills / Treasury Core</span>
                  <span className="font-mono">{analysis.risk.tbillPct}%</span>
                </div>
                <div className="font-mono text-lg font-semibold text-zinc-100 tabular-nums">
                  {mask(formatCurrency(analysis.sleeves.tbillAllocation, { decimals: 0 }))}
                </div>
                <p className="text-[11px] text-zinc-400">
                  Park in <strong>SGOV / USFR / FDLXX</strong> or 4–13 week T-Bill ladder (~4.2%
                  {analysis.isStateIncomeTaxFree
                    ? ''
                    : `, state-tax free ≈ ${analysis.tbillTaxEquivHysaPct}% HYSA`}
                  ). Zero principal drama, instant liquidity for dip-buying or promo payoffs.
                </p>
              </div>

              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-200">
                  <span>Sleeve 2: CSP / Wheel Collateral</span>
                  <span className="font-mono">{analysis.risk.cspPct}%</span>
                </div>
                <div className="font-mono text-lg font-semibold text-zinc-100 tabular-nums">
                  {mask(formatCurrency(analysis.sleeves.cspAllocation, { decimals: 0 }))}
                </div>
                <p className="text-[11px] text-zinc-400">
                  Keep collateral in a Treasury money market (<strong>FDLXX / VUSXX / SNSXX</strong>) while selling{' '}
                  <strong>{Math.round(analysis.risk.targetDelta * 100)}Δ</strong> puts (30–45 DTE) — earns{' '}
                  <strong>double-dip yield</strong> (T-Bill + option premium). Cap any single ticker at{' '}
                  <strong>{mask(formatCurrency(analysis.sleeves.maxPerTickerCollateral, { decimals: 0 }))}</strong>.
                </p>
              </div>

              <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-violet-200">
                  <span>Sleeve 3: Core Index DCA & Spreads</span>
                  <span className="font-mono">{analysis.risk.coreIndexPct}%</span>
                </div>
                <div className="font-mono text-lg font-semibold text-zinc-100 tabular-nums">
                  {mask(formatCurrency(analysis.sleeves.coreIndexAllocation, { decimals: 0 }))}
                </div>
                <p className="text-[11px] text-zinc-400">
                  Steady weekly/monthly DCA into low-cost index ETFs (<strong>VOO / SPLG / VTI / VXUS</strong>) or small defined-risk Put Credit Spreads for capped downside.
                </p>
              </div>
            </div>

            {/* Collapsible Brokerage Account Inventory */}
            {accountsExpanded && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-zinc-200">
                    Option-Eligible Brokerage & IRA Accounts in Your Vault
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    Tip: Roth/Traditional IRAs allow Level 1–2 CCs & CSPs with 0% short-term tax drag
                  </span>
                </div>
                {analysis.brokerageAccounts.length === 0 ? (
                  <div className="text-xs text-zinc-500">
                    No brokerage or IRA accounts found yet. Add them in the Accounts tab.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] tabular-nums">
                      <thead>
                        <tr className="border-b border-zinc-800 text-[10px] uppercase text-zinc-500">
                          <th className="py-1.5 pr-3">Account</th>
                          <th className="py-1.5 pr-3">Tax Bucket</th>
                          <th className="py-1.5 pr-3 text-right">Total Balance</th>
                          <th className="py-1.5 pr-3 text-right">Deployable Cash</th>
                          <th className="py-1.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/70">
                        {analysis.brokerageAccounts.map((a) => (
                          <tr key={a.id}>
                            <td className="py-2 pr-3 font-medium text-zinc-200">
                              {a.name}{' '}
                              <span className="text-[10px] text-zinc-500">({a.ownerLabel})</span>
                            </td>
                            <td className="py-2 pr-3">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] ${
                                  a.taxTreatment.isTaxAdvantaged
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : 'bg-zinc-800 text-zinc-300'
                                }`}
                              >
                                {a.taxTreatment.label}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right font-mono text-zinc-200">
                              {mask(formatCurrency(a.totalBalance, { decimals: 0 }))}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono text-emerald-300">
                              {mask(formatCurrency(a.deployableCash, { decimals: 0 }))}
                            </td>
                            <td className="py-2 text-[10px] text-zinc-400">
                              {a.isEmployerStockPlan
                                ? `Employer Stock Plan (${mask(
                                    formatCurrency(a.explicitCash, { decimals: 0 })
                                  )} cash sweep — options restricted)`
                                : a.hasHoldings
                                ? `${a.holdingsCount} ticker lot(s) tracked`
                                : 'Flat balance (verify cash vs invested in Accounts)'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* B. COVERED CALL DESK (EXISTING ELIGIBLE 100-SHARE LOTS) */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-5 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">
                  Covered Call Opportunities (Your Eligible 100-Share Lots)
                </h2>
                <p className="text-xs text-zinc-400">
                  Sell OTM calls only at strikes above your cost basis where you are genuinely happy selling shares.
                </p>
              </div>
              <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[10px] text-zinc-400">
                Target: {Math.round(analysis.risk.targetDelta * 100)}Δ • {analysis.risk.defaultDte} DTE • Skip earnings weeks
              </span>
            </div>

            {analysis.ccSuggestions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-400 space-y-1.5">
                <div className="font-medium text-zinc-200">
                  No non-restricted 100-share lots currently eligible for Covered Calls
                </div>
                <p className="text-[11px]">
                  Once you hold 100+ shares of a non-employer stock or ETF (like <strong>SPLG</strong>, <strong>SCHD</strong>, or <strong>QQQM</strong> — either bought directly or assigned via a Cash-Secured Put below), exact strike, premium, and roll-trigger suggestions appear here automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {analysis.ccSuggestions.map((lot) => (
                  <div
                    key={lot.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/45 p-3.5 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-zinc-100">
                          {lot.symbol}
                        </span>
                        <span className="rounded bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-200">
                          {lot.contracts} contract{lot.contracts === 1 ? '' : 's'} max (suggest {lot.suggestedContracts}x)
                        </span>
                        <span className="text-[11px] text-zinc-400">
                          {lot.accountName} • {lot.taxTreatment.label}
                        </span>
                        {lot.belowBasisWarning && (
                          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                            Market below cost basis ({mask(formatCurrency(lot.costBasis))}) — avoid locking in a loss
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 tabular-nums">
                        <span>
                          Spot: <strong className="font-mono text-zinc-200">${lot.spot.toFixed(2)}</strong>
                        </span>
                        <span>
                          Suggested Call:{' '}
                          <strong className="font-mono text-emerald-300">
                            ${lot.suggestedStrike} ({lot.dte}d • ~{Math.round(Math.abs(lot.delta) * 100)}Δ)
                          </strong>
                        </span>
                        <span>
                          Est. Credit:{' '}
                          <strong className="font-mono text-zinc-100">
                            ${lot.estPremiumPerShare.toFixed(2)}/sh ({mask(formatCurrency(lot.estCyclePremiumTotal, { decimals: 0 }))} full)
                          </strong>
                        </span>
                        <span>
                          Ann. Yield:{' '}
                          <strong className="font-mono text-cyan-300">{lot.annualizedYieldPct}%</strong>
                        </span>
                        <span>
                          Roll Trigger:{' '}
                          <strong className="font-mono text-amber-300">${lot.rollTriggerPrice}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          openTrackFromSuggestion({
                            strategy: 'cc',
                            accountId: lot.accountId,
                            symbol: lot.symbol,
                            contracts: lot.suggestedContracts,
                            strike: lot.suggestedStrike,
                            premium: lot.estPremiumPerShare,
                            costBasis: lot.costBasis,
                            dte: lot.dte,
                          })
                        }
                        className="rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25"
                      >
                        Track CC
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          openInRollLab({
                            strategy: 'cc',
                            symbol: lot.symbol,
                            contracts: lot.suggestedContracts,
                            spot: lot.spot,
                            strike: lot.suggestedStrike,
                            premium: lot.estPremiumPerShare,
                            dte: 10,
                            costBasis: lot.costBasis,
                            isTaxAdvantaged: lot.taxTreatment.isTaxAdvantaged,
                            simulateAdverseMove: true,
                          })
                        }
                        className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-200 hover:bg-amber-500/20"
                      >
                        Test Roll
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {analysis.restrictedLots.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span>
                  <strong>Compliance Guardrail Active:</strong> Excluded{' '}
                  {analysis.restrictedLots
                    .map((r) => `${r.symbol} (${r.shares} sh in ${r.accountName})`)
                    .join(', ')}{' '}
                  from Covered Calls to avoid violating employer insider-trading / no-hedging policies.
                </span>
              </div>
            )}
          </div>

          {/* C. CASH-SECURED PUT (CSP) & WHEEL CANDIDATE DESK */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">
                  Cash-Secured Put (CSP) & Wheel Candidates
                </h2>
                <p className="text-xs text-zinc-400">
                  Only sell CSPs on ETFs or blue-chips you are happy owning long-term if assigned. Collateral kept in Treasury MMF earns ~4.2% simultaneously.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-[11px]">
                  {[
                    { key: 'fits', label: 'Fits My Budget' },
                    { key: 'etf', label: 'ETFs Only (Safest)' },
                    { key: 'all', label: 'All Universe' },
                  ].map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setCspFilter(f.key)}
                      className={`rounded-md px-2.5 py-1 font-medium transition ${
                        cspFilter === f.key
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  placeholder="Add tickers (e.g. AVGO, VTI)"
                  value={customWatchlist}
                  onChange={(e) => {
                    setCustomWatchlist(e.target.value.toUpperCase());
                    setPrefsDirty(true);
                  }}
                  className="w-44 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-[11px] uppercase text-zinc-100"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-zinc-800 text-[10px] uppercase text-zinc-500">
                    <th className="py-2 pr-3">Ticker & Profile</th>
                    <th className="py-2 pr-3 text-right">Spot</th>
                    <th className="py-2 pr-3 text-right">Suggested CSP</th>
                    <th className="py-2 pr-3 text-right">Collateral / 1x</th>
                    <th className="py-2 pr-3 text-right">Est. Credit & Yield</th>
                    <th className="py-2 pr-3 text-right">Effective Entry</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {visibleCspCandidates.map((c) => (
                    <tr key={c.symbol} className="hover:bg-zinc-900/35">
                      <td className="py-3 pr-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-zinc-100">
                            {c.symbol}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                              c.kind === 'etf'
                                ? 'bg-sky-500/15 text-sky-300'
                                : c.riskTier === 'medium'
                                ? 'bg-amber-500/15 text-amber-300'
                                : 'bg-zinc-800 text-zinc-300'
                            }`}
                          >
                            {c.kind === 'etf' ? 'ETF' : c.riskTier === 'medium' ? 'Med Risk' : 'Blue Chip'}
                          </span>
                          {!c.fitsRiskCap && c.maxContractsByBudget === 0 && (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">
                              Use Credit Spread
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[10px] text-zinc-500">{c.note}</div>
                      </td>

                      <td className="py-3 pr-3 text-right font-mono text-zinc-200">
                        ${c.spot.toFixed(2)}
                        <div className="text-[9px] text-zinc-500">
                          {c.isLiveQuote ? 'Live' : 'Est.'} • IV ~{Math.round(c.typicalIv * 100)}%
                        </div>
                      </td>

                      <td className="py-3 pr-3 text-right font-mono">
                        <div className="font-semibold text-emerald-300">${c.strike} Put</div>
                        <div className="text-[10px] text-zinc-500">
                          {c.dte}d • ~{Math.round(Math.abs(c.delta) * 100)}Δ ({c.probOtmPct}% OTM)
                        </div>
                      </td>

                      <td className="py-3 pr-3 text-right font-mono">
                        <div className="text-zinc-200">
                          {mask(formatCurrency(c.collateralPerContract, { decimals: 0 }))}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {c.maxContractsBySleeve > 0
                            ? `Fits ${c.maxContractsBySleeve}x in CSP sleeve`
                            : c.maxContractsByBudget > 0
                            ? `Fits ${c.maxContractsByBudget}x total`
                            : `Spread risk: ${mask(
                                formatCurrency(c.spreadAlternative.maxRiskPerContract, {
                                  decimals: 0,
                                })
                              )}`}
                        </div>
                      </td>

                      <td className="py-3 pr-3 text-right font-mono">
                        <div className="font-semibold text-cyan-300">
                          ${c.estPremiumPerShare.toFixed(2)}{' '}
                          <span className="text-[10px] font-normal text-zinc-400">
                            (${c.estPremiumPerContract})
                          </span>
                        </div>
                        <div className="text-[10px] text-emerald-300">
                          {c.annualizedOptYieldPct}% opt • {c.doubleDipAnnualYieldPct}% w/ T-Bill
                        </div>
                      </td>

                      <td className="py-3 pr-3 text-right font-mono">
                        <div className="text-zinc-200">${c.effectiveEntry.toFixed(2)}</div>
                        <div className="text-[10px] text-zinc-500">
                          -{c.discountBelowSpotPct}% vs spot
                        </div>
                      </td>

                      <td className="py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              openTrackFromSuggestion({
                                strategy: 'csp',
                                accountId: analysis.brokerageAccounts[0]?.id,
                                symbol: c.symbol,
                                contracts: Math.max(1, Math.min(2, c.maxContractsBySleeve || 1)),
                                strike: c.strike,
                                premium: c.estPremiumPerShare,
                                dte: c.dte,
                              })
                            }
                            className="rounded-md border border-emerald-500/35 bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-200 hover:bg-emerald-500/25"
                          >
                            Track
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openInRollLab({
                                strategy: 'csp',
                                symbol: c.symbol,
                                contracts: 1,
                                spot: c.spot,
                                strike: c.strike,
                                premium: c.estPremiumPerShare,
                                dte: 12,
                                simulateAdverseMove: true,
                              })
                            }
                            className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-200 hover:bg-amber-500/20"
                          >
                            Roll Sim
                          </button>
                          {onAskAdvisor && (
                            <button
                              type="button"
                              onClick={() =>
                                onAskAdvisor(
                                  `Evaluate selling a ${c.dte}-day Cash-Secured Put on ${c.symbol} (spot ~$${c.spot.toFixed(
                                    2
                                  )}, ~$${c.strike} strike, collateral ${formatCurrency(
                                    c.collateralPerContract,
                                    { decimals: 0 }
                                  )}) vs a $${c.spreadAlternative.shortStrike}/$${
                                    c.spreadAlternative.longStrike
                                  } Put Credit Spread. Check earnings risk, position sizing vs our brokerage cash, and roll/exit triggers.`
                                )
                              }
                              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 hover:border-emerald-500/40"
                            >
                              Ask CFO
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* D. OTHER LOW-TO-MEDIUM RISK CAPITAL STRATEGIES */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-5 space-y-3.5">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Beyond CCs & CSPs — Other Low-to-Medium Risk Ways to Put Capital to Work
              </h2>
              <p className="text-xs text-zinc-400">
                Complementary strategies matched to your tax bracket, liquidity needs, and risk profile.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-sky-200">
                    1. T-Bill Ladder & Double-Dip Collateral
                  </span>
                  <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">
                    Very Low Risk
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Hold 4-week / 13-week US Treasury Bills or Treasury-only ETFs/MMFs (<strong>SGOV</strong>, <strong>USFR</strong>, <strong>FDLXX</strong>, <strong>VUSXX</strong>).{' '}
                  {analysis.isStateIncomeTaxFree
                    ? 'Earns ~4.2% risk-free while securing CSPs.'
                    : `In ${analysis.stateCode || 'high-tax states'}, Treasury interest is exempt from state income tax — ~4.2% T-Bills equal ~${analysis.tbillTaxEquivHysaPct}% taxable bank HYSA!`}
                  {analysis.activePromos.length > 0
                    ? ` Time T-Bill maturities 7 days before your 0% promo payoff dates (${formatCurrency(
                        analysis.totalPromoBalance,
                        { decimals: 0 }
                      )} total).`
                    : ''}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-200">
                    2. Defined-Risk Put Credit Spreads
                  </span>
                  <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    Low–Medium Risk
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Want index exposure on <strong>SPY</strong> or <strong>MSFT</strong> without locking up $43k–$60k? Sell a 20Δ put and simultaneously buy a protective put $5–$10 lower. Caps your worst-case loss strictly (e.g., $400–$850 max risk per contract) and frees 80%+ of your cash for T-Bills.
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-violet-200">
                    3. The Wheel on Quality Index ETFs
                  </span>
                  <span className="rounded bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                    Low–Medium Risk
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Sell 20Δ CSPs on <strong>SPLG</strong> (~$7k) or <strong>SCHD</strong> (~$2.9k). If un-assigned, keep the premium + T-Bill interest. If assigned during a pullback, you simply own the S&P 500 or Dividend ETF at a discount — then sell 25Δ Covered Calls above your cost basis until called away.
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-200">
                    4. Tax-Location & Index DCA Pairing
                  </span>
                  <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    Tax Alpha
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Run active CCs/CSPs inside a <strong>Roth IRA / Traditional IRA</strong> first (0% short-term cap gains tax). In taxable accounts, pair core index DCA (<strong>VOO ↔ IVV ↔ SPLG</strong>) for clean tax-loss harvesting without wash sales — and use any capital loss carryforward to shield taxable option gains.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 2: ROLL VS. TAKE-LOSS RESCUE LAB                            */}
      {/* =================================================================== */}
      {subTab === 'roll_lab' && (
        <div className="space-y-5">
          {/* Presets & Input Panel */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">
                  Roll vs. Assignment vs. Take-Loss Decision Lab
                </h2>
                <p className="text-xs text-zinc-400">
                  When a stock rallies through your Covered Call or drops below your Cash-Secured Put, compare rolling, taking assignment, or cutting the loss side-by-side.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {ROLL_PRESETS.map((pr) => (
                  <button
                    key={pr.key}
                    type="button"
                    onClick={() => setRollForm(pr.values)}
                    className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[10px] font-medium text-zinc-300 hover:border-amber-500/40 hover:text-amber-200"
                  >
                    {pr.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Strategy Toggle + Live Price / Model Estimator */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/80 pt-3">
              <div className="inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setRollForm((p) => ({ ...p, strategy: 'csp' }))}
                  className={`rounded-lg px-3 py-1 font-medium transition ${
                    rollForm.strategy === 'csp'
                      ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Cash-Secured Put (Short Put)
                </button>
                <button
                  type="button"
                  onClick={() => setRollForm((p) => ({ ...p, strategy: 'cc' }))}
                  className={`rounded-lg px-3 py-1 font-medium transition ${
                    rollForm.strategy === 'cc'
                      ? 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/40'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Covered Call (Short Call)
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={Boolean(rollForm.isTaxAdvantaged)}
                    onChange={(e) =>
                      setRollForm((p) => ({ ...p, isTaxAdvantaged: e.target.checked }))
                    }
                    className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900"
                  />
                  <span>Inside Roth / Trad IRA (0% tax)</span>
                </label>

                <button
                  type="button"
                  onClick={handleAutoEstimateRollPrices}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/35 bg-sky-500/15 px-3 py-1.5 text-[11px] font-medium text-sky-200 hover:bg-sky-500/25"
                >
                  <Scale className="h-3.5 w-3.5" />
                  Auto-Estimate BTC & Roll Prices
                </button>
              </div>
            </div>

            {/* Current Position + Proposed Roll Grid */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Current Position */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                <div className="text-xs font-semibold text-zinc-200">
                  Current Open Trade (What Went Out of the Way)
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-xs">
                  <label className="block text-zinc-400">
                    <div className="flex items-center justify-between text-[11px]">
                      <span>Ticker</span>
                      {rollForm.symbol && (
                        <button
                          type="button"
                          onClick={handleFetchRollSpot}
                          className="text-[10px] text-sky-300 hover:underline"
                        >
                          {fetchingRollPrice ? '…' : 'Live Spot'}
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={rollForm.symbol}
                      onChange={(e) =>
                        setRollForm((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))
                      }
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs uppercase text-zinc-100"
                    />
                  </label>

                  <label className="block text-zinc-400">
                    <span className="text-[11px]">Current Spot ($)</span>
                    <input
                      type="number"
                      step="0.01"
                      value={rollForm.spot}
                      onChange={(e) => setRollForm((p) => ({ ...p, spot: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </label>

                  <label className="block text-zinc-400">
                    <span className="text-[11px]">Contracts</span>
                    <input
                      type="number"
                      min="1"
                      value={rollForm.contracts}
                      onChange={(e) => setRollForm((p) => ({ ...p, contracts: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </label>

                  <label className="block text-zinc-400">
                    <span className="text-[11px]">Original Strike ($)</span>
                    <input
                      type="number"
                      step="0.5"
                      value={rollForm.currentStrike}
                      onChange={(e) =>
                        setRollForm((p) => ({ ...p, currentStrike: e.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </label>

                  <label className="block text-zinc-400">
                    <span className="text-[11px]">Credit Received ($/sh)</span>
                    <input
                      type="number"
                      step="0.05"
                      value={rollForm.originalPremium}
                      onChange={(e) =>
                        setRollForm((p) => ({ ...p, originalPremium: e.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </label>

                  <label className="block text-zinc-400">
                    <span className="text-[11px]">Buy-to-Close Cost ($/sh)</span>
                    <input
                      type="number"
                      step="0.05"
                      value={rollForm.currentBtcCost}
                      onChange={(e) =>
                        setRollForm((p) => ({ ...p, currentBtcCost: e.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-rose-200"
                    />
                  </label>

                  <label className="block text-zinc-400">
                    <span className="text-[11px]">Days Left (DTE)</span>
                    <input
                      type="number"
                      min="0"
                      value={rollForm.currentDte}
                      onChange={(e) => setRollForm((p) => ({ ...p, currentDte: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </label>

                  {rollForm.strategy === 'cc' && (
                    <label className="block text-zinc-400 col-span-2">
                      <span className="text-[11px]">Stock Cost Basis ($/sh)</span>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Your share purchase basis"
                        value={rollForm.costBasis}
                        onChange={(e) => setRollForm((p) => ({ ...p, costBasis: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Proposed Roll Target */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200">
                    Proposed Roll Target ({rollForm.strategy === 'cc' ? 'Up & Out' : 'Down & Out'})
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400">
                    Intrinsic: ${rollVerdict.intrinsic.toFixed(2)} • Extrinsic left: $
                    {rollVerdict.extrinsicLeft.toFixed(2)}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                  <label className="block text-zinc-400">
                    <span className="text-[11px]">New Roll Strike ($)</span>
                    <input
                      type="number"
                      step="0.5"
                      value={rollForm.newStrike}
                      onChange={(e) => setRollForm((p) => ({ ...p, newStrike: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </label>

                  <label className="block text-zinc-400">
                    <span className="text-[11px]">New Expiration (DTE)</span>
                    <input
                      type="number"
                      min="1"
                      value={rollForm.newDte}
                      onChange={(e) => setRollForm((p) => ({ ...p, newDte: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </label>

                  <label className="block text-zinc-400">
                    <span className="text-[11px]">New Option Credit ($/sh)</span>
                    <input
                      type="number"
                      step="0.05"
                      value={rollForm.newPremium}
                      onChange={(e) => setRollForm((p) => ({ ...p, newPremium: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-emerald-200"
                    />
                  </label>
                </div>

                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3 py-2 text-[11px] text-zinc-400">
                  Tip: Type your broker&apos;s exact live bid/ask into <strong>Buy-to-Close</strong> and{' '}
                  <strong>New Option Credit</strong>, or click <strong>Auto-Estimate</strong> above to test a realistic Black-Scholes roll immediately.
                </div>
              </div>
            </div>

            {/* QUANTITATIVE VERDICT BANNER */}
            <div
              className={`rounded-xl border p-4 space-y-2 ${
                rollVerdict.verdictTone === 'emerald'
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : rollVerdict.verdictTone === 'sky'
                  ? 'border-sky-500/40 bg-sky-500/10'
                  : rollVerdict.verdictTone === 'rose'
                  ? 'border-rose-500/40 bg-rose-500/10'
                  : 'border-amber-500/40 bg-amber-500/10'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
                  <ArrowRightLeft className="h-4 w-4 text-emerald-400" />
                  <span>Verdict: {rollVerdict.verdictBadge}</span>
                </div>
                {onAskAdvisor && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskAdvisor(
                        `Help me decide whether to roll, accept assignment, or close for a loss on my ${rollForm.contracts}x ${rollForm.symbol} ${
                          rollForm.strategy === 'cc' ? 'Covered Call' : 'Cash-Secured Put'
                        }. Current spot: $${rollForm.spot}, strike: $${rollForm.currentStrike}, original credit: $${rollForm.originalPremium}/sh, ${rollForm.currentDte} DTE left, BTC cost: $${rollForm.currentBtcCost}/sh. Proposed roll: $${rollForm.newStrike} strike (${rollForm.newDte} DTE) for $${rollForm.newPremium}/sh (net roll ${
                          rollVerdict.roll.netRollDollars >= 0 ? '+' : ''
                        }$${rollVerdict.roll.netRollDollars}). Factor in our capital loss carryforward, wash-sale rules, and opportunity cost.`
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-1 text-[11px] font-medium text-zinc-200 hover:border-emerald-500/50"
                  >
                    <Sparkles className="h-3 w-3 text-emerald-400" />
                    Ask Claude CFO About This Trade
                  </button>
                )}
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-200">
                {rollVerdict.reasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>

            {/* 3-PATH SIDE-BY-SIDE COMPARISON */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs tabular-nums">
              {/* PATH A: ROLL */}
              <div
                className={`rounded-xl border p-4 space-y-2 ${
                  rollVerdict.recommendedPath === 'roll'
                    ? 'border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                    : 'border-zinc-800 bg-zinc-900/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-100">
                    Path A: Roll {rollVerdict.isCall ? 'Up & Out' : 'Down & Out'}
                  </span>
                  {rollVerdict.recommendedPath === 'roll' && (
                    <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-950">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-[11px] text-zinc-300">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Net Roll Cash Flow:</span>
                    <span
                      className={`font-mono font-semibold ${
                        rollVerdict.roll.netRollDollars >= 0 ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {rollVerdict.roll.netRollDollars >= 0 ? '+' : ''}
                      {mask(formatCurrency(rollVerdict.roll.netRollDollars, { decimals: 0 }))} (
                      {rollVerdict.roll.netRollPerShare >= 0 ? '+' : ''}$
                      {rollVerdict.roll.netRollPerShare.toFixed(2)}/sh)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Strike Improvement:</span>
                    <span className="font-mono text-zinc-200">
                      {rollVerdict.roll.strikeImprovementDollars >= 0 ? '+' : ''}
                      {mask(formatCurrency(rollVerdict.roll.strikeImprovementDollars, { decimals: 0 }))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Extra Capital Time:</span>
                    <span className="font-mono text-zinc-200">+{rollVerdict.addedDays} days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Roll Ann. Yield:</span>
                    <span className="font-mono text-cyan-300">
                      {rollVerdict.roll.rollAnnualizedYieldPct}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">New Breakeven:</span>
                    <span className="font-mono text-zinc-100">
                      ${rollVerdict.roll.newBreakeven.toFixed(2)}/sh
                    </span>
                  </div>
                </div>
              </div>

              {/* PATH B: ASSIGNMENT / WHEEL */}
              <div
                className={`rounded-xl border p-4 space-y-2 ${
                  rollVerdict.recommendedPath === 'assign'
                    ? 'border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-500/30'
                    : 'border-zinc-800 bg-zinc-900/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-100">
                    Path B: {rollVerdict.isCall ? 'Let Called Away' : 'Take Shares (Wheel)'}
                  </span>
                  {rollVerdict.recommendedPath === 'assign' && (
                    <span className="rounded bg-sky-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-950">
                      Recommended
                    </span>
                  )}
                </div>

                {rollVerdict.isCall ? (
                  <div className="space-y-1 text-[11px] text-zinc-300">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Total Realized Profit:</span>
                      <span
                        className={`font-mono font-semibold ${
                          rollVerdict.assign.totalRealizedDollars >= 0
                            ? 'text-emerald-300'
                            : 'text-rose-300'
                        }`}
                      >
                        {rollVerdict.assign.totalRealizedDollars >= 0 ? '+' : ''}
                        {mask(formatCurrency(rollVerdict.assign.totalRealizedDollars, { decimals: 0 }))}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Cash Freed:</span>
                      <span className="font-mono text-zinc-200">
                        {mask(formatCurrency(rollVerdict.assign.cashFreed, { decimals: 0 }))}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Shielded by Loss CF:</span>
                      <span className="font-mono text-emerald-300">
                        {mask(formatCurrency(rollVerdict.assign.shieldedByLoss, { decimals: 0 }))}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Est. Tax Due:</span>
                      <span className="font-mono text-zinc-200">
                        {mask(formatCurrency(rollVerdict.assign.estTaxDue, { decimals: 0 }))}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Capped Upside Above K:</span>
                      <span className="font-mono text-zinc-400">
                        {mask(formatCurrency(rollVerdict.assign.opportunityCostMissed, { decimals: 0 }))}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 text-[11px] text-zinc-300">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Net Entry Cost Basis:</span>
                      <span className="font-mono font-semibold text-zinc-100">
                        ${rollVerdict.assign.effectiveEntryPerShare.toFixed(2)}/sh
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Cash Used to Buy Shares:</span>
                      <span className="font-mono text-zinc-200">
                        {mask(formatCurrency(rollVerdict.assign.totalCashRequired, { decimals: 0 }))}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Immediate Paper P&L:</span>
                      <span
                        className={`font-mono ${
                          rollVerdict.assign.paperDrawdownDollars >= 0
                            ? 'text-emerald-300'
                            : 'text-amber-300'
                        }`}
                      >
                        {rollVerdict.assign.paperDrawdownDollars >= 0 ? '+' : ''}
                        {mask(formatCurrency(rollVerdict.assign.paperDrawdownDollars, { decimals: 0 }))} (
                        {rollVerdict.assign.paperDrawdownPct}%)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Next Wheel Call (${rollVerdict.assign.wheelCcStrike}):</span>
                      <span className="font-mono text-emerald-300">
                        ~+{mask(formatCurrency(rollVerdict.assign.wheelCcEstPremium, { decimals: 0 }))}/35d
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* PATH C: CLOSE & TAKE LOSS */}
              <div
                className={`rounded-xl border p-4 space-y-2 ${
                  rollVerdict.recommendedPath === 'close'
                    ? 'border-rose-500/50 bg-rose-500/10 ring-1 ring-rose-500/30'
                    : 'border-zinc-800 bg-zinc-900/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-100">
                    Path C: {rollVerdict.close.isClosingAtLoss ? 'Close & Take Loss' : 'Close & Lock Profit'}
                  </span>
                  {rollVerdict.recommendedPath === 'close' && (
                    <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-950">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-[11px] text-zinc-300">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Realized Net P&L:</span>
                    <span
                      className={`font-mono font-semibold ${
                        rollVerdict.close.closeNetPnlDollars >= 0 ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {rollVerdict.close.closeNetPnlDollars >= 0 ? '+' : ''}
                      {mask(formatCurrency(rollVerdict.close.closeNetPnlDollars, { decimals: 0 }))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Est. Tax Shield Value:</span>
                    <span className="font-mono text-emerald-300">
                      +{mask(formatCurrency(rollVerdict.close.estTaxSavings, { decimals: 0 }))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Freed Collateral:</span>
                    <span className="font-mono text-zinc-200">
                      {mask(formatCurrency(rollVerdict.close.freedCapital, { decimals: 0 }))}
                    </span>
                  </div>
                  {rollVerdict.close.isClosingAtLoss && (
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Est. Recovery Cycles (20Δ):</span>
                      <span className="font-mono text-zinc-200">
                        ~{rollVerdict.close.cyclesToRecover} cycles
                      </span>
                    </div>
                  )}
                </div>
                {rollVerdict.close.isClosingAtLoss && !rollForm.isTaxAdvantaged && (
                  <div className="rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
                    Wash-Sale Rule: Avoid re-opening a substantially identical contract on {rollForm.symbol || 'this ticker'} within 30 days (including in an IRA).
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 5 GOLDEN MECHANICAL RISK-MANAGEMENT RULES */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <BookOpen className="h-4 w-4 text-amber-400" />
              Low–Medium Risk Mechanical Playbook (When to Roll vs. Cut Loss)
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5 text-[11px]">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-1">
                <div className="font-semibold text-emerald-300">1. Take Profit at 50%</div>
                <p className="text-zinc-400">
                  Set a GTC Buy-to-Close limit order at 50% of initial credit immediately after opening. Cuts tail risk in half.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-1">
                <div className="font-semibold text-sky-300">2. Manage at 21 DTE</div>
                <p className="text-zinc-400">
                  Close or roll out to 35–45 DTE once 21 days remain — avoids steep final-week gamma spikes & early dividend assignment.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-1">
                <div className="font-semibold text-cyan-300">3. Roll for Credit Only</div>
                <p className="text-zinc-400">
                  Only roll when you collect a <strong>net credit</strong> (≥8% annualized on added days) AND improve strike or buy breathing room.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-1">
                <div className="font-semibold text-rose-300">4. Cut Broken Theses</div>
                <p className="text-zinc-400">
                  If a stock drops 15%+ on bad earnings/fundamentals or loss hits 2× credit with no credit roll, <strong>take the loss</strong> & redeploy into a clean ETF.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-1">
                <div className="font-semibold text-amber-300">5. Skip Earnings Weeks</div>
                <p className="text-zinc-400">
                  Never sell single-stock CCs/CSPs across quarterly earnings — use index ETFs (SPLG, SCHD, QQQM) for steady, shock-free income.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 3: ACTIVE POSITIONS TRACKER (AAL2 RLS)                      */}
      {/* =================================================================== */}
      {subTab === 'positions' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-4">
            <div className="flex flex-wrap items-center gap-5 text-xs tabular-nums">
              <div>
                <div className="text-[10px] text-zinc-500">Open Positions</div>
                <div className="font-mono text-base font-semibold text-zinc-100">
                  {openPositions.length}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500">Active Collateral</div>
                <div className="font-mono text-base font-semibold text-sky-300">
                  {mask(formatCurrency(analysis.committedOptionCollateral, { decimals: 0 }))}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500">Open Premium Collected</div>
                <div className="font-mono text-base font-semibold text-emerald-300">
                  +{mask(formatCurrency(openCreditTotal, { decimals: 0 }))}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500">Realized P&L (Logged)</div>
                <div
                  className={`font-mono text-base font-semibold ${
                    realizedYtdPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {realizedYtdPnl >= 0 ? '+' : ''}
                  {mask(formatCurrency(realizedYtdPnl, { decimals: 0 }))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAddPos(!showAddPos)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              <Plus className="h-3.5 w-3.5" />
              {showAddPos ? 'Close Form' : 'Log Option Trade'}
            </button>
          </div>

          {/* LOG NEW OPTION POSITION FORM */}
          {showAddPos && (
            <form
              onSubmit={handleAddPosition}
              className="rounded-2xl border border-emerald-500/30 bg-zinc-950/80 p-5 space-y-3.5 text-xs"
            >
              <div className="font-semibold text-emerald-200">
                Log Active Covered Call, Cash-Secured Put, or Credit Spread (Saved under AAL2 RLS)
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="block text-zinc-300">
                  <span className="text-[11px]">Account</span>
                  <select
                    value={newPos.account_id}
                    onChange={(e) => setNewPos((p) => ({ ...p, account_id: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100"
                  >
                    <option value="">— Select Brokerage / IRA —</option>
                    {analysis.brokerageAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.taxTreatment.label})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-zinc-300">
                  <span className="text-[11px]">Strategy</span>
                  <select
                    value={newPos.strategy}
                    onChange={(e) => setNewPos((p) => ({ ...p, strategy: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100"
                  >
                    <option value="csp">Cash-Secured Put (CSP)</option>
                    <option value="cc">Covered Call (CC)</option>
                    <option value="put_spread">Put Credit Spread</option>
                  </select>
                </label>

                <label className="block text-zinc-300">
                  <span className="text-[11px]">Ticker *</span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. SPLG, SCHD"
                    value={newPos.symbol}
                    onChange={(e) =>
                      setNewPos((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))
                    }
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs uppercase text-zinc-100"
                  />
                  {newPos.symbol &&
                    analysis.restrictedInfo.restrictedSet.has(newPos.symbol.trim().toUpperCase()) && (
                      <div className="mt-0.5 text-[10px] font-medium text-rose-300">
                        Employer-restricted ticker!
                      </div>
                    )}
                </label>

                <label className="block text-zinc-300">
                  <span className="text-[11px]">Contracts</span>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newPos.contracts}
                    onChange={(e) => setNewPos((p) => ({ ...p, contracts: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                  />
                </label>

                <label className="block text-zinc-300">
                  <span className="text-[11px]">Short Strike ($) *</span>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={newPos.strike}
                    onChange={(e) => setNewPos((p) => ({ ...p, strike: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                  />
                </label>

                {newPos.strategy === 'put_spread' ? (
                  <label className="block text-zinc-300">
                    <span className="text-[11px]">Long Protective Strike ($) *</span>
                    <input
                      type="number"
                      step="0.5"
                      required
                      value={newPos.long_strike}
                      onChange={(e) => setNewPos((p) => ({ ...p, long_strike: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </label>
                ) : (
                  <label className="block text-zinc-300">
                    <span className="text-[11px]">Stock Basis ($/sh, optional)</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="For CC gain check"
                      value={newPos.cost_basis}
                      onChange={(e) => setNewPos((p) => ({ ...p, cost_basis: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </label>
                )}

                <label className="block text-zinc-300">
                  <span className="text-[11px]">Expiration Date *</span>
                  <input
                    type="date"
                    required
                    value={newPos.expiration}
                    onChange={(e) => setNewPos((p) => ({ ...p, expiration: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                  />
                </label>

                <label className="block text-zinc-300">
                  <span className="text-[11px]">Credit Received ($/sh) *</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="e.g. 1.25"
                    value={newPos.premium_per_share}
                    onChange={(e) =>
                      setNewPos((p) => ({ ...p, premium_per_share: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <input
                  type="text"
                  placeholder="Optional trade thesis / target exit note (e.g. Close at 50% profit)"
                  value={newPos.notes}
                  onChange={(e) => setNewPos((p) => ({ ...p, notes: e.target.value }))}
                  className="flex-1 min-w-[220px] rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200"
                />
                <button
                  type="submit"
                  disabled={savingDesk}
                  className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  {savingDesk ? 'Saving…' : 'Save Trade to Vault'}
                </button>
              </div>
            </form>
          )}

          {/* OPEN POSITIONS LIST */}
          {openPositions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 p-8 text-center space-y-2">
              <div className="text-xs font-semibold text-zinc-200">
                No Active Option Positions Tracked Yet
              </div>
              <p className="mx-auto max-w-lg text-[11px] text-zinc-400">
                Click <strong>Track</strong> on any Covered Call or CSP suggestion in the Deployment Plan, or click <strong>Log Option Trade</strong> above. Active trades are monitored live for 50% profit-take, 21-DTE management, and ITM roll alerts.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {openPositions.map((pos) => {
                const badgeClass =
                  pos.alertState === 'itm' || pos.alertState === 'expired'
                    ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                    : pos.alertState === 'take_profit'
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                    : pos.alertState === 'manage'
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300';

                return (
                  <div
                    key={pos.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-sky-200">
                          {pos.strategy === 'put_spread' ? 'Put Spread' : pos.strategy.toUpperCase()}
                        </span>
                        <span className="font-mono text-sm font-bold text-zinc-100">
                          {pos.symbol}
                        </span>
                        <span className="font-mono text-zinc-300">
                          {pos.contracts}x ${pos.strike}
                          {pos.strategy === 'put_spread' && pos.long_strike > 0
                            ? `/$${pos.long_strike}`
                            : ''}{' '}
                          • Exp {formatShortDate(pos.expiration)}
                          {pos.dteLeft !== null ? ` (${pos.dteLeft}d)` : ''}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}>
                          {pos.alertLabel}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {(pos.strategy === 'cc' || pos.strategy === 'csp') && (
                          <button
                            type="button"
                            onClick={() =>
                              openInRollLab({
                                strategy: pos.strategy,
                                symbol: pos.symbol,
                                contracts: pos.contracts,
                                spot: pos.spot || pos.strike,
                                strike: pos.strike,
                                premium: pos.premium_per_share,
                                dte: Math.max(1, pos.dteLeft ?? 10),
                                costBasis: pos.cost_basis,
                                simulateAdverseMove: false,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/25"
                          >
                            <Repeat className="h-3 w-3" />
                            Roll / Rescue
                          </button>
                        )}

                        {closingPosId === pos.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              step="1"
                              placeholder={`P&L ($${Math.round(pos.totalCreditReceived)})`}
                              value={closePnlInput}
                              onChange={(e) => setClosePnlInput(e.target.value)}
                              className="w-28 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-100"
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdatePositionStatus(pos.id, 'closed', closePnlInput)}
                              className="rounded bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-zinc-950"
                            >
                              Save Close
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setClosingPosId('');
                                setClosePnlInput('');
                              }}
                              className="text-[10px] text-zinc-400"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setClosingPosId(pos.id);
                                setClosePnlInput(
                                  String(
                                    pos.estUnrealizedPnl !== null
                                      ? pos.estUnrealizedPnl
                                      : Math.round(pos.totalCreditReceived)
                                  )
                                );
                              }}
                              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-emerald-500/40"
                            >
                              Close / Expired
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdatePositionStatus(pos.id, 'assigned')}
                              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-sky-500/40"
                            >
                              Assigned
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePosition(pos.id)}
                              className="rounded-lg border border-zinc-800 p-1 text-zinc-500 hover:text-rose-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400 tabular-nums">
                      <span>{pos.accountName}</span>
                      {pos.spot > 0 && (
                        <span>
                          Live Spot:{' '}
                          <strong className="font-mono text-zinc-200">${pos.spot.toFixed(2)}</strong> (
                          {pos.moneynessPct >= 0 ? `${pos.moneynessPct}% OTM` : `${Math.abs(pos.moneynessPct)}% ITM`})
                        </span>
                      )}
                      <span>
                        Credit:{' '}
                        <strong className="font-mono text-emerald-300">
                          +${pos.premium_per_share.toFixed(2)}/sh ({mask(formatCurrency(pos.totalCreditReceived, { decimals: 0 }))})
                        </strong>
                      </span>
                      {pos.estUnrealizedPnl !== null && (
                        <span>
                          Est. Open P&L:{' '}
                          <strong
                            className={`font-mono ${
                              pos.estUnrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'
                            }`}
                          >
                            {pos.estUnrealizedPnl >= 0 ? '+' : ''}
                            {mask(formatCurrency(pos.estUnrealizedPnl, { decimals: 0 }))}
                          </strong>
                        </span>
                      )}
                      {pos.notes && <span className="italic text-zinc-500">“{pos.notes}”</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* CLOSED / ASSIGNED HISTORY */}
          {closedPositions.length > 0 && (
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-2">
              <div className="text-xs font-semibold text-zinc-300">
                Completed / Assigned Trades ({closedPositions.length})
              </div>
              <div className="space-y-1.5">
                {closedPositions.map((pos) => (
                  <div
                    key={pos.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 text-[11px] tabular-nums"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                        {pos.status}
                      </span>
                      <span className="font-mono font-semibold text-zinc-200">
                        {pos.symbol} {pos.contracts}x ${pos.strike} {pos.strategy.toUpperCase()}
                      </span>
                      <span className="text-zinc-500">Exp {formatShortDate(pos.expiration)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono font-semibold ${
                          pos.realized_pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {pos.realized_pnl >= 0 ? '+' : ''}
                        {mask(formatCurrency(pos.realized_pnl, { decimals: 0 }))}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeletePosition(pos.id)}
                        className="text-zinc-500 hover:text-rose-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
