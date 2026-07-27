import type { ReactNode } from "react";
import { LegalLayout, LegalSection } from "@/features/legal/LegalLayout";
import { useSettings } from "@/lib/settings";

const CONTACT = "hello@reel-app.com";
const mail = <a href={`mailto:${CONTACT}`} style={{ color: "var(--accent)" }}>{CONTACT}</a>;
const site = <a href="https://reel-app.com" style={{ color: "var(--accent)" }}>reel-app.com</a>;

interface Content {
  title: string;
  updated: string;
  intro: ReactNode;
  sections: { heading: string; body: ReactNode }[];
}

const EN: Content = {
  title: "Terms of Service",
  updated: "27 July 2026",
  intro: (
    <>
      These terms are the agreement between you and Reel (&ldquo;Reel&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;)
      for using {site}. By creating an account or using the service, you agree to them.
    </>
  ),
  sections: [
    { heading: "The service", body: <>Reel is an invite-only beta that helps you track the shows you watch and share ratings with friends. Because it&rsquo;s a beta, features may change, break, or be removed, and the service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis without warranties of any kind.</> },
    { heading: "Your account", body: <>You need an invite to join. Keep your account secure and don&rsquo;t share access. You&rsquo;re responsible for the activity that happens under your account. You must be at least 13 years old to use Reel.</> },
    { heading: "Acceptable use", body: <>Use Reel lawfully and reasonably. Don&rsquo;t misuse or disrupt the service, attempt to break its security, access other people&rsquo;s data without permission, scrape it at scale, or use it to store or share unlawful content. We may suspend accounts that break these rules.</> },
    { heading: "Your content", body: <>Your library, ratings, notes and imported data remain yours. You grant us the limited permission needed to store and display that content so the service works for you and the friends you share it with. You&rsquo;re responsible for the content you add and for having the right to upload anything you import.</> },
    { heading: "Third-party content", body: <>Show titles, artwork and related metadata come from third-party sources and belong to their respective owners. They&rsquo;re provided for personal, informational use within Reel.</> },
    { heading: "Availability and changes", body: <>We may add, change, suspend or discontinue any part of Reel at any time, including during this beta. We may also update these terms; if we make material changes we&rsquo;ll update this page and the &ldquo;last updated&rdquo; date. Continuing to use Reel after a change means you accept the new terms.</> },
    { heading: "Ending your use", body: <>You can stop using Reel and ask us to delete your account at any time by emailing {mail}. We may suspend or end access if you break these terms or to protect the service.</> },
    { heading: "Liability", body: <>To the extent permitted by law, Reel is provided without warranties, and we&rsquo;re not liable for indirect or consequential losses, or for loss of data, arising from your use of a beta service. Nothing in these terms limits liability that can&rsquo;t be limited by law.</> },
    { heading: "Governing law", body: <>These terms are governed by the laws of Spain, and any dispute will be subject to the competent courts there, unless mandatory local consumer law says otherwise.</> },
    { heading: "Contact", body: <>Questions about these terms? Email {mail}.</> },
  ],
};

const ES: Content = {
  title: "Términos del Servicio",
  updated: "27 de julio de 2026",
  intro: (
    <>
      Estos términos son el acuerdo entre tú y Reel (&ldquo;Reel&rdquo;, &ldquo;nosotros&rdquo;) para usar {site}.
      Al crear una cuenta o usar el servicio, los aceptas.
    </>
  ),
  sections: [
    { heading: "El servicio", body: <>Reel es una beta por invitación que te ayuda a llevar la cuenta de las series que ves y a compartir valoraciones con tus amigos. Al ser una beta, las funciones pueden cambiar, fallar o desaparecer, y el servicio se ofrece &ldquo;tal cual&rdquo; y &ldquo;según disponibilidad&rdquo;, sin garantías de ningún tipo.</> },
    { heading: "Tu cuenta", body: <>Necesitas una invitación para unirte. Mantén tu cuenta segura y no compartas el acceso. Eres responsable de la actividad que ocurra bajo tu cuenta. Debes tener al menos 13 años para usar Reel.</> },
    { heading: "Uso aceptable", body: <>Usa Reel de forma lícita y razonable. No hagas un mal uso ni interrumpas el servicio, no intentes romper su seguridad, no accedas a datos de otras personas sin permiso, no lo rastrees a gran escala, ni lo uses para almacenar o compartir contenido ilícito. Podemos suspender las cuentas que incumplan estas normas.</> },
    { heading: "Tu contenido", body: <>Tu biblioteca, valoraciones, notas y datos importados siguen siendo tuyos. Nos concedes el permiso limitado necesario para almacenar y mostrar ese contenido de modo que el servicio funcione para ti y para los amigos con quienes lo compartes. Eres responsable del contenido que añades y de tener derecho a subir todo lo que importes.</> },
    { heading: "Contenido de terceros", body: <>Los títulos de las series, las imágenes y los metadatos relacionados provienen de fuentes de terceros y pertenecen a sus respectivos propietarios. Se ofrecen para uso personal e informativo dentro de Reel.</> },
    { heading: "Disponibilidad y cambios", body: <>Podemos añadir, cambiar, suspender o retirar cualquier parte de Reel en cualquier momento, incluso durante esta beta. También podemos actualizar estos términos; si hacemos cambios importantes actualizaremos esta página y la fecha de &ldquo;última actualización&rdquo;. Seguir usando Reel tras un cambio significa que aceptas los nuevos términos.</> },
    { heading: "Fin de tu uso", body: <>Puedes dejar de usar Reel y pedirnos que eliminemos tu cuenta en cualquier momento escribiendo a {mail}. Podemos suspender o retirar el acceso si incumples estos términos o para proteger el servicio.</> },
    { heading: "Responsabilidad", body: <>En la medida en que lo permita la ley, Reel se ofrece sin garantías, y no somos responsables de daños indirectos o consecuentes, ni de la pérdida de datos, derivados de tu uso de un servicio en beta. Nada en estos términos limita la responsabilidad que no pueda limitarse por ley.</> },
    { heading: "Ley aplicable", body: <>Estos términos se rigen por las leyes de España, y cualquier disputa se someterá a los tribunales competentes allí, salvo que la normativa local de consumo obligatoria disponga otra cosa.</> },
    { heading: "Contacto", body: <>¿Dudas sobre estos términos? Escríbenos a {mail}.</> },
  ],
};

export default function TermsPage() {
  const { language } = useSettings();
  const c = language === "es" ? ES : EN;
  return (
    <LegalLayout title={c.title} updated={c.updated}>
      <p className="dim" style={{ fontSize: 14.5, lineHeight: 1.65, margin: 0 }}>{c.intro}</p>
      {c.sections.map((s) => (
        <LegalSection key={s.heading} heading={s.heading}>{s.body}</LegalSection>
      ))}
    </LegalLayout>
  );
}
