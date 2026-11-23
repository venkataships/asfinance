const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STRATEGIES = new Set(['cc', 'csp', 'put_spread', 'tbill']);
const VALID_STATUSES = new Set(['open', 'rolled', 'closed', 'assigned']);
const VALID_RISKS = new Set(['low', 'low_medium', 'medium']);

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createDefaultOptionsDesk() {
  return {
    risk_profile: 'low_medium',
    reserve_months: 6,
    custom_deploy_budget: '',
    custom_watchlist: '',
    positions: [],
  };
}

export function normalizeOptionsDesk(raw) {
  const defaults = createDefaultOptionsDesk();
  if (!raw || typeof raw !== 'object') return defaults;

  const numStr = (val, fallback = '') => {
    if (val === '' || val === null || val === undefined) return fallback;
    const n = Number(val);
    return Number.isFinite(n) ? String(n) : fallback;
  };

  const rawPositions = Array.isArray(raw.positions) ? raw.positions.slice(0, 60) : [];
  const positions = rawPositions
    .filter((p) => p && typeof p === 'object')
    .map((p, idx) => {
      const strategy = VALID_STRATEGIES.has(p.strategy) ? p.strategy : 'csp';
      const status = VALID_STATUSES.has(p.status) ? p.status : 'open';
      const symbol = String(p.symbol || '').trim().toUpperCase().slice(0, 14);
      return {
        id:
          typeof p.id === 'string' && p.id.trim()
            ? p.id.trim().slice(0, 64)
            : `opt-${idx + 1}-${Date.now().toString(36)}`,
        account_id:
          Number.isFinite(Number(p.account_id)) && Number(p.account_id) > 0
            ? Number(p.account_id)
            : null,
        strategy,
        symbol,
        contracts: Math.max(1, Math.min(500, Math.floor(toNum(p.contracts) || 1))),
        strike: Math.max(0, toNum(p.strike)),
        long_strike: Math.max(0, toNum(p.long_strike)),
        expiration:
          typeof p.expiration === 'string' && ISO_DATE_RE.test(p.expiration.trim())
            ? p.expiration.trim()
            : '',
        premium_per_share: Math.max(0, toNum(p.premium_per_share)),
        cost_basis: Math.max(0, toNum(p.cost_basis)),
        status,
        realized_pnl: toNum(p.realized_pnl),
        roll_count: Math.max(0, Math.min(50, Math.floor(toNum(p.roll_count)))),
        opened_at:
          typeof p.opened_at === 'string' && ISO_DATE_RE.test(p.opened_at.trim())
            ? p.opened_at.trim()
            : todayIso(),
        notes: typeof p.notes === 'string' ? p.notes.slice(0, 240) : '',
      };
    })
    .filter((p) => p.symbol.length > 0);

  return {
    risk_profile: VALID_RISKS.has(raw.risk_profile) ? raw.risk_profile : defaults.risk_profile,
    reserve_months: Math.max(
      3,
      Math.min(18, Math.floor(toNum(raw.reserve_months) || defaults.reserve_months))
    ),
    custom_deploy_budget: numStr(raw.custom_deploy_budget, ''),
    custom_watchlist:
      typeof raw.custom_watchlist === 'string' ? raw.custom_watchlist.toUpperCase().slice(0, 160) : '',
    positions,
  };
}

export function sanitizeOptionsDeskForDb(raw) {
  const norm = normalizeOptionsDesk(raw);
  return {
    risk_profile: norm.risk_profile,
    reserve_months: norm.reserve_months,
    custom_deploy_budget:
      norm.custom_deploy_budget !== ''
        ? Math.max(0, Number(toNum(norm.custom_deploy_budget).toFixed(2)))
        : '',
    custom_watchlist: norm.custom_watchlist.trim().slice(0, 160),
    positions: norm.positions.map((p) => ({
      id: p.id,
      account_id: p.account_id,
      strategy: p.strategy,
      symbol: p.symbol,
      contracts: p.contracts,
      strike: Number(p.strike.toFixed(2)),
      long_strike: Number(p.long_strike.toFixed(2)),
      expiration: p.expiration,
      premium_per_share: Number(p.premium_per_share.toFixed(4)),
      cost_basis: Number(p.cost_basis.toFixed(4)),
      status: p.status,
      realized_pnl: Number(p.realized_pnl.toFixed(2)),
      roll_count: p.roll_count,
      opened_at: p.opened_at,
      notes: p.notes.trim().slice(0, 240),
    })),
  };
}
