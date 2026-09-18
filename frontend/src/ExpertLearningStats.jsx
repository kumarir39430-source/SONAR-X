import React, { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Search,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import "./ExpertLearningStats.css";

const DEFAULT_SUMMARY = {
  total_reviews: 0,
  correct_detection: 0,
  incorrect_detection: 0,
  unknown_anomaly: 0,
  requires_further_sonar_inspection: 0,
};

function normalizeSummary(raw) {
  const summary = raw?.summary || raw || {};

  return {
    total_reviews: Number(summary.total_reviews ?? 0),
    correct_detection: Number(summary.correct_detection ?? 0),
    incorrect_detection: Number(summary.incorrect_detection ?? 0),
    unknown_anomaly: Number(summary.unknown_anomaly ?? 0),
    requires_further_sonar_inspection: Number(
      summary.requires_further_sonar_inspection ?? 0
    ),
  };
}

export default function ExpertLearningStats({
  apiBaseUrl = "http://127.0.0.1:8000",
}) {
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const loadSummary = async () => {
    setStatus("loading");
    setError("");

    try {
      const response = await fetch(
        `${apiBaseUrl.replace(/\/$/, "")}/assistant/feedback/summary`
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(
          data?.detail ||
            data?.message ||
            `Request failed with status ${response.status}`
        );
      }

      setSummary(normalizeSummary(data));
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(
        err?.message ||
          "Could not connect to the SONAR-X assistant backend."
      );
    }
  };

  useEffect(() => {
    loadSummary();
  }, [apiBaseUrl]);

  const total = summary.total_reviews;

  const correctionRate =
    total > 0
      ? (summary.incorrect_detection / total) * 100
      : 0;

  const confirmationRate =
    total > 0
      ? (summary.correct_detection / total) * 100
      : 0;

  return (
    <section className="expert-learning-stats">
      <div className="expert-learning-stats__header">
        <div>
          <div className="expert-learning-stats__eyebrow">
            <ShieldCheck size={16} />
            HUMAN-IN-THE-LOOP INTELLIGENCE
          </div>

          <h2>Expert Learning Statistics</h2>

          <p>
            Monitor how marine experts are validating and challenging
            SONAR-X AI predictions.
          </p>
        </div>

        <button
          type="button"
          className="expert-learning-stats__refresh"
          onClick={loadSummary}
          disabled={status === "loading"}
        >
          <RefreshCw
            size={16}
            className={
              status === "loading"
                ? "expert-learning-stats__spin"
                : ""
            }
          />
          Refresh
        </button>
      </div>

      {status === "error" && (
        <div className="expert-learning-stats__error">
          <AlertTriangle size={18} />
          <div>
            <strong>Unable to load expert statistics</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className="expert-learning-stats__cards">
        <article className="expert-learning-stats__card">
          <div className="expert-learning-stats__icon">
            <Activity size={21} />
          </div>

          <div>
            <span>Total Reviews</span>
            <strong>{total}</strong>
          </div>
        </article>

        <article className="expert-learning-stats__card">
          <div className="expert-learning-stats__icon expert-learning-stats__icon--confirmed">
            <CheckCircle2 size={21} />
          </div>

          <div>
            <span>AI Confirmed</span>
            <strong>{summary.correct_detection}</strong>
          </div>
        </article>

        <article className="expert-learning-stats__card">
          <div className="expert-learning-stats__icon expert-learning-stats__icon--corrected">
            <AlertTriangle size={21} />
          </div>

          <div>
            <span>AI Corrected</span>
            <strong>{summary.incorrect_detection}</strong>
          </div>
        </article>

        <article className="expert-learning-stats__card">
          <div className="expert-learning-stats__icon expert-learning-stats__icon--unknown">
            <HelpCircle size={21} />
          </div>

          <div>
            <span>Unknown Anomalies</span>
            <strong>{summary.unknown_anomaly}</strong>
          </div>
        </article>

        <article className="expert-learning-stats__card">
          <div className="expert-learning-stats__icon expert-learning-stats__icon--inspection">
            <Search size={21} />
          </div>

          <div>
            <span>Further Inspection</span>
            <strong>
              {summary.requires_further_sonar_inspection}
            </strong>
          </div>
        </article>
      </div>

      <div className="expert-learning-stats__analysis">
        <div className="expert-learning-stats__analysis-item">
          <span>Expert confirmation rate</span>
          <strong>{confirmationRate.toFixed(1)}%</strong>
        </div>

        <div className="expert-learning-stats__analysis-item">
          <span>Expert correction rate</span>
          <strong>{correctionRate.toFixed(1)}%</strong>
        </div>

        <div className="expert-learning-stats__analysis-item">
          <span>Feedback records</span>
          <strong>{total}</strong>
        </div>
      </div>

      <div className="expert-learning-stats__guardrail">
        <AlertTriangle size={17} />

        <span>
          These statistics describe recorded expert-review outcomes.
          They do not directly represent the validated accuracy of the
          AI model.
        </span>
      </div>
    </section>
  );
}