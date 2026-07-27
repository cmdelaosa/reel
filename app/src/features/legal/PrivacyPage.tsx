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
  title: "Privacy Policy",
  updated: "27 July 2026",
  intro: (
    <>
      Reel (&ldquo;Reel&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is an invite-only beta app that helps you
      track the TV shows you watch and see what your friends thought of them. This policy explains what we
      collect, why, and the choices you have. We keep it deliberately short and plain.
    </>
  ),
  sections: [
    {
      heading: "Who we are",
      body: <>Reel is a small, independently run service available at {site}. For any privacy question, contact us at {mail}.</>,
    },
    {
      heading: "What we collect",
      body: (
        <>
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li style={{ marginBottom: 6 }}><strong>Account details.</strong> Your email address, used to sign you in with a magic link. If you sign in with Google, we receive your email and basic profile (name and profile picture) from Google — nothing else, and we never receive your Google password.</li>
            <li style={{ marginBottom: 6 }}><strong>Your activity in Reel.</strong> The shows you follow, episodes you mark as watched, your ratings and notes, and connections with friends you choose to add.</li>
            <li style={{ marginBottom: 6 }}><strong>Data you import.</strong> If you upload a watch-history export (for example from TV Time), we store it to rebuild your library.</li>
            <li style={{ marginBottom: 6 }}><strong>Basic technical data.</strong> Standard server logs (such as IP address and browser type) needed to run and secure the service.</li>
          </ul>
          We do <strong>not</strong> collect payment details, and we do not sell your data to anyone.
        </>
      ),
    },
    {
      heading: "How we use it",
      body: <>Only to run Reel: to sign you in, keep your library and ratings in sync, show you and your friends what you&rsquo;ve watched, send you the sign-in and product emails you expect, and keep the service secure. We do not use your data for advertising.</>,
    },
    {
      heading: "Who we share it with",
      body: (
        <>
          We don&rsquo;t sell or rent your personal data. We rely on a few trusted service providers who process data only on our behalf:
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li style={{ marginBottom: 4 }}><strong>Supabase</strong> — database, authentication and storage.</li>
            <li style={{ marginBottom: 4 }}><strong>Cloudflare</strong> — hosting, content delivery and security.</li>
            <li style={{ marginBottom: 4 }}><strong>Resend</strong> — delivery of transactional email (sign-in links).</li>
            <li style={{ marginBottom: 4 }}><strong>Google</strong> — only if you choose &ldquo;Continue with Google&rdquo; to sign in.</li>
          </ul>
          We may also disclose data if required by law.
        </>
      ),
    },
    {
      heading: "Friends and visibility",
      body: <>Reel is social by design: activity such as the shows you watch and your ratings can be visible to friends you connect with inside the app. Only add people you&rsquo;re comfortable sharing that with.</>,
    },
    {
      heading: "Cookies and local storage",
      body: <>We use only the storage strictly necessary to keep you signed in and to remember your preferences (such as theme and language). We don&rsquo;t use third-party advertising or tracking cookies.</>,
    },
    {
      heading: "Keeping and deleting your data",
      body: <>We keep your data for as long as your account is active. You can ask us to delete your account and associated data at any time by emailing {mail}, and we&rsquo;ll remove it (except anything we&rsquo;re legally required to retain).</>,
    },
    {
      heading: "Children",
      body: <>Reel isn&rsquo;t directed at children under 13, and we don&rsquo;t knowingly collect their data.</>,
    },
    {
      heading: "Changes to this policy",
      body: <>If we make material changes, we&rsquo;ll update this page and the &ldquo;last updated&rdquo; date above.</>,
    },
    {
      heading: "Contact",
      body: <>Questions about your privacy? Email {mail}.</>,
    },
  ],
};

const ES: Content = {
  title: "Política de Privacidad",
  updated: "27 de julio de 2026",
  intro: (
    <>
      Reel (&ldquo;Reel&rdquo;, &ldquo;nosotros&rdquo;) es una app en beta por invitación que te ayuda a llevar
      la cuenta de las series que ves y a descubrir qué opinan tus amigos de ellas. Esta política explica qué
      datos recogemos, para qué, y qué opciones tienes. La mantenemos corta y clara a propósito.
    </>
  ),
  sections: [
    {
      heading: "Quiénes somos",
      body: <>Reel es un servicio pequeño e independiente disponible en {site}. Para cualquier duda sobre privacidad, escríbenos a {mail}.</>,
    },
    {
      heading: "Qué recogemos",
      body: (
        <>
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li style={{ marginBottom: 6 }}><strong>Datos de tu cuenta.</strong> Tu dirección de correo, que usamos para iniciar sesión con un enlace mágico. Si entras con Google, recibimos de Google tu correo y tu perfil básico (nombre y foto) — nada más, y nunca recibimos tu contraseña de Google.</li>
            <li style={{ marginBottom: 6 }}><strong>Tu actividad en Reel.</strong> Las series que sigues, los episodios que marcas como vistos, tus valoraciones y notas, y las conexiones con los amigos que decides añadir.</li>
            <li style={{ marginBottom: 6 }}><strong>Datos que importas.</strong> Si subes un histórico de lo que has visto (por ejemplo, un export de TV Time), lo guardamos para reconstruir tu biblioteca.</li>
            <li style={{ marginBottom: 6 }}><strong>Datos técnicos básicos.</strong> Registros de servidor estándar (como la IP y el tipo de navegador) necesarios para operar y proteger el servicio.</li>
          </ul>
          <strong>No</strong> recogemos datos de pago, y no vendemos tus datos a nadie.
        </>
      ),
    },
    {
      heading: "Para qué lo usamos",
      body: <>Solo para que Reel funcione: iniciar tu sesión, mantener sincronizadas tu biblioteca y tus valoraciones, mostraros a ti y a tus amigos lo que habéis visto, enviarte los correos de acceso y de producto que esperas, y mantener el servicio seguro. No usamos tus datos para publicidad.</>,
    },
    {
      heading: "Con quién los compartimos",
      body: (
        <>
          No vendemos ni alquilamos tus datos personales. Nos apoyamos en unos pocos proveedores de confianza que solo tratan datos en nuestro nombre:
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li style={{ marginBottom: 4 }}><strong>Supabase</strong> — base de datos, autenticación y almacenamiento.</li>
            <li style={{ marginBottom: 4 }}><strong>Cloudflare</strong> — alojamiento, distribución de contenido y seguridad.</li>
            <li style={{ marginBottom: 4 }}><strong>Resend</strong> — envío del correo transaccional (enlaces de acceso).</li>
            <li style={{ marginBottom: 4 }}><strong>Google</strong> — solo si eliges &ldquo;Continuar con Google&rdquo; para entrar.</li>
          </ul>
          También podemos revelar datos si la ley lo exige.
        </>
      ),
    },
    {
      heading: "Amigos y visibilidad",
      body: <>Reel es social por diseño: cierta actividad, como las series que ves y tus valoraciones, puede ser visible para los amigos con los que conectas dentro de la app. Añade solo a personas con las que te sientas cómodo compartiéndolo.</>,
    },
    {
      heading: "Cookies y almacenamiento local",
      body: <>Usamos solo el almacenamiento estrictamente necesario para mantener tu sesión y recordar tus preferencias (como el tema y el idioma). No usamos cookies de publicidad ni de seguimiento de terceros.</>,
    },
    {
      heading: "Conservación y borrado de tus datos",
      body: <>Conservamos tus datos mientras tu cuenta esté activa. Puedes pedirnos que eliminemos tu cuenta y los datos asociados en cualquier momento escribiendo a {mail}, y los borraremos (salvo lo que estemos legalmente obligados a conservar).</>,
    },
    {
      heading: "Menores",
      body: <>Reel no está dirigido a menores de 13 años, y no recogemos sus datos conscientemente.</>,
    },
    {
      heading: "Cambios en esta política",
      body: <>Si hacemos cambios importantes, actualizaremos esta página y la fecha de &ldquo;última actualización&rdquo; de arriba.</>,
    },
    {
      heading: "Contacto",
      body: <>¿Dudas sobre tu privacidad? Escríbenos a {mail}.</>,
    },
  ],
};

export default function PrivacyPage() {
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
