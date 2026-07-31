(() => {
  "use strict";

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const text = (node) => normalize(node?.textContent);
  const escapeHtml = (value) => String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const navButtons = () => [...document.querySelectorAll(".sidebar nav button")];
  const navigate = (label) => {
    const target = navButtons().find((button) => text(button) === label);
    target?.click();
  };

  function currentAdminPage() {
    return text(document.querySelector(".topbar h1"));
  }

  function addOverviewActions() {
    if (currentAdminPage() !== "Übersicht") return;
    const metrics = document.querySelector(".metric-strip");
    if (!metrics || document.querySelector(".premium-overview-actions")) return;

    const section = document.createElement("section");
    section.className = "premium-overview-actions";
    section.setAttribute("aria-label", "Schnellaktionen");
    section.innerHTML = `
      <div>
        <h2>Schnell erledigt</h2>
        <p>Die wichtigsten Verwaltungsaufgaben direkt öffnen.</p>
      </div>
      <div class="premium-action-buttons">
        <button type="button" data-page="Dienstplan">+ Dienst eintragen</button>
        <button type="button" data-page="Mitarbeiter">Mitarbeiter prüfen</button>
        <button type="button" data-page="Stundenzettel">Zeiten freigeben</button>
        <button type="button" data-page="Berichte">Bericht erstellen</button>
      </div>`;
    section.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-page]");
      if (button) navigate(button.dataset.page);
    });
    metrics.insertAdjacentElement("afterend", section);
  }

  function addEmployeeTools() {
    if (currentAdminPage() !== "Mitarbeiter") return;
    const panel = [...document.querySelectorAll(".panel")]
      .find((item) => /Freigeschaltete Mitarbeiter/i.test(text(item.querySelector("h2"))));
    const table = panel?.querySelector("table");
    if (!panel || !table || panel.querySelector(".premium-table-tools")) return;

    const tools = document.createElement("div");
    tools.className = "premium-table-tools";
    tools.innerHTML = `
      <label class="premium-search-wrap">
        <span class="sr-only">Mitarbeiter suchen</span>
        <input type="search" placeholder="Name, Personalnummer oder Einsatzort suchen" autocomplete="off" />
      </label>
      <label>
        <span class="sr-only">Rolle filtern</span>
        <select>
          <option value="">Alle Rollen</option>
          <option value="Mitarbeiter">Mitarbeiter</option>
          <option value="Einsatzleiter">Einsatzleiter</option>
          <option value="Admin">Admin</option>
          <option value="Chef">Chef / Hauptadmin</option>
        </select>
      </label>
      <div class="premium-filter-result" role="status" aria-live="polite"></div>`;
    const heading = panel.querySelector(".panel-heading");
    heading?.insertAdjacentElement("afterend", tools);

    const input = tools.querySelector("input");
    const select = tools.querySelector("select");
    const result = tools.querySelector(".premium-filter-result");
    const filter = () => {
      const query = normalize(input.value).toLocaleLowerCase("de");
      const role = select.value.toLocaleLowerCase("de");
      const rows = [...table.querySelectorAll("tbody tr")];
      let visible = 0;
      rows.forEach((row) => {
        const content = text(row).toLocaleLowerCase("de");
        const show = (!query || content.includes(query)) && (!role || content.includes(role));
        row.hidden = !show;
        if (show) visible += 1;
      });
      result.textContent = `${visible} von ${rows.length} Konten angezeigt`;
    };
    input.addEventListener("input", filter);
    select.addEventListener("change", filter);
    filter();
  }

  function mobileRosterSignature(table) {
    return [...table.querySelectorAll("tbody tr")]
      .map((row) => text(row))
      .join("|");
  }

  function addMobileRoster() {
    const table = document.querySelector(".schedule-table");
    const scroll = table?.closest(".roster-scroll, .table-scroll");
    if (!table || !scroll) return;
    let mobile = scroll.parentElement.querySelector(":scope > .premium-mobile-roster");
    if (!mobile) {
      mobile = document.createElement("div");
      mobile.className = "premium-mobile-roster";
      scroll.insertAdjacentElement("afterend", mobile);
    }

    const signature = mobileRosterSignature(table);
    if (mobile.dataset.signature === signature) return;
    mobile.dataset.signature = signature;

    const headers = [...table.querySelectorAll("thead th")];
    const rows = [...table.querySelectorAll("tbody tr")];
    const dayIndexes = headers
      .map((header, index) => ({ index, label: text(header) }))
      .filter(({ label, index }) => index > 0 && /\b\d{1,2}\.\d{1,2}\.|Mo|Di|Mi|Do|Fr|Sa|So/i.test(label))
      .slice(0, 7);
    if (!dayIndexes.length) return;

    const selected = Math.min(Number(mobile.dataset.dayIndex || 0), dayIndexes.length - 1);
    const summary = document.createElement("div");
    summary.className = "premium-roster-summary";
    summary.setAttribute("role", "tablist");

    dayIndexes.forEach((day, dayPosition) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = dayPosition === selected ? "active" : "";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(dayPosition === selected));
      const parts = day.label.split(/\s+/);
      button.innerHTML = `<strong>${escapeHtml(parts[0] || day.label)}</strong><span>${escapeHtml(parts.slice(1).join(" "))}</span>`;
      button.addEventListener("click", () => {
        mobile.dataset.dayIndex = String(dayPosition);
        mobile.dataset.signature = "";
        addMobileRoster();
      });
      summary.append(button);
    });

    const list = document.createElement("div");
    list.className = "premium-roster-day";
    const day = dayIndexes[selected];
    let shiftCount = 0;

    rows.forEach((row) => {
      const cells = [...row.children];
      const employeeCell = cells[0];
      const dayCell = cells[day.index];
      if (!employeeCell || !dayCell) return;
      const employee = text(employeeCell.querySelector("strong")) || text(employeeCell).split(/\s{2,}/)[0];
      const employeeMeta = text(employeeCell.querySelector("small"));
      const shifts = [...dayCell.querySelectorAll(".shift-block")];

      shifts.forEach((shift) => {
        shiftCount += 1;
        const sourceButtons = [...shift.querySelectorAll("button")];
        const rawLines = normalize(shift.innerText).split(/(?=Bearbeiten|Löschen)/)[0];
        const timeMatch = rawLines.match(/\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/);
        const detailNodes = [...shift.children]
          .filter((node) => !node.classList.contains("shift-actions"))
          .map((node) => text(node))
          .filter((value) => value && !timeMatch?.[0]?.includes(value));

        const card = document.createElement("article");
        card.className = "premium-roster-card";
        card.innerHTML = `
          <div class="premium-roster-card-head">
            <div><strong>${escapeHtml(employee || "Mitarbeiter")}</strong><span>${escapeHtml(employeeMeta || day.label)}</span></div>
            <div class="premium-roster-time">${escapeHtml(timeMatch?.[0] || "Dienst")}</div>
          </div>
          <div class="premium-roster-details"></div>
          <div class="premium-roster-actions"></div>`;
        const details = card.querySelector(".premium-roster-details");
        detailNodes.slice(0, 3).forEach((value) => {
          const item = document.createElement("span");
          item.textContent = value;
          details.append(item);
        });
        const actions = card.querySelector(".premium-roster-actions");
        sourceButtons.forEach((source) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = text(source);
          if (/Löschen/i.test(text(source))) button.dataset.danger = "true";
          button.addEventListener("click", () => source.click());
          actions.append(button);
        });
        list.append(card);
      });

      const addSource = [...dayCell.querySelectorAll("button")].find((button) => /Weiterer Dienst|Dienst/i.test(text(button)));
      if (!shifts.length && addSource) {
        const empty = document.createElement("article");
        empty.className = "premium-roster-card";
        empty.innerHTML = `
          <div class="premium-roster-card-head"><div><strong>${escapeHtml(employee)}</strong><span>${escapeHtml(employeeMeta || day.label)}</span></div></div>
          <div class="premium-roster-actions"><button type="button">+ Dienst eintragen</button></div>`;
        empty.querySelector("button").addEventListener("click", () => addSource.click());
        list.append(empty);
      }
    });

    if (!shiftCount && !list.children.length) {
      list.innerHTML = `<div class="premium-roster-empty">Für ${escapeHtml(day.label)} sind noch keine Dienste geplant.</div>`;
    }
    mobile.replaceChildren(summary, list);
  }

  function addScheduleConflictCheck() {
    document.querySelectorAll("form.schedule-form:not([data-premium-conflicts])").forEach((form) => {
      form.dataset.premiumConflicts = "true";
      const submitLabel = text(form.querySelector('button[type="submit"], .primary-button'));
      if (/Änderung|Aktualisieren/i.test(submitLabel)) return;
      const controls = [...form.querySelectorAll("label")];
      const find = (pattern) => controls.find((label) => pattern.test(text(label)))?.querySelector("input, select, textarea");
      const employee = find(/^Mitarbeiter/i);
      const date = find(/^Datum/i);
      const start = find(/^Von/i);
      const end = find(/^Bis/i);
      let conflict = false;
      let checkToken = 0;

      const status = document.createElement("div");
      status.className = "enhanced-inline-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.hidden = true;
      const submit = form.querySelector('button[type="submit"], .primary-button');
      submit?.insertAdjacentElement("beforebegin", status);

      const check = async () => {
        const token = ++checkToken;
        conflict = false;
        status.hidden = true;
        if (!employee?.value || !date?.value || !start?.value || !end?.value) return;
        try {
          const response = await fetch("/api/work?resource=schedule", { credentials: "same-origin" });
          if (!response.ok) return;
          const payload = await response.json();
          if (token !== checkToken) return;
          const overlaps = (payload.entries || []).some((entry) =>
            String(entry.employeeUserId) === String(employee.value)
            && entry.date === date.value
            && entry.start < end.value
            && entry.end > start.value
          );
          conflict = overlaps;
          if (overlaps) {
            status.hidden = false;
            status.dataset.tone = "error";
            status.textContent = "Achtung: Für diesen Mitarbeiter überschneidet sich bereits ein Dienst an diesem Tag.";
          }
        } catch {
          // Die vorhandene Serversicherung bleibt maßgeblich, falls der Vorabcheck nicht erreichbar ist.
        }
      };

      [employee, date, start, end].forEach((control) => {
        control?.addEventListener("change", check);
        control?.addEventListener("input", check);
      });
      form.addEventListener("submit", (event) => {
        if (!conflict) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        status.hidden = false;
        status.dataset.tone = "error";
        status.textContent = "Der Dienst wurde nicht gespeichert, weil sich die Uhrzeit mit einem vorhandenen Dienst überschneidet.";
        start?.focus();
      }, true);
      check();
    });
  }

  function addAdminMobileNav() {
    if (!document.querySelector(".app-shell") || document.querySelector(".premium-mobile-nav")) return;
    const nav = document.createElement("nav");
    nav.className = "premium-mobile-nav";
    nav.setAttribute("aria-label", "Schnellnavigation");
    const items = [
      ["Übersicht", "Start"],
      ["Dienstplan", "Plan"],
      ["Stundenzettel", "Zeiten"],
      ["Menü", "Menü"]
    ];
    items.forEach(([page, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.page = page;
      button.addEventListener("click", () => {
        if (page === "Menü") document.querySelector(".hamburger-button")?.click();
        else navigate(page);
      });
      nav.append(button);
    });
    document.querySelector(".app-shell").append(nav);
  }

  function syncAdminMobileNav() {
    const page = currentAdminPage();
    document.querySelectorAll(".premium-mobile-nav button").forEach((button) => {
      const active = button.dataset.page === page;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function addEmployeeClockStatus() {
    const app = document.querySelector(".employee-app");
    const card = app?.querySelector(".shift-card");
    if (!app || !card || card.querySelector(".premium-clock-status")) return;
    const buttons = [...card.querySelectorAll("button")];
    const start = buttons.find((button) => /Arbeitsbeginn/i.test(text(button)));
    const pauseStart = buttons.find((button) => text(button) === "Pause starten");
    const pauseEnd = buttons.find((button) => text(button) === "Pause beenden");
    const end = buttons.find((button) => /Arbeitsende/i.test(text(button)));
    let label = "Noch nicht gestartet";
    if (pauseEnd && !pauseEnd.disabled) label = "Pause läuft";
    else if (end && !end.disabled) label = "Arbeitszeit läuft";
    else if (start?.disabled && /gespeichert/i.test(text(start))) label = "Arbeitszeit läuft";
    else if (start?.disabled && end?.disabled) label = "Heute beendet";

    const status = document.createElement("div");
    status.className = "premium-clock-status";
    status.innerHTML = `
      <span>Aktueller Status</span>
      <strong>${label}</strong>
      <small>${label === "Noch nicht gestartet" ? "Beim Start wird der Standort einmalig bestätigt." : "Der nächste verfügbare Schritt ist hervorgehoben."}</small>`;
    const head = card.querySelector(".shift-card-head");
    head?.insertAdjacentElement("afterend", status);

    [start, pauseStart, pauseEnd, end].forEach((button) => {
      if (!button || button.disabled) return;
      button.dataset.nextAction = "true";
    });
  }

  function addEmployeeProfileNote() {
    const profile = document.querySelector(".employee-panel.profile-list");
    if (!profile || profile.querySelector(".premium-profile-note")) return;
    const note = document.createElement("div");
    note.className = "premium-profile-note";
    note.textContent = "Diese Angaben sind nur im geschützten Mitarbeiterportal sichtbar. Änderungen nimmt die Verwaltung vor.";
    profile.append(note);
  }

  function markBodyState() {
    document.body.dataset.portalView = document.querySelector(".employee-app") ? "employee" : document.querySelector(".app-shell") ? "admin" : "public";
  }

  function restoreRequestedPage() {
    const requested = sessionStorage.getItem("habun-main-page");
    if (!requested || !navButtons().length) return;
    sessionStorage.removeItem("habun-main-page");
    navigate(requested);
  }

  function enhance() {
    markBodyState();
    restoreRequestedPage();
    addOverviewActions();
    addEmployeeTools();
    addMobileRoster();
    addScheduleConflictCheck();
    addAdminMobileNav();
    syncAdminMobileNav();
    addEmployeeClockStatus();
    addEmployeeProfileNote();
  }

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance();
    });
  };

  const observer = new MutationObserver(queue);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled"] });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", queue);
  else queue();
})();
