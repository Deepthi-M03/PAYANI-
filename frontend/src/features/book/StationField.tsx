import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";

import { api } from "../../lib/api";
import type { Station } from "../../lib/types";

/** Accessible station combobox: type a name or code, pick with arrows + Enter or click. */
export function StationField({ label, value, onChange, initialText }: { label: string; value: string; onChange: (code: string) => void; initialText?: string }) {
  const id = useId();
  const [text, setText] = useState(initialText ?? value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 150);
    return () => clearTimeout(t);
  }, [text]);
  const { data = [] } = useQuery({
    queryKey: ["stations", debounced],
    queryFn: () => api<Station[]>(`/api/v1/stations?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length > 0,
    staleTime: 60_000,
  });

  const choose = (s: Station) => {
    onChange(s.code);
    setText(`${s.name} (${s.code})`);
    setOpen(false);
  };

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open && data.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && data[active] ? `${id}-${data[active].code}` : undefined}
        autoComplete="off"
        value={text}
        placeholder="City, station or code"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          onChange("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, data.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && open && data[active]) {
            e.preventDefault();
            choose(data[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="min-h-12 w-full rounded-md border border-steel/70 bg-surface px-3.5 text-base transition-colors hover:border-steel focus:border-primary"
      />
      {open && data.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute top-full z-30 mt-1 w-full overflow-hidden rounded-md border border-line bg-surface py-1 shadow-[var(--shadow-raised)] motion-safe:animate-[rise_160ms_var(--ease-ui)]">
          {data.map((s, i) => (
            <li
              key={s.code}
              id={`${id}-${s.code}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-sm text-ink ${i === active ? "bg-ivory" : ""}`}
            >
              <span>
                {s.name}{s.state && <span className="text-muted"> · {s.state}</span>}
              </span>
              <span className="rounded bg-mist px-1.5 py-0.5 font-mono text-xs font-medium">{s.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
