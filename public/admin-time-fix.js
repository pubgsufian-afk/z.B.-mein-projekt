const RELEASE = "20260731-5";
const API_HEADERS = { "Content-Type": "application/json" };

export function germanDateToIso(value) {
  const match = String(value || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function pauseTextToMinutes(value) {
  const text = String(value || "").trim();
  if (/^\d+:\d{2}$/.test(text)) {
    const [hours, minutes] = text.split(":").map(Number);
    return hours * 60 + minutes;
  }
  const number = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

export function validateAdminTimeEntry(entry) {
  if (!entry.userId) return "Bitte einen Mitarbeiter auswählen.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date || "")) return "Bitte ein gültiges Datum auswählen.";
  if (!/^\d{2}:\d{2}$/.test(entry.start || "") || !/^\d{2}:\d{2}$/.test(entry.end || "")) {
    return "Bitte Beginn und Ende vollständig eintragen.";
  }
  const toMinutes = (value) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const start = toMinutes(entry.start);
  let end = toMinutes(entry.end);
  if (end <= start) end += 24 * 60;
  const pauseMinutes = Number(entry.pauseMinutes || 0);
  if (!Number.isFinite(pauseMinutes) || pauseMinutes < 0) return "Die Pause darf nicht negativ sein.";
  if (pauseMinutes >= end - start) return "Die Pause muss kürzer als die Arbeitszeit sein.";
  if (!String(entry.location || "").trim()) return "Bitte einen Einsatzort eintragen.";
  if (!String(entry.workArea || "").trim()) return "Bitte einen Arbeitsbereich eintragen.";
  return "";
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { ...API_HEADERS, ...(options.headers || {}) }
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data.message || text || `Anfrage fehlgeschlagen (${response.status}).`);
  return data;
}

function findTimesPanel() {
  return [...document.querySelectorAll("section.panel")].find((panel) => {
    const heading = normalize(panel.querySelector("h2")?.textContent);
    return heading === "Stundenzettel" && panel.querySelector('input[type="month"]') && panel.querySelector("select");
  }) || null;
}

function currentFilter(panel) {
  const select = panel.querySelector(".filters select");
  const month = panel.querySelector('.filters input[type="month"]');
  return { select, month };
}

function field(form, name) {
  return form.elements.namedItem(name);
}

function showMessage(container, message, tone = "success") {
  let notice = container.querySelector(":scope > .admin-time-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "admin-time-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    container.prepend(notice);
  }
  notice.dataset.tone = tone;
  notice.textContent = message;
}

function selectedDateForMonth(month) {
  const today = todayIso();
  return today.startsWith(`${month}-`) ? today : `${month}-01`;
}

function parseRow(row, userId) {
  const value = (label) => normalize(row.querySelector(`td[data-label="${label}"]`)?.textContent);
  return {
    userId,
    date: germanDateToIso(value("Datum")),
    start: value("Beginn").match(/\d{1,2}:\d{2}/)?.[0]?.padStart(5, "0") || "07:00",
    end: value("Ende").match(/\d{1,2}:\d{2}/)?.[0]?.padStart(5, "0") || "16:00",
    pauseMinutes: pauseTextToMinutes(value("Pause")),
    location: value("Einsatzort").replace(/^—$/, ""),
    workArea: value("Bereich").replace(/^—$/, ""),
    note: value("Bemerkung").replace(/^—$/, "")
  };
}

function makeForm() {
  const form = document.createElement("form");
  form.className = "admin-time-editor";
  form.hidden = true;
  form.innerHTML = `
    <div class="admin-time-editor-head">
      <div>
        <h3>Stundenzettel eintragen oder bearbeiten</h3>
        <p>Die Verwaltung kann Arbeitszeiten direkt erfassen und bestehende Angaben korrigieren.</p>
      </div>
      <button type="button" class="admin-time-close" aria-label="Formular schließen">×</button>
    </div>
    <div class="admin-time-grid">
      <label>Mitarbeiter<select name="userId" required></select></label>
      <label>Datum<input name="date" type="date" required></label>
      <label>Beginn<input name="start" type="time" value="07:00" required></label>
      <label>Ende<input name="end" type="time" value="16:00" required></label>
      <label>Pause in Minuten<input name="pauseMinutes" type="number" min="0" max="720" value="30" required></label>
      <label>Einsatzort<input name="location" required></label>
      <label>Arbeitsbereich<input name="workArea" list="admin-time-areas" required></label>
      <label class="admin-time-note">Bemerkung<input name="note"></label>
    </div>
    <datalist id="admin-time-areas"></datalist>
    <div class="admin-time-summary" role="status" aria-live="polite"></div>
    <div class="admin-time-buttons">
      <button type="submit" class="primary-button">Stundenzettel speichern</button>
      <button type="button" class="secondary-button admin-time-cancel">Abbrechen</button>
    </div>
  `;
  return form;
}

function refreshAdminTimesPage() {
  const navigationButtons = [...document.querySelectorAll(".sidebar nav button")];
  const overview = navigationButtons.find((button) => normalize(button.textContent) === "Übersicht");
  const times = navigationButtons.find((button) => normalize(button.textContent) === "Stundenzettel");
  if (overview && times) {
    overview.click();
    window.setTimeout(() => times.click(), 80);
    return;
  }
  window.location.reload();
}

async function install(panel) {
  if (panel.dataset.adminTimeReady === RELEASE) return;
  panel.dataset.adminTimeReady = RELEASE;

  const { select: filterSelect, month: filterMonth } = currentFilter(panel);
  if (!filterSelect || !filterMonth) return;

  const [registrationData, settingsData] = await Promise.all([
    request("/api/registrations"),
    request("/api/settings").catch(() => ({ areas: [] }))
  ]);
  const employees = [...(registrationData.employees || []), ...(registrationData.archived || [])]
    .filter((employee, index, all) => employee?.userId && all.findIndex((item) => item.userId === employee.userId) === index);
  const areas = settingsData.areas || [];

  const toolbar = document.createElement("div");
  toolbar.className = "admin-time-toolbar";
  toolbar.innerHTML = `
    <button type="button" class="primary-button admin-time-new">Neuen Stundenzettel eintragen</button>
    <p>Bestehende Einträge können direkt über „Bearbeiten“ korrigiert werden.</p>
  `;

  const form = makeForm();
  const employeeSelect = field(form, "userId");
  employeeSelect.innerHTML = employees.map((employee) =>
    `<option value="${employee.userId}">${normalize(employee.fullName)} · ${normalize(employee.employeeId || "ohne Personalnummer")}</option>`
  ).join("");
  form.querySelector("#admin-time-areas").innerHTML = areas.map((area) => `<option value="${normalize(area)}"></option>`).join("");

  const heading = panel.querySelector(".panel-heading");
  heading?.insertAdjacentElement("afterend", toolbar);
  toolbar.insertAdjacentElement("afterend", form);

  const summary = form.querySelector(".admin-time-summary");
  const updateSummary = () => {
    const start = String(field(form, "start").value || "");
    const end = String(field(form, "end").value || "");
    const pause = Number(field(form, "pauseMinutes").value || 0);
    if (!start || !end) return;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let duration = eh * 60 + em - (sh * 60 + sm);
    if (duration <= 0) duration += 24 * 60;
    const net = Math.max(0, duration - pause) / 60;
    summary.textContent = `Berechnete Nettozeit: ${net.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Stunden`;
  };
  ["start", "end", "pauseMinutes"].forEach((name) => field(form, name).addEventListener("input", updateSummary));

  const openForm = (values = {}) => {
    const selectedUserId = values.userId || filterSelect.value || employees[0]?.userId || "";
    const employee = employees.find((item) => item.userId === selectedUserId);
    employeeSelect.value = selectedUserId;
    field(form, "date").value = values.date || selectedDateForMonth(filterMonth.value || todayIso().slice(0, 7));
    field(form, "start").value = values.start || "07:00";
    field(form, "end").value = values.end || "16:00";
    field(form, "pauseMinutes").value = String(values.pauseMinutes ?? 30);
    field(form, "location").value = values.location || employee?.location || "";
    field(form, "workArea").value = values.workArea || areas[0] || "GMB";
    field(form, "note").value = values.note || "";
    form.hidden = false;
    form.dataset.mode = values.date ? "edit" : "create";
    form.querySelector("h3").textContent = values.date ? "Stundenzettel bearbeiten" : "Neuen Stundenzettel eintragen";
    form.querySelector('button[type="submit"]').textContent = values.date ? "Änderungen speichern" : "Stundenzettel speichern";
    updateSummary();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const closeForm = () => {
    form.hidden = true;
    form.reset();
  };

  toolbar.querySelector(".admin-time-new").addEventListener("click", () => openForm());
  form.querySelector(".admin-time-close").addEventListener("click", closeForm);
  form.querySelector(".admin-time-cancel").addEventListener("click", closeForm);
  employeeSelect.addEventListener("change", () => {
    const employee = employees.find((item) => item.userId === employeeSelect.value);
    if (employee?.location) field(form, "location").value = employee.location;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const employee = employees.find((item) => item.userId === employeeSelect.value);
    const entry = {
      userId: employeeSelect.value,
      date: field(form, "date").value,
      start: field(form, "start").value,
      end: field(form, "end").value,
      pauseMinutes: Number(field(form, "pauseMinutes").value || 0),
      location: normalize(field(form, "location").value),
      workArea: normalize(field(form, "workArea").value),
      note: normalize(field(form, "note").value)
    };
    const error = validateAdminTimeEntry(entry);
    if (error) {
      showMessage(form, error, "error");
      return;
    }
    if (!employee) {
      showMessage(form, "Die Mitarbeiterdaten konnten nicht geladen werden.", "error");
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Wird gespeichert …";
    try {
      await request("/api/work", {
        method: "POST",
        body: JSON.stringify({
          resource: "management-time",
          userId: employee.userId,
          fullName: employee.fullName,
          employeeId: employee.employeeId,
          ...entry
        })
      });
      showMessage(form, "Der Stundenzettel wurde gespeichert. Die Ansicht wird aktualisiert.", "success");
      window.setTimeout(refreshAdminTimesPage, 550);
    } catch (errorValue) {
      showMessage(form, `Speichern nicht möglich: ${errorValue instanceof Error ? errorValue.message : String(errorValue)}`, "error");
      submit.disabled = false;
      submit.textContent = form.dataset.mode === "edit" ? "Änderungen speichern" : "Stundenzettel speichern";
    }
  });

  const addQuickEditButtons = () => {
    panel.querySelectorAll("tbody tr").forEach((row) => {
      if (row.dataset.adminQuickEditReady === RELEASE) return;
      row.dataset.adminQuickEditReady = RELEASE;
      const firstCell = row.querySelector("td");
      if (!firstCell) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-time-quick-edit";
      button.textContent = "Bearbeiten";
      button.addEventListener("click", () => openForm(parseRow(row, filterSelect.value)));
      firstCell.append(button);
    });
  };

  addQuickEditButtons();
  const rowsObserver = new MutationObserver(addQuickEditButtons);
  rowsObserver.observe(panel, { childList: true, subtree: true });
}

function boot() {
  const tryInstall = () => {
    const panel = findTimesPanel();
    if (panel && panel.dataset.adminTimeReady !== RELEASE) {
      install(panel).catch((error) => {
        panel.dataset.adminTimeReady = "";
        console.error("Habun Admin-Time Fix", error);
      });
    }
  };
  tryInstall();
  const observer = new MutationObserver(tryInstall);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__HABUN_ADMIN_TIME_RELEASE__ = RELEASE;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
