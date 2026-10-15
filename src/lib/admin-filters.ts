import { normalizeFilterText } from "./advanced-filters";

export type AdminUserFilterRecord = {
  id: string;
  full_name: string;
  email: string;
  company_name: string | null;
  partner_id: string | null;
  region: string | null;
  country: string | null;
  account_status: string;
  verification_status: string;
  roles: readonly string[];
};

export type AdminUserFilters = {
  text?: string;
  user?: string;
  role?: string;
  partner?: string;
  region?: string;
  country?: string;
  accountStatus?: string;
  verificationStatus?: string;
};

export function filterAdminUsers<T extends AdminUserFilterRecord>(
  users: readonly T[],
  filters: AdminUserFilters,
): T[] {
  const text = normalizeFilterText(filters.text);
  return users.filter((user) => {
    if (filters.user && user.id !== filters.user) return false;
    if (
      text &&
      ![user.full_name, user.email, user.company_name ?? "", user.roles.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(text)
    ) {
      return false;
    }
    if (filters.role && !user.roles.includes(filters.role)) return false;
    if (filters.partner === "__none__" && user.partner_id !== null) return false;
    if (filters.partner && filters.partner !== "__none__" && user.partner_id !== filters.partner)
      return false;
    if (filters.region && user.region !== filters.region) return false;
    if (filters.country && user.country !== filters.country) return false;
    if (filters.accountStatus && user.account_status !== filters.accountStatus) return false;
    if (filters.verificationStatus && user.verification_status !== filters.verificationStatus) {
      return false;
    }
    return true;
  });
}

export type AdminRoleFilterRecord = {
  roleKey: string;
  label: string;
  scope: string;
  capabilityState: string;
};

export type AdminRoleFilters = {
  text?: string;
  scope?: string;
  capabilityState?: string;
};

export function filterAdminRoles<T extends AdminRoleFilterRecord>(
  roles: readonly T[],
  filters: AdminRoleFilters,
): T[] {
  const text = normalizeFilterText(filters.text);
  return roles.filter((role) => {
    if (text && !normalizeFilterText(`${role.roleKey} ${role.label}`).includes(text)) {
      return false;
    }
    if (filters.scope && role.scope !== filters.scope) return false;
    if (filters.capabilityState && role.capabilityState !== filters.capabilityState) return false;
    return true;
  });
}
