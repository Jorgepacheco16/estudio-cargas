/**
 * Logotipo de BalanceAPP: una «B» hecha de dos cuencos iguales (los platos de una balanza) con un punto de equilibrio, dentro de una insignia redondeada, más
 * el nombre «Balance» + «APP». Está dibujado con las variables --brand-primary (punto y «APP») y --brand-secondary (insignia y «Balance»), así que toma
 * los colores del cliente sin tocar el dibujo. `icon` muestra solo la insignia.
 */
export function BalanceMark({ size = 44 }: { size?: number }) {
  return (
    <svg className="balance-mark" viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="BalanceAPP" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="60" height="60" rx="18" className="bm-badge" />
      {/* «B» de dos cuencos iguales (los platos de una balanza) y el punto de equilibrio */}
      <path d="M22 15 V49 M22 15 H33.5 A8.2 8.2 0 0 1 33.5 31.4 H22 M22 31.4 H35.5 A8.8 8.8 0 0 1 35.5 49 H22" className="bm-b" />
      <circle cx="45" cy="31.4" r="4.6" className="bm-dot" />
    </svg>
  );
}

export function BalanceLogo({ variant = "full", size = 44 }: { variant?: "full" | "icon"; size?: number }) {
  if (variant === "icon") return <BalanceMark size={size} />;
  return (
    <span className="balance-logo" style={{ fontSize: size * 0.52 }}>
      <BalanceMark size={size} />
      <span className="balance-word" aria-hidden="true">Balance<b>APP</b></span>
    </span>
  );
}
