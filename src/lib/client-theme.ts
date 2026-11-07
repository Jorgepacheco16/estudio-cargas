/**
 * Cliente al que se presta la aplicación (marca BalanceAPP). El logotipo de BalanceAPP y la ilustración de ingreso toman los colores del cliente
 * mediante las variables CSS --brand-primary y --brand-secondary (ver globals.css). Para un cliente nuevo basta con cambiar estos datos y sus colores.
 */
export const CLIENT = {
  name: "Megatiendas",
  logo: "/logo-megatiendas.png",
  logoWidth: 170,
  logoHeight: 62,
  /** Archivo del logo dentro de public/, para los documentos descargables (PDF, Word, PowerPoint: D-107) y sus colores (los mismos --red y --blue de globals.css). */
  logoFile: "logo-megatiendas.png",
  colors: { primary: "ED001B", secondary: "00529B", ink: "16203A" },
} as const;

export const APP = { name: "BalanceAPP", tagline: "Estudio de actividades y cargas laborales" } as const;
