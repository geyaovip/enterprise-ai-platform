// Adapted from yingchuan-formal-ui f52ca56, 2026-11-07.
import { BadRequestException } from "@nestjs/common";
/** Wall-clock scheduling also handles DST gaps and repeated hours. Stored instants are UTC. */
export function nextMonitoringAt(
  input: {
    frequency: "daily" | "weekly";
    hour: number;
    minute: number;
    weekday: number;
    timezone: string;
  },
  after: Date,
): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < 9 * 1440; i++) {
    const instant = new Date(start + i * 60_000);
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    if (
      Number(parts.hour) === input.hour &&
      Number(parts.minute) === input.minute &&
      (input.frequency === "daily" || parts.weekday === weekdays[input.weekday])
    )
      return instant;
  }
  throw new BadRequestException("监测时间无效");
}
