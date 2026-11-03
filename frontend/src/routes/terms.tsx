import { LegalLayout, LegalSection } from "@/components/legal-layout";
import {
  COMPANY_ADDRESS,
  COMPANY_NAME,
  COMPANY_WEBSITE,
  CONTACT_EMAIL,
} from "@/lib/legal";

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <LegalSection title="Agreement">
        <p>
          These terms govern your use of postUploaders at app.postuploaders.com. By signing in or
          using the service you agree to them and to our <a href="/privacy">Privacy Policy</a>. If
          you do not agree, do not use postUploaders.
        </p>
        <p>
          postUploaders is operated by {COMPANY_NAME}, whose registered address is {COMPANY_ADDRESS}.
          Company website:{" "}
          <a href={COMPANY_WEBSITE} target="_blank" rel="noreferrer">
            {COMPANY_WEBSITE}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Who can use it">
        <p>
          You must be at least 18 and able to enter a binding agreement. If you use postUploaders on
          behalf of a business or a client, you confirm you are authorised to do so.
        </p>
      </LegalSection>

      <LegalSection title="Your account and workspaces">
        <p>
          You sign in with Google. You are responsible for activity under your account and for the
          people you invite to your workspaces. A workspace has one owner, who manages its members
          and connected accounts.
        </p>
      </LegalSection>

      <LegalSection id="youtube" title="YouTube Terms of Service">
        <p className="rounded-xl border bg-muted/50 p-4">
          postUploaders uses YouTube API Services. By using postUploaders, you agree to be bound by
          the{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
            YouTube Terms of Service
          </a>
          . Google's use of your information is covered by the{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google Privacy Policy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Connected platforms">
        <p>
          postUploaders publishes to Facebook, Instagram, Threads, YouTube and LinkedIn through
          their official APIs, using the access you grant. By connecting an account you confirm that
          you own it or are authorised to post to it, and you agree to follow the rules of each
          platform, including the{" "}
          <a href="https://www.facebook.com/terms" target="_blank" rel="noreferrer">
            Meta Terms
          </a>
          , the{" "}
          <a href="https://www.linkedin.com/legal/user-agreement" target="_blank" rel="noreferrer">
            LinkedIn User Agreement
          </a>
          , and, if you connect YouTube, the{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
            YouTube Terms of Service
          </a>
          . You can revoke access at any time in the platform's settings.
        </p>
        <p>
          Platforms can change or restrict their APIs, limit your account, or reject a post. We are
          not responsible for those decisions.
        </p>
      </LegalSection>

      <LegalSection title="Your content">
        <p>
          You keep ownership of everything you upload and post. You give us permission to store,
          process (for example resize or convert media to meet a platform's requirements) and
          transmit it to the platforms you choose, solely to provide the service. You are
          responsible for your content and for having the rights to it.
        </p>
        <p>
          Uploaded media is deleted 15 days after a post's send time. Keep your own copies of
          anything you need to keep.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You agree not to use postUploaders to:</p>
        <ul>
          <li>post spam, or send large volumes of repetitive or unsolicited content;</li>
          <li>post anything unlawful, deceptive, hateful, harassing or infringing;</li>
          <li>get around platform limits, or interfere with or overload the service;</li>
          <li>access accounts or data that are not yours.</li>
        </ul>
        <p>
          postUploaders applies per-platform posting limits and may pause an account when a
          platform's limit is reached or the platform flags activity as spam. We may suspend or
          remove access for breaches of these terms.
        </p>
      </LegalSection>

      <LegalSection title="Availability">
        <p>
          We work to publish posts at the time you choose, but we do not guarantee that every post
          will be delivered on time or at all. Delivery depends on third-party platforms and
          networks. postUploaders is provided "as is" and may change, have downtime, or be
          withdrawn. Check the status shown in the app for each post.
        </p>
      </LegalSection>

      <LegalSection title="Ending your use">
        <p>
          You can stop using postUploaders at any time and ask us to delete your data using the
          steps on the <a href="/data-deletion">data deletion page</a>. We can suspend or end your
          access if you breach these terms or if we stop offering the service.
        </p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          To the extent the law allows, we are not liable for indirect or consequential loss, lost
          profits, lost audience, or content removed or accounts restricted by a platform. Our total
          liability for any claim is limited to the amount you paid us for the service in the three
          months before the claim, or zero if you have not paid anything. Nothing in these terms
          limits liability that cannot be limited by law.
        </p>
      </LegalSection>

      <LegalSection title="Changes and governing law">
        <p>
          We may update these terms; continuing to use postUploaders after a change means you accept
          it. These terms are governed by the laws of India, and the courts of India have
          jurisdiction over any dispute.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
