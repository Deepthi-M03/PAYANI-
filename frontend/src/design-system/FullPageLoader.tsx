import { useTranslation } from "react-i18next";

import { LogoMark } from "./Logo";

/** Route-level loading state: the logo draws itself while the screen loads. */
export function FullPageLoader() {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted">
      <LogoMark size={40} animated />
      <span className="text-sm">{t("common.loading")}</span>
    </div>
  );
}
