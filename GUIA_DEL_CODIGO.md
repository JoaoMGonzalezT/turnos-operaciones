# Guía para estudiar el código

## 1. Archivos
| Archivo | Para qué sirve |
|---|---|
| `js/plan.js` | **Datos**: ciclo, equipos, miembros y excepciones. Es lo único que se edita a diario. |
| `js/app.js` | **Lógica**: genera los turnos, calcula, dibuja y gestiona los eventos. |
| `index.html` | Estructura de la página (barra de filtros, paneles, leyenda). |
| `css/styles.css` | Estilos. Lleva un índice numerado de secciones. |
| `horarios2026.csv` | Ya no se usa; queda como referencia. |

## 2. Flujo de datos (de principio a fin)
1. `plan.js` declara `PLAN`.
2. `init()` llama a `buildRowsFromPlan()`, que produce `rows`: una **matriz con forma de CSV**.
3. `detectMonths()` lee la fila 0 y rellena `months`. `fillOperators()` rellena `operators`.
4. `render()` dibuja usando `months`, `operators`, `currentOperator` y los filtros.

Forma de `rows`:
```
fila 0:  ["2026", "MARZO", "", "", ... "ABRIL", ...]   meses (el nombre va en la primera columna del mes)
fila 1:  ["", "D", "L", "M", ...]                        día de la semana
fila 2:  ["", "1", "2", "3", ...]                        día del mes
fila 3+: ["Elizabet Ortiz", "", "MA", "MA", ...]         una fila por persona ("" = libre)
```
Se mantiene este formato para que vistas, estadísticas e informes no cambien.

## 3. La matemática del ciclo (`shiftFor`)
- Ciclo de 35 días: `M_______MMMM_NNN__TTTT_NNNN__TTT_MM` (M mañana, T tarde, N noche, `_` libre).
- `n` = días desde `PLAN.inicio` (se calcula en UTC para que el cambio de hora no desajuste nada).
- Posición en el ciclo: `(n + desfase) mod 35`. El `mod` está escrito para funcionar también con negativos.
- Los 5 equipos tienen desfase 0, 7, 14, 21 y 28 (35 ÷ 5 = 7 días entre equipos).
- Código final = letra + centro (`A`/`L`). Si `alternaCentro`, el centro se invierte en cada ciclo, justo tras el descanso largo.
- Las `excepciones` se aplican al final y mandan sobre el ciclo.

## 4. Estado global (`app.js`, arriba)
`rows`, `months`, `operators`, `currentOperator` (null = vista conjunta), `selectedYearFilter`, `selectedMonthFilter` (índice 0-11 como texto), `statsStartDate/EndDate`.

## 5. Filtros de año y mes
`getVisibleMonths()` filtra `months` por los dos selectores. `updateFilterOptions()` reconstruye ambos desplegables
cada vez que se dibuja (los meses ofrecidos dependen del año elegido). Calendarios e informe Excel usan `getVisibleMonths()`.

## 6. Mapa de funciones (en el orden del archivo)
- **Utilidades**: `normalize`, `escapeHTML`, `getYear`, `getToday`, `formatDate`, `shiftClass`, `capitalize`, `decodeCSV`.
- **Generador**: `buildRowsFromPlan` (+ `shiftFor` interna).
- **Modelo**: `detectMonths`, `fillOperators`, `getMonthData`, `getShiftForDate`, `calculateStats`, `getVisibleMonths`.
- **Vista**: `renderToday`, `renderNextTurns`, `renderStats`, `renderCalendar`, `renderOnDutyNow`, `renderTodayAll`,
  `renderNextAll`, `renderStatsAll`, `renderAllOperatorsCalendar`, `render` (el director).
- **Controlador**: `selectCurrentMonthByDefault`, `updateFilterOptions`, `goToday`, `applyTheme` y los `addEventListener`.
- **Informes**: `ReportModel` (datos), `ReportView` (descarga .xlsx), `ReportController` (orquesta). Aparte, `exportICS`.
- **Heredado del CSV** (sin uso): `saveCSV`, `restoreCSV`, `parseCSV` y el cargador manual de `#csvFile`. Se pueden borrar sin afectar al plan.

## 7. Recetas
- **Añadir una persona**: nuevo miembro dentro de su equipo en `plan.js`.
- **Vacaciones o permuta**: una línea en `excepciones` (`turno: ""` = libre).
- **Un turno nuevo (p. ej. refuerzo)**: añadirlo a `SHIFTS`, darle color `.xx` en el CSS y una entrada en la leyenda de `index.html`.
- **Cambiar el ciclo**: editar `PLAN.ciclo` (solo M, T, N, `_`). Cambia también los meses pasados.

## 8. Ejercicios para aprender
1. Cambia el desfase de un equipo y observa qué cuadrante cambia.
2. Añade una excepción de `centro` y localízala en el calendario individual.
3. Sigue con `console.log` el recorrido de `rows` hasta `getMonthData`.
