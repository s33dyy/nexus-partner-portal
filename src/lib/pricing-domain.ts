import { newId } from "@/domain/contracts/ids";

import { parseMoneyInput, moneyToMinorUnits, type MoneyDTO } from "@/domain/contracts/money";
import { CURRENCY_CODES, type CurrencyCode } from "@/domain/contracts/taxonomy";

export const PRICING_RECORD_TYPES = [
  "product",
  "product_variant",
  "product_sku",
  "combo",
  "combo_component",
  "price_book",
  "price_row",
  "fx_snapshot",
] as const;

export type PricingRecordType = (typeof PRICING_RECORD_TYPES)[number];

export const PRICING_RECORD_STATUSES = ["draft", "active", "archived"] as const;

export type PricingRecordStatus = (typeof PRICING_RECORD_STATUSES)[number];

export const PRICING_TARGET_KINDS = ["product", "product_variant", "product_sku", "combo"] as const;

export type PricingTargetKind = (typeof PRICING_TARGET_KINDS)[number];

export type MoneyInput = string | MoneyDTO;

export type PricingVersionedRecord = {
  id: string;
  record_type: PricingRecordType;
  version: number;
  status: PricingRecordStatus;
  is_archived: boolean;
  archived_at: string | null;
  archived_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductRecord = PricingVersionedRecord & {
  record_type: "product";
  product_code: string;
  product_name: string;
  category: string;
  description: string;
  support_notes: string;
  learning_notes: string;
  default_currency_code: CurrencyCode;
};

export type ProductVariantRecord = PricingVersionedRecord & {
  record_type: "product_variant";
  product_code: string;
  variant_code: string;
  variant_name: string;
  sort_order: number;
  description: string;
};

export type ProductSkuRecord = PricingVersionedRecord & {
  record_type: "product_sku";
  product_code: string;
  variant_code: string;
  sku_code: string;
  sku_name: string;
  is_primary: boolean;
};

export type ComboRecord = PricingVersionedRecord & {
  record_type: "combo";
  combo_code: string;
  combo_name: string;
  description: string;
  default_currency_code: CurrencyCode;
};

export type ComboComponentRecord = PricingVersionedRecord & {
  record_type: "combo_component";
  combo_code: string;
  component_sku_code: string;
  quantity: number;
  sort_order: number;
};

export type PriceBookRecord = PricingVersionedRecord & {
  record_type: "price_book";
  price_book_code: string;
  price_book_name: string;
  currency_code: CurrencyCode;
  effective_from: string;
  effective_to: string | null;
};

export type PriceRowRecord = PricingVersionedRecord & {
  record_type: "price_row";
  price_book_code: string;
  price_row_code: string;
  target_kind: PricingTargetKind;
  target_code: string;
  currency_code: CurrencyCode;
  quantity: number;
  legacy_price_count: number;
  msrp: MoneyDTO;
  partner_transfer_price: MoneyDTO;
  discounted_transfer_price: MoneyDTO;
  reward_eligible_dtp: MoneyDTO;
  additional_discount: MoneyDTO;
  weighted_probability: number;
};

export type FxSnapshotRecord = PricingVersionedRecord & {
  record_type: "fx_snapshot";
  source_currency_code: CurrencyCode;
  target_currency_code: CurrencyCode;
  rate: string;
  snapshot_at: string;
};

export type PricingImportOptions = {
  kind: Exclude<PricingRecordType, "fx_snapshot">;
  dryRun?: boolean;
};

export type PricingImportError = {
  rowNumber: number;
  messages: string[];
};

export type PricingImportResult<T> = {
  kind: Exclude<PricingRecordType, "fx_snapshot">;
  dryRun: boolean;
  successCount: number;
  rows: T[];
  errors: PricingImportError[];
};

type PricingImportRow = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeHeaderKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeImportRow(row: PricingImportRow) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeHeaderKey(key), value]),
  ) as Record<string, unknown>;
}

function isFiniteInteger(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isFiniteNumber(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeCurrencyCode(value: unknown, fallback?: CurrencyCode): CurrencyCode {
  const normalized = normalizeText(value ?? fallback ?? "").toUpperCase();
  if (CURRENCY_CODES.includes(normalized as CurrencyCode)) {
    return normalized as CurrencyCode;
  }

  throw new Error(`Unsupported currency code: ${normalized || "missing"}`);
}

function normalizePricingStatus(value: unknown): PricingRecordStatus {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "draft" || normalized === "archived" || normalized === "active") {
    return normalized;
  }

  return "active";
}

function normalizePricingTargetKind(value: unknown): PricingTargetKind {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "variant") return "product_variant";
  if (normalized === "sku") return "product_sku";
  if (PRICING_TARGET_KINDS.includes(normalized as PricingTargetKind)) {
    return normalized as PricingTargetKind;
  }

  throw new Error(`Unsupported pricing target kind: ${normalized || "missing"}`);
}

function inferMoneyScale(amount: string) {
  const trimmed = amount.trim();
  return trimmed.includes(".") ? trimmed.split(".")[1].length : 2;
}

function normalizeMoneyInput(value: MoneyInput, fallbackCurrencyCode?: CurrencyCode): MoneyDTO {
  if (typeof value === "string") {
    if (fallbackCurrencyCode) {
      return parseMoneyInput({
        currencyCode: fallbackCurrencyCode,
        amount: value.trim(),
        scale: inferMoneyScale(value),
      });
    }

    return parseMoneyInput(value);
  }

  return parseMoneyInput(value);
}

function formatMoneyAmount(
  minorUnits: bigint,
  currencyCode: CurrencyCode,
  scale: number,
): MoneyDTO {
  const multiplier = 10n ** BigInt(scale);
  const absolute = minorUnits < 0n ? -minorUnits : minorUnits;
  const whole = absolute / multiplier;
  const fraction = absolute % multiplier;
  const sign = minorUnits < 0n ? "-" : "";
  const amount =
    scale === 0
      ? `${sign}${whole}`
      : `${sign}${whole.toString()}.${fraction.toString().padStart(scale, "0")}`;

  return { currencyCode, amount, scale };
}

function alignMoneyMinorUnits(a: MoneyDTO, b: MoneyDTO) {
  const targetScale = Math.max(a.scale, b.scale);
  const scaleValue = (value: MoneyDTO) => {
    const units = moneyToMinorUnits(value);
    const scaleDelta = targetScale - value.scale;
    return scaleDelta > 0 ? units * 10n ** BigInt(scaleDelta) : units;
  };

  return {
    a: scaleValue(a),
    b: scaleValue(b),
    scale: targetScale,
  };
}

function subtractMoneyValues(a: MoneyDTO, b: MoneyDTO) {
  if (a.currencyCode !== b.currencyCode) {
    throw new Error("Money values must use the same currency");
  }

  const aligned = alignMoneyMinorUnits(a, b);
  return formatMoneyAmount(aligned.a - aligned.b, a.currencyCode, aligned.scale);
}

function multiplyMinorUnitsByDecimal(minorUnits: bigint, multiplier: string | number) {
  const normalized = normalizeText(multiplier);
  const cleaned = normalized.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid decimal multiplier: ${normalized || "missing"}`);
  }

  const sign = cleaned.startsWith("-") ? -1n : 1n;
  const unsigned = cleaned.startsWith("-") ? cleaned.slice(1) : cleaned;
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  const denominator = 10n ** BigInt(fractionPart.length);
  const numerator = BigInt(`${wholePart}${fractionPart}`) * sign;
  const raw = minorUnits * numerator;
  const quotient = raw / denominator;
  const remainder = raw % denominator;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  if (absoluteRemainder * 2n < denominator) {
    return quotient;
  }

  return quotient + (raw >= 0n ? 1n : -1n);
}

function ensureNonNegativeInteger(value: unknown, label: string) {
  const parsed = isFiniteInteger(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be 0 or higher`);
  }

  return parsed;
}

function ensurePositiveInteger(value: unknown, label: string) {
  const parsed = isFiniteInteger(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }

  return parsed;
}

function ensureNonNegativeNumber(value: unknown, label: string) {
  const parsed = isFiniteNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be 0 or higher`);
  }

  return parsed;
}

function buildVersionedRecordBase<T extends PricingRecordType>(input: {
  id?: string;
  record_type: T;
  version?: number;
  status?: PricingRecordStatus;
  archived_at?: string | null;
  archived_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}) {
  const now = nowIso();
  const version = Number.isInteger(input.version) && (input.version ?? 0) > 0 ? input.version! : 1;
  const status = normalizePricingStatus(input.status ?? "active");
  const archived = input.archived_at ?? (status === "archived" ? now : null);

  return {
    id: input.id ?? newId(),
    record_type: input.record_type,
    version,
    status,
    is_archived: status === "archived" || archived !== null,
    archived_at: archived,
    archived_reason: input.archived_reason ?? null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
  } as const;
}

function buildVersionedRecordNext<T extends PricingVersionedRecord>(
  record: T,
  updates: Partial<T> = {},
) {
  const now = nowIso();
  const status = normalizePricingStatus(updates.status ?? record.status);
  const archived_at =
    updates.archived_at !== undefined
      ? updates.archived_at
      : status === "archived"
        ? (record.archived_at ?? now)
        : record.archived_at;

  return {
    ...record,
    ...updates,
    version: record.version + 1,
    status,
    is_archived: status === "archived" || archived_at !== null,
    archived_at,
    archived_reason: updates.archived_reason ?? record.archived_reason ?? null,
    updated_at: now,
  } as T;
}

export function assertPricingRecordDeletionAllowed(input: {
  recordLabel: string;
  referencedByCount?: number;
  referenceLabel?: string;
}) {
  const count = input.referencedByCount ?? 0;
  if (count > 0) {
    const referenceLabel = input.referenceLabel ?? "record";
    throw new Error(
      `${input.recordLabel} is referenced by ${count} ${referenceLabel}${count === 1 ? "" : "s"} and cannot be deleted; archive it instead`,
    );
  }
}

export function archivePricingRecord<T extends PricingVersionedRecord>(record: T, reason?: string) {
  return buildVersionedRecordNext(record, {
    status: "archived",
    archived_at: nowIso(),
    archived_reason: reason ?? record.archived_reason ?? null,
  } as unknown as Partial<T>);
}

export function buildNextPricingVersion<T extends PricingVersionedRecord>(
  record: T,
  updates: Partial<T> = {},
) {
  return buildVersionedRecordNext(record, updates);
}

export type BuildProductRecordInput = {
  id?: string;
  version?: number;
  status?: PricingRecordStatus;
  archived_at?: string | null;
  archived_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  product_code: string;
  product_name: string;
  category?: string;
  description?: string;
  support_notes?: string;
  learning_notes?: string;
  default_currency_code?: CurrencyCode | string;
};

export function buildProductRecord(input: BuildProductRecordInput): ProductRecord {
  const record = buildVersionedRecordBase({
    id: input.id,
    record_type: "product",
    version: input.version,
    status: input.status,
    archived_at: input.archived_at,
    archived_reason: input.archived_reason,
    created_at: input.created_at,
    updated_at: input.updated_at,
  });

  return {
    ...record,
    record_type: "product",
    product_code: normalizeText(input.product_code),
    product_name: normalizeText(input.product_name),
    category: normalizeText(input.category) || "General",
    description: normalizeText(input.description),
    support_notes: normalizeText(input.support_notes),
    learning_notes: normalizeText(input.learning_notes),
    default_currency_code: normalizeCurrencyCode(input.default_currency_code, "USD"),
  };
}

export const buildProductRow = buildProductRecord;

export type BuildProductVariantRecordInput = {
  id?: string;
  version?: number;
  status?: PricingRecordStatus;
  archived_at?: string | null;
  archived_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  product_code: string;
  variant_code: string;
  variant_name: string;
  sort_order?: number;
  description?: string;
};

export function buildProductVariantRecord(
  input: BuildProductVariantRecordInput,
): ProductVariantRecord {
  const record = buildVersionedRecordBase({
    id: input.id,
    record_type: "product_variant",
    version: input.version,
    status: input.status,
    archived_at: input.archived_at,
    archived_reason: input.archived_reason,
    created_at: input.created_at,
    updated_at: input.updated_at,
  });

  return {
    ...record,
    record_type: "product_variant",
    product_code: normalizeText(input.product_code),
    variant_code: normalizeText(input.variant_code),
    variant_name: normalizeText(input.variant_name),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
    description: normalizeText(input.description),
  };
}

export const buildProductVariantRow = buildProductVariantRecord;

export type BuildProductSkuRecordInput = {
  id?: string;
  version?: number;
  status?: PricingRecordStatus;
  archived_at?: string | null;
  archived_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  product_code: string;
  variant_code: string;
  sku_code: string;
  sku_name?: string;
  is_primary?: boolean;
};

export function buildProductSkuRecord(input: BuildProductSkuRecordInput): ProductSkuRecord {
  const record = buildVersionedRecordBase({
    id: input.id,
    record_type: "product_sku",
    version: input.version,
    status: input.status,
    archived_at: input.archived_at,
    archived_reason: input.archived_reason,
    created_at: input.created_at,
    updated_at: input.updated_at,
  });

  return {
    ...record,
    record_type: "product_sku",
    product_code: normalizeText(input.product_code),
    variant_code: normalizeText(input.variant_code),
    sku_code: normalizeText(input.sku_code),
    sku_name: normalizeText(input.sku_name),
    is_primary: input.is_primary ?? false,
  };
}

export const buildProductSkuRow = buildProductSkuRecord;

export type BuildComboRecordInput = {
  id?: string;
  version?: number;
  status?: PricingRecordStatus;
  archived_at?: string | null;
  archived_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  combo_code: string;
  combo_name: string;
  description?: string;
  default_currency_code?: CurrencyCode | string;
};

export function buildComboRecord(input: BuildComboRecordInput): ComboRecord {
  const record = buildVersionedRecordBase({
    id: input.id,
    record_type: "combo",
    version: input.version,
    status: input.status,
    archived_at: input.archived_at,
    archived_reason: input.archived_reason,
    created_at: input.created_at,
    updated_at: input.updated_at,
  });

  return {
    ...record,
    record_type: "combo",
    combo_code: normalizeText(input.combo_code),
    combo_name: normalizeText(input.combo_name),
    description: normalizeText(input.description),
    default_currency_code: normalizeCurrencyCode(input.default_currency_code, "USD"),
  };
}

export const buildComboRow = buildComboRecord;

export type BuildComboComponentRecordInput = {
  id?: string;
  version?: number;
  status?: PricingRecordStatus;
  archived_at?: string | null;
  archived_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  combo_code: string;
  component_sku_code: string;
  quantity: number;
  sort_order?: number;
};

export function buildComboComponentRecord(
  input: BuildComboComponentRecordInput,
): ComboComponentRecord {
  const record = buildVersionedRecordBase({
    id: input.id,
    record_type: "combo_component",
    version: input.version,
    status: input.status,
    archived_at: input.archived_at,
    archived_reason: input.archived_reason,
    created_at: input.created_at,
    updated_at: input.updated_at,
  });

  return {
    ...record,
    record_type: "combo_component",
    combo_code: normalizeText(input.combo_code),
    component_sku_code: normalizeText(input.component_sku_code),
    quantity: ensurePositiveInteger(input.quantity, "quantity"),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
  };
}

export const buildComboComponentRow = buildComboComponentRecord;

export type BuildPriceBookRecordInput = {
  id?: string;
  version?: number;
  status?: PricingRecordStatus;
  archived_at?: string | null;
  archived_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  price_book_code: string;
  price_book_name: string;
  currency_code: CurrencyCode | string;
  effective_from: string;
  effective_to?: string | null;
};

export function buildPriceBookRecord(input: BuildPriceBookRecordInput): PriceBookRecord {
  const record = buildVersionedRecordBase({
    id: input.id,
    record_type: "price_book",
    version: input.version,
    status: input.status,
    archived_at: input.archived_at,
    archived_reason: input.archived_reason,
    created_at: input.created_at,
    updated_at: input.updated_at,
  });

  return {
    ...record,
    record_type: "price_book",
    price_book_code: normalizeText(input.price_book_code),
    price_book_name: normalizeText(input.price_book_name),
    currency_code: normalizeCurrencyCode(input.currency_code),
    effective_from: normalizeText(input.effective_from),
    effective_to: normalizeText(input.effective_to) || null,
  };
}

export const buildPriceBookRow = buildPriceBookRecord;

export type BuildPriceRowRecordInput = {
  id?: string;
  version?: number;
  status?: PricingRecordStatus;
  archived_at?: string | null;
  archived_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  price_book_code: string;
  price_row_code: string;
  target_kind: PricingTargetKind | "variant" | "sku";
  target_code: string;
  currency_code?: CurrencyCode | string;
  quantity?: number;
  legacy_price_count?: number;
  msrp?: MoneyInput;
  list_price?: MoneyInput;
  partner_transfer_price?: MoneyInput;
  discounted_transfer_price?: MoneyInput;
  reward_eligible_dtp?: MoneyInput;
  additional_discount?: MoneyInput;
  partner_discount_percent?: number | string;
  partner_discount_amount?: MoneyInput;
  weighted_probability?: number | string;
};

export function calculateMsrpTotal(input: {
  unitMsrp: MoneyInput;
  quantity: number;
  currencyCode?: CurrencyCode;
}) {
  const unit = normalizeMoneyInput(input.unitMsrp, input.currencyCode);
  const quantity = ensureNonNegativeInteger(input.quantity, "quantity");
  return formatMoneyAmount(
    moneyToMinorUnits(unit) * BigInt(quantity),
    unit.currencyCode,
    unit.scale,
  );
}

export function calculatePartnerTransferPrice(input: {
  msrp: MoneyInput;
  partnerDiscountPercent?: number | string | null;
  partnerDiscountAmount?: MoneyInput | null;
  currencyCode?: CurrencyCode;
}) {
  const msrp = normalizeMoneyInput(input.msrp, input.currencyCode);
  if (input.partnerDiscountAmount !== undefined && input.partnerDiscountAmount !== null) {
    const discount = normalizeMoneyInput(input.partnerDiscountAmount, msrp.currencyCode);
    return subtractMoneyValues(msrp, discount);
  }

  if (input.partnerDiscountPercent !== undefined && input.partnerDiscountPercent !== null) {
    const percentValue = ensureNonNegativeNumber(
      input.partnerDiscountPercent,
      "partnerDiscountPercent",
    );
    const percent = percentValue > 1 ? percentValue / 100 : percentValue;
    const multiplier = 1 - percent;
    const quotedMinorUnits = multiplyMinorUnitsByDecimal(moneyToMinorUnits(msrp), multiplier);
    return formatMoneyAmount(quotedMinorUnits, msrp.currencyCode, msrp.scale);
  }

  return msrp;
}

export function calculateAdditionalDiscount(input: {
  listPrice: MoneyInput;
  partnerTransferPrice?: MoneyInput | null;
  explicitAdditionalDiscount?: MoneyInput | null;
  legacyPriceCount?: number | null;
  currencyCode?: CurrencyCode;
}) {
  const listPrice = normalizeMoneyInput(input.listPrice, input.currencyCode);
  if (input.explicitAdditionalDiscount !== undefined && input.explicitAdditionalDiscount !== null) {
    return normalizeMoneyInput(input.explicitAdditionalDiscount, listPrice.currencyCode);
  }

  const legacyPriceCount = Number(input.legacyPriceCount ?? 0);
  if (!Number.isFinite(legacyPriceCount) || legacyPriceCount <= 1) {
    return formatMoneyAmount(0n, listPrice.currencyCode, listPrice.scale);
  }

  if (input.partnerTransferPrice === undefined || input.partnerTransferPrice === null) {
    return formatMoneyAmount(0n, listPrice.currencyCode, listPrice.scale);
  }

  const partnerTransferPrice = normalizeMoneyInput(
    input.partnerTransferPrice,
    listPrice.currencyCode,
  );
  const discount = subtractMoneyValues(listPrice, partnerTransferPrice);
  const positiveMinorUnits = moneyToMinorUnits(discount) < 0n ? 0n : moneyToMinorUnits(discount);
  return formatMoneyAmount(positiveMinorUnits, discount.currencyCode, discount.scale);
}

export function calculateDiscountedTransferPrice(input: {
  partnerTransferPrice: MoneyInput;
  additionalDiscount?: MoneyInput | null;
  listPrice?: MoneyInput | null;
  legacyPriceCount?: number | null;
  currencyCode?: CurrencyCode;
}) {
  const partnerTransferPrice = normalizeMoneyInput(input.partnerTransferPrice, input.currencyCode);
  const inferredDiscount = calculateAdditionalDiscount({
    listPrice: input.listPrice ?? partnerTransferPrice,
    partnerTransferPrice,
    explicitAdditionalDiscount: input.additionalDiscount ?? null,
    legacyPriceCount: input.legacyPriceCount ?? 0,
    currencyCode: input.currencyCode ?? partnerTransferPrice.currencyCode,
  });

  return subtractMoneyValues(partnerTransferPrice, inferredDiscount);
}

export function calculateRewardEligibleDtpTotal(input: {
  discountedTransferPrice: MoneyInput;
  quantity: number;
  approvedAmount?: MoneyInput | null;
  currencyCode?: CurrencyCode;
}) {
  const discountedTransferPrice = normalizeMoneyInput(
    input.discountedTransferPrice,
    input.currencyCode,
  );
  const total = calculateMsrpTotal({
    unitMsrp: discountedTransferPrice,
    quantity: input.quantity,
  });

  if (input.approvedAmount !== undefined && input.approvedAmount !== null) {
    return normalizeMoneyInput(input.approvedAmount, total.currencyCode);
  }

  return total;
}

export function calculateWeightedPipeline(input: {
  amount: MoneyInput;
  probability: number | string;
  currencyCode?: CurrencyCode;
}) {
  const amount = normalizeMoneyInput(input.amount, input.currencyCode);
  const normalizedProbability = ensureNonNegativeNumber(input.probability, "probability");
  const probabilityFraction =
    normalizedProbability > 1 ? normalizedProbability / 100 : normalizedProbability;
  const weightedMinorUnits = multiplyMinorUnitsByDecimal(
    moneyToMinorUnits(amount),
    probabilityFraction,
  );
  return formatMoneyAmount(weightedMinorUnits, amount.currencyCode, amount.scale);
}

export function quoteFxSnapshotAmount(input: {
  amount: MoneyInput;
  snapshot: Pick<FxSnapshotRecord, "source_currency_code" | "target_currency_code" | "rate">;
}) {
  const amount = normalizeMoneyInput(input.amount);
  if (amount.currencyCode !== input.snapshot.source_currency_code) {
    throw new Error(
      `FX snapshot source currency ${input.snapshot.source_currency_code} does not match ${amount.currencyCode}`,
    );
  }

  const quotedMinorUnits = multiplyMinorUnitsByDecimal(
    moneyToMinorUnits(amount),
    input.snapshot.rate,
  );
  return formatMoneyAmount(quotedMinorUnits, input.snapshot.target_currency_code, amount.scale);
}

export function buildPriceRowRecord(input: BuildPriceRowRecordInput): PriceRowRecord {
  const currencyCode = normalizeCurrencyCode(input.currency_code ?? "USD");
  const msrp = normalizeMoneyInput(input.msrp ?? input.list_price ?? "0", currencyCode);
  const partnerTransferPrice = input.partner_transfer_price
    ? normalizeMoneyInput(input.partner_transfer_price, currencyCode)
    : calculatePartnerTransferPrice({
        msrp,
        partnerDiscountPercent: input.partner_discount_percent,
        partnerDiscountAmount: input.partner_discount_amount,
      });
  const additionalDiscount = calculateAdditionalDiscount({
    listPrice: msrp,
    partnerTransferPrice,
    explicitAdditionalDiscount: input.additional_discount ?? null,
    legacyPriceCount: input.legacy_price_count ?? 0,
    currencyCode,
  });
  const discountedTransferPrice = input.discounted_transfer_price
    ? normalizeMoneyInput(input.discounted_transfer_price, currencyCode)
    : calculateDiscountedTransferPrice({
        partnerTransferPrice,
        additionalDiscount,
        listPrice: msrp,
        legacyPriceCount: input.legacy_price_count ?? 0,
        currencyCode,
      });
  const rewardEligibleDtp = input.reward_eligible_dtp
    ? normalizeMoneyInput(input.reward_eligible_dtp, currencyCode)
    : calculateRewardEligibleDtpTotal({
        discountedTransferPrice,
        quantity: input.quantity ?? 1,
      });

  const record = buildVersionedRecordBase({
    id: input.id,
    record_type: "price_row",
    version: input.version,
    status: input.status,
    archived_at: input.archived_at,
    archived_reason: input.archived_reason,
    created_at: input.created_at,
    updated_at: input.updated_at,
  });

  return {
    ...record,
    record_type: "price_row",
    price_book_code: normalizeText(input.price_book_code),
    price_row_code: normalizeText(input.price_row_code),
    target_kind: normalizePricingTargetKind(input.target_kind),
    target_code: normalizeText(input.target_code),
    currency_code: currencyCode,
    quantity: ensurePositiveInteger(input.quantity ?? 1, "quantity"),
    legacy_price_count: ensureNonNegativeInteger(
      input.legacy_price_count ?? 0,
      "legacy_price_count",
    ),
    msrp,
    partner_transfer_price: partnerTransferPrice,
    discounted_transfer_price: discountedTransferPrice,
    reward_eligible_dtp: rewardEligibleDtp,
    additional_discount: additionalDiscount,
    weighted_probability:
      input.weighted_probability === undefined || input.weighted_probability === null
        ? 1
        : (() => {
            const probability = ensureNonNegativeNumber(
              input.weighted_probability,
              "weighted_probability",
            );
            return probability > 1 ? probability / 100 : probability;
          })(),
  };
}

export const buildPriceRow = buildPriceRowRecord;

export type BuildFxSnapshotRecordInput = {
  id?: string;
  version?: number;
  status?: PricingRecordStatus;
  archived_at?: string | null;
  archived_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  source_currency_code: CurrencyCode | string;
  target_currency_code: CurrencyCode | string;
  rate: string | number;
  snapshot_at: string;
};

export function buildFxSnapshotRecord(input: BuildFxSnapshotRecordInput): FxSnapshotRecord {
  const record = buildVersionedRecordBase({
    id: input.id,
    record_type: "fx_snapshot",
    version: input.version,
    status: input.status,
    archived_at: input.archived_at,
    archived_reason: input.archived_reason,
    created_at: input.created_at,
    updated_at: input.updated_at,
  });

  return {
    ...record,
    record_type: "fx_snapshot",
    source_currency_code: normalizeCurrencyCode(input.source_currency_code),
    target_currency_code: normalizeCurrencyCode(input.target_currency_code),
    rate: normalizeText(input.rate),
    snapshot_at: normalizeText(input.snapshot_at),
  };
}

export function validatePricingImportRows(
  rows: PricingImportRow[],
  options: PricingImportOptions,
): PricingImportResult<
  | ProductRecord
  | ProductVariantRecord
  | ProductSkuRecord
  | ComboRecord
  | ComboComponentRecord
  | PriceBookRecord
  | PriceRowRecord
> {
  const normalizedRows: Array<
    | ProductRecord
    | ProductVariantRecord
    | ProductSkuRecord
    | ComboRecord
    | ComboComponentRecord
    | PriceBookRecord
    | PriceRowRecord
  > = [];
  const errors: PricingImportError[] = [];

  rows.forEach((row, index) => {
    const normalizedRow = normalizeImportRow(row);
    const rowNumber = index + 2;
    const rowErrors: string[] = [];

    try {
      switch (options.kind) {
        case "product": {
          const productCode = normalizeText(normalizedRow.product_code);
          const productName = normalizeText(normalizedRow.product_name);
          if (!productCode) rowErrors.push("product_code is required");
          if (!productName) rowErrors.push("product_name is required");
          if (rowErrors.length === 0) {
            normalizedRows.push(
              buildProductRecord({
                id: normalizeText(normalizedRow.id) || undefined,
                product_code: productCode,
                product_name: productName,
                category: normalizeText(normalizedRow.category),
                description: normalizeText(normalizedRow.description),
                support_notes: normalizeText(normalizedRow.support_notes),
                learning_notes: normalizeText(normalizedRow.learning_notes),
                default_currency_code: normalizeText(normalizedRow.default_currency_code) || "USD",
              }),
            );
          }
          break;
        }
        case "product_variant": {
          const productCode = normalizeText(normalizedRow.product_code);
          const variantCode = normalizeText(normalizedRow.variant_code);
          const variantName = normalizeText(normalizedRow.variant_name);
          if (!productCode) rowErrors.push("product_code is required");
          if (!variantCode) rowErrors.push("variant_code is required");
          if (!variantName) rowErrors.push("variant_name is required");
          if (rowErrors.length === 0) {
            normalizedRows.push(
              buildProductVariantRecord({
                id: normalizeText(normalizedRow.id) || undefined,
                product_code: productCode,
                variant_code: variantCode,
                variant_name: variantName,
                sort_order: normalizeText(normalizedRow.sort_order)
                  ? Number(normalizedRow.sort_order)
                  : undefined,
                description: normalizeText(normalizedRow.description),
              }),
            );
          }
          break;
        }
        case "product_sku": {
          const productCode = normalizeText(normalizedRow.product_code);
          const variantCode = normalizeText(normalizedRow.variant_code);
          const skuCode = normalizeText(normalizedRow.sku_code);
          if (!productCode) rowErrors.push("product_code is required");
          if (!variantCode) rowErrors.push("variant_code is required");
          if (!skuCode) rowErrors.push("sku_code is required");
          if (rowErrors.length === 0) {
            normalizedRows.push(
              buildProductSkuRecord({
                id: normalizeText(normalizedRow.id) || undefined,
                product_code: productCode,
                variant_code: variantCode,
                sku_code: skuCode,
                sku_name: normalizeText(normalizedRow.sku_name),
                is_primary: normalizeText(normalizedRow.is_primary).toLowerCase() === "true",
              }),
            );
          }
          break;
        }
        case "combo": {
          const comboCode = normalizeText(normalizedRow.combo_code);
          const comboName = normalizeText(normalizedRow.combo_name);
          if (!comboCode) rowErrors.push("combo_code is required");
          if (!comboName) rowErrors.push("combo_name is required");
          if (rowErrors.length === 0) {
            normalizedRows.push(
              buildComboRecord({
                id: normalizeText(normalizedRow.id) || undefined,
                combo_code: comboCode,
                combo_name: comboName,
                description: normalizeText(normalizedRow.description),
                default_currency_code: normalizeText(normalizedRow.default_currency_code) || "USD",
              }),
            );
          }
          break;
        }
        case "combo_component": {
          const comboCode = normalizeText(normalizedRow.combo_code);
          const skuCode = normalizeText(normalizedRow.component_sku_code);
          const quantity = ensurePositiveInteger(normalizedRow.quantity, "quantity");
          if (!comboCode) rowErrors.push("combo_code is required");
          if (!skuCode) rowErrors.push("component_sku_code is required");
          if (rowErrors.length === 0) {
            normalizedRows.push(
              buildComboComponentRecord({
                id: normalizeText(normalizedRow.id) || undefined,
                combo_code: comboCode,
                component_sku_code: skuCode,
                quantity,
                sort_order: normalizeText(normalizedRow.sort_order)
                  ? Number(normalizedRow.sort_order)
                  : undefined,
              }),
            );
          }
          break;
        }
        case "price_book": {
          const priceBookCode = normalizeText(normalizedRow.price_book_code);
          const priceBookName = normalizeText(normalizedRow.price_book_name);
          const currencyCode = normalizeText(normalizedRow.currency_code);
          const effectiveFrom = normalizeText(normalizedRow.effective_from);
          if (!priceBookCode) rowErrors.push("price_book_code is required");
          if (!priceBookName) rowErrors.push("price_book_name is required");
          if (!currencyCode) rowErrors.push("currency_code is required");
          if (!effectiveFrom) rowErrors.push("effective_from is required");
          if (rowErrors.length === 0) {
            normalizedRows.push(
              buildPriceBookRecord({
                id: normalizeText(normalizedRow.id) || undefined,
                price_book_code: priceBookCode,
                price_book_name: priceBookName,
                currency_code: currencyCode,
                effective_from: effectiveFrom,
                effective_to: normalizeText(normalizedRow.effective_to) || null,
              }),
            );
          }
          break;
        }
        case "price_row": {
          const priceBookCode = normalizeText(normalizedRow.price_book_code);
          const priceRowCode = normalizeText(normalizedRow.price_row_code);
          const targetKind = normalizeText(normalizedRow.target_kind || normalizedRow.catalog_kind);
          const targetCode = normalizeText(normalizedRow.target_code);
          const currencyCode = normalizeText(
            normalizedRow.currency_code || normalizedRow.price_book_currency_code,
          );
          const msrp = normalizeText(normalizedRow.msrp || normalizedRow.list_price);
          if (!priceBookCode) rowErrors.push("price_book_code is required");
          if (!priceRowCode) rowErrors.push("price_row_code is required");
          if (!targetKind) rowErrors.push("target_kind is required");
          if (!targetCode) rowErrors.push("target_code is required");
          if (!currencyCode) rowErrors.push("currency_code is required");
          if (!msrp) rowErrors.push("msrp is required");
          if (rowErrors.length === 0) {
            normalizedRows.push(
              buildPriceRowRecord({
                id: normalizeText(normalizedRow.id) || undefined,
                price_book_code: priceBookCode,
                price_row_code: priceRowCode,
                target_kind: targetKind as PricingTargetKind,
                target_code: targetCode,
                currency_code: currencyCode,
                quantity: normalizeText(normalizedRow.quantity)
                  ? Number(normalizedRow.quantity)
                  : undefined,
                legacy_price_count: normalizeText(normalizedRow.legacy_price_count)
                  ? Number(normalizedRow.legacy_price_count)
                  : 0,
                msrp,
                partner_transfer_price:
                  normalizeText(normalizedRow.partner_transfer_price) || undefined,
                discounted_transfer_price:
                  normalizeText(normalizedRow.discounted_transfer_price) || undefined,
                reward_eligible_dtp: normalizeText(normalizedRow.reward_eligible_dtp) || undefined,
                additional_discount: normalizeText(normalizedRow.additional_discount) || undefined,
                partner_discount_percent: normalizeText(normalizedRow.partner_discount_percent)
                  ? Number(normalizedRow.partner_discount_percent)
                  : undefined,
                weighted_probability: normalizeText(normalizedRow.weighted_probability)
                  ? Number(normalizedRow.weighted_probability)
                  : undefined,
              }),
            );
          }
          break;
        }
        default: {
          const unsupportedKind: never = options.kind;
          rowErrors.push(`Unsupported pricing import kind: ${unsupportedKind}`);
        }
      }
    } catch (error) {
      rowErrors.push(error instanceof Error ? error.message : "Unable to validate pricing row");
    }

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, messages: rowErrors });
    }
  });

  return {
    kind: options.kind,
    dryRun: options.dryRun ?? true,
    successCount: errors.length > 0 ? 0 : normalizedRows.length,
    rows: errors.length > 0 ? [] : normalizedRows,
    errors,
  };
}
