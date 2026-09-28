import { useState } from "react";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

// Google profile photo, falling back to initials when there isn't one or it
// fails to load. no-referrer: googleusercontent.com intermittently 403s
// hotlinked avatars that carry a Referer.
export function UserAvatar({
  name,
  avatarUrl,
  className,
}: {
  name: string;
  avatarUrl: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const base = "size-8 shrink-0 rounded-full";

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        referrerPolicy="no-referrer"
        className={cn(base, "object-cover", className)}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={name}
      className={cn(
        base,
        "flex items-center justify-center bg-muted text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {initials(name) || "?"}
    </div>
  );
}
