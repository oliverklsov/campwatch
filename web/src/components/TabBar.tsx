"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Mobile-style bottom nav matching the mockup. Calendar/Profile arrive in Phase 3,
// shown disabled for now so the shell is complete without dead links.
const tabs = [
  { href: "/explore", label: "Explore", icon: "🗺️" },
  { href: "/dashboard", label: "Watches", icon: "🔔" },
  { href: "/lotteries", label: "Lotteries", icon: "🎟️" },
  { href: "/profile", label: "Profile", icon: "👤", soon: true },
];

export default function TabBar() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-stone-200 bg-white">
      {tabs.map((t) => {
        const active = path === t.href || (t.href !== "/explore" && path?.startsWith(t.href));
        const cls = "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]";
        if (t.soon) {
          return (
            <span key={t.href} className={`${cls} cursor-default text-stone-300`} title="Coming soon">
              <span className="text-xl leading-none">{t.icon}</span>
              {t.label}
            </span>
          );
        }
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`${cls} ${active ? "font-semibold text-green-700" : "text-stone-500"}`}
          >
            <span className="text-xl leading-none">{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
