import { getCountryCurrencyCode } from "@/domain/contracts/reference-data";

const SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  GBP: "£",
  EUR: "€",
};

export function formatRegionalCurrency(
  amount: number,
  countryCodeOrName: string | null | undefined,
  locale = "en-US",
): string {
  const currencyCode = getCountryCurrencyCode(countryCodeOrName);
  if (!currencyCode) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  const symbol = SYMBOLS[currencyCode];
  if (symbol) {
    return `${symbol}${new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)}`;
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
