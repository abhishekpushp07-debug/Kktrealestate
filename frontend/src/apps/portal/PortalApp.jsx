import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { PortalAuthProvider, usePortalAuth } from "./PortalAuth";
import PortalShell, { Skeleton } from "./PortalShell";
import "./portal.css";

const Login = lazy(() => import("./pages/Login"));
const Home = lazy(() => import("./pages/Home"));
const Flat = lazy(() => import("./pages/Flat"));
const Payments = lazy(() => import("./pages/Payments"));
const Construction = lazy(() => import("./pages/Construction"));
const Documents = lazy(() => import("./pages/Documents"));
const Requests = lazy(() => import("./pages/Requests"));
const Notices = lazy(() => import("./pages/Notices"));
const Profile = lazy(() => import("./pages/Profile"));
const More = lazy(() => import("./pages/More"));

function Gate({ base }) {
  const { me, loading } = usePortalAuth();
  const loc = useLocation();
  if (loading) return <div className="portal p-6"><Skeleton h={120} /><Skeleton h={80} className="mt-4" /></div>;
  if (!me) return <Navigate to={`${base}/login`} replace state={{ from: loc.pathname }} />;
  if (me.must_change_password) return <Navigate to={`${base}/login`} replace />;
  return <PortalShell />;
}

export default function PortalApp({ base = "" }) {
  const p = (s) => `${base}/${s}`;
  return (
    <PortalAuthProvider>
      <Suspense fallback={<div className="portal min-h-screen" />}>
        <Routes>
          <Route path={p("login")} element={<Login base={base} />} />
          <Route element={<Gate base={base} />}>
            <Route path={p("")} element={<Home />} />
            <Route path={p("flat/:id")} element={<Flat />} />
            <Route path={p("payments")} element={<Payments />} />
            <Route path={p("construction")} element={<Construction />} />
            <Route path={p("documents")} element={<Documents />} />
            <Route path={p("requests")} element={<Requests />} />
            <Route path={p("requests/:id")} element={<Requests />} />
            <Route path={p("notices")} element={<Notices />} />
            <Route path={p("profile")} element={<Profile />} />
            <Route path={p("more")} element={<More />} />
          </Route>
          <Route path="*" element={<Navigate to={p("")} replace />} />
        </Routes>
      </Suspense>
    </PortalAuthProvider>
  );
}
