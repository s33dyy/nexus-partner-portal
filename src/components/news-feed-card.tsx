import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatDateLabel } from "@/lib/date-utils";
import {
  formatNewsRole,
  hasNewsImage,
  newsAuthorInitials,
  type NewsPostRecord,
} from "@/lib/portal-news-data";

export function NewsFeedCard({ post }: { post: NewsPostRecord }) {
  const imagePath = post.image_path?.trim() ?? "";
  const imageAlt = post.image_alt?.trim() || post.title || "LIVEY update";

  if (!hasNewsImage(imagePath)) {
    return (
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-l-4 border-primary/60 bg-gradient-to-br from-primary/5 via-background to-background p-4">
          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10 border">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {newsAuthorInitials(post.posted_by_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold leading-tight">{post.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {post.posted_by_name} · {formatNewsRole(post.posted_by_role)}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {formatDateLabel(post.created_at)}
                </Badge>
              </div>
              <div className="mt-3 whitespace-pre-line text-sm leading-6 text-foreground/90">
                {post.caption}
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary/70" />
                Text update
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <img src={imagePath} alt={imageAlt} className="aspect-[4/3] w-full object-cover" />
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{post.title}</div>
            <div className="text-xs text-muted-foreground">
              {post.posted_by_name} · {formatNewsRole(post.posted_by_role)}
            </div>
          </div>
          <Badge variant="outline">{formatDateLabel(post.created_at)}</Badge>
        </div>
        <div className="whitespace-pre-line text-sm text-muted-foreground">{post.caption}</div>
      </div>
    </div>
  );
}
