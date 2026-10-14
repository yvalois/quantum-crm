import type { CalendarEvent } from "@quantum-crm/contracts";

export type CalendarView = "week" | "month";

export interface CalendarEventSegment {
  readonly event: CalendarEvent;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly column: number;
  readonly columns: number;
}

export function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function startOfWeek(value: Date): Date {
  const result = startOfLocalDay(value);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

export function calendarDays(anchor: Date, view: CalendarView): Date[] {
  const first =
    view === "week"
      ? startOfWeek(anchor)
      : startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const count =
    view === "week"
      ? 7
      : Math.ceil(
          (new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate() +
            ((new Date(anchor.getFullYear(), anchor.getMonth(), 1).getDay() + 6) % 7)) /
            7,
        ) * 7;
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(first);
    day.setDate(first.getDate() + index);
    return day;
  });
}

export function calendarRange(anchor: Date, view: CalendarView): { from: Date; to: Date } {
  const days = calendarDays(anchor, view);
  const to = new Date(days[days.length - 1]!);
  to.setDate(to.getDate() + 1);
  return { from: days[0]!, to };
}

export function localDayKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function moveCalendar(anchor: Date, view: CalendarView, offset: number): Date {
  const result = startOfLocalDay(anchor);
  if (view === "week") result.setDate(result.getDate() + offset * 7);
  else {
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + offset);
    result.setDate(
      Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()),
    );
  }
  return result;
}

export function dayEventSegments(events: CalendarEvent[], day: Date): CalendarEventSegment[] {
  const dayStart = startOfLocalDay(day).getTime();
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const entries = events
    .map((event) => ({
      event,
      startMinute: Math.max(0, (Date.parse(event.startsAt) - dayStart) / 60_000),
      endMinute: Math.min(1440, (Date.parse(event.endsAt) - dayStart) / 60_000),
      startsBeforeDay: Date.parse(event.startsAt) < dayStart,
      endsAfterDay: Date.parse(event.endsAt) > dayEnd,
    }))
    .filter((entry) => entry.endMinute > entry.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

  const result: CalendarEventSegment[] = [];
  let cluster: Array<(typeof entries)[number] & { column: number }> = [];
  let active: Array<{ column: number; endMinute: number }> = [];
  let clusterEnd = -1;
  const flush = (): void => {
    const columns = Math.max(1, ...cluster.map((entry) => entry.column + 1));
    result.push(
      ...cluster.map((entry) => ({
        event: entry.event,
        startMinute: entry.startMinute,
        endMinute: entry.endMinute,
        column: entry.column,
        columns,
      })),
    );
    cluster = [];
    active = [];
  };

  for (const entry of entries) {
    if (cluster.length && entry.startMinute >= clusterEnd) flush();
    active = active.filter((item) => item.endMinute > entry.startMinute);
    let column = 0;
    while (active.some((item) => item.column === column)) column += 1;
    cluster.push({ ...entry, column });
    active.push({ column, endMinute: entry.endMinute });
    clusterEnd = Math.max(clusterEnd, entry.endMinute);
  }
  if (cluster.length) flush();
  return result;
}
