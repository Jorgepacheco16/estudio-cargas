/**
 * «Estructura de la tienda»: formato de Excel con las columnas que pidió la gerencia (D-113). Aquí solo se define QUÉ columnas lleva;
 * el archivo se arma en server/structure-file.ts. El formato sale VACÍO: lo diligencia la persona del estudio. No se agrega ninguna columna que la gerencia no haya pedido.
 */
export type StructureControl = "text" | "yesno" | "fixvar" | "sale";
export interface StructureColumn { header: string; control: StructureControl; hint: string; width: number }

export const SHEET_STRUCTURE = "Estructura";
export const SHEET_EMPLOYEES = "Empleados";
export const YES_NO = ["Sí", "No"] as const;
export const FIXED_VARIABLE = ["Fijo", "Variable"] as const;
export const SALE_KIND = ["Venta en caliente", "Preparación para la venta"] as const;

/** Hoja 1: una fila por cargo en cada puesto físico o área, con las clasificaciones que pidió la gerencia (en el orden en que las pidió). */
export const STRUCTURE_COLUMNS: StructureColumn[] = [
  { header: "Puesto físico", control: "text", width: 26, hint: "Espacio físico donde opera el cargo, con el nombre del área a la que está adscrito. Si la puerta se repite, una letra (p. ej. «Puerta recibo F»; «Puerta clientes A» y «Puerta clientes B»)." },
  { header: "Área", control: "text", width: 26, hint: "Área a la que pertenece el cargo (carnes, fruver, SAC, surtidores, bodega, cajeras, supervisoras…)." },
  { header: "Cargo", control: "text", width: 34, hint: "Nombre del cargo." },
  { header: "TT (total tiempo)", control: "yesno", width: 16, hint: "Sí: el espacio, área o actividad requiere al menos una persona desde la apertura hasta el cierre." },
  { header: "Firma de medición", control: "text", width: 20, hint: "Firma con la que se mide el cargo a partir de la venta (SAM), para quienes están en un espacio, área o actividad TT." },
  { header: "Venta en caliente o preparación para la venta", control: "sale", width: 26, hint: "Elija una opción. Venta en caliente: el cargo es netamente para la venta. Preparación para la venta: el cargo prepara la venta y tiene horarios distintos a los TT o a los del momento de la venta." },
  { header: "¿Es administrativo?", control: "yesno", width: 18, hint: "Sí o No. Administrativo: funciones automatizables que se pueden manejar desde lo central o con tecnología." },
  { header: "Cargo fijo o variable", control: "fixvar", width: 18, hint: "Fijo: al abrir la tienda tiene que haber al menos una persona según el puesto, o varias si es un área (carnes, fruver, SAC). Se excluye de los cálculos por productividad. Variable: el resto." },
  { header: "% de ocupación", control: "text", width: 16, hint: "100 % si el cargo está ocupado todo el tiempo; si no, el porcentaje de ocupación." },
  { header: "Capacidad de mover (kilos y/o unidades)", control: "text", width: 26, hint: "Cuántos kilos y/o unidades puede mover el cargo (la cifra la entrega el estudio)." },
  { header: "Pilar", control: "text", width: 18, hint: "Pilar al que pertenece el cargo, el responsable de la actividad (p. ej. recibo pertenece a logística)." },
];

/** Hoja 2: el listado de empleados de la tienda con su cargo. */
export const EMPLOYEE_COLUMNS: StructureColumn[] = [
  { header: "Nombre del empleado", control: "text", width: 40, hint: "Nombre completo del empleado de la tienda." },
  { header: "Cargo", control: "text", width: 34, hint: "Cargo del empleado, tal como aparece en la hoja «Estructura»." },
];

/** Filas preparadas (con listas desplegables) en cada hoja. */
export const STRUCTURE_ROWS = 400;
export const EMPLOYEE_ROWS = 400;
