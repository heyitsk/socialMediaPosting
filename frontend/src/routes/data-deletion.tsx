import { Mail } from "lucide-react";
import { useSearchParams } from "react-router";
import { LegalLayout, LegalSection } from "@/components/legal-layout";
import { Button } from "@/components/ui/button";
import { CONTACT_EMAIL, deletionRequestHref } from "@/lib/legal";

// Also the "User data deletion" instructions URL for the Meta app settings.
// If a Meta deletion callback redirects here with ?code=<confirmation_code>,
// the code is shown so the user can quote it.
export function DataDeletionPage() {
  const [searchParams] = useSearchParams();
  const rawCode = searchParams.get("code");
  const code = rawCode && /^[A-Za-z0-9_-]{1,64}$/.test(rawCode) ? rawCode : null;

  return (
    <LegalLayout title="Data deletion">
      {code && (
        <div role="status" className="rounded-xl border bg-muted/50 p-4 text-sm leading-7">
          We received your deletion request from Meta and deleted the access tokens we held for your
          Facebook, Instagram or Threads connection. Your confirmation code is{" "}
          <code className="rounded bg-background px-1.5 py-0.5 font-mono">{code}</code>. To also
          delete your postUploaders profile, posts and history, email us and quote this code.
        </div>
      )}

      <LegalSection title="Delete your data">
        <p>
          You can ask us to delete everything postUploaders holds about you. Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the Google account you sign
          in with, or use the button below.
        </p>
        <Button asChild>
          <a href={deletionRequestHref(code)}>
            <Mail className="size-4" aria-hidden="true" />
            Request deletion by email
          </a>
        </Button>
        <p>
          We will confirm by reply and complete the deletion within 30 days. If the request comes
          from an address other than your sign-in email, we may ask you to verify that the account
          is yours first.
        </p>
      </LegalSection>

      <LegalSection title="What gets deleted">
        <ul>
          <li>your profile (email, name, profile picture and Google account ID);</li>
          <li>
            the access tokens for every Facebook, Instagram, Threads, YouTube and LinkedIn account
            you connected, and the stored account names and IDs;
          </li>
          <li>your posts, their history and logs;</li>
          <li>any uploaded images and videos still stored;</li>
          <li>workspaces you own, and your membership of workspaces you joined.</li>
        </ul>
        <p>
          Posts that were already published stay on the platforms where they were published. We
          cannot remove them from there; delete them on the platform itself. Copies in our backups
          are overwritten as backups rotate.
        </p>
      </LegalSection>

      <LegalSection title="Disconnect without deleting your account">
        <p>
          To stop postUploaders publishing to a single account, sign in, open the Dashboard and
          click Disconnect next to it under Connected accounts. We delete that account's access
          tokens straight away. To cut off postUploaders's access at the source, also remove it in
          the platform's own settings, without signing in to postUploaders:
        </p>
        <ul>
          <li>
            <strong>Google / YouTube:</strong>{" "}
            <a
              href="https://security.google.com/settings/security/permissions"
              target="_blank"
              rel="noreferrer"
            >
              Google security settings
            </a>
          </li>
          <li>
            <strong>Facebook:</strong>{" "}
            <a
              href="https://www.facebook.com/settings?tab=business_tools"
              target="_blank"
              rel="noreferrer"
            >
              Business integrations
            </a>{" "}
            (removing postUploaders here also revokes its Instagram access if you connected through
            Facebook)
          </li>
          <li>
            <strong>Instagram:</strong>{" "}
            <a
              href="https://www.instagram.com/accounts/manage_access/"
              target="_blank"
              rel="noreferrer"
            >
              Apps and websites
            </a>
          </li>
          <li>
            <strong>Threads:</strong> Settings, then Account, then Website permissions
          </li>
          <li>
            <strong>LinkedIn:</strong>{" "}
            <a
              href="https://www.linkedin.com/psettings/permitted-services"
              target="_blank"
              rel="noreferrer"
            >
              Permitted services
            </a>
          </li>
        </ul>
        <p>
          Revoking access on a platform stops us publishing there, but does not by itself delete the
          data we already hold. For that, send a deletion request as described above.
        </p>
      </LegalSection>

      <LegalSection title="More information">
        <p>
          See our <a href="/privacy">Privacy Policy</a> for what we store and how long we keep it.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
