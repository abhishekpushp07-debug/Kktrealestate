// Static web shell: brand fonts (Google Fonts; system fallbacks elsewhere), viewport and base CSS.
import { ScrollViewStyleReset, useServerDocumentContext } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren): React.JSX.Element {
  // Expo injects the bundle <script> tags and route data through these nodes.
  const { bodyAttributes, bodyNodes, htmlAttributes, headNodes } = useServerDocumentContext();
  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <meta name="theme-color" content="#0B1F3A" />
        <title>KKT Customer Portal</title>
        <meta name="description" content="KKT customer portal — your flat, payments, receipts, construction updates and documents." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <ScrollViewStyleReset />
        {headNodes}
        <style dangerouslySetInnerHTML={{ __html: baseCss }} />
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}

const baseCss = `
html, body { height: 100%; background: #0B1F3A; }
body { overflow-x: hidden; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
#root { min-height: 100%; display: flex; }
* { box-sizing: border-box; }
::selection { background: #C9A227; color: #0B1F3A; }
input, textarea { outline: none; }
input:focus-visible, textarea:focus-visible, [role="button"]:focus-visible, a:focus-visible { outline: 2px solid #C9A227; outline-offset: 2px; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: #C9D3E3; border-radius: 8px; border: 2px solid #F8F6F1; }
::-webkit-scrollbar-track { background: transparent; }
`;
