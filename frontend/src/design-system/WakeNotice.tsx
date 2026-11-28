import { Loader2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { getWakeState, subscribeWake } from "../lib/wake";

/** Explains the wait while a sleeping free-tier API starts. Renders nothing when it is awake. */
export function WakeNotice() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(subscribeWake, getWakeState, getWakeState);
  if (state !== "waking") return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 border-b-4 border-saffron bg-warning-tint px-4 py-3 text-sm text-ink shadow">
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin" />
        <p>
          <span className="font-semibold">{t("common.waking")}</span> {t("common.wakingBody")}
        </p>
      </div>
    </div>
  );
}
