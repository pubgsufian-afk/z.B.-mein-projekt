import assert from "node:assert/strict";

const normalize = (value) => String(value || "").trim().toLocaleLowerCase("de");
const isExactDuplicate = (candidate, entry) =>
  String(candidate.employeeUserId || "") === String(entry.employeeUserId || "")
  && candidate.date === entry.date
  && candidate.start === entry.start
  && candidate.end === entry.end
  && normalize(candidate.location) === normalize(entry.location)
  && normalize(candidate.workArea) === normalize(entry.workArea);

const base = {
  employeeUserId: "person-1",
  date: "2026-07-31",
  start: "17:00",
  end: "22:00",
  location: "Abbott",
  workArea: "Aufzugbediener",
};

assert.equal(isExactDuplicate(base, { ...base }), true, "Ein identischer Doppeleintrag muss gesperrt bleiben");
assert.equal(isExactDuplicate(base, { ...base, location: "Anderes Objekt" }), false, "Gleiche Uhrzeit an einer anderen Stelle muss erlaubt sein");
assert.equal(isExactDuplicate(base, { ...base, workArea: "Brandwache" }), false, "Gleiche Uhrzeit in einem anderen Arbeitsbereich muss erlaubt sein");
assert.equal(isExactDuplicate(base, { ...base, start: "07:00", end: "17:00" }), false, "Mehrere getrennte Dienste am selben Tag müssen erlaubt sein");
assert.equal(isExactDuplicate(base, { ...base, employeeUserId: "person-2" }), false, "Andere Mitarbeiter dürfen unabhängig geplant werden");

console.log("Dienstplan-Mehrfachstellen geprüft · 5 Regeln erfolgreich");
