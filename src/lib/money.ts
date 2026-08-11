import type { CurrencyCode } from "@/domain/contracts/taxonomy";
import { CURRENCY_CODES } from "@/domain/contracts/taxonomy";

export type MoneyAmount = {
  amount: string;
  currencyCode: CurrencyCode;
  scale: number;
};

export type MoneyValue = MoneyAmount;

type MoneyInput = MoneyAmount | string;
type ScalarInput = string | number | bigint;

const DEFAULT_CURRENCY_CODE: CurrencyCode = "USD";
const DEFAULT_SCALE = 2;
const MAX_SCALE = 6;
const MONEY_PATTERN = /^-?\d+(\.\d+)?$/;

const PARTNER_TIER_ADJUSTMENTS = {
  registered: "0",
  silver: "0.05",
  gold: "0.1",
  platinum: "0.15",
} as const;

/** Canonical partner tier ordering (product.md §9.4/§14.2's Registered <
 * Silver < Gold < Platinum), shared by pricing here and by Insight Hub's
 * tier-gated content (insight-hub.tsx, learning-commands.server.ts). */
export const PARTNER_TIER_ORDER = ["registered", "silver", "gold", "platinum"] as const;

/** True if a partner's own tier satisfies a content/feature's required
 * tier. No requirement always passes. An unrecognised (malformed seed
 * data) required tier fails closed rather than silently granting access. */
export function meetsPartnerTierRequirement(
  partnerTier: string | null | undefined,
  requiredTier: string | null | undefined,
): boolean {
  if (!requiredTier || !requiredTier.trim()) return true;
  const requiredIndex = PARTNER_TIER_ORDER.indexOf(
    requiredTier.trim().toLowerCase() as (typeof PARTNER_TIER_ORDER)[number],
  );
  if (requiredIndex === -1) return false;
  const actualIndex = PARTNER_TIER_ORDER.indexOf(
    (partnerTier ?? "registered").trim().toLowerCase() as (typeof PARTNER_TIER_ORDER)[number],
  );
  return actualIndex >= requiredIndex;
}

function assertScale(scale: number) {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new Error(`Money scale must be an integer between 0 and ${MAX_SCALE}`);
  }
}

function normalizeCurrencyCode(currencyCode: string): CurrencyCode {
  const normalized = currencyCode.trim().toUpperCase();
  if (!CURRENCY_CODES.includes(normalized as CurrencyCode)) {
    throw new Error("Currency code must be a supported ISO code");
  }
  return normalized as CurrencyCode;
}

function isPlainDecimal(value: string) {
  const trimmed = value.trim();
  return MONEY_PATTERN.test(trimmed) && !/[,_\s₹$€£]/.test(trimmed);
}

function decimalToUnits(value: string, scale: number, errorMessage: string) {
  const trimmed = value.trim();
  if (!isPlainDecimal(trimmed)) {
    throw new Error(errorMessage);
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  if (fractionPart.length > scale) {
    throw new Error(`Money amount has too many decimal places for scale ${scale}`);
  }

  const digits = `${wholePart}${fractionPart.padEnd(scale, "0")}`;
  const units = BigInt(digits || "0");
  return negative ? -units : units;
}

function unitsToDecimal(units: bigint, scale: number) {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const digits = absolute.toString();

  if (scale === 0) {
    return `${negative && absolute !== 0n ? "-" : ""}${digits}`;
  }

  const padded = digits.padStart(scale + 1, "0");
  const wholePart = padded.slice(0, -scale);
  const fractionPart = padded.slice(-scale);
  const sign = negative && absolute !== 0n ? "-" : "";
  return `${sign}${wholePart}.${fractionPart}`;
}

function roundUnits(units: bigint, sourceScale: number, targetScale: number) {
  assertScale(targetScale);

  if (targetScale === sourceScale) {
    return units;
  }

  if (targetScale > sourceScale) {
    return units * 10n ** BigInt(targetScale - sourceScale);
  }

  const factor = 10n ** BigInt(sourceScale - targetScale);
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const quotient = absolute / factor;
  const remainder = absolute % factor;
  const rounded = quotient + (remainder * 2n >= factor ? 1n : 0n);
  return negative ? -rounded : rounded;
}

function parseScalar(input: ScalarInput) {
  if (typeof input === "bigint") {
    return { units: input, scale: 0 };
  }

  const raw =
    typeof input === "number" ? (Number.isFinite(input) ? String(input) : "") : input.trim();
  if (!raw || !isPlainDecimal(raw)) {
    throw new Error("Scalar value must be a plain decimal without separators or symbols");
  }

  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  const units = BigInt(`${wholePart}${fractionPart}`);
  return {
    units: negative ? -units : units,
    scale: fractionPart.length,
  };
}

function coerceMoney(input: MoneyInput, currencyCode?: CurrencyCode): MoneyValue {
  if (typeof input === "string") {
    const requestedCurrency = normalizeCurrencyCode(currencyCode ?? DEFAULT_CURRENCY_CODE);
    const trimmed = input.trim();
    const scale = trimmed.includes(".") ? trimmed.split(".")[1].length : DEFAULT_SCALE;
    assertScale(scale);
    return {
      amount: unitsToDecimal(
        decimalToUnits(trimmed, scale, "Money string must be a plain decimal without separators or symbols"),
        scale,
      ),
      currencyCode: requestedCurrency,
      scale,
    };
  }

  if (!input || typeof input !== "object") {
    throw new Error("Money value must be an object");
  }

  const candidate = input as Partial<MoneyValue>;
  if (!candidate.currencyCode || !candidate.amount || candidate.scale === undefined) {
    throw new Error("Money value requires currencyCode, amount, and scale");
  }

  const normalizedCurrency = normalizeCurrencyCode(candidate.currencyCode);
  assertScale(candidate.scale);

  return {
    amount: unitsToDecimal(
      decimalToUnits(candidate.amount, candidate.scale, "Money amount must be a plain decimal string"),
      candidate.scale,
    ),
    currencyCode: normalizedCurrency,
    scale: candidate.scale,
  };
}

function moneyToUnits(value: MoneyValue, targetScale = value.scale) {
  const parsed = decimalToUnits(value.amount, value.scale, "Money amount must be a plain decimal string");
  return roundUnits(parsed, value.scale, targetScale);
}

function ensureSameCurrency(left: MoneyValue, right: MoneyValue) {
  if (left.currencyCode !== right.currencyCode) {
    throw new Error("Money values must use the same currency");
  }
}

function zeroMoney(currencyCode: CurrencyCode, scale = DEFAULT_SCALE): MoneyValue {
  assertScale(scale);
  return {
    amount: unitsToDecimal(0n, scale),
    currencyCode,
    scale,
  };
}

function parsePartnerTierAdjustment(partnerTier: string) {
  const normalized = partnerTier.trim().toLowerCase();
  const adjustment = PARTNER_TIER_ADJUSTMENTS[normalized as keyof typeof PARTNER_TIER_ADJUSTMENTS];
  if (!adjustment) {
    throw new Error(`Unsupported partner tier: ${partnerTier}`);
  }
  return adjustment;
}

function multiplyUnitsByScalar(units: bigint, unitScale: number, scalar: ScalarInput, resultScale: number) {
  const factor = parseScalar(scalar);
  const numerator = units * factor.units * 10n ** BigInt(resultScale);
  const denominator = 10n ** BigInt(unitScale + factor.scale);
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return negative ? -rounded : rounded;
}

function divideUnitsByScalar(units: bigint, unitScale: number, divisor: ScalarInput, resultScale: number) {
  const factor = parseScalar(divisor);
  if (factor.units === 0n) {
    throw new Error("Money division requires a non-zero divisor");
  }

  const numerator = units * 10n ** BigInt(resultScale + factor.scale);
  const denominator = (factor.units < 0n ? -factor.units : factor.units) * 10n ** BigInt(unitScale);
  const negative = (units < 0n) !== (factor.units < 0n);
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return negative ? -rounded : rounded;
}

export function parseMoney(value: MoneyInput, currencyCode?: CurrencyCode): MoneyValue {
  return coerceMoney(value, currencyCode);
}

export function formatMoney(value: MoneyInput, currencyCode?: CurrencyCode) {
  const money = coerceMoney(value, currencyCode);
  const negative = money.amount.startsWith("-");
  const unsigned = negative ? money.amount.slice(1) : money.amount;
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${money.currencyCode} ${negative ? "-" : ""}${money.scale === 0 ? groupedWhole : `${groupedWhole}.${fractionPart.padEnd(money.scale, "0")}`}`;
}

export function addMoney(left: MoneyInput, right: MoneyInput): MoneyValue {
  const lhs = coerceMoney(left);
  const rhs = coerceMoney(right, lhs.currencyCode);
  ensureSameCurrency(lhs, rhs);
  const scale = Math.max(lhs.scale, rhs.scale);
  const total = moneyToUnits(lhs, scale) + moneyToUnits(rhs, scale);
  return {
    amount: unitsToDecimal(total, scale),
    currencyCode: lhs.currencyCode,
    scale,
  };
}

export function subtractMoney(left: MoneyInput, right: MoneyInput): MoneyValue {
  const lhs = coerceMoney(left);
  const rhs = coerceMoney(right, lhs.currencyCode);
  ensureSameCurrency(lhs, rhs);
  const scale = Math.max(lhs.scale, rhs.scale);
  const total = moneyToUnits(lhs, scale) - moneyToUnits(rhs, scale);
  return {
    amount: unitsToDecimal(total, scale),
    currencyCode: lhs.currencyCode,
    scale,
  };
}

export function multiplyMoney(value: MoneyInput, factor: ScalarInput, resultScale?: number): MoneyValue {
  const money = coerceMoney(value);
  const scale = resultScale ?? money.scale;
  assertScale(scale);
  const units = moneyToUnits(money);
  const multiplied = multiplyUnitsByScalar(units, money.scale, factor, scale);
  return {
    amount: unitsToDecimal(multiplied, scale),
    currencyCode: money.currencyCode,
    scale,
  };
}

export function divideMoney(value: MoneyInput, divisor: ScalarInput, resultScale?: number): MoneyValue {
  const money = coerceMoney(value);
  const scale = resultScale ?? money.scale;
  assertScale(scale);
  const units = moneyToUnits(money);
  const divided = divideUnitsByScalar(units, money.scale, divisor, scale);
  return {
    amount: unitsToDecimal(divided, scale),
    currencyCode: money.currencyCode,
    scale,
  };
}

export function roundMoney(value: MoneyInput, scale: number): MoneyValue {
  const money = coerceMoney(value);
  assertScale(scale);
  const rounded = roundUnits(moneyToUnits(money), money.scale, scale);
  return {
    amount: unitsToDecimal(rounded, scale),
    currencyCode: money.currencyCode,
    scale,
  };
}

export function calculateMsrpTotal(input: { unitMsrp: MoneyInput; quantity: ScalarInput; resultScale?: number }) {
  const unitMsrp = coerceMoney(input.unitMsrp);
  const quantity = parseScalar(input.quantity);
  if (quantity.scale !== 0) {
    throw new Error("Quantity must be a whole number");
  }
  if (quantity.units < 0n) {
    throw new Error("Quantity must be non-negative");
  }

  const scale = input.resultScale ?? unitMsrp.scale;
  return multiplyMoney(unitMsrp, quantity.units, scale);
}

export function calculatePartnerTransferPrice(input: {
  msrpTotal: MoneyInput;
  partnerTier: string;
  resultScale?: number;
}) {
  const msrpTotal = coerceMoney(input.msrpTotal);
  const scale = input.resultScale ?? msrpTotal.scale;
  const adjustment = parsePartnerTierAdjustment(input.partnerTier);
  const discount = multiplyMoney(msrpTotal, adjustment, scale);
  return subtractMoney(roundMoney(msrpTotal, scale), discount);
}

export function calculateDiscountedTransferPrice(input: {
  partnerTransferPrice: MoneyInput;
  additionalDiscount: MoneyInput;
  resultScale?: number;
}) {
  const partnerTransferPrice = coerceMoney(input.partnerTransferPrice);
  const additionalDiscount = coerceMoney(input.additionalDiscount, partnerTransferPrice.currencyCode);
  ensureSameCurrency(partnerTransferPrice, additionalDiscount);
  const scale = input.resultScale ?? Math.max(partnerTransferPrice.scale, additionalDiscount.scale);
  return subtractMoney(roundMoney(partnerTransferPrice, scale), roundMoney(additionalDiscount, scale));
}

export function calculateRewardEligibleDtpTotal(
  lineItems: Array<{ discountedTransferPrice: MoneyInput; approved: boolean }>,
  resultScale?: number,
) {
  if (lineItems.length === 0) {
    return zeroMoney(DEFAULT_CURRENCY_CODE, resultScale ?? DEFAULT_SCALE);
  }

  const seedMoney = coerceMoney(lineItems[0].discountedTransferPrice);
  const scale = resultScale ?? seedMoney.scale;
  let total = zeroMoney(seedMoney.currencyCode, scale);

  for (const lineItem of lineItems) {
    if (!lineItem.approved) {
      continue;
    }

    const money = coerceMoney(lineItem.discountedTransferPrice, seedMoney.currencyCode);
    ensureSameCurrency(seedMoney, money);
    total = addMoney(total, roundMoney(money, scale));
  }

  return total;
}

export function calculateWeightedPipeline(input: {
  amount: MoneyInput;
  probability: ScalarInput;
  resultScale?: number;
}) {
  const amount = coerceMoney(input.amount);
  const probability = parseScalar(input.probability);
  if (probability.units < 0n || probability.units > 10n ** BigInt(probability.scale)) {
    throw new Error("Pipeline probability must be between 0 and 1");
  }

  const scale = input.resultScale ?? amount.scale;
  return multiplyMoney(amount, input.probability, scale);
}

export function quoteFxSnapshotAmount(input: {
  sourceAmount: MoneyInput;
  snapshot: {
    sourceCurrencyCode: CurrencyCode | string;
    targetCurrencyCode: CurrencyCode | string;
    rate: ScalarInput;
    asOf: string;
    snapshotId?: string;
  };
  resultScale?: number;
}) {
  const sourceCurrencyCode = normalizeCurrencyCode(String(input.snapshot.sourceCurrencyCode));
  const targetCurrencyCode = normalizeCurrencyCode(String(input.snapshot.targetCurrencyCode));
  const sourceAmount =
    typeof input.sourceAmount === "string"
      ? coerceMoney(input.sourceAmount, sourceCurrencyCode)
      : coerceMoney(input.sourceAmount);

  if (sourceAmount.currencyCode !== sourceCurrencyCode) {
    throw new Error("FX snapshot source currency must match the source amount");
  }

  const scale = input.resultScale ?? sourceAmount.scale;
  const converted = multiplyMoney(sourceAmount, input.snapshot.rate, scale);
  return {
    amount: converted.amount,
    currencyCode: targetCurrencyCode,
    scale: converted.scale,
  };
}
