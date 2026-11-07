/** Lo que comparten los tres formatos descargables del informe (D-107): el logo del CLIENTE leído del disco y los colores del cliente. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CLIENT } from "@/lib/client-theme";

export interface Logo { bytes: Buffer; width: number; height: number }

/** Lee el logo del cliente (un PNG de public/) y su tamaño real, para dibujarlo sin deformarlo. */
export async function loadClientLogo(): Promise<Logo> {
  const bytes = await readFile(path.join(process.cwd(), "public", CLIENT.logoFile));
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error(`El logo del cliente (${CLIENT.logoFile}) no es un PNG válido.`);
  return { bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export const COLOR = CLIENT.colors;
/** Alto que ocupa un logo de ancho `w` conservando su proporción. */
export const logoHeight = (logo: Logo, w: number) => (w * logo.height) / logo.width;
