export const NEWS_PLACEHOLDER_IMAGE_PATH = "/news/livey-wc350-qhd.png";

export type NewsPostRecord = {
  id: string;
  title: string;
  caption: string;
  image_path: string | null;
  image_alt: string | null;
  posted_by_name: string;
  posted_by_role: string;
  created_at: string;
  updated_at: string;
  is_seed: boolean;
};

export function hasNewsImage(imagePath: string | null | undefined) {
  const normalized = imagePath?.trim();
  return Boolean(normalized && normalized !== NEWS_PLACEHOLDER_IMAGE_PATH);
}

export function formatNewsRole(role: string) {
  return role.replace(/_/g, " ");
}

export function newsAuthorInitials(name: string | null | undefined) {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return "NY";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}
