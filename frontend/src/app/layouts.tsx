import { useQuery } from "@tanstack/react-query";
import {
  BellRing, ChartLine, LayoutDashboard, LogOut, Menu, MessagesSquare, ReceiptIndianRupee, Search, ShieldCheck, Ticket, Users, X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { Logo } from "../design-system/Logo";
import { motionTokens } from "../design-system/tokens";
import { useAuth } from "../features/auth/AuthContext";
import { api } from "../lib/api";

function SkipLink() {
  const { t } = useTranslation();
  return (
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:font-semibold focus:text-navy">
      {t("nav.skipToContent")}
    </a>
  );
}

/** The logo as a home link. Animates once when the public site first loads. */
export function Wordmark({ to = "/", tone = "light", animated = false }: { to?: string; tone?: "light" | "dark"; animated?: boolean }) {
  return (
    <Link to={to} className="inline-flex rounded-md transition-opacity hover:opacity-90" aria-label="PAYANI home">
      <Logo tone={tone} size={30} animated={animated} />
    </Link>
  );
}

/** Public pages: navy header, native scrolling, multi-column footer. */
export function MarketingLayout() {
  const { t } = useTranslation();
  const { status } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      <SkipLink />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-navy/95 backdrop-blur supports-[backdrop-filter]:bg-navy/85">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-8 px-4 sm:px-6">
          <Wordmark animated />
          <nav aria-label="Sections" className="hidden items-center gap-1 text-sm text-white/75 md:flex">
            {[["#planner", "Journey planner"], ["#network", "Network map"], ["#groups", "Group booking"], ["#trust", "Trust & data"]].map(([href, label]) => (
              <a key={href} href={href} className="rounded-md px-3 py-2 transition-colors hover:bg-white/10 hover:text-white">{label}</a>
            ))}
          </nav>
          <nav aria-label={t("nav.primary")} className="ml-auto flex items-center gap-2">
            {status === "authenticated" ? (
              <Link to="/app" className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-mist">{t("nav.dashboard")}</Link>
            ) : (
              <>
                <Link to="/login" className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10">{t("nav.signIn")}</Link>
                <Link to="/register" className="whitespace-nowrap rounded-md bg-white px-3 py-2 text-sm font-semibold text-navy transition-colors hover:bg-mist sm:px-4">{t("nav.register")}</Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-navy text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="flex flex-col gap-4">
            <Wordmark />
            <p className="max-w-sm text-sm leading-relaxed text-white/70">
              Group rail journey planning for India. {t("landing.footer")}
            </p>
          </div>
          <FooterCol title="Product" links={[["/register", "Journey planner"], ["/register", "Group booking"], ["/register", "Pulse reminders"], ["/register", "Intelligence"]]} />
          <FooterCol title="Trust" links={[["#trust", "How data is labelled"], ["#privacy", "Privacy and safety"], ["https://www.openstreetmap.org/copyright", "Map data licence"]]} />
          <FooterCol title="Official" links={[["https://www.irctc.co.in", "IRCTC ticket booking"], ["https://indianrailways.gov.in", "Indian Railways"]]} />
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-white/55 sm:px-6">
            © 2026 PAYANI · Map data © OpenStreetMap contributors · Timetables are simulated or historical and always labelled with their source. Bookings are sandbox only.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-white">{title}</p>
      <ul className="mt-4 flex flex-col gap-2.5 text-sm text-white/70">
        {links.map(([href, label]) => (
          <li key={label}>
            {href.startsWith("/") ? <Link to={href} className="transition-colors hover:text-white">{label}</Link>
              : <a href={href} className="transition-colors hover:text-white" {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{label}</a>}
          </li>
        ))}
      </ul>
    </div>
  );
}

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; end?: boolean; badge?: number };

function SideNav({ groups, onNavigate }: { groups: { title: string; items: NavItem[] }[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-6">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-2 text-xs font-medium text-white/45">{g.title}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map(({ to, label, icon: Icon, end, badge }) => (
              <li key={to}>
                <NavLink to={to} end={end} onClick={onNavigate}
                         className={({ isActive }) => `group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                           isActive ? "bg-white/10 font-semibold text-white" : "text-white/72 hover:bg-white/5 hover:text-white"}`}>
                  {({ isActive }) => (
                    <>
                      {isActive && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-saffron" />}
                      <Icon aria-hidden className={`size-[18px] ${isActive ? "text-white" : "text-white/55 group-hover:text-white/80"}`} />
                      <span className="flex-1">{label}</span>
                      {badge ? <span className="rounded bg-saffron px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-navy">{badge}<span className="sr-only"> unread</span></span> : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Signed-in application: navy sidebar on desktop, drawer on mobile, native scroll. */
export function AppLayout() {
  const { t } = useTranslation();
  const { user, can, logout } = useAuth();
  const { data: inbox } = useQuery({ queryKey: ["inbox"], queryFn: () => api<{ unread: number }>("/api/v1/notifications"), refetchInterval: 60_000 });
  const location = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { duration, ease } = motionTokens;
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const groups: { title: string; items: NavItem[] }[] = [
    { title: "Plan and book", items: [
      { to: "/app", label: t("nav.dashboard"), icon: LayoutDashboard, end: true },
      { to: "/app/search", label: "Search trains", icon: Search },
      { to: "/app/bookings", label: t("nav.bookings"), icon: Ticket },
      { to: "/app/groups", label: t("nav.groups"), icon: Users },
      { to: "/app/refunds", label: "Refunds", icon: ReceiptIndianRupee },
    ] },
    { title: "Stay informed", items: [
      { to: "/app/pulse", label: t("nav.pulse"), icon: BellRing, badge: inbox?.unread },
      { to: "/app/connect", label: t("nav.connect"), icon: MessagesSquare },
      { to: "/app/intelligence", label: t("nav.intelligence"), icon: ChartLine },
    ] },
    ...(can("admin.access") ? [{ title: "Operations", items: [{ to: "/app/admin", label: "Administration", icon: ShieldCheck }] }] : []),
  ];
  const initials = (user?.display_name ?? "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const signOut = async () => { await logout(); navigate("/", { replace: true }); };

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-navy px-3 pb-4 pt-5 text-white">
      <div className="flex items-center justify-between px-3">
        <Wordmark to="/app" />
        {!onNavigate && <span className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/60">Sandbox</span>}
      </div>
      <div className="mt-8 flex-1 overflow-y-auto"><SideNav groups={groups} onNavigate={onNavigate} /></div>
      <div className="mt-4 flex items-center gap-3 rounded-md border border-white/10 bg-navy-800 p-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-semibold">{initials}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{user?.display_name}</p>
          <p className="truncate text-xs text-white/55">{user?.email}</p>
        </div>
        <button type="button" onClick={signOut} aria-label={t("nav.signOut")} title={t("nav.signOut")}
                className="grid size-9 place-items-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white">
          <LogOut aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-ivory">
      <SkipLink />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar()}</aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/10 bg-navy px-4 lg:hidden">
        <Wordmark to="/app" />
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
                className="grid size-10 place-items-center rounded-md text-white hover:bg-white/10">
          <Menu aria-hidden className="size-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-navy/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[min(20rem,85vw)] shadow-[var(--shadow-raised)] motion-safe:animate-[rise_200ms_var(--ease-ui)]">
            {sidebar(() => setOpen(false))}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 grid size-9 place-items-center rounded-md text-white/80 hover:bg-white/10">
              <X aria-hidden className="size-5" />
            </button>
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Enter-only page transition: Motion owns this element; nothing else animates it. */}
        <motion.main
          id="main"
          key={location.pathname}
          className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10"
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.ui } }}
        >
          <Outlet />
        </motion.main>
      </div>
    </div>
  );
}
