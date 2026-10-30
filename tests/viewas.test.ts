import { randomUUID } from "node:crypto";
import { VIEWAS_TTL_SECONDS, signViewAs, verifyViewAs, viewAsConfigured } from "../src/lib/viewas";
import { allowedHrefs, canEdit, canRead } from "../src/lib/access";
import { menuHrefs } from "../src/lib/nav";
import { allPermissions, emptyPermissions } from "../src/domain/access";
import { NEXT_PATTERN } from "../src/lib/invitation";
import { check, summary } from "./helpers";

process.env.GUEST_SESSION_SECRET ??= "x".repeat(40);
const access = (perms = emptyPermissions(), isAdmin = false) => ({ access: { displayName: null, roleId: "r", roleName: "Rol", perms, allAreas: true, areaIds: [], isAdmin } });

/** D-91 — «ver como» (cookie firmada), menú por permisos y regreso seguro desde Google. Funciones puras. */
async function main() {
  const admin = randomUUID(), target = randomUUID();

  await check("La cookie de «ver como» solo sirve con la sesión de quien la creó, antes de vencer y sin alterar", () => {
    if (!viewAsConfigured()) throw new Error("debía estar configurado");
    const c = signViewAs(admin, target, 1_000_000_000_000);
    const now = 1_000_000_000_000 + 1000;
    const ok = verifyViewAs(c.value, admin, now);
    if (!ok || ok.adminId !== admin || ok.targetId !== target) throw new Error("debía validar");
    if (verifyViewAs(c.value, randomUUID(), now)) throw new Error("otra sesión no debía poder usarla");
    if (verifyViewAs(c.value, admin, 1_000_000_000_000 + (VIEWAS_TTL_SECONDS + 5) * 1000)) throw new Error("vencida no debía servir");
    const [a, t, e, s] = c.value.split(".");
    if (verifyViewAs(`${a}.${randomUUID()}.${e}.${s}`, admin, now)) throw new Error("cambiar a la persona no debía servir");
    if (verifyViewAs(`${a}.${t}.${Number(e) + 99999}.${s}`, admin, now)) throw new Error("alargar el plazo no debía servir");
    if (verifyViewAs(undefined, admin, now) || verifyViewAs("basura", admin, now) || verifyViewAs("", admin, now)) throw new Error("valores vacíos o inválidos");
  });

  await check("El menú muestra solo lo que el rol permite; «Usuarios y roles» solo al Super usuario; sin sesión (demostración) no hay restricción", () => {
    const hrefs = menuHrefs();
    if (allowedHrefs(hrefs, null) !== null || allowedHrefs(hrefs, { access: null }) !== null) throw new Error("sin sesión debía ser sin restricción");
    const none = allowedHrefs(hrefs, access())!;
    if (none.join() !== ["/", "/estudio"].join() && !none.includes("/") ) throw new Error("un rol sin permisos solo ve el inicio y el estudio: " + none.join());
    if (none.includes("/cargos") || none.includes("/calculo") || none.includes("/usuarios")) throw new Error("no debía ver cargos, cálculo ni usuarios");
    const p = { ...emptyPermissions(), cargos: "read" as const, actividades: "edit" as const, parametros: "read" as const };
    const some = allowedHrefs(hrefs, access(p))!;
    if (!some.includes("/cargos") || !some.includes("/actividades") || !some.includes("/calculo") || !some.includes("/drill") || some.includes("/diagnostico/riesgos") || some.includes("/usuarios")) throw new Error(some.join());
    const sup = allowedHrefs(hrefs, access(allPermissions("edit"), true))!;
    if (!sup.includes("/usuarios") || sup.length !== hrefs.length) throw new Error("el Super usuario debía ver todo");
    if (canEdit(access(p), "cargos") || !canEdit(access(p), "actividades") || !canRead(access(p), "cargos") || canRead(access(p), "riesgos")) throw new Error("niveles");
  });

  await check("Después de entrar con Google solo se vuelve a la página de una invitación, nunca a una dirección arbitraria", () => {
    const t = "A".repeat(43);
    if (!NEXT_PATTERN.test(`/invitacion/${t}`)) throw new Error("la forma válida debía aceptarse");
    for (const bad of ["https://malo.com/invitacion/" + t, "//malo.com", "/estudio", "/invitacion/", "/invitacion/corto", `/invitacion/${t}/../x`, `/invitacion/${t}?x=1`, "javascript:alert(1)"]) if (NEXT_PATTERN.test(bad)) throw new Error(`aceptó ${bad}`);
  });
}
main().then(summary);
