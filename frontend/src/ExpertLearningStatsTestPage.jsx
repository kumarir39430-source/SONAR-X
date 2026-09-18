import React from "react";
import ExpertLearningStats from "./ExpertLearningStats";

export default function ExpertLearningStatsTestPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "40px",
        boxSizing: "border-box",
        background: "#f1f5f9",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1200px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            marginBottom: "18px",
            color: "#475569",
            fontSize: "13px",
            fontWeight: "600",
          }}
        >
          SONAR-X • Feature 1D Test Environment
        </div>

        <ExpertLearningStats
          apiBaseUrl="http://127.0.0.1:8000"
        />
      </div>
    </main>
  );
}