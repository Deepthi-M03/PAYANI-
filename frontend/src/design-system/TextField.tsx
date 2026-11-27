import { forwardRef, useId, type InputHTMLAttributes } from "react";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

/** Labelled input with hint and error wired to aria-describedby for screen readers. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, className = "", ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-11 rounded-md border bg-surface px-3.5 text-base text-ink placeholder:text-muted ${
          error ? "border-error" : "border-steel focus:border-primary"
        }`}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink/70">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
});
