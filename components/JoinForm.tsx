"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, identity, ApiError } from "@/lib/client";
import { LIMITS } from "@/lib/types";

export default function JoinForm({ fixedCode, onJoined }: { fixedCode?: string; onJoined?: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState(fixedCode ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(identity.lastName());
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 4) return setError("Type the code from the board.");
    if (!name.trim()) return setError("Type your name.");
    setBusy(true);
    setError("");
    try {
      const existing = identity.student(c);
      if (existing && !fixedCode) {
        router.push(`/s/${c}`);
        return;
      }
      const res = await api<{ studentId: string; token: string; name: string }>(c, { role: "board" }, { action: "join", name });
      identity.setStudent(c, res);
      if (onJoined) onJoined();
      else router.push(`/s/${c}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't join. Check your connection.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {!fixedCode && (
        <label className="field">
          <span>Session code</span>
          <input
            className="input input-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Za-z0-9]/g, "").slice(0, 8))}
            placeholder="ABC12"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            aria-label="Session code"
          />
        </label>
      )}
      <label className="field">
        <span>Your name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="First name and initial"
          maxLength={LIMITS.nameChars}
          autoComplete="given-name"
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
