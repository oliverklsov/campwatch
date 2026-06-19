import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Watch } from "@/lib/types";
import TabBar from "@/components/TabBar";

export const dynamic = "force-dynamic";

async function deleteWatch(formData: FormData) {
  "use server";
  const supabase = createClient();
  await supabase.from("watches").delete().eq("id", String(formData.get("id")));
  revalidatePath("/dashboard");
}

async function toggleWatch(formData: FormData) {
  "use server";
  const supabase = createClient();
  await supabase
    .from("watches")
    .update({ active: formData.get("active") === "true" })
    .eq("id", String(formData.get("id")));
  revalidatePath("/dashboard");
}

export default async function Dashboard() {
  const supabase = createClient();
  const { data: watches } = await supabase
    .from("watches")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<Watch[]>();

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your watches</h1>
        <a
          href="/dashboard/new"
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
        >
          + New watch
        </a>
      </div>

      {!watches?.length && (
        <p className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-stone-500">
          No watches yet. Create one and we&apos;ll email you when a site opens.
        </p>
      )}

      <ul className="space-y-3">
        {watches?.map((w) => (
          <li key={w.id} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold">
                  {w.facility_name || `Facility ${w.facility_id}`}
                  {!w.active && (
                    <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs">paused</span>
                  )}
                </p>
                <p className="text-sm text-stone-600">
                  {w.start_date} → {w.end_date}
                  {w.flex_days ? ` (±${w.flex_days}d)` : ""} ·{" "}
                  {w.sites.length ? `sites ${w.sites.join(", ")}` : "any site"}
                  {w.weekend_only && " · weekends only"}
                  {w.include_fcfs && " · incl. first-come-first-served"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <form action={toggleWatch}>
                  <input type="hidden" name="id" value={w.id} />
                  <input type="hidden" name="active" value={String(!w.active)} />
                  <button className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100">
                    {w.active ? "Pause" : "Resume"}
                  </button>
                </form>
                <form action={deleteWatch}>
                  <input type="hidden" name="id" value={w.id} />
                  <button className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </form>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <TabBar />
    </div>
  );
}
