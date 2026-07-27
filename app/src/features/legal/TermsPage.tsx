import { LegalLayout, LegalSection } from "@/features/legal/LegalLayout";

const CONTACT = "hello@reel-app.com";

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="27 July 2026">
      <p className="dim" style={{ fontSize: 14.5, lineHeight: 1.65, margin: 0 }}>
        These terms are the agreement between you and Reel (&ldquo;Reel&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;)
        for using{" "}
        <a href="https://reel-app.com" style={{ color: "var(--accent)" }}>reel-app.com</a>. By creating an account
        or using the service, you agree to them.
      </p>

      <LegalSection heading="The service">
        Reel is an invite-only beta that helps you track the shows you watch and share ratings with friends.
        Because it&rsquo;s a beta, features may change, break, or be removed, and the service is provided on an
        &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis without warranties of any kind.
      </LegalSection>

      <LegalSection heading="Your account">
        You need an invite to join. Keep your account secure and don&rsquo;t share access. You&rsquo;re
        responsible for the activity that happens under your account. You must be at least 13 years old to use
        Reel.
      </LegalSection>

      <LegalSection heading="Acceptable use">
        Use Reel lawfully and reasonably. Don&rsquo;t misuse or disrupt the service, attempt to break its
        security, access other people&rsquo;s data without permission, scrape it at scale, or use it to store or
        share unlawful content. We may suspend accounts that break these rules.
      </LegalSection>

      <LegalSection heading="Your content">
        Your library, ratings, notes and imported data remain yours. You grant us the limited permission needed to
        store and display that content so the service works for you and the friends you share it with. You&rsquo;re
        responsible for the content you add and for having the right to upload anything you import.
      </LegalSection>

      <LegalSection heading="Third-party content">
        Show titles, artwork and related metadata come from third-party sources and belong to their respective
        owners. They&rsquo;re provided for personal, informational use within Reel.
      </LegalSection>

      <LegalSection heading="Availability and changes">
        We may add, change, suspend or discontinue any part of Reel at any time, including during this beta. We
        may also update these terms; if we make material changes we&rsquo;ll update this page and the
        &ldquo;last updated&rdquo; date. Continuing to use Reel after a change means you accept the new terms.
      </LegalSection>

      <LegalSection heading="Ending your use">
        You can stop using Reel and ask us to delete your account at any time by emailing{" "}
        <a href={`mailto:${CONTACT}`} style={{ color: "var(--accent)" }}>{CONTACT}</a>. We may suspend or end
        access if you break these terms or to protect the service.
      </LegalSection>

      <LegalSection heading="Liability">
        To the extent permitted by law, Reel is provided without warranties, and we&rsquo;re not liable for
        indirect or consequential losses, or for loss of data, arising from your use of a beta service. Nothing in
        these terms limits liability that can&rsquo;t be limited by law.
      </LegalSection>

      <LegalSection heading="Governing law">
        These terms are governed by the laws of Spain, and any dispute will be subject to the competent courts
        there, unless mandatory local consumer law says otherwise.
      </LegalSection>

      <LegalSection heading="Contact">
        Questions about these terms? Email{" "}
        <a href={`mailto:${CONTACT}`} style={{ color: "var(--accent)" }}>{CONTACT}</a>.
      </LegalSection>
    </LegalLayout>
  );
}
