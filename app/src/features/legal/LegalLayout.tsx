import type { ReactNode } from "react";
import { Link } from "react-router";
import { Logo, LangToggle } from "@/ui";
import { t } from "@/lib/i18n";

/**
 * Shared shell for the public /privacy and /terms pages. These render outside
 * the auth gate (see main.tsx) so signed-out visitors — and Google's OAuth
 * brand-verification reviewer — can reach them without logging in. A language
 * switch sits in the header since there's no in-app Settings here.
 */
export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main style={{ minHeight: "100dvh", padding: "28px 20px 80px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 30 }}>
          <Link to="/" aria-label="Reel home">
            <Logo tagline={false} />
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LangToggle />
            <Link to="/" className="btn btn-ghost btn-sm">
              {t("Back to Reel")}
            </Link>
          </div>
        </div>

        <article className="card sheet legal" style={{ padding: "34px 32px" }}>
          <h1 className="section-title" style={{ margin: 0, fontSize: 26 }}>
            {title}
          </h1>
          <p className="mute" style={{ fontSize: 13, margin: "8px 0 26px" }}>
            {t("Last updated")} {updated}
          </p>
          {children}
        </article>

        <p className="mute" style={{ fontSize: 12.5, textAlign: "center", marginTop: 26 }}>
          <Link to="/privacy" style={{ color: "var(--accent)" }}>{t("Privacy Policy")}</Link>
          {" · "}
          <Link to="/terms" style={{ color: "var(--accent)" }}>{t("Terms of Service")}</Link>
        </p>
      </div>
    </main>
  );
}

/** A titled section with consistent spacing and prose colour. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 17, fontWeight: 650, margin: "0 0 8px", color: "var(--text)" }}>{heading}</h2>
      <div className="dim" style={{ fontSize: 14.5, lineHeight: 1.65 }}>{children}</div>
    </section>
  );
}
