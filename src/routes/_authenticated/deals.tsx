import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Target,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { DealProbabilitySelect } from "@/components/deal-probability-select";
import { CsvExportButton } from "@/components/csv-export-button";
import { DealCollaboratorEditor } from "@/components/deal-collaborator-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerQuickCreateDialog } from "@/components/customer-quick-create-dialog";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listDropdownSourceValues } from "@/integrations/local/dropdown-sources";
import { upsertLookupValue } from "@/integrations/local/lookups";
import { supabase } from "@/integrations/local/client";
import { applyPartnerScope } from "@/lib/partner-scope";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { formatDateLabel, toDateInputValue } from "@/lib/date-utils";
import { dealRegionLookupField } from "@/lib/deal-lookups";
import { awardDealWinPoints } from "@/lib/rewards";
import { useAuth } from "@/hooks/use-auth";
import { useRequireAccess } from "@/hooks/use-partner-access";
import { recordAuditEvent } from "@/lib/workflow-events";
import { formatCsvDate, type CsvColumn } from "@/lib/csv-export";
import { filterDealsByView, type DealListStatusFilter } from "@/lib/deal-filters";
import {
  buildDealCollaboratorPayloads,
  isDealCollaboratorEditingLocked,
  normalizeDealCollaborators,
  type DealCollaboratorDraft,
} from "@/lib/deal-collaboration";
import {
  buildDealImportLookupUpserts,
  getDealImportStatus,
  getDealImportTemplateColumns,
  getDealImportTemplateDownloadColumns,
  getDealImportTemplateSample,
  normalizeDealImportSpreadsheet,
  validateDealImportRows,
  type DealImportValidationError,
  type ValidatedDealImportRow,
} from "@/lib/deal-import";
import { ImportFeedback } from "@/lib/import-feedback";
import { formatDealProbability, normalizeDealProbability } from "@/lib/deal-probability";
import { canViewDeal } from "@/lib/deal-visibility";
import {
  DEAL_CURRENCY_OPTIONS,
  DEAL_STAGE_ORDER,
  getDealInrAmount,
  nextDealStage,
  nextDealStatus,
  parseDealAmount,
  requiresSuperAdminApproval,
  type DealRecord,
  type DealStage,
  type TeamMemberRecord,
} from "@/lib/portal-records";
import {
  buildImportSummaryMessage,
  downloadTemplateCsv,
  parseSpreadsheetFile,
  validateImportTemplate,
} from "@/lib/spreadsheet-import";

type DealForm = {
  partner_id: string | null;
  customer_id: string | null;
  poc_profile_id: string | null;
  account_name: string;
  contact_name: string;
  owner_name: string;
  country: string;
  region: string;
  product: string;
  stage: DealStage;
  quantity: number;
  amount: string;
  currency_code: string;
  amount_value: number | null;
  amount_inr: number | null;
  fx_rate: number | null;
  fx_provider: string | null;
  fx_rate_fetched_at: string | null;
  customer_budget: string;
  possible_close_date: string;
  probability: number;
  close_date: string;
  source: string;
  last_touch: string;
  notes: string;
  is_hidden_to_team: boolean;
  reward_rate_percent: number;
};

type DealEditForm = {
  account_name: string;
  contact_name: string;
  owner_name: string;
  country: string;
  region: string;
  product: string;
  quantity: number;
  amount: string;
  currency_code: string;
  amount_value: number | null;
  amount_inr: number | null;
  fx_rate: number | null;
  fx_provider: string | null;
  fx_rate_fetched_at: string | null;
  customer_budget: string;
  possible_close_date: string;
  probability: number;
  source: string;
  notes: string;
  is_hidden_to_team: boolean;
  reward_rate_percent: number;
};

const EMPTY_FORM: DealForm = {
  partner_id: null,
  customer_id: null,
  poc_profile_id: null,
  account_name: "",
  contact_name: "",
  owner_name: "",
  country: "India",
  region: "India West",
  product: "LIVEY WC350 QHD Webcam",
  stage: "sourced",
  quantity: 1,
  amount: "",
  currency_code: "INR",
  amount_value: null,
  amount_inr: null,
  fx_rate: null,
  fx_provider: null,
  fx_rate_fetched_at: null,
  customer_budget: "",
  possible_close_date: "",
  probability: 25,
  close_date: "",
  source: "Partner referral",
  last_touch: "New",
  notes: "",
  is_hidden_to_team: false,
  reward_rate_percent: 5,
};

function normalizeCompanyName(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function buildCustomerScopeKey(input: {
  partnerId?: string | null;
  userId?: string | null;
  companyName: string;
}) {
  const normalizedCompany = normalizeCompanyName(input.companyName);
  const scope = input.partnerId
    ? `partner:${input.partnerId}`
    : input.userId
      ? `user:${input.userId}`
      : "global";
  return `${scope}:${normalizedCompany}`;
}

function normalizeNullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatInrAmount(value: number | null) {
  if (!Number.isFinite(value ?? Number.NaN)) return "Unavailable";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

function dealToEditForm(deal: DealRecord): DealEditForm {
  return {
    account_name: deal.account_name,
    contact_name: deal.contact_name,
    owner_name: deal.owner_name,
    country: deal.country,
    region: deal.region,
    product: deal.product,
    quantity: deal.quantity,
    amount: deal.amount,
    currency_code: deal.currency_code || "INR",
    amount_value: normalizeNullableNumber(deal.amount_value),
    amount_inr: normalizeNullableNumber(deal.amount_inr),
    fx_rate: normalizeNullableNumber(deal.fx_rate),
    fx_provider: deal.fx_provider ?? null,
    fx_rate_fetched_at: deal.fx_rate_fetched_at ?? null,
    customer_budget: deal.customer_budget ?? "",
    possible_close_date: toDateInputValue(deal.possible_close_date),
    probability: normalizeDealProbability(deal.probability),
    source: deal.source,
    notes: deal.notes,
    is_hidden_to_team: deal.is_hidden_to_team,
    reward_rate_percent: Number(deal.reward_rate_percent) || 5,
  };
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)),
  ];
}

const DEAL_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "account_name", header: "Account" },
  { key: "contact_name", header: "Client" },
  { key: "owner_name", header: "Owner" },
  { key: "country", header: "Country" },
  { key: "region", header: "Region" },
  { key: "product", header: "Product" },
  { key: "stage", header: "Stage" },
  { key: "status", header: "Status" },
  { key: "quantity", header: "Quantity" },
  { key: "amount", header: "Amount" },
  { key: "currency_code", header: "Currency" },
  { key: "amount_inr", header: "INR Equivalent" },
  { key: "customer_budget", header: "Customer Budget" },
  { key: "possible_close_date", header: "Possible Close Date" },
  { key: "close_date", header: "Close Date" },
  { key: "source", header: "Source" },
  { key: "last_touch", header: "Last Touch" },
  { key: "notes", header: "Notes" },
];

const DEAL_STATUS_FILTER_OPTIONS = [
  "all",
  "open",
  "submitted",
  "approved",
  "won",
  "lost",
] as const satisfies readonly DealListStatusFilter[];

const dealSearchSchema = z.object({
  q: z.string().optional(),
  stage: z.enum(["all", ...DEAL_STAGE_ORDER]).optional(),
  status: z.enum(DEAL_STATUS_FILTER_OPTIONS).optional(),
});

export const Route = createFileRoute("/_authenticated/deals")({
  validateSearch: dealSearchSchema,
  component: DealsPage,
});

function DealsPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authenticated/deals" });
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [collaboratorsByDealId, setCollaboratorsByDealId] = useState<
    Record<string, DealCollaboratorDraft[]>
  >({});
  const [teamMembers, setTeamMembers] = useState<TeamMemberRecord[]>([]);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DealForm>(EMPTY_FORM);
  const [draftCollaborators, setDraftCollaborators] = useState<DealCollaboratorDraft[]>([]);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [selectedDealOpen, setSelectedDealOpen] = useState(false);
  const [selectedDealEditing, setSelectedDealEditing] = useState(false);
  const [selectedDealDraft, setSelectedDealDraft] = useState<DealEditForm | null>(null);
  const [selectedDealCollaborators, setSelectedDealCollaborators] = useState<
    DealCollaboratorDraft[]
  >([]);
  const [clientCreateOpen, setClientCreateOpen] = useState(false);
  const [clientCreateSeed, setClientCreateSeed] = useState("");
  const [partnerAdminProfileId, setPartnerAdminProfileId] = useState<string | null>(null);
  const [partnerAdminName, setPartnerAdminName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<DealImportValidationError[]>([]);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [convertingCurrency, setConvertingCurrency] = useState(false);
  const [currencyPreviewError, setCurrencyPreviewError] = useState<string | null>(null);
  const [selectedDealConvertingCurrency, setSelectedDealConvertingCurrency] = useState(false);
  const [selectedCurrencyPreviewError, setSelectedCurrencyPreviewError] = useState<string | null>(
    null,
  );
  const [accountOptions, setAccountOptions] = useState<Array<{ id: string; label: string }>>([]);
  const { profile, hasRole } = useAuth();
  useRequireAccess("full");
  const query = search.q ?? "";
  const stageFilter = search.stage ?? "all";
  const statusFilter = search.status ?? "all";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let dealQuery = supabase
        .from("portal_deals")
        .select("*")
        .order("updated_at", { ascending: false });

      dealQuery = applyPartnerScope(dealQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });

      const [dealResult, collaboratorResult, memberResult] = await Promise.all([
        dealQuery,
        supabase
          .from("portal_deal_collaborators")
          .select("*")
          .order("sort_order", { ascending: true }),
        supabase.from("portal_team_members").select("*").order("full_name", { ascending: true }),
      ]);

      if (dealResult.error) throw dealResult.error;
      if (collaboratorResult.error) throw collaboratorResult.error;
      if (memberResult.error) throw memberResult.error;

      const rows = ((dealResult.data as DealRecord[] | null) ?? []).map((deal) => ({
        ...deal,
        currency_code: deal.currency_code || "INR",
        amount_value: normalizeNullableNumber(deal.amount_value),
        amount_inr: normalizeNullableNumber(deal.amount_inr),
        fx_rate: normalizeNullableNumber(deal.fx_rate),
        possible_close_date: toDateInputValue(deal.possible_close_date),
        close_date: toDateInputValue(deal.close_date),
      }));

      const collaboratorMap = Object.fromEntries(
        rows.map((deal) => {
          const collaboratorRows = (
            (collaboratorResult.data as Array<{
              deal_id: string;
              user_id: string;
              split_percent: number;
              sort_order: number;
            }> | null) ?? []
          ).filter((row) => row.deal_id === deal.id);
          return [deal.id, normalizeDealCollaborators(collaboratorRows)];
        }),
      ) as Record<string, DealCollaboratorDraft[]>;

      const viewerContext = {
        viewerUserId: profile?.id ?? null,
        viewerRole: hasRole("super_admin")
          ? ("super_admin" as const)
          : hasRole("partner_admin")
            ? ("partner_admin" as const)
            : ("partner_user" as const),
        isSuperAdmin: hasRole("super_admin"),
        isPartnerAdmin: hasRole("partner_admin"),
      };

      const visibleRows = rows.filter((deal) =>
        canViewDeal(deal, {
          ...viewerContext,
          collaboratorUserIds:
            collaboratorMap[deal.id]?.map((collaborator) => collaborator.userId) ?? [],
        }),
      );

      const companyName = profile?.company_name ?? null;
      const companyKey = normalizeCompanyName(companyName);
      const members = ((memberResult.data as TeamMemberRecord[] | null) ?? []).filter((member) =>
        hasRole("super_admin") || !companyKey
          ? true
          : normalizeCompanyName(member.company_name) === companyKey,
      );

      setDeals(visibleRows);
      setCollaboratorsByDealId(collaboratorMap);
      setTeamMembers(members);
      setSource(rows.length > 0 ? "database" : "empty");
      setSelectedId((current) =>
        current && visibleRows.some((deal) => deal.id === current)
          ? current
          : (visibleRows[0]?.id ?? null),
      );
    } catch {
      setDeals([]);
      setCollaboratorsByDealId({});
      setTeamMembers([]);
      setSource("empty");
      setSelectedId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasRole, profile?.company_name, profile?.id, profile?.partner_id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!profile?.company_name) return;
    if (hasRole("super_admin") || hasRole("partner_admin")) return;
    setDraft((current) =>
      current.account_name.trim().length > 0
        ? current
        : {
            ...current,
            partner_id: profile.partner_id ?? current.partner_id,
            account_name: profile.company_name ?? current.account_name,
          },
    );
  }, [hasRole, profile?.company_name, profile?.partner_id]);

  useEffect(() => {
    if (hasRole("super_admin")) {
      setPartnerAdminProfileId(null);
      setPartnerAdminName(null);
      return;
    }
    if (hasRole("partner_admin")) {
      setPartnerAdminProfileId(profile?.id ?? null);
      setPartnerAdminName(profile?.full_name ?? null);
      return;
    }
    if (!profile?.partner_id) {
      setPartnerAdminProfileId(null);
      setPartnerAdminName(profile?.full_name ?? null);
      return;
    }

    let active = true;
    void (async () => {
      const { data: partnerRow, error: partnerError } = await supabase
        .from("partners")
        .select("owner_user_id")
        .eq("id", profile.partner_id)
        .maybeSingle();
      if (partnerError) {
        if (active) {
          setPartnerAdminProfileId(null);
          setPartnerAdminName(profile?.full_name ?? null);
        }
        return;
      }

      const ownerId =
        (partnerRow as { owner_user_id?: string | null } | null)?.owner_user_id ?? null;
      if (!ownerId) {
        if (active) {
          setPartnerAdminProfileId(null);
          setPartnerAdminName(profile?.full_name ?? null);
        }
        return;
      }

      const { data: ownerProfile, error: ownerError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", ownerId)
        .maybeSingle();
      if (!active) return;
      if (ownerError) {
        setPartnerAdminProfileId(ownerId);
        setPartnerAdminName(profile?.full_name ?? null);
        return;
      }

      setPartnerAdminProfileId(ownerId);
      setPartnerAdminName(
        (ownerProfile as { id: string; full_name: string } | null)?.full_name ??
          profile?.full_name ??
          null,
      );
    })();

    return () => {
      active = false;
    };
  }, [hasRole, profile?.full_name, profile?.id, profile?.partner_id]);

  useEffect(() => {
    if (hasRole("super_admin") || hasRole("partner_admin")) return;
    if (!profile?.full_name) return;
    setDraft((current) =>
      current.account_name.trim().length > 0
        ? current
        : {
            ...current,
            partner_id: profile.partner_id ?? current.partner_id,
            account_name: profile.full_name ?? current.account_name,
          },
    );
  }, [hasRole, profile?.full_name, profile?.partner_id]);

  useEffect(() => {
    if (hasRole("super_admin") || hasRole("partner_admin")) return;
    if (!partnerAdminName) return;
    setDraft((current) =>
      current.owner_name.trim().length > 0
        ? current
        : {
            ...current,
            poc_profile_id: partnerAdminProfileId ?? current.poc_profile_id,
            owner_name: partnerAdminName,
          },
    );
  }, [hasRole, partnerAdminName, partnerAdminProfileId]);

  useEffect(() => {
    if (!hasRole("partner_admin")) return;
    if (!profile?.full_name) return;
    setDraft((current) =>
      current.owner_name.trim().length > 0
        ? current
        : {
            ...current,
            poc_profile_id: profile.id ?? current.poc_profile_id,
            owner_name: profile.full_name ?? current.owner_name,
          },
    );
  }, [hasRole, profile?.full_name, profile?.id]);

  useEffect(() => {
    if (!hasRole("super_admin")) {
      setAccountOptions([]);
      return;
    }

    let active = true;
    void (async () => {
      try {
        const options = await listDropdownSourceValues({ source: "account" });
        if (!active) return;
        setAccountOptions(options.map((option) => ({ id: option.id, label: option.label })));
      } catch {
        if (!active) return;
        setAccountOptions([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [hasRole]);

  const updateListFilters = useCallback(
    (next: { q?: string; stage?: DealStage | "all"; status?: DealListStatusFilter }) => {
      void navigate({
        to: "/deals",
        replace: true,
        search: (current) => ({
          ...current,
          q: next.q !== undefined ? next.q || undefined : current.q,
          stage:
            next.stage !== undefined
              ? next.stage === "all"
                ? undefined
                : next.stage
              : current.stage,
          status:
            next.status !== undefined
              ? next.status === "all"
                ? undefined
                : next.status
              : current.status,
        }),
      });
    },
    [navigate],
  );

  const resetImportState = useCallback(() => {
    setImportErrors([]);
    setImportMessage(null);
  }, []);

  const selectedDeal = useMemo(
    () => deals.find((deal) => deal.id === selectedId) ?? null,
    [deals, selectedId],
  );
  const canEditSelectedDeal =
    hasRole("super_admin") || hasRole("partner_admin") || selectedDeal?.user_id === profile?.id;
  const selectedDealCollaboratorEditingLocked = selectedDeal
    ? isDealCollaboratorEditingLocked(selectedDeal)
    : false;
  const selectedDealCollaboratorsForPayout =
    selectedDeal && selectedDealCollaborators.length > 0 ? selectedDealCollaborators : [];

  useEffect(() => {
    if (!selectedDeal) {
      setSelectedDealDraft(null);
      setSelectedDealCollaborators([]);
      setSelectedDealEditing(false);
      setSelectedCurrencyPreviewError(null);
      return;
    }

    setSelectedDealDraft(dealToEditForm(selectedDeal));
    setSelectedDealCollaborators(collaboratorsByDealId[selectedDeal.id] ?? []);
    setSelectedDealEditing(false);
  }, [collaboratorsByDealId, selectedDeal]);

  const filteredDeals = useMemo(() => {
    return filterDealsByView(deals, {
      query,
      stage: stageFilter,
      status: statusFilter,
    });
  }, [deals, query, stageFilter, statusFilter]);

  useEffect(() => {
    if (draft.currency_code === "INR") {
      setConvertingCurrency(false);
      setCurrencyPreviewError(null);
      setDraft((current) => ({
        ...current,
        amount_value: current.amount.trim() ? parseDealAmount(current.amount) : null,
        amount_inr: current.amount.trim() ? parseDealAmount(current.amount) : null,
        fx_rate: 1,
        fx_provider: "internal",
        fx_rate_fetched_at: new Date().toISOString(),
      }));
      return;
    }

    const amountValue = parseDealAmount(draft.amount);
    if (!draft.amount.trim() || amountValue <= 0) {
      setConvertingCurrency(false);
      setCurrencyPreviewError(null);
      setDraft((current) => ({
        ...current,
        amount_value: amountValue > 0 ? amountValue : null,
        amount_inr: null,
        fx_rate: null,
        fx_provider: null,
        fx_rate_fetched_at: null,
      }));
      return;
    }

    let active = true;
    setConvertingCurrency(true);
    setCurrencyPreviewError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        const { data, error } = await supabase.auth.quoteCurrencyToInr({
          sourceCurrency: draft.currency_code,
          amount: amountValue,
        });
        if (!active) return;
        setConvertingCurrency(false);
        if (error || !data) {
          setCurrencyPreviewError(error?.message ?? "Unable to load INR conversion");
          setDraft((current) => ({
            ...current,
            amount_value: amountValue,
            amount_inr: null,
            fx_rate: null,
            fx_provider: null,
            fx_rate_fetched_at: null,
          }));
          return;
        }
        setDraft((current) => ({
          ...current,
          amount_value: data.amount,
          amount_inr: data.computedInrAmount,
          fx_rate: data.rate,
          fx_provider: data.provider,
          fx_rate_fetched_at: data.timestamp,
        }));
      })();
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft.amount, draft.currency_code]);

  useEffect(() => {
    if (!selectedDealDraft) return;
    if (selectedDealDraft.currency_code === "INR") {
      setSelectedDealConvertingCurrency(false);
      setSelectedCurrencyPreviewError(null);
      setSelectedDealDraft((current) =>
        current
          ? {
              ...current,
              amount_value: current.amount.trim() ? parseDealAmount(current.amount) : null,
              amount_inr: current.amount.trim() ? parseDealAmount(current.amount) : null,
              fx_rate: 1,
              fx_provider: "internal",
              fx_rate_fetched_at: new Date().toISOString(),
            }
          : current,
      );
      return;
    }

    const amountValue = parseDealAmount(selectedDealDraft.amount);
    if (!selectedDealDraft.amount.trim() || amountValue <= 0) {
      setSelectedDealConvertingCurrency(false);
      setSelectedCurrencyPreviewError(null);
      setSelectedDealDraft((current) =>
        current
          ? {
              ...current,
              amount_value: amountValue > 0 ? amountValue : null,
              amount_inr: null,
              fx_rate: null,
              fx_provider: null,
              fx_rate_fetched_at: null,
            }
          : current,
      );
      return;
    }

    let active = true;
    setSelectedDealConvertingCurrency(true);
    setSelectedCurrencyPreviewError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        const { data, error } = await supabase.auth.quoteCurrencyToInr({
          sourceCurrency: selectedDealDraft.currency_code,
          amount: amountValue,
        });
        if (!active) return;
        setSelectedDealConvertingCurrency(false);
        if (error || !data) {
          setSelectedCurrencyPreviewError(error?.message ?? "Unable to load INR conversion");
          setSelectedDealDraft((current) =>
            current
              ? {
                  ...current,
                  amount_value: amountValue,
                  amount_inr: null,
                  fx_rate: null,
                  fx_provider: null,
                  fx_rate_fetched_at: null,
                }
              : current,
          );
          return;
        }
        setSelectedDealDraft((current) =>
          current
            ? {
                ...current,
                amount_value: data.amount,
                amount_inr: data.computedInrAmount,
                fx_rate: data.rate,
                fx_provider: data.provider,
                fx_rate_fetched_at: data.timestamp,
              }
            : current,
        );
      })();
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [selectedDealDraft?.amount, selectedDealDraft?.currency_code]);

  const kpis = useMemo(() => {
    const pipeline = deals.reduce((sum, deal) => {
      return sum + getDealInrAmount(deal);
    }, 0);
    const open = deals.filter((deal) => !["won", "lost"].includes(deal.stage)).length;
    const won = deals.filter((deal) => deal.stage === "won").length;
    const avgProbability = deals.length
      ? Math.round(deals.reduce((sum, deal) => sum + deal.probability, 0) / deals.length)
      : 0;
    return [
      {
        label: "Pipeline",
        value: formatInrAmount(pipeline),
        hint: "Current INR-equivalent opportunity value",
        status: "open" as const,
        stage: "all" as const,
      },
      {
        label: "Open deals",
        value: String(open),
        hint: "Across all active stages",
        status: "open" as const,
        stage: "all" as const,
      },
      {
        label: "Won deals",
        value: String(won),
        hint: "Closed this cycle",
        status: "won" as const,
        stage: "won" as const,
      },
      {
        label: "Avg. probability",
        value: `${avgProbability}%`,
        hint: "Current weighted mix",
        status: "open" as const,
        stage: "all" as const,
      },
    ];
  }, [deals]);

  const editOptions = useMemo(() => {
    return {
      countries: uniqueStrings(deals.map((deal) => deal.country)),
      regions: uniqueStrings(deals.map((deal) => deal.region)),
      products: uniqueStrings(deals.map((deal) => deal.product)),
      sources: uniqueStrings(deals.map((deal) => deal.source)),
      budgets: uniqueStrings(deals.map((deal) => deal.customer_budget ?? "")),
    };
  }, [deals]);
  const regionOptions = useMemo(
    () =>
      uniqueStrings(
        deals.filter((deal) => deal.country === draft.country).map((deal) => deal.region),
      ),
    [deals, draft.country],
  );

  const publishDealActivity = async ({
    notificationTitle,
    notificationMessage,
    feedTitle,
    feedCaption,
    type,
  }: {
    notificationTitle: string;
    notificationMessage: string;
    feedTitle: string;
    feedCaption: string;
    type: string;
  }) => {
    const now = new Date().toISOString();
    const postedByName = profile?.company_name || profile?.full_name || "LIVEY";
    const postedByRole = hasRole("super_admin")
      ? "super_admin"
      : hasRole("partner_admin")
        ? "partner_admin"
        : "partner_user";
    await Promise.allSettled([
      supabase.from("notifications").insert({
        id: globalThis.crypto.randomUUID(),
        user_id: profile?.id ?? null,
        partner_id: profile?.partner_id ?? null,
        title: notificationTitle,
        message: notificationMessage,
        type,
        read: false,
        created_at: now,
      }),
      supabase.from("portal_news_posts").insert({
        id: globalThis.crypto.randomUUID(),
        title: feedTitle,
        caption: feedCaption,
        image_path: "",
        image_alt: "",
        posted_by_name: postedByName,
        posted_by_role: postedByRole,
        is_seed: false,
        created_at: now,
        updated_at: now,
      }),
    ]);
  };

  const replaceCollaborators = async (dealId: string, collaborators: DealCollaboratorDraft[]) => {
    const { error: deleteError } = await supabase
      .from("portal_deal_collaborators")
      .delete()
      .eq("deal_id", dealId);
    if (deleteError) throw deleteError;

    const payload = buildDealCollaboratorPayloads(dealId, collaborators);
    if (payload.length === 0) return;

    const { error: insertError } = await supabase.from("portal_deal_collaborators").insert(payload);
    if (insertError) throw insertError;
  };

  const persistCollaboratorsSafely = async (
    dealId: string,
    collaborators: DealCollaboratorDraft[],
  ) => {
    try {
      await replaceCollaborators(dealId, collaborators);
      return true;
    } catch (error) {
      console.error("Failed to save deal collaborators", error);
      return false;
    }
  };

  const dealImportTemplateOptions = {
    mode: hasRole("super_admin") ? ("super_admin" as const) : ("partner" as const),
  };
  const dealImportTemplateColumns = getDealImportTemplateColumns(dealImportTemplateOptions);
  const dealImportTemplateDownloadColumns = getDealImportTemplateDownloadColumns(
    dealImportTemplateOptions,
  );
  const dealImportTemplateSample = getDealImportTemplateSample(dealImportTemplateOptions);

  const downloadImportTemplate = () => {
    downloadTemplateCsv({
      filenameStem: "livey-deal-import",
      columns: dealImportTemplateDownloadColumns,
      sampleRows: dealImportTemplateSample,
    });
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    resetImportState();
    setImporting(true);

    try {
      const parsed = normalizeDealImportSpreadsheet(
        parseSpreadsheetFile(await file.arrayBuffer(), file.name),
      );
      const templateErrors = validateImportTemplate(parsed, dealImportTemplateColumns);
      if (templateErrors.length > 0) {
        setImportErrors(templateErrors);
        toast.error("Use the template CSV headers and add at least one row before uploading again");
        return;
      }

      const validation = validateDealImportRows(parsed.rows, dealImportTemplateOptions);
      const accountIdByName = new Map(
        accountOptions.map((option) => [normalizeCompanyName(option.label), option.id]),
      );
      const accountErrors: DealImportValidationError[] = [];
      const importRows: ValidatedDealImportRow[] = [];

      validation.rows.forEach((row, index) => {
        if (!hasRole("super_admin")) {
          importRows.push(row);
          return;
        }

        const accountId = accountIdByName.get(normalizeCompanyName(row.account_name));
        if (!accountId) {
          accountErrors.push({
            rowNumber: index + 2,
            messages: [`Account "${row.account_name}" does not match a known partner account`],
          });
          return;
        }

        importRows.push(row);
      });

      const allErrors = [...validation.errors, ...accountErrors];
      if (allErrors.length > 0) {
        setImportErrors(allErrors);
        toast.error("Fix the import errors before uploading again");
        return;
      }

      const isPartnerRole = !hasRole("super_admin");
      const isPartnerUser = !hasRole("super_admin") && !hasRole("partner_admin");
      const today = new Date().toISOString();
      const defaultCloseDate = today.slice(0, 10);
      const accountIdLookup = new Map(
        accountOptions.map((option) => [normalizeCompanyName(option.label), option.id]),
      );
      const partnerAccountName =
        accountOptions.find((option) => option.id === (profile?.partner_id ?? null))?.label ??
        profile?.company_name?.trim() ??
        "Partner Account";
      const fxCache = new Map<
        string,
        {
          amount: number;
          computedInrAmount: number;
          provider: string;
          rate: number;
          sourceCurrency: string;
          timestamp: string;
        }
      >();
      const fxErrors: DealImportValidationError[] = [];
      const importRowsWithFx: Array<
        ValidatedDealImportRow & {
          amount_value: number;
          amount_inr: number;
          fx_rate: number;
          fx_provider: string;
          fx_rate_fetched_at: string;
        }
      > = [];

      for (const [index, row] of importRows.entries()) {
        const amountValue = parseDealAmount(row.amount);
        const rowNumber = index + 2;

        if (row.currency_code === "INR") {
          importRowsWithFx.push({
            ...row,
            amount_value: amountValue,
            amount_inr: amountValue,
            fx_rate: 1,
            fx_provider: "import_default",
            fx_rate_fetched_at: today,
          });
          continue;
        }

        const cacheKey = `${row.currency_code}:${amountValue}`;
        let fxData = fxCache.get(cacheKey);
        if (!fxData) {
          const { data, error } = await supabase.auth.quoteCurrencyToInr({
            sourceCurrency: row.currency_code,
            amount: amountValue,
          });
          if (error || !data) {
            fxErrors.push({
              rowNumber,
              messages: [
                error?.message ??
                  `Unable to load INR conversion for ${row.currency_code} on row ${rowNumber}`,
              ],
            });
            continue;
          }
          fxCache.set(cacheKey, data);
          fxData = data;
        }

        importRowsWithFx.push({
          ...row,
          amount_value: amountValue,
          amount_inr: fxData.computedInrAmount,
          fx_rate: fxData.rate,
          fx_provider: fxData.provider,
          fx_rate_fetched_at: fxData.timestamp,
        });
      }

      if (fxErrors.length > 0) {
        setImportErrors(fxErrors);
        toast.error("Fix the import errors before uploading again");
        return;
      }

      const resolvedRows = importRowsWithFx.map((row) => {
        const partnerId = hasRole("super_admin")
          ? (accountIdLookup.get(normalizeCompanyName(row.account_name)) ?? null)
          : (profile?.partner_id ?? null);
        const accountName = isPartnerRole ? partnerAccountName : row.account_name;
        const ownerName = hasRole("partner_admin")
          ? profile?.full_name || row.owner_name || "Partner Admin"
          : isPartnerUser
            ? partnerAdminName || profile?.full_name || row.owner_name || "Partner Admin"
            : row.owner_name;
        const customerScopeUserId = partnerId ? null : (profile?.id ?? null);
        const customerKey = buildCustomerScopeKey({
          partnerId,
          userId: customerScopeUserId,
          companyName: row.contact_name,
        });
        const autoApproved = !requiresSuperAdminApproval(parseDealAmount(row.amount));

        return {
          row,
          partner_id: partnerId,
          customer_scope_user_id: customerScopeUserId,
          poc_profile_id: hasRole("partner_admin")
            ? (profile?.id ?? null)
            : isPartnerUser
              ? (partnerAdminProfileId ?? profile?.id ?? null)
              : null,
          customer_key: customerKey,
          account_name: accountName,
          owner_name: ownerName,
          autoApproved,
        };
      });

      if (isPartnerRole) {
        const lookupUpserts = buildDealImportLookupUpserts(
          resolvedRows.map((resolvedRow) => resolvedRow.row),
        );
        await Promise.all(
          lookupUpserts.map((lookupUpsert) =>
            upsertLookupValue(lookupUpsert.fieldName, lookupUpsert.value),
          ),
        );
      }

      let customerQuery = supabase
        .from("portal_customers")
        .select("id, company_name, partner_id, user_id");
      customerQuery = applyPartnerScope(customerQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });

      const { data: customerRows, error: customerLoadError } = await customerQuery;
      if (customerLoadError) throw customerLoadError;

      const customerIdByKey = new Map<string, string>();
      for (const customer of (customerRows ?? []) as Array<{
        id: string;
        company_name: string;
        partner_id: string | null;
        user_id: string | null;
      }>) {
        customerIdByKey.set(
          buildCustomerScopeKey({
            partnerId: customer.partner_id,
            userId: customer.user_id,
            companyName: customer.company_name,
          }),
          customer.id,
        );
      }

      const customerPayloads = resolvedRows.flatMap((resolvedRow) => {
        if (customerIdByKey.has(resolvedRow.customer_key)) {
          return [];
        }

        const customerId = globalThis.crypto.randomUUID();
        customerIdByKey.set(resolvedRow.customer_key, customerId);
        return [
          {
            id: customerId,
            company_name: resolvedRow.row.contact_name,
            account_owner: resolvedRow.owner_name,
            region: resolvedRow.row.region,
            segment: "Imported",
            health_score: 50,
            mrr: resolvedRow.row.amount,
            renewal_date: resolvedRow.row.possible_close_date || defaultCloseDate,
            status: "active",
            next_step: resolvedRow.row.notes || "Imported from deal CSV",
            last_touch: `Imported from ${file.name}`,
            user_id: resolvedRow.customer_scope_user_id,
            partner_id: resolvedRow.partner_id,
            is_seed: false,
            created_at: today,
            updated_at: today,
          },
        ];
      });

      if (customerPayloads.length > 0) {
        const { error: customerInsertError } = await supabase
          .from("portal_customers")
          .insert(customerPayloads);
        if (customerInsertError) throw customerInsertError;
      }

      const payloads = resolvedRows.map((resolvedRow) => ({
          id: globalThis.crypto.randomUUID(),
          partner_id: resolvedRow.partner_id,
          customer_id: customerIdByKey.get(resolvedRow.customer_key) ?? null,
          poc_profile_id: resolvedRow.poc_profile_id,
          account_name: resolvedRow.account_name,
          contact_name: resolvedRow.row.contact_name,
          owner_name: resolvedRow.owner_name,
          country: resolvedRow.row.country || "India",
          region: resolvedRow.row.region,
          product: resolvedRow.row.product,
          stage: resolvedRow.row.stage,
          status: getDealImportStatus(resolvedRow.row.stage, resolvedRow.autoApproved),
          quantity: resolvedRow.row.quantity,
          amount: resolvedRow.row.amount,
          currency_code: resolvedRow.row.currency_code,
          amount_value: resolvedRow.row.amount_value,
          amount_inr: resolvedRow.row.amount_inr,
          fx_rate: resolvedRow.row.fx_rate,
          fx_provider: resolvedRow.row.fx_provider,
          fx_rate_fetched_at: resolvedRow.row.fx_rate_fetched_at,
          customer_budget: resolvedRow.row.customer_budget || null,
          probability: resolvedRow.row.probability,
          possible_close_date: resolvedRow.row.possible_close_date || null,
          close_date: resolvedRow.row.possible_close_date || defaultCloseDate,
          source: resolvedRow.row.source,
          last_touch: `Imported from ${file.name}`,
          notes: resolvedRow.row.notes,
          user_id: profile?.id ?? null,
          is_hidden_to_team: false,
          reward_rate_percent: EMPTY_FORM.reward_rate_percent,
          is_seed: false,
          created_at: today,
          updated_at: today,
      }));

      const { error } = await supabase.from("portal_deals").insert(payloads);
      if (error) throw error;

      setImportMessage(buildImportSummaryMessage(payloads.length, "deal", file.name));
      toast.success(
        `${payloads.length} ${payloads.length === 1 ? "deal was" : "deals were"} imported`,
      );
      await recordAuditEvent(supabase, {
        actorName: profile?.full_name ?? "LIVEY",
        actorRole: hasRole("super_admin")
          ? "super_admin"
          : hasRole("partner_admin")
            ? "partner_admin"
            : "partner_user",
        action: "deal_import",
        targetType: "deal",
        targetName: file.name,
        outcome: "success",
        details: `Imported ${payloads.length} deals from ${file.name}`,
        severity: "medium",
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import the workbook");
    } finally {
      setImporting(false);
    }
  };

  const createDeal = async () => {
    const isPartnerUser = !hasRole("super_admin") && !hasRole("partner_admin");
    const accountName = isPartnerUser
      ? profile?.full_name || profile?.company_name || "Partner User"
      : draft.account_name;
    const ownerName = hasRole("partner_admin")
      ? profile?.full_name || draft.owner_name || "Partner Admin"
      : isPartnerUser
        ? partnerAdminName || profile?.full_name || draft.owner_name || "Partner Admin"
        : draft.owner_name;
    const amountValue = parseDealAmount(draft.amount);
    const autoApproved = !requiresSuperAdminApproval(amountValue);

    if (
      !accountName.trim() ||
      !ownerName.trim() ||
      !draft.contact_name.trim() ||
      !draft.amount.trim()
    ) {
      toast.error("Fill in the account, client, and amount");
      return;
    }
    if (draft.currency_code !== "INR" && (!draft.amount_inr || !draft.fx_rate)) {
      toast.error("Wait for the INR conversion to load before creating this deal");
      return;
    }
    setCreating(true);
    try {
      const now = new Date().toISOString();
      const resolvedAmountValue = draft.amount_value ?? amountValue;
      const resolvedAmountInr =
        draft.currency_code === "INR" ? resolvedAmountValue : (draft.amount_inr ?? null);
      const payload = {
        id: globalThis.crypto.randomUUID(),
        ...draft,
        partner_id: draft.partner_id ?? profile?.partner_id ?? null,
        customer_id: draft.customer_id ?? null,
        poc_profile_id: hasRole("partner_admin")
          ? (profile?.id ?? null)
          : isPartnerUser
            ? (partnerAdminProfileId ?? profile?.id ?? null)
            : (draft.poc_profile_id ?? profile?.id ?? null),
        account_name: accountName,
        contact_name: draft.contact_name.trim(),
        owner_name: ownerName,
        country: draft.country || "India",
        quantity: Number(draft.quantity) > 0 ? Number(draft.quantity) : 1,
        amount_value: resolvedAmountValue,
        amount_inr: resolvedAmountInr,
        fx_rate: draft.currency_code === "INR" ? 1 : draft.fx_rate,
        fx_provider: draft.currency_code === "INR" ? "internal" : draft.fx_provider,
        fx_rate_fetched_at: draft.fx_rate_fetched_at ?? now,
        customer_budget: draft.customer_budget.trim() || null,
        possible_close_date: draft.possible_close_date || null,
        close_date: draft.possible_close_date || draft.close_date || now.slice(0, 10),
        status: autoApproved ? "approved" : "submitted",
        probability: normalizeDealProbability(Number(draft.probability) || 0),
        is_hidden_to_team: draft.is_hidden_to_team,
        reward_rate_percent: Number(draft.reward_rate_percent) || 5,
        user_id: profile?.id,
        is_seed: false,
        created_at: now,
        updated_at: now,
      };
      const { error } = await supabase.from("portal_deals").insert(payload);
      if (error) throw error;
      const collaboratorsSaved = await persistCollaboratorsSafely(payload.id, draftCollaborators);

      await publishDealActivity({
        notificationTitle: autoApproved ? "Deal auto-approved" : "Deal submitted for review",
        notificationMessage: autoApproved
          ? `${accountName} was auto-approved because the deal amount is $5,000 or below.`
          : `${accountName} is waiting for super admin approval.`,
        feedTitle: autoApproved
          ? `${accountName} was auto-approved`
          : `${accountName} submitted for review`,
        feedCaption: autoApproved
          ? `Deal value ${draft.amount} stayed within the auto-approval threshold and is now active.`
          : `Deal value ${draft.amount} needs super admin approval before it can move forward.`,
        type: "deal_created",
      });

      toast.success("Deal created");
      if (!collaboratorsSaved)
        console.error("Deal was created, but collaborator assignments could not be saved.");
      setDraft(EMPTY_FORM);
      setDraftCollaborators([]);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create deal");
    } finally {
      setCreating(false);
    }
  };

  const updateDeal = async (patch: Partial<DealRecord>) => {
    if (!selectedDeal) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("portal_deals").update(patch).eq("id", selectedDeal.id);
      if (error) throw error;
      toast.success("Deal updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update deal");
    } finally {
      setSaving(false);
    }
  };

  const saveSelectedDeal = async () => {
    if (!selectedDeal || !selectedDealDraft) return;

    const accountName = selectedDealDraft.account_name.trim();
    const contactName = selectedDealDraft.contact_name.trim();
    const ownerName = selectedDealDraft.owner_name.trim();
    const country = selectedDealDraft.country.trim() || "India";
    const region = selectedDealDraft.region.trim();
    const product = selectedDealDraft.product.trim();
    const amount = selectedDealDraft.amount.trim();
    const source = selectedDealDraft.source.trim();
    const notes = selectedDealDraft.notes.trim();

    if (!accountName || !contactName || !ownerName || !region || !product || !amount || !source) {
      toast.error("Fill in account, client, owner, region, product, amount, and source");
      return;
    }
    if (selectedDealDraft.currency_code !== "INR" && (!selectedDealDraft.amount_inr || !selectedDealDraft.fx_rate)) {
      toast.error("Wait for the INR conversion to load before saving this deal");
      return;
    }

    setSaving(true);
    try {
      const resolvedAmountValue = selectedDealDraft.amount_value ?? parseDealAmount(amount);
      const resolvedAmountInr =
        selectedDealDraft.currency_code === "INR"
          ? resolvedAmountValue
          : (selectedDealDraft.amount_inr ?? null);
      const { error } = await supabase
        .from("portal_deals")
        .update({
          account_name: accountName,
          contact_name: contactName,
          owner_name: ownerName,
          country,
          region,
          product,
          quantity: Number(selectedDealDraft.quantity) > 0 ? Number(selectedDealDraft.quantity) : 1,
          amount,
          currency_code: selectedDealDraft.currency_code,
          amount_value: resolvedAmountValue,
          amount_inr: resolvedAmountInr,
          fx_rate: selectedDealDraft.currency_code === "INR" ? 1 : selectedDealDraft.fx_rate,
          fx_provider:
            selectedDealDraft.currency_code === "INR" ? "internal" : selectedDealDraft.fx_provider,
          fx_rate_fetched_at: selectedDealDraft.fx_rate_fetched_at ?? new Date().toISOString(),
          customer_budget: selectedDealDraft.customer_budget.trim() || null,
          possible_close_date: selectedDealDraft.possible_close_date || null,
          probability: normalizeDealProbability(Number(selectedDealDraft.probability) || 0),
          source,
          notes,
          is_hidden_to_team: selectedDealDraft.is_hidden_to_team,
          reward_rate_percent: Number(selectedDealDraft.reward_rate_percent) || 5,
          last_touch: "Deal details updated",
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedDeal.id);
      if (error) throw error;
      if (!selectedDealCollaboratorEditingLocked) {
        await persistCollaboratorsSafely(selectedDeal.id, selectedDealCollaborators);
      }
      toast.success("Deal details updated");
      setSelectedDealEditing(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update deal");
    } finally {
      setSaving(false);
    }
  };

  const saveNote = async () => {
    if (!selectedDeal) return;
    await updateDeal({
      notes: note.trim() || selectedDeal.notes,
      last_touch: "Note updated",
      updated_at: new Date().toISOString(),
    });
    setNoteOpen(false);
  };

  const advance = async () => {
    if (!selectedDeal) return;
    const stage = nextDealStage(selectedDeal.stage);
    if (stage === "qualified" && !selectedDeal.customer_budget?.trim()) {
      toast.error("Add a customer budget before moving this deal to qualified");
      return;
    }
    await updateDeal({
      stage,
      status: nextDealStatus(selectedDeal.status, stage),
      last_touch: "Advanced in pipeline",
      close_date: selectedDeal.close_date || new Date().toISOString().slice(0, 10),
      notes: note.trim() || selectedDeal.notes,
      updated_at: new Date().toISOString(),
    });

    await publishDealActivity({
      notificationTitle: `${selectedDeal.account_name} moved to ${stage}`,
      notificationMessage: `${selectedDeal.account_name} advanced to ${stage}.`,
      feedTitle: `${selectedDeal.account_name} moved to ${stage}`,
      feedCaption: `The deal for ${selectedDeal.product} progressed to ${stage}.`,
      type: "deal_stage_change",
    });
    await recordAuditEvent(supabase, {
      actorName: profile?.full_name ?? "LIVEY",
      actorRole: hasRole("super_admin")
        ? "super_admin"
        : hasRole("partner_admin")
          ? "partner_admin"
          : "partner_user",
      action: "deal_stage_advance",
      targetType: "deal",
      targetName: selectedDeal.account_name,
      outcome: stage,
      details: `${selectedDeal.product} moved to ${stage}`,
      severity: "low",
    });
    if (stage === "won") {
      try {
        await awardDealWinPoints(supabase, {
          dealId: selectedDeal.id,
          accountName: selectedDeal.account_name,
          product: selectedDeal.product,
          dealAmount: selectedDeal.amount,
          rewardRatePercent: Number(selectedDeal.reward_rate_percent) || 5,
          collaborators: selectedDealCollaboratorsForPayout,
          fallbackUserId: selectedDeal.user_id,
          partnerId: selectedDeal.partner_id,
          actorId: profile?.id ?? null,
        });
      } catch (error) {
        console.error("Failed to record reward points for deal win", error);
      }
    }
  };

  const closeAs = async (status: "won" | "lost") => {
    if (!selectedDeal) return;
    await updateDeal({
      stage: status,
      status,
      probability: status === "won" ? 100 : 0,
      last_touch: status === "won" ? "Closed won" : "Closed lost",
      close_date: new Date().toISOString().slice(0, 10),
      notes: note.trim() || selectedDeal.notes,
      updated_at: new Date().toISOString(),
    });

    await publishDealActivity({
      notificationTitle: status === "won" ? "Deal won" : "Deal lost",
      notificationMessage:
        status === "won"
          ? `${selectedDeal.account_name} closed won and is ready for PO submission.`
          : `${selectedDeal.account_name} was closed as lost.`,
      feedTitle:
        status === "won"
          ? `${selectedDeal.account_name} closed won`
          : `${selectedDeal.account_name} closed lost`,
      feedCaption:
        status === "won"
          ? `A deal for ${selectedDeal.product} was successfully closed won.`
          : `The opportunity for ${selectedDeal.product} was marked as lost.`,
      type: `deal_${status}`,
    });
    await recordAuditEvent(supabase, {
      actorName: profile?.full_name ?? "LIVEY",
      actorRole: hasRole("super_admin")
        ? "super_admin"
        : hasRole("partner_admin")
          ? "partner_admin"
          : "partner_user",
      action: `deal_${status}`,
      targetType: "deal",
      targetName: selectedDeal.account_name,
      outcome: status,
      details:
        status === "won"
          ? `${selectedDeal.product} closed won and prepared for PO submission`
          : `${selectedDeal.product} closed lost`,
      severity: status === "won" ? "medium" : "low",
    });
    if (status === "won") {
      try {
        await awardDealWinPoints(supabase, {
          dealId: selectedDeal.id,
          accountName: selectedDeal.account_name,
          product: selectedDeal.product,
          dealAmount: selectedDeal.amount,
          rewardRatePercent: Number(selectedDeal.reward_rate_percent) || 5,
          collaborators: selectedDealCollaboratorsForPayout,
          fallbackUserId: selectedDeal.user_id,
          partnerId: selectedDeal.partner_id,
          actorId: profile?.id ?? null,
        });
      } catch (error) {
        console.error("Failed to record reward points for deal win", error);
      }
    }
  };

  const selectedIndex = filteredDeals.findIndex((deal) => deal.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Target className="h-3.5 w-3.5" />
            Workspace
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Deals</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Register opportunities, move them through the pipeline, and keep every deal tied to a
            real next step.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {source === "database" ? "Live Postgres data" : "Empty state"}
          </Badge>
          <Button
            variant="outline"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
            disabled={loading || refreshing}
          >
            {loading || refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
          <CsvExportButton
            label="Export CSV"
            filenameStem="livey-deals"
            columns={DEAL_EXPORT_COLUMNS}
            loadRows={async () =>
              filteredDeals.map((deal) => ({
                account_name: deal.account_name,
                contact_name: deal.contact_name,
                owner_name: deal.owner_name,
                country: deal.country,
                region: deal.region,
                product: deal.product,
                stage: deal.stage,
                status: deal.status,
                quantity: deal.quantity,
                amount: deal.amount,
                currency_code: deal.currency_code,
                amount_inr: deal.amount_inr,
                customer_budget: deal.customer_budget,
                possible_close_date: deal.possible_close_date,
                close_date: deal.close_date,
                source: deal.source,
                last_touch: deal.last_touch,
                notes: deal.notes,
              }))
            }
            variant="outline"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <MetricCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            hint={kpi.hint}
            onClick={() =>
              updateListFilters({
                q: "",
                stage: kpi.stage,
                status: kpi.status,
              })
            }
          />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.9fr]">
        <Card className="h-fit">
          <CardHeader className="space-y-4 border-b pb-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Pipeline queue</CardTitle>
                <CardDescription>
                  Search live deals, filter by status, or jump in from the KPI cards above.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => updateListFilters({ q: e.target.value })}
                    placeholder="Search deals"
                    className="pl-8"
                  />
                </div>
                <LookupCombobox
                  fieldName={LOOKUP_FIELDS.dealStage}
                  label="Stage"
                  value={stageFilter === "all" ? "" : stageFilter}
                  onValueChange={(value) =>
                    updateListFilters({ stage: (value || "all") as DealStage | "all" })
                  }
                  placeholder="All stages"
                  clearLabel="All stages"
                  allowClear
                  options={DEAL_STAGE_ORDER.map((stage) => stage)}
                  triggerClassName="w-44"
                />
                <LookupCombobox
                  fieldName="deal.status_filter"
                  label="Status"
                  value={statusFilter === "all" ? "" : statusFilter}
                  onValueChange={(value) =>
                    updateListFilters({ status: (value || "all") as DealListStatusFilter })
                  }
                  placeholder="All statuses"
                  clearLabel="All statuses"
                  allowClear
                  allowCreate={false}
                  options={DEAL_STATUS_FILTER_OPTIONS.filter((option) => option !== "all")}
                  triggerClassName="w-44"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading deals...
              </div>
            ) : filteredDeals.length === 0 ? (
              <div className="space-y-3 p-8 text-sm text-muted-foreground">
                <div className="font-medium text-foreground">No deals match this view.</div>
                <div>Try a different filter, or create a new deal using the form below.</div>
              </div>
            ) : (
              <div className="divide-y">
                {filteredDeals.map((deal) => (
                  <button
                    key={deal.id}
                    onClick={() => {
                      setSelectedId(deal.id);
                      setNote(deal.notes);
                      setSelectedDealEditing(false);
                      setSelectedDealOpen(true);
                    }}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-muted/40 ${
                      selectedDeal?.id === deal.id ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{deal.account_name}</div>
                        <Badge variant="outline">{deal.stage}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {deal.contact_name} · {deal.owner_name} · {deal.region}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{deal.amount}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDealProbability(deal.probability)} · closes{" "}
                        {formatDateLabel(deal.close_date)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-base">Create deal</CardTitle>
                  <CardDescription>
                    Add a new live opportunity or import a validated workbook.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={downloadImportTemplate}>
                    <Download className="mr-2 h-4 w-4" />
                    Download template
                  </Button>
                  <Button asChild type="button" variant="outline" disabled={importing}>
                    <label htmlFor="deal-import-file">
                      {importing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      Import CSV/XLSX
                    </label>
                  </Button>
                  <input
                    id="deal-import-file"
                    type="file"
                    accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={(event) => void handleImportFile(event)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ImportFeedback successMessage={importMessage} errors={importErrors} />
              <div className="grid gap-3 md:grid-cols-2">
                {(hasRole("super_admin") || hasRole("partner_admin")) && (
                  <div className="space-y-2">
                    <Label htmlFor="account_name">Account</Label>
                    <LookupCombobox
                      fieldName={LOOKUP_FIELDS.dealAccount}
                      source="account"
                      label="Account"
                      value={draft.account_name}
                      onValueChange={(value) =>
                        setDraft((current) => ({ ...current, account_name: value }))
                      }
                      onSelectionChange={(selection) =>
                        setDraft((current) => ({
                          ...current,
                          partner_id: selection?.id ?? null,
                          account_name: selection?.label ?? current.account_name,
                        }))
                      }
                      placeholder="Select or create account"
                      allowCreate={false}
                    />
                  </div>
                )}
                {hasRole("partner_user") && (
                  <div className="space-y-2">
                    <Label htmlFor="account_name">Account</Label>
                    <Input
                      value={profile?.full_name ?? draft.account_name}
                      readOnly
                      placeholder="Auto-selected account"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="contact_name">Client</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealContact}
                    source="client"
                    label="Client"
                    value={draft.contact_name}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, contact_name: value }))
                    }
                    onSelectionChange={(selection) =>
                      setDraft((current) => ({
                        ...current,
                        customer_id: selection?.id ?? null,
                        contact_name: selection?.label ?? current.contact_name,
                      }))
                    }
                    onCreateRequest={(value) => {
                      setClientCreateSeed(value);
                      setClientCreateOpen(true);
                    }}
                    placeholder="Select or create client"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="owner_name">POC</Label>
                  {hasRole("super_admin") ? (
                    <LookupCombobox
                      fieldName={LOOKUP_FIELDS.dealOwner}
                      source="poc"
                      label="POC"
                      value={draft.owner_name}
                      onValueChange={(value) =>
                        setDraft((current) => ({ ...current, owner_name: value }))
                      }
                      onSelectionChange={(selection) =>
                        setDraft((current) => ({
                          ...current,
                          poc_profile_id: selection?.id ?? null,
                          owner_name: selection?.label ?? current.owner_name,
                        }))
                      }
                      placeholder="Select POC"
                      allowCreate={false}
                    />
                  ) : hasRole("partner_admin") ? (
                    <Input value={profile?.full_name ?? draft.owner_name} readOnly />
                  ) : (
                    <Input
                      value={partnerAdminName ?? draft.owner_name}
                      readOnly
                      placeholder="Auto-selected POC"
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealCountry}
                    label="Country"
                    value={draft.country}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        country: value,
                        region: current.country === value ? current.region : "",
                      }))
                    }
                    placeholder="Select or create country"
                    options={editOptions.countries}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="region">Region</Label>
                  <LookupCombobox
                    fieldName={dealRegionLookupField(draft.country)}
                    label="Region"
                    value={draft.region}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, region: value }))
                    }
                    placeholder={
                      draft.country === "India"
                        ? "Select an Indian region"
                        : "Select or create region"
                    }
                    options={regionOptions}
                  />
                </div>
              </div>
              {hasRole("partner_user") && (
                <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Account and POC are assigned automatically for partner users.
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="product">Product</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealProduct}
                    label="Product"
                    value={draft.product}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, product: value }))
                    }
                    placeholder="Select or create product"
                    options={editOptions.products}
                    allowCreate={hasRole("super_admin")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min={1}
                    value={draft.quantity}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        quantity: Number(e.target.value) || 1,
                      }))
                    }
                    placeholder="1"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    value={draft.amount}
                    onChange={(e) => setDraft((value) => ({ ...value, amount: e.target.value }))}
                    placeholder={draft.country === "India" ? "₹9,20,000" : "$9,200"}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency_code">Currency</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealSource}
                    label="Currency"
                    value={draft.currency_code}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, currency_code: value || "INR" }))
                    }
                    options={[...DEAL_CURRENCY_OPTIONS]}
                    allowCreate={false}
                  />
                </div>
              </div>
              {draft.currency_code !== "INR" ? (
                <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                  <div className="font-medium">INR equivalent</div>
                  <div className="mt-1 text-muted-foreground">
                    {convertingCurrency
                      ? "Fetching the latest FX rate..."
                      : currencyPreviewError
                        ? currencyPreviewError
                        : draft.amount_inr
                          ? `${formatInrAmount(draft.amount_inr)} via ${draft.fx_provider ?? "provider"}`
                          : "Enter a valid amount to preview the INR equivalent."}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="stage">Stage</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealStage}
                    label="Stage"
                    value={draft.stage}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, stage: value as DealStage }))
                    }
                    placeholder="Select or create stage"
                    options={DEAL_STAGE_ORDER.map((stage) => stage)}
                    allowCreate={false}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="probability">Probability</Label>
                  <DealProbabilitySelect
                    value={draft.probability}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, probability: value }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="customer_budget">Customer budget</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealCustomerBudget}
                    label="Customer budget"
                    value={draft.customer_budget}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, customer_budget: value }))
                    }
                    placeholder="Select or create budget"
                    options={editOptions.budgets}
                    allowCreate={hasRole("super_admin")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="possible_close_date">Possible close date</Label>
                  <Input
                    id="possible_close_date"
                    type="date"
                    value={draft.possible_close_date}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, possible_close_date: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="source">Source</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealSource}
                    label="Source"
                    value={draft.source}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, source: value }))
                    }
                    placeholder="Select or create source"
                    options={editOptions.sources}
                    allowCreate={hasRole("super_admin")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="close_date">Close date</Label>
                  <Input
                    id="close_date"
                    value={draft.close_date}
                    disabled
                    placeholder="Auto-set on closure"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={draft.notes}
                  onChange={(e) => setDraft((value) => ({ ...value, notes: e.target.value }))}
                  placeholder="Why this deal matters..."
                />
              </div>
              <DealCollaboratorEditor
                title="Collaborators"
                collaborators={draftCollaborators}
                availableMembers={teamMembers}
                excludeUserId={profile?.id ?? null}
                hiddenToTeam={draft.is_hidden_to_team}
                rewardRatePercent={draft.reward_rate_percent}
                showRewardRate
                allowEditRewardRate={hasRole("super_admin")}
                disabled={creating}
                onCollaboratorsChange={setDraftCollaborators}
                onHiddenToTeamChange={(hidden) =>
                  setDraft((current) => ({ ...current, is_hidden_to_team: hidden }))
                }
                onRewardRateChange={(percent) =>
                  setDraft((current) => ({ ...current, reward_rate_percent: percent }))
                }
              />
              <Button onClick={() => void createDeal()} disabled={creating}>
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Create deal
              </Button>
            </CardContent>
          </Card>

          <Dialog open={selectedDealOpen} onOpenChange={setSelectedDealOpen}>
            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <DialogTitle>
                      {selectedDeal ? `Focused on ${selectedDeal.account_name}` : "Selected deal"}
                    </DialogTitle>
                    <DialogDescription>
                      Inspect and advance the selected opportunity without expanding the page.
                    </DialogDescription>
                  </div>
                  {selectedDeal && canEditSelectedDeal ? (
                    <Button
                      variant={selectedDealEditing ? "outline" : "secondary"}
                      size="sm"
                      onClick={() => {
                        if (!selectedDealDraft) return;
                        if (selectedDealEditing) {
                          setSelectedDealDraft(dealToEditForm(selectedDeal));
                          setSelectedDealCollaborators(
                            collaboratorsByDealId[selectedDeal.id] ?? [],
                          );
                          setSelectedDealEditing(false);
                          return;
                        }
                        setSelectedDealEditing(true);
                      }}
                    >
                      {selectedDealEditing ? "Cancel edit" : "Edit details"}
                    </Button>
                  ) : null}
                </div>
              </DialogHeader>
              <div className="space-y-4">
                {selectedDeal ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{selectedDeal.stage}</Badge>
                      <Badge variant="secondary">{selectedDeal.amount}</Badge>
                      <Badge variant="outline">{selectedDeal.currency_code || "INR"}</Badge>
                      {selectedDeal.customer_budget ? (
                        <Badge variant="outline">{selectedDeal.customer_budget}</Badge>
                      ) : null}
                    </div>
                    {selectedDealEditing && selectedDealDraft ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Account">
                          <Input
                            value={selectedDealDraft.account_name}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, account_name: e.target.value } : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Client">
                          <Input
                            value={selectedDealDraft.contact_name}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, contact_name: e.target.value } : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Owner">
                          <Input
                            value={selectedDealDraft.owner_name}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, owner_name: e.target.value } : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Country">
                          <Input
                            value={selectedDealDraft.country}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, country: e.target.value } : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Region">
                          <Input
                            value={selectedDealDraft.region}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, region: e.target.value } : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Product">
                          <Input
                            value={selectedDealDraft.product}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, product: e.target.value } : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Quantity">
                          <Input
                            type="number"
                            min={1}
                            value={selectedDealDraft.quantity}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current
                                  ? { ...current, quantity: Number(e.target.value) || 1 }
                                  : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Amount">
                          <Input
                            value={selectedDealDraft.amount}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, amount: e.target.value } : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Currency">
                          <LookupCombobox
                            fieldName={LOOKUP_FIELDS.dealSource}
                            label="Currency"
                            value={selectedDealDraft.currency_code}
                            onValueChange={(value) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, currency_code: value || "INR" } : current,
                              )
                            }
                            options={[...DEAL_CURRENCY_OPTIONS]}
                            allowCreate={false}
                          />
                        </Field>
                        <Field label="Customer budget">
                          <Input
                            value={selectedDealDraft.customer_budget}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, customer_budget: e.target.value } : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Possible close date">
                          <Input
                            type="date"
                            value={selectedDealDraft.possible_close_date}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current
                                  ? { ...current, possible_close_date: e.target.value }
                                  : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Source">
                          <Input
                            value={selectedDealDraft.source}
                            onChange={(e) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, source: e.target.value } : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Probability">
                          <DealProbabilitySelect
                            value={selectedDealDraft.probability}
                            onValueChange={(value) =>
                              setSelectedDealDraft((current) =>
                                current ? { ...current, probability: value } : current,
                              )
                            }
                          />
                        </Field>
                        <Field label="Close date">
                          <Input value={formatDateLabel(selectedDeal.close_date)} disabled />
                        </Field>
                      </div>
                    ) : null}
                    {selectedDealEditing && selectedDealDraft && selectedDealDraft.currency_code !== "INR" ? (
                      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                        <div className="font-medium">INR equivalent</div>
                        <div className="mt-1 text-muted-foreground">
                          {selectedDealConvertingCurrency
                            ? "Fetching the latest FX rate..."
                            : selectedCurrencyPreviewError
                              ? selectedCurrencyPreviewError
                              : selectedDealDraft.amount_inr
                                ? `${formatInrAmount(selectedDealDraft.amount_inr)} via ${selectedDealDraft.fx_provider ?? "provider"}`
                                : "Enter a valid amount to preview the INR equivalent."}
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-3 text-sm md:grid-cols-2">
                        <Meta label="Country" value={selectedDeal.country} />
                        <Meta label="Region" value={selectedDeal.region} />
                        <Meta label="Contact" value={selectedDeal.contact_name} />
                        <Meta label="Owner" value={selectedDeal.owner_name} />
                        <Meta label="Quantity" value={String(selectedDeal.quantity ?? 1)} />
                        <Meta label="Currency" value={selectedDeal.currency_code || "INR"} />
                        <Meta
                          label="INR equivalent"
                          value={formatInrAmount(normalizeNullableNumber(selectedDeal.amount_inr))}
                        />
                        <Meta
                          label="Possible close date"
                          value={formatDateLabel(selectedDeal.possible_close_date)}
                        />
                        <Meta label="Close date" value={formatDateLabel(selectedDeal.close_date)} />
                        <Meta label="Source" value={selectedDeal.source} />
                        <Meta
                          label="Probability"
                          value={formatDealProbability(selectedDeal.probability)}
                        />
                      </div>
                    )}
                    <DealCollaboratorEditor
                      title="Visibility & collaborators"
                      collaborators={selectedDealCollaborators}
                      availableMembers={teamMembers}
                      excludeUserId={profile?.id ?? null}
                      hiddenToTeam={
                        selectedDealDraft?.is_hidden_to_team ?? selectedDeal.is_hidden_to_team
                      }
                      rewardRatePercent={
                        selectedDealDraft?.reward_rate_percent ?? selectedDeal.reward_rate_percent
                      }
                      showRewardRate
                      allowEditRewardRate={
                        selectedDealEditing &&
                        hasRole("super_admin") &&
                        !selectedDealCollaboratorEditingLocked
                      }
                      allowEditCollaborators={
                        selectedDealEditing && !selectedDealCollaboratorEditingLocked
                      }
                      disabled={
                        saving ||
                        selectedDealCollaboratorEditingLocked ||
                        !selectedDealEditing ||
                        !canEditSelectedDeal
                      }
                      onCollaboratorsChange={setSelectedDealCollaborators}
                      onHiddenToTeamChange={(hidden) =>
                        setSelectedDealDraft((current) =>
                          current ? { ...current, is_hidden_to_team: hidden } : current,
                        )
                      }
                      onRewardRateChange={(percent) =>
                        setSelectedDealDraft((current) =>
                          current ? { ...current, reward_rate_percent: percent } : current,
                        )
                      }
                    />
                    <Separator />
                    <div className="space-y-2">
                      <Label>Quick note</Label>
                      {selectedDealEditing && selectedDealDraft ? (
                        <Textarea
                          value={selectedDealDraft.notes}
                          onChange={(e) =>
                            setSelectedDealDraft((current) =>
                              current ? { ...current, notes: e.target.value } : current,
                            )
                          }
                          rows={4}
                        />
                      ) : (
                        <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                          {selectedDeal.notes ||
                            "Capture the latest status, blockers, or next steps."}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedDealEditing && canEditSelectedDeal ? (
                        <Button onClick={() => void saveSelectedDeal()} disabled={saving}>
                          {saving ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                          )}
                          Save changes
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        onClick={() => {
                          setNote(selectedDeal.notes);
                          setNoteOpen(true);
                        }}
                      >
                        Edit note
                      </Button>
                      <Button onClick={() => void advance()} disabled={saving}>
                        {saving ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowRight className="mr-2 h-4 w-4" />
                        )}
                        Advance stage
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void closeAs("won")}
                        disabled={saving}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Mark won
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => void closeAs("lost")}
                        disabled={saving}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Mark lost
                      </Button>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                      Viewing item {selectedIndex + 1} of {filteredDeals.length}
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    No deal selected yet. Choose a row from the table to inspect the opportunity.
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Deal note</DialogTitle>
            <DialogDescription>
              Keep the selected deal up to date without leaving the record view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2 text-sm">
              <div className="font-medium">{selectedDeal?.account_name ?? "Selected deal"}</div>
              <div className="text-muted-foreground">
                {selectedDeal?.product ?? "Deal"} · {selectedDeal?.stage ?? "stage"}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deal_note">Note</Label>
              <Textarea
                id="deal_note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Capture the latest status"
                rows={6}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNoteOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void saveNote()}>Save note</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CustomerQuickCreateDialog
        open={clientCreateOpen}
        onOpenChange={setClientCreateOpen}
        initialCompanyName={clientCreateSeed}
        initialAccountOwner={profile?.full_name ?? draft.owner_name ?? ""}
        initialRegion={draft.country === "India" ? draft.region || "India West" : draft.region}
        initialSegment="Mid-market"
        initialMrr="$0"
        initialStatus="active"
        initialNextStep="Intro call"
        initialLastTouch="New"
        userId={profile?.id ?? null}
        partnerId={profile?.partner_id ?? null}
        onCreated={(customer) =>
          setDraft((current) => ({
            ...current,
            customer_id: customer.id,
            contact_name: customer.company_name,
          }))
        }
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: import("react").ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  onClick?: () => void;
}) {
  const content = (
    <CardContent className="space-y-1 p-5 text-left">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-sm text-muted-foreground">{hint}</div>
    </CardContent>
  );

  return onClick ? (
    <Card className="transition hover:-translate-y-0.5 hover:shadow-md">
      <button type="button" className="w-full text-left" onClick={onClick}>
        {content}
      </button>
    </Card>
  ) : (
    <Card>{content}</Card>
  );
}
