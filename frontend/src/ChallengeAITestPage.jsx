import React, { useState } from "react";
import ChallengeAI from "./ChallengeAI";
import "./ChallengeAI.css";

const SAMPLE_DETECTION = {
  class_name: "Shipwreck",
  confidence: 0.91,
  bbox: [100, 120, 300, 280],
};

export default function ChallengeAITestPage() {
  const [lastChallenge, setLastChallenge] = useState(null);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "40px",
        background: "#f1f5f9",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "980px",
          margin: "0 auto",
        }}
      >
        <ChallengeAI
          scanId="SONAR-TEST-001"
          detection={SAMPLE_DETECTION}
          onChallengeSaved={(result) => {
            setLastChallenge(result);
            console.log("Feedback saved:", result);
          }}
        />

        {lastChallenge && (
          <div
            style={{
              marginTop: "18px",
              padding: "16px",
              borderRadius: "14px",
              background: "#ffffff",
              border: "1px solid #dbe3ee",
            }}
          >
            <strong>API Response</strong>

            <pre
              style={{
                marginTop: "10px",
                padding: "12px",
                borderRadius: "10px",
                background: "#0f172a",
                color: "#e2e8f0",
                overflowX: "auto",
                fontSize: "12px",
              }}
            >
              {JSON.stringify(lastChallenge, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}