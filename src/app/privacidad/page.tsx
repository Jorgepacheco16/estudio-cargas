import Link from "next/link";
import { BalanceLogo } from "@/components/brand/BalanceLogo";

export const metadata = { title: "Política de privacidad" };

/**
 * Política de privacidad (pública). La pide Google para publicar el inicio de sesión y resume cómo se tratan los datos (Ley 1581 de 2012 y Decreto 1377 de 2013, Colombia).
 * Es un texto base: debe validarlo la persona responsable jurídica de la organización antes de usarse como política definitiva.
 */
export default function Privacidad() {
  return (
    <main className="legal">
      <article className="card legal-card">
        <div className="invite-brand"><BalanceLogo size={40} /></div>
        <h1>Política de privacidad</h1>
        <p className="muted">BalanceAPP · Estudio de actividades y cargas laborales · Actualizada el 30 de octubre de 2026</p>

        <h2>1. Qué es BalanceAPP y quién responde por los datos</h2>
        <p>BalanceAPP es una aplicación web para levantar y analizar las actividades de los cargos, su carga de trabajo y su capacidad. La organización que usa la aplicación para realizar su estudio es la <b>responsable del tratamiento</b> de los datos que registra en él; BalanceAPP los procesa por encargo de esa organización y solo para el estudio.</p>

        <h2>2. Qué datos tratamos</h2>
        <ul>
          <li><b>Datos de la cuenta:</b> el correo electrónico con el que la persona entra, su rol y las áreas que tiene asignadas. Si entra con Google, recibimos únicamente su correo y su nombre de perfil; no accedemos a su correo (Gmail), a sus archivos (Drive), a sus contactos ni a ningún otro servicio de su cuenta de Google.</li>
          <li><b>Datos del estudio:</b> cargos, cantidad de colaboradores por cargo, jornadas, actividades, frecuencias, tiempos, evaluaciones, oportunidades de mejora y plan de acción. Son datos de la operación, no de personas concretas. Los identificadores de colaborador son opcionales y se recomienda no usar nombres ni documentos de identidad.</li>
          <li><b>Registro de actividad:</b> quién cambió qué y cuándo (auditoría), y datos técnicos mínimos de seguridad.</li>
        </ul>

        <h2>3. Para qué los usamos</h2>
        <p>Para identificar quién entra a la aplicación y qué puede ver o editar, calcular la carga y la capacidad de los cargos, preparar los informes del estudio, mantener la seguridad y responder a solicitudes de las personas. No vendemos ni cedemos los datos, ni los usamos para publicidad.</p>

        <h2>4. Con quién se comparten (encargados)</h2>
        <ul>
          <li><b>Supabase:</b> base de datos y autenticación.</li>
          <li><b>Vercel:</b> alojamiento de la aplicación.</li>
          <li><b>Google:</b> inicio de sesión con Google y hojas de cálculo de Google, cuando la organización conecta una hoja para ver allí los datos del estudio.</li>
          <li><b>Anthropic:</b> solo si se activa el agente de inteligencia artificial: recibe resúmenes seudonimizados del estudio, sin nombres ni identificadores reales de personas, y solo para producir propuestas que una persona debe aprobar.</li>
        </ul>

        <h2>5. Uso de la información de las cuentas de Google</h2>
        <p>El uso que BalanceAPP hace de la información recibida de las API de Google se ajusta a la <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer">Política de datos de usuario de los servicios de API de Google</a>, incluidos los requisitos de uso limitado. Solo se usan el correo y el perfil básico para iniciar sesión y reconocer a la persona dentro de la aplicación.</p>

        <h2>6. Seguridad y conservación</h2>
        <p>Los datos viajan cifrados, el acceso se controla por rol y por módulo, y cada cambio queda registrado. Se conservan mientras dure el estudio y el tiempo que la organización defina; después pueden suprimirse a solicitud.</p>

        <h2>7. Derechos de las personas</h2>
        <p>Toda persona puede conocer, actualizar, rectificar y solicitar la supresión de sus datos, y revocar la autorización, conforme a la Ley 1581 de 2012. Para ejercer estos derechos, escriba a quien administra la aplicación en su organización (la persona que le dio acceso), que atenderá la solicitud. Si prefiere dejar de usar el inicio de sesión con Google, puede pedir una invitación con correo y clave.</p>

        <h2>8. Cambios a esta política</h2>
        <p>Si esta política cambia, se actualizará esta página con la nueva fecha.</p>

        <p><Link className="btn" href="/ingreso">← Volver al ingreso</Link></p>
      </article>
    </main>
  );
}
