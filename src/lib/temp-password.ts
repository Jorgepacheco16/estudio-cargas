import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

/** Clave temporal (D-94): 14 caracteres al azar sin letras ni cifras que se confunden (0/O, 1/l/I) para dictarla sin errores. ~80 bits de entropía. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const TEMP_PASSWORD_LENGTH = 14;

export function generateTempPassword(): string {
  let out = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Cifrado bcrypt (el mismo formato que usa Supabase Auth): a la base de datos solo llega esto, nunca la clave en texto. */
export const hashPassword = (password: string) => bcrypt.hash(password, 10);
