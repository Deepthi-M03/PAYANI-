import { LogOut } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { Button } from "../design-system/Button";
import { motionTokens } from "../design-system/tokens";
import { useAuth } from "../features/auth/AuthContext";
import { api } from "../lib/api";

function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
    >
      {t("nav.skipToContent")}
    </a>
  );
}

function Wordmark() {
  return (
    <Link to="/" className="text-lg font-semibold tracking-[0.18em] text-white">
      PAYANI
    </Link>
  );
}

/** Public pages: navy header, native scrolling, no scroll effects. */
export function MarketingLayout() {
  const { t } = useTranslation();
  const { status } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-b-4 border-saffron bg-navy">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
        <Wordmark />
        <nav aria-label={t("nav.primary")} className="flex items-center gap-2">
          {status === "authenticated" ? (
            <Link to="/app" className="rounded bg-white px-5 py-2.5 text-sm font-semibold text-navy hover:bg-mist">
              {t("nav.dashboard")}
            </Link>
          ) : (
            <>
              <Link to="/login" className="rounded px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
                {t("nav.signIn")}
              </Link>
              <Link to="/register" className="rounded bg-white px-5 py-2.5 text-sm font-semibold text-navy hover:bg-mist">
                {t("nav.register")}
              </Link>
            </>
          )}
        </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-[1fr_auto]">
          <div>
            <p className="font-semibold tracking-[0.18em]">PAYANI</p>
            <p className="mt-2 max-w-xl text-white/80">{t("landing.footer")}</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-white/85">
            <a className="hover:text-white" href="https://www.irctc.co.in" rel="noopener noreferrer" target="_blank">IRCTC (official booking)</a>
            <a className="hover:text-white" href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer" target="_blank">Map data</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

const APP_LINKS = [
  ["/app", "nav.dashboard"], ["/app/search", "nav.search"], ["/app/bookings", "nav.bookings"],
  ["/app/groups", "nav.groups"], ["/app/pulse", "nav.pulse"], ["/app/connect", "nav.connect"],
  ["/app/intelligence", "nav.intelligence"],
] as const;

/** Passenger and admin application layout: native scroll, small Motion transitions only. */
export function AppLayout() {
  const { t } = useTranslation();
  const { user, can, logout } = useAuth();
  const { data: inbox } = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api<{ unread: number }>("/api/v1/notifications"),
    refetchInterval: 60_000,
  });
  const unread = inbox?.unread ?? 0;
  const location = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { duration, ease } = motionTokens;

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded px-3 py-2 text-sm font-medium ${isActive ? "bg-white/15 text-white shadow-[inset_0_-2px_0_var(--color-saffron)]" : "text-white/80 hover:bg-white/10 hover:text-white"}`;

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-b-4 border-saffron bg-navy">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Wordmark />
          <nav aria-label={t("nav.primary")} className="order-last -mx-1 flex w-full gap-1 overflow-x-auto pb-1 lg:order-none lg:w-auto lg:pb-0">
            {APP_LINKS.map(([to, key]) => (
              <NavLink key={to} to={to} end={to === "/app"} className={linkCls}>
                {t(key)}
                {to === "/app/pulse" && unread > 0 && (
                  <span className="ml-1.5 rounded-sm bg-saffron px-1.5 text-xs font-semibold text-navy">
                    {unread}<span className="sr-only"> unread</span>
                  </span>
                )}
              </NavLink>
            ))}
            {can("admin.access") && (
              <NavLink to="/app/admin" className={linkCls}>
                {t("nav.admin")}
              </NavLink>
            )}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-white/80 sm:inline">{user?.display_name}</span>
            <Button
              variant="ghost"
              className="!text-white hover:!bg-white/10"
              icon={<LogOut aria-hidden className="size-4" />}
              onClick={async () => {
                await logout();
                navigate("/", { replace: true });
              }}
            >
              {t("nav.signOut")}
            </Button>
          </div>
        </div>
      </header>
      {/* Enter-only page transition: Motion owns this element; nothing else animates it. */}
      <motion.main
        id="main"
        key={location.pathname}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-8"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.ui } }}
      >
        <Outlet />
      </motion.main>
    </div>
  );
}
