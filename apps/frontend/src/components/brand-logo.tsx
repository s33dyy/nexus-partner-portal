type BrandLogoProps = {
  variant?: "wordmark" | "icon";
  className?: string;
  alt?: string;
};

const sources: Record<NonNullable<BrandLogoProps["variant"]>, string> = {
  wordmark: "/brand/livey-wordmark.png",
  icon: "/brand/livey-favicon.png",
};

export function BrandLogo({
  variant = "wordmark",
  className = "",
  alt = "LIVEY",
}: BrandLogoProps) {
  return (
    <img
      src={sources[variant]}
      alt={alt}
      className={className}
      loading="eager"
      draggable={false}
    />
  );
}
