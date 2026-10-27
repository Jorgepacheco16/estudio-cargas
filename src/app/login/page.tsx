import { redirect } from "next/navigation";

/** Ruta anterior de ingreso: ahora todo pasa por la página de inicio (D-76). */
export default function Login() {
  redirect("/ingreso?requiere=1");
}
