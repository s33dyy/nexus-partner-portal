import { expect, test } from "bun:test";

import { filterVisibleDealDocuments, type DealDocumentRecord } from "./document-access";

const documents: DealDocumentRecord[] = [
  {
    id: "doc-1",
    deal_id: "deal-1",
    partner_id: "partner-1",
    uploaded_by: "user-1",
    doc_type: "Purchase Order",
    file_name: "po-1.pdf",
    file_path: "partner-1/deal-1/po-1.pdf",
    mime_type: "application/pdf",
    size_bytes: 1200,
    created_at: "2026-07-29T00:00:00Z",
  },
  {
    id: "doc-2",
    deal_id: "deal-1",
    partner_id: "partner-1",
    uploaded_by: "user-2",
    doc_type: "Purchase Order",
    file_name: "po-2.pdf",
    file_path: "partner-1/deal-1/po-2.pdf",
    mime_type: "application/pdf",
    size_bytes: 1200,
    created_at: "2026-07-29T00:00:00Z",
  },
  {
    id: "doc-3",
    deal_id: "deal-2",
    partner_id: "partner-2",
    uploaded_by: "user-3",
    doc_type: "Purchase Order",
    file_name: "po-3.pdf",
    file_path: "partner-2/deal-2/po-3.pdf",
    mime_type: "application/pdf",
    size_bytes: 1200,
    created_at: "2026-07-29T00:00:00Z",
  },
];

test("partner admin can see every deal document for their partner but not other partners", () => {
  const visible = filterVisibleDealDocuments(documents, {
    viewerUserId: "admin-1",
    viewerRole: "partner_admin",
    isSuperAdmin: false,
    isPartnerAdmin: true,
    partnerId: "partner-1",
    collaboratorUserIdsByDeal: new Map(),
  });

  expect(visible.map((doc) => doc.id)).toEqual(["doc-1", "doc-2"]);
});

test("partner user can see only their own or collaborated deal documents within their partner", () => {
  const visible = filterVisibleDealDocuments(documents, {
    viewerUserId: "user-1",
    viewerRole: "partner_user",
    isSuperAdmin: false,
    isPartnerAdmin: false,
    partnerId: "partner-1",
    collaboratorUserIdsByDeal: new Map([["deal-1", ["user-1", "user-2"]]]),
  });

  expect(visible.map((doc) => doc.id)).toEqual(["doc-1", "doc-2"]);
});

test("super admin can see every deal document", () => {
  const visible = filterVisibleDealDocuments(documents, {
    viewerUserId: "super-1",
    viewerRole: "super_admin",
    isSuperAdmin: true,
    isPartnerAdmin: false,
    partnerId: null,
    collaboratorUserIdsByDeal: new Map(),
  });

  expect(visible.map((doc) => doc.id)).toEqual(["doc-1", "doc-2", "doc-3"]);
});
