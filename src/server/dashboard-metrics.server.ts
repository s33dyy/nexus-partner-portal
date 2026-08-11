import { filterVisibleDeals, groupCollaboratorIdsByDeal } from "@/lib/deal-visibility";
import { isOpenPipelineStage, summarizeOpenPipeline } from "@/lib/pipeline-metrics";
import { matchesSelectedRegion, type RegionFilterValue } from "@/lib/region-filter";
import { queryTableWithAuthContext } from "@/server/livey-service.server";
import { pool } from "@/server/postgres.server";
import type { TablePolicyAuthContext } from "@/server/table-policy.server";

type DealRow = {
  id: string;
  stage: string;
  user_id: string | null;
  partner_id: string | null;
  is_hidden_to_team: boolean;
  country: string | null;
  amount_usd: number | string | null;
  amount_value: number | string | null;
  currency_code: string | null;
};

export type DashboardPipelineResult =
  | {
      ok: true;
      metrics: {
        pipelineValueUsd: number;
        openDealCount: number;
        missingDtpCount: number;
      };
    }
  | { ok: false; code: "POLICY_DENIED" | "QUERY_FAILED"; message: string };

export async function loadDashboardPipelineMetrics(input: {
  auth: TablePolicyAuthContext;
  selectedRegion: RegionFilterValue;
}): Promise<DashboardPipelineResult> {
  try {
    const dealResult = await queryTableWithAuthContext(
      {
        table: "portal_deals",
        operation: "select",
        select:
          "id,stage,user_id,partner_id,is_hidden_to_team,country,amount_usd,amount_value,currency_code",
      },
      input.auth,
    );
    if (dealResult.error) {
      return { ok: false, code: "POLICY_DENIED", message: "Pipeline is not accessible" };
    }

    const authorisedDeals = (dealResult.data as DealRow[] | null) ?? [];
    if (authorisedDeals.length === 0) {
      return {
        ok: true,
        metrics: { pipelineValueUsd: 0, openDealCount: 0, missingDtpCount: 0 },
      };
    }

    const authorisedIds = authorisedDeals.map((deal) => deal.id);
    const collaboratorResult = await pool.query(
      `SELECT deal_id, user_id
       FROM portal_deal_collaborators
       WHERE deal_id = ANY($1::uuid[])`,
      [authorisedIds],
    );
    const collaboratorMap = groupCollaboratorIdsByDeal(
      collaboratorResult.rows as Array<{ deal_id: string; user_id: string }>,
    );
    const visibleDeals = filterVisibleDeals(authorisedDeals, collaboratorMap, {
      viewerUserId: input.auth.userId,
      viewerRole: input.auth.governedRoleKey ?? input.auth.roles[0] ?? "",
      isSuperAdmin: input.auth.roles.includes("super_admin"),
      isPartnerAdmin: input.auth.roles.includes("partner_admin"),
    }).filter(
      (deal) =>
        isOpenPipelineStage(deal.stage) &&
        matchesSelectedRegion(deal.country, input.selectedRegion),
    );

    if (visibleDeals.length === 0) {
      return {
        ok: true,
        metrics: { pipelineValueUsd: 0, openDealCount: 0, missingDtpCount: 0 },
      };
    }

    const visibleIds = visibleDeals.map((deal) => deal.id);
    const revisionResult = await pool.query(
      `SELECT DISTINCT ON (deal_id) deal_id, total_dtp_usd
       FROM pricing_revisions
       WHERE deal_id = ANY($1::uuid[])
       ORDER BY deal_id, revision_number DESC, created_at DESC, id DESC`,
      [visibleIds],
    );
    const dtpByDeal = new Map(
      (
        revisionResult.rows as Array<{ deal_id: string; total_dtp_usd: string | number | null }>
      ).map((row) => [row.deal_id, row.total_dtp_usd == null ? null : Number(row.total_dtp_usd)]),
    );

    return {
      ok: true,
      metrics: summarizeOpenPipeline(
        visibleDeals.map((deal) => ({
          id: deal.id,
          stage: deal.stage,
          effectiveDtpUsd: dtpByDeal.get(deal.id) ?? null,
          amountUsd: deal.amount_usd == null ? null : Number(deal.amount_usd),
          amountValue: deal.amount_value == null ? null : Number(deal.amount_value),
          currencyCode: deal.currency_code,
        })),
      ),
    };
  } catch {
    return { ok: false, code: "QUERY_FAILED", message: "Pipeline metrics could not be loaded" };
  }
}
