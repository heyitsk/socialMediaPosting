// Shared by the public legal pages (routes/privacy.tsx, terms.tsx,
// data-deletion.tsx). Meta and Google review these pages by URL, so the
// contact address must be a mailbox that is actually monitored.
export const CONTACT_EMAIL = "support@postuploaders.com";
export const COMPANY_NAME = "CLICK 72";
export const COMPANY_ADDRESS = "85, Park Street, Kolkata 700016, India";
export const COMPANY_WEBSITE = "https://click72.com/";

// Bump when a page's wording changes in a way that affects users.
export const LEGAL_UPDATED = "1 November 2026";

// `code` is the confirmation code Meta's deletion callback appends to the
// redirect URL, so a request can be matched to it.
export function deletionRequestHref(code?: string | null) {
  const subject = `Delete my postUploaders data${code ? ` (${code})` : ""}`;
  const body =
    "Please delete my postUploaders account and all data associated with it.\n\n" +
    "Google account email I sign in with: \n" +
    (code ? `Confirmation code: ${code}\n` : "");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
