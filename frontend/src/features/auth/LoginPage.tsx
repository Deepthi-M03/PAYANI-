import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { TextField } from "../../design-system/TextField";
import { ApiError } from "../../lib/api";
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
        <Link to="/register" className="font-semibold text-primary underline underline-offset-4">
          {t("nav.register")}
        </Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:py-20">
      <h1 className="font-display text-3xl text-ink">{title}</h1>
      <p className="mt-2 text-ink/80">{intro}</p>
      <Card className="mt-8">{children}</Card>
    </div>
  );
}
