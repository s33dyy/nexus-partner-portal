export type CreateTicketInput = {
  subject: string;
  description: string;
  priority?: string | null;
  partnerId?: string | null;
  creatorName?: string | null;
  productSku?: string | null;
  serialNumber?: string | null;
};

export type AddTicketReplyInput = {
  ticketId: string;
  body: string;
  authorName?: string | null;
  authorRole?: string | null;
  isInternal?: boolean;
};
