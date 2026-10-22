import type { Metadata } from "next";
import Link from "next/link";
import { NOT_FOUND_BOOTSTRAP } from "./not-found-bootstrap";

const NOT_FOUND_STYLES = String.raw`
.not-found-page{width:100%;min-height:100svh;display:grid;grid-template-rows:auto 1fr auto;padding:18px clamp(16px,4vw,48px) 24px;overflow:hidden;color:#f3f2ed;background:radial-gradient(circle at 50% 30%,rgba(127,214,163,.08),transparent 32%),linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px),#0a0a09;background-size:auto,42px 42px,42px 42px,auto}
.not-found-header,.not-found-content,.not-found-footer{width:min(1040px,100%);margin-inline:auto}
.not-found-header{min-height:48px;display:flex;align-items:center}
.not-found-brand{min-height:44px;display:inline-flex;align-items:center;gap:10px;color:#f3f2ed;font-size:15px;font-weight:650;letter-spacing:-.02em;text-decoration:none}
.not-found-mark{width:24px;height:24px;flex:0 0 auto;background:url("/brand/relayune/relayune-eclipse-static.svg") center/contain no-repeat}
.not-found-content{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding-block:clamp(38px,10vh,104px)}
.not-found-eyebrow{margin:0 0 18px;color:#7fd6a3;font-family:var(--font-geist-mono),monospace;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.not-found-content h1{max-width:820px;margin:0;color:#f5f5f1;font-size:clamp(38px,7vw,72px);font-weight:620;letter-spacing:-.052em;line-height:1.02;overflow-wrap:anywhere}
.not-found-content h1:focus{outline:none}
.not-found-description{max-width:620px;margin:24px 0 0;color:#a5a5a0;font-size:clamp(15px,2vw,18px);line-height:1.7;overflow-wrap:anywhere}
.not-found-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:34px}
.not-found-actions a{min-height:44px;display:inline-flex;align-items:center;justify-content:center;padding:0 18px;border-radius:11px;font-size:14px;font-weight:640;text-align:center;text-decoration:none}
.not-found-primary{color:#0b1710;background:#a6e3b9}
.not-found-secondary{border:1px solid #343432;color:#d2d2ce;background:rgba(20,20,19,.72)}
.not-found-footer{min-height:44px;display:flex;align-items:center;gap:22px;border-top:1px solid #272725}
.not-found-footer a{min-height:44px;display:inline-flex;align-items:center;color:#858580;font-size:12px;text-decoration:none}
.not-found-brand:hover,.not-found-footer a:hover{color:#fff}
.not-found-actions a:focus-visible,.not-found-brand:focus-visible,.not-found-footer a:focus-visible{outline:2px solid rgba(166,227,185,.66);outline-offset:3px}
@media(max-width:420px){.not-found-content{padding-block:32px}.not-found-content h1{font-size:clamp(34px,12vw,48px)}.not-found-actions{width:100%;display:grid}.not-found-actions a{width:100%}}
@media(max-height:560px){.not-found-content{padding-block:24px}.not-found-eyebrow{margin-bottom:12px}.not-found-description{margin-top:16px}.not-found-actions{margin-top:22px}}
`;

export const metadata: Metadata = {
  title: "404 | Relayune",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="not-found-page" lang="en" data-not-found-page>
      <style>{NOT_FOUND_STYLES}</style>
      <header className="not-found-header">
        <Link
          className="not-found-brand"
          href="/en/"
          aria-label="Relayune home"
          data-not-found-brand
          data-not-found-link="home"
        >
          <span className="not-found-mark" aria-hidden="true" />
          <span>Relayune</span>
        </Link>
      </header>

      <section className="not-found-content" aria-labelledby="not-found-title">
        <p className="not-found-eyebrow" data-not-found-copy="eyebrow">
          404 · Page not found
        </p>
        <h1
          id="not-found-title"
          tabIndex={-1}
          data-not-found-copy="heading"
        >
          This route doesn’t lead anywhere
        </h1>
        <p className="not-found-description" data-not-found-copy="description">
          The link may be outdated or mistyped. Return home, or continue to
          the security terms.
        </p>
        <div className="not-found-actions">
          <Link
            className="not-found-primary"
            href="/en/"
            data-not-found-copy="home"
            data-not-found-link="home"
          >
            Back to Relayune home
          </Link>
        </div>
      </section>

      <nav
        className="not-found-footer"
        aria-label="Related pages"
        data-not-found-footer
      >
        <Link
          href="/en/legal/terms/"
          data-not-found-copy="terms"
          data-not-found-link="terms"
        >
          Terms of Service
        </Link>
        <Link
          href="/en/legal/privacy/"
          data-not-found-copy="privacy"
          data-not-found-link="privacy"
        >
          Privacy Policy
        </Link>
      </nav>
      <script dangerouslySetInnerHTML={{ __html: NOT_FOUND_BOOTSTRAP }} />
    </main>
  );
}
