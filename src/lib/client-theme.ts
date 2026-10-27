/**
 * Cliente al que se presta la aplicación (marca BalanceAPP). El logotipo de BalanceAPP y la ilustración de ingreso toman los colores del cliente
 * mediante las variables CSS --brand-primary y --brand-secondary (ver globals.css). Para un cliente nuevo basta con cambiar estos datos y sus colores.
 */
export const CLIENT = {
  name: "Megatiendas",
  logo: "/logo-megatiendas.png",
  logoWidth: 170,
  logoHeight: 62,
} as const;

export const APP = { name: "BalanceAPP", tagline: "Estudio de actividades y cargas laborales" } as const;
