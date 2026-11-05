/**
 * Logotipo de BalanceAPP (D-97): un indicador de carga, un dial abierto de tres tramos (carga baja, equilibrio al centro y sobrecarga) con una aguja que apunta al
 * equilibrio, más el nombre «Balance» + «APP» en la letra Outfit. Está dibujado con las variables --brand-primary (aguja y «APP») y --brand-secondary (dial, eje y «Balance»),
 * así que toma los colores del cliente sin tocar el dibujo. `icon` muestra solo el símbolo. El mismo dibujo está en src/app/icon.svg y public/balanceapp-logo.svg con los
 * colores fijos (tests/brand.test.ts comprueba que sigan iguales).
 */
export function BalanceMark({ size = 44 }: { size?: number }) {
  return (
    <svg className="balance-mark" viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="BalanceAPP" xmlns="http://www.w3.org/2000/svg">
      {/* Dial de 240° en tres tramos con la misma separación; el del centro (equilibrio) va lleno y los de los lados, atenuados */}
      <path d="M12.95 48 A22 22 0 0 1 16 21.9" className="bm-arc soft" />
      <path d="M18.86 19.35 A22 22 0 0 1 45.14 19.35" className="bm-arc" />
      <path d="M48 21.9 A22 22 0 0 1 51.05 48" className="bm-arc soft" />
      {/* Aguja afilada que apunta al equilibrio, y el eje con su punto central */}
      <path d="M32 24 L35.3 37 H28.7 Z" className="bm-needle" />
      <circle cx="32" cy="37" r="8" className="bm-hub" />
      <circle cx="32" cy="37" r="3.1" className="bm-core" />
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
