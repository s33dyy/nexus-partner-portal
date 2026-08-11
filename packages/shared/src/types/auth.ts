import type { RoleKey } from "../contracts/taxonomy";
import type { PartnerStatus } from "../lib/partner-status";

export type AppRole = RoleKey;
export type { PartnerStatus };

export type LocalUser = {
  id: string;
  email: string;
  user_metadata: {
    full_name: string;
    phone: string | null;
    company_name: string | null;
  };
};

export type LocalSession = {
  expires_at: number;
  user: LocalUser;
};

// Server-only session shape. The raw token is stored in an HttpOnly cookie
// and must never be serialized into browser responses.
export type IssuedSession = LocalSession & {
  access_token: string;
};
