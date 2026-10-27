/**
 * Ilustración de la página de ingreso: un equipo revisa en un tablero cómo se reparte la carga de trabajo (barras, tendencia y reloj). Dibujo propio en
 * estilo plano; las prendas, el tablero y los acentos usan --brand-primary y --brand-secondary, así que cambia con los colores del cliente.
 */
export function LoginIllustration() {
  const P = "var(--brand-primary)", S = "var(--brand-secondary)";
  const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, white)`;
  return (
    <svg viewBox="0 0 720 560" role="img" aria-label="Un equipo analiza la distribución de la carga de trabajo en un tablero" xmlns="http://www.w3.org/2000/svg" className="login-illustration">
      {/* fondo y suelo */}
      <rect width="720" height="560" fill={tint(S, 9)} />
      <ellipse cx="360" cy="528" rx="330" ry="14" fill={tint(S, 14)} />
      {/* adornos */}
      <circle cx="46" cy="90" r="11" fill="none" stroke={tint(S, 35)} strokeWidth="2.5" />
      <circle cx="690" cy="215" r="10" fill="none" stroke={tint(S, 35)} strokeWidth="2.5" />
      <circle cx="272" cy="318" r="10" fill="none" stroke={tint(S, 35)} strokeWidth="2.5" />

      {/* tablero de análisis */}
      <rect x="190" y="48" width="262" height="196" rx="10" fill={tint(S, 16)} />
      <rect x="190" y="48" width="262" height="24" rx="10" fill={tint(S, 38)} />
      <rect x="190" y="62" width="262" height="10" fill={tint(S, 38)} />
      {[212, 224, 236].map((x) => <circle key={x} cx={x} cy={60} r="3.4" fill="#fff" />)}
      <line x1="226" y1="222" x2="430" y2="222" stroke={tint(S, 45)} strokeWidth="2.5" strokeLinecap="round" />
      {[[236, 52], [282, 76], [328, 104], [376, 142]].map(([x, h], i) => <rect key={x} x={x} y={220 - h} width="32" height={h} rx="5" fill={i === 3 ? P : tint(S, 42)} />)}
      <polyline points="232,158 276,126 318,138 372,92 414,76" fill="none" stroke={S} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      {[[232, 158], [276, 126], [318, 138], [372, 92]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="5.5" fill="#fff" stroke={S} strokeWidth="3.5" />)}
      <path d="M404 78 L418 74 L414 88" fill="none" stroke={S} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* corcho con notas y reloj */}
      <rect x="474" y="48" width="196" height="124" rx="8" fill={tint(S, 12)} />
      <line x1="539" y1="48" x2="539" y2="172" stroke="#fff" strokeWidth="3" /><line x1="604" y1="48" x2="604" y2="172" stroke="#fff" strokeWidth="3" />
      <rect x="560" y="70" width="26" height="24" fill="#ffe08a" transform="rotate(-6 573 82)" /><rect x="494" y="104" width="26" height="24" fill="#fff" transform="rotate(5 507 116)" /><rect x="622" y="92" width="26" height="24" fill="#fff" />
      <circle cx="506" cy="214" r="28" fill="#fff" stroke={tint(S, 55)} strokeWidth="5" />
      <path d="M506 214 V197 M506 214 L519 221" stroke={S} strokeWidth="4" strokeLinecap="round" fill="none" />

      {/* planta */}
      <path d="M186 470 H238 L230 520 H194 Z" fill={S} />
      <path d="M212 470 C190 440 190 420 206 396 C226 420 226 446 212 470Z" fill="#7da35a" />
      <path d="M214 470 C238 446 246 428 240 402 C218 422 210 448 214 470Z" fill="#5e8a45" />
      <path d="M210 470 C186 458 170 446 166 424 C190 430 208 446 210 470Z" fill="#92b56b" />

      {/* mujer de pie: presenta el tablero */}
      <path d="M76 214 L112 214 L104 492 L66 492 Z" fill="#252f4a" />
      <path d="M110 214 L150 214 L164 492 L124 492 Z" fill="#2d3856" />
      <ellipse cx="86" cy="497" rx="25" ry="10" fill={S} /><ellipse cx="146" cy="497" rx="25" ry="10" fill={S} />
      <path d="M74 138 Q112 124 150 138 L158 220 L68 220 Z" fill={S} />
      <path d="M100 134 L114 134 L112 220 L102 220 Z" fill="#fff" />
      <path d="M142 146 L176 178 L226 128" fill="none" stroke={S} strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="230" cy="124" r="10" fill="#f3c7a2" /><path d="M236 118 l12 -6" stroke="#f3c7a2" strokeWidth="6" strokeLinecap="round" />
      <path d="M82 150 L60 188 L82 218" fill="none" stroke={S} strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="82" cy="220" r="9" fill="#f3c7a2" />
      <rect x="104" y="124" width="14" height="16" rx="5" fill="#f3c7a2" />
      <circle cx="110" cy="102" r="25" fill="#f3c7a2" />
      <path d="M85 100 C84 72 106 66 126 76 C140 84 138 100 134 108 C126 92 108 90 96 96 Z" fill="#f2b233" />
      <circle cx="98" cy="68" r="13" fill="#f2b233" />
      <circle cx="102" cy="106" r="2.2" fill="#2b2230" /><circle cx="122" cy="106" r="2.2" fill="#2b2230" />
      <path d="M104 117 Q112 124 121 117" fill="none" stroke="#c0576b" strokeWidth="2.6" strokeLinecap="round" />

      {/* mujer sentada con portátil */}
      <path d="M352 392 Q400 350 470 380 Q500 430 470 468 Q410 492 360 462 Q336 430 352 392Z" fill={S} />
      <path d="M356 470 L336 524 M470 466 L488 524" stroke="#2a2a63" strokeWidth="6" strokeLinecap="round" />
      <path d="M404 366 L346 402 L352 474" fill="none" stroke="#232a40" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M426 372 L408 420 L420 482" fill="none" stroke="#2c3550" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="350" cy="486" rx="26" ry="10" fill={tint(P, 55)} /><ellipse cx="422" cy="494" rx="26" ry="10" fill={tint(P, 55)} />
      <path d="M388 286 Q422 276 458 288 L470 362 L396 368 Z" fill={P} />
      <path d="M396 300 L372 346 L352 350" fill="none" stroke={P} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M318 288 L368 284 L382 344 L324 350 Z" fill="#fff" stroke="#d9dee8" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="346" cy="318" r="4.5" fill="#262b3a" />
      <path d="M308 352 H388 L398 362 H298 Z" fill="#e6eaf2" stroke="#c9d0de" strokeWidth="2" />
      <circle cx="426" cy="262" r="23" fill="#c98b5d" />
      <path d="M402 258 C400 230 436 224 452 242 C458 252 452 262 448 266 C440 250 418 248 408 262 Z" fill="#1d1a2a" />
      <circle cx="452" cy="232" r="13" fill="#1d1a2a" />
      <circle cx="418" cy="268" r="2.1" fill="#2b2230" /><circle cx="436" cy="268" r="2.1" fill="#2b2230" />
      <path d="M418 279 Q427 286 436 279" fill="none" stroke="#a34a4a" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="404" cy="282" r="5" fill="none" stroke="#e3b341" strokeWidth="2.2" /><circle cx="446" cy="282" r="5" fill="none" stroke="#e3b341" strokeWidth="2.2" />

      {/* hombre sentado: levanta el dedo */}
      <path d="M560 400 Q600 360 676 392 Q700 440 676 476 Q624 498 572 470 Q548 440 560 400Z" fill="#24243b" />
      <path d="M580 476 L566 524 M676 472 L690 524" stroke="#1b1b2c" strokeWidth="6" strokeLinecap="round" />
      <path d="M598 372 L540 412 L548 486" fill="none" stroke={S} strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M624 376 L652 428 L644 490" fill="none" stroke="#2c4f86" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="546" cy="494" rx="26" ry="10" fill="#93a94a" /><ellipse cx="646" cy="498" rx="26" ry="10" fill="#93a94a" />
      <path d="M562 292 L634 286 L648 366 L568 372 Z" fill="#f2b233" />
      <path d="M578 306 q14 8 28 0 M596 330 q14 8 30 0" fill="none" stroke="#c9871a" strokeWidth="3" strokeLinecap="round" />
      <path d="M630 298 L660 256 L636 208" fill="none" stroke="#f2b233" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="634" cy="202" r="8.5" fill="#8a5535" /><path d="M632 196 l-2 -18" stroke="#8a5535" strokeWidth="6" strokeLinecap="round" />
      <path d="M568 304 L552 346 L520 352" fill="none" stroke="#f2b233" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M476 300 L542 296 L548 354 L486 358 Z" fill="#2a2d38" stroke="#171922" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="514" cy="326" r="4.5" fill="#d7dbe6" />
      <circle cx="600" cy="264" r="23" fill="#8a5535" />
      <path d="M577 258 C578 236 612 232 624 248 C626 256 624 262 622 264 C616 250 592 250 584 262 Z" fill="#17141f" />
      <path d="M580 270 C582 296 612 300 622 276 C616 286 590 288 580 270Z" fill="#17141f" />
      <circle cx="592" cy="268" r="6.5" fill="none" stroke="#17141f" strokeWidth="2.2" /><circle cx="610" cy="268" r="6.5" fill="none" stroke="#17141f" strokeWidth="2.2" /><path d="M598.500 268 H603.500" stroke="#17141f" strokeWidth="2.2" />
      <path d="M594 282 Q601 287 608 282" fill="none" stroke="#f6e8d8" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
