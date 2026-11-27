import { z } from "zod";

/**
 * Client-side validation mirrors the API's rules (backend/payani/modules/identity/schemas.py).
 * Messages are i18n keys, translated where they are displayed.
 */
export const loginSchema = z.object({
  email: z.string().trim().email("auth.errors.emailInvalid"),
  password: z.string().min(1, "auth.errors.passwordRequired"),
});

export const registerSchema = z.object({
  display_name: z.string().trim().min(1, "auth.errors.nameRequired").max(80, "auth.errors.nameLong"),
  email: z.string().trim().email("auth.errors.emailInvalid"),
  password: z.string().min(12, "auth.errors.passwordShort").max(128, "auth.errors.passwordLong"),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
