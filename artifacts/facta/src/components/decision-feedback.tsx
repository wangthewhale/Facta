import React, { useState } from "react";
import { Link } from "wouter";
import {
  type DecisionOutcomeCode,
  type DecisionReasonCode,
  type DecisionRecommendationCode,
  useCreateDecisionOutcome,
} from "@workspace/api-client-react";
import { Check, Loader2 } from "lucide-react";
import { getSessionId } from "@/lib/session";
import { track } from "@/lib/analytics";

interface DecisionChoice {
  label: string;
  outcomeCode: DecisionOutcomeCode;
  selectedAlternativeProductId?: number;
  asksReason?: boolean;
}

interface DecisionFeedbackProps {
  productId: number;
  evaluationId: number;
  recommendationCode: DecisionRecommendationCode;
  alternative?: {
    id: number;
    name: string;
  } | null;
}

const REASONS: { code: DecisionReasonCode; label: string }[] = [
  { code: "price", label: "價格" },
  { code: "availability", label: "買不到" },
  { code: "taste", label: "口味" },
  { code: "family_preference", label: "家人習慣" },
  { code: "not_concerned", label: "我不擔心" },
  { code: "other", label: "其他" },
];

function makeClientEventId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `facta-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function choicesFor(
  recommendationCode: DecisionRecommendationCode,
  alternative?: DecisionFeedbackProps["alternative"],
): DecisionChoice[] {
  switch (recommendationCode) {
    case "buy":
      return [
        { label: "買了", outcomeCode: "bought" },
        { label: "最後沒買", outcomeCode: "skipped", asksReason: true },
      ];
    case "limit":
      return [
        { label: "我會減少頻率", outcomeCode: "limited" },
        { label: "還是照常吃", outcomeCode: "kept", asksReason: true },
      ];
    case "swap":
      if (alternative) {
        return [
          {
            label: `換成 ${alternative.name}`,
            outcomeCode: "swapped",
            selectedAlternativeProductId: alternative.id,
          },
          { label: "還是買原本這款", outcomeCode: "kept", asksReason: true },
        ];
      }
      return [
        {
          label: "找不到可換的",
          outcomeCode: "could_not_find",
          selectedAlternativeProductId: undefined,
        },
        { label: "還是買原本這款", outcomeCode: "kept", asksReason: true },
      ];
    case "complete_data":
      return [
        { label: "我會補拍包裝", outcomeCode: "will_complete_data" },
        { label: "先不處理", outcomeCode: "skipped", asksReason: true },
      ];
  }
}

const SAVED_LABELS: Record<DecisionOutcomeCode, string> = {
  bought: "已記住你買了這款",
  skipped: "已記住你這次沒有採用",
  limited: "已記住你會減少頻率",
  kept: "已記住你仍選擇原商品",
  swapped: "已記住你換了商品",
  could_not_find: "已記住目前找不到合適替代",
  will_complete_data: "已記住你準備補資料",
};

export function DecisionFeedback({
  productId,
  evaluationId,
  recommendationCode,
  alternative,
}: DecisionFeedbackProps) {
  const mutation = useCreateDecisionOutcome();
  const [pendingChoice, setPendingChoice] = useState<DecisionChoice | null>(
    null,
  );
  const [savedOutcome, setSavedOutcome] = useState<DecisionOutcomeCode | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const choices = choicesFor(recommendationCode, alternative);

  const save = (choice: DecisionChoice, reasonCode?: DecisionReasonCode) => {
    setError(null);
    track("decision_outcome_selected", {
      productId,
      recommendation: recommendationCode,
      outcome: choice.outcomeCode,
      reason: reasonCode ?? null,
    });
    mutation.mutate(
      {
        data: {
          clientEventId: makeClientEventId(),
          sessionId: getSessionId(),
          productId,
          evaluationId,
          recommendationCode,
          outcomeCode: choice.outcomeCode,
          selectedAlternativeProductId:
            choice.selectedAlternativeProductId ?? null,
          reasonCode: reasonCode ?? null,
          source: "report",
        },
      },
      {
        onSuccess: () => {
          setSavedOutcome(choice.outcomeCode);
          setPendingChoice(null);
          track("decision_outcome_saved", {
            productId,
            recommendation: recommendationCode,
            outcome: choice.outcomeCode,
          });
        },
        onError: () => {
          setError("這次沒有存到，請再試一次。");
          track("decision_outcome_failed", {
            productId,
            recommendation: recommendationCode,
            outcome: choice.outcomeCode,
          });
        },
      },
    );
  };

  if (savedOutcome) {
    return (
      <section
        className="px-6 py-5 border-b border-border bg-primary/10"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <span
            className="w-8 h-8 bg-primary text-black flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <Check className="w-4 h-4" />
          </span>
          <div>
            <p className="text-sm font-black">{SAVED_LABELS[savedOutcome]}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              這筆選擇不會改動商品分數，只會幫 FACTA 了解哪些建議真的有用。
            </p>
            <Link
              href="/history?tab=decisions"
              className="inline-block mt-2 text-xs font-black underline"
            >
              查看我的選擇
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="px-6 py-5 border-b border-border bg-card">
      <p className="text-[10px] font-black tracking-[0.16em] text-muted-foreground uppercase">
        把建議變成真正有用的選擇
      </p>
      <h3 className="text-base font-black mt-1">你最後會怎麼做？</h3>
      <p className="text-xs text-muted-foreground mt-1">
        一次點選就好；FACTA 不會用你的選擇回頭竄改分數。
      </p>

      {pendingChoice ? (
        <div className="mt-4" aria-live="polite">
          <p className="text-xs font-black">主要原因是什麼？</p>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {REASONS.map((reason) => (
              <button
                key={reason.code}
                type="button"
                disabled={mutation.isPending}
                onClick={() => save(pendingChoice, reason.code)}
                className="min-h-11 px-2 border border-border bg-background text-xs font-bold hover:border-foreground disabled:opacity-50"
              >
                {reason.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => save(pendingChoice)}
            className="mt-2 min-h-11 w-full text-xs font-bold underline disabled:opacity-50"
          >
            略過原因，直接記錄
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 mt-4">
          {choices.map((choice, index) => (
            <button
              key={choice.outcomeCode}
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                choice.asksReason ? setPendingChoice(choice) : save(choice)
              }
              className={
                index === 0
                  ? "min-h-12 px-3 bg-foreground text-background text-xs font-black disabled:opacity-50"
                  : "min-h-12 px-3 border-2 border-foreground text-xs font-black disabled:opacity-50"
              }
            >
              {mutation.isPending && index === 0 ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                <span className="line-clamp-2">{choice.label}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs font-bold text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
