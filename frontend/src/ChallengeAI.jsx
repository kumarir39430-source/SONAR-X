import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";

const CHALLENGE_OPTIONS = [
  {
    id: "correct_detection",
    title: "Correct classification",
    description: "The AI prediction appears correct.",
    icon: CheckCircle2,
  },
  {
    id: "incorrect_detection",
    title: "Incorrect classification",
    description:
      "The AI detected an object, but the predicted class is wrong.",
    icon: XCircle,
  },
  {
    id: "unknown_anomaly",
    title: "Unknown anomaly",
    description:
      "The target does not confidently match a known class.",
    icon: HelpCircle,
  },
  {
    id: "requires_further_sonar_inspection",
    title: "Requires further sonar inspection",
    description:
      "More sonar evidence is needed before accepting the prediction.",
    icon: Search,
  },
];

function formatConfidence(value) {
  if (
    value === undefined ||
    value === null ||
    Number.isNaN(Number(value))
  ) {
    return "N/A";
  }

  const numeric = Number(value);

  return `${(numeric <= 1 ? numeric * 100 : numeric).toFixed(1)}%`;
}

export default function ChallengeAI({
  scanId = "",
  detection = {
    class_name: "Shipwreck",
    confidence: 0.91,
    bbox: [100, 120, 300, 280],
  },
  apiBaseUrl = "http://127.0.0.1:8000",
  onChallengeSaved,
  compact = false,
}) {
  const [selectedDecision, setSelectedDecision] = useState("");
  const [expertNote, setExpertNote] = useState("");
  const [correctedClass, setCorrectedClass] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  const confidence = useMemo(
    () => formatConfidence(detection?.confidence),
    [detection?.confidence]
  );

  const handleSubmit = async () => {
    if (!selectedDecision) {
      setStatus("error");
      setMessage("Please select an expert decision.");
      return;
    }

    if (!scanId) {
      setStatus("error");
      setMessage("No scan ID is available for this challenge.");
      return;
    }

    if (
      selectedDecision === "incorrect_detection" &&
      !correctedClass.trim()
    ) {
      setStatus("error");
      setMessage(
        "Enter the corrected class for an incorrect classification."
      );
      return;
    }

    setStatus("saving");
    setMessage("");

    const payload = {
      scan_id: scanId,
      detection: detection || {},
      decision: selectedDecision,
      expert_note: expertNote.trim(),
      corrected_class:
        selectedDecision === "incorrect_detection"
          ? correctedClass.trim()
          : null,
    };

    try {
      const response = await fetch(
        `${apiBaseUrl.replace(/\/$/, "")}/assistant/feedback`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(
          data?.detail ||
            data?.message ||
            `Request failed with status ${response.status}`
        );
      }

      setStatus("success");
      setMessage(
        data.message ||
          "Expert feedback recorded successfully."
      );

      if (typeof onChallengeSaved === "function") {
        onChallengeSaved({
          request: payload,
          response: data,
        });
      }
    } catch (error) {
      setStatus("error");
      setMessage(
        error?.message ||
          "Could not connect to the SONAR-X assistant backend."
      );
    }
  };

  const handleReset = () => {
    setSelectedDecision("");
    setExpertNote("");
    setCorrectedClass("");
    setStatus("idle");
    setMessage("");
  };

  return (
    <section
      className={`challenge-ai ${
        compact ? "challenge-ai--compact" : ""
      }`}
    >
      <div className="challenge-ai__header">
        <div>
          <div className="challenge-ai__eyebrow">
            <ShieldCheck size={16} />
            EXPERT-IN-THE-LOOP
          </div>

          <h2>Challenge AI</h2>

          <p>
            Review the AI prediction and record an expert decision.
            The decision is sent to the existing SONAR-X expert
            feedback service.
          </p>
        </div>

        <div className="challenge-ai__badge">
          <AlertTriangle size={16} />
          Human verification
        </div>
      </div>

      <div className="challenge-ai__prediction">
        <div>
          <span>Scan ID</span>
          <strong>{scanId || "Not available"}</strong>
        </div>

        <div>
          <span>AI prediction</span>
          <strong>
            {detection?.class_name || "Unknown"}
          </strong>
        </div>

        <div>
          <span>AI confidence</span>
          <strong>{confidence}</strong>
        </div>

        <div>
          <span>Bounding box</span>
          <strong>
            {Array.isArray(detection?.bbox)
              ? `[${detection.bbox.join(", ")}]`
              : "N/A"}
          </strong>
        </div>
      </div>

      <div className="challenge-ai__question">
        <span>Challenge this prediction</span>

        <h3>
          Does the AI classification match the available sonar
          evidence?
        </h3>
      </div>

      <div className="challenge-ai__options">
        {CHALLENGE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected =
            selectedDecision === option.id;

          return (
            <button
              key={option.id}
              type="button"
              className={`challenge-ai__option ${
                selected
                  ? "challenge-ai__option--selected"
                  : ""
              }`}
              onClick={() => {
                setSelectedDecision(option.id);
                setStatus("idle");
                setMessage("");
              }}
            >
              <span className="challenge-ai__option-icon">
                <Icon size={20} />
              </span>

              <span className="challenge-ai__option-text">
                <strong>{option.title}</strong>
                <small>{option.description}</small>
              </span>

              <span
                className={`challenge-ai__radio ${
                  selected
                    ? "challenge-ai__radio--selected"
                    : ""
                }`}
              />
            </button>
          );
        })}
      </div>

      {selectedDecision === "incorrect_detection" && (
        <div className="challenge-ai__note">
          <label htmlFor="challenge-ai-corrected-class">
            Corrected class
          </label>

          <input
            id="challenge-ai-corrected-class"
            value={correctedClass}
            onChange={(event) => {
              setCorrectedClass(event.target.value);
              setStatus("idle");
              setMessage("");
            }}
            placeholder="Example: Aircraft"
          />
        </div>
      )}

      <div className="challenge-ai__note">
        <label htmlFor="challenge-ai-note">
          Expert note (optional)
        </label>

        <textarea
          id="challenge-ai-note"
          value={expertNote}
          onChange={(event) => {
            setExpertNote(event.target.value);
            setStatus("idle");
            setMessage("");
          }}
          placeholder="Example: Classification needs additional sonar evidence."
          rows={compact ? 3 : 4}
        />
      </div>

      <div className="challenge-ai__footer">
        <div
          className={`challenge-ai__status challenge-ai__status--${status}`}
        >
          {status === "saving" && (
            "Saving expert feedback..."
          )}

          {status === "success" && (
            <>
              <CheckCircle2 size={18} />
              {message}
            </>
          )}

          {status === "error" && (
            <>
              <XCircle size={18} />
              {message}
            </>
          )}

          {status === "idle" && (
            "No expert decision has been submitted yet."
          )}
        </div>

        <div className="challenge-ai__actions">
          {status === "success" && (
            <button
              type="button"
              className="challenge-ai__secondary"
              onClick={handleReset}
            >
              Challenge another prediction
            </button>
          )}

          <button
            type="button"
            className="challenge-ai__primary"
            disabled={
              status === "saving" ||
              !selectedDecision
            }
            onClick={handleSubmit}
          >
            {status === "saving"
              ? "Saving..."
              : "Submit expert challenge"}
          </button>
        </div>
      </div>
    </section>
  );
}