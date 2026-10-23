/**
 * Pure simulation model for the sell-or-store decision (DESIGN.md section 6.2).
 *
 * Computes:
 * - Historical monthly maize price seasonality from WFP data
 * - Detrended seasonal index S[m] normalized to mean 1
 * - Empirical ratio distribution r(m -> m+k) for horizons k in {1, 2, 3} months
 * - Storage weight loss discounting (plain sacks, treated sacks, PICS hermetic bags)
 * - Risk metric P(value < value of sell_now)
 * - Cash need constraint evaluation and partial sale option
 */

export interface MonthlyPriceRecord {
  ym: string; // "YYYY-MM"
  commodity: string;
  price_ngn_per_kg: number;
  pricetype?: string;
  unit?: string;
  market?: string;
  state?: string;
}

export interface CashNeed {
  amountNgn: number;
  dueInWeeks?: number;
  dueInMonths?: number;
  description?: string;
}

export interface SellingSimulationInput {
  prices: MonthlyPriceRecord[];
  asOf: string; // ISO date e.g. "2026-08-20"
  currentPricePerBag: number; // Stated by farmer
  bags: number; // Number of bags harvested
  bagWeightKg?: number; // default 100 kg
  storageMethod?: "sack" | "sack_treated" | "pics" | "silo" | string;
  monthlyLossPct?: number; // default based on storageMethod (2.5% for sack, 0.3% for pics)
  monthlyStorageCostPerBag?: number; // default 0 NGN
  cashNeed?: CashNeed;
  commodityPreference?: string; // default "Maize (white)"
}

export interface SellingOptionOutcome {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  riskMetric: number; // P(value < value of sell_now)
  riskLabel: string; // "chance of earning less than selling now"
  n: number;
}

export interface SellingOptionResult {
  option: "sell_now" | "store_4w" | "store_8w" | "store_12w" | "partial_sell_store_8w";
  label: string;
  horizonMonths: number;
  horizonWeeks: number;
  outcome: SellingOptionOutcome;
  score: number;
  notes: string[];
  dropped?: boolean;
  dropReason?: string;
  bagsSoldNow?: number;
  bagsStored?: number;
  cashGeneratedNow?: number;
  assumptions: {
    monthlyLossPct: number;
    monthlyStorageCostNgn: number;
    bagWeightKg: number;
  };
}

export interface SeasonalIndexResult {
  monthlyIndices: number[]; // Index for months 1..12, mean 1.0
  nYears: number;
  years: number[];
}

/**
 * Computes detrended seasonal index S[m] across complete calendar years (mean S = 1.0).
 */
export function computeSeasonalIndex(
  prices: MonthlyPriceRecord[],
  asOf: string,
  preferredCommodity = "Maize (white)"
): SeasonalIndexResult {
  const asOfYearMonth = asOf.slice(0, 7);
  // Filter historical prices strictly before asOf month
  const historical = prices.filter(
    (p) =>
      p.ym < asOfYearMonth &&
      (p.commodity.toLowerCase() === preferredCommodity.toLowerCase() ||
        p.commodity.toLowerCase().includes("maize"))
  );

  // Group by year and month
  const byYear = new Map<number, Map<number, number>>();
  for (const p of historical) {
    const pVal = Number(p.price_ngn_per_kg);
    if (!Number.isFinite(pVal) || pVal <= 0) continue;
    const y = parseInt(p.ym.slice(0, 4), 10);
    const m = parseInt(p.ym.slice(5, 7), 10);
    if (!byYear.has(y)) byYear.set(y, new Map());
    // If multiple prices exist for same year-month, take average
    const mmap = byYear.get(y)!;
    if (mmap.has(m)) {
      mmap.set(m, (mmap.get(m)! + pVal) / 2);
    } else {
      mmap.set(m, pVal);
    }
  }

  // Filter to years that have all 12 calendar months
  const completeYears: number[] = [];
  const detrendedByMonth: number[][] = Array.from({ length: 12 }, () => []);

  for (const [y, mmap] of byYear.entries()) {
    if (mmap.size === 12) {
      completeYears.push(y);
      let sum = 0;
      for (let m = 1; m <= 12; m++) {
        sum += mmap.get(m)!;
      }
      const annualMean = sum / 12;
      for (let m = 1; m <= 12; m++) {
        detrendedByMonth[m - 1].push(mmap.get(m)! / annualMean);
      }
    }
  }

  // If no year has all 12 months, fall back to years with at least 6 months
  if (completeYears.length === 0) {
    for (const [y, mmap] of byYear.entries()) {
      if (mmap.size >= 6) {
        completeYears.push(y);
        let sum = 0;
        for (const p of mmap.values()) sum += p;
        const mean = sum / mmap.size;
        for (const [m, p] of mmap.entries()) {
          detrendedByMonth[m - 1].push(p / mean);
        }
      }
    }
  }

  // Median across years for each month
  const rawMedians: number[] = [];
  for (let m = 0; m < 12; m++) {
    const vals = detrendedByMonth[m];
    if (vals.length === 0) {
      rawMedians.push(1.0);
    } else {
      vals.sort((a, b) => a - b);
      const mid = Math.floor(vals.length / 2);
      const med = vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
      rawMedians.push(med);
    }
  }

  // Normalize so mean of S[m] = 1.0
  const meanOfMedians = rawMedians.reduce((a, b) => a + b, 0) / 12;
  const normalizedIndices = rawMedians.map((v) => Number((v / meanOfMedians).toFixed(4)));

  return {
    monthlyIndices: normalizedIndices,
    nYears: completeYears.length,
    years: completeYears.sort(),
  };
}

/**
 * Computes empirical price ratios r(m -> m+k) across historical years strictly before asOf.
 */
export function computeSeasonalRatios(
  prices: MonthlyPriceRecord[],
  startMonth: number,
  horizonMonths: number,
  asOf: string,
  preferredCommodity = "Maize (white)"
): { ratios: number[]; years: number[] } {
  const asOfYearMonth = asOf.slice(0, 7);
  const historical = prices.filter(
    (p) =>
      p.ym < asOfYearMonth &&
      (p.commodity.toLowerCase() === preferredCommodity.toLowerCase() ||
        p.commodity.toLowerCase().includes("maize"))
  );

  const byYear = new Map<number, Map<number, number>>();
  for (const p of historical) {
    const pVal = Number(p.price_ngn_per_kg);
    if (!Number.isFinite(pVal) || pVal <= 0) continue;
    const y = parseInt(p.ym.slice(0, 4), 10);
    const m = parseInt(p.ym.slice(5, 7), 10);
    if (!byYear.has(y)) byYear.set(y, new Map());
    const mmap = byYear.get(y)!;
    if (mmap.has(m)) {
      mmap.set(m, (mmap.get(m)! + pVal) / 2);
    } else {
      mmap.set(m, pVal);
    }
  }

  const ratios: number[] = [];
  const validYears: number[] = [];

  const targetMonth = startMonth + horizonMonths;
  // If targetMonth <= 12, ratio is within the same year
  if (targetMonth <= 12) {
    for (const [y, mmap] of byYear.entries()) {
      if (mmap.has(startMonth) && mmap.has(targetMonth)) {
        const startPrice = mmap.get(startMonth)!;
        const targetPrice = mmap.get(targetMonth)!;
        if (startPrice > 0 && targetPrice > 0) {
          ratios.push(targetPrice / startPrice);
          validYears.push(y);
        }
      }
    }
  } else {
    // Crosses year boundary: year y startMonth to year y+1 (targetMonth - 12)
    const nextMonth = targetMonth - 12;
    for (const [y, mmap] of byYear.entries()) {
      const nextMap = byYear.get(y + 1);
      if (mmap.has(startMonth) && nextMap?.has(nextMonth)) {
        const startPrice = mmap.get(startMonth)!;
        const nextPrice = nextMap.get(nextMonth)!;
        if (startPrice > 0 && nextPrice > 0) {
          ratios.push(nextPrice / startPrice);
          validYears.push(y);
        }
      }
    }
  }

  // If no exact match across years, fall back to seasonal index ratio
  if (ratios.length === 0) {
    const sIdx = computeSeasonalIndex(prices, asOf, preferredCommodity);
    const m0 = (startMonth - 1) % 12;
    const m1 = (targetMonth - 1) % 12;
    const ratio = sIdx.monthlyIndices[m1] / sIdx.monthlyIndices[m0];
    ratios.push(ratio);
    validYears.push(2022);
  }

  return { ratios, years: validYears };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Pure simulation function for sell-or-store decision.
 */
export function simulateSelling(input: SellingSimulationInput): SellingOptionResult[] {
  const {
    prices,
    asOf,
    currentPricePerBag,
    bags,
    bagWeightKg = 100,
    storageMethod = "sack",
    monthlyStorageCostPerBag = 0,
    cashNeed,
    commodityPreference = "Maize (white)",
  } = input;

  if (bags <= 0) {
    throw new Error(`Invalid bags quantity: ${bags}`);
  }
  if (currentPricePerBag <= 0) {
    throw new Error(`Invalid current price per bag: ${currentPricePerBag}`);
  }

  // Determine monthly weight loss percentage
  let defaultLossPct = 2.5; // plain sack default
  if (input.monthlyLossPct !== undefined) {
    defaultLossPct = input.monthlyLossPct;
  } else if (storageMethod === "pics" || storageMethod === "silo") {
    defaultLossPct = 0.3;
  } else if (storageMethod === "sack_treated") {
    defaultLossPct = 1.0;
  }
  const monthlyLossRate = defaultLossPct / 100;

  const startMonth = parseInt(asOf.slice(5, 7), 10);
  const valueSellNow = bags * currentPricePerBag;

  // 1. Option: sell_now (k = 0)
  const sellNowResult: SellingOptionResult = {
    option: "sell_now",
    label: "Sell now",
    horizonMonths: 0,
    horizonWeeks: 0,
    outcome: {
      p10: valueSellNow,
      p50: valueSellNow,
      p90: valueSellNow,
      mean: valueSellNow,
      riskMetric: 0.0,
      riskLabel: "chance of earning less than selling now",
      n: 1,
    },
    score: valueSellNow,
    notes: ["Immediate cash with 0% storage weight loss and 0 market risk."],
    bagsSoldNow: bags,
    bagsStored: 0,
    cashGeneratedNow: valueSellNow,
    assumptions: {
      monthlyLossPct: defaultLossPct,
      monthlyStorageCostNgn: monthlyStorageCostPerBag,
      bagWeightKg,
    },
  };

  const results: SellingOptionResult[] = [sellNowResult];

  // Storage horizons: 4 weeks (1 mo), 8 weeks (2 mos), 12 weeks (3 mos)
  const horizons = [
    { key: "store_4w" as const, label: "Store 4 weeks", k: 1, weeks: 4 },
    { key: "store_8w" as const, label: "Store 8 weeks", k: 2, weeks: 8 },
    { key: "store_12w" as const, label: "Store 12 weeks", k: 3, weeks: 12 },
  ];

  for (const h of horizons) {
    const { ratios, years } = computeSeasonalRatios(
      prices,
      startMonth,
      h.k,
      asOf,
      commodityPreference
    );

    const remainingBags = bags * Math.pow(1 - monthlyLossRate, h.k);
    const storageCostTotal = monthlyStorageCostPerBag * bags * h.k;

    const values = ratios.map((r) => {
      const futurePricePerBag = currentPricePerBag * r;
      return remainingBags * futurePricePerBag - storageCostTotal;
    });

    values.sort((a, b) => a - b);

    const countLess = values.filter((v) => v < valueSellNow).length;
    const riskMetric = Number((countLess / values.length).toFixed(3));

    const p10 = Math.round(quantile(values, 0.1));
    const p50 = Math.round(quantile(values, 0.5));
    const p90 = Math.round(quantile(values, 0.9));
    const meanVal = Math.round(values.reduce((a, b) => a + b, 0) / values.length);

    // Score with risk-adjusted downside penalty
    const downside = Math.max(0, meanVal - p10);
    const score = Math.round(meanVal - 0.5 * downside);

    const notes: string[] = [];
    if (riskMetric >= 0.5) {
      notes.push(
        `High risk: in ${(riskMetric * 100).toFixed(0)}% of past years, prices fell after harvest and earned less than selling immediately.`
      );
    } else {
      notes.push(
        `Storage upside: in ${((1 - riskMetric) * 100).toFixed(0)}% of past years, price gains exceeded storage losses.`
      );
    }

    let dropped = false;
    let dropReason: string | undefined;

    // Check if cash need is broken
    if (cashNeed && cashNeed.amountNgn > 0) {
      const dueWeeks = cashNeed.dueInWeeks ?? (cashNeed.dueInMonths ? cashNeed.dueInMonths * 4 : 4);
      if (h.weeks > dueWeeks) {
        dropped = true;
        dropReason = `Dropped ${h.key}: all grain is held for ${h.weeks} weeks, leaving ₦0 cash to meet your ₦${cashNeed.amountNgn.toLocaleString()} need due in ${dueWeeks} weeks.`;
        notes.push(dropReason);
      }
    }

    results.push({
      option: h.key,
      label: h.label,
      horizonMonths: h.k,
      horizonWeeks: h.weeks,
      outcome: {
        p10,
        p50,
        p90,
        mean: meanVal,
        riskMetric,
        riskLabel: "chance of earning less than selling now",
        n: years.length,
      },
      score,
      notes,
      dropped,
      dropReason,
      bagsSoldNow: 0,
      bagsStored: bags,
      cashGeneratedNow: 0,
      assumptions: {
        monthlyLossPct: defaultLossPct,
        monthlyStorageCostNgn: monthlyStorageCostPerBag,
        bagWeightKg,
      },
    });
  }

  // 3. Option: partial_sell_store_8w (only when cash need is present)
  if (cashNeed && cashNeed.amountNgn > 0) {
    const bagsNeededNow = Math.min(bags, Math.ceil(cashNeed.amountNgn / currentPricePerBag));
    const bagsToStore = bags - bagsNeededNow;
    const cashNow = bagsNeededNow * currentPricePerBag;

    const { ratios, years } = computeSeasonalRatios(
      prices,
      startMonth,
      2, // 8 weeks = 2 months
      asOf,
      commodityPreference
    );

    const k = 2;
    const remainingStoredBags = bagsToStore * Math.pow(1 - monthlyLossRate, k);
    const storageCostTotal = monthlyStorageCostPerBag * bagsToStore * k;

    const values = ratios.map((r) => {
      const futurePricePerBag = currentPricePerBag * r;
      return cashNow + (remainingStoredBags * futurePricePerBag - storageCostTotal);
    });

    values.sort((a, b) => a - b);

    const countLess = values.filter((v) => v < valueSellNow).length;
    const riskMetric = Number((countLess / values.length).toFixed(3));

    const p10 = Math.round(quantile(values, 0.1));
    const p50 = Math.round(quantile(values, 0.5));
    const p90 = Math.round(quantile(values, 0.9));
    const meanVal = Math.round(values.reduce((a, b) => a + b, 0) / values.length);

    const downside = Math.max(0, meanVal - p10);
    const score = Math.round(meanVal - 0.5 * downside);

    results.push({
      option: "partial_sell_store_8w",
      label: "Sell partial now & store 8 weeks",
      horizonMonths: 2,
      horizonWeeks: 8,
      outcome: {
        p10,
        p50,
        p90,
        mean: meanVal,
        riskMetric,
        riskLabel: "chance of earning less than selling now",
        n: years.length,
      },
      score,
      notes: [
        `Sells ${bagsNeededNow} bags now to generate ₦${cashNow.toLocaleString()} (meeting cash need of ₦${cashNeed.amountNgn.toLocaleString()}), storing ${bagsToStore} bags for 8 weeks.`,
      ],
      dropped: false,
      bagsSoldNow: bagsNeededNow,
      bagsStored: bagsToStore,
      cashGeneratedNow: cashNow,
      assumptions: {
        monthlyLossPct: defaultLossPct,
        monthlyStorageCostNgn: monthlyStorageCostPerBag,
        bagWeightKg,
      },
    });
  }

  return results;
}
