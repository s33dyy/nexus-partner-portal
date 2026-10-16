export type PartnerCompanyFilterRow = {
  id: string;
  name: string;
  legalName: string | null;
  status: string;
};

export function filterPartnerCompanies(
  rows: PartnerCompanyFilterRow[],
  filters: { query?: string; status?: string },
) {
  const query = filters.query?.trim().toLowerCase() ?? "";
  return rows
    .filter((row) => {
      const matchesQuery =
        !query || `${row.name} ${row.legalName ?? ""}`.toLowerCase().includes(query);
      return (
        matchesQuery &&
        (!filters.status || filters.status === "all" || row.status === filters.status)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
