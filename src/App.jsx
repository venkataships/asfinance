import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  LayoutDashboard,
  Wallet,
  Receipt,
  Lock,
  Eye,
  EyeOff,
  LogOut,
  RefreshCw,
  Users,
  TrendingUp,
  Pencil,
  X,
  Check,
  Sparkles,
  Briefcase,
  CalendarClock,
  Target,
  Sun,
  Moon,
  Compass,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { seedDemoVaultData } from './lib/demoSeed';
import {
  computeRealAssetLiveBalance,
  filterByHouseholdScope,
  formatCurrency,
  getRealAssetType,
  todayIsoDate,
  toNumber,
} from './lib/finance';
import {
  computePendingPayrollBatch,
  daysBetweenIso,
  executePayrollSyncBatch,
  formatShortDate,
} from './lib/payrollSync';
import { normalizeOptionsDesk } from './lib/optionsDeskSchema';
import {
  isPersistedScreenLocked,
  loadLockSettings,
  saveLockSettings,
  setPersistedScreenLocked,
} from './lib/screenLock';
import { applyTheme, loadTheme, saveTheme } from './lib/theme';
import AuthVaultGate from './components/AuthVaultGate';
import VaultLockScreen from './components/VaultLockScreen';
import OverviewTab from './components/OverviewTab';
import AccountsTab from './components/AccountsTab';
import ExpensesTab from './components/ExpensesTab';
import AdvisorTab from './components/AdvisorTab';
import PaystubProfileCard from './components/PaystubProfileCard';
import ActionableInsightsDashboard, {
  buildActionableInsights,
} from './components/ActionableInsightsDashboard';
import CapitalDeskTab from './components/CapitalDeskTab';
import SecurityTab from './components/SecurityTab';

function AuthenticatedVault({
  session,
  aalLevel,
  hasMfaEnrolled,
  verifiedTotpFactors,
  refreshAuthStatus,
  onSignOut,
}) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'insights' | 'accounts' | 'income' | 'expenses' | 'advisor' | 'security'
  const [accountCategoryFilter, setAccountCategoryFilter] = useState('all');
  const [privacyMode, setPrivacyMode] = useState(false);
  const [theme, setTheme] = useState(() => loadTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const handleChangeTheme = useCallback((nextTheme) => {
    const saved = saveTheme(nextTheme);
    setTheme(saved);
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => saveTheme(prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // Auto-Lock & Screen Lock state (persists across Cmd+R refresh)
  const [lockSettings, setLockSettings] = useState(() => loadLockSettings());
  const [isScreenLocked, setIsScreenLocked] = useState(() => isPersistedScreenLocked());
  const [lockReason, setLockReason] = useState(() =>
    isPersistedScreenLocked() ? 'Vault screen remained locked across refresh.' : ''
  );
  const lastActivityAtRef = useRef(Date.now());

  const triggerScreenLock = useCallback((reason = 'Locked automatically due to inactivity.') => {
    setPersistedScreenLocked(true);
    setLockReason(reason);
    setIsScreenLocked(true);
  }, []);

  const handleUnlockScreen = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    setPersistedScreenLocked(false);
    setLockReason('');
    setIsScreenLocked(false);
  }, []);

  const handleUpdateLockSettings = useCallback((nextSettings) => {
    const saved = saveLockSettings(nextSettings);
    setLockSettings(saved);
    lastActivityAtRef.current = Date.now();
  }, []);

  const handleFullSignOut = useCallback(() => {
    setPersistedScreenLocked(false);
    onSignOut();
  }, [onSignOut]);

  // Inactivity timer, wake-from-sleep wall-clock check, optional tab-hide lock, and Cmd+Shift+L shortcut
  useEffect(() => {
    if (isScreenLocked) return undefined;

    lastActivityAtRef.current = Date.now();
    let lastTouchWrite = 0;

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastTouchWrite >= 1000) {
        lastTouchWrite = now;
        lastActivityAtRef.current = now;
      }
    };

    const checkIdle = () => {
      const mins = Number(lockSettings.timeoutMinutes);
      if (mins > 0 && Date.now() - lastActivityAtRef.current >= mins * 60 * 1000) {
        triggerScreenLock(`Locked after ${mins} minute${mins === 1 ? '' : 's'} of inactivity.`);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (lockSettings.lockOnTabHide) {
          triggerScreenLock('Locked automatically when tab was hidden.');
        }
      } else {
        checkIdle();
      }
    };

    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        triggerScreenLock('Locked via keyboard shortcut (⌘⇧L).');
        return;
      }
      recordActivity();
    };

    const activityEvents = ['mousemove', 'mousedown', 'touchstart', 'scroll'];
    for (const ev of activityEvents) {
      window.addEventListener(ev, recordActivity, { passive: true });
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('focus', checkIdle);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const intervalId = window.setInterval(checkIdle, 5000);

    return () => {
      for (const ev of activityEvents) {
        window.removeEventListener(ev, recordActivity);
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('focus', checkIdle);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [isScreenLocked, lockSettings.timeoutMinutes, lockSettings.lockOnTabHide, triggerScreenLock]);

  // Household view scope ('combined' | 'primary' | 'spouse' | 'joint')
  const [householdScope, setHouseholdScope] = useState('combined');
  const [householdNames, setHouseholdNames] = useState({
    primary_name: 'Me',
    spouse_name: 'Wife',
  });
  const [namesModalOpen, setNamesModalOpen] = useState(false);
  const [draftPrimaryName, setDraftPrimaryName] = useState('Me');
  const [draftSpouseName, setDraftSpouseName] = useState('Wife');
  const [savingNames, setSavingNames] = useState(false);

  // Shared cross-tab modals
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [newAccountCategory, setNewAccountCategory] = useState(null);
  const [payTabInitialSubTab, setPayTabInitialSubTab] = useState(null);
  const [advisorInitialPrompt, setAdvisorInitialPrompt] = useState('');
  const [postingTopBannerSync, setPostingTopBannerSync] = useState(false);
  const [topSyncBannerNotice, setTopSyncBannerNotice] = useState('');
  const [topSyncBannerError, setTopSyncBannerError] = useState('');
  const [dismissedSyncBanner, setDismissedSyncBanner] = useState(false);

  // Vault Data
  const [accounts, setAccounts] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [recurringBills, setRecurringBills] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [equityHoldings, setEquityHoldings] = useState([]);
  const [creditCardPromos, setCreditCardPromos] = useState([]);
  const [taxProfile, setTaxProfile] = useState(null);
  const [activeAdvisorThreadId, setActiveAdvisorThreadId] = useState(null);

  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [seedingDemo, setSeedingDemo] = useState(false);

  // Live Stock/RSU quote refresh state
  const [quotesRefreshing, setQuotesRefreshing] = useState(false);
  const [lastQuotesSyncAt, setLastQuotesSyncAt] = useState(null);
  const [quoteStatusError, setQuoteStatusError] = useState('');
  const autoRefreshedOnOpenRef = useRef(false);

  const refreshStockPrices = useCallback(
    async (accountsList, holdingsList) => {
      const activeAccounts = (accountsList || []).filter((a) => !a.is_archived);
      const activeAccountIds = new Set(activeAccounts.map((a) => a.id));
      const activeHoldings = (holdingsList || []).filter((h) =>
        activeAccountIds.has(h.account_id)
      );

      const symbolSet = new Set(
        activeHoldings
          .map((h) => (h.symbol || '').trim().toUpperCase())
          .filter(Boolean)
      );

      const hasGoldAsset = activeAccounts.some((a) => getRealAssetType(a) === 'gold');
      const hasIndiaAsset = activeAccounts.some((a) => getRealAssetType(a) === 'india_property');
      if (hasGoldAsset) symbolSet.add('GC=F');
      if (hasIndiaAsset) symbolSet.add('INR=X');

      const uniqueSymbols = Array.from(symbolSet);
      if (uniqueSymbols.length === 0) return null;

      setQuotesRefreshing(true);
      setQuoteStatusError('');

      try {
        const { data, error } = await supabase.functions.invoke('stock-quotes', {
          body: { symbols: uniqueSymbols },
        });
        if (error) throw error;

        const quotes = data?.quotes || {};
        const nowIso = data?.fetchedAt || new Date().toISOString();
        const today = todayIsoDate();

        const updatedHoldings = (holdingsList || []).map((h) => {
          const sym = (h.symbol || '').trim().toUpperCase();
          const q = quotes[sym];
          if (!q || !Number.isFinite(Number(q.price)) || Number(q.price) <= 0) {
            return h;
          }
          return {
            ...h,
            last_price: Number(q.price),
            prev_close: Number.isFinite(Number(q.prevClose)) ? Number(q.prevClose) : h.prev_close,
            last_price_at: q.fetchedAt || nowIso,
          };
        });

        // Persist updated prices on holdings
        const holdingUpdates = updatedHoldings.filter((h, idx) => h !== holdingsList[idx]);
        if (holdingUpdates.length > 0) {
          await Promise.all(
            holdingUpdates.map((h) =>
              supabase
                .from('equity_holdings')
                .update({
                  last_price: h.last_price,
                  prev_close: h.prev_close,
                  last_price_at: h.last_price_at,
                })
                .eq('id', h.id)
            )
          );
        }

        // Recalculate account balances for:
        // 1) Equity/RSU accounts = cash_balance + sum(vested_shares * live_price)
        // 2) Live-priced Real Assets (Physical Gold via GC=F, India Property via INR=X)
        const holdingsByAccount = new Map();
        for (const h of updatedHoldings) {
          if (!holdingsByAccount.has(h.account_id)) holdingsByAccount.set(h.account_id, []);
          holdingsByAccount.get(h.account_id).push(h);
        }

        const snapshotUpserts = [];
        const updatedAccounts = (accountsList || []).map((acc) => {
          if (acc.is_archived) return acc;

          const accHoldings = holdingsByAccount.get(acc.id);
          if (accHoldings && accHoldings.length > 0) {
            const equityTotal = accHoldings.reduce(
              (sum, h) => sum + toNumber(h.shares) * toNumber(h.last_price),
              0
            );
            const nextBalance = Number((toNumber(acc.cash_balance) + equityTotal).toFixed(2));
            snapshotUpserts.push({
              account_id: acc.id,
              snapshot_date: today,
              balance: nextBalance,
              note: 'Auto stock/RSU refresh',
            });

            if (Math.abs(nextBalance - toNumber(acc.current_balance)) >= 0.01) {
              return {
                ...acc,
                current_balance: nextBalance,
                last_updated_at: nowIso,
              };
            }
            return acc;
          }

          const realAssetCalc = computeRealAssetLiveBalance(acc, quotes, nowIso);
          if (realAssetCalc) {
            snapshotUpserts.push({
              account_id: acc.id,
              snapshot_date: today,
              balance: realAssetCalc.nextBalance,
              note:
                getRealAssetType(acc) === 'gold'
                  ? 'Auto live Gold spot refresh'
                  : 'Auto live USD/INR FX refresh',
            });
            return {
              ...acc,
              current_balance: realAssetCalc.nextBalance,
              metadata: realAssetCalc.nextMetadata,
              last_updated_at: nowIso,
            };
          }

          return acc;
        });

        // Persist recalculated account balances & FX/Gold metadata
        const changedAccounts = updatedAccounts.filter(
          (acc, idx) => acc !== accountsList[idx]
        );
        if (changedAccounts.length > 0) {
          await Promise.all(
            changedAccounts.map((acc) =>
              supabase
                .from('accounts')
                .update({
                  current_balance: acc.current_balance,
                  metadata: acc.metadata || {},
                  last_updated_at: acc.last_updated_at,
                })
                .eq('id', acc.id)
            )
          );
        }

        // Upsert today's snapshot so Net Worth history reflects live market move
        if (snapshotUpserts.length > 0) {
          await supabase
            .from('balance_snapshots')
            .upsert(snapshotUpserts, { onConflict: 'account_id,snapshot_date' });
        }

        setEquityHoldings(updatedHoldings);
        setAccounts(updatedAccounts);
        setSnapshots((prevSnaps) => {
          const next = [...prevSnaps];
          for (const up of snapshotUpserts) {
            const idx = next.findIndex(
              (s) => s.account_id === up.account_id && s.snapshot_date === up.snapshot_date
            );
            if (idx >= 0) {
              next[idx] = { ...next[idx], balance: up.balance, note: up.note };
            } else {
              next.push({ id: `temp-${up.account_id}-${up.snapshot_date}`, ...up });
            }
          }
          return next;
        });

        setLastQuotesSyncAt(nowIso);
        return quotes;
      } catch (err) {
        setQuoteStatusError(err?.message || 'Live quote refresh failed');
        return null;
      } finally {
        setQuotesRefreshing(false);
      }
    },
    []
  );

  const loadAllData = useCallback(
    async ({ refreshQuotes = false } = {}) => {
      setLoadError('');
      try {
        const [accRes, snapRes, expRes, billRes, budRes, settingsRes, holdRes, promoRes, taxRes] =
          await Promise.all([
            supabase.from('accounts').select('*').order('id', { ascending: true }),
            supabase
              .from('balance_snapshots')
              .select('*')
              .order('snapshot_date', { ascending: true }),
            supabase
              .from('expenses')
              .select('*')
              .order('expense_date', { ascending: false })
              .limit(2000),
            supabase.from('recurring_bills').select('*').order('due_day', { ascending: true }),
            supabase.from('monthly_budgets').select('*'),
            supabase.from('household_settings').select('*').maybeSingle(),
            supabase.from('equity_holdings').select('*').order('id', { ascending: true }),
            supabase.from('credit_card_promos').select('*').order('expires_on', { ascending: true }),
            supabase.from('tax_comp_profiles').select('*').maybeSingle(),
          ]);

        if (accRes.error) throw accRes.error;
        if (snapRes.error) throw snapRes.error;
        if (expRes.error) throw expRes.error;
        if (billRes.error) throw billRes.error;
        if (budRes.error) throw budRes.error;
        if (settingsRes.error) throw settingsRes.error;
        if (holdRes.error) throw holdRes.error;
        if (promoRes.error) throw promoRes.error;
        if (taxRes.error) throw taxRes.error;

        const loadedAccounts = accRes.data || [];
        const loadedHoldings = holdRes.data || [];

        setAccounts(loadedAccounts);
        setSnapshots(snapRes.data || []);
        setExpenses(expRes.data || []);
        setRecurringBills(billRes.data || []);
        setBudgets(budRes.data || []);
        setEquityHoldings(loadedHoldings);
        setCreditCardPromos(promoRes.data || []);
        setTaxProfile(taxRes.data || null);

        if (settingsRes.data) {
          setHouseholdNames({
            primary_name: settingsRes.data.primary_name || 'Me',
            spouse_name: settingsRes.data.spouse_name || 'Wife',
          });
        }

        const hasLiveMarketItems =
          loadedHoldings.length > 0 ||
          loadedAccounts.some(
            (a) => !a.is_archived && ['gold', 'india_property'].includes(getRealAssetType(a))
          );

        const shouldAutoRefresh =
          hasLiveMarketItems &&
          (refreshQuotes || !autoRefreshedOnOpenRef.current);

        if (shouldAutoRefresh) {
          autoRefreshedOnOpenRef.current = true;
          // Refresh live stock, gold & FX prices immediately on webpage open without blocking initial paint
          refreshStockPrices(loadedAccounts, loadedHoldings);
        }
      } catch (err) {
        setLoadError(err?.message || 'Failed to load vault records under RLS.');
      } finally {
        setLoadingData(false);
      }
    },
    [refreshStockPrices]
  );

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Scoped datasets for Combined vs Primary vs Spouse vs Joint
  const scopedAccounts = useMemo(
    () => filterByHouseholdScope(accounts, householdScope),
    [accounts, householdScope]
  );

  const scopedAccountIds = useMemo(
    () => new Set(scopedAccounts.map((a) => a.id)),
    [scopedAccounts]
  );

  const scopedSnapshots = useMemo(
    () => snapshots.filter((s) => scopedAccountIds.has(s.account_id)),
    [snapshots, scopedAccountIds]
  );

  const scopedExpenses = useMemo(
    () => filterByHouseholdScope(expenses, householdScope),
    [expenses, householdScope]
  );

  const scopedRecurringBills = useMemo(
    () => filterByHouseholdScope(recurringBills, householdScope),
    [recurringBills, householdScope]
  );

  const scopedHoldings = useMemo(
    () => equityHoldings.filter((h) => scopedAccountIds.has(h.account_id)),
    [equityHoldings, scopedAccountIds]
  );

  const scopedPromos = useMemo(
    () => creditCardPromos.filter((p) => scopedAccountIds.has(p.account_id)),
    [creditCardPromos, scopedAccountIds]
  );

  const hasLiveQuotesSources = useMemo(
    () =>
      equityHoldings.length > 0 ||
      accounts.some(
        (a) => !a.is_archived && ['gold', 'india_property'].includes(getRealAssetType(a))
      ),
    [equityHoldings, accounts]
  );

  const hasJointItems = useMemo(
    () =>
      accounts.some((a) => a.owner_profile === 'joint') ||
      expenses.some((e) => e.owner_profile === 'joint'),
    [accounts, expenses]
  );

  const pendingPayrollBatch = useMemo(
    () =>
      computePendingPayrollBatch(
        taxProfile?.paystub_details?.payroll_autosync,
        taxProfile,
        accounts
      ),
    [taxProfile, accounts]
  );

  const handleOpenAutoSyncReview = useCallback(() => {
    setPayTabInitialSubTab('autosync');
    setActiveTab('income');
  }, []);

  const handleAskAdvisorWithPrompt = useCallback((promptText) => {
    if (promptText) setAdvisorInitialPrompt(promptText);
    setActiveTab('advisor');
  }, []);

  const insightsUrgentCount = useMemo(() => {
    const res = buildActionableInsights({
      accounts,
      equityHoldings,
      promos: creditCardPromos,
      expenses,
      recurringBills,
      budgets,
      taxProfile,
      householdNames,
    });
    return res.urgentCount;
  }, [accounts, equityHoldings, creditCardPromos, expenses, recurringBills, budgets, taxProfile, householdNames]);

  const optionsAlertCount = useMemo(() => {
    const desk = normalizeOptionsDesk(taxProfile?.paystub_details?.options_desk);
    const today = todayIsoDate();
    let alerts = 0;
    for (const pos of desk.positions || []) {
      if (pos.status !== 'open') continue;
      const dteLeft = pos.expiration ? daysBetweenIso(today, pos.expiration) : null;
      const h = (equityHoldings || []).find(
        (x) => String(x.symbol || '').trim().toUpperCase() === pos.symbol && toNumber(x.last_price) > 0
      );
      const spot = h ? toNumber(h.last_price) : 0;
      const isItm =
        spot > 0 &&
        pos.strike > 0 &&
        (pos.strategy === 'cc' ? spot > pos.strike : spot < pos.strike);
      if (isItm || (dteLeft !== null && dteLeft <= 7)) alerts += 1;
    }
    return alerts;
  }, [taxProfile, equityHoldings]);

  const handleQuickPostAllDuePayroll = useCallback(async () => {
    if (!pendingPayrollBatch.dueItems.length || !session?.user?.id) return;
    setPostingTopBannerSync(true);
    setTopSyncBannerError('');
    setTopSyncBannerNotice('');
    try {
      const res = await executePayrollSyncBatch({
        supabase,
        userId: session.user.id,
        taxProfile,
        dueItems: pendingPayrollBatch.dueItems,
      });
      const warnText = res.warnings.length > 0 ? ` (${res.warnings.join(' ')})` : '';
      setTopSyncBannerNotice(
        `Posted ${res.postedCount} payroll contribution${res.postedCount === 1 ? '' : 's'} (+${formatCurrency(
          res.totalPostedDollars
        )}) to your accounts.${warnText}`
      );
      await loadAllData();
    } catch (err) {
      setTopSyncBannerError(err?.message || 'Failed to apply payroll auto-sync.');
    } finally {
      setPostingTopBannerSync(false);
    }
  }, [pendingPayrollBatch.dueItems, session?.user?.id, taxProfile, loadAllData]);

  const handleNavigateTab = (tab, categoryFilter) => {
    if (categoryFilter) setAccountCategoryFilter(categoryFilter);
    setActiveTab(tab);
  };

  const handleOpenBatchFromAnywhere = () => {
    setActiveTab('accounts');
    setBatchModalOpen(true);
  };

  const handleOpenNewAccountFromAnywhere = (cat = 'retirement_401k') => {
    setAccountCategoryFilter('all');
    setActiveTab('accounts');
    setNewAccountCategory(cat);
  };

  const handleSeedDemo = async () => {
    setSeedingDemo(true);
    try {
      await seedDemoVaultData(supabase);
      await loadAllData({ refreshQuotes: true });
    } catch (err) {
      setLoadError(err?.message || 'Failed to load sample data.');
    } finally {
      setSeedingDemo(false);
    }
  };

  const handleSaveHouseholdNames = async (e) => {
    e.preventDefault();
    const pName = draftPrimaryName.trim() || 'Me';
    const sName = draftSpouseName.trim() || 'Wife';
    setSavingNames(true);
    try {
      const { error } = await supabase.from('household_settings').upsert(
        {
          user_id: session.user.id,
          primary_name: pName,
          spouse_name: sName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
      if (error) throw error;
      setHouseholdNames({ primary_name: pName, spouse_name: sName });
      setNamesModalOpen(false);
    } finally {
      setSavingNames(false);
    }
  };

  const navItems = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'insights', label: 'Insights', icon: Target, badge: insightsUrgentCount },
    { key: 'accounts', label: 'Accounts', icon: Wallet },
    { key: 'strategies', label: 'Strategies', icon: Compass, badge: optionsAlertCount },
    { key: 'income', label: 'Pay & Taxes', icon: Briefcase },
    { key: 'expenses', label: 'Expenses', icon: Receipt },
    { key: 'advisor', label: 'AI Advisor', icon: Sparkles },
    { key: 'security', label: 'Security', icon: Lock },
  ];

  const scopeOptions = [
    { key: 'combined', label: 'Combined' },
    { key: 'primary', label: householdNames.primary_name },
    { key: 'spouse', label: householdNames.spouse_name },
    ...(hasJointItems ? [{ key: 'joint', label: 'Joint' }] : []),
  ];

  // When locked, unmount all financial DOM completely and render only the lock screen
  if (isScreenLocked) {
    return (
      <VaultLockScreen
        user={session?.user}
        lockReason={lockReason}
        onUnlock={handleUnlockScreen}
        onFullSignOut={handleFullSignOut}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      {/* Top Sticky Command Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="flex items-center gap-2.5 text-left"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tracking-tight text-zinc-100">
                    asfinance
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase ${
                      aalLevel === 'aal2'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {aalLevel}
                  </span>
                </div>
                <div className="hidden text-[11px] text-zinc-500 sm:block">
                  Household Net Worth, RSU & Debt Terminal
                </div>
              </div>
            </button>

            <nav className="hidden items-center gap-1 lg:flex">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveTab(item.key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'bg-zinc-800/90 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${active ? 'text-emerald-400' : ''}`} />
                    {item.label}
                    {item.badge > 0 && (
                      <span className="rounded-full bg-amber-400 px-1.5 py-0.2 font-mono text-[9px] font-bold text-zinc-950">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Household Scope Switcher */}
            {activeTab !== 'security' &&
              activeTab !== 'income' &&
              activeTab !== 'insights' &&
              activeTab !== 'strategies' && (
              <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
                <Users className="ml-1.5 mr-0.5 hidden h-3.5 w-3.5 text-zinc-500 sm:inline" />
                {scopeOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setHouseholdScope(opt.key)}
                    className={`rounded-md px-2.5 py-1 font-medium transition ${
                      householdScope === opt.key
                        ? opt.key === 'spouse'
                          ? 'bg-fuchsia-500/20 text-fuchsia-200'
                          : opt.key === 'primary'
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setDraftPrimaryName(householdNames.primary_name);
                    setDraftSpouseName(householdNames.spouse_name);
                    setNamesModalOpen(true);
                  }}
                  title="Customize household names"
                  className="rounded-md p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Live Stock / Gold / FX Quotes Button */}
            {hasLiveQuotesSources && (
              <button
                type="button"
                disabled={quotesRefreshing}
                onClick={() => refreshStockPrices(accounts, equityHoldings)}
                title={
                  quoteStatusError ||
                  (lastQuotesSyncAt
                    ? `Last live market/FX sync: ${new Date(lastQuotesSyncAt).toLocaleTimeString()}`
                    : 'Refresh live stock, gold & USD/INR prices')
                }
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                  quoteStatusError
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
                }`}
              >
                <TrendingUp className={`h-3.5 w-3.5 ${quotesRefreshing ? 'animate-pulse' : ''}`} />
                <span className="hidden sm:inline">
                  {quotesRefreshing ? 'Updating Quotes…' : 'Live Quotes'}
                </span>
              </button>
            )}

            {accounts.length > 0 && (
              <button
                type="button"
                onClick={handleOpenBatchFromAnywhere}
                className="hidden items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 xl:inline-flex"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Update Balances
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:text-zinc-200"
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-indigo-500" />
              )}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>

            <button
              type="button"
              onClick={() => setPrivacyMode(!privacyMode)}
              title={privacyMode ? 'Show dollar amounts' : 'Mask dollar amounts'}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                privacyMode
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {privacyMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{privacyMode ? 'Masked' : 'Privacy'}</span>
            </button>

            <button
              type="button"
              onClick={() => triggerScreenLock('Manually locked.')}
              title="Lock Screen (⌘⇧L) — Unlock with Touch ID or Password"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-amber-500/40 hover:text-amber-300"
            >
              <Lock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Lock</span>
            </button>

            <button
              type="button"
              onClick={handleFullSignOut}
              title="Full Sign Out (Require 2FA on next login)"
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1.5 text-xs text-zinc-500 hover:border-rose-500/40 hover:text-rose-300"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Tablet/Mobile Nav Strip */}
        <div className="flex items-center gap-1 overflow-x-auto border-t border-zinc-900 px-4 py-2 lg:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                  active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? 'text-emerald-400' : ''}`} />
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {loadError && (
          <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {loadError}
          </div>
        )}

        {topSyncBannerError && (
          <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
            <span>{topSyncBannerError}</span>
            <button
              type="button"
              onClick={() => setTopSyncBannerError('')}
              className="text-rose-300 hover:text-rose-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {topSyncBannerNotice && (
          <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
            <span>{topSyncBannerNotice}</span>
            <button
              type="button"
              onClick={() => setTopSyncBannerNotice('')}
              className="text-emerald-300 hover:text-emerald-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {!loadingData &&
          !dismissedSyncBanner &&
          pendingPayrollBatch.hasDueActions &&
          activeTab !== 'security' && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs">
              <div className="flex items-start gap-2.5">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div>
                  <div className="font-semibold text-amber-200">
                    Payroll Auto-Sync Ready:{' '}
                    {pendingPayrollBatch.dueItems.length > 0 && (
                      <span>
                        {pendingPayrollBatch.totalDuePaydays} due pay period
                        {pendingPayrollBatch.totalDuePaydays === 1 ? '' : 's'} (
                        {privacyMode
                          ? '••••••'
                          : `+${formatCurrency(pendingPayrollBatch.totalDueDollars, { decimals: 0 })}`}
                        )
                      </span>
                    )}
                    {pendingPayrollBatch.dueItems.length > 0 &&
                      pendingPayrollBatch.dueEsppPurchases.length > 0 &&
                      ' • '}
                    {pendingPayrollBatch.dueEsppPurchases.length > 0 && (
                      <span>
                        {pendingPayrollBatch.dueEsppPurchases.length} ESPP purchase ready
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-amber-100/80">
                    {pendingPayrollBatch.dueItems
                      .map(
                        (it) =>
                          `${it.rule.label}: ${
                            privacyMode
                              ? '••••'
                              : `+${formatCurrency(it.totalAmount, { decimals: 0 })}`
                          } (${it.paydates.map(formatShortDate).join(', ')})`
                      )
                      .join(' • ')}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {pendingPayrollBatch.dueItems.length > 0 && (
                  <button
                    type="button"
                    disabled={postingTopBannerSync}
                    onClick={handleQuickPostAllDuePayroll}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {postingTopBannerSync ? 'Posting…' : 'Apply All Now'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleOpenAutoSyncReview}
                  className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/25"
                >
                  Review / Adjust
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedSyncBanner(true)}
                  title="Dismiss for this session"
                  className="rounded-lg p-1 text-amber-300/70 hover:text-amber-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

        {loadingData ? (
          <div className="flex items-center justify-center py-24 text-xs text-zinc-500">
            <div className="mr-2.5 h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-400" />
            Decrypting & loading financial records…
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewTab
                accounts={scopedAccounts}
                allAccounts={accounts}
                snapshots={scopedSnapshots}
                expenses={scopedExpenses}
                recurringBills={scopedRecurringBills}
                budgets={budgets}
                equityHoldings={scopedHoldings}
                promos={scopedPromos}
                householdScope={householdScope}
                onChangeHouseholdScope={setHouseholdScope}
                householdNames={householdNames}
                quotesRefreshing={quotesRefreshing}
                lastQuotesSyncAt={lastQuotesSyncAt}
                onRefreshQuotes={() => refreshStockPrices(accounts, equityHoldings)}
                privacyMode={privacyMode}
                hasMfaEnrolled={hasMfaEnrolled}
                onNavigateTab={handleNavigateTab}
                onOpenBatchUpdate={handleOpenBatchFromAnywhere}
                onOpenNewAccount={handleOpenNewAccountFromAnywhere}
                onSeedDemo={handleSeedDemo}
                seedingDemo={seedingDemo}
              />
            )}

            {activeTab === 'insights' && (
              <ActionableInsightsDashboard
                accounts={accounts}
                equityHoldings={equityHoldings}
                promos={creditCardPromos}
                expenses={expenses}
                recurringBills={recurringBills}
                budgets={budgets}
                taxProfile={taxProfile}
                householdNames={householdNames}
                privacyMode={privacyMode}
                onNavigateTab={handleNavigateTab}
                onOpenAutoSync={handleOpenAutoSyncReview}
                onAskAdvisor={handleAskAdvisorWithPrompt}
              />
            )}

            {activeTab === 'accounts' && (
              <AccountsTab
                supabase={supabase}
                accounts={scopedAccounts}
                allAccounts={accounts}
                snapshots={scopedSnapshots}
                equityHoldings={scopedHoldings}
                promos={scopedPromos}
                householdScope={householdScope}
                householdNames={householdNames}
                initialCategoryFilter={accountCategoryFilter}
                privacyMode={privacyMode}
                onDataChanged={(opts) => loadAllData(opts)}
                onRefreshQuotes={() => refreshStockPrices(accounts, equityHoldings)}
                batchModalOpen={batchModalOpen}
                setBatchModalOpen={setBatchModalOpen}
                newAccountCategory={newAccountCategory}
                setNewAccountCategory={setNewAccountCategory}
              />
            )}

            {activeTab === 'strategies' && (
              <CapitalDeskTab
                supabase={supabase}
                session={session}
                accounts={accounts}
                equityHoldings={equityHoldings}
                promos={creditCardPromos}
                expenses={expenses}
                recurringBills={recurringBills}
                taxProfile={taxProfile}
                householdNames={householdNames}
                privacyMode={privacyMode}
                onDataChanged={() => loadAllData()}
                onNavigateTab={handleNavigateTab}
                onAskAdvisor={handleAskAdvisorWithPrompt}
              />
            )}

            {activeTab === 'income' && (
              <PaystubProfileCard
                standalone
                supabase={supabase}
                session={session}
                taxProfile={taxProfile}
                budgets={budgets}
                accounts={accounts}
                equityHoldings={equityHoldings}
                householdNames={householdNames}
                privacyMode={privacyMode}
                onTaxProfileSaved={() => loadAllData()}
                onOpenAdvisor={() => setActiveTab('advisor')}
                initialSubTab={payTabInitialSubTab}
                onConsumedInitialSubTab={() => setPayTabInitialSubTab(null)}
              />
            )}

            {activeTab === 'expenses' && (
              <ExpensesTab
                supabase={supabase}
                accounts={scopedAccounts}
                expenses={scopedExpenses}
                recurringBills={scopedRecurringBills}
                budgets={budgets}
                householdScope={householdScope}
                householdNames={householdNames}
                privacyMode={privacyMode}
                onDataChanged={() => loadAllData()}
              />
            )}

            {activeTab === 'advisor' && (
              <AdvisorTab
                supabase={supabase}
                accounts={accounts}
                equityHoldings={equityHoldings}
                taxProfile={taxProfile}
                householdScope={householdScope}
                householdNames={householdNames}
                privacyMode={privacyMode}
                activeThreadId={activeAdvisorThreadId}
                onChangeActiveThreadId={setActiveAdvisorThreadId}
                onOpenPayTab={() => setActiveTab('income')}
                initialPrompt={advisorInitialPrompt}
                onConsumedInitialPrompt={() => setAdvisorInitialPrompt('')}
              />
            )}

            {activeTab === 'security' && (
              <SecurityTab
                supabase={supabase}
                session={session}
                aalLevel={aalLevel}
                hasMfaEnrolled={hasMfaEnrolled}
                verifiedTotpFactors={verifiedTotpFactors}
                refreshAuthStatus={refreshAuthStatus}
                accounts={accounts}
                snapshots={snapshots}
                expenses={expenses}
                recurringBills={recurringBills}
                budgets={budgets}
                equityHoldings={equityHoldings}
                creditCardPromos={creditCardPromos}
                householdNames={householdNames}
                lockSettings={lockSettings}
                onUpdateLockSettings={handleUpdateLockSettings}
                theme={theme}
                onChangeTheme={handleChangeTheme}
                onLockNow={() => triggerScreenLock('Manually locked to test screen lock.')}
                onFullSignOut={handleFullSignOut}
                onDataChanged={() => loadAllData()}
              />
            )}
          </>
        )}
      </main>

      {/* Modal: Customize Household Display Names */}
      {namesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-semibold text-zinc-100">Household Profile Labels</h3>
              <button
                type="button"
                onClick={() => setNamesModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveHouseholdNames} className="space-y-4 text-xs">
              <label className="block text-zinc-300">
                Primary Member Label
                <input
                  type="text"
                  required
                  value={draftPrimaryName}
                  onChange={(e) => setDraftPrimaryName(e.target.value)}
                  placeholder="Me"
                  className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <label className="block text-zinc-300">
                Spouse / Partner Label
                <input
                  type="text"
                  required
                  value={draftSpouseName}
                  onChange={(e) => setDraftSpouseName(e.target.value)}
                  placeholder="Wife"
                  className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNamesModalOpen(false)}
                  className="rounded-lg border border-zinc-800 px-4 py-2 text-zinc-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNames}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-zinc-950"
                >
                  <Check className="h-3.5 w-3.5" />
                  {savingNames ? 'Saving…' : 'Save Labels'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthVaultGate>
      {(authProps) => <AuthenticatedVault {...authProps} />}
    </AuthVaultGate>
  );
}
