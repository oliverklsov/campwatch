"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const supabase = createClient();

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    error ? setErr(error.message) : setSent(true);
  }

  async function signInGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {sent ? (
        <p className="rounded-lg bg-green-50 p-4 text-green-800">
          Check your email for a sign-in link.
        </p>
      ) : (
        <form onSubmit={sendMagicLink} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-stone-300 px-3 py-2"
          />
          <button className="w-full rounded-lg bg-green-700 py-2 font-medium text-white hover:bg-green-800">
            Email me a sign-in link
          </button>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </form>
      )}
      <div className="flex items-center gap-3 text-sm text-stone-400">
        <div className="h-px flex-1 bg-stone-200" /> or <div className="h-px flex-1 bg-stone-200" />
      </div>
      <button
        onClick={signInGoogle}
        className="w-full rounded-lg border border-stone-300 bg-white py-2 font-medium hover:bg-stone-100"
      >
        Continue with Google
      </button>
    </div>
  );
}
