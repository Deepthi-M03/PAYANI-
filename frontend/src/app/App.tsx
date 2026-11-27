import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";

import {
  AdminAuditTab, AdminBookingsTab, AdminConfigTab, AdminLayout, AdminModerationTab, AdminNotificationsTab,
  AdminOverviewPage, AdminUsersTab,
} from "../features/admin/AdminPages";
import { BookJourneyPage } from "../features/book/BookJourneyPage";
import { SearchPage } from "../features/book/SearchPage";
import { BookingDetailPage } from "../features/bookings/BookingDetailPage";
import { BookingsPage, RefundsPage } from "../features/bookings/BookingsPage";
import { CommunityPage, ConnectPage } from "../features/connect/ConnectPages";
import { GroupDetailPage, GroupsPage, InviteAcceptPage } from "../features/groups/GroupsPages";
import { IntelligencePage } from "../features/intelligence/IntelligencePage";
import { PulsePage, TrainStatusPage } from "../features/pulse/PulsePages";
import { AuthProvider } from "../features/auth/AuthContext";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { RequireAuth } from "../features/auth/RequireAuth";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ApiError } from "../lib/api";
import { NotFoundPage } from "../pages/NotFoundPage";
import { FullPageLoader } from "../design-system/FullPageLoader";
import { AppLayout, MarketingLayout } from "./layouts";

// The public landing page is its own chunk.
const LandingPage = lazy(() => import("../pages/landing/LandingPage"));

export const routes = [
  {
    element: <MarketingLayout />,
    children: [
      { path: "/", element: <Suspense fallback={<FullPageLoader />}><LandingPage /></Suspense> },
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    path: "/app",
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "book", element: <BookJourneyPage /> },
      { path: "bookings", element: <BookingsPage /> },
      { path: "bookings/:id", element: <BookingDetailPage /> },
      { path: "refunds", element: <RefundsPage /> },
      { path: "groups", element: <GroupsPage /> },
      { path: "groups/:id", element: <GroupDetailPage /> },
      { path: "invite/:token", element: <InviteAcceptPage /> },
      { path: "intelligence", element: <IntelligencePage /> },
      { path: "pulse", element: <PulsePage /> },
      { path: "trains/:number", element: <TrainStatusPage /> },
      { path: "connect", element: <ConnectPage /> },
      { path: "connect/:id", element: <CommunityPage /> },
      {
        path: "admin",
        element: (
          <RequireAuth permission="admin.access">
            <AdminLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <RequireAuth permission="analytics.read"><AdminOverviewPage /></RequireAuth> },
          { path: "users", element: <RequireAuth permission="user.read_all"><AdminUsersTab /></RequireAuth> },
          { path: "bookings", element: <RequireAuth permission="booking.read_all"><AdminBookingsTab /></RequireAuth> },
          { path: "notifications", element: <RequireAuth permission="analytics.read"><AdminNotificationsTab /></RequireAuth> },
          { path: "moderation", element: <RequireAuth permission="moderation.manage"><AdminModerationTab /></RequireAuth> },
          { path: "audit", element: <RequireAuth permission="audit.read"><AdminAuditTab /></RequireAuth> },
          { path: "config", element: <AdminConfigTab /> },
        ],
      },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Don't hammer the API with retries on 4xx: those won't fix themselves.
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
