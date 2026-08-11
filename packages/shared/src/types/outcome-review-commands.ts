export type SubmitPOInput = {
  dealId: string;
  poDocumentUrl: string;
  poNumber: string;
  poDate: string;
  poAmount: number;
  currencyCode: string;
};

export type ReviewOutcomeInput = {
  dealId: string;
  reason: string;
};
