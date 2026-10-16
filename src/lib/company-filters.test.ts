import { describe, expect, it } from "bun:test";

import { filterPartnerCompanies, type PartnerCompanyFilterRow } from "./company-filters";

const rows: PartnerCompanyFilterRow[] = [
  { id: "2", name: "Beta", legalName: "Beta Ltd", status: "active" },
  { id: "1", name: "Alpha", legalName: null, status: "deleted" },
  { id: "3", name: "Acme", legalName: "Acme Inc", status: "active" },
];

describe("filterPartnerCompanies", () => {
  it("searches name and legal name and sorts by name", () => {
    expect(filterPartnerCompanies(rows, { query: "inc" }).map((row) => row.id)).toEqual(["3"]);
    expect(filterPartnerCompanies(rows, {}).map((row) => row.name)).toEqual(["Acme", "Alpha", "Beta"]);
  });

  it("filters status", () => {
    expect(filterPartnerCompanies(rows, { status: "active" }).map((row) => row.id)).toEqual(["3", "2"]);
  });
});
