import assert from "node:assert/strict";
import { germanDateToIso, pauseTextToMinutes, validateAdminTimeEntry } from "../public/admin-time-fix.js";

assert.equal(germanDateToIso("31.7.2026"), "2026-07-31");
assert.equal(germanDateToIso("01.08.2026"), "2026-08-01");
assert.equal(pauseTextToMinutes("1:30"), 90);
assert.equal(pauseTextToMinutes("0:00"), 0);

const valid = {
  userId: "user-1",
  date: "2026-07-31",
  start: "07:00",
  end: "16:00",
  pauseMinutes: 30,
  location: "Hannover",
  workArea: "GMB"
};
assert.equal(validateAdminTimeEntry(valid), "");
assert.equal(validateAdminTimeEntry({ ...valid, pauseMinutes: 600 }), "Die Pause muss kürzer als die Arbeitszeit sein.");
assert.equal(validateAdminTimeEntry({ ...valid, start: "22:00", end: "06:00", pauseMinutes: 30 }), "");
assert.equal(validateAdminTimeEntry({ ...valid, userId: "" }), "Bitte einen Mitarbeiter auswählen.");

console.log("Admin-Stundenzettel-Test erfolgreich");
