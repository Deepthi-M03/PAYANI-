import { Clock, FlaskConical, Radio, Waves } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * How trustworthy a piece of railway information is. Every train time, status or
 * availability figure in PAYANI must render one of these next to it.
 */
export type Confidence = "simulated" | "scheduled" | "estimated" | "verified";

const config = {
  simulated: { icon: FlaskConical, cls: "bg-mist text-muted" },
  scheduled: { icon: Clock, cls: "bg-info-tint text-info" },
  estimated: { icon: Waves, cls: "bg-warning-tint text-warning" },
  verified: { icon: Radio, cls: "bg-success-tint text-success" },
} as const;

export function ConfidenceBadge({ level, asOf }: { level: Confidence; asOf?: string }) {
  const { t } = useTranslation();
  const { icon: Icon, cls } = config[level];
  const label = t(`confidence.${level}.label`);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-semibold ${cls}`}
      title={t(`confidence.${level}.description`)}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
      {asOf && <span className="font-normal">· {t("confidence.asOf", { date: asOf })}</span>}
    </span>
  );
}
