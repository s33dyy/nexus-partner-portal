export type TagDealParticipantInput = {
  dealId: string;
  participantUserId: string;
  participantUserName?: string | null;
  participantType: string;
  reason: string;
};

export type UntagDealParticipantInput = {
  dealId: string;
  participantId: string;
};

export type TagCustomerParticipantInput = {
  customerId: string;
  participantUserId: string;
  participantUserName?: string | null;
  participantType: string;
  reason: string;
};

export type UntagCustomerParticipantInput = {
  customerId: string;
  participantId: string;
};
