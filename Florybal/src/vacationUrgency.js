const BUSINESS_TIME_ZONE = "America/Sao_Paulo";
const DAY_MS = 24 * 60 * 60 * 1000;

function isoParts(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function utcTime(value) {
  const parts = isoParts(value);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) : null;
}

function addCalendarMonths(value, months) {
  const parts = isoParts(value);
  if (!parts) return null;
  const lastDay = new Date(Date.UTC(parts.year, parts.month + months, 0)).getUTCDate();
  return Date.UTC(parts.year, parts.month - 1 + months, Math.min(parts.day, lastDay));
}

export function businessToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function classifyVacationUrgency(deadline, balanceDays, referenceDate = businessToday()) {
  if (Number(balanceDays || 0) <= 0) return { urgency: "Sem saldo", daysToDeadline: null };

  const deadlineTime = utcTime(deadline);
  const referenceTime = utcTime(referenceDate);
  if (deadlineTime === null || referenceTime === null) return { urgency: "No prazo", daysToDeadline: null };

  const daysToDeadline = Math.round((deadlineTime - referenceTime) / DAY_MS);
  if (daysToDeadline < 0) return { urgency: "Vencido", daysToDeadline };
  if (daysToDeadline <= 30) return { urgency: "At\u00e9 30 dias", daysToDeadline };

  const twoMonthLimit = addCalendarMonths(referenceDate, 2);
  if (twoMonthLimit !== null && deadlineTime <= twoMonthLimit) {
    return { urgency: "At\u00e9 2 meses", daysToDeadline };
  }
  return { urgency: "No prazo", daysToDeadline };
}
