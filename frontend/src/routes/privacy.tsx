import { LegalLayout, LegalSection } from "@/components/legal-layout";
import { CONTACT_EMAIL } from "@/lib/legal";

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <LegalSection title="Who we are">
        <p>
          smPosting ("we", "us") is a social publishing tool at app.postuploaders.com. You connect
          your own social media accounts, write a post once, and we publish or schedule it to the
          accounts you choose. This policy explains what data we handle to do that, and what we do
          not do with it.
        </p>
        <p>
          Questions about this policy: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection title="Data we collect">
        <p>
          <strong>When you sign in with Google:</strong> your email address, name, profile picture
          and Google account ID. We use these to identify you and show who you are in the app. We do
          not ask Google for any other data about you.
        </p>
        <p>
          <strong>When you connect a social account</strong> (Facebook Page, Instagram, Threads,
          YouTube channel, LinkedIn profile): the account's name and platform ID, and the access
          tokens the platform gives us so we can publish on your behalf. Tokens are encrypted at
          rest and are only decrypted at the moment a post is sent.
        </p>
        <p>
          <strong>What you create in smPosting:</strong> captions, titles, images and videos you
          upload, the accounts and times you pick, and a log of each post's result (published,
          failed, and the reason).
        </p>
        <p>
          <strong>Workspaces:</strong> the workspaces you create or join, and the email addresses of
          people you invite to them.
        </p>
        <p>
          <strong>Technical data:</strong> a session cookie that keeps you signed in (up to 7 days),
          and, where enabled, error and performance telemetry from your browser (page views,
          JavaScript errors, load timings). Telemetry is linked to an internal user ID, not to your
          email or name.
        </p>
      </LegalSection>

      <LegalSection title="How we use it">
        <ul>
          <li>To sign you in and keep your workspaces separate from other people's.</li>
          <li>
            To publish, schedule and retry the posts you create, and to show you their status and
            history.
          </li>
          <li>To keep the service secure and fix errors.</li>
        </ul>
        <p>
          We use the permissions you grant on Facebook, Instagram, Threads, YouTube and LinkedIn
          only to publish the content you create and to show you the connected account's name. We do
          not sell your data, use it for advertising, or use it to train machine-learning models. We
          do not read your messages or your followers' personal data.
        </p>
      </LegalSection>

      <LegalSection id="google" title="Google user data">
        <p>
          smPosting's use and transfer to any other app of information received from Google APIs
          will adhere to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p>
          When you connect YouTube, you are also bound by the{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
            YouTube Terms of Service
          </a>
          , and Google handles your data under the{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google Privacy Policy
          </a>
          . We use the YouTube permissions only to upload the videos you choose and to read your
          channel's name and ID and the processing status of videos we uploaded. You can revoke
          smPosting's access to your Google account at any time in your{" "}
          <a
            href="https://security.google.com/settings/security/permissions"
            target="_blank"
            rel="noreferrer"
          >
            Google security settings
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <p>We share data only with the services needed to run smPosting:</p>
        <ul>
          <li>
            <strong>The platforms you publish to</strong> (Meta for Facebook, Instagram and Threads;
            Google for YouTube; LinkedIn). They receive your post content and media when you
            publish, and handle it under their own privacy policies.
          </li>
          <li>
            <strong>Google</strong>, for sign-in.
          </li>
          <li>
            <strong>Amazon Web Services</strong>, where smPosting's servers, database and uploaded
            media are hosted.
          </li>
          <li>
            <strong>Grafana Labs</strong>, which receives the error and performance telemetry
            described above, when it is enabled.
          </li>
        </ul>
        <p>
          We may disclose data if the law requires it. We do not share your data with anyone else.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <ul>
          <li>
            <strong>Uploaded images and videos:</strong> deleted 15 days after the post's send time
            (or 15 days after you created it, if it was not scheduled). Uploads that are never used
            in a post are deleted after 24 hours.
          </li>
          <li>
            <strong>Connected account tokens:</strong> kept while the account is connected, so
            scheduled posts can go out. Disconnecting an account, or removing smPosting in Facebook,
            Instagram or Threads settings, deletes its tokens straight away.
          </li>
          <li>
            <strong>Post text, history and logs, and your profile:</strong> kept until you ask us to
            delete them.
          </li>
        </ul>
        <p>
          To have everything removed, follow the steps on the{" "}
          <a href="/data-deletion">data deletion page</a>.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and local storage">
        <p>
          We use one cookie to keep you signed in, and your browser's local storage to remember the
          workspace you last opened. We do not use advertising or tracking cookies.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Access tokens are encrypted with AES-256-GCM before they are stored. All traffic uses
          HTTPS. Sessions use a secure, HTTP-only cookie. No system is perfectly secure, so we
          cannot guarantee absolute security, but we will tell affected users if a breach exposes
          their data.
        </p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <ul>
          <li>
            Disconnect any social account from the Dashboard (Connected accounts). Its access tokens
            are deleted straight away.
          </li>
          <li>
            Revoke smPosting's access directly in Google, Facebook, Instagram, Threads or LinkedIn
            settings.
          </li>
          <li>
            Ask us for a copy of the data we hold about you, to correct it, or to delete it, by
            emailing <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          smPosting is for people aged 18 and over. We do not knowingly collect data from anyone
          younger. If you believe we have, contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          If we change this policy in a way that affects you, we will update the date at the top
          and, for significant changes, notify you in the app or by email.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
