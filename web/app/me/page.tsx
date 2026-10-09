"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useSession } from "@/components/Session";
import { api, type Me } from "@/lib/api";

export default function MePage() {
  const { token, ready } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    api<Me>("/v1/me", { token })
      .then(setMe)
      .catch((e) => setError(e.message));
  }, [token]);
  if (!ready) return null;
  if (!token) return <p className="muted">Sign in to see your land.</p>;
  if (error) return <p className="error">{error}</p>;
  if (!me) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <section className="card">
        <h1>My land</h1>
        <p className="muted break">{me.address}</p>
      </section>
      <section className="card">
        <h2>Districts ({me.districts.length})</h2>
        {me.districts.length === 0 && <p className="muted">You don&apos;t hold a district at this address.</p>}
        <div className="chips">
          {me.districts.map((n) => (
            <Link key={n} className="chip" href={`/district/${n}`}>
              {n}.bitmap
            </Link>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Parcels ({me.parcels.length})</h2>
        <div className="chips">
          {me.parcels.map((p) => (
            <Link key={`${p.bitmap_number}.${p.tx_index}`} className="chip" href={`/district/${p.bitmap_number}?parcel=${p.tx_index}`}>
              {p.tx_index}.{p.bitmap_number}.bitmap
            </Link>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Following ({me.follows.length})</h2>
        <div className="chips">
          {me.follows.map((n) => (
            <Link key={n} className="chip" href={`/district/${n}`}>
              {n}.bitmap
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
