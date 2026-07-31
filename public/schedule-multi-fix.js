(() => {
  "use strict";

  const markScheduleForms = (root = document) => {
    root.querySelectorAll?.("form.schedule-form:not([data-premium-conflicts])").forEach((form) => {
      form.dataset.premiumConflicts = "multi-position-enabled";

      const submit = form.querySelector('button[type="submit"], .primary-button');
      if (!submit || form.querySelector(".multi-position-note")) return;

      const note = document.createElement("div");
      note.className = "enhanced-inline-status multi-position-note";
      note.dataset.tone = "info";
      note.setAttribute("role", "status");
      note.textContent = "Mehrere Dienste und Stellen pro Mitarbeiter sind erlaubt. Nur ein exakt identischer Doppeleintrag wird verhindert.";
      submit.insertAdjacentElement("beforebegin", note);
    });
  };

  markScheduleForms();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.("form.schedule-form")) markScheduleForms(node.parentElement || document);
        else markScheduleForms(node);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__HABUN_MULTI_POSITION_RELEASE__ = "20260731-6";
})();
