// Shared by the public legal pages (routes/privacy.tsx, terms.tsx,
// data-deletion.tsx). Meta and Google review these pages by URL, so the
// contact address must be a mailbox that is actually monitored.
export const CONTACT_EMAIL = "support@postuploaders.com";

// Bump when a page's wording changes in a way that affects users.
export const LEGAL_UPDATED = "6 October 2026";

// `code` is the confirmation code Meta's deletion callback appends to the
// redirect URL, so a request can be matched to it.
export function deletionRequestHref(code?: string | null) {
  const subject = `Delete my smPosting data${code ? ` (${code})` : ""}`;
  const body =
    "Please delete my smPosting account and all data associated with it.\n\n" +
    "Google account email I sign in with: \n" +
    (code ? `Confirmation code: ${code}\n` : "");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
