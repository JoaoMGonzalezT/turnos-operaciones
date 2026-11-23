/*
 * PLAN DE TURNOS — único archivo que hay que editar para cambiar personas o excepciones.
 * La lógica está en app.js y no hace falta tocarla.
 */
const PLAN = {
  // Ciclo de 35 días. M = mañana, T = tarde, N = noche, _ = libre.
  ciclo: "M_______MMMM_NNN__TTTT_NNNN__TTT_MM",

  // Día en el que el equipo con desfase 0 está en la posición 1 del ciclo.
  inicio: "2026-03-01",

  // Cuántos años se generan antes y después del año actual.
  aniosAtras: 2,
  aniosAdelante: 2,

  // desfase: días de adelanto respecto al Equipo 1 (0, 7, 14, 21, 28).
  // centro: "A" = Arteixo, "L" = Laracha.
  // alternaCentro: true -> cambia de centro en cada ciclo (tras el descanso).
  // desde / hasta (opcionales): fechas en las que la persona forma parte del equipo.
  equipos: [
    {
      nombre: "Equipo 1",
      desfase: 0,
      miembros: [
        { nombre: "Elizabet Ortiz", centro: "A" },
        { nombre: "David Vidal", centro: "L" },
      ],
    },
    {
      nombre: "Equipo 2",
      desfase: 7,
      miembros: [
        { nombre: "Luis Martinez", centro: "A", alternaCentro: true },
        { nombre: "Joao Gonzalez", centro: "L", alternaCentro: true },
      ],
    },
    {
      nombre: "Equipo 3",
      desfase: 14,
      miembros: [
        { nombre: "Yeray Rio Mira", centro: "A" },
        { nombre: "Rafael", centro: "L" },
      ],
    },
    {
      nombre: "Equipo 4",
      desfase: 21,
      miembros: [
        { nombre: "Ruben Martinez Santos", centro: "A" },
        { nombre: "Jose Antonio Soneira", centro: "L" },
      ],
    },
    {
      nombre: "Equipo 5",
      desfase: 28,
      miembros: [
        { nombre: "Waldy Mercado", centro: "A" },
        { nombre: "Steven Gonzalez", centro: "L" },
      ],
    },
  ],

  // Cambios puntuales sobre el ciclo (permutas, vacaciones, bajas, cambios de centro).
  //   turno: "TA" fuerza ese turno; turno: "" fuerza día libre.
  //   centro: "L" mantiene el turno del ciclo pero lo traslada a ese centro.
  // Las de 2026 reproducen exactamente el CSV original.
  excepciones: [
    {
      operador: "David Vidal",
      desde: "2026-09-21",
      hasta: "2026-09-23",
      turno: "ML",
    },
    {
      operador: "Yeray Rio Mira",
      desde: "2026-03-16",
      hasta: "2026-03-18",
      centro: "L",
    },
    {
      operador: "Yeray Rio Mira",
      desde: "2026-03-20",
      hasta: "2026-03-22",
      centro: "L",
    },
    { operador: "Rafa", desde: "2026-09-21", hasta: "2026-09-23", turno: "TL" },
    { operador: "Rafa", desde: "2026-09-24", hasta: "2026-09-24", turno: "TA" },
    {
      operador: "Ruben Martinez Santos",
      desde: "2026-09-26",
      hasta: "2026-09-26",
      centro: "L",
    },
    {
      operador: "Jose Antonio Soneira",
      desde: "2026-08-16",
      hasta: "2026-08-16",
      turno: "",
    },
    {
      operador: "Jose Antonio Soneira",
      desde: "2026-09-26",
      hasta: "2026-09-26",
      turno: "",
    },
    {
      operador: "Jose Antonio Soneira",
      desde: "2026-09-28",
      hasta: "2026-09-28",
      turno: "TA",
    },
    {
      operador: "Waldy Mercado",
      desde: "2026-03-26",
      hasta: "2026-03-29",
      centro: "L",
    },
    {
      operador: "Waldy Mercado",
      desde: "2026-09-26",
      hasta: "2026-09-26",
      turno: "TA",
    },
    {
      operador: "Waldy Mercado",
      desde: "2026-09-28",
      hasta: "2026-09-28",
      turno: "",
    },
  ],
};
