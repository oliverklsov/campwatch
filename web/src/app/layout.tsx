import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yonder — campsite alerts & dispersed camping",
  description:
    "Get alerted the moment a campsite opens up, browse free dispersed camping, and never miss a permit lottery or booking window.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <a href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <svg width="28" height="28" viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
                <circle cx="20" cy="16" r="6.5" fill="#E0A100" />
                <path d="M2 32 L14 17 L21 25 L29 14 L38 32 Z" fill="#2d6a4f" />
                <rect x="2" y="31" width="36" height="2.5" rx="1.25" fill="#2d6a4f" />
              </svg>
              Yonder
            </a>
            <nav className="flex gap-4 text-sm">
              <a href="/explore" className="hover:underline">Explore map</a>
              <a href="/dashboard" className="hover:underline">Watches</a>
              <a href="/login" className="hover:underline">Sign in</a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
