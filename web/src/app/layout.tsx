import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";
import { SITE_URL, stateName, FOOTER_STATES } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Yonder — campsite alerts & dispersed camping",
  description:
    "Get alerted the moment a campsite opens up, browse free dispersed camping, and never miss a permit lottery or booking window.",
  openGraph: { siteName: "Yonder", type: "website" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <a href="/" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap text-lg font-bold tracking-tight sm:text-2xl">
              <svg viewBox="0 0 40 40" aria-hidden="true" className="h-7 w-7 shrink-0 sm:h-9 sm:w-9">
                <circle cx="20" cy="16" r="6.5" fill="#E0A100" />
                <path d="M2 32 L14 17 L21 25 L29 14 L38 32 Z" fill="#2d6a4f" />
                <rect x="2" y="31" width="36" height="2.5" rx="1.25" fill="#2d6a4f" />
              </svg>
              Yonder
            </a>
            <nav className="flex items-center gap-2.5 text-[13px] sm:gap-4 sm:text-sm">
              <a href="/explore" className="whitespace-nowrap hover:underline">Explore</a>
              <a href="/dashboard" className="whitespace-nowrap hover:underline">Watches</a>
              <a href="/lotteries" className="hidden whitespace-nowrap hover:underline md:inline">Lotteries</a>
              {user ? (
                <>
                  <a href="/profile" className="whitespace-nowrap hover:underline">Profile</a>
                  <SignOutButton />
                </>
              ) : (
                <a href="/login" className="whitespace-nowrap hover:underline">Sign in</a>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
        <footer className="border-t border-stone-200 bg-white">
          <div className="mx-auto max-w-4xl px-4 py-8 pb-24 text-sm text-stone-500 md:pb-8">
            <p className="mb-3 font-semibold text-stone-700">Camping by state</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {FOOTER_STATES.map((code) => (
                <li key={code}>
                  <Link href={`/camping/${code.toLowerCase()}`} className="hover:text-stone-700 hover:underline">
                    {stateName(code)}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs text-stone-400">
              © Yonder ·{" "}
              <Link href="/explore" className="hover:underline">
                Explore the map
              </Link>{" "}
              ·{" "}
              <Link href="/lotteries" className="hover:underline">
                Permit lotteries
              </Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
