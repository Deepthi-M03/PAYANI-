const IST = "Asia/Kolkata";

export function rupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

export function time(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST }).format(new Date(iso));
}

export function day(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST }).format(new Date(iso));
}

export function dateTime(iso: string): string {
  return `${day(iso)}, ${time(iso)}`;
}

export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Days after the departure day that the arrival falls on (+1, +2), in IST. */
export function dayShift(depIso: string, arrIso: string): number {
  const d = (iso: string) => new Date(new Date(iso).toLocaleString("en-US", { timeZone: IST })).setHours(0, 0, 0, 0);
  return Math.round((d(arrIso) - d(depIso)) / 86_400_000);
}

export function todayIso(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SEARCHED: "Awaiting payment",
  PENDING_CONFIRMATION: "Confirming",
  CONFIRMED: "Confirmed (sandbox)",
  FAILED: "Failed",
  CANCELLATION_REQUESTED: "Cancelling",
  CANCELLED: "Cancelled",
  REFUND_PENDING: "Refund pending",
  REFUNDED: "Refunded",
};

export const AGE_BANDS = [
  { value: "adult_18_59", label: "Adult (18–59)" },
  { value: "senior_60_plus", label: "Senior (60+)" },
  { value: "teen_12_17", label: "Teen (12–17)" },
  { value: "child_5_11", label: "Child (5–11)" },
] as const;

export const CLASSES = [
  { value: "SL", label: "Sleeper (SL)" },
  { value: "3A", label: "AC 3 Tier (3A)" },
  { value: "2A", label: "AC 2 Tier (2A)" },
  { value: "1A", label: "AC First (1A)" },
] as const;
