"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { useSession } from "@/components/Session";
import { api } from "@/lib/api";

// X sends the browser back here after its sign-in; the code goes to the API, which links the
// account to the signed-in address.
export default function XCallbackPage() {
  return (
    <Suspense fallback={null}>
      <Callback />
    </Suspense>
  );
}

function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const { token, ready } = useSession();
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);
  const code = params.get("code"), state = params.get("state");
  useEffect(() => {
    if (!ready || sent.current) return;
    if (params.get("error")) return setError(params.get("error") === "access_denied" ? "你在 X 上取消了授权。" : "X 没有完成授权。");
    if (!token) return setError("请先连接钱包，再绑定 X。");
    if (!code || !state) return setError("链接不完整，请回到我的土地重新绑定。");
    sent.current = true;
    api("/v1/x/link/finish", { method: "POST", token, body: { code, state } })
      .then(() => router.replace("/me"))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ready, token, code, state, params, router]);
  return (
    <div className="page narrow">
      {error ? (
        <>
          <p className="error">{error}</p>
          <Link href="/me">回到我的土地</Link>
        </>
      ) : (
        <p className="muted">正在确认 X 账号…</p>
      )}
    </div>
  );
}
