import { pool } from "@/server/postgres.server";
import { queryTableWithAuthContext } from "@/server/livey-service.server";
import type { QueryFilter, TablePolicyAuthContext } from "@/server/table-policy.server";
import { filterNewsPostsForViewer, resolveNewsViewer } from "@/lib/news-targeting";

/**
 * Reads news posts with audience targeting applied.
 *
 * portal_news_posts is a PUBLIC_READ_TABLE, so the generic policy layer hands
 * back every row — and its filters are ANDed column comparisons, which cannot
 * express "untargeted OR addressed to me" across two array columns. So the
 * audience rule is applied here instead, and every server-side reader of the
 * feed (the briefing digest, the Assistant) goes through this one function
 * rather than each re-deriving it. The dashboard applies the same rule to its
 * own client query via the shared helpers in lib/news-targeting.
 */
export async function fetchNewsPostsForViewer(
  auth: TablePolicyAuthContext,
  filters: QueryFilter[] = [],
): Promise<Record<string, unknown>[]> {
  const { data, error } = await queryTableWithAuthContext(
    {
      table: "portal_news_posts",
      operation: "select",
      filters,
      order: { column: "created_at", ascending: false },
    },
    auth,
  );
  if (error || !Array.isArray(data)) return [];

  const rows = data as Record<string, unknown>[];
  if (auth.roles.includes("super_admin")) return rows;

  return filterNewsPostsForViewer(
    rows,
    resolveNewsViewer({
      partnerId: auth.partnerId,
      partnerCountry: await partnerCountry(auth.partnerId),
    }),
    { isSuperAdmin: false },
  );
}

/**
 * The viewer's country, for the region half of the audience rule.
 *
 * A partner we cannot read a country for stays region-unknown, which means
 * region-targeted posts are hidden from them rather than shown on a guess.
 */
async function partnerCountry(partnerId: string | null): Promise<string | null> {
  if (!partnerId) return null;
  const result = await pool.query<{ country: string | null }>(
    "SELECT country FROM partners WHERE id = $1",
    [partnerId],
  );
  return result.rows[0]?.country ?? null;
}
