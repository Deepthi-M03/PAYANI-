import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "success" | "warning" | "error" | "info";

const config = {
  success: { icon: CheckCircle2, cls: "bg-success-tint text-success" },
  warning: { icon: AlertTriangle, cls: "bg-warning-tint text-warning" },
  error: { icon: XCircle, cls: "bg-error-tint text-error" },
  info: { icon: Info, cls: "bg-info-tint text-info" },
} as const;

/** Status message: colour + icon + words, never colour alone. Errors are announced. */
export function Alert({ tone, title, children }: { tone: Tone; title: string; children?: ReactNode }) {
  const { icon: Icon, cls } = config[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-md border border-current/15 p-4 ${cls}`}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="text-sm">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 text-ink/90">{children}</div>}
      </div>
    </div>
  );
}
