import type { ReactNode } from 'react';

export const metadata = {
  title: 'Aangan Phone Agent',
  description: 'AI phone enquiry system for Aangan Studio',
  robots: { index: false, follow: false },
};

/** Colour tokens: reference data-viz palette (slots 1–2 + status), light and dark selected separately. */
const CSS = `
:root {
  color-scheme: light;
  --surface: #f6f6f4; --surface-1: #fcfcfb; --border: #e4e3df;
  --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #7a7974;
  --series-1: #2a78d6; --series-2: #eb6834;
  --good: #008300; --warning: #c98500; --critical: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --surface: #111110; --surface-1: #1a1a19; --border: #2e2e2b;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #8f8e86;
    --series-1: #3987e5; --series-2: #d95926;
    --good: #3fa63f; --warning: #e0a32a; --critical: #e66767;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #111110; --surface-1: #1a1a19; --border: #2e2e2b;
  --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #8f8e86;
  --series-1: #3987e5; --series-2: #d95926;
  --good: #3fa63f; --warning: #e0a32a; --critical: #e66767;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--text-primary);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.45; }
a { color: var(--series-1); }
.page { max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; }
.muted { color: var(--text-secondary); }
.card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 16px; min-width: 0; }
.grid { display: grid; gap: 12px; }
.tiles { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
.two { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
.tile-label { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .04em; }
.tile-value { font-size: 28px; font-weight: 650; margin-top: 4px; font-variant-numeric: tabular-nums; }
.tile-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
h2 { font-size: 15px; margin: 0 0 12px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--text-secondary); font-weight: 500; }
.scroll { overflow-x: auto; }
.input { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary); font-size: 15px; }
.button { padding: 10px 14px; border-radius: 8px; border: 0; background: var(--series-1); color: #fff; font-weight: 600; cursor: pointer; font-size: 14px; }
.chip { display: inline-block; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-secondary); text-decoration: none; font-size: 13px; }
.chip[aria-current="page"] { background: var(--text-primary); color: var(--surface-1); border-color: var(--text-primary); }
.legend { display: flex; gap: 14px; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
.bar-hit:hover rect.bar-fill { opacity: .8; }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
