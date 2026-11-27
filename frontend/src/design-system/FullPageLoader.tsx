import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function FullPageLoader() {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex min-h-[50vh] items-center justify-center gap-2 text-ink/70">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      <span>{t("common.loading")}</span>
    </div>
  );
}
