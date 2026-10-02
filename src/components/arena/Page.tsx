import type { ReactNode } from "react";
import { MobileNavigation, SiteFooter, SiteHeader } from "@/components/betweentasks";

export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative min-h-screen">
      <SiteHeader />
      {!wide && (
        <div
          className="page-glow pointer-events-none absolute inset-x-0 top-0 h-[520px]"
          aria-hidden
        />
      )}
      <main
        className={wide ? "relative" : "relative mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14"}
      >
        {children}
      </main>
      <SiteFooter />
      <MobileNavigation />
    </div>
  );
}

export function meta(title: string, description: string) {
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  };
}
