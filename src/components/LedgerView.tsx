"use client";

import { useState } from "react";
import type { AppState, ConceptRef, Domain, LedgerEntry } from "@/lib/schema";
import { shortDate } from "./bits";

const isEntry = (r: ConceptRef | LedgerEntry): r is LedgerEntry => "status" in r;

export default function LedgerView({ state, onBack }: { state: AppState; onBack: () => void }) {
  const [tab, setTab] = useState<"earned" | "pending">("earned");
  const earned = Object.values(state.ledger);
  const groups: { domain: Domain; label: string }[] = [
    { domain: "finance", label: "Finance" },
    { domain: "energy", label: "Climate + energy" },
  ];

  return (
    <main className="shell">
      <div className="lesson-top">
        <button className="icon-btn" aria-label="Back" onClick={onBack}>
          ‹
        </button>
        <strong style={{ fontSize: 18 }}>Knowledge ledger</strong>
      </div>

      <div className="tabs" role="tablist">
        <button className={`tab ${tab === "earned" ? "active" : ""}`} role="tab" onClick={() => setTab("earned")}>
          Earned · {earned.length}
        </button>
        <button className={`tab ${tab === "pending" ? "active" : ""}`} role="tab" onClick={() => setTab("pending")}>
          Not yet earned · {state.pending.length}
        </button>
      </div>

      {tab === "earned" ? (
        <p className="explain">
          A concept lands here only after you finish its quiz. Daily review draws exclusively from this list.
        </p>
      ) : (
        <p className="explain">
          Concepts you’ve been shown but haven’t been quizzed on. Future lessons teach them as new — never as
          something you already know.
        </p>
      )}

      {groups.map(({ domain, label }) => {
        const rows: (ConceptRef | LedgerEntry)[] =
          tab === "earned"
            ? earned.filter((e) => e.domain === domain).sort((a, b) => a.name.localeCompare(b.name))
            : state.pending.filter((p) => p.domain === domain).sort((a, b) => a.name.localeCompare(b.name));
        if (!rows.length) return null;
        return (
          <section className="ledger-group" key={domain}>
            <h3 className={domain}>{label}</h3>
            {rows.map((r) => (
              <div className="ledger-row" key={r.conceptId}>
                <span>
                  {r.name}
                  {isEntry(r) && (
                    <>
                      <br />
                      <span className="when">
                        {r.origin === "seed" ? "Carried over from earlier tutoring" : `Earned ${r.earnedAt ? shortDate(r.earnedAt) : ""}`}
                        {r.nextReviewAt ? ` · review ${shortDate(r.nextReviewAt)}` : " · due for review"}
                      </span>
                    </>
                  )}
                </span>
                {isEntry(r) ? (
                  <span className={`status status-${r.status}`}>{r.status}</span>
                ) : (
                  <span className="status status-pending">Not earned</span>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </main>
  );
}
