(() => {
  "use strict";

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const textOf = (node) => normalize(node?.textContent);
  const minutes = (value) => {
    const [hours, mins] = String(value || "").split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(mins) ? hours * 60 + mins : null;
  };

  const pageTitle = () => textOf(document.querySelector(".topbar h1, .employee-app main h1"));

  function ensureStatus(container, message, tone = "info") {
    if (!container) return null;
    let status = container.querySelector(":scope > .enhanced-inline-status");
    if (!status) {
      status = document.createElement("div");
      status.className = "enhanced-inline-status";
      status.setAttribute("role", tone === "error" ? "alert" : "status");
      status.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
      container.append(status);
    }
    status.dataset.tone = tone;
    status.textContent = message;
    return status;
  }

  function labelControl(form, matcher) {
    return [...form.querySelectorAll("label")]
      .find((label) => matcher.test(textOf(label)))
      ?.querySelector("input, select, textarea") || null;
  }

  function addFormSummary(form, content) {
    let summary = form.querySelector(".enhanced-form-summary");
    if (!summary) {
      summary = document.createElement("div");
      summary.className = "enhanced-form-summary";
      summary.setAttribute("role", "status");
      summary.setAttribute("aria-live", "polite");
      const submit = form.querySelector('button[type="submit"], .primary-button');
      (submit?.parentElement || form).insertBefore(summary, submit || null);
    }
    summary.innerHTML = content;
  }

  function enhanceAccessibility() {
    const tabs = document.querySelector(".auth-tabs");
    if (tabs) {
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "Zugang auswählen");
      tabs.querySelectorAll("button").forEach((button) => {
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(button.classList.contains("active")));
      });
    }

    document.querySelectorAll(".notice, .inline-notice, .form-notice").forEach((notice) => {
      const isError = notice.classList.contains("notice-error") || /fehler|nicht möglich/i.test(textOf(notice));
      notice.setAttribute("role", isError ? "alert" : "status");
      notice.setAttribute("aria-live", isError ? "assertive" : "polite");
    });

    const hamburger = document.querySelector(".hamburger-button");
    const sidebar = document.querySelector(".sidebar");
    if (hamburger && sidebar) {
      hamburger.setAttribute("aria-label", sidebar.classList.contains("menu-open") ? "Menü schließen" : "Menü öffnen");
      hamburger.setAttribute("aria-expanded", String(sidebar.classList.contains("menu-open")));
      hamburger.setAttribute("aria-controls", "portal-navigation");
      const drawer = sidebar.querySelector(".sidebar-drawer");
      if (drawer) {
        drawer.id = "portal-navigation";
        if (!drawer.querySelector(".enhanced-menu-close")) {
          const close = document.createElement("button");
          close.type = "button";
          close.className = "enhanced-menu-close";
          close.setAttribute("aria-label", "Menü schließen");
          close.textContent = "×";
          close.addEventListener("click", () => hamburger.click());
          drawer.prepend(close);
        }
      }
    }
  }

  function enhanceTables() {
    document.querySelectorAll("table:not([data-responsive-ready])").forEach((table) => {
      const headers = [...table.querySelectorAll("thead th")].map((th) => textOf(th) || "Angabe");
      table.querySelectorAll("tbody tr").forEach((row) => {
        [...row.children].forEach((cell, index) => {
          if (cell instanceof HTMLElement) cell.dataset.label = headers[index] || `Angabe ${index + 1}`;
        });
      });
      table.classList.add("enhanced-card-table");
      if (table.classList.contains("schedule-table") || /Wochenplan/i.test(textOf(table.closest(".panel")))) {
        table.classList.add("enhanced-schedule-table");
      }
      table.dataset.responsiveReady = "true";
    });
  }

  function enhanceShiftForm() {
    document.querySelectorAll("form.schedule-form:not([data-validation-ready])").forEach((form) => {
      form.dataset.validationReady = "true";
      const start = labelControl(form, /^Von\b/i);
      const end = labelControl(form, /^Bis\b/i);
      const update = () => {
        const from = minutes(start?.value);
        const to = minutes(end?.value);
        if (from === null || to === null) return;
        if (to <= from) {
          addFormSummary(form, "<strong>Bitte prüfen</strong> Das Dienstende muss nach dem Beginn liegen.");
          return;
        }
        const hours = ((to - from) / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 });
        addFormSummary(form, `<strong>Geplante Dauer</strong> ${hours} Stunden`);
      };
      start?.addEventListener("input", update);
      end?.addEventListener("input", update);
      update();
      form.addEventListener("submit", (event) => {
        const from = minutes(start?.value);
        const to = minutes(end?.value);
        if (from !== null && to !== null && to <= from) {
          event.preventDefault();
          event.stopImmediatePropagation();
          ensureStatus(form, "Das Dienstende muss nach dem Beginn liegen. Dienste über Mitternacht bitte als zwei Einträge erfassen.", "error");
          end?.focus();
        }
      }, true);
    });
  }

  function enhanceManualTimeForm() {
    document.querySelectorAll("form.manual-time-form:not([data-validation-ready])").forEach((form) => {
      form.dataset.validationReady = "true";
      const start = labelControl(form, /Arbeitsbeginn/i);
      const end = labelControl(form, /Arbeitsende/i);
      const pause = labelControl(form, /Pause in Minuten/i);
      const calculate = () => {
        const from = minutes(start?.value);
        const to = minutes(end?.value);
        const breakMinutes = Number(pause?.value || 0);
        if (from === null || to === null) return;
        const duration = to - from;
        if (duration <= 0) {
          addFormSummary(form, "<strong>Bitte prüfen</strong> Das Arbeitsende muss nach dem Beginn liegen.");
          return;
        }
        if (breakMinutes < 0 || breakMinutes >= duration) {
          addFormSummary(form, "<strong>Bitte prüfen</strong> Die Pause muss kürzer als die Arbeitszeit sein.");
          return;
        }
        const net = (duration - breakMinutes) / 60;
        addFormSummary(form, `<strong>Berechnete Nettozeit</strong> ${net.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Stunden`);
      };
      [start, end, pause].forEach((control) => {
        control?.addEventListener("input", calculate);
        control?.addEventListener("change", calculate);
      });
      calculate();
      form.addEventListener("submit", (event) => {
        const from = minutes(start?.value);
        const to = minutes(end?.value);
        const breakMinutes = Number(pause?.value || 0);
        const duration = from === null || to === null ? null : to - from;
        let message = "";
        if (duration !== null && duration <= 0) message = "Das Arbeitsende muss nach dem Beginn liegen.";
        else if (duration !== null && duration > 16 * 60) message = "Arbeitszeiten über 16 Stunden müssen von der Verwaltung geprüft werden.";
        else if (duration !== null && (breakMinutes < 0 || breakMinutes >= duration)) message = "Die Pause muss kürzer als die Arbeitszeit sein.";
        if (message) {
          event.preventDefault();
          event.stopImmediatePropagation();
          ensureStatus(form, message, "error");
        }
      }, true);
    });
  }

  function improveCopyAndSettings() {
    const replacements = new Map([
      ["Persönliche Firmendaten.", "Meine Mitarbeiterdaten."],
      ["Mitarbeiter-ID", "Personalnummer"],
      ["Freie Rollenauswahl", "Rollen- und Rechteverwaltung"],
      ["Noch keine Dienste eingetragen.", "Noch keine Dienste geplant. Bitte wende dich bei Fragen an deine Einsatzleitung."],
      ["Gesamt / Überstunden bei 160 Soll", "Geleistet / noch offen bei 160 Soll"]
    ]);
    document.querySelectorAll("h1, h2, h3, p, span, strong, dt").forEach((node) => {
      const replacement = replacements.get(textOf(node));
      if (replacement) node.textContent = replacement;
    });

    if (/Einstellungen/i.test(pageTitle())) {
      document.querySelectorAll(".panel").forEach((panel) => {
        const heading = panel.querySelector("h2");
        if (heading && textOf(heading) === "Arbeitsbereiche") panel.dataset.enhancedHidden = "true";
      });
      const securityPanel = [...document.querySelectorAll(".panel")]
        .find((panel) => /Sicherheit und Zugänge/i.test(textOf(panel.querySelector("h2"))));
      if (securityPanel && !securityPanel.querySelector(".enhanced-settings-note")) {
        const note = document.createElement("div");
        note.className = "enhanced-settings-note";
        note.innerHTML = "<strong>Standort und Aufbewahrung</strong>Der Standort wird ausschließlich beim Arbeitsbeginn übertragen. Für Zeit- und Standortdaten sollte die Firmenverwaltung eine verbindliche Löschfrist dokumentieren.";
        securityPanel.append(note);
      }
    }
  }

  function improveEmployeeFlow() {
    const panel = [...document.querySelectorAll(".employee-panel")]
      .find((item) => /Heutiger Dienst/i.test(textOf(item)));
    if (!panel) return;
    const unscheduled = /Kein Dienst|Noch kein Dienst/i.test(textOf(panel));
    const textarea = panel.querySelector("textarea");
    const buttons = [...panel.querySelectorAll("button")];
    const start = buttons.find((button) => /Arbeitsbeginn/i.test(textOf(button)));
    const pauseStart = buttons.find((button) => textOf(button) === "Pause starten");
    const pauseEnd = buttons.find((button) => textOf(button) === "Pause beenden");
    const end = buttons.find((button) => /Arbeitsende eintragen/i.test(textOf(button)));

    if (unscheduled && start && !start.dataset.unscheduledReady) {
      start.dataset.unscheduledReady = "true";
      start.addEventListener("click", (event) => {
        if (!normalize(textarea?.value)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          ensureStatus(panel, "Für einen ungeplanten Einsatz bitte zuerst einen kurzen Grund unter Bemerkung eintragen.", "error");
          textarea?.focus();
        }
      }, true);
    }

    if (start?.disabled && /gespeichert/i.test(textOf(start))) {
      start.dataset.flowHidden = "true";
      if (!panel.querySelector(".enhanced-location-note")) {
        const note = document.createElement("div");
        note.className = "enhanced-location-note";
        note.setAttribute("role", "status");
        note.textContent = unscheduled ? "Ungeplanter Einsatz läuft · Standort beim Start bestätigt" : "Arbeitszeit läuft · Standort beim Start bestätigt";
        start.insertAdjacentElement("afterend", note);
      }
    }

    [pauseStart, pauseEnd, end].forEach((button) => {
      if (button) button.dataset.flowHidden = String(button.disabled);
    });

    if (end && !end.dataset.confirmReady) {
      end.dataset.confirmReady = "true";
      end.addEventListener("click", (event) => {
        if (!window.confirm("Arbeitszeit jetzt wirklich beenden?")) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
  }

  function runEnhancements() {
    enhanceAccessibility();
    enhanceTables();
    enhanceShiftForm();
    enhanceManualTimeForm();
    improveCopyAndSettings();
    improveEmployeeFlow();
  }

  let scheduled = false;
  const scheduleEnhancements = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      runEnhancements();
    });
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const label = textOf(button);

    if (/^Löschen$|^×$/.test(label) && !button.classList.contains("enhanced-menu-close")) {
      if (!window.confirm("Diesen Eintrag wirklich löschen? Diese Aktion kann nicht automatisch rückgängig gemacht werden.")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }

    if (label === "Aktualisieren") {
      ensureStatus(button.parentElement, "Daten werden aktualisiert …", "info");
      window.setTimeout(() => ensureStatus(button.parentElement, "Daten wurden aktualisiert.", "success"), 900);
    }

    if (button.closest(".sidebar nav")) {
      window.setTimeout(() => {
        const sidebar = document.querySelector(".sidebar.menu-open");
        sidebar?.querySelector(".hamburger-button")?.click();
      }, 0);
    }
  }, true);

  const observer = new MutationObserver(scheduleEnhancements);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled"] });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleEnhancements);
  else scheduleEnhancements();
})();
