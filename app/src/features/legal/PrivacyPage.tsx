import { LegalLayout, LegalSection } from "@/features/legal/LegalLayout";

const CONTACT = "hello@reel-app.com";

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="27 July 2026">
      <p className="dim" style={{ fontSize: 14.5, lineHeight: 1.65, margin: 0 }}>
        Reel (&ldquo;Reel&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is an invite-only beta app that helps you
        track the TV shows you watch and see what your friends thought of them. This policy explains what we
        collect, why, and the choices you have. We keep it deliberately short and plain.
      </p>

      <LegalSection heading="Who we are">
        Reel is a small, independently run service available at{" "}
        <a href="https://reel-app.com" style={{ color: "var(--accent)" }}>reel-app.com</a>. For any privacy
        question, contact us at{" "}
        <a href={`mailto:${CONTACT}`} style={{ color: "var(--accent)" }}>{CONTACT}</a>.
      </LegalSection>

      <LegalSection heading="What we collect">
        <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>
            <strong>Account details.</strong> Your email address, used to sign you in with a magic link. If you
            sign in with Google, we receive your email and basic profile (name and profile picture) from Google —
            nothing else, and we never receive your Google password.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Your activity in Reel.</strong> The shows you follow, episodes you mark as watched, your
            ratings and notes, and connections with friends you choose to add.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Data you import.</strong> If you upload a watch-history export (for example from TV Time), we
            store it to rebuild your library.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Basic technical data.</strong> Standard server logs (such as IP address and browser type)
            needed to run and secure the service.
          </li>
        </ul>
        We do <strong>not</strong> collect payment details, and we do not sell your data to anyone.
      </LegalSection>

      <LegalSection heading="How we use it">
        Only to run Reel: to sign you in, keep your library and ratings in sync, show you and your friends what
        you&rsquo;ve watched, send you the sign-in and product emails you expect, and keep the service secure.
        We do not use your data for advertising.
      </LegalSection>

      <LegalSection heading="Who we share it with">
        We don&rsquo;t sell or rent your personal data. We rely on a few trusted service providers who process
        data only on our behalf:
        <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
          <li style={{ marginBottom: 4 }}><strong>Supabase</strong> — database, authentication and storage.</li>
          <li style={{ marginBottom: 4 }}><strong>Cloudflare</strong> — hosting, content delivery and security.</li>
          <li style={{ marginBottom: 4 }}><strong>Resend</strong> — delivery of transactional email (sign-in links).</li>
          <li style={{ marginBottom: 4 }}><strong>Google</strong> — only if you choose &ldquo;Continue with Google&rdquo; to sign in.</li>
        </ul>
        We may also disclose data if required by law.
      </LegalSection>

      <LegalSection heading="Friends and visibility">
        Reel is social by design: activity such as the shows you watch and your ratings can be visible to friends
        you connect with inside the app. Only add people you&rsquo;re comfortable sharing that with.
      </LegalSection>

      <LegalSection heading="Cookies and local storage">
        We use only the storage strictly necessary to keep you signed in and to remember your preferences (such as
        theme). We don&rsquo;t use third-party advertising or tracking cookies.
      </LegalSection>

      <LegalSection heading="Keeping and deleting your data">
        We keep your data for as long as your account is active. You can ask us to delete your account and
        associated data at any time by emailing{" "}
        <a href={`mailto:${CONTACT}`} style={{ color: "var(--accent)" }}>{CONTACT}</a>, and we&rsquo;ll remove it
        (except anything we&rsquo;re legally required to retain).
      </LegalSection>

      <LegalSection heading="Children">
        Reel isn&rsquo;t directed at children under 13, and we don&rsquo;t knowingly collect their data.
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        If we make material changes, we&rsquo;ll update this page and the &ldquo;last updated&rdquo; date above.
      </LegalSection>

      <LegalSection heading="Contact">
        Questions about your privacy? Email{" "}
        <a href={`mailto:${CONTACT}`} style={{ color: "var(--accent)" }}>{CONTACT}</a>.
      </LegalSection>
    </LegalLayout>
  );
}
