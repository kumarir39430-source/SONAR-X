import React from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, Search, ShieldCheck, UserCheck } from "lucide-react";
import "./ChallengeResult.css";

const DECISION_META = {
  correct_detection: { label: "AI Confirmed", description: "The expert agrees with the AI classification.", icon: CheckCircle2 },
  incorrect_detection: { label: "AI Corrected", description: "The expert has provided a different classification.", icon: AlertTriangle },
  unknown_anomaly: { label: "Unknown Anomaly", description: "The expert could not confidently assign a known class.", icon: HelpCircle },
  requires_further_sonar_inspection: { label: "Further Inspection Required", description: "More sonar evidence is required before accepting the prediction.", icon: Search },
};

function formatConfidence(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "N/A";
  const n = Number(value);
  return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
}

export default function ChallengeResult({ result }) {
  if (!result) return null;

  const request = result.request || {};
  const response = result.response || {};
  const detection = request.detection || {};
  const decision = request.decision || "unknown_anomaly";
  const meta = DECISION_META[decision] || DECISION_META.unknown_anomaly;
  const StatusIcon = meta.icon;
  const expertClass = request.corrected_class || (decision === "correct_detection" ? detection.class_name : decision === "unknown_anomaly" ? "Unknown anomaly" : "Further inspection");

  return (
    <section className="challenge-result">
      <div className="challenge-result__header">
        <div>
          <div className="challenge-result__eyebrow"><ShieldCheck size={16} /> REVIEW OUTCOME</div>
          <h2>AI vs Expert</h2>
          <p>The AI prediction and expert review are shown separately so model confidence is not confused with expert verification.</p>
        </div>
        <div className="challenge-result__verified"><UserCheck size={16} /> Expert review recorded</div>
      </div>

      <div className="challenge-result__comparison">
        <article className="challenge-result__card">
          <div className="challenge-result__card-label">AI PREDICTION</div>
          <div className="challenge-result__class">{detection.class_name || "Unknown"}</div>
          <div className="challenge-result__confidence">{formatConfidence(detection.confidence)} <span>AI confidence</span></div>
          <div className="challenge-result__detail">Bounding box: {Array.isArray(detection.bbox) ? `[${detection.bbox.join(", ")}]` : "N/A"}</div>
        </article>

        <div className="challenge-result__arrow">→</div>

        <article className="challenge-result__card challenge-result__card--expert">
          <div className="challenge-result__card-label">EXPERT DECISION</div>
          <div className="challenge-result__class">{expertClass}</div>
          <div className="challenge-result__confidence challenge-result__confidence--expert"><StatusIcon size={20} /><span>{meta.label}</span></div>
          <div className="challenge-result__detail">{meta.description}</div>
        </article>
      </div>

      <div className="challenge-result__outcome">
        <div className="challenge-result__outcome-icon"><StatusIcon size={22} /></div>
        <div><strong>{meta.label}</strong><p>{meta.description}</p></div>
      </div>

      <div className="challenge-result__metadata">
        <div><span>Scan ID</span><strong>{request.scan_id || "N/A"}</strong></div>
        <div><span>Decision</span><strong>{decision}</strong></div>
        <div><span>Feedback ID</span><strong>{response.feedback?.feedback_id ?? "N/A"}</strong></div>
        <div><span>Audit ID</span><strong>{response.audit?.audit_id ?? "N/A"}</strong></div>
      </div>

      {request.expert_note && <div className="challenge-result__note"><span>Expert note</span><p>{request.expert_note}</p></div>}

      <div className="challenge-result__guardrail"><AlertTriangle size={17} /><span>Expert verification is a human review of the available evidence. AI confidence does not by itself prove correctness.</span></div>
    </section>
  );
}
