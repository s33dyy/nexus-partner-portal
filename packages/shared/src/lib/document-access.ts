import { groupCollaboratorIdsByDeal } from "./deal-visibility";

export type DealDocumentRecord = {
  id: string;
  deal_id: string;
  partner_id: string;
  uploaded_by: string;
  doc_type: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export type DealDocumentAccessContext = {
  viewerUserId: string | null;
  viewerRole: "super_admin" | "partner_admin" | "partner_user" | string;
  isSuperAdmin: boolean;
  isPartnerAdmin: boolean;
  partnerId: string | null;
  collaboratorUserIdsByDeal: Map<string, string[]>;
};

export function canViewDealDocument(
  document: Pick<DealDocumentRecord, "partner_id" | "deal_id" | "uploaded_by">,
  context: DealDocumentAccessContext,
) {
  if (context.isSuperAdmin) {
    return true;
  }

  if (!context.partnerId || document.partner_id !== context.partnerId) {
    return false;
  }

  if (context.isPartnerAdmin) {
    return true;
  }

  if (!context.viewerUserId) {
    return false;
  }

  if (document.uploaded_by === context.viewerUserId) {
    return true;
  }

  const collaboratorIds = context.collaboratorUserIdsByDeal.get(document.deal_id) ?? [];
  return collaboratorIds.includes(context.viewerUserId);
}

export function filterVisibleDealDocuments<T extends DealDocumentRecord>(
  documents: T[],
  context: Omit<DealDocumentAccessContext, "collaboratorUserIdsByDeal"> & {
    collaboratorUserIdsByDeal: Map<string, string[]>;
  },
) {
  return documents.filter((document) => canViewDealDocument(document, context));
}

export function groupDealDocumentCollaborators(
  collaborators: Array<{ deal_id: string; user_id: string }>,
) {
  return groupCollaboratorIdsByDeal(collaborators);
}
