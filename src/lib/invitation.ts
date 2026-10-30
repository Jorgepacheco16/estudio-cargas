/** Constantes compartidas del ingreso por invitación (D-91). */
/** Cookie breve que recuerda a dónde volver después de entrar con Google desde un enlace de invitación. */
export const NEXT_COOKIE = "ba_next";
/** Solo se vuelve a la página de una invitación (nunca a una dirección arbitraria). */
export const NEXT_PATTERN = /^\/invitacion\/[A-Za-z0-9_-]{20,100}$/;
