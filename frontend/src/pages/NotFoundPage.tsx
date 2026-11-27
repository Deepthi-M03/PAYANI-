import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="font-display text-4xl">{t("common.notFoundTitle")}</h1>
      <p className="mt-4 text-ink/80">{t("common.notFoundBody")}</p>
      <Link to="/" className="mt-8 inline-flex min-h-11 items-center rounded-full bg-primary px-6 font-semibold text-white hover:bg-primary-hover">
        {t("common.backHome")}
      </Link>
    </div>
  );
}
