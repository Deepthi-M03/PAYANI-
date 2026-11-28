import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { LogoMark } from "../../design-system/Logo";
import { TextField } from "../../design-system/TextField";
import { ApiError } from "../../lib/api";
import { Scene } from "../../pages/landing/Scenes";
import { useAuth } from "./AuthContext";
import { loginSchema, type LoginValues } from "./schemas";

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith("/app") ? from : "/app", { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.problem.title : t("common.genericError"));
    }
  });

  return (
    <AuthShell title={t("auth.signInTitle")} intro={t("auth.signInIntro")}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {formError && <Alert tone="error" title={formError} />}
        <TextField
          label={t("auth.email")}
          type="email"
          autoComplete="email"
          error={errors.email && t(errors.email.message ?? "")}
          {...register("email")}
        />
        <TextField
          label={t("auth.password")}
          type="password"
          autoComplete="current-password"
          error={errors.password && t(errors.password.message ?? "")}
          {...register("password")}
        />
        <Button type="submit" loading={isSubmitting} className="mt-2 w-full">
          {t("auth.submitSignIn")}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        {t("auth.noAccount")}{" "}
        <Link to="/register" className="font-semibold text-signal underline underline-offset-4">
          {t("nav.register")}
        </Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside aria-hidden className="relative hidden overflow-hidden bg-navy lg:block">
        <Scene kind="ghats" alt="" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 p-12 text-white">
          <LogoMark size={44} tone="light" animated />
          <p className="max-w-md text-3xl font-semibold leading-tight tracking-[-0.015em]">Plan the trip once. Bring everyone along.</p>
          <p className="max-w-md text-white/70">Group bookings, clear routes and reminders, in one place.</p>
        </div>
      </aside>
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-md motion-safe:animate-[rise_500ms_var(--ease-ui)_both]">
          <h1 className="font-display text-3xl text-ink">{title}</h1>
          <p className="mt-2 text-muted">{intro}</p>
          <Card className="mt-8">{children}</Card>
        </div>
      </div>
    </div>
  );
}
