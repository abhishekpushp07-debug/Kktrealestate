import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { SiteNav, SiteFooter, ComingSoon, useSite, SiteProvider } from "./SiteShell";
import "./site.css";

export const PREFETCH = { "/projects": () => import("./pages/Projects"), "/about": () => import("./pages/About"), "/gallery": () => import("./pages/Gallery"), "/blog": () => import("./pages/Blog"), "/contact": () => import("./pages/Contact") };
const Home = lazy(() => import("./pages/Home"));
const Projects = lazy(() => import("./pages/Projects"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const About = lazy(() => import("./pages/About"));
const Gallery = lazy(() => import("./pages/Gallery"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const Contact = lazy(() => import("./pages/Contact"));
const LegalPage = lazy(() => import("./pages/LegalPage"));
const VisitPage = lazy(() => import("./VisitBooking"));

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function SiteInner() {
  const { site, loading } = useSite();
  useEffect(() => {
    if (!site?.ga_id || document.getElementById("ga-tag")) return;
    const s = document.createElement("script"); s.id = "ga-tag"; s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${site.ga_id}`; document.head.appendChild(s);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); }; window.gtag("js", new Date()); window.gtag("config", site.ga_id);
  }, [site?.ga_id]);
  if (loading) return <div className="site min-h-screen bg-ivory" />;
  if (site && site.site_live === false) return <HelmetProvider><div className="site"><ComingSoon site={site} /></div></HelmetProvider>;
  return (
    <HelmetProvider>
      <div className="site min-h-screen bg-ivory text-navy" data-testid="public-site">
        <a href="#main" className="skip-link">Skip to content</a>
        <ScrollTop />
        <SiteNav site={site} />
        <main id="main"><Suspense fallback={<div className="min-h-[60vh]" />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:slug" element={<ProjectDetail />} />
            <Route path="/about" element={<About />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/visit/:token" element={<VisitPage />} />
            <Route path="/privacy" element={<LegalPage slug="privacy" />} />
            <Route path="/disclaimer" element={<LegalPage slug="disclaimer" />} />
            <Route path="*" element={<div className="container-site py-32 text-center"><h1 className="display text-5xl">Page not found</h1><a href="/" className="btn-gold mt-8 inline-block">Back home</a></div>} />
          </Routes>
        </Suspense></main>
        <SiteFooter site={site} />
      </div>
    </HelmetProvider>
  );
}

export default function SiteApp() {
  return <SiteProvider><SiteInner /></SiteProvider>;
}
