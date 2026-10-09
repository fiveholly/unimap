"use client";

import { useEffect, useState } from "react";

import { EventItem } from "@/components/EventItem";
import { LandMap } from "@/components/LandMap";
import { PostCard } from "@/components/PostCard";
import { useSession } from "@/components/Session";
import { api, type FeedItem } from "@/lib/api";

export default function Home() {
  const { token } = useSession();
  return (
    <div className="home">
      <section className="hero">
        <h1>Every Bitcoin block is a place.</h1>
        <p className="muted">
          Hold a Bitmap district and you run its community page. Hold a parcel and you live there. Everyone else can visit,
          follow and reply.
        </p>
      </section>
      <div className="columns">
        <div className="col-main">
          <LandMap />
        </div>
        <aside className="col-side">{token ? <Feed token={token} /> : <SignInHint />}</aside>
      </div>
    </div>
  );
}

function SignInHint() {
  return (
    <section className="card">
      <h2>Your feed</h2>
      <p className="muted">Sign in with your wallet and follow districts to see their posts and land moves here.</p>
    </section>
  );
}

function Feed({ token }: { token: string }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: FeedItem[] }>("/v1/feed", { token })
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <section className="card">
      <h2>Your feed</h2>
      {error && <p className="error small">{error}</p>}
      {items && items.length === 0 && <p className="muted">Follow a district to fill your feed.</p>}
      {items?.map((i) =>
        i.type === "event" ? (
          <ul className="events" key={`e${i.event.id}`}>
            <EventItem event={i.event} showDistrict />
          </ul>
        ) : (
          <PostCard key={`p${i.post.id}`} post={i.post} showDistrict />
        ),
      )}
    </section>
  );
}
