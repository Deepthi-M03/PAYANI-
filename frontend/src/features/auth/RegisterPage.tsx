import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { TextField } from "../../design-system/TextField";
import { ApiError } from "../../lib/api";
import { useAuth } from "./AuthContext";
import { AuthShell } from "./LoginPage";
import { registerSchema, type RegisterValues } from "./schemas";

export function RegisterPage() {
  const { t } = useTranslation();
  const { register: createAccount } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createAccount(values.email, values.password, values.display_name);
      navigate("/app", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.problem.errors?.length) {
        // Show server-side field errors next to the matching input.
        for (const e of err.problem.errors) {
          if (e.field === "email" || e.field === "password" || e.field === "display_name") {
            setError(e.field, { message: e.message });
          }
        }
        return;
      }
      setFormError(err instanceof ApiError ? err.problem.title : t("common.genericError"));
    }
  });

  // Zod messages are i18n keys; server messages are already sentences.
  const msg = (m?: string) => (m ? (m.startsWith("auth.") ? t(m) : m) : undefined);

  return (
    <AuthShell title={t("auth.registerTitle")} intro={t("auth.registerIntro")}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {formError && <Alert tone="error" title={formError} />}
        <TextField label={t("auth.displayName")} autoComplete="name" error={msg(errors.display_name?.message)} {...register("display_name")} />
        <TextField label={t("auth.email")} type="email" autoComplete="email" error={msg(errors.email?.message)} {...register("email")} />
        <TextField
          label={t("auth.password")}
          type="password"
          autoComplete="new-password"
          hint={t("auth.passwordHint")}
          error={msg(errors.password?.message)}
          {...register("password")}
        />
        <Button type="submit" loading={isSubmitting} className="mt-2 w-full">
          {t("auth.submitRegister")}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        {t("auth.haveAccount")}{" "}
        <Link to="/login" className="font-semibold text-primary underline underline-offset-4">
          {t("nav.signIn")}
        </Link>
      </p>
    </AuthShell>
  );
}
