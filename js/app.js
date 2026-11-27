"use strict";

/*
 * TURNOS OPERACIONES · lógica de la aplicación
 *
 * FLUJO DE DATOS
 *   js/plan.js (PLAN) ─▶ buildRowsFromPlan() ─▶ rows  (matriz con forma de CSV)
 *   rows ─▶ detectMonths()   ─▶ months     (qué meses hay y en qué columnas)
 *   rows ─▶ fillOperators()  ─▶ operators  (una fila por persona)
 *   render() dibuja las vistas usando months, operators y los filtros.
 *
 * ORGANIZACIÓN (orden aproximado del archivo)
 *   1. Configuración y estado global      5. Modelo: meses, operadores, datos, estadísticas
 *   2. Utilidades                         6. Vista: paneles y calendarios
 *   3. Código heredado del CSV            7. Controlador: filtros, botones, tema
 *   4. Generador de turnos desde el plan  8. Informes Excel, exportación .ics y arranque
 *
 * PATRÓN MVC
 *   Modelo (datos y cálculo) · Vista (render*) · Controlador (eventos).
 *   Los informes siguen el mismo patrón con ReportModel, ReportView y ReportController.
 */

/* =========================================
   CONFIGURACIÓN
========================================= */

// Claves de localStorage. Las del CSV son heredadas; THEME_KEY (más abajo) sigue en uso.
const STORAGE_KEY = "turnos_operaciones_csv_v1";
const OPERATOR_KEY = "turnos_operaciones_operator_v1";
const YEAR_KEY = "turnos_operaciones_year_v1";

// Nombres de mes en mayúsculas: se comparan con la cabecera de `rows` (ver detectMonths).
const MONTHS = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

// Catálogo de turnos. Código = letra del turno (M/T/N) + centro (A = Arteixo, L = Laracha).
// Para añadir un turno nuevo hay que declararlo aquí y darle color en el CSS (.xx).
const SHIFTS = {
  MA: { name: "Mañana Arteixo", time: "07:00 - 15:00" },
  ML: { name: "Mañana Laracha", time: "07:00 - 15:00" },
  TA: { name: "Tarde Arteixo", time: "15:00 - 23:00" },
  TL: { name: "Tarde Laracha", time: "15:00 - 23:00" },
  NA: { name: "Noche Arteixo", time: "23:00 - 07:00" },
  NL: { name: "Noche Laracha", time: "23:00 - 07:00" },
};

// Iniciales de día de la semana; el índice coincide con Date.getDay() (0 = domingo).
const WEEKDAYS = ["D", "L", "M", "X", "J", "V", "S"];

// ---- Estado global (lo comparten todas las funciones) ----
let rows = []; // matriz [fila][columna]: fila 0 meses, 1 día semana, 2 día del mes, 3+ operadores
let months = []; // [{ name, index, year, start, end }] columnas de `rows` de cada mes
let operators = []; // [{ name, row }] personas con al menos un turno
let currentOperator = null; // operador elegido; null = vista conjunta de todos

let csvContent = "";
let restoredFromStorage = false;
let selectedYearFilter = "all"; // filtro de año: "all" o "2027"
let selectedMonthFilter = "all"; // filtro de mes: "all" o índice 0-11 como texto ("6" = julio)
let statsStartDate = ""; // rango del resumen (YYYY-MM-DD); vacío = año completo
let statsEndDate = "";
const OVERRIDES_KEY = "turnos_operaciones_overrides_v1";
const SWAPS_KEY = "turnos_operaciones_swaps_v1";
const AUDIT_KEY = "turnos_operaciones_audit_v1";
let runtimeOverrides = [];
let swapRequests = [];
let auditLog = [];
let selectedTeamFilter = "all";

const $ = (id) => document.getElementById(id);

/* =========================================
   UTILIDADES
========================================= */

/**
 * Pasa a MAYÚSCULAS, sin tildes ni espacios sobrantes. Sirve para comparar textos
 * ("Marzo " y "MARZO" dan el mismo resultado).
 */
function normalize(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

/**
 * Escapa & < > " ' antes de meter texto en innerHTML, para no inyectar HTML por error.
 */
function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

/**
 * Año de referencia leído del input oculto #year (si no es válido, el año actual).
 * Solo se usa como año de respaldo y para el resumen anual.
 */
function getYear() {
  const year = Number($("year").value);

  return Number.isInteger(year) && year >= 2000 && year <= 2100
    ? year
    : new Date().getFullYear();
}

/**
 * Fecha de hoy. Está en una función aparte para poder simularla en pruebas.
 */
function getToday() {
  return new Date();
}

/**
 * Deja seleccionados el año y el mes actuales en los filtros y refresca los selectores.
 * Si el mes actual no existe en `months`, muestra todos.
 */
function selectCurrentMonthByDefault() {
  const today = new Date();

  const current = months.find(
    (month) =>
      month.index === today.getMonth() && month.year === today.getFullYear(),
  );

  selectedYearFilter = current ? String(current.year) : "all";
  selectedMonthFilter = current ? String(current.index) : "all";

  updateFilterOptions();
}

/**
 * Tras dibujar, desplaza la página hasta la celda de hoy (#today) o, si no existe, al mes actual.
 */
function scrollToTodayAfterRender() {
  requestAnimationFrame(() => {
    const today = new Date();

    const monthElement = $(`month-${today.getFullYear()}-${today.getMonth()}`);

    const todayElement = $("today");

    const target = todayElement || monthElement;

    if (target) {
      target.scrollIntoView({
        behavior: "auto",
        block: todayElement ? "center" : "start",
      });
    }
  });
}

/**
 * Fecha en español, p. ej. "sábado, 14 de noviembre de 2026". `options` permite cambiar el formato.
 */
function formatDate(date, options = {}) {
  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...options,
  });
}

/**
 * Clase CSS de un turno ("MA" → "ma"), o "" si el código no existe en SHIFTS.
 */
function shiftClass(code) {
  return SHIFTS[code] ? code.toLowerCase() : "";
}

/* =========================================
   GUARDADO AUTOMÁTICO
========================================= */

/**
 * HEREDADO (versión con CSV): guarda el CSV cargado en localStorage. Ya no se usa con el plan.
 */
function saveCSV(content) {
  try {
    localStorage.setItem(STORAGE_KEY, content);
    localStorage.setItem(OPERATOR_KEY, currentOperator?.name || "");
    localStorage.setItem(YEAR_KEY, String(getYear()));

    $("fileStatus").textContent = "✓ CSV guardado automáticamente";
    updateStorageStatus(true);

    return true;
  } catch (error) {
    console.error("Error guardando CSV:", error);

    $("fileStatus").textContent = "⚠ No se pudo guardar";

    alert(
      "La planificación se ha cargado, pero no se pudo guardar automáticamente. " +
        "Comprueba el almacenamiento disponible del navegador.",
    );

    return false;
  }
}

/**
 * HEREDADO (versión con CSV): recupera el CSV guardado. Ya no se usa con el plan.
 */
function restoreCSV() {
  try {
    const savedCSV = localStorage.getItem(STORAGE_KEY);

    if (!savedCSV) {
      updateStorageStatus(false);
      return;
    }

    csvContent = savedCSV;
    rows = parseCSV(savedCSV);

    if (rows.length < 4) {
      throw new Error("CSV guardado no válido.");
    }

    const savedYear = localStorage.getItem(YEAR_KEY);
    if (savedYear && Number(savedYear) >= 2000 && Number(savedYear) <= 2100) {
      $("year").value = savedYear;
    }

    // Al abrir el calendario, tomar el año actual como referencia
    // para que el filtro pueda seleccionar el mes en curso.
    $("year").value = getToday().getFullYear();
    detectMonths();
    selectCurrentMonthByDefault();
    fillOperators();

    $("todayBtn").disabled = false;
    $("printBtn").disabled = false;
    $("exportBtn").disabled = false;
    $("monthFilter").disabled = false;

    const savedOperator = localStorage.getItem(OPERATOR_KEY);

    if (savedOperator) {
      const found = operators.find((op) => op.name === savedOperator);
      currentOperator = found || null;
      $("operator").value = currentOperator ? currentOperator.name : "";
    } else {
      currentOperator = null;
      $("operator").value = "";
    }

    render();
    scrollToTodayAfterRender();
    restoredFromStorage = true;

    $("fileStatus").textContent = "✓ Planificación recuperada automáticamente";
    updateStorageStatus(true);
  } catch (error) {
    console.error("Error recuperando CSV:", error);
    $("fileStatus").textContent = " ";
    updateStorageStatus(false);
  }
}
/**
 * Muestra en la cabecera una etiqueta de estado. `saved` elige el estilo; `text` el mensaje.
 */
function updateStorageStatus(saved, text) {
  const label =
    text ||
    (saved
      ? "● Planificación guardada en este dispositivo"
      : "○ Sin planificación guardada");
  $("storageStatus").innerHTML = saved
    ? `<span class="storage-status">${label}</span>`
    : `<span class="storage-status" style="background:#f1f5f9;color:#64748b">${label}</span>`;
}

/* Decodifica UTF-8 y, si no es válido, Windows-1252 (CSV de Excel). */
/**
 * Convierte bytes a texto: intenta UTF-8 y, si no es válido, Windows-1252 (CSV de Excel).
 */
function decodeCSV(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/* =========================================
   LECTOR CSV
========================================= */

/**
 * HEREDADO: lector CSV propio (detecta ; o , y respeta comillas). Devuelve una matriz de filas.
 * Solo lo usan el cargador manual y las pruebas; el plan genera esa misma matriz directamente.
 */
function parseCSV(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";

  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;

  const separator = semicolons >= commas ? ";" : ",";

  const result = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === separator && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;

      row.push(field.trim());

      if (row.some((value) => value !== "")) {
        result.push(row);
      }

      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.trim());

  if (row.some((value) => value !== "")) {
    result.push(row);
  }

  return result;
}

/* =========================================
   GENERADOR DE TURNOS (a partir de js/plan.js)
   Produce la misma matriz que antes se leía del CSV,
   así el resto de la aplicación no cambia.
========================================= */

/**
 * Genera `rows` a partir de PLAN (js/plan.js). Devuelve [cabecera de meses, días de la semana,
 * días del mes, ...una fila por persona]. Cubre desde (año actual - aniosAtras) hasta
 * (año actual + aniosAdelante), sin pasar de PLAN.inicio. Es la única fuente de datos.
 */
function buildRowsFromPlan() {
  if (!/^[MTN_]+$/.test(PLAN.ciclo)) {
    throw new Error("El ciclo solo admite M, T, N y _.");
  }

  const DAY = 86400000;
  const LEN = PLAN.ciclo.length;
  const mod = (a, n) => ((a % n) + n) % n;
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const [py, pm, pd] = PLAN.inicio.split("-").map(Number);
  const ancla = Date.UTC(py, pm - 1, pd);
  // El cambio de centro de los equipos que alternan ocurre tras el descanso largo.
  const cambio = PLAN.ciclo.search(/_[^_]/) + 1;

  /**
   * Código de turno de UNA persona en UNA fecha, o "" si libra. Pasos:
   * 1) ¿la persona pertenece al equipo en esa fecha? (desde/hasta)
   * 2) n = días desde PLAN.inicio; posición en el ciclo = (n + desfase) mod longitud
   * 3) letra del ciclo + centro (si alterna, el centro se invierte cada ciclo tras el descanso)
   * 4) las excepciones del plan sustituyen el resultado
   */
  function shiftFor(team, member, date) {
    const key = iso(date);
    if (
      (member.desde && key < member.desde) ||
      (member.hasta && key > member.hasta)
    ) {
      return "";
    }

    // Días desde el inicio, en UTC para que el cambio de hora no afecte.
    const n = Math.round(
      (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - ancla) /
        DAY,
    );
    const letter = PLAN.ciclo[mod(n + team.desfase, LEN)];
    let code = "";

    if (letter !== "_") {
      let centro = member.centro;
      const bloque = Math.floor((n + team.desfase - cambio) / LEN);
      if (member.alternaCentro && mod(bloque, 2) === 1) {
        centro = centro === "A" ? "L" : "A";
      }
      code = letter + centro;
    }

    PLAN.excepciones.forEach((e) => {
      if (
        e.operador !== member.nombre ||
        key < e.desde ||
        key > (e.hasta || e.desde)
      )
        return;
      if (e.turno !== undefined) code = e.turno;
      else if (e.centro && code) code = code[0] + e.centro;
    });

    return code;
  }

  const year = new Date().getFullYear();
  const planStart = new Date(py, pm - 1, 1);
  const first = new Date(
    Math.max(planStart, new Date(year - PLAN.aniosAtras, 0, 1)),
  );
  const lastYear = year + PLAN.aniosAdelante;

  // nombre -> entradas { team, member }. Una persona puede tener varias (traslados entre equipos)
  // con periodos desde/hasta distintos, y sale en una única fila.
  const byName = new Map();
  PLAN.equipos.forEach((team) =>
    team.miembros.forEach((member) => {
      if (!byName.has(member.nombre)) byName.set(member.nombre, []);
      byName.get(member.nombre).push({ team, member });
    }),
  );
  const names = [...byName.keys()];
  const isActive = (member, key) =>
    !(
      (member.desde && key < member.desde) ||
      (member.hasta && key > member.hasta)
    );
  const head = [String(first.getFullYear())];
  const weekdays = [""];
  const numbers = [""];
  const body = names.map((name) => [name]);

  for (let y = first.getFullYear(); y <= lastYear; y++) {
    for (
      let m = y === first.getFullYear() ? first.getMonth() : 0;
      m < 12;
      m++
    ) {
      const days = new Date(y, m + 1, 0).getDate();
      for (let day = 1; day <= days; day++) {
        const date = new Date(y, m, day);
        head.push(day === 1 ? MONTHS[m] : "");
        weekdays.push(WEEKDAYS[date.getDay()]);
        numbers.push(String(day));
        const key = iso(date);
        names.forEach((name, i) => {
          const entry = byName
            .get(name)
            .find(({ member }) => isActive(member, key));
          body[i].push(entry ? shiftFor(entry.team, entry.member, date) : "");
        });
      }
    }
  }

  return [head, weekdays, numbers, ...body];
}

/* =========================================
   CARGAR ARCHIVO
========================================= */

// HEREDADO: #csvFile está oculto en index.html, así que este bloque no se ejecuta salvo que lo muestres.
$("csvFile").addEventListener("change", function (event) {
  const file = event.target.files[0];

  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".csv")) {
    alert("Selecciona un archivo CSV válido.");
    return;
  }

  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const content = decodeCSV(e.target.result);

      const parsed = parseCSV(content);

      if (parsed.length < 4) {
        throw new Error("El archivo no contiene suficientes filas.");
      }

      const previousOperator =
        currentOperator?.name || localStorage.getItem(OPERATOR_KEY);

      // Validar antes de sustituir los datos anteriores.
      rows = parsed;
      $("year").value = getToday().getFullYear();
      detectMonths();
      selectCurrentMonthByDefault();
      fillOperators();

      csvContent = content;

      // Mantener el operador si había uno seleccionado; si no, vista general.
      if (previousOperator) {
        const found = operators.find((op) => op.name === previousOperator);
        currentOperator = found || null;
      } else {
        currentOperator = null;
      }
      $("operator").value = currentOperator ? currentOperator.name : "";

      saveCSV(content);

      restoredFromStorage = false;

      $("fileStatus").textContent = "✓ Archivo cargado: " + file.name;

      $("todayBtn").disabled = false;
      $("printBtn").disabled = false;
      $("exportBtn").disabled = false;
      $("monthFilter").disabled = false;
      updateFilterOptions();
      render();
      scrollToTodayAfterRender();
    } catch (error) {
      console.error(error);
      alert("Error al cargar el CSV:\n" + error.message);
    }
  };

  reader.onerror = function () {
    alert("No se pudo leer el archivo.");
  };

  reader.readAsArrayBuffer(file);
});

/* =========================================
   DETECTAR MESES
========================================= */

/**
 * Recorre la fila 0 de `rows` y rellena `months`. Una celda con año ("2026") fija el año de los
 * meses siguientes; si no hay, se suma un año al pasar de diciembre a enero.
 * Cada mes ocupa las columnas desde su inicio hasta el inicio del siguiente.
 */
function detectMonths() {
  months = [];

  const monthRow = rows[0] || [];
  const baseYear = getYear();

  let currentYear = baseYear;
  let previousMonth = -1;

  monthRow.forEach((value, index) => {
    const monthName = normalize(value);
    const monthIndex = MONTHS.indexOf(monthName);

    // Un año explícito en la cabecera fija el año de los meses siguientes.
    if (/^20\d\d$/.test(monthName)) {
      currentYear = Number(monthName);
      previousMonth = -1;
      return;
    }

    if (monthIndex !== -1) {
      // Al pasar de diciembre a enero comienza el año siguiente.
      if (previousMonth !== -1 && monthIndex < previousMonth) {
        currentYear++;
      }

      months.push({
        name: MONTHS[monthIndex],
        index: monthIndex,
        start: index,
        end: monthRow.length,
        year: currentYear,
      });

      previousMonth = monthIndex;
    }
  });

  if (months.length === 0) {
    throw new Error("No se han detectado los meses en la primera fila.");
  }

  months.forEach((month, index) => {
    if (index < months.length - 1) {
      month.end = months[index + 1].start;
    }
  });
}

/* =========================================
   OPERADORES
========================================= */

/**
 * Rellena `operators` con las filas (desde la 3) que tengan al menos un turno válido y rellena
 * el desplegable de operadores. Deja la vista conjunta (currentOperator = null) por defecto.
 */
function fillOperators() {
  operators = [];

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[0] || "").trim();

    if (!name || name.length < 2) continue;

    if (name.includes("Tal como lo conversamos") || name.includes("19 de oct"))
      continue;

    const hasShifts = row.some((value) =>
      Object.hasOwn(SHIFTS, normalize(value)),
    );

    if (!hasShifts) continue;

    operators.push({ name, row });
  }

  if (operators.length === 0) {
    throw new Error("No se han encontrado operadores con turnos.");
  }

  operators.sort((a, b) => a.name.localeCompare(b.name, "es"));

  $("operator").innerHTML = '<option value="">Todos los operadores</option>';

  operators.forEach((operator) => {
    const option = document.createElement("option");
    option.value = operator.name;
    option.textContent = operator.name;
    $("operator").appendChild(option);
  });

  $("operator").disabled = false;

  // Por defecto se muestra el cuadrante conjunto de todos los operadores.
  currentOperator = null;
  $("operator").value = "";
}

$("operator").addEventListener("change", function () {
  currentOperator = this.value
    ? operators.find((op) => op.name === this.value) || null
    : null;

  try {
    localStorage.setItem(OPERATOR_KEY, currentOperator?.name || "");
  } catch (error) {
    console.warn("No se pudo guardar la selección.", error);
  }

  render();
});

/* =========================================
   TURNOS DEL MES
========================================= */

/**
 * Turnos de una fila en un mes. Devuelve Map(día → código): "" = libre. Los días que no están
 * en `rows` no aparecen en el Map (= "sin datos").
 */
function getMonthData(month, row) {
  const result = new Map();
  const daysRow = rows[2];

  for (let col = month.start; col < month.end; col++) {
    const day = Number((daysRow[col] || "").trim());

    if (!Number.isInteger(day) || day < 1 || day > 31) continue;

    const code = normalize(row[col]);

    result.set(day, SHIFTS[code] ? code : "");
  }

  // Los cambios introducidos desde la interfaz prevalecen sobre el ciclo base.
  runtimeOverrides.forEach((item) => {
    if (item.operator !== row?.[0]) return;
    const from = new Date(item.from + "T00:00:00");
    const to = new Date(item.to + "T00:00:00");
    for (
      let date = new Date(month.year, month.index, 1);
      date <= new Date(month.year, month.index + 1, 0);
      date.setDate(date.getDate() + 1)
    ) {
      if (date >= from && date <= to) {
        result.set(date.getDate(), SHIFTS[item.shift] ? item.shift : "");
      }
    }
  });

  return result;
}

/**
 * Turno de una fila en una fecha concreta. Devuelve el código, "" (libre) o null (sin datos).
 */
function getShiftForDate(date, row) {
  const month = months.find(
    (m) => m.index === date.getMonth() && m.year === date.getFullYear(),
  );

  if (!month) return null;

  const data = getMonthData(month, row);

  if (!data.has(date.getDate())) return null;

  return data.get(date.getDate());
}

/* =========================================
   ESTADÍSTICAS
========================================= */

/**
 * Cuenta turnos por tipo, por centro y días libres hasta HOY (los días futuros no cuentan).
 * Sin fechas elegidas usa el año de referencia; con fechas, el rango. Devuelve { stats, totalDays }.
 */
function calculateStats(row, startDate = "", endDate = "") {
  const stats = {
    MA: 0,
    ML: 0,
    TA: 0,
    TL: 0,
    NA: 0,
    NL: 0,

    ARTEIXO: 0,
    LARACHA: 0,

    LIBRE: 0,
  };

  let totalDays = 0;
  const selectedYear = getYear();
  const start = startDate ? new Date(startDate + "T00:00:00") : null;
  const end = endDate ? new Date(endDate + "T23:59:59") : null;

  months.forEach((month) => {
    // Sin fechas seleccionadas, el resumen corresponde al año elegido.
    if (!start && !end && month.year !== selectedYear) return;

    const data = getMonthData(month, row);

    data.forEach((code, day) => {
      const date = new Date(month.year, month.index, day);

      const today = new Date();
      today.setHours(23, 59, 59, 999);

      if (date > today) {
        return;
      }

      if (start && date < start) return;
      if (end && date > end) return;

      totalDays++;

      if (code && SHIFTS[code]) {
        stats[code]++;
        if (code.endsWith("A")) {
          stats.ARTEIXO++;
        }

        if (code.endsWith("L")) {
          stats.LARACHA++;
        }
      }
        if (code.endsWith("")) {
          stats.LIBRE++;
        }
      }
    });
  });

  return { stats, totalDays };
}
/**
 * Dibuja el panel "Resumen de turnos" de un operador, con el filtro de fechas y sus botones.
 */
function renderStats(row) {
  const result = calculateStats(row, statsStartDate, statsEndDate);
  const stats = result.stats;
  const totalHours =
    ["MA", "ML", "TA", "TL", "NA", "NL"].reduce(
      (sum, code) => sum + stats[code],
      0,
    ) * 8;

  const cards = [
    ["HORAS", "Horas trabajadas", "#0f766e", totalHours],
    ["MA", "Mañana Arteixo", "var(--ma)"],
    ["ML", "Mañana Laracha", "var(--ml)"],

    ["TA", "Tarde Arteixo", "var(--ta)"],
    ["TL", "Tarde Laracha", "var(--tl)"],

    ["NA", "Noche Arteixo", "var(--na)"],
    ["NL", "Noche Laracha", "var(--nl)"],

    ["ARTEIXO", "Días Arteixo", "#0284c7"],
    ["LARACHA", "Días Laracha", "#059669"],

    ["LIBRE", "Días libres", "#cbd5e1"],
  ];

  const periodLabel =
    statsStartDate || statsEndDate
      ? `Periodo: ${statsStartDate || "inicio"} — ${statsEndDate || "actualidad"}`
      : `Año completo · ${getYear()}`;

  $("statsPanel").innerHTML = `
        <h3 class="panel-title">📊 Resumen de turnos</h3>

        <div class="stats-filter">
            <div class="control">
                <label for="statsStartDate">Desde el día</label>
                <input type="date" id="statsStartDate" value="${statsStartDate}">
            </div>
            <div class="control">
                <label for="statsEndDate">Hasta el día</label>
                <input type="date" id="statsEndDate" value="${statsEndDate}">
            </div>
            <button type="button" id="applyStatsFilter">Aplicar fechas</button>
            <button type="button" id="clearStatsFilter" class="secondary">Ver año completo(hasta hoy) </button> 
        </div>

        <p class="stats-period">${escapeHTML(periodLabel)}</p>

        <div class="summary">
            ${cards
              .map(
                ([code, name, color]) => `
                <div class="summary-card" style="--accent:${color}">
                    <small>${name}</small>
                    <strong>${code === "HORAS" ? totalHours : stats[code]}</strong>
                    <small>${code}</small>
                </div>
            `,
              )
              .join("")}
        </div>

        <p style="font-size:12px;color:var(--muted);margin-bottom:0">
            Total de días incluidos: ${result.totalDays}
        </p>
    `;

  $("applyStatsFilter").addEventListener("click", () => {
    const from = $("statsStartDate").value;
    const to = $("statsEndDate").value;

    if (from && to && from > to) {
      alert("La fecha inicial no puede ser posterior a la fecha final.");
      return;
    }

    statsStartDate = from;
    statsEndDate = to;
    renderStats(row);
  });

  $("clearStatsFilter").addEventListener("click", () => {
    statsStartDate = "";
    statsEndDate = "";
    renderStats(row);
  });
}

/* =========================================
   PANEL DE HOY
========================================= */

/**
 * Panel de hoy del operador seleccionado: su turno de hoy, con horario o "LIBRE".
 */
function renderToday(row) {
  const today = getToday();
  const code = getShiftForDate(today, row);
  const shift = code ? SHIFTS[code] : null;

  $("todayPanel").innerHTML = `
        <div class="today-info">
            <div>
                <div class="today-name">
                    👤 ${escapeHTML(currentOperator.name)}
                </div>
                <div class="today-date">
                    📅 ${escapeHTML(formatDate(today))}
                </div>
            </div>

            <div style="text-align:right">
                <div style="font-size:12px;color:#64748b">TURNO DE HOY</div>

                ${
                  shift
                    ? `
                    <div class="next-shift ${shiftClass(code)}"
                         style="display:inline-block;font-size:17px;
                         padding:10px 18px;margin-top:5px">
                        ${code}
                    </div>
                    <div style="font-size:12px;margin-top:5px">
                        ${shift.name} · ${shift.time}
                    </div>
                `
                    : `
                    <div style="font-size:20px;font-weight:800;
                         color:#64748b;margin-top:5px">
                        ${code === "" ? "LIBRE" : "SIN DATOS"}
                    </div>
                `
                }
            </div>
        </div>
    `;
}

/* =========================================
   PRÓXIMOS SIETE DÍAS
========================================= */

/**
 * Lista los próximos 7 días del operador seleccionado (hoy incluido).
 */
function renderNextTurns(row) {
  const today = getToday();

  let html = `
        <h3 class="panel-title">📅 Próximos 7 días</h3>
        <div class="next-list">
    `;

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const code = getShiftForDate(date, row);
    const shift = code ? SHIFTS[code] : null;

    const label = shift ? code : code === "" ? "LIBRE" : "SIN DATOS";

    html += `
            <div class="next-item ${i === 0 ? "today-next" : ""}">
                <div>
                    <div class="next-date">
                        ${
                          i === 0
                            ? "HOY"
                            : escapeHTML(
                                formatDate(date, {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                }),
                              )
                        }
                    </div>
                    <small style="color:#64748b">
                        ${shift ? shift.name : ""}
                    </small>
                </div>

                <span class="next-shift ${shift ? shiftClass(code) : ""}"
                      style="${shift ? "" : "background:#94a3b8"}">
                    ${label}
                </span>
            </div>
        `;
  }

  html += "</div>";

  $("nextPanel").innerHTML = html;
}

/* =========================================
   CALENDARIO
========================================= */

/**
 * "JULIO" → "Julio", para mostrar los meses en los selectores.
 */
function capitalize(text) {
  return text.charAt(0) + text.slice(1).toLowerCase();
}

/**
 * Meses que cumplen los filtros de año y mes. Lo usan los calendarios y el informe Excel.
 */
function getVisibleMonths() {
  return months.filter(
    (month) =>
      (selectedYearFilter === "all" ||
        month.year === Number(selectedYearFilter)) &&
      (selectedMonthFilter === "all" ||
        month.index === Number(selectedMonthFilter)),
  );
}

/**
 * Reconstruye los selectores: años que existen y, dentro del año elegido, sus meses.
 * Si el valor elegido ya no existe, vuelve a "all". Activa o desactiva los selectores.
 */
function updateFilterOptions() {
  const yearSelect = $("yearFilter");
  const monthSelect = $("monthFilter");
  if (!yearSelect || !monthSelect) return;

  // Años disponibles.
  const years = [...new Set(months.map((month) => month.year))];
  yearSelect.innerHTML =
    '<option value="all">Todos los años</option>' +
    years.map((year) => `<option value="${year}">${year}</option>`).join("");
  if (
    selectedYearFilter !== "all" &&
    !years.includes(Number(selectedYearFilter))
  ) {
    selectedYearFilter = "all";
  }
  yearSelect.value = selectedYearFilter;

  // Meses que existen dentro del año elegido (sin repetir).
  const inYear = months.filter(
    (month) =>
      selectedYearFilter === "all" || month.year === Number(selectedYearFilter),
  );
  const available = [
    ...new Map(inYear.map((month) => [month.index, month])).values(),
  ].sort((a, b) => a.index - b.index);
  monthSelect.innerHTML =
    '<option value="all">Todos los meses</option>' +
    available
      .map(
        (month) =>
          `<option value="${month.index}">${capitalize(month.name)}</option>`,
      )
      .join("");
  if (
    selectedMonthFilter !== "all" &&
    !available.some((m) => String(m.index) === selectedMonthFilter)
  ) {
    selectedMonthFilter = "all";
  }
  monthSelect.value = selectedMonthFilter;

  yearSelect.disabled = monthSelect.disabled = months.length === 0;
}

/**
 * Vista individual: un calendario mensual (rejilla de 7 columnas) por cada mes visible.
 * La primera semana se rellena con huecos hasta el día de la semana del día 1.
 */
function renderCalendar(row) {
  const slot = getCurrentSlot();
  $("container").innerHTML = "";
  updateFilterOptions();

  const visibleMonths = getVisibleMonths();

  if (visibleMonths.length === 0) {
    $("container").innerHTML = `
            <div class="panel empty-state">
                <div class="emoji">🗓️</div>
                No hay planificación disponible para los meses seleccionados.
            </div>
        `;
    return;
  }

  visibleMonths.forEach((month) => {
    const monthData = getMonthData(month, row);
    const year = month.year;
    const totalDays = new Date(year, month.index + 1, 0).getDate();
    const firstDay = new Date(year, month.index, 1).getDay();

    const block = document.createElement("section");
    block.className = "month";
    block.id = `month-${year}-${month.index}`;

    block.innerHTML = `
            <h2>
                <span>${month.name}</span>
                <small>${year} · ${monthData.size} días registrados</small>
            </h2>
        `;

    const calendar = document.createElement("div");
    calendar.className = "calendar";

    WEEKDAYS.forEach((day) => {
      const cell = document.createElement("div");
      cell.className = "dow";
      cell.textContent = day;
      calendar.appendChild(cell);
    });

    // La cabecera empieza en domingo, igual que Date.getDay().
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement("div");
      empty.className = "day empty";
      calendar.appendChild(empty);
    }

    for (let day = 1; day <= totalDays; day++) {
      const cell = document.createElement("div");
      cell.className = "day";

      const code = monthData.has(day) ? monthData.get(day) : null;

      const today = getToday();
      const isToday =
        today.getDate() === day &&
        today.getMonth() === month.index &&
        today.getFullYear() === year;

      if (isToday) {
        cell.classList.add("today");
        cell.id = "today";
      }

      /*cell.innerHTML = `<div class="daynum">${day}</div>`;*/
      const date = new Date(year, month.index, day);

      const weekday = date.toLocaleDateString("es-ES", { weekday: "short" });

      cell.innerHTML = `
    <div class="daynum">${day}</div>
    <div class="weekday">${weekday}</div>
`;

      if (code === null) {
        cell.innerHTML += `<div class="free-label">Sin datos</div>`;
      } else if (code) {
        const shift = SHIFTS[code];
        cell.innerHTML += `<div class="turno ${shiftClass(code)}">${code}</div>`;
        cell.title = `${shift.name} (${shift.time})`;
      } else {
        cell.innerHTML += `<div class="free-label">LIBRE</div>`;
        cell.title = "Día libre";
      }

      // Turno en curso: se marca en verde (hoy, o ayer si todavía dura la noche).
      if (isCurrentShift(date, code, slot)) {
        cell.classList.add("en-turno");
        cell.innerHTML += `<div class="ahora-badge">● En turno ahora</div>`;
        cell.title = `En turno ahora · ${cell.title}`;
      }

      calendar.appendChild(cell);
    }

    const remainder = calendar.children.length % 7;
    if (remainder !== 0) {
      for (let i = remainder; i < 7; i++) {
        const empty = document.createElement("div");
        empty.className = "day empty";
        calendar.appendChild(empty);
      }
    }

    block.appendChild(calendar);
    $("container").appendChild(block);
  });
}

const SLOT_ORDER = ["M", "T", "N"];
const SLOT_NAMES = { M: "Mañana", T: "Tarde", N: "Noche" };

/** ¿Dos fechas son el mismo día? */
function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Turno en curso a la hora `now`: { date, letter }. `date` es el día en que EMPEZÓ el turno.
 * 07-15 mañana, 15-23 tarde, desde las 23 noche; de 00 a 07 sigue la noche que empezó el día anterior.
 */
function getCurrentSlot(now = getToday()) {
  const h = now.getHours();
  const letter = h >= 23 ? "N" : h >= 15 ? "T" : h >= 7 ? "M" : "N";
  return {
    date: new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (h < 7 ? 1 : 0),
    ),
    letter,
  };
}

/** Turno `offset` posiciones antes (-1) o después (+1): M → T → N → M del día siguiente. */
function shiftSlot(slot, offset) {
  const idx = SLOT_ORDER.indexOf(slot.letter) + offset;
  const d = slot.date;
  return {
    date: new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + Math.floor(idx / 3),
    ),
    letter: SLOT_ORDER[((idx % 3) + 3) % 3],
  };
}

/** Personas de servicio en un turno, por centro: { A: [...], L: [...] }. */
function whoIsOn(slot) {
  const group = { A: [], L: [] };
  operators.forEach((op) => {
    const code = getShiftForDate(slot.date, op.row);
    if (code && code[0] === slot.letter) group[code[1]].push(op.name);
  });
  return group;
}

/** ¿Esta celda (día + código de turno) es el turno en curso? Sirve para marcarla en los calendarios. */
function isCurrentShift(date, code, slot = getCurrentSlot()) {
  return Boolean(code) && code[0] === slot.letter && sameDay(date, slot.date);
}

/** Redibuja cuando cambia el turno en curso (a las 07:00, 15:00 y 23:00), sin recargar la página. */
function watchShiftChange() {
  const key = () => {
    const t = getCurrentSlot();
    return `${t.date.toDateString()}${t.letter}`;
  };
  let last = key();
  setInterval(() => {
    if (key() === last) return;
    last = key();
    render();
  }, 60000);
}

/**
 * Recuadro de la vista conjunta con tres turnos: anterior, en curso (destacado) y siguiente.
 * Cada uno muestra su horario y las personas de servicio en Arteixo y en Laracha.
 */
function renderOnDutyNow() {
  const now = getToday();
  const current = getCurrentSlot(now);
  const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dia = (slot) => {
    const diff = Math.round((slot.date - hoy) / 86400000);
    return diff === -1 ? " · ayer" : diff === 1 ? " · mañana" : "";
  };
  const bloque = (titulo, slot, clase) => {
    const g = whoIsOn(slot);
    const linea = (centro, lista) =>
      `<div><span class="now-center">${centro}</span>${lista.length ? lista.map(escapeHTML).join(", ") : "—"}</div>`;
    const horario = SHIFTS[`${slot.letter}A`].time.replace(/\s*-\s*/, "–");
    return `<div class="now-slot ${clase}">
        <div class="now-slot-title">${titulo}</div>
        <div class="now-slot-sub">${SLOT_NAMES[slot.letter]} · ${horario}${dia(slot)}</div>
        ${linea("Arteixo", g.A)}${linea("Laracha", g.L)}
      </div>`;
  };
  return `<div class="now-box"><div class="now-grid">
      ${bloque("⏮ Turno anterior", shiftSlot(current, -1), "prev")}
      ${bloque("🟢 Ahora en turno", current, "current")}
      ${bloque("⏭ Siguiente turno", shiftSlot(current, 1), "next")}
    </div></div>`;
}

/**
 * Panel de hoy en la vista conjunta: "Ahora en turno" y el turno de hoy de cada operador.
 */
function renderTodayAll() {
  const today = getToday();
  const entries = operators
    .map((operator) => {
      const code = getShiftForDate(today, operator.row);
      const label = code === null ? "SIN DATOS" : code || "LIBRE";
      const shift = code ? SHIFTS[code] : null;
      return `
            <div class="next-item">
                <span class="next-date">${escapeHTML(operator.name)}</span>
                <span class="next-shift ${shiftClass(code)}"
                      style="${shift ? "" : "background:#94a3b8"}"
                      title="${shift ? `${shift.name} · ${shift.time}` : label}">
                    ${label}
                </span>
            </div>`;
    })
    .join("");

  $("todayPanel").innerHTML = `
        <h3 class="panel-title">📍 Turnos de hoy · ${escapeHTML(formatDate(today))}</h3>
        ${renderOnDutyNow()}
        <div class="next-list">${entries}</div>
    `;
}

/**
 * Texto informativo del panel de próximos turnos en la vista conjunta.
 */
function renderNextAll() {
  $("nextPanel").innerHTML = `
        <h3 class="panel-title">👥 Vista conjunta de operadores</h3>
        <p style="color:var(--muted);margin:0">
            Estás viendo el cuadrante mensual de todos los operadores. 
            Selecciona un nombre en el desplegable para consultar su calendario individual,
            sus próximos turnos y sus estadísticas.
        </p>
    `;
}

/**
 * Texto informativo del panel de estadísticas en la vista conjunta.
 */
function renderStatsAll() {
  $("statsPanel").innerHTML = `
        <h3 class="panel-title">📊 Resumen</h3>

        <p style="color:var(--muted)">
            Selecciona un operador para ver estadísticas.
        </p>
    `;
}

/**
 * Reduce un código a su letra de turno (M, T, N) o "_" si libra.
 */
function normalizeShiftPattern(code) {
  code = String(code || "")
    .trim()
    .toUpperCase();

  if (code.startsWith("M")) return "M";
  if (code.startsWith("T")) return "T";
  if (code.startsWith("N")) return "N";

  return "_";
}

/**
 * Clave de ordenación: letras de turno de los primeros 14 días. Las filas con el mismo patrón
 * (mismo equipo) quedan juntas en el cuadrante conjunto.
 */
function buildPatternKey(operator) {
  const days = [...operator.shifts.keys()].sort((a, b) => a - b).slice(0, 14);

  return days
    .map((day) => normalizeShiftPattern(operator.shifts.get(day)))
    .join("");
}

/**
 * Vista conjunta: una tabla por mes (filas = operadores, columnas = días). Marca la columna de hoy
 * y desliza en horizontal si no cabe.
 */
function renderAllOperatorsCalendar() {
  const slot = getCurrentSlot();
  $("container").innerHTML = "";
  updateFilterOptions();

  const visibleMonths = getVisibleMonths();

  if (visibleMonths.length === 0) {
    $("container").innerHTML = `
            <div class="panel empty-state">
                <div class="emoji">🗓️</div>
                No hay planificación disponible para los meses seleccionados.
            </div>`;
    return;
  }

  visibleMonths.forEach((month) => {
    const monthData = operators
      .filter(
        (operator) =>
          selectedTeamFilter === "all" ||
          getOperatorTeam(operator.name) === selectedTeamFilter,
      )
      .map((operator) => ({
        name: operator.name,
        shifts: getMonthData(month, operator.row),
      }));
    // Ordenar la grilla por el equipo definido en PLAN (Equipo 1, 2, 3...).
    // Los operadores que no estén asignados a un equipo quedan al final.
    const getTeamOrder = (operatorName) => {
      const index = PLAN.equipos.findIndex((team) =>
        team.miembros.some((member) => member.nombre === operatorName),
      );
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };

    monthData.sort((a, b) => {
      const teamDifference = getTeamOrder(a.name) - getTeamOrder(b.name);
      if (teamDifference !== 0) return teamDifference;
      return a.name.localeCompare(b.name, "es");
    });

    const totalDays = new Date(month.year, month.index + 1, 0).getDate();

    const section = document.createElement("section");
    section.className = "month";
    section.id = `month-${month.year}-${month.index}`;

    let table = `
            <h2>
                <span class="mes" >${month.name} </span>
                <small>${month.year} · ${monthData.length} operadores</small>
            </h2>
            <p class="all-view-note">Cada fila representa un operador. Desliza horizontalmente para consultar todos los días del mes.</p>
            <div class="all-operators-wrap">
                <table class="all-operators-table">
                    <thead><tr>
                        <th class="operator-name">Operador</th>
                         ${Array.from({ length: totalDays }, (_, i) => {
                           const day = i + 1;

                           const isToday =
                             day === getToday().getDate() &&
                             month.index === getToday().getMonth() &&
                             month.year === getToday().getFullYear();

                           const weekday =
                             WEEKDAYS[
                               new Date(month.year, month.index, day).getDay()
                             ];

                           return `
    <th class="${isToday ? "today-column" : ""}">
      <div class="header-weekday">${weekday}</div>
      <div class="header-day">${day}</div>
    </th>
  `;
                         }).join("")}
                    </tr></thead>
                    <tbody>
        `;

    monthData.forEach((operator) => {
      table += `<tr><th class="operator-name">${escapeHTML(operator.name)}</th>`;
      for (let day = 1; day <= totalDays; day++) {
        const isToday =
          day === getToday().getDate() &&
          month.index === getToday().getMonth() &&
          month.year === getToday().getFullYear();
        const todayClass = isToday ? " today-column" : "";
        const todayId = isToday ? ' id="today"' : "";
        const code = operator.shifts.has(day) ? operator.shifts.get(day) : null;
        if (code === null) {
          table += `<td${todayId} class="no-data-cell${todayClass}" title="Sin datos">—</td>`;
        } else if (code) {
          const shift = SHIFTS[code];
          const ahora = isCurrentShift(
            new Date(month.year, month.index, day),
            code,
            slot,
          );
          table += `<td${todayId} class="shift-cell ${shiftClass(code)}${todayClass}${ahora ? " en-turno-cell" : ""}" title="${ahora ? "En turno ahora · " : ""}${escapeHTML(shift.name)} · ${escapeHTML(shift.time)}">${code}</td>`;
        } else {
          table += `<td${todayId} class="free-cell${todayClass}" title="Día libre">L</td>`;
        }
      }
      table += `</tr>`;
    });

    table += `</tbody></table></div>`;
    section.innerHTML = table;
    $("container").appendChild(section);
  });
}

/**
 * Punto único de dibujado. Con operador: hoy, próximos 7 días, estadísticas y calendario.
 * Sin operador: vista conjunta. Después guarda la selección en localStorage.
 */
function render() {
  if (!operators.length) return;
  $("icsBtn").hidden = !currentOperator;
  if (typeof renderAdminModule === "function") renderAdminModule();

  if (currentOperator) {
    const row = currentOperator.row;
    renderToday(row);
    renderNextTurns(row);
    renderStats(row);
    renderCalendar(row);
  } else {
    renderTodayAll();
    renderNextAll();
    renderStatsAll();
    renderAllOperatorsCalendar();
  }

  try {
    localStorage.setItem(OPERATOR_KEY, currentOperator?.name || "");
    localStorage.setItem(YEAR_KEY, String(getYear()));
  } catch (error) {
    console.warn("No se pudo guardar la selección.", error);
  }
}

/* =========================================
   IR A HOY
========================================= */

$("todayBtn").addEventListener("click", goToday);

/**
 * Botón "Ir a hoy": restablece filtros al mes actual, redibuja y desplaza hasta hoy.
 */
function goToday() {
  const today = getToday();

  $("year").value = today.getFullYear();
  detectMonths();
  selectCurrentMonthByDefault();
  render();

  requestAnimationFrame(() => {
    const dayElement = $("today");
    const monthElement = $(`month-${today.getFullYear()}-${today.getMonth()}`);
    const target = dayElement || monthElement;

    if (target) {
      target.scrollIntoView({
        behavior: "smooth",
        block: dayElement ? "center" : "start",
        inline: "center",
      });
    } else {
      alert(
        "No hay planificación del mes actual en el CSV. " +
          "Comprueba que el archivo incluya ese mes.",
      );
    }
  });
}

$("monthFilter").addEventListener("change", function () {
  selectedMonthFilter = this.value || "all";
  if (operators.length) render();
});

$("yearFilter").addEventListener("change", function () {
  selectedYearFilter = this.value || "all";
  if (operators.length) render();
});

$("printBtn").addEventListener("click", function () {
  window.print();
});

/* =========================================
   MEJORAS: equipos, validaciones, gestión y auditoría
========================================= */
function getOperatorTeam(name, date = getToday()) {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const entries = PLAN.equipos.flatMap((team) =>
    team.miembros.filter((m) => m.nombre === name).map((m) => ({ team, m })),
  );
  const current =
    entries.find(
      ({ m }) => (!m.desde || m.desde <= key) && (!m.hasta || m.hasta >= key),
    ) || entries[entries.length - 1];
  return current ? current.team.nombre : "Sin equipo";
}

function saveManagementData() {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(runtimeOverrides));
    localStorage.setItem(SWAPS_KEY, JSON.stringify(swapRequests));
    localStorage.setItem(AUDIT_KEY, JSON.stringify(auditLog.slice(0, 100)));
  } catch (error) {
    console.warn("No se pudo guardar la gestión local.", error);
  }
}

function loadManagementData() {
  try {
    runtimeOverrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "[]");
    swapRequests = JSON.parse(localStorage.getItem(SWAPS_KEY) || "[]");
    auditLog = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
  } catch (error) {
    runtimeOverrides = [];
    swapRequests = [];
    auditLog = [];
  }
}

function addAudit(message) {
  auditLog.unshift({ date: new Date().toISOString(), message });
  auditLog = auditLog.slice(0, 100);
  saveManagementData();
}

function renderManagementPanels() {
  const names = operators.map((o) => o.name);
  ["exceptionOperator", "swapFromOperator", "swapToOperator"].forEach((id) => {
    const select = $(id);
    if (!select) return;
    const previous = select.value;
    select.innerHTML = names
      .map(
        (name) =>
          `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`,
      )
      .join("");
    if (names.includes(previous)) select.value = previous;
  });
  const requests = $("swapRequests");
  if (requests) {
    requests.innerHTML = swapRequests.length
      ? swapRequests
          .map(
            (r) => `
      <div class="log-item">
        <div><strong>${escapeHTML(r.from)}</strong> ↔ <strong>${escapeHTML(r.to)}</strong><small>${escapeHTML(r.date)} · ${escapeHTML(r.status)}</small></div>
        ${r.status === "Pendiente" ? `<button class="secondary swap-approve" data-id="${r.id}" type="button">Marcar aprobada</button>` : ""}
      </div>`,
          )
          .join("")
      : '<p class="management-hint">No hay solicitudes pendientes.</p>';
    requests.querySelectorAll(".swap-approve").forEach((button) =>
      button.addEventListener("click", () => {
        const request = swapRequests.find((r) => r.id === button.dataset.id);
        if (!request) return;
        request.status = "Aprobada";
        addAudit(
          `Intercambio aprobado: ${request.from} ↔ ${request.to} (${request.date}). Registra los turnos resultantes en el formulario de cambios.`,
        );
        renderManagementPanels();
      }),
    );
  }
  const log = $("auditLog");
  if (log)
    log.innerHTML = auditLog.length
      ? auditLog
          .slice(0, 12)
          .map(
            (entry) =>
              `<div class="log-item"><span>${escapeHTML(entry.message)}</span><small>${new Date(entry.date).toLocaleString("es-ES")}</small></div>`,
          )
          .join("")
      : '<p class="management-hint">Todavía no hay modificaciones registradas.</p>';
  const overrides = $("overrideList");
  if (overrides) {
    overrides.innerHTML = runtimeOverrides.length
      ? runtimeOverrides
          .map(
            (item) =>
              `<div class="log-item"><span><strong>${escapeHTML(item.operator)}</strong><small>${escapeHTML(item.from)} → ${escapeHTML(item.to)} · ${escapeHTML(item.shift || "LIBRE")}</small></span><button class="danger override-delete" data-id="${item.id}" type="button">Eliminar</button></div>`,
          )
          .join("")
      : '<p class="management-hint">No hay cambios manuales.</p>';
    overrides.querySelectorAll(".override-delete").forEach((button) =>
      button.addEventListener("click", () => {
        const item = runtimeOverrides.find(
          (entry) => entry.id === button.dataset.id,
        );
        if (
          !item ||
          !confirm(
            `¿Eliminar el cambio de ${item.operator} (${item.from} a ${item.to})?`,
          )
        )
          return;
        runtimeOverrides = runtimeOverrides.filter(
          (entry) => entry.id !== item.id,
        );
        addAudit(
          `Se eliminó el cambio manual de ${item.operator} (${item.from} a ${item.to}).`,
        );
        render();
      }),
    );
  }
}

function validateSchedule() {
  const issues = [];
  const year = new Date().getFullYear();
  const monthIndex = new Date().getMonth();
  const totalDays = new Date(year, monthIndex + 1, 0).getDate();
  operators.forEach((op) => {
    let previousEnd = null;
    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, monthIndex, day);
      const code = getShiftForDate(date, op.row);
      if (!code || !SHIFTS[code]) continue;
      const [startHour, , endHour] = SHIFTS[code].time
        .match(/\d\d/g)
        .map(Number);
      const start = new Date(year, monthIndex, day, startHour);
      const end = new Date(year, monthIndex, day, endHour);
      if (endHour <= startHour) end.setDate(end.getDate() + 1);
      if (previousEnd) {
        const restHours = (start - previousEnd) / 3600000;
        if (restHours >= 0 && restHours < 11) {
          issues.push(
            `${op.name}: ${date.toLocaleDateString("es-ES")} · solo ${restHours.toFixed(1)} h entre turnos.`,
          );
        }
      }
      previousEnd = end;
    }
  });
  return issues;
}

function renderInsights() {
  const host = $("insightsContent");
  if (!host || !operators.length) return;
  const teams = PLAN.equipos.map((team) => ({
    name: team.nombre,
    people: team.miembros.filter(
      (member) =>
        operators.some((op) => op.name === member.nombre) &&
        getOperatorTeam(member.nombre) === team.nombre,
    ).length,
  }));
  const issues = validateSchedule();
  const currentMonth = months.find(
    (m) =>
      m.year === new Date().getFullYear() && m.index === new Date().getMonth(),
  );
  const monthLabel = currentMonth
    ? `${capitalize(currentMonth.name)} ${currentMonth.year}`
    : "Mes actual sin datos";
  host.innerHTML = `
    <div class="insight-cards">
      <article class="insight-card"><small>Personal</small><strong>${operators.length}</strong></article>
      <article class="insight-card"><small>Equipos</small><strong>${PLAN.equipos.length}</strong></article>
      <article class="insight-card"><small>Cambios manuales</small><strong>${runtimeOverrides.length}</strong></article>
      <article class="insight-card"><small>Solicitudes pendientes</small><strong>${swapRequests.filter((r) => r.status === "Pendiente").length}</strong></article>
    </div>
    <h4>Distribución por equipos · ${escapeHTML(monthLabel)}</h4>
    <div class="team-overview">${teams.map((t) => `<div class="team-chip"><strong>${escapeHTML(t.name)}</strong><span>${t.people} integrantes</span></div>`).join("")}</div>
    <h4>Comprobación de cobertura</h4>
    <p class="${issues.length ? "validation-warning" : "validation-ok"}">${issues.length ? `Se han detectado ${issues.length} posibles descansos inferiores a 11 horas. Revisa el detalle:` : "No se detectan descansos inferiores a 11 horas en el mes actual."}</p>
    ${
      issues.length
        ? `<details><summary>Ver incidencias (primeras 20)</summary><ul>${issues
            .slice(0, 20)
            .map((i) => `<li>${escapeHTML(i)}</li>`)
            .join("")}</ul></details>`
        : ""
    }
    <p class="management-hint">Aviso orientativo configurable: no es una certificación de cumplimiento legal. Comprueba siempre el convenio y las reglas aplicables.</p>`;
}

$("teamFilter")?.addEventListener("change", function () {
  selectedTeamFilter = this.value || "all";
  if (operators.length && !currentOperator) render();
});

$("exceptionForm")?.addEventListener("submit", function (event) {
  event.preventDefault();
  const operator = $("exceptionOperator").value;
  const from = $("exceptionFrom").value;
  const to = $("exceptionTo").value;
  const shift = $("exceptionShift").value;
  if (!operator || !from || !to || from > to)
    return alert("Comprueba el trabajador y el rango de fechas.");
  const item = { id: `${Date.now()}`, operator, from, to, shift };
  runtimeOverrides.push(item);
  addAudit(`${operator}: ${shift || "LIBRE"} del ${from} al ${to}.`);
  this.reset();
  render();
});

$("swapForm")?.addEventListener("submit", function (event) {
  event.preventDefault();
  const from = $("swapFromOperator").value;
  const to = $("swapToOperator").value;
  const date = $("swapDate").value;
  if (!date || !from || !to || from === to)
    return alert("Selecciona dos trabajadores distintos y una fecha.");
  swapRequests.unshift({
    id: `${Date.now()}`,
    from,
    to,
    date,
    status: "Pendiente",
  });
  addAudit(`Solicitud de intercambio: ${from} ↔ ${to} (${date}), pendiente.`);
  this.reset();
  renderManagementPanels();
  renderInsights();
});

const THEME_KEY = "turnos_operaciones_theme_v1";

/**
 * Activa o desactiva el modo oscuro (clase dark-mode en <body>) y recuerda la elección.
 */
function applyTheme(dark) {
  document.body.classList.toggle("dark-mode", dark);
  $("themeBtn").textContent = dark ? "☀️ Modo claro" : "🌙 Modo oscuro";
  $("themeBtn").setAttribute("aria-pressed", String(dark));
  try {
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch (error) {
    console.warn("No se pudo guardar el tema.", error);
  }
}

$("themeBtn").addEventListener("click", function () {
  applyTheme(!document.body.classList.contains("dark-mode"));
});

/* =========================================
         MVC: MODELO DE INFORMES
         Construye los datos del informe sin manipular el DOM.
      ========================================= */

const ReportModel = {
  /**
   * Meses (según filtros) y operadores (uno o todos) que entran en el informe.
   */
  getSelection() {
    const selectedMonths = getVisibleMonths();

    const selectedOperators = currentOperator
      ? [currentOperator]
      : [...operators];

    return { selectedMonths, selectedOperators };
  },

  /**
   * Construye la tabla del informe: filas DETALLE por día, RESUMEN por persona y mes, y totales.
   * Con `onlyMonth` genera solo ese mes (una hoja de Excel por mes).
   */
  buildRows(onlyMonth) {
    const selection = this.getSelection();
    const selectedMonths = onlyMonth ? [onlyMonth] : selection.selectedMonths;
    const selectedOperators = selection.selectedOperators;
    const output = [];
    const totals = this.createTotals();

    const headers = [
      "TIPO",
      "FECHA",
      "DIA",
      "MES",
      "AÑO",
      "OPERADOR",
      "CODIGO TURNO",
      "TURNO",
      "HORARIO",
      "CENTRO",
      "HORAS",
      "ESTADO",
      "MA",
      "ML",
      "TA",
      "TL",
      "NA",
      "NL",
      "ARTEIXO",
      "LARACHA",
      "LIBRES",
      "TOTAL DIAS",
    ];

    output.push(headers);

    selectedMonths.forEach((month) => {
      selectedOperators.forEach((operator) => {
        const monthData = getMonthData(month, operator.row);
        const operatorTotals = this.createTotals();

        [...monthData.entries()]
          .sort((a, b) => a[0] - b[0])
          .forEach(([day, code]) => {
            const date = new Date(month.year, month.index, day);
            const shift = code ? SHIFTS[code] : null;
            const worked = Boolean(shift);

            operatorTotals.totalDays++;
            if (worked) {
              operatorTotals[code]++;
              operatorTotals.hours += 8;
              if (code.endsWith("A")) operatorTotals.arteixo++;
              if (code.endsWith("L")) operatorTotals.laracha++;
            } else {
              operatorTotals.free++;
            }

            output.push([
              "DETALLE",
              date.toLocaleDateString("es-ES"),
              date.toLocaleDateString("es-ES", { weekday: "long" }),
              month.name,
              month.year,
              operator.name,
              code || "",
              shift?.name || "Día libre",
              shift?.time || "",
              shift ? (code.endsWith("A") ? "Arteixo" : "Laracha") : "",
              worked ? 8 : 0,
              worked ? "TRABAJADO" : "LIBRE",
              code === "MA" ? 1 : 0,
              code === "ML" ? 1 : 0,
              code === "TA" ? 1 : 0,
              code === "TL" ? 1 : 0,
              code === "NA" ? 1 : 0,
              code === "NL" ? 1 : 0,
              worked && code.endsWith("A") ? 1 : 0,
              worked && code.endsWith("L") ? 1 : 0,
              worked ? 0 : 1,
              1,
            ]);
          });

        this.addTotals(totals, operatorTotals);
        output.push([
          "RESUMEN",
          "",
          "",
          month.name,
          month.year,
          operator.name,
          "",
          "",
          "",
          "",
          operatorTotals.hours,
          "",
          operatorTotals.MA,
          operatorTotals.ML,
          operatorTotals.TA,
          operatorTotals.TL,
          operatorTotals.NA,
          operatorTotals.NL,
          operatorTotals.arteixo,
          operatorTotals.laracha,
          operatorTotals.free,
          operatorTotals.totalDays,
        ]);
      });
    });

    output.push([]);
    output.push(["RESUMEN ESTADISTICO"]);
    output.push(headers);

    selectedOperators.forEach((operator) => {
      const operatorTotals = this.createTotals();

      selectedMonths.forEach((month) => {
        const monthData = getMonthData(month, operator.row);
        monthData.forEach((code) => {
          operatorTotals.totalDays++;
          if (code && SHIFTS[code]) {
            operatorTotals[code]++;
            operatorTotals.hours += 8;
            if (code.endsWith("A")) operatorTotals.arteixo++;
            if (code.endsWith("L")) operatorTotals.laracha++;
          } else {
            operatorTotals.free++;
          }
        });
      });

      output.push([
        "RESUMEN",
        "",
        "",
        "",
        "",
        operator.name,
        "",
        "",
        "",
        "",
        operatorTotals.hours,
        "",
        operatorTotals.MA,
        operatorTotals.ML,
        operatorTotals.TA,
        operatorTotals.TL,
        operatorTotals.NA,
        operatorTotals.NL,
        operatorTotals.arteixo,
        operatorTotals.laracha,
        operatorTotals.free,
        operatorTotals.totalDays,
      ]);
    });

    output.push([
      "TOTAL GENERAL",
      "",
      "",
      "",
      "",
      "TODOS",
      "",
      "",
      "",
      "",
      totals.hours,
      "",
      totals.MA,
      totals.ML,
      totals.TA,
      totals.TL,
      totals.NA,
      totals.NL,
      totals.arteixo,
      totals.laracha,
      totals.free,
      totals.totalDays,
    ]);

    return { rows: output, selectedMonths, selectedOperators };
  },

  /**
   * Contadores a cero para los totales: turnos, centros, libres, horas y días.
   */
  createTotals() {
    return {
      MA: 0,
      ML: 0,
      TA: 0,
      TL: 0,
      NA: 0,
      NL: 0,
      arteixo: 0,
      laracha: 0,
      free: 0,
      hours: 0,
      totalDays: 0,
    };
  },

  /**
   * Suma los contadores de `source` en `target`.
   */
  addTotals(target, source) {
    Object.keys(target).forEach((key) => {
      target[key] += source[key] || 0;
    });
  },

  /**
   * Convierte filas a texto CSV (separador ;, con BOM para que Excel respete los acentos).
   */
  toCSV(rows) {
    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return "\uFEFF" + rows.map((row) => row.map(escape).join(";")).join("\r\n");
  },
};

/* =========================================
         MVC: VISTA DE INFORMES
         Se ocupa exclusivamente de presentar/descargar.
      ========================================= */

const ReportView = {
  /**
   * Crea y descarga el .xlsx con la librería SheetJS: una hoja por mes y "Resumen general".
   */
  downloadWorkbook(monthSheets, summaryRows, filename) {
    if (!window.XLSX) {
      alert(
        "No se ha podido cargar el generador de Excel. Comprueba tu conexión e inténtalo de nuevo.",
      );
      return;
    }

    const workbook = XLSX.utils.book_new();
    const usedNames = new Set();
    const uniqueSheetName = (rawName) => {
      const base =
        String(rawName || "Hoja")
          .replace(/[\\/?*\[\]:]/g, " ")
          .trim()
          .slice(0, 31) || "Hoja";
      let name = base;
      let suffix = 2;
      while (usedNames.has(name.toLowerCase())) {
        const ending = ` (${suffix++})`;
        name = base.slice(0, 31 - ending.length) + ending;
      }
      usedNames.add(name.toLowerCase());
      return name;
    };

    monthSheets.forEach(({ name, rows }) => {
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet["!cols"] = [
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 9 },
        { wch: 22 },
        { wch: 14 },
        { wch: 24 },
        { wch: 18 },
        { wch: 14 },
        { wch: 10 },
        { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(workbook, sheet, uniqueSheetName(name));
    });

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = Array.from({ length: 22 }, (_, index) => ({
      wch: index === 5 ? 24 : index === 7 ? 24 : 15,
    }));
    XLSX.utils.book_append_sheet(
      workbook,
      summarySheet,
      uniqueSheetName("Resumen general"),
    );
    XLSX.writeFile(workbook, filename);
  },
};

/* =========================================
         MVC: CONTROLADOR DE INFORMES
         Coordina modelo y vista ante la acción del usuario.
      ========================================= */

const ReportController = {
  /**
   * Orquesta el informe: pide los datos al modelo, ordena las hojas y le pasa el resultado a la vista.
   */
  export() {
    if (!operators.length) {
      alert("Primero debes cargar una planificación.");
      return;
    }

    const report = ReportModel.buildRows();
    // Una hoja independiente por cada mes del filtro.
    const monthSheets = report.selectedMonths.map((month) => ({
      name: `${month.name} ${month.year}`,
      rows: ReportModel.buildRows(month).rows,
    }));

    const monthLabel =
      report.selectedMonths.length === 1
        ? `${report.selectedMonths[0].name}_${report.selectedMonths[0].year}`
        : selectedYearFilter !== "all"
          ? `AÑO_${selectedYearFilter}`
          : "TODOS_LOS_MESES";
    const operatorLabel = currentOperator
      ? currentOperator.name
      : "TODOS_LOS_OPERADORES";
    const safe = (value) =>
      String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");

    ReportView.downloadWorkbook(
      monthSheets,
      report.rows,
      `INFORME_${safe(monthLabel)}_${safe(operatorLabel)}.xlsx`,
    );
  },
};

$("exportBtn").addEventListener("click", () => ReportController.export());

/**
 * Descarga un .ics con los turnos del operador elegido para importarlo en el calendario del móvil.
 * Usa horas "flotantes" (sin zona horaria): se interpretan en la hora local del dispositivo.
 * Si el turno acaba antes de empezar (noche), el evento termina al día siguiente.
 */
function exportICS() {
  if (!currentOperator) return;
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d, h) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}0000`;
  const slug = normalize(currentOperator.name).replace(/[^A-Z0-9]+/g, "-");
  const dtstamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Turnos Operaciones//ES",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:Turnos ${currentOperator.name}`,
  ];
  months.forEach((month) => {
    getMonthData(month, currentOperator.row).forEach((code, day) => {
      if (!code) return;
      const [startH, , endH] = SHIFTS[code].time.match(/\d\d/g).map(Number);
      const start = new Date(month.year, month.index, day);
      const end = new Date(start);
      if (endH <= startH) end.setDate(end.getDate() + 1);
      out.push(
        "BEGIN:VEVENT",
        `UID:${stamp(start, 0)}-${code}-${slug}@turnos`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${stamp(start, startH)}`,
        `DTEND:${stamp(end, endH)}`,
        `SUMMARY:${code} · ${SHIFTS[code].name}`,
        "END:VEVENT",
      );
    });
  });
  out.push("END:VCALENDAR");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([out.join("\r\n")], { type: "text/calendar;charset=utf-8" }),
  );
  a.download = `turnos_${slug}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("icsBtn").addEventListener("click", exportICS);

/* =========================================
   CAMBIAR AÑO
========================================= */

$("year").value = new Date().getFullYear();

$("year").addEventListener("change", function () {
  if (!currentOperator) return;

  if (getYear() < 2000 || getYear() > 2100) {
    alert("Introduce un año válido entre 2000 y 2100.");
    $("year").value = new Date().getFullYear();
  }

  detectMonths();
  selectedYearFilter = "all";
  selectedMonthFilter = "all";
  statsStartDate = "";
  statsEndDate = "";
  render();
});

/* =========================================
   BORRAR PLANIFICACIÓN
========================================= */

$("resetBtn").addEventListener("click", function () {
  const confirmDelete = confirm(
    "¿Quieres borrar la planificación guardada?\n\n" +
      "Tendrás que volver a cargar el CSV.",
  );

  if (!confirmDelete) return;

  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OPERATOR_KEY);
    localStorage.removeItem(YEAR_KEY);
  } catch (error) {
    console.error(error);
  }

  rows = [];
  months = [];
  operators = [];
  currentOperator = null;
  csvContent = "";

  $("csvFile").value = "";

  $("operator").innerHTML = '<option value="">Carga un CSV primero</option>';

  $("operator").disabled = true;
  $("todayBtn").disabled = true;
  $("printBtn").disabled = true;
  $("exportBtn").disabled = true;
  $("monthFilter").disabled = true;
  $("yearFilter").disabled = true;
  $("yearFilter").innerHTML = '<option value="all">Todos los años</option>';
  $("monthFilter").innerHTML =
    '<option value="all">Todos los meses disponibles</option>';
  selectedYearFilter = "all";
  selectedMonthFilter = "all";
  statsStartDate = "";
  statsEndDate = "";

  $("fileStatus").textContent = "Planificación borrada";

  updateStorageStatus(false);

  $("todayPanel").innerHTML = `
        <div class="empty-state">
            <div class="emoji">📂</div>
            <strong>Cargue un archivo CSV</strong>
            <p>Seleccione la planificación para consultar los turnos.</p>
        </div>
    `;

  $("nextPanel").innerHTML = `
        <h3 class="panel-title">📅 Próximos turnos</h3>
        <p>Esperando planificación...</p>
    `;

  $("statsPanel").innerHTML = `
        <h3 class="panel-title">📊 Resumen anual</h3>
        <p>Sin datos disponibles.</p>
    `;

  $("container").innerHTML = `
        <div class="panel empty-state">
            <div class="emoji">🗓️</div>
            El calendario aparecerá aquí.
        </div>
    `;
});

/* =========================================
   INICIO AUTOMÁTICO
========================================= */

/*
 * Arranque: genera `rows` desde el plan, detecta meses y operadores, activa los botones y dibuja.
 * Si js/plan.js tiene un error, se muestra en la barra de estado en lugar de dejar la página en blanco.
 */
(function init() {
  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    applyTheme(savedTheme === "dark");

    // Siempre utilizar el año actual al abrir la página.
    $("year").value = new Date().getFullYear();
  } catch (error) {
    console.warn(error);
  }

  try {
    loadManagementData();
    if (typeof bootAdminData === "function") bootAdminData();
    $("teamFilter").innerHTML =
      '<option value="all">Todos los equipos</option>' +
      PLAN.equipos
        .map(
          (t) =>
            `<option value="${escapeHTML(t.nombre)}">${escapeHTML(t.nombre)}</option>`,
        )
        .join("");
    rows = buildRowsFromPlan();
    $("year").value = new Date().getFullYear();
    detectMonths();
    fillOperators();
    selectCurrentMonthByDefault();

    $("todayBtn").disabled = false;
    $("printBtn").disabled = false;
    $("exportBtn").disabled = false;
    $("monthFilter").disabled = false;

    render();
    scrollToTodayAfterRender();

    watchShiftChange();
    if (typeof initAdmin === "function") initAdmin();

    $("fileStatus").textContent = "✓ Turnos generados desde el plan";
    updateStorageStatus(true, "● Plan de turnos cargado");
  } catch (error) {
    console.error("Error en js/plan.js:", error);
    $("fileStatus").textContent = "⚠ Error en js/plan.js: " + error.message;
  }
})();
