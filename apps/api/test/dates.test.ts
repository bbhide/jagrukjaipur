import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, displayDate, occursOn, todayIST, weekendRange, weekday } from "../src/lib/dates.js";

const base = { end_date: null, is_recurring: false, recurrence_type: null, recurrence_days: [], recurrence_day_of_month: null } as const;

test("todayIST uses the Jaipur calendar day, not UTC", () => {
  assert.equal(todayIST(new Date("2026-11-16T19:00:00Z")), "2026-11-17"); // 00:30 IST
  assert.equal(todayIST(new Date("2026-11-17T18:29:00Z")), "2026-11-17"); // 23:59 IST
});

test("weekendRange picks the coming Saturday and Sunday", () => {
  assert.deepEqual(weekendRange("2026-11-17"), { friday: "2026-11-20", saturday: "2026-11-21", sunday: "2026-11-22" }); // Tuesday
  assert.equal(weekendRange("2026-11-21").saturday, "2026-11-21"); // on Saturday: this weekend
  assert.equal(weekendRange("2026-11-22").saturday, "2026-11-21"); // on Sunday: still this weekend
  assert.equal(weekendRange("2026-11-23").saturday, "2026-11-28"); // Monday: next one
});

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(weekday("2026-11-17"), 2);
});

test("a multi-day event occurs on every day of its range", () => {
  const e = { ...base, event_date: "2026-11-20", end_date: "2026-11-22" };
  assert.equal(occursOn(e, "2026-11-19"), false);
  assert.equal(occursOn(e, "2026-11-21"), true);
  assert.equal(occursOn(e, "2026-11-23"), false);
});

test("a weekly recurring event occurs only on its weekdays", () => {
  const e = { ...base, event_date: "2026-11-01", end_date: "2026-12-31", is_recurring: true, recurrence_type: "weekly" as const, recurrence_days: [0, 6] };
  assert.equal(occursOn(e, "2026-11-21"), true); // Saturday
  assert.equal(occursOn(e, "2026-11-20"), false); // Friday
  assert.equal(displayDate(e, "2026-11-17"), "2026-11-21"); // next occurrence from Tuesday
});

test("a monthly recurring event uses its day of month", () => {
  const e = { ...base, event_date: "2026-10-15", end_date: "2027-03-31", is_recurring: true, recurrence_type: "monthly" as const, recurrence_day_of_month: 15 };
  assert.equal(occursOn(e, "2026-12-15"), true);
  assert.equal(occursOn(e, "2026-12-16"), false);
  assert.equal(displayDate(e, "2026-11-17"), "2026-12-15");
});

test("a non-recurring event always displays its start date", () => {
  assert.equal(displayDate({ ...base, event_date: "2026-10-02", end_date: "2027-04-18" }, "2026-11-17"), "2026-10-02");
});
