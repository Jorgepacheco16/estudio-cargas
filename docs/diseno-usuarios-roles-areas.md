# Diseño: usuarios, roles y áreas

Pedido del titular (D-91). Este documento fija el diseño; la Etapa 1 ya está construida (ver D-91 en `decisiones-pendientes.md`) y la Etapa 2 (áreas) está pendiente. Todo lo que dice «la base de datos lo hace cumplir» se prueba con pruebas de seguridad contra PostgreSQL real.

## 1. Vocabulario

- **Nivel de acceso** (por módulo): **Sin acceso · Lectura · Edición** (Edición incluye Lectura).
- **Rol**: un nombre con un nivel por módulo. Se crea una vez y se asigna a varias personas. Un rol por usuario.
- **Super usuario**: rol del sistema (no se puede editar ni borrar). Edición en todos los módulos, todas las áreas y administra roles y usuarios. Lo tiene el titular; se puede asignar a otras personas.
- **Áreas del usuario**: «todas» o una lista. Limitan los registros que la persona ve y edita en todos los módulos.

## 2. Módulos y tablas

| Módulo (pantalla) | Tablas | Depende de (se exige al guardar el rol) |
|---|---|---|
| Parámetros | study_parameters, areas | — |
| Cargos y dotación | positions, staffing_entries, position_shifts, sites | Parámetros (Lectura) |
| Actividades | activities, activity_shifts | Cargos y dotación (Lectura) |
| Medibilidad | measurability_assessments | Actividades (Lectura) |
| Pertinencia | suitability_assessments | Actividades (Lectura) |
| Riesgos | risk_assessments | Actividades (Lectura) |
| Oportunidades | improvement_opportunities | Actividades (Lectura) |
| Rediseño | redesign_proposals | Cargos y dotación (Lectura) |
| Plan de acción | action_items | Oportunidades (Lectura) |
| Historia y mediciones | study_snapshots, measurements, deviations | Actividades (Lectura) |
| Integraciones con Google | sheet_connections, sync_events, validation_issues | — |
| Agente de IA | agent_runs, agent_proposals | Actividades (Lectura) |
| Usuarios y roles | roles, role_permissions, memberships, invitations | solo Super usuario |

- Las **dependencias** evitan roles incoherentes (por ejemplo, ver Medibilidad sin poder leer la actividad que evalúa). Al guardar un rol, si falta una dependencia, la pantalla la sube a Lectura y lo avisa.
- Inicio, Cálculo de tiempos, Drill-down, Sedes y las exportaciones se calculan con Cargos y Actividades: requieren Lectura en ambos. Muestran solo cifras de las áreas del usuario, con el aviso «Solo sus áreas».

## 3. Modelo de datos (migración 0010)

- `roles` (id, study_id, nombre, es_sistema) y `role_permissions` (role_id, módulo, nivel).
- `memberships` suma `role_id`, `all_areas` y `member_areas` (study_id, user_id, area_id). El enum `app_role` se conserva (el dueño sigue siendo `owner`, que administra el estudio).
- `invitations` (study_id, correo, role_id, all_areas, áreas, hash del enlace, vence, usada, creada por). El enlace se guarda solo como hash.
- Registros sin área propia (parámetros, centros de operaciones): los ve cualquier miembro con acceso al módulo. La lista de áreas se filtra a las áreas del usuario.

## 4. Seguridad en la base de datos (RLS)

- Funciones `private.module_level(estudio, módulo)` y `private.area_allowed(estudio, area_id)` (SECURITY DEFINER, search_path vacío, como las actuales).
- Cada política pasa de `can_read/can_write(study)` a `module_level >= Lectura/Edición` **y** `area_allowed` en tablas con área (cargos por `area_id`; dotación, turnos y actividades por su cargo; evaluaciones por su actividad; oportunidades, rediseño y plan por su `area_id`, ya obligatorio por D-90).
- Restricciones: `NOT NULL` en `area_id` de oportunidades y plan; no se puede quitar el último Super usuario; un rol en uso no se borra; el rol de sistema no se edita.
- Un usuario sin permiso no puede leer ni escribir aunque llame a las rutas directamente.

## 5. Ingreso de personas

1. El Super usuario crea la invitación: correo, rol, áreas. La app genera un **enlace de un solo uso** (caduca en 7 días) que él envía por el medio que prefiera.
2. La persona abre el enlace, ve el correo invitado y elige su clave (o «Continuar con Google» con ese mismo correo).
3. Al entrar, una función de la base (`private.redeem_invitation`, SECURITY DEFINER) comprueba que el correo de la sesión es el de la invitación y que el enlace no venció ni se usó, y crea la membresía. **No se usa la llave de servicio de Supabase en ninguna ruta de usuario.**
4. Solo pueden registrarse correos invitados: un disparador sobre `auth.users` rechaza los demás (clave o Google).

Requisitos fuera del código (los configura el titular en Supabase): **Confirm email desactivado** (el enlace ya prueba que la persona recibió la invitación). Recuperar la clave por correo («Olvidé mi clave») necesita un proveedor de correo propio; hasta entonces, quien olvide su clave puede entrar con Google o pedir una invitación nueva con otro correo. El proyecto de Google Cloud no debe estar en modo «Pruebas».

## 6. Pantallas (solo Super usuario)

- **Roles**: lista, crear, editar (matriz módulo × nivel con las dependencias), borrar si no está en uso.
- **Usuarios**: lista con rol y áreas, invitar, cambiar rol o áreas, quitar acceso (inmediato; lo que editó se conserva).
- **Cuadro de permisos**: personas × módulos con el nivel efectivo y sus áreas.
- **Ver como este usuario**: vista de solo lectura con los menús, datos y botones que tendría esa persona; las acciones de guardar están bloqueadas.
- Auditoría: invitaciones, cambios de rol y de áreas, ingresos.

## 7. Entrega por etapas

- **Etapa 1**: migración 0010 (roles, invitaciones, funciones, rol Super usuario asignado al titular, políticas por módulo), pantallas de roles y usuarios, invitación y clave propia, cuadro de permisos, «Ver como».
- **Etapa 2**: restricción por áreas (políticas `area_allowed`, `NOT NULL`, filtros en cálculos, totales y exportaciones, aviso «Solo sus áreas»).
- Nadie con áreas limitadas se invita hasta cerrar la etapa 2. Cada etapa pasa por rama, CI y revisión del titular antes de producción.

## 8. Pruebas

Matriz de políticas por rol, nivel, módulo y área contra PostgreSQL real; invitación (vencida, usada, correo distinto, correo no invitado); último Super usuario; rol en uso; dependencias; «Ver como» no escribe; y los flujos de pantalla con Playwright.
