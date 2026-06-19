export default function Home() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Never miss a campsite cancellation again.</h1>
      <p className="max-w-2xl text-stone-600">
        CampWatch monitors recreation.gov and emails you the moment a site opens for your
        dates — a specific site, or any site at a campground. Plus reminders for booking
        windows and permit lotteries, so you&apos;re ready when reservations drop.
      </p>
      <ul className="max-w-2xl list-disc space-y-1 pl-5 text-stone-700">
        <li>Watch any campground, any dates, optional specific sites</li>
        <li>Detects first-come-first-served seasons and tells you, not just &quot;no availability&quot;</li>
        <li>Booking-window alerts: know when your dates go on sale (7am PT, 6 months out)</li>
        <li>Lottery calendar: Half Dome, Enchantments, The Wave application windows</li>
      </ul>
      <div className="flex flex-wrap gap-3">
        <a
          href="/explore"
          className="inline-block rounded-lg bg-green-700 px-5 py-2.5 font-medium text-white hover:bg-green-800"
        >
          Explore the map
        </a>
        <a
          href="/login"
          className="inline-block rounded-lg border border-green-700 px-5 py-2.5 font-medium text-green-700 hover:bg-green-50"
        >
          Sign in to watch
        </a>
      </div>
    </div>
  );
}
