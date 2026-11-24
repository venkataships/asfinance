import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { GoogleGenAI } from 'npm:@google/genai@^3.5.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_MODELS = [
  {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    label: 'Claude Haiku 5.5',
    badge: 'Default • Anthropic',
    description: 'Latest Claude Haiku — fast, crisp financial & tax analysis',
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    label: 'Claude Haiku 4.5',
    badge: 'Fallback • Anthropic',
    description: 'Previous-gen Claude Haiku fallback',
  },
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5.5',
    badge: 'Deep CFO • Anthropic',
    description: 'Flagship Anthropic reasoning for complex tax & wealth strategy',
  },
  {
    id: 'gemini-4-neon-medium',
    provider: 'gemini',
    label: 'Gemini 4 Neon (Med)',
    badge: 'Frontier • Gemini',
    description: 'Gemini 4 Neon with Medium thinking — frontier reasoning with fast responses',
  },
  {
    id: 'gemini-4-hydrogen',
    provider: 'gemini',
    label: 'Gemini 4 Hydrogen',
    badge: 'Free Backup',
    description: 'Free-tier Gemini 4 backup model',
  },
  {
    id: 'gemini-3.8-flash',
    provider: 'gemini',
    label: 'Gemini 3.8 Flash',
    badge: 'Free Backup',
    description: 'Fast Gemini 3.8 Flash model on Free Tier',
  },
  {
    id: 'gemini-3.5-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.5 Flash-Lite',
    badge: 'Free Backup',
    description: 'High-quota fast workhorse on Free Tier (500 req/day)',
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash-Lite',
    badge: 'Free Backup',
    description: 'Secondary high-quota fast fallback on Free Tier (500 req/day)',
  },
  {
    id: 'gemma-4-31b-it',
    provider: 'gemini',
    label: 'Gemma 4 31B',
    badge: 'Free Backup',
    description: 'Open 31B backup model with ultra-high Free Tier quota (14.4K req/day)',
  },
] as const;

const ALLOWED_MODEL_IDS = new Set<string>(ALLOWED_MODELS.map((m) => m.id));

function buildAnthropicRequestPayload(
  targetModel: string,
  systemInstruction: string,
  cleanedMessages: Array<{ role: string; text: string }>,
  stream = false
) {
  // Normalize into strictly alternating user/assistant turns starting with user
  const normalized: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const m of cleanedMessages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const text = m.text.trim();
    if (!text) continue;
    if (normalized.length === 0 && role === 'assistant') {
      continue;
    }
    const prev = normalized[normalized.length - 1];
    if (prev && prev.role === role) {
      prev.text = `${prev.text}\n\n${text}`;
    } else {
      normalized.push({ role, text });
    }
  }

  if (normalized.length === 0) {
    throw new Error('Please include at least one user message.');
  }

  const anthropicMessages = normalized.map((m) => ({
    role: m.role,
    content: [{ type: 'text', text: m.text }],
  }));

  const isClaude55 = targetModel.includes('-5-5');
  const reqPayload: Record<string, unknown> = {
    model: targetModel,
    max_tokens: isClaude55 ? 16384 : 8192,
    system: [{ type: 'text', text: systemInstruction }],
    messages: anthropicMessages,
  };
  if (isClaude55) {
    reqPayload.thinking = { type: 'adaptive' };
    reqPayload.output_config = { effort: 'medium' };
  }
  if (stream) {
    reqPayload.stream = true;
  }
  return reqPayload;
}

async function callAnthropicModel(
  apiKey: string,
  targetModel: string,
  systemInstruction: string,
  cleanedMessages: Array<{ role: string; text: string }>,
  timeoutMs = 90000
) {
  const reqPayload = buildAnthropicRequestPayload(targetModel, systemInstruction, cleanedMessages, false);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
    },
    body: JSON.stringify(reqPayload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const errMsg =
      (json as { error?: { message?: string } })?.error?.message ||
      resp.statusText ||
      'Anthropic API request failed';
    throw new Error(`${resp.status} ${errMsg}`);
  }

  const contentBlocks = Array.isArray((json as { content?: unknown }).content)
    ? ((json as { content: Array<{ type?: string; text?: string }> }).content)
    : [];
  const replyText = contentBlocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('\n')
    .trim();

  const rawUsage = (json as { usage?: Record<string, unknown> })?.usage || {};
  const inputTokens = Number(rawUsage.input_net_tokens ?? rawUsage.input_tokens ?? 0);
  const outputTokens = Number(rawUsage.output_tokens ?? 0);

  if (!replyText) {
    const stopReason = (json as { stop_reason?: string })?.stop_reason;
    console.warn(
      '[finance-advisor] Empty Anthropic text:',
      JSON.stringify({
        model: targetModel,
        stop_reason: stopReason,
        blockTypes: contentBlocks.map((b) => b?.type),
        usage: rawUsage,
      })
    );
    if (stopReason === 'max_tokens') {
      throw new Error(
        `Claude (${targetModel}) hit max_tokens (${reqPayload.max_tokens}) during internal reasoning before emitting a final response. Please retry.`
      );
    }
  }

  return {
    reply: replyText,
    usage: {
      total_tokens: inputTokens + outputTokens,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

async function streamAnthropicModel(
  apiKey: string,
  targetModel: string,
  systemInstruction: string,
  cleanedMessages: Array<{ role: string; text: string }>,
  onDelta: (chunk: string) => void,
  timeoutMs = 105000
) {
  const reqPayload = buildAnthropicRequestPayload(targetModel, systemInstruction, cleanedMessages, true);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
    },
    body: JSON.stringify(reqPayload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok || !resp.body) {
    const json = await resp.json().catch(() => ({}));
    const errMsg =
      (json as { error?: { message?: string } })?.error?.message ||
      resp.statusText ||
      'Anthropic API request failed';
    throw new Error(`${resp.status} ${errMsg}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let replyText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;

      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(dataStr);
      } catch {
        continue;
      }

      if (evt.type === 'message_start') {
        const msgUsage = (evt.message as { usage?: Record<string, unknown> } | undefined)?.usage;
        if (msgUsage) {
          inputTokens = Number(msgUsage.input_tokens ?? 0);
        }
      } else if (evt.type === 'content_block_delta') {
        const delta = evt.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
          replyText += delta.text;
          onDelta(delta.text);
        }
      } else if (evt.type === 'message_delta') {
        const msgUsage = evt.usage as Record<string, unknown> | undefined;
        if (msgUsage && msgUsage.output_tokens !== undefined) {
          outputTokens = Number(msgUsage.output_tokens ?? 0);
        }
      } else if (evt.type === 'error') {
        const errObj = evt.error as { message?: string } | undefined;
        throw new Error(errObj?.message || 'Anthropic stream error');
      }
    }
  }

  return {
    reply: replyText.trim(),
    usage: {
      total_tokens: inputTokens + outputTokens,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function usd(v: number): string {
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const IRS_2026 = {
  employee401k: 24500,
  total401k415c: 72000,
  hsaSelf: 4400,
  hsaFamily: 8750,
  healthFsa: 3400,
  depCareFsaMfj: 7500,
  depCareFsaMfs: 3750,
  esppFmvCap: 25000,
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
  standardDeduction: {
    married_filing_jointly: 32200,
    married_filing_separately: 16100,
    single: 16100,
    head_of_household: 24150,
  } as Record<string, number>,
  brackets: {
    married_filing_jointly: [
      [24800, 0.1],
      [100800, 0.12],
      [211400, 0.22],
      [403550, 0.24],
      [512450, 0.32],
      [768700, 0.35],
      [Number.POSITIVE_INFINITY, 0.37],
    ],
    single: [
      [12400, 0.1],
      [50400, 0.12],
      [105700, 0.22],
      [201775, 0.24],
      [256225, 0.32],
      [640600, 0.35],
      [Number.POSITIVE_INFINITY, 0.37],
    ],
    married_filing_separately: [
      [12400, 0.1],
      [50400, 0.12],
      [105700, 0.22],
      [201775, 0.24],
      [256225, 0.32],
      [384350, 0.35],
      [Number.POSITIVE_INFINITY, 0.37],
    ],
    head_of_household: [
      [17700, 0.1],
      [67450, 0.12],
      [105700, 0.22],
      [201750, 0.24],
      [256200, 0.32],
      [640600, 0.35],
      [Number.POSITIVE_INFINITY, 0.37],
    ],
  } as Record<string, Array<[number, number]>>,
};

const PAY_FREQ_PERIODS: Record<string, number> = {
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  weekly: 52,
};

function r2(v: number): number {
  return Number(v.toFixed(2));
}

function compactObj(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === 'number' && Math.abs(v) < 0.005) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildPersonPaystubSnapshot(
  taxProfile: Record<string, unknown>,
  prefix: 'primary' | 'spouse',
  label: string
) {
  const baseSalary = Math.max(0, num(taxProfile[`${prefix}_base_salary`]));
  const bonusAnnual = Math.max(0, num(taxProfile[`${prefix}_bonus_annual`]));
  const rsuAnnual = Math.max(0, num(taxProfile[`${prefix}_rsu_annual`]));
  const ytd401k = Math.max(0, num(taxProfile[`${prefix}_401k_ytd`]));
  const hasMegaBackdoor = Boolean(taxProfile[`${prefix}_has_mega_backdoor`]);
  const esppEnrolled = Boolean(taxProfile[`${prefix}_espp_enrolled`]);

  const rawDetails = (taxProfile.paystub_details || {}) as Record<string, unknown>;
  const stub = ((rawDetails?.[prefix] as Record<string, unknown>) || {}) as Record<string, unknown>;

  const freq = PAY_FREQ_PERIODS[String(stub.pay_frequency || 'biweekly')]
    ? String(stub.pay_frequency || 'biweekly')
    : 'biweekly';
  const periods = PAY_FREQ_PERIODS[freq];

  const basePerCheck = baseSalary / periods;
  const otherEarnings = Math.max(0, num(stub.other_earnings_per_check));
  const grossPerCheck = basePerCheck + otherEarnings;

  const trad401k = Math.max(0, num(stub.trad_401k_per_check));
  const medical = Math.max(0, num(stub.medical_per_check));
  const dentalVision = Math.max(0, num(stub.dental_vision_per_check));
  const hsaEmp = Math.max(0, num(stub.hsa_employee_per_check));
  const healthFsa = Math.max(0, num(stub.health_fsa_per_check));
  const depCareFsa = Math.max(0, num(stub.dep_care_fsa_per_check));
  const otherPreTax = Math.max(0, num(stub.other_pretax_per_check));
  const preTaxPerCheck =
    trad401k + medical + dentalVision + hsaEmp + healthFsa + depCareFsa + otherPreTax;

  const fedTax = Math.max(0, num(stub.fed_tax_per_check));
  const stateTax = Math.max(0, num(stub.state_tax_per_check));
  const fica = Math.max(0, num(stub.fica_per_check));
  const taxesPerCheck = fedTax + stateTax + fica;

  const roth401k = Math.max(0, num(stub.roth_401k_per_check));
  const afterTax401k = Math.max(0, num(stub.after_tax_per_check ?? stub.after_tax_401k_per_check));
  const esppPerCheck = Math.max(0, num(stub.espp_per_check));
  const esppDiscountPct =
    stub.espp_discount_pct !== undefined
      ? Math.max(0, Math.min(50, num(stub.espp_discount_pct)))
      : 15;
  const otherPostTax = Math.max(0, num(stub.other_posttax_per_check));
  const postTaxPerCheck = roth401k + afterTax401k + esppPerCheck + otherPostTax;

  const netPerCheck = grossPerCheck - preTaxPerCheck - taxesPerCheck - postTaxPerCheck;
  const employerMatchAnnual = Math.max(0, num(stub.employer_401k_match_annual));
  const employerHsaAnnual = Math.max(0, num(stub.employer_hsa_annual));
  const has401kTrueUp = stub.has_401k_true_up === undefined ? true : Boolean(stub.has_401k_true_up);
  const bonusWhPct =
    stub.bonus_withholding_pct !== undefined
      ? Math.max(0, Math.min(55, num(stub.bonus_withholding_pct)))
      : 22;
  const rsuWhPct =
    stub.rsu_withholding_pct !== undefined
      ? Math.max(0, Math.min(55, num(stub.rsu_withholding_pct)))
      : 22;

  const annualBaseGross = grossPerCheck * periods;
  const annualGrossComp = annualBaseGross + bonusAnnual + rsuAnnual;
  const annualTrad401k = trad401k * periods;
  const annualRoth401k = roth401k * periods;
  const annualEmployee401k = annualTrad401k + annualRoth401k;
  const annualAfterTax401k = afterTax401k * periods;
  const total415cProjected =
    Math.min(annualEmployee401k, IRS_2026.employee401k) + employerMatchAnnual + annualAfterTax401k;
  const remaining401kByYtd = Math.max(0, IRS_2026.employee401k - ytd401k);
  const remaining415cRoom = Math.max(0, IRS_2026.total401k415c - total415cProjected);
  const electivePerCheck = trad401k + roth401k;
  const early401kMaxOutCheck =
    electivePerCheck > 0 && annualEmployee401k > IRS_2026.employee401k + 1
      ? Math.ceil(IRS_2026.employee401k / electivePerCheck)
      : null;

  const annualHsaEmp = hsaEmp * periods;
  const annualHsaTotal = annualHsaEmp + employerHsaAnnual;
  const annualHealthFsa = healthFsa * periods;
  const annualDepCareFsa = depCareFsa * periods;
  const annualHealthPremiums = (medical + dentalVision) * periods;
  const annualPreTaxTotal = preTaxPerCheck * periods;
  const annualTaxesFromBase = taxesPerCheck * periods;
  const annualFedFromBase = fedTax * periods;
  const annualStateFromBase = stateTax * periods;
  const annualPostTaxTotal = postTaxPerCheck * periods;
  const annualNetBase = netPerCheck * periods;
  const avgMonthlyNetBase = annualNetBase / 12;

  const annualEspp = esppPerCheck * periods;
  const discountDec = esppDiscountPct / 100;
  const esppMaxCash =
    discountDec < 1 ? IRS_2026.esppFmvCap * (1 - discountDec) : IRS_2026.esppFmvCap;
  const annualEsppGain =
    discountDec > 0 && discountDec < 1 ? annualEspp * (discountDec / (1 - discountDec)) : 0;

  const suppFedWithheld = bonusAnnual * (bonusWhPct / 100) + rsuAnnual * (rsuWhPct / 100);
  const hasPaystub = preTaxPerCheck > 0 || taxesPerCheck > 0 || postTaxPerCheck > 0;

  return {
    raw: {
      label,
      annualGrossComp,
      annualBaseGross,
      bonusAnnual,
      rsuAnnual,
      ytd401k,
      hasMegaBackdoor,
      esppEnrolled,
      periods,
      has401kTrueUp,
      employerMatchAnnual,
      employerHsaAnnual,
      early401kMaxOutCheck,
      annualHsaTotal,
      annualHealthFsa,
      annualDepCareFsa,
      annualPreTaxTotal,
      annualFedFromBase,
      annualStateFromBase,
      annualTaxesFromBase,
      annualPostTaxTotal,
      annualNetBase,
      avgMonthlyNetBase,
      annualEspp,
      esppDiscountPct,
      esppMaxCash,
      annualEsppGain,
      bonusWhPct,
      rsuWhPct,
      suppFedWithheld,
      hasFedTax: fedTax > 0,
      hasPaystubTaxes: taxesPerCheck > 0,
      hasPaystub,
    },
    json: compactObj({
      pay_frequency: annualGrossComp > 0 || hasPaystub ? freq : undefined,
      base_salary: r2(baseSalary),
      annual_bonus: r2(bonusAnnual),
      annual_rsu: r2(rsuAnnual),
      employer_401k_match_annual: r2(employerMatchAnnual),
      employer_hsa_seed_annual: r2(employerHsaAnnual),
      has_401k_true_up: annualGrossComp > 0 ? has401kTrueUp : undefined,
      bonus_fed_wh_pct: bonusAnnual > 0 ? bonusWhPct : undefined,
      rsu_fed_wh_pct: rsuAnnual > 0 ? rsuWhPct : undefined,
      contrib_401k_ytd: r2(ytd401k),
      remaining_24500_401k_by_ytd: annualGrossComp > 0 || ytd401k > 0 ? r2(remaining401kByYtd) : undefined,
      has_mega_backdoor_roth: hasMegaBackdoor,
      espp_enrolled: esppEnrolled,
      paystub_per_check: hasPaystub
        ? compactObj({
            gross: r2(grossPerCheck),
            pre_tax_total: r2(preTaxPerCheck),
            trad_401k: r2(trad401k),
            medical: r2(medical),
            dental_vision: r2(dentalVision),
            hsa_employee: r2(hsaEmp),
            health_fsa: r2(healthFsa),
            dep_care_fsa: r2(depCareFsa),
            other_pretax: r2(otherPreTax),
            taxes_total: r2(taxesPerCheck),
            federal_tax: r2(fedTax),
            state_tax: r2(stateTax),
            fica: r2(fica),
            post_tax_total: r2(postTaxPerCheck),
            roth_401k: r2(roth401k),
            after_tax_401k_mbdr: r2(afterTax401k),
            espp: r2(esppPerCheck),
            other_posttax: r2(otherPostTax),
            net_deposit: r2(netPerCheck),
          })
        : undefined,
      annualized_run_rate: hasPaystub
        ? compactObj({
            trad_401k: r2(annualTrad401k),
            roth_401k: r2(annualRoth401k),
            after_tax_401k_mbdr: r2(annualAfterTax401k),
            total_415c_401k_vs_72k: r2(total415cProjected),
            remaining_415c_mbdr_room: hasMegaBackdoor ? r2(remaining415cRoom) : undefined,
            health_dental_premiums: r2(annualHealthPremiums),
            hsa_employee_plus_employer: r2(annualHsaTotal),
            health_fsa: r2(annualHealthFsa),
            dep_care_fsa: r2(annualDepCareFsa),
            espp_contribution: r2(annualEspp),
            espp_implied_discount_gain: r2(annualEsppGain),
            taxes_from_base: r2(annualTaxesFromBase),
            net_base_annual: r2(annualNetBase),
            avg_monthly_net_base: r2(avgMonthlyNetBase),
          })
        : undefined,
    }),
  };
}

function buildPaystubSnapshot(
  taxProfile: Record<string, unknown>,
  primaryName: string,
  spouseName: string
) {
  const filingStatus = String(taxProfile.filing_status || 'married_filing_jointly');
  const stateCode = String(taxProfile.state_code || '').trim().toUpperCase();
  const isMfs = filingStatus === 'married_filing_separately';
  const hsaPlanType = String(taxProfile.hsa_plan_type || 'none');
  const hsaYtd = Math.max(0, num(taxProfile.hsa_contrib_ytd));
  const dependentsCount = Math.max(0, Math.floor(num(taxProfile.dependents_count)));

  const rawDetails = (taxProfile.paystub_details || {}) as Record<string, unknown>;
  const tp = ((rawDetails?.tax_planning as Record<string, unknown>) || {}) as Record<
    string,
    unknown
  >;

  const p = buildPersonPaystubSnapshot(taxProfile, 'primary', primaryName);
  const s = buildPersonPaystubSnapshot(taxProfile, 'spouse', spouseName);

  const combinedGrossComp = p.raw.annualGrossComp + s.raw.annualGrossComp;
  const combinedPreTax = p.raw.annualPreTaxTotal + s.raw.annualPreTaxTotal;

  // Capital losses & realized gains (Schedule D)
  const cfSt = Math.max(0, num(tp.cap_loss_carryforward_st));
  const cfLt = Math.max(0, num(tp.cap_loss_carryforward_lt));
  const totalCf = cfSt + cfLt;
  const ytdGainsSt = Math.max(0, num(tp.cap_gains_realized_ytd_st));
  const ytdGainsLt = Math.max(0, num(tp.cap_gains_realized_ytd_lt));
  const totalYtdGains = ytdGainsSt + ytdGainsLt;
  const ytdLossesSt = Math.max(0, num(tp.cap_losses_realized_ytd_st));
  const ytdLossesLt = Math.max(0, num(tp.cap_losses_realized_ytd_lt));
  const totalYtdLosses = ytdLossesSt + ytdLossesLt;
  const totalLossesPool = totalCf + totalYtdLosses;
  const netCapPos = totalYtdGains - totalLossesPool;
  const capLossOrdLimit = isMfs ? IRS_2026.capLossOrdinaryLimitMfs : IRS_2026.capLossOrdinaryLimit;
  const capLossOrdDed = netCapPos < 0 ? Math.min(capLossOrdLimit, Math.abs(netCapPos)) : 0;
  const capGainsShielded = Math.min(totalYtdGains, totalLossesPool);
  const remainingCfTo2027 =
    netCapPos < 0 ? Math.max(0, Math.abs(netCapPos) - capLossOrdDed) : 0;
  const netTaxableCapGain = netCapPos > 0 ? netCapPos : 0;

  // OBBBA 2026 SALT cap & Itemized vs Standard Deduction
  const ordinaryAgi = Math.max(0, combinedGrossComp - combinedPreTax - capLossOrdDed);
  const estAgi = ordinaryAgi + netTaxableCapGain;
  const saltBaseCap = isMfs ? IRS_2026.saltBaseCapMfs : IRS_2026.saltBaseCap;
  const saltFloor = isMfs ? IRS_2026.saltFloorMfs : IRS_2026.saltFloor;
  const saltThreshold = isMfs
    ? IRS_2026.saltPhaseoutThresholdMfs
    : IRS_2026.saltPhaseoutThreshold;
  const saltEffectiveCap = Math.max(
    saltFloor,
    saltBaseCap - Math.max(0, estAgi - saltThreshold) * IRS_2026.saltPhaseoutRate
  );
  const inSaltPhaseout = estAgi > saltThreshold && saltEffectiveCap > saltFloor;

  const autoStateFromPaystubs = p.raw.annualStateFromBase + s.raw.annualStateFromBase;
  const stateOverride = Math.max(0, num(tp.state_local_income_tax_override));
  const stateTaxForSalt = stateOverride > 0 ? stateOverride : autoStateFromPaystubs;
  const mortgageInterest = Math.max(0, num(tp.mortgage_interest_annual));
  const propertyTax = Math.max(0, num(tp.property_tax_annual));
  const charitable = Math.max(0, num(tp.charitable_donations_annual));
  const otherItemized = Math.max(0, num(tp.other_itemized_annual));
  const rawSaltPaid = propertyTax + stateTaxForSalt;
  const deductibleSalt = Math.min(rawSaltPaid, saltEffectiveCap);
  const totalItemized = mortgageInterest + deductibleSalt + charitable + otherItemized;

  const stdDed =
    IRS_2026.standardDeduction[filingStatus] ?? IRS_2026.standardDeduction.married_filing_jointly;
  const deductionMode = String(tp.deduction_mode || 'auto');
  const usingItemized =
    deductionMode === 'itemized'
      ? true
      : deductionMode === 'standard'
      ? false
      : totalItemized > stdDed;
  const appliedDed = usingItemized ? totalItemized : stdDed;
  const excessOverStd = Math.max(0, totalItemized - stdDed);

  const ordinaryTaxableInc = Math.max(0, ordinaryAgi - appliedDed);
  const brackets = IRS_2026.brackets[filingStatus] ?? IRS_2026.brackets.married_filing_jointly;

  let ordinaryTax = 0;
  let prevCap = 0;
  let marginalRate = brackets[0][1];
  for (const [cap, rate] of brackets) {
    if (ordinaryTaxableInc <= prevCap) break;
    const slice = Math.min(ordinaryTaxableInc, cap) - prevCap;
    if (slice > 0) {
      ordinaryTax += slice * rate;
      marginalRate = rate;
    }
    prevCap = cap;
  }
  const ltcgRate = estAgi > (filingStatus === 'married_filing_jointly' ? 600000 : 533000) ? 0.2 : 0.15;
  const estTaxBeforeCtc = ordinaryTax + netTaxableCapGain * ltcgRate;
  const ctcThreshold =
    filingStatus === 'married_filing_jointly' ? IRS_2026.ctcPhaseoutMfj : IRS_2026.ctcPhaseoutOther;
  const ctcExcessThousands =
    estAgi > ctcThreshold ? Math.ceil((estAgi - ctcThreshold) / 1000) : 0;
  const ctcCredit = Math.max(0, dependentsCount * IRS_2026.ctcPerChild - ctcExcessThousands * 50);
  const estFedTax = Math.max(0, estTaxBeforeCtc - ctcCredit);
  const marginalPct = ordinaryTaxableInc > 0 ? Math.round(marginalRate * 100) : 0;

  const hsaLimit =
    hsaPlanType === 'family' ? IRS_2026.hsaFamily : hsaPlanType === 'self' ? IRS_2026.hsaSelf : 0;
  const hsaProjectedTotal = p.raw.annualHsaTotal + s.raw.annualHsaTotal;
  const depCareLimit = isMfs ? IRS_2026.depCareFsaMfs : IRS_2026.depCareFsaMfj;
  const depCareTotal = p.raw.annualDepCareFsa + s.raw.annualDepCareFsa;

  const fedEstPaidYtd = Math.max(0, num(tp.fed_estimated_payments_ytd));
  const stateEstPaidYtd = Math.max(0, num(tp.state_estimated_payments_ytd));
  const hasAnyFedWh = p.raw.hasFedTax || s.raw.hasFedTax || fedEstPaidYtd > 0;
  const hasAnyTaxes = p.raw.hasPaystubTaxes || s.raw.hasPaystubTaxes;
  const projectedFedWh =
    p.raw.annualFedFromBase +
    s.raw.annualFedFromBase +
    p.raw.suppFedWithheld +
    s.raw.suppFedWithheld;
  const projectedFedPayments = projectedFedWh + fedEstPaidYtd;
  const projectedStatePayments = autoStateFromPaystubs + stateEstPaidYtd;

  // W-4, State Allowances & 2025 Safe Harbor
  const primaryW4Ded = Math.max(0, num(tp.primary_w4_deductions));
  const spouseW4Ded = Math.max(0, num(tp.spouse_w4_deductions));
  const combinedW4Ded = primaryW4Ded + spouseW4Ded;
  const primaryW4Extra = Math.max(0, num(tp.primary_w4_extra_per_check));
  const spouseW4Extra = Math.max(0, num(tp.spouse_w4_extra_per_check));
  const primaryStateAllow = Math.max(0, Math.floor(num(tp.primary_state_allowances)));
  const spouseStateAllow = Math.max(0, Math.floor(num(tp.spouse_state_allowances)));

  const priorAgi = Math.max(0, num(tp.prior_year_agi));
  const priorFedTax = Math.max(0, num(tp.prior_year_fed_total_tax));
  const priorStateTax = Math.max(0, num(tp.prior_year_state_total_tax));
  const priorRefundOrOwed = num(tp.prior_year_refund_or_owed);
  const shHighThreshold = isMfs ? 75000 : 150000;
  const shMult =
    priorAgi > shHighThreshold || (priorAgi === 0 && estAgi > shHighThreshold) ? 1.1 : 1.0;
  const fedShRequired =
    priorFedTax > 0 ? Math.min(priorFedTax * shMult, estFedTax * 0.9) : estFedTax * 0.9;
  const fedShMet = priorFedTax > 0 && hasAnyFedWh ? projectedFedPayments >= fedShRequired : undefined;
  const stateShTarget = priorStateTax > 0 ? priorStateTax * shMult : 0;
  const stateShMet =
    priorStateTax > 0 && projectedStatePayments > 0
      ? projectedStatePayments >= stateShTarget
      : undefined;

  const marginalDec = marginalPct / 100;
  const suppGap =
    marginalPct > 0
      ? p.raw.bonusAnnual * Math.max(0, marginalDec - p.raw.bonusWhPct / 100) +
        p.raw.rsuAnnual * Math.max(0, marginalDec - p.raw.rsuWhPct / 100) +
        s.raw.bonusAnnual * Math.max(0, marginalDec - s.raw.bonusWhPct / 100) +
        s.raw.rsuAnnual * Math.max(0, marginalDec - s.raw.rsuWhPct / 100)
      : 0;

  const alerts: string[] = [];
  for (const side of [p.raw, s.raw]) {
    if (side.early401kMaxOutCheck && side.early401kMaxOutCheck < side.periods) {
      if (!side.has401kTrueUp && side.employerMatchAnnual > 0) {
        alerts.push(
          `${side.label}: Early 401k max-out on check #${side.early401kMaxOutCheck}/${side.periods} with NO employer true-up (match forfeiture risk).`
        );
      } else {
        alerts.push(
          `${side.label}: 401k elective run rate hits $24,500 on check #${side.early401kMaxOutCheck}.`
        );
      }
    }
    if (side.annualEspp > side.esppMaxCash + 25) {
      alerts.push(`${side.label}: ESPP contribution ($${Math.round(side.annualEspp)}) exceeds §423 cap.`);
    }
  }
  if (hsaLimit > 0 && hsaProjectedTotal > hsaLimit + 1) {
    alerts.push(`Household HSA projected ($${Math.round(hsaProjectedTotal)}) exceeds $${hsaLimit} IRS cap.`);
  }
  if ((hsaLimit > 0 || hsaProjectedTotal > 0) && p.raw.annualHealthFsa + s.raw.annualHealthFsa > 0) {
    alerts.push('Both HSA and Healthcare FSA active — confirm Healthcare FSA is Limited-Purpose.');
  }
  if (depCareTotal > depCareLimit + 1) {
    alerts.push(`Dependent Care FSA ($${Math.round(depCareTotal)}) exceeds $${depCareLimit} cap.`);
  }
  if (inSaltPhaseout && rawSaltPaid > saltFloor + 500) {
    alerts.push(
      `OBBBA 2026 SALT cap phased down to $${Math.round(saltEffectiveCap)} (MAGI $${Math.round(estAgi)} > $${saltThreshold}).`
    );
  }
  if (combinedW4Ded > 0 && totalItemized > 0 && combinedW4Ded - excessOverStd > 3000) {
    alerts.push(
      `W-4 Step 4(b) deductions ($${Math.round(combinedW4Ded)}) exceed excess itemized above standard ($${Math.round(excessOverStd)}).`
    );
  }
  if (fedShMet === false) {
    alerts.push(
      `Federal Safe Harbor gap: projected $${Math.round(projectedFedPayments)} vs required $${Math.round(fedShRequired)}.`
    );
  }
  if (stateShMet === false) {
    alerts.push(
      `${stateCode || 'State'} Safe Harbor gap: projected $${Math.round(projectedStatePayments)} vs ${Math.round(shMult * 100)}% 2025 target $${Math.round(stateShTarget)}.`
    );
  }
  if (suppGap >= 500) {
    alerts.push(
      `Supplemental bonus/RSU withholding gap ~$${Math.round(suppGap)} (marginal ${marginalPct}%).`
    );
  }

  const expectingChild = Boolean(tp.expecting_child);
  const dueMonth = String(tp.expected_child_due_month || '').trim();

  const rawAutoSync = (rawDetails?.payroll_autosync as Record<string, unknown>) || {};
  const autoSyncRules = Array.isArray(rawAutoSync.rules)
    ? (rawAutoSync.rules as Array<Record<string, unknown>>)
        .filter((r) => r && r.enabled !== false)
        .map((r) =>
          compactObj({
            type: r.type,
            owner: r.owner === 'spouse' ? spouseName : primaryName,
            label: r.label,
            pay_frequency: r.pay_frequency,
            start_date: r.start_date,
            last_synced_date: r.last_synced_date || undefined,
            ...(r.type === 'espp'
              ? {
                  symbol: r.symbol || undefined,
                  amount_mode: r.amount_mode || undefined,
                  espp_per_check: r2(Math.max(0, num(r.espp_per_check))),
                  espp_pct_of_base: r2(Math.max(0, num(r.espp_pct_of_base))),
                  discount_pct: num(r.discount_pct),
                  has_lookback: Boolean(r.has_lookback),
                  in_flight_accrued_cash_usd: r2(Math.max(0, num(r.accrued_cash))),
                  purchase_dates_mm_dd: Array.isArray(r.purchase_months_days)
                    ? r.purchase_months_days
                    : undefined,
                }
              : {
                  amount_mode: r.amount_mode || undefined,
                  employee_per_check: r2(Math.max(0, num(r.employee_per_check))),
                  employee_pct_of_base: r2(Math.max(0, num(r.employee_pct_of_base))),
                  employer_match_per_check: r2(Math.max(0, num(r.employer_match_per_check))),
                  after_tax_per_check: r2(Math.max(0, num(r.after_tax_per_check))),
                  annual_employee_cap: r2(Math.max(0, num(r.annual_employee_cap))),
                  target_allocations: Array.isArray(r.allocations) && r.allocations.length > 0
                    ? (r.allocations as Array<Record<string, unknown>>)
                        .filter((a) => a.symbol && num(a.pct) > 0)
                        .map((a) => `${String(a.symbol).toUpperCase()} ${num(a.pct)}%`)
                    : undefined,
                }),
          })
        )
        .filter(Boolean)
    : [];

  return compactObj({
    filing_status: filingStatus,
    state_code: stateCode || 'Not specified',
    dependents_count: dependentsCount,
    hsa_plan_type: hsaPlanType,
    hsa_contrib_ytd: r2(hsaYtd),
    hsa_remaining_by_ytd: hsaLimit > 0 ? r2(Math.max(0, hsaLimit - hsaYtd)) : undefined,
    risk_tolerance: taxProfile.risk_tolerance,
    financial_goals: taxProfile.financial_goals || undefined,
    combined_summary: compactObj({
      gross_cash_and_rsu_comp: r2(combinedGrossComp),
      total_comp_incl_employer_match_hsa_espp: r2(
        combinedGrossComp +
          p.raw.employerMatchAnnual +
          s.raw.employerMatchAnnual +
          p.raw.employerHsaAnnual +
          s.raw.employerHsaAnnual +
          p.raw.annualEsppGain +
          s.raw.annualEsppGain
      ),
      annual_pretax_deductions_from_paystubs: r2(combinedPreTax),
      est_2026_agi: r2(estAgi),
      deduction_used: usingItemized ? 'itemized' : 'standard',
      applied_deduction_usd: r2(appliedDed),
      est_2026_fed_marginal_bracket_pct: marginalPct,
      est_2026_fed_effective_rate_pct:
        combinedGrossComp > 0 ? r2((estFedTax / combinedGrossComp) * 100) : undefined,
      est_2026_fed_tax_liability: r2(estFedTax),
      projected_fed_payments_withheld_plus_est: hasAnyFedWh ? r2(projectedFedPayments) : undefined,
      est_fed_withholding_surplus_or_shortfall: hasAnyFedWh
        ? r2(projectedFedPayments - estFedTax)
        : undefined,
      est_supplemental_rsu_bonus_withholding_gap: r2(suppGap),
      combined_monthly_net_base_take_home: hasAnyTaxes
        ? r2(p.raw.avgMonthlyNetBase + s.raw.avgMonthlyNetBase)
        : undefined,
      combined_annual_net_base_take_home: hasAnyTaxes
        ? r2(p.raw.annualNetBase + s.raw.annualNetBase)
        : undefined,
    }),
    itemized_and_salt_2026:
      mortgageInterest > 0 || propertyTax > 0 || stateOverride > 0 || charitable > 0 || otherItemized > 0
        ? compactObj({
            deduction_mode: deductionMode,
            mortgage_interest_annual: r2(mortgageInterest),
            property_tax_annual: r2(propertyTax),
            state_local_tax_for_salt: r2(stateTaxForSalt),
            raw_salt_paid: r2(rawSaltPaid),
            effective_2026_obbba_salt_cap: r2(saltEffectiveCap),
            in_salt_30pct_phaseout_zone: inSaltPhaseout,
            deductible_salt: r2(deductibleSalt),
            charitable_donations: r2(charitable),
            other_itemized: r2(otherItemized),
            total_itemized_deductions: r2(totalItemized),
            standard_deduction: r2(stdDed),
            excess_over_standard_w4_4b_benchmark: r2(excessOverStd),
          })
        : undefined,
    w4_and_state_withholding: compactObj({
      primary_w4_step4b_deductions: r2(primaryW4Ded),
      primary_w4_step4c_extra_per_check: r2(primaryW4Extra),
      primary_state_allowances: primaryStateAllow,
      spouse_w4_step4b_deductions: r2(spouseW4Ded),
      spouse_w4_step4c_extra_per_check: r2(spouseW4Extra),
      spouse_state_allowances: spouseStateAllow,
      fed_estimated_payments_ytd: r2(fedEstPaidYtd),
      state_estimated_payments_ytd: r2(stateEstPaidYtd),
      withholding_notes: String(tp.withholding_notes || '').trim() || undefined,
    }),
    capital_losses_and_gains:
      totalCf > 0 || totalYtdGains > 0 || totalYtdLosses > 0
        ? compactObj({
            prior_year_st_loss_carryforward: r2(cfSt),
            prior_year_lt_loss_carryforward: r2(cfLt),
            ytd_2026_st_losses: r2(ytdLossesSt),
            ytd_2026_lt_losses: r2(ytdLossesLt),
            ytd_2026_st_gains: r2(ytdGainsSt),
            ytd_2026_lt_gains: r2(ytdGainsLt),
            gains_shielded_tax_free_2026: r2(capGainsShielded),
            ordinary_income_deduction_2026: r2(capLossOrdDed),
            remaining_carryforward_into_2027: r2(remainingCfTo2027),
            net_taxable_cap_gain_2026: r2(netTaxableCapGain),
          })
        : undefined,
    prior_year_2025_tax_baseline: compactObj({
      agi_2025: r2(priorAgi),
      fed_total_tax_2025_line24: r2(priorFedTax),
      state_total_tax_2025: r2(priorStateTax),
      fed_refund_positive_or_owed_negative_2025:
        Math.abs(priorRefundOrOwed) > 0.01 ? r2(priorRefundOrOwed) : undefined,
      itemized_in_2025: Boolean(tp.prior_year_itemized),
      safe_harbor_multiplier_pct: priorFedTax > 0 || priorStateTax > 0 ? Math.round(shMult * 100) : undefined,
      fed_safe_harbor_required_2026: priorFedTax > 0 ? r2(fedShRequired) : undefined,
      fed_safe_harbor_status:
        fedShMet === true ? 'met' : fedShMet === false ? 'shortfall' : undefined,
      state_safe_harbor_target_2026: priorStateTax > 0 ? r2(stateShTarget) : undefined,
      state_safe_harbor_status:
        stateShMet === true ? 'met' : stateShMet === false ? 'shortfall' : undefined,
      notes_2025: String(tp.prior_year_notes || '').trim() || undefined,
    }),
    upcoming_life_events: compactObj({
      expecting_child: expectingChild,
      expected_child_due_month: dueMonth || undefined,
      planned_529_annual: r2(Math.max(0, num(tp.planned_529_annual))),
      expected_parental_leave_income_dip: r2(Math.max(0, num(tp.expected_leave_income_dip))),
      expected_delivery_oop_cash_buffer: r2(Math.max(0, num(tp.expected_delivery_oop_buffer))),
      life_event_notes: String(tp.life_event_notes || '').trim() || undefined,
    }),
    primary_pay_and_paystub: p.json,
    spouse_pay_and_paystub: s.json,
    payroll_autosync_schedules: autoSyncRules.length > 0 ? autoSyncRules : undefined,
    paystub_alerts: alerts.length > 0 ? alerts : undefined,
  });
}

function buildSanitizedFinancialContext(params: {
  accounts: Array<Record<string, unknown>>;
  holdings: Array<Record<string, unknown>>;
  promos: Array<Record<string, unknown>>;
  expenses: Array<Record<string, unknown>>;
  bills: Array<Record<string, unknown>>;
  budgets: Array<Record<string, unknown>>;
  household: Record<string, unknown> | null;
  taxProfile: Record<string, unknown> | null;
  scope: string;
  includeNotes: boolean;
}) {
  const {
    accounts,
    holdings,
    promos,
    expenses,
    bills,
    budgets,
    household,
    taxProfile,
    scope,
    includeNotes,
  } = params;

  const primaryName = String(household?.primary_name || 'Primary');
  const spouseName = String(household?.spouse_name || 'Spouse');
  const ownerLabel = (profile: unknown) => {
    if (profile === 'spouse') return spouseName;
    if (profile === 'joint') return 'Joint';
    return primaryName;
  };

  const activeAccounts = accounts.filter((a) => !a.is_archived);
  const accMap = new Map<number, Record<string, unknown>>();
  for (const a of activeAccounts) accMap.set(Number(a.id), a);

  const byOwner: Record<string, { assets: number; liabilities: number; netWorth: number }> = {
    primary: { assets: 0, liabilities: 0, netWorth: 0 },
    spouse: { assets: 0, liabilities: 0, netWorth: 0 },
    joint: { assets: 0, liabilities: 0, netWorth: 0 },
    combined: { assets: 0, liabilities: 0, netWorth: 0 },
  };

  const byCategory: Record<string, number> = {};
  for (const a of activeAccounts) {
    const bal = num(a.current_balance);
    const owner = byOwner[String(a.owner_profile)] ? String(a.owner_profile) : 'primary';
    const cat = String(a.category || 'other_asset');
    byCategory[cat] = (byCategory[cat] || 0) + bal;
    if (a.is_liability) {
      byOwner[owner].liabilities += bal;
      byOwner.combined.liabilities += bal;
    } else {
      byOwner[owner].assets += bal;
      byOwner.combined.assets += bal;
    }
  }
  for (const k of Object.keys(byOwner)) {
    byOwner[k].netWorth = byOwner[k].assets - byOwner[k].liabilities;
  }

  // Accounts list (PII-scrubbed: no VINs, no user_id, optional notes)
  const sanitizedAccounts = activeAccounts.map((a) => {
    const meta = (a.metadata || {}) as Record<string, unknown>;
    const linkedLoanId = Number(meta.linked_loan_id || 0);
    const linkedLoan = linkedLoanId ? accMap.get(linkedLoanId) : null;

    const item: Record<string, unknown> = {
      name: a.name,
      owner: ownerLabel(a.owner_profile),
      category: a.category,
      subtype: a.subtype,
      institution: a.institution || undefined,
      is_liability: Boolean(a.is_liability),
      balance_usd: Number(num(a.current_balance).toFixed(2)),
    };

    if (!a.is_liability && num(a.cash_balance) > 0) {
      item.uninvested_cash_usd = Number(num(a.cash_balance).toFixed(2));
    }
    if (num(a.interest_rate) > 0) item.rate_pct = num(a.interest_rate);
    if (num(a.credit_limit) > 0) item.credit_limit_usd = num(a.credit_limit);
    if (num(a.original_principal) > 0) item.original_principal_usd = num(a.original_principal);
    if (num(a.minimum_payment) > 0) item.monthly_payment_usd = num(a.minimum_payment);

    if (meta.real_asset_type === 'gold') {
      item.real_asset_details = {
        type: 'physical_gold',
        weight: meta.gold_weight,
        unit: meta.gold_unit,
        purity: meta.gold_purity,
        spot_usd_per_oz: meta.last_gold_oz_price,
      };
    } else if (meta.real_asset_type === 'india_property') {
      item.real_asset_details = {
        type: 'india_property',
        inr_amount: meta.inr_amount,
        inr_unit: meta.inr_unit,
        usd_inr_rate: meta.last_usd_inr_rate,
        city: meta.property_location || undefined,
      };
    } else if (meta.real_asset_type === 'real_estate') {
      item.real_asset_details = {
        type: 'us_real_estate',
        city: meta.property_location || undefined,
        purchase_price_usd: meta.purchase_price || undefined,
        linked_mortgage: linkedLoan ? linkedLoan.name : undefined,
        net_equity_usd: linkedLoan
          ? Number((num(a.current_balance) - num(linkedLoan.current_balance)).toFixed(2))
          : undefined,
      };
    } else if (meta.real_asset_type === 'vehicle') {
      // Deliberately omit VIN from LLM prompt for privacy
      item.real_asset_details = {
        type: 'vehicle',
        vehicle: [meta.vehicle_year, meta.vehicle_make, meta.vehicle_model, meta.vehicle_trim]
          .filter(Boolean)
          .join(' '),
        linked_auto_loan: linkedLoan ? linkedLoan.name : undefined,
        net_equity_usd: linkedLoan
          ? Number((num(a.current_balance) - num(linkedLoan.current_balance)).toFixed(2))
          : undefined,
      };
    }

    if (includeNotes && a.notes) item.notes = a.notes;
    return item;
  });

  // Employer-restricted tickers (RSU/ESPP/custom) — insider trading guardrail (no options/hedging)
  const restrictedOptionTickers = new Set<string>();
  for (const h of holdings) {
    if (!accMap.has(Number(h.account_id))) continue;
    if (h.holding_type === 'rsu' || h.holding_type === 'espp') {
      const sym = String(h.symbol || '').trim().toUpperCase();
      if (sym) restrictedOptionTickers.add(sym);
    }
  }
  const tpDetails = (taxProfile?.paystub_details || {}) as Record<string, unknown>;
  const syncRules = (tpDetails?.payroll_autosync as Record<string, unknown> | undefined)?.rules;
  if (Array.isArray(syncRules)) {
    for (const r of syncRules as Array<Record<string, unknown>>) {
      if (r && r.type === 'espp' && r.enabled !== false && r.symbol) {
        const sym = String(r.symbol).trim().toUpperCase();
        if (sym) restrictedOptionTickers.add(sym);
      }
    }
  }
  const rawCustomRestricted = String(
    (tpDetails?.tax_planning as Record<string, unknown> | undefined)?.restricted_option_tickers || ''
  );
  for (const tok of rawCustomRestricted.split(/[\s,;]+/)) {
    const sym = tok.trim().toUpperCase();
    if (/^[A-Z0-9.\-^=]{1,14}$/.test(sym)) restrictedOptionTickers.add(sym);
  }
  if (restrictedOptionTickers.has('GOOG')) restrictedOptionTickers.add('GOOGL');
  if (restrictedOptionTickers.has('GOOGL')) restrictedOptionTickers.add('GOOG');

  // Equity holdings + Covered Call (100+ shares) eligibility & CSP cash capacity (excluding restricted tickers)
  const sanitizedHoldings = holdings
    .filter((h) => accMap.has(Number(h.account_id)))
    .map((h) => {
      const acc = accMap.get(Number(h.account_id))!;
      const vested = num(h.shares);
      const unvested = num(h.unvested_shares);
      const price = num(h.last_price);
      const symUpper = String(h.symbol || '').trim().toUpperCase();
      const isRestricted =
        h.holding_type === 'rsu' ||
        h.holding_type === 'espp' ||
        restrictedOptionTickers.has(symUpper);
      return {
        account: acc.name,
        owner: ownerLabel(acc.owner_profile),
        account_category: acc.category,
        symbol: h.symbol,
        type: h.holding_type,
        vested_shares: vested,
        unvested_shares: unvested,
        price_usd: price,
        vested_value_usd: Number((vested * price).toFixed(2)),
        unvested_value_usd: Number((unvested * price).toFixed(2)),
        cost_basis_per_share: h.cost_basis_per_share !== null ? num(h.cost_basis_per_share) : undefined,
        options_restricted_employer_stock: isRestricted ? true : undefined,
        covered_call_contracts_eligible: isRestricted ? 0 : Math.floor(vested / 100),
      };
    });

  // Active 0% Balance Transfer Promos
  const today = new Date().toISOString().slice(0, 10);
  const activePromos = promos
    .filter((p) => !p.is_paid_off && num(p.promo_balance) > 0)
    .map((p) => {
      const acc = accMap.get(Number(p.account_id));
      return {
        card: acc?.name || 'Credit Card',
        owner: acc ? ownerLabel(acc.owner_profile) : primaryName,
        label: p.label,
        promo_balance_usd: num(p.promo_balance),
        promo_apr_pct: num(p.promo_apr),
        revert_apr_pct: p.standard_apr !== null ? num(p.standard_apr) : undefined,
        expires_on: p.expires_on,
      };
    });

  // Monthly Expenses summary (last 3 months grouped, netting Money Back / Credit entries)
  const monthlySpend: Record<
    string,
    {
      gross: number;
      credits: number;
      essentialGross: number;
      essentialCredits: number;
      byCategoryNet: Record<string, number>;
    }
  > = {};
  for (const e of expenses) {
    const mk = String(e.expense_date || '').slice(0, 7);
    if (!mk) continue;
    if (!monthlySpend[mk]) {
      monthlySpend[mk] = {
        gross: 0,
        credits: 0,
        essentialGross: 0,
        essentialCredits: 0,
        byCategoryNet: {},
      };
    }
    const amt = Math.abs(num(e.amount));
    const isCredit = e.entry_type === 'credit';
    if (isCredit) {
      monthlySpend[mk].credits += amt;
      if (e.is_essential) monthlySpend[mk].essentialCredits += amt;
    } else {
      monthlySpend[mk].gross += amt;
      if (e.is_essential) monthlySpend[mk].essentialGross += amt;
    }
    const cat = String(e.category || 'Other');
    monthlySpend[mk].byCategoryNet[cat] =
      (monthlySpend[mk].byCategoryNet[cat] || 0) + (isCredit ? -amt : amt);
  }
  const recentMonths = Object.entries(monthlySpend)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3)
    .map(([month, data]) => {
      const netSpent = data.gross - data.credits;
      const essentialNet = Math.max(0, data.essentialGross - data.essentialCredits);
      const item: Record<string, unknown> = {
        month,
        net_spent_usd: r2(netSpent),
        essential_net_usd: r2(essentialNet),
        top_categories: Object.entries(data.byCategoryNet)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([c, amt]) => ({ category: c, net_usd: r2(amt) })),
      };
      if (data.credits > 0) {
        item.gross_spent_usd = r2(data.gross);
        item.money_back_credits_usd = r2(data.credits);
      }
      return item;
    });

  let recurringBillsMonthly = 0;
  let recurringCreditsMonthly = 0;
  for (const b of bills) {
    if (!b.is_active) continue;
    const amt = Math.abs(num(b.amount));
    const monthlyAmt =
      b.cadence === 'annual' ? amt / 12 : b.cadence === 'quarterly' ? amt / 3 : amt;
    if (b.entry_type === 'credit') recurringCreditsMonthly += monthlyAmt;
    else recurringBillsMonthly += monthlyAmt;
  }
  const recurringMonthlyTotal = Math.max(0, recurringBillsMonthly - recurringCreditsMonthly);

  const budgetMap: Record<string, number> = {};
  for (const b of budgets) {
    budgetMap[String(b.category)] = num(b.monthly_limit);
  }

  const brokerageCashForCsp = activeAccounts
    .filter((a) => a.category === 'investment')
    .reduce((sum, a) => sum + num(a.cash_balance), 0);

  const summaryBlock = {
    as_of_date: today,
    active_ui_scope: scope,
    household_names: { primary: primaryName, spouse: spouseName },
    net_worth_split: {
      combined: {
        assets: usd(byOwner.combined.assets),
        liabilities: usd(byOwner.combined.liabilities),
        net_worth: usd(byOwner.combined.netWorth),
      },
      [primaryName]: {
        assets: usd(byOwner.primary.assets),
        liabilities: usd(byOwner.primary.liabilities),
        net_worth: usd(byOwner.primary.netWorth),
      },
      [spouseName]: {
        assets: usd(byOwner.spouse.assets),
        liabilities: usd(byOwner.spouse.liabilities),
        net_worth: usd(byOwner.spouse.netWorth),
      },
      ...(byOwner.joint.assets > 0 || byOwner.joint.liabilities > 0
        ? {
            joint: {
              assets: usd(byOwner.joint.assets),
              liabilities: usd(byOwner.joint.liabilities),
              net_worth: usd(byOwner.joint.netWorth),
            },
          }
        : {}),
    },
    category_totals_usd: Object.fromEntries(
      Object.entries(byCategory).map(([k, v]) => [k, Number(v.toFixed(2))])
    ),
    accounts: sanitizedAccounts,
    equity_and_rsu_holdings: sanitizedHoldings,
    options_income_readiness: {
      uninvested_brokerage_cash_usd: Number(brokerageCashForCsp.toFixed(2)),
      liquid_bank_cash_usd: Number((byCategory.bank || 0).toFixed(2)),
      employer_restricted_no_options_tickers:
        restrictedOptionTickers.size > 0
          ? Array.from(restrictedOptionTickers).sort()
          : undefined,
      covered_call_eligible_lots: sanitizedHoldings
        .filter((h) => !h.options_restricted_employer_stock && h.covered_call_contracts_eligible >= 1)
        .map((h) => ({
          account: h.account,
          symbol: h.symbol,
          shares: h.vested_shares,
          max_contracts: h.covered_call_contracts_eligible,
          price_usd: h.price_usd,
        })),
      ...(() => {
        const rawDesk = (tpDetails?.options_desk || {}) as Record<string, unknown>;
        const rawPositions = Array.isArray(rawDesk.positions)
          ? (rawDesk.positions as Array<Record<string, unknown>>)
          : [];
        const openPositions = rawPositions
          .filter((p) => p && p.status === 'open')
          .slice(0, 20)
          .map((p) => ({
            strategy: String(p.strategy || 'csp'),
            symbol: String(p.symbol || ''),
            contracts: num(p.contracts),
            strike: num(p.strike),
            long_strike: num(p.long_strike) > 0 ? num(p.long_strike) : undefined,
            expiration: String(p.expiration || ''),
            credit_per_share: num(p.premium_per_share),
            cost_basis: num(p.cost_basis) > 0 ? num(p.cost_basis) : undefined,
          }));
        return {
          options_desk_risk_profile:
            typeof rawDesk.risk_profile === 'string' ? rawDesk.risk_profile : undefined,
          options_desk_reserve_months:
            num(rawDesk.reserve_months) > 0 ? num(rawDesk.reserve_months) : undefined,
          active_tracked_options: openPositions.length > 0 ? openPositions : undefined,
        };
      })(),
    },
    active_zero_pct_promos: activePromos,
    recent_monthly_expenses: recentMonths,
    recurring_bills_monthly_baseline_usd: r2(recurringMonthlyTotal),
    recurring_credits_monthly_usd:
      recurringCreditsMonthly > 0 ? r2(recurringCreditsMonthly) : undefined,
    budgets: Object.keys(budgetMap).length > 0 ? budgetMap : undefined,
    tax_and_comp_profile: taxProfile
      ? buildPaystubSnapshot(taxProfile, primaryName, spouseName)
      : 'Not filled in yet — remind user they can fill in the zero-PII Paystub & Tax Engine panel for exact paycheck, withholding, and IRS headroom math.',
  };

  return {
    jsonContext: JSON.stringify(summaryBlock),
    stats: {
      accountCount: activeAccounts.length,
      holdingCount: sanitizedHoldings.length,
      promoCount: activePromos.length,
      hasTaxProfile: Boolean(
        taxProfile &&
          (num(taxProfile.primary_base_salary) > 0 || num(taxProfile.spouse_base_salary) > 0)
      ),
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResp({ error: 'Missing Authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResp({ error: 'Supabase environment not configured' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResp({ error: 'Unauthorized session' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const anthropicKey = (Deno.env.get('ANTHROPIC_API_KEY') || '').trim();
    const geminiKey = (Deno.env.get('GEMINI_API_KEY') || '').trim();

    // Quick status check so the UI knows which provider secrets are wired up
    if (body?.action === 'status') {
      return jsonResp({
        configured: Boolean(anthropicKey || geminiKey),
        providers: {
          anthropic: Boolean(anthropicKey),
          gemini: Boolean(geminiKey),
        },
        defaultModel: 'claude-haiku-5-5',
        models: ALLOWED_MODELS,
      });
    }

    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
    const cleanedMessages = rawMessages
      .filter(
        (m: unknown): m is { role: string; text: string } =>
          Boolean(m) &&
          typeof (m as { text?: unknown }).text === 'string' &&
          (m as { text: string }).text.trim().length > 0
      )
      .slice(-12);

    if (cleanedMessages.length === 0) {
      return jsonResp({ error: 'Please send at least one message.' }, 400);
    }

    const requestedModel = String(body?.model || 'claude-haiku-5-5');
    const model = ALLOWED_MODEL_IDS.has(requestedModel) ? requestedModel : 'claude-haiku-5-5';
    const provider = model.startsWith('claude-') ? 'anthropic' : 'gemini';
    const scope = String(body?.scope || 'combined');
    const includeNotes = Boolean(body?.includeNotes);
    const wantStream = Boolean(body?.stream);

    if (provider === 'anthropic' && !anthropicKey) {
      return jsonResp({
        configured: false,
        missingProvider: 'anthropic',
        error:
          'ANTHROPIC_API_KEY is not configured yet in Supabase Edge Function Secrets.',
      });
    }

    if (provider === 'gemini' && !geminiKey) {
      return jsonResp({
        configured: false,
        missingProvider: 'gemini',
        error:
          'GEMINI_API_KEY is not configured in Supabase Edge Function Secrets.',
      });
    }

    // Pull live vault records strictly under the caller's JWT (single-owner + AAL2 RLS enforced)
    const [accRes, holdRes, promoRes, expRes, billRes, budRes, hhRes, taxRes] = await Promise.all([
      supabase.from('accounts').select('*').order('id', { ascending: true }),
      supabase.from('equity_holdings').select('*').order('id', { ascending: true }),
      supabase.from('credit_card_promos').select('*').order('expires_on', { ascending: true }),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }).limit(500),
      supabase.from('recurring_bills').select('*').order('due_day', { ascending: true }),
      supabase.from('monthly_budgets').select('*'),
      supabase.from('household_settings').select('*').maybeSingle(),
      supabase.from('tax_comp_profiles').select('*').maybeSingle(),
    ]);

    if (accRes.error) {
      return jsonResp({ error: `Vault RLS check failed: ${accRes.error.message}` }, 403);
    }

    const { jsonContext, stats } = buildSanitizedFinancialContext({
      accounts: accRes.data || [],
      holdings: holdRes.data || [],
      promos: promoRes.data || [],
      expenses: expRes.data || [],
      bills: billRes.data || [],
      budgets: budRes.data || [],
      household: hhRes.data || null,
      taxProfile: taxRes.data || null,
      scope,
      includeNotes,
    });

    const systemInstruction = [
      'You are the private Family CFO, US Tax Optimization Strategist, and Portfolio Risk Advisor inside the user’s private "asfinance" household vault.',
      'Guidelines:',
      '1. Ground EVERY answer in the exact numbers from the LIVE HOUSEHOLD FINANCIAL SNAPSHOT below. Do not invent balances or accounts that are not listed.',
      '2. Be concrete, quantitative, and structured: use clear Markdown headings, bullet points, exact dollar figures, percentages, and prioritized action steps.',
      '3. Tax & Paystub Optimization ("tax cheat codes"): Analyze 2026 IRS & OBBBA rules ($24,500 employee 401k Trad+Roth, $72,000 total 415(c) Mega Backdoor Roth, HSA $4,400 self / $8,750 family incl. employer seed, Healthcare FSA $3,400 / LPFSA rules, Dependent Care FSA $7,500 MFJ / $3,750 MFS, ESPP §423 $25,000 FMV limit & qualifying disposition, Social Security wage base $184,500, standard deduction $32,200 MFJ / $16,100 single, OBBBA 2026 SALT cap $40,400 phasing down 30% above $505,000 MAGI to $10,000 floor, Child Tax Credit $2,200 phasing out above $400,000 MFJ, $1,000 Section 530A newborn Trump Account seed via Form 4547). When populated, audit itemized deductions vs. W-4 Step 4(b) deductions, state withholding allowances (for NY IT-2104, remember NY Schedule A excludes NY state income tax and phases out itemized deductions at higher NY AGI, and NY 529 offers up to $10,000/yr MFJ NY deduction), 2025 prior-year Safe Harbor (110% if 2025 AGI > $150k MFJ, or 90% of current-year tax), capital loss carryforward strategy ($3,000 ordinary offset + unlimited tax-free capital gain shielding for post-vest RSUs, covered call assignments, or rebalancing), upcoming baby timing (Dec 31 vs. Jan 1 tax-year cutoff, 30-day QLE for Family HSA & DCFSA, two-plan-year delivery OOP max & NY PFL), and US/India cross-border reporting reminders (FBAR/Form 8938) when India assets exist.',
      '4. Debt & 0% Promos: Always flag upcoming 0% balance transfer expirations and compute exact monthly payoff cash needed vs. liquid cash runway, and compare mortgage/auto loan APRs against after-tax risk-free yield.',
      '5. Covered Calls (CC), Cash-Secured Puts (CSP) & Capital Deployment: STRICT COMPLIANCE GUARDRAIL: NEVER recommend covered calls, cash-secured puts, collars, short sales, margin pledging, or any options/hedging trades on any ticker listed in options_income_readiness.employer_restricted_no_options_tickers (employer stock from RSU/ESPP grants across any household account), as corporate insider trading policies ban employee and household member derivatives on company stock. For restricted employer shares, only discuss outright sales/diversification during open trading windows and ESPP qualifying disposition timing. Otherwise, ONLY reference non-restricted eligible 100-share lots in covered_call_eligible_lots, actual available brokerage/IRA cash, and any tracked open trades in options_income_readiness.active_tracked_options. Emphasize low-to-medium risk discipline (position sizing, avoiding earnings week, 15–25 delta OTM strikes, 30–45 DTE, Treasury/SGOV/FDLXX state-tax-free double-dip collateral, defined-risk Put Credit Spreads for expensive tickers, and never risking emergency fund or 0% promo payoff cash). When a trade moves ITM or against the user, quantitatively compare (a) rolling up/down & out for a net credit (checking annualized roll yield on added days), (b) accepting assignment / Wheel transition (factoring capital loss carryforward tax shield), vs (c) closing for a loss (warning on the 30-day IRS wash-sale rule across taxable & IRA accounts).',
      '6. Privacy & Safety: Never ask for SSN, home street address, full account numbers, or passwords. Include a brief one-line reminder on major tax/legal strategies to verify with a CPA when executing.',
      '7. Keep responses concise and high-signal; avoid repetition or unnecessary filler so guidance stays crisp and actionable.',
      '',
      '=== LIVE HOUSEHOLD FINANCIAL SNAPSHOT (ANONYMIZED, RLS-VERIFIED) ===',
      jsonContext,
    ].join('\n');

    const resolveGeminiRequest = (targetModelId: string, isFallback = false) => {
      if (targetModelId === 'gemini-4-neon-medium') {
        return {
          apiModel: 'gemini-4-neon',
          generationConfig: { thinking_level: 'medium' as const },
        };
      }
      if (targetModelId === 'gemini-4-hydrogen') {
        return {
          apiModel: 'gemini-4-hydrogen',
          generationConfig: { thinking_level: (isFallback ? 'low' : 'medium') as const },
        };
      }
      return { apiModel: targetModelId, generationConfig: undefined };
    };

    const geminiSteps = cleanedMessages.map((m) => ({
      type: m.role === 'assistant' ? ('model_output' as const) : ('user_input' as const),
      content: [{ type: 'text' as const, text: m.text }],
    }));

    const streamGeminiModel = async (
      ai: GoogleGenAI,
      targetModelId: string,
      onDelta: (chunk: string) => void,
      isFallback = false,
      timeoutMs = 105000
    ) => {
      const { apiModel, generationConfig } = resolveGeminiRequest(targetModelId, isFallback);
      const stream = await ai.interactions.create(
        {
          model: apiModel,
          store: false,
          system_instruction: systemInstruction,
          input: geminiSteps,
          stream: true,
          ...(generationConfig ? { generation_config: generationConfig } : {}),
        },
        { maxRetries: 0, timeout: timeoutMs }
      );

      let replyText = '';
      let usage: unknown = null;

      for await (const event of stream) {
        if (event.event_type === 'step.delta') {
          const delta = event.delta as { type?: string; text?: string } | undefined;
          if (delta?.type === 'text' && typeof delta.text === 'string' && delta.text.length > 0) {
            replyText += delta.text;
            onDelta(delta.text);
          }
        } else if (event.event_type === 'interaction.completed') {
          usage = event.interaction?.usage || null;
          if (!replyText && event.interaction?.output_text) {
            replyText = event.interaction.output_text;
            onDelta(replyText);
          }
        } else if (
          event.event_type === 'error' ||
          ['failed', 'cancelled'].includes(String(event.interaction?.status || ''))
        ) {
          const errDetail =
            (event as { error?: { message?: string } }).error?.message ||
            (event.interaction as { error?: { message?: string } } | undefined)?.error?.message ||
            `Gemini interaction ended with status ${event.interaction?.status || 'error'}`;
          throw new Error(String(errDetail));
        }
      }

      return { reply: replyText.trim(), usage };
    };

    const FAST_GEMINI_FALLBACKS = ['gemini-4-hydrogen', 'gemini-3.5-flash-lite'];
    const reqStart = Date.now();

    // =========================================================================
    // LIVE SSE STREAMING PATH (Prevents Supabase 546 worker timeout)
    // =========================================================================
    if (wantStream) {
      const encoder = new TextEncoder();
      const bodyStream = new ReadableStream({
        async start(controller) {
          let closed = false;
          const sendEvent = (obj: Record<string, unknown>) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            } catch {
              closed = true;
            }
          };

          const heartbeat = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(': keepalive\n\n'));
            } catch {
              closed = true;
            }
          }, 8000);

          try {
            let emittedAnyText = false;
            let usedModel = model;
            let fallbackNote = '';
            let finalReply = '';
            let finalUsage: unknown = null;
            const attempts: Array<{ model: string; error: string }> = [];

            const onDelta = (chunk: string) => {
              if (!chunk) return;
              emittedAnyText = true;
              sendEvent({ type: 'delta', text: chunk });
            };

            sendEvent({
              type: 'status',
              model,
              text: `Thinking with ${ALLOWED_MODELS.find((x) => x.id === model)?.label || model}…`,
            });

            if (provider === 'anthropic') {
              try {
                const res = await streamAnthropicModel(
                  anthropicKey,
                  model,
                  systemInstruction,
                  cleanedMessages,
                  onDelta,
                  105000
                );
                finalReply = res.reply;
                finalUsage = res.usage;
              } catch (primaryErr) {
                const primaryMsg =
                  primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
                console.error(
                  `[finance-advisor] Stream Anthropic ${model} failed:`,
                  primaryMsg
                );
                attempts.push({ model, error: primaryMsg });

                const shouldFallback =
                  !emittedAnyText &&
                  Date.now() - reqStart < 95000 &&
                  model !== 'claude-haiku-4-5' &&
                  /404|429|500|502|503|504|529|overloaded|not_found|not found|timeout|timed out|AbortError/i.test(
                    primaryMsg
                  );

                if (shouldFallback) {
                  try {
                    sendEvent({
                      type: 'status',
                      model: 'claude-haiku-4-5',
                      text: `${model} busy — switching to Claude Haiku 4.5…`,
                    });
                    const res = await streamAnthropicModel(
                      anthropicKey,
                      'claude-haiku-4-5',
                      systemInstruction,
                      cleanedMessages,
                      onDelta,
                      35000
                    );
                    usedModel = 'claude-haiku-4-5';
                    fallbackNote = `${model} was temporarily unavailable or timed out. Answered automatically using Claude Haiku 4.5.`;
                    finalReply = res.reply;
                    finalUsage = res.usage;
                  } catch (fbErr) {
                    const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
                    attempts.push({ model: 'claude-haiku-4-5', error: fbMsg });
                  }
                }

                if (!finalReply) {
                  const detailText =
                    attempts.length > 1
                      ? 'Anthropic API error across models:\n' +
                        attempts.map((a) => `• ${a.model}: ${a.error}`).join('\n')
                      : `Anthropic API error (${model}): ${primaryMsg}`;
                  sendEvent({ type: 'error', error: detailText });
                  return;
                }
              }
            } else {
              const ai = new GoogleGenAI({ apiKey: geminiKey });
              try {
                const res = await streamGeminiModel(
                  ai,
                  model,
                  onDelta,
                  false,
                  105000
                );
                finalReply = res.reply;
                finalUsage = res.usage;
              } catch (primaryErr) {
                const primaryMsg =
                  primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
                console.error(`[finance-advisor] Stream Gemini ${model} failed:`, primaryMsg);
                attempts.push({ model, error: primaryMsg });

                const shouldFallback =
                  !emittedAnyText &&
                  Date.now() - reqStart < 95000 &&
                  /429|500|502|503|504|RESOURCE_EXHAUSTED|quota|limit:\s*0|high demand|overloaded|timeout|timed out|AbortError|not found|404|permission|403/i.test(
                    primaryMsg
                  );

                const chain = FAST_GEMINI_FALLBACKS.filter((m) => m !== model);
                if (shouldFallback && chain.length > 0) {
                  for (const fbModel of chain) {
                    if (Date.now() - reqStart >= 110000) break;
                    try {
                      sendEvent({
                        type: 'status',
                        model: fbModel,
                        text: `${model} busy/timed out — switching to ${fbModel}…`,
                      });
                      const res = await streamGeminiModel(
                        ai,
                        fbModel,
                        onDelta,
                        true,
                        30000
                      );
                      usedModel = fbModel;
                      fallbackNote = `${model} was temporarily unavailable or timed out. Answered automatically using ${fbModel}.`;
                      finalReply = res.reply;
                      finalUsage = res.usage;
                      break;
                    } catch (fbErr) {
                      const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
                      console.error(`[finance-advisor] Fallback stream ${fbModel} failed:`, fbMsg);
                      attempts.push({ model: fbModel, error: fbMsg });
                    }
                  }
                }

                if (!finalReply) {
                  const detailText =
                    attempts.length > 1
                      ? 'Gemini API error across models:\n' +
                        attempts.map((a) => `• ${a.model}: ${a.error}`).join('\n')
                      : `Gemini API error (${model}): ${primaryMsg}`;
                  sendEvent({ type: 'error', error: detailText });
                  return;
                }
              }
            }

            sendEvent({
              type: 'done',
              model: usedModel,
              requestedModel: model,
              fallbackNote: fallbackNote || undefined,
              reply: finalReply,
              usage: finalUsage,
              contextStats: stats,
            });
          } catch (streamErr) {
            const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
            sendEvent({ type: 'error', error: msg });
          } finally {
            clearInterval(heartbeat);
            closed = true;
            try {
              controller.close();
            } catch {
              // Ignore double-close
            }
          }
        },
      });

      return new Response(bodyStream, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    }

    // =========================================================================
    // NON-STREAMING FALLBACK PATH (Backward compatible for older cached bundles)
    // =========================================================================
    if (provider === 'anthropic') {
      let usedModel = model;
      let fallbackNote = '';
      let result: { reply: string; usage: { total_tokens: number; input_tokens: number; output_tokens: number } } | null = null;
      const attempts: Array<{ model: string; error: string }> = [];

      try {
        result = await callAnthropicModel(
          anthropicKey,
          model,
          systemInstruction,
          cleanedMessages,
          90000
        );
      } catch (primaryErr) {
        const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        console.error(`[finance-advisor] Primary Anthropic model ${model} failed:`, primaryMsg);
        attempts.push({ model, error: primaryMsg });

        const shouldFallback =
          Date.now() - reqStart < 85000 &&
          /404|429|500|502|503|504|529|overloaded|not_found|not found|timeout|timed out|AbortError/i.test(
            primaryMsg
          );

        if (shouldFallback && model !== 'claude-haiku-4-5') {
          try {
            result = await callAnthropicModel(
              anthropicKey,
              'claude-haiku-4-5',
              systemInstruction,
              cleanedMessages,
              35000
            );
            usedModel = 'claude-haiku-4-5';
            fallbackNote = `${model} was temporarily unavailable or unsupported on this endpoint. Answered automatically using claude-haiku-4-5.`;
          } catch (fbErr) {
            const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
            console.error('[finance-advisor] Fallback claude-haiku-4-5 failed:', fbMsg);
            attempts.push({ model: 'claude-haiku-4-5', error: fbMsg });
          }
        }

        if (!result) {
          const detailText =
            attempts.length > 1
              ? 'Anthropic API error across models:\n' +
                attempts.map((a) => `• ${a.model}: ${a.error}`).join('\n')
              : `Anthropic API error (${model}): ${primaryMsg}`;
          return jsonResp({
            configured: true,
            ok: false,
            error: detailText,
          });
        }
      }

      return jsonResp({
        configured: true,
        ok: true,
        reply: result.reply || 'No response text was returned by Claude.',
        model: usedModel,
        requestedModel: model,
        fallbackNote: fallbackNote || undefined,
        usage: result.usage,
        contextStats: stats,
      });
    }

    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const callModel = async (targetModelId: string, isFallback = false, timeoutMs = 90000) => {
      const { apiModel, generationConfig } = resolveGeminiRequest(targetModelId, isFallback);
      return await ai.interactions.create(
        {
          model: apiModel,
          store: false,
          system_instruction: systemInstruction,
          input: geminiSteps,
          ...(generationConfig ? { generation_config: generationConfig } : {}),
        },
        { maxRetries: 0, timeout: timeoutMs }
      );
    };

    let interaction;
    let usedModel = model;
    let fallbackNote = '';
    const attempts: Array<{ model: string; error: string }> = [];

    try {
      interaction = await callModel(model, false, 90000);
    } catch (primaryErr) {
      const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      console.error(`[finance-advisor] Primary model ${model} failed:`, primaryMsg);
      attempts.push({ model, error: primaryMsg });

      const shouldFallback =
        Date.now() - reqStart < 85000 &&
        /429|500|502|503|504|RESOURCE_EXHAUSTED|quota|limit:\s*0|high demand|overloaded|timeout|timed out|AbortError|not found|404|permission|403/i.test(
          primaryMsg
        );

      const fallbackChain = FAST_GEMINI_FALLBACKS.filter((m) => m !== model);

      if (shouldFallback && fallbackChain.length > 0) {
        for (const fbModel of fallbackChain) {
          if (Date.now() - reqStart >= 85000) break;
          try {
            interaction = await callModel(fbModel, true, 25000);
            usedModel = fbModel;
            fallbackNote = `${model} was temporarily unavailable or busy. Answered automatically using ${fbModel}.`;
            break;
          } catch (fbErr) {
            const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
            console.error(`[finance-advisor] Fallback model ${fbModel} failed:`, fbMsg);
            attempts.push({ model: fbModel, error: fbMsg });
          }
        }

        if (!interaction) {
          return jsonResp({
            configured: true,
            ok: false,
            error:
              'All Gemini models are currently unavailable or busy:\n' +
              attempts.map((a) => `• ${a.model}: ${a.error}`).join('\n'),
          });
        }
      } else {
        return jsonResp({
          configured: true,
          ok: false,
          error: `Gemini API error (${model}): ${primaryMsg}`,
        });
      }
    }

    const reply =
      interaction.output_text ||
      'No response text was returned by Gemini. Please try rephrasing or switching models.';

    return jsonResp({
      configured: true,
      ok: true,
      reply,
      model: usedModel,
      requestedModel: model,
      fallbackNote: fallbackNote || undefined,
      usage: interaction.usage || null,
      contextStats: stats,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Advisor request failed';
    console.error('[finance-advisor] Unhandled error:', message);
    return jsonResp({ configured: true, ok: false, error: message }, 200);
  }
});
