import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CampWatch — campsite alerts for recreation.gov",
  description:
    "Get alerted the moment a campsite opens up. Watch any site, any campground, plus lottery and booking-window reminders.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <a href="/" className="text-lg font-bold tracking-tight">⛺ CampWatch</a>
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
