import { useTranslation } from "react-i18next";

import { LinkButton } from "../design-system/Button";
import { LogoMark } from "../design-system/Logo";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <LogoMark size={56} animated />
      <p className="mt-6 font-mono text-sm text-saffron-text">404 · Off the line</p>
      <h1 className="mt-2 font-display text-4xl">{t("common.notFoundTitle")}</h1>
      <p className="mt-4 text-muted">{t("common.notFoundBody")}</p>
      <LinkButton to="/" size="lg" className="mt-8">{t("common.backHome")}</LinkButton>
    </div>
  );
}
