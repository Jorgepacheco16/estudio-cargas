import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad (Fase 6). La política de contenido (CSP) se genera por petición en src/proxy.ts, con un código aleatorio (nonce),
 * para no necesitar 'unsafe-inline'. Aquí van las demás cabeceras, iguales para toda respuesta.
 */
const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      ],
    }];
  },
};
export default config;
