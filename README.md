# Turnos Operaciones

Calendario de turnos del grupo de operaciones. Ya no depende de ningún CSV:
los turnos se generan a partir de `js/plan.js`.

## Qué editar
Todo se cambia en **`js/plan.js`** (no hace falta tocar `app.js`):
- `equipos`: cada equipo, su desfase (0, 7, 14, 21, 28) y sus miembros (nombre y centro A/L).
- `excepciones`: permutas, vacaciones, bajas o cambios de centro puntuales.
- `aniosAtras` / `aniosAdelante`: cuántos años se muestran alrededor del actual.

Ejemplos de excepciones:
    { operador: "Rafa", desde: "2027-08-02", hasta: "2027-08-15", turno: "" },     // libre
    { operador: "Steven Gonzalez", desde: "2027-08-02", hasta: "2027-08-02", turno: "TL" },
    { operador: "Waldy Mercado", desde: "2027-03-01", hasta: "2027-03-05", centro: "L" },

Sustituir a una persona: ponle `hasta: "2027-03-31"` y añade otro miembro al mismo equipo con `desde: "2027-04-01"`.

## Funciones
- Filtros por año y por mes, cuadrante conjunto y calendario individual, "Ahora en turno", resumen por periodo
- Informe Excel, impresión, modo oscuro, exportar turnos a `.ics`

Para estudiar el código: ver `GUIA_DEL_CODIGO.md`. `horarios2026.csv` queda solo como referencia (ya no se usa).
