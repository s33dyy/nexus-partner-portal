import type { CurrencyCode } from "./taxonomy";

export type MoneyDTO = {
  currencyCode: CurrencyCode;
  amount: string;
  scale: number;
};

const MONEY_AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;

function normalizeDecimalAmount(amount: string, scale: number) {
  const [wholePart, fractionPart = ""] = amount.split(".");
  if (fractionPart.length > scale) {
    throw new Error(`Money amount has too many decimal places for scale ${scale}`);
  }

  return scale === 0 ? wholePart : `${wholePart}.${fractionPart.padEnd(scale, "0")}`;
}

export function assertMoneyDTO(value: unknown): asserts value is MoneyDTO {
  if (!value || typeof value !== "object") {
    throw new Error("Money value must be an object");
  }

  const candidate = value as Partial<MoneyDTO>;
  if (!candidate.currencyCode || !candidate.amount || candidate.scale === undefined) {
    throw new Error("Money value requires currencyCode, amount, and scale");
  }

  if (typeof candidate.amount !== "string" || !MONEY_AMOUNT_PATTERN.test(candidate.amount)) {
    throw new Error("Money amount must be a plain decimal string");
  }

  if (!Number.isInteger(candidate.scale) || candidate.scale < 0 || candidate.scale > 6) {
    throw new Error("Money scale must be an integer between 0 and 6");
  }
}

export function parseMoneyInput(
  value:
    | string
    | MoneyDTO
    | {
        currencyCode: CurrencyCode;
        amount: string;
        scale?: number;
      },
): MoneyDTO {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!MONEY_AMOUNT_PATTERN.test(trimmed) || /[,_\s₹$€£]/.test(trimmed)) {
      throw new Error("Money string must be a plain decimal without separators or symbols");
    }
    return {
      currencyCode: "USD",
      amount: normalizeDecimalAmount(
        trimmed,
        trimmed.includes(".") ? trimmed.split(".")[1].length : 2,
      ),
      scale: trimmed.includes(".") ? trimmed.split(".")[1].length : 2,
    };
  }

  assertMoneyDTO(value);
  return {
    currencyCode: value.currencyCode,
    amount: normalizeDecimalAmount(value.amount.trim(), value.scale),
    scale: value.scale,
  };
}

export function formatMoney(value: MoneyDTO) {
  return `${value.currencyCode} ${value.amount}`;
}

export function moneyToMinorUnits(value: MoneyDTO) {
  const [wholePart, fractionPart = ""] = value.amount.split(".");
  const paddedFraction = fractionPart.padEnd(value.scale, "0").slice(0, value.scale);
  const whole = BigInt(wholePart || "0");
  const fraction = BigInt(paddedFraction || "0");
  const multiplier = 10n ** BigInt(value.scale);
  return whole * multiplier + (whole >= 0 ? fraction : -fraction);
}
