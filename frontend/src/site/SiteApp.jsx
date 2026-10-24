import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { SiteNav, SiteFooter, ComingSoon, useSite, SiteProvider } from "./SiteShell";
import "./site.css";

const Home = lazy(() => import("./pages/Home"));
const Projects = lazy(() => import("./pages/Projects"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const About = lazy(() => import("./pages/About"));
const Gallery = lazy(() => import("./pages/Gallery"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const Contact = lazy(() => import("./pages/Contact"));
const LegalPage = lazy(() => import("./pages/LegalPage"));

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function SiteInner() {
  const { site, loading } = useSite();
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Manrope:wght@400;500;600;700&display=swap"; document.head.appendChild(l);
    const pc = document.createElement("link"); pc.rel = "preconnect"; pc.href = "https://images.unsplash.com"; document.head.appendChild(pc);
    setFontsReady(true);
    return () => { l.remove(); pc.remove(); };
  }, []);
  useEffect(() => {
    if (!site?.ga_id || document.getElementById("ga-tag")) return;
    const s = document.createElement("script"); s.id = "ga-tag"; s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${site.ga_id}`; document.head.appendChild(s);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); }; window.gtag("js", new Date()); window.gtag("config", site.ga_id);
  }, [site?.ga_id]);
  if (loading || !fontsReady) return <div className="site min-h-screen bg-ivory" />;
  if (site && site.site_live === false) return <HelmetProvider><div className="site"><ComingSoon site={site} /></div></HelmetProvider>;
  return (
    <HelmetProvider>
      <div className="site min-h-screen bg-ivory text-navy" data-testid="public-site">
        <ScrollTop />
        <SiteNav site={site} />
        <Suspense fallback={<div className="min-h-[60vh]" />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:slug" element={<ProjectDetail />} />
            <Route path="/about" element={<About />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/privacy" element={<LegalPage slug="privacy" />} />
            <Route path="/disclaimer" element={<LegalPage slug="disclaimer" />} />
            <Route path="*" element={<div className="container-site py-32 text-center"><h1 className="display text-5xl">Page not found</h1><a href="/" className="btn-gold mt-8 inline-block">Back home</a></div>} />
          </Routes>
        </Suspense>
        <SiteFooter site={site} />
      </div>
    </HelmetProvider>
  );
}

export default function SiteApp() {
  return <SiteProvider><SiteInner /></SiteProvider>;
}
