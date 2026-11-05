/** Reglas del cambio de clave desde «Mi cuenta» (mismas que al aceptar una invitación: 10 a 72 caracteres). Devuelve el mensaje de error o null si todo está bien. */
export const PASSWORD_MIN = 10, PASSWORD_MAX = 72;

export function validatePasswordChange(current: string, next: string, again: string): string | null {
  if (!current) return "Escriba su clave actual.";
  if (next.length < PASSWORD_MIN) return `La clave nueva debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (next.length > PASSWORD_MAX) return `La clave nueva no puede pasar de ${PASSWORD_MAX} caracteres.`;
  if (next !== again) return "Las dos claves nuevas no coinciden.";
  if (next === current) return "La clave nueva debe ser distinta de la actual.";
  return null;
}
