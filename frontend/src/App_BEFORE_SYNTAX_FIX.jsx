import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Bot,
  Send,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  Home,
  Layers,
  Loader2,
  Map,
  MapPin,
  Menu,
  PieChart as PieChartIcon,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Target,
  Upload,
  Waves,
  X,
} from "lucide-react";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
} from "react-leaflet";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import ExpertLearningStats from "./ExpertLearningStats";

const API_URL = "http://127.0.0.1:8000";

/* =========================================================
   YOLO CLASS MAPPING
   ========================================================= */

const CLASS_NAMES = {
  0: "Aircraft",
  1: "Fish",
  2: "Rocks/Stones",
  3: "Shipwreck",
};

/*
  Composition grouping.

  This uses the classes returned by the existing YOLO model.
  It is a prototype composition view and does NOT claim that
  every man-made object is confirmed marine waste.
*/
const COMPOSITION_MAP = {
  Aircraft: "Man-made Objects",
  Shipwreck: "Man-made Objects",
  Fish: "Marine Life",
  "Rocks/Stones": "Natural Seabed",
};

const COMPOSITION_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
];

/* =========================================================
   HELPER FUNCTIONS
   ========================================================= */

function getClassName(detection) {
  if (!detection) return "Unknown";

  if (detection.class_name) {
    return detection.class_name;
  }

  const id =
    detection.class_id ??
    detection.classId ??
    detection.cls ??
    detection.class;

  return CLASS_NAMES[id] || `Class ${id ?? "Unknown"}`;
}

function getConfidence(detection) {
  const value =
    detection.confidence_percent ??
    detection.confidence ??
    detection.score ??
    0;

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return number <= 1 ? number * 100 : number;
}

function getBoundingBoxText(detection) {
  const box =
    detection.bounding_box ??
    detection.bbox ??
    detection.box ??
    null;

  if (!box) return "—";

  if (Array.isArray(box)) {
    return `[${box.map((v) => Number(v).toFixed?.(0) ?? v).join(", ")}]`;
  }

  if (typeof box === "object") {
    const x1 = box.x1 ?? box.left ?? box.x ?? 0;
    const y1 = box.y1 ?? box.top ?? box.y ?? 0;
    const x2 = box.x2 ?? box.right ?? 0;
    const y2 = box.y2 ?? box.bottom ?? 0;

    return `[${x1}, ${y1}, ${x2}, ${y2}]`;
  }

  return String(box);
}

function getLatLon(value) {
  if (!value) return null;

  const lat = Number(value.lat ?? value.latitude);
  const lon = Number(
    value.lon ??
      value.lng ??
      value.longitude
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return { lat, lon };
}

function getLocationText(value) {
  const location = getLatLon(value);

  if (!location) {
    return "Not available";
  }

  return `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}`;
}

function normalizeDetections(result) {
  if (!result) return [];

  const detections =
    result.detections ??
    result.results ??
    result.objects ??
    result.predictions ??
    [];

  if (!Array.isArray(detections)) {
    return [];
  }

  return detections.map((detection, index) => ({
    ...detection,
    _index: index + 1,
    class_name: getClassName(detection),
    confidence_percent: getConfidence(detection),
  }));
}

function getDetectionStats(result) {
  const detections = normalizeDetections(result);
  const confidences = detections.map((d) => d.confidence_percent).filter(Number.isFinite);
  const avgConfidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;
  const classes = [...new Set(detections.map((d) => d.class_name).filter(Boolean))];
  return { detections, count: detections.length, classes, avgConfidence };
}

function countDetectionsByClass(scan) {
  const detections = Array.isArray(scan?.detections) ? scan.detections : [];
  return detections.reduce((counts, detection) => {
    const name = getClassName(detection);
    counts[name] = (counts[name] || 0) + 1;
    return counts;
  }, {});
}

function getHistoricalComparison(earlierScan, laterScan) {
  if (!earlierScan || !laterScan) {
    return {
      comparable: false,
      reason: "Two survey scans are required for comparison.",
      classRows: [],
      earlierCount: 0,
      laterCount: 0,
      countDelta: 0,
      earlierAvgConfidence: 0,
      laterAvgConfidence: 0,
      confidenceDelta: 0,
      locationDistanceKm: null,
      locationNote: "Location comparison unavailable.",
    };
  }

  const earlierDetections = Array.isArray(earlierScan.detections)
    ? earlierScan.detections
    : [];
  const laterDetections = Array.isArray(laterScan.detections)
    ? laterScan.detections
    : [];

  const earlierCounts = countDetectionsByClass(earlierScan);
  const laterCounts = countDetectionsByClass(laterScan);
  const classNames = [...new Set([
    ...Object.keys(earlierCounts),
    ...Object.keys(laterCounts),
  ])].sort();

  const allConfidence = (detections) => {
    const values = detections
      .map((detection) => getConfidence(detection))
      .filter((value) => Number.isFinite(value));
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  };

  const earlierLocation = getLatLon(earlierScan.location);
  const laterLocation = getLatLon(laterScan.location);

  let locationDistanceKm = null;
  let locationNote = "Location comparison unavailable.";

  if (earlierLocation && laterLocation) {
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(laterLocation.lat - earlierLocation.lat);
    const dLon = toRad(laterLocation.lon - earlierLocation.lon);
    const lat1 = toRad(earlierLocation.lat);
    const lat2 = toRad(laterLocation.lat);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const distance = 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
    locationDistanceKm = distance;
    locationNote = distance < 0.1
      ? "Coordinates are very close; location is broadly comparable."
      : "Coordinates differ; interpret count changes with location differences in mind.";
  }

  return {
    comparable: true,
    reason: "Comparison uses only the detections recorded in the two selected session scans.",
    classRows: classNames.map((className) => ({
      className,
      earlier: earlierCounts[className] || 0,
      later: laterCounts[className] || 0,
      delta: (laterCounts[className] || 0) - (earlierCounts[className] || 0),
    })),
    earlierCount: earlierDetections.length,
    laterCount: laterDetections.length,
    countDelta: laterDetections.length - earlierDetections.length,
    earlierAvgConfidence: allConfidence(earlierDetections),
    laterAvgConfidence: allConfidence(laterDetections),
    confidenceDelta:
      allConfidence(laterDetections) - allConfidence(earlierDetections),
    locationDistanceKm,
    locationNote,
  };
}

function getChangeLabel(delta) {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function formatLatency(ms) {
  if (!Number.isFinite(ms)) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function getTimeComplexity(model) {
  if (model === "YOLO11n") return "O(P)";
  if (model === "Faster R-CNN") return "O(P + R×H)";
  return "—";
}

function getComplexityDescription(model) {
  if (model === "YOLO11n") {
    return "Single-stage detector; processing grows with image and feature-map size.";
  }
  if (model === "Faster R-CNN") {
    return "Two-stage detector; includes region proposals and ROI processing.";
  }
  return "—";
}

function getComparisonSummary(yoloResult, rcnnResult, yoloLatency, rcnnLatency) {
  const yolo = getDetectionStats(yoloResult);
  const rcnn = getDetectionStats(rcnnResult);
  const sharedClasses = yolo.classes.filter((name) => rcnn.classes.includes(name));
  const unionClasses = [...new Set([...yolo.classes, ...rcnn.classes])];
  const classAgreement = unionClasses.length
    ? Math.round((sharedClasses.length / unionClasses.length) * 100)
    : 0;
  const fastest = Number.isFinite(yoloLatency) && Number.isFinite(rcnnLatency)
    ? yoloLatency < rcnnLatency ? "YOLO11n" : rcnnLatency < yoloLatency ? "Faster R-CNN" : "Tie"
    : "—";
  const higherConfidence = yolo.avgConfidence > rcnn.avgConfidence
    ? "YOLO11n"
    : rcnn.avgConfidence > yolo.avgConfidence ? "Faster R-CNN" : "Tie";
  return { yolo, rcnn, sharedClasses, classAgreement, fastest, higherConfidence };
}

function getAnnotatedUrl(path) {
  if (!path) return "";

  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:")
  ) {
    return path;
  }

  return `${API_URL}${
    path.startsWith("/") ? "" : "/"
  }${path}`;
}

function formatDate(date = new Date()) {
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getBrowserLocation(
  setLocation,
  setLoading,
  setError
) {
  if (!navigator.geolocation) {
    setError(
      "Geolocation is not supported by this browser."
    );
    return;
  }

  setLoading(true);
  setError("");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setLocation({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });

      setLoading(false);
    },
    (error) => {
      setError(
        error.message ||
          "Location permission was not available."
      );

      setLoading(false);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    }
  );
}

/* =========================================================
   LEAFLET MARKER
   ========================================================= */

const sonarMarker = L.divIcon({
  className: "sonar-marker",
  html: `
    <div style="
      width:28px;
      height:28px;
      border-radius:50%;
      background:#2563eb;
      border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,.35);
    "></div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

/* =========================================================
   APP
   ========================================================= */

function App() {
  const [page, setPage] = useState("Dashboard");

  /* Main analysis */
  const [selectedFile, setSelectedFile] =
    useState(null);

  const [analysisResult, setAnalysisResult] =
    useState(null);

  const [analyzed, setAnalyzed] =
    useState(false);

  const [loading, setLoading] =
    useState(false);
  const [reviewedDetections, setReviewedDetections] = useState({});
  const [selectedReview, setSelectedReview] = useState(null);

  /* Faster R-CNN comparison */
  const [rcnnResult, setRcnnResult] = useState(null);
  const [rcnnLoading, setRcnnLoading] = useState(false);
  const [rcnnError, setRcnnError] = useState("");
  const [yoloLatency, setYoloLatency] = useState(null);
  const [rcnnLatency, setRcnnLatency] = useState(null);
  const [analysisDuration, setAnalysisDuration] = useState(null);

  /* Feature 3 — Advanced Marine Intelligence & Decision System */
  const [advancedResult, setAdvancedResult] = useState(null);
  const [advancedLoading, setAdvancedLoading] = useState(false);
  const [advancedError, setAdvancedError] = useState("");

  /* Location-wise survey history */
  const [surveyScans, setSurveyScans] = useState([]);

  /* Historical survey comparison */
  const [comparisonEarlierId, setComparisonEarlierId] = useState("");
  const [comparisonLaterId, setComparisonLaterId] = useState("");

  /* AI Marine Intelligence Assistant */
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantResponse, setAssistantResponse] = useState(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const [assistantSelectedDetection, setAssistantSelectedDetection] = useState(0);
  const [assistantFeedbackStatus, setAssistantFeedbackStatus] = useState("");
  const [assistantExpertNote, setAssistantExpertNote] = useState("");
  const [assistantCorrectedClass, setAssistantCorrectedClass] = useState("");

  const historicalComparison = useMemo(() => {
    const fallbackLater = surveyScans[surveyScans.length - 1] || null;
    const fallbackEarlier = surveyScans[surveyScans.length - 2] || null;
    const later = surveyScans.find((scan) => String(scan.id) === String(comparisonLaterId)) || fallbackLater;
    const earlier = surveyScans.find((scan) => String(scan.id) === String(comparisonEarlierId)) || fallbackEarlier;
    return getHistoricalComparison(earlier, later);
  }, [surveyScans, comparisonEarlierId, comparisonLaterId]);

  /* GPS */
  const [currentLocation, setCurrentLocation] =
    useState(null);

  const [locationLoading, setLocationLoading] =
    useState(false);

  const [locationError, setLocationError] =
    useState("");

  /* Report */
  const [reportInfo, setReportInfo] =
    useState(null);

  /* Hotspot */
  const [hotspotFile, setHotspotFile] =
    useState(null);

  const [hotspotAnalyzed, setHotspotAnalyzed] =
    useState(false);

  const [hotspotLoading, setHotspotLoading] =
    useState(false);

  const [hotspotResult, setHotspotResult] =
    useState(null);

  const [hotspotLocation, setHotspotLocation] =
    useState(null);

  const [
    hotspotLocationLoading,
    setHotspotLocationLoading,
  ] = useState(false);

  const [
    hotspotLocationError,
    setHotspotLocationError,
  ] = useState("");

  /* Get GPS when application starts */
  useEffect(() => {
    getBrowserLocation(
      setCurrentLocation,
      setLocationLoading,
      setLocationError
    );
  }, []);

  /* =======================================================
     MAIN SONAR ANALYSIS
     ======================================================= */

  const handleFile = (file) => {
    if (!file) return;

    setSelectedFile(file);
    setAnalyzed(false);
    setAnalysisResult(null);
    setReportInfo(null);
    setRcnnResult(null);
    setRcnnError("");
    setYoloLatency(null);
    setRcnnLatency(null);
    setAnalysisDuration(null);
    setAdvancedResult(null);
    setAdvancedLoading(false);
    setAdvancedError("");
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    setAnalyzed(false);
    setAnalysisResult(null);
    setRcnnResult(null);
    setRcnnError("");
    setYoloLatency(null);
    setRcnnLatency(null);
    setAnalysisDuration(null);
    setAdvancedResult(null);
    setAdvancedLoading(false);
    setAdvancedError("");
  };

  /* =======================================================
     FEATURE 3 — ADVANCED MARINE INTELLIGENCE
     Additive to the existing YOLO, R-CNN, Expert Review and
     Unknown Anomaly workflows.
     ======================================================= */
  const runAdvancedIntelligence = async (analysisData, sourceFile) => {
    if (!analysisData || !sourceFile) return;

    setAdvancedLoading(true);
    setAdvancedError("");

    try {
      const formData = new FormData();
      formData.append("file", sourceFile);
      formData.append("scan_id", String(analysisData?.scan_id || `SONAR-${Date.now()}`));

      const location =
        getLatLon(analysisData?.geotag) ||
        getLatLon(analysisData?.location) ||
        currentLocation;

      if (location) {
        formData.append("latitude", String(location.lat));
        formData.append("longitude", String(location.lon));
      }

      formData.append("detections", JSON.stringify(normalizeDetections(analysisData)));

      const response = await fetch(`${API_URL}/advanced-intelligence/analyze`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.detail || `Advanced Intelligence backend returned ${response.status}`);
      }

      setAdvancedResult(data);
    } catch (error) {
      console.error("Feature 3 analysis failed:", error);
      setAdvancedError(error?.message || "Advanced Marine Intelligence could not be completed.");
      setAdvancedResult(null);
    } finally {
      setAdvancedLoading(false);
    }
  };

  const analyzeFile = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setRcnnLoading(true);
    setRcnnError("");
    setRcnnResult(null);

    const makeFormData = () => {
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (currentLocation) {
        formData.append("latitude", String(currentLocation.lat));
        formData.append("longitude", String(currentLocation.lon));
      }
      return formData;
    };

    const analysisStartedAt = performance.now();

    const runYolo = async () => {
      const startedAt = performance.now();
      let response = await fetch(`${API_URL}/analyze`, {
        method: "POST", body: makeFormData(),
      });
      if (!response.ok) {
        response = await fetch(`${API_URL}/detect`, {
          method: "POST", body: makeFormData(),
        });
      }
      if (!response.ok) throw new Error(`YOLO backend returned ${response.status}`);
      return { data: await response.json(), elapsedMs: performance.now() - startedAt };
    };

    const runRcnn = async () => {
      const startedAt = performance.now();
      const response = await fetch(`${API_URL}/rcnn-detect`, {
        method: "POST", body: makeFormData(),
      });
      if (!response.ok) throw new Error(`R-CNN backend returned ${response.status}`);
      return { data: await response.json(), elapsedMs: performance.now() - startedAt };
    };

    try {
      const [yoloResult, rcnnResultValue] = await Promise.allSettled([runYolo(), runRcnn()]);

      if (yoloResult.status === "fulfilled") {
        const { data, elapsedMs } = yoloResult.value;
        setYoloLatency(elapsedMs);
        setAnalysisResult(data);
        setAnalyzed(true);

        const scanLocation =
          getLatLon(data?.geotag) ||
          getLatLon(data?.location) ||
          currentLocation;

        setSurveyScans((previousScans) => [
          ...previousScans,
          {
            id: data.scan_id || `SONAR-${Date.now()}`,
            filename: selectedFile.name,
            date: formatDate(),
            time: formatTime(),
            location: scanLocation,
            detections: normalizeDetections(data),
          },
        ]);

        setReportInfo({
          scanId: data.scan_id || `SONAR-${Date.now()}`,
          filename: selectedFile.name,
          date: formatDate(),
          time: formatTime(),
        });

        // Feature 3 consumes the completed YOLO result without changing
        // Feature 1 / Feature 2 state or any existing page workflow.
        runAdvancedIntelligence(data, selectedFile);
      } else {
        console.error("YOLO analysis failed:", yoloResult.reason);
        alert("YOLO analysis failed. Make sure your FastAPI backend is running at http://127.0.0.1:8000.");
      }

      if (rcnnResultValue.status === "fulfilled") {
        setRcnnLatency(rcnnResultValue.value.elapsedMs);
        setRcnnResult(rcnnResultValue.value.data);
      } else {
        console.error("R-CNN analysis failed:", rcnnResultValue.reason);
        setRcnnError(rcnnResultValue.reason?.message || "R-CNN analysis could not be completed.");
      }
    } finally {
      setAnalysisDuration(performance.now() - analysisStartedAt);
      setLoading(false);
      setRcnnLoading(false);
    }
  };

  /* =======================================================
     HOTSPOT
     ======================================================= */

  const handleHotspotFile = (file) => {
    if (!file) return;

    setHotspotFile(file);
    setHotspotAnalyzed(false);
    setHotspotResult(null);
  };

  const analyzeHotspotFile = async () => {
    if (!hotspotFile) return;

    setHotspotLoading(true);

    try {
      const formData = new FormData();

      formData.append(
        "file",
        hotspotFile
      );

      if (hotspotLocation) {
        formData.append(
          "latitude",
          String(hotspotLocation.lat)
        );

        formData.append(
          "longitude",
          String(hotspotLocation.lon)
        );
      }

      const response = await fetch(
        `${API_URL}/waste-hotspot`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error(
          `Backend returned ${response.status}`
        );
      }

      const data = await response.json();

      setHotspotResult(data);
      setHotspotAnalyzed(true);
    } catch (error) {
      console.error(error);

      alert(
        "Hotspot analysis failed. Make sure the /waste-hotspot endpoint exists in your FastAPI backend."
      );
    } finally {
      setHotspotLoading(false);
    }
  };

  const requestHotspotLocation = () => {
    getBrowserLocation(
      setHotspotLocation,
      setHotspotLocationLoading,
      setHotspotLocationError
    );
  };

  /* =======================================================
     AI MARINE INTELLIGENCE ASSISTANT
     ======================================================= */

  const askAssistant = async (questionOverride = null) => {
    const question = String(
      questionOverride ?? assistantQuestion
    ).trim();

    if (!question) return;

    setAssistantQuestion(question);
    setAssistantLoading(true);
    setAssistantError("");
    setAssistantFeedbackStatus("");

    const detections = normalizeDetections(analysisResult);
    const selectedDetection =
      detections[assistantSelectedDetection] || null;

    const latestScan =
      surveyScans.length
        ? surveyScans[surveyScans.length - 1]
        : null;

    const context = {
      scan_id:
        analysisResult?.scan_id ||
        latestScan?.id ||
        null,
      filename:
        analysisResult?.filename ||
        latestScan?.filename ||
        selectedFile?.name ||
        null,
      detections,
      selected_detection: selectedDetection,
      location:
        getLatLon(analysisResult?.geotag) ||
        getLatLon(analysisResult?.location) ||
        latestScan?.location ||
        currentLocation ||
        null,
      hotspot: hotspotResult || null,
      historical_surveys: surveyScans,
      historical_comparison: historicalComparison,
      waste_composition: null,
      source: "SONAR-X frontend",
    };

    try {
      const response = await fetch(
        `${API_URL}/assistant/ask`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question,
            context,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Assistant backend returned ${response.status}`
        );
      }

      const data = await response.json();
      setAssistantResponse(data);
    } catch (error) {
      console.error("Assistant request failed:", error);
      setAssistantError(
        error?.message ||
          "The AI Marine Intelligence Assistant could not be reached."
      );
    } finally {
      setAssistantLoading(false);
    }
  };

  const submitAssistantFeedback = async (
    decision
  ) => {
    const detections = normalizeDetections(analysisResult);
    const detection =
      detections[assistantSelectedDetection] || null;

    if (!detection) {
      setAssistantFeedbackStatus(
        "Select a detection before submitting expert feedback."
      );
      return;
    }

    const scanId =
      analysisResult?.scan_id ||
      surveyScans[surveyScans.length - 1]?.id ||
      `SONAR-${Date.now()}`;

    try {
      setAssistantFeedbackStatus("Saving expert review...");

      const response = await fetch(
        `${API_URL}/assistant/feedback`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            scan_id: scanId,
            detection,
            decision,
            expert_note: assistantExpertNote.trim(),
            corrected_class:
              decision === "incorrect_class"
                ? (assistantCorrectedClass || null)
                : null,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Feedback backend returned ${response.status}`
        );
      }

      const data = await response.json();

      // Also connect the expert outcome to the Advanced Marine Intelligence memory.
      try {
        await fetch(`${API_URL}/advanced-intelligence/expert-feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scan_id: scanId,
            detection,
            decision,
            expert_note: assistantExpertNote.trim(),
            corrected_class: decision === "incorrect_class" ? (assistantCorrectedClass || null) : null,
            source_feedback_id: data.feedback_id || null,
          }),
        });
      } catch (advancedFeedbackError) {
        console.warn("Advanced intelligence feedback sync failed:", advancedFeedbackError);
      }

      setAssistantFeedbackStatus(
        `Expert review saved successfully (feedback ID ${data.feedback_id}).`
      );
    } catch (error) {
      console.error("Assistant feedback failed:", error);

      setAssistantFeedbackStatus(
        error?.message ||
          "Expert review could not be saved."
      );
    }
  };

  /* =======================================================
     RENDER
     ======================================================= */

  return (
    <>
      <GlobalStyles />

      <div className="app-shell">
        <Sidebar
          page={page}
          setPage={setPage}
        />

        <main className="main-area">
          <Topbar page={page} />

          <div className="page-content">
            {page === "Dashboard" && (
              <Dashboard
                setPage={setPage}
                analysisResult={analysisResult}
                reportInfo={reportInfo}
              />
            )}

            {page === "Analyze Sonar" && (
              <AnalyzePage
                selectedFile={selectedFile}
                handleFile={handleFile}
                removeSelectedFile={
                  removeSelectedFile
                }
                analyzeFile={analyzeFile}
                analyzed={analyzed}
                loading={loading}
                analysisResult={analysisResult}
                rcnnResult={rcnnResult}
                rcnnLoading={rcnnLoading}
                rcnnError={rcnnError}
                yoloLatency={yoloLatency}
                rcnnLatency={rcnnLatency}
                analysisDuration={analysisDuration}
                currentLocation={
                  currentLocation
                }
                locationLoading={
                  locationLoading
                }
                locationError={locationError}
                reviewedDetections={reviewedDetections}
                setReviewedDetections={setReviewedDetections}
                selectedReview={selectedReview}
                setSelectedReview={setSelectedReview}
                advancedResult={advancedResult}
                advancedLoading={advancedLoading}
                advancedError={advancedError}
              />
            )}

            {page === "AI Marine Assistant" && (
              <AssistantPage
                question={assistantQuestion}
                setQuestion={setAssistantQuestion}
                response={assistantResponse}
                loading={assistantLoading}
                error={assistantError}
                selectedDetectionIndex={
                  assistantSelectedDetection
                }
                setSelectedDetectionIndex={
                  setAssistantSelectedDetection
                }
                detections={normalizeDetections(
                  analysisResult
                )}
                analysisResult={analysisResult}
                surveyScans={surveyScans}
                historicalComparison={historicalComparison}
                hotspotResult={hotspotResult}
                currentLocation={currentLocation}
                askAssistant={askAssistant}
                submitFeedback={submitAssistantFeedback}
                feedbackStatus={assistantFeedbackStatus}
                 expertNote={assistantExpertNote}
                 setExpertNote={setAssistantExpertNote}
                 correctedClass={assistantCorrectedClass}
                 setCorrectedClass={setAssistantCorrectedClass}
              />
            )}

            {page === "Expert Learning" && (
              <ExpertLearningStats
                apiBaseUrl={API_URL}
              />
            )}

            {page === "Survey Map" && (
              <SurveyMapPage
                analysisResult={
                  analysisResult
                }
                reportInfo={reportInfo}
                surveyScans={surveyScans}
              />
            )}

            {page === "Historical Comparison" && (
              <HistoricalComparisonPage
                surveyScans={surveyScans}
                earlierId={comparisonEarlierId}
                laterId={comparisonLaterId}
                setEarlierId={setComparisonEarlierId}
                setLaterId={setComparisonLaterId}
                comparison={historicalComparison}
              />
            )}

            {page === "Digital Twin" && (
              <DigitalTwinPage
                analysisResult={analysisResult}
                surveyScans={surveyScans}
              />
            )}

            {page === "Waste Hotspots" && (
              <WasteHotspotsPage
                hotspotFile={hotspotFile}
                handleHotspotFile={
                  handleHotspotFile
                }
                analyzeHotspotFile={
                  analyzeHotspotFile
                }
                hotspotAnalyzed={
                  hotspotAnalyzed
                }
                hotspotLoading={
                  hotspotLoading
                }
                hotspotResult={
                  hotspotResult
                }
                hotspotLocation={
                  hotspotLocation
                }
                hotspotLocationLoading={
                  hotspotLocationLoading
                }
                hotspotLocationError={
                  hotspotLocationError
                }
                requestHotspotLocation={
                  requestHotspotLocation
                }
              />
            )}

            {page === "Waste Composition" && (
              <WasteCompositionPage
                analysisResult={
                  analysisResult
                }
                reportInfo={reportInfo}
                setPage={setPage}
              />
            )}

            {page === "Datasets" && (
              <DatasetsPage />
            )}

            {page === "Reports" && (
              <ReportsPage
                analysisResult={
                  analysisResult
                }
                reportInfo={reportInfo}
              />
            )}

            {page === "Settings" && (
              <SimplePage
                title="Settings"
                description="Configure AQUA XPLORE application settings."
                icon={Settings}
              />
            )}
          </div>
        </main>
      </div>
    </>
  );
}

/* =========================================================
   GLOBAL CSS
   ========================================================= */

function GlobalStyles() {
  return (
    <style>{`
      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;

        background: #061826;
        color: #071A2A;
      }

      button,
      input {
        font: inherit;
      }

      button {
        cursor: pointer;
      }

      .app-shell {
        min-height: 100vh;
        display: flex;
        background: #061826;
      }

      /* SIDEBAR */

      .sidebar {
        width: 250px;
        height: 100vh;
        min-height: 0;
        max-height: 100vh;
        position: fixed;
        left: 0;
        top: 0;
        bottom: 0;
        background: #061826;
        color: white;
        padding: 22px 14px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: #234A5B #061826;
        -webkit-overflow-scrolling: touch;
      }

      .sidebar::-webkit-scrollbar {
        width: 7px;
      }

      .sidebar::-webkit-scrollbar-track {
        background: #061826;
      }

      .sidebar::-webkit-scrollbar-thumb {
        background: #234A5B;
        border-radius: 10px;
      }

      .sidebar::-webkit-scrollbar-thumb:hover {
        background: #5E8794;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px 26px;
      }

      .brand-mark {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        background: linear-gradient(
          135deg,
          #008F9C,
          #00E5FF
        );
      }

      .brand-title {
        font-size: 18px;
        font-weight: 800;
        letter-spacing: .4px;
      }

      .brand-subtitle {
        font-size: 9px;
        color: #89B4C0;
        margin-top: 2px;
      }

      .nav-label {
        color: #7FA7B3;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        padding: 10px 12px 7px;
      }

      .nav-item {
        flex: 0 0 auto;
        width: 100%;
        border: 0;
        background: transparent;
        color: #89B4C0;

        display: flex;
        align-items: center;
        gap: 12px;

        padding: 11px 12px;
        border-radius: 10px;
        margin: 2px 0;

        text-align: left;
        font-weight: 600;
        font-size: 13px;
      }

      .nav-item:hover {
        background: #172033;
        color: white;
      }

      .nav-item.active {
        background: #007985;
        color: white;
      }

      /* MAIN */

      .main-area {
        margin-left: 250px;
        width: calc(100% - 250px);
        min-height: 100vh;
      }

      .topbar {
        height: 72px;
        background: white;
        border-bottom: 1px solid #1D3A4A;

        display: flex;
        align-items: center;
        justify-content: space-between;

        padding: 0 30px;

        position: sticky;
        top: 0;
        z-index: 500;
      }

      .topbar-title {
        font-size: 20px;
        font-weight: 800;
      }

      .topbar-right {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .icon-btn {
        border: 1px solid #1D3A4A;
        background: white;

        width: 38px;
        height: 38px;

        border-radius: 10px;

        display: grid;
        place-items: center;

        color: #5E8794;
      }

      .page-content {
        padding: 28px 30px 50px;
        max-width: 1500px;
        margin: auto;
      }

      /* HERO */

      .hero {
        background:
          linear-gradient(
            135deg,
            #071A2A 0%,
            #172554 55%,
            #0369a1 100%
          );

        border-radius: 20px;

        color: white;

        padding: 32px;

        display: flex;
        justify-content: space-between;

        gap: 20px;

        overflow: hidden;
      }

      .hero h1 {
        margin: 0 0 10px;
        font-size: 31px;
      }

      .hero p {
        margin: 0;
        color: #B8DCE5;
        max-width: 640px;
        line-height: 1.6;
      }

      .hero-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      /* BUTTONS */

      .btn {
        border: 0;
        border-radius: 10px;
        padding: 11px 16px;

        font-weight: 700;

        display: inline-flex;
        align-items: center;
        justify-content: center;

        gap: 8px;
      }

      .btn-primary {
        background: #008F9C;
        color: white;
      }

      .btn-primary:hover {
        background: #007985;
      }

      .btn-light {
        background: white;
        color: #071A2A;
      }

      .btn-outline {
        background: white;
        border: 1px solid #29495A;
        color: #234A5B;
      }

      .btn:disabled {
        opacity: .55;
        cursor: not-allowed;
      }

      /* CARDS */

      .card,
      .stat-card {
        background: white;
        border: 1px solid #1D3A4A;
        border-radius: 16px;

        box-shadow:
          0 4px 16px rgba(
            15,
            23,
            42,
            .04
          );
      }

      .stats-grid {
        display: grid;
        grid-template-columns:
          repeat(4, 1fr);

        gap: 16px;

        margin: 22px 0;
      }

      .stat-card {
        padding: 20px;

        display: flex;
        align-items: center;

        gap: 14px;
      }

      .stat-icon {
        width: 44px;
        height: 44px;

        border-radius: 12px;

        display: grid;
        place-items: center;

        background: #103947;
        color: #008F9C;
      }

      .stat-label {
        font-size: 12px;
        color: #7FA7B3;
      }

      .stat-value {
        font-size: 23px;
        font-weight: 800;
        margin-top: 3px;
      }

      .section-grid {
        display: grid;
        grid-template-columns: 1.25fr .75fr;
        gap: 18px;
      }

      .card-header {
        padding: 18px 20px;

        border-bottom: 1px solid #183443;

        display: flex;
        justify-content: space-between;
        align-items: center;

        gap: 10px;
      }

      .card-title {
        font-weight: 800;
        font-size: 15px;
      }

      .card-body {
        padding: 20px;
      }

      .muted {
        color: #7FA7B3;
      }

      .small {
        font-size: 12px;
      }

      .empty-state {
        padding: 45px 20px;
        text-align: center;
        color: #7FA7B3;
      }

      .empty-icon {
        width: 54px;
        height: 54px;

        border-radius: 16px;

        background: #f1f5f9;

        display: grid;
        place-items: center;

        margin: 0 auto 12px;
      }

      /* UPLOAD */

      .upload-zone {
        display: block;

        border: 2px dashed #B8DCE5;

        border-radius: 16px;

        padding: 38px 20px;

        text-align: center;

        background: #0A2233;

        transition: .2s;
      }

      .upload-zone:hover {
        border-color: #60a5fa;
        background: #103947;
      }

      .upload-icon {
        width: 58px;
        height: 58px;

        margin: auto;

        border-radius: 16px;

        background: #164454;
        color: #008F9C;

        display: grid;
        place-items: center;
      }

      .upload-title {
        margin: 13px 0 5px;
        font-weight: 800;
      }

      .file-pill {
        display: flex;
        align-items: center;
        justify-content: space-between;

        gap: 10px;

        border: 1px solid #29495A;
        background: white;

        padding: 11px 13px;

        border-radius: 10px;

        margin-top: 14px;
      }

      /* GPS */

      .gps-box {
        padding: 14px;

        border: 1px solid #164454;

        background: #103947;

        border-radius: 12px;

        display: flex;
        gap: 10px;

        align-items: flex-start;
      }

      .gps-error {
        background: #fff7ed;
        border-color: #fed7aa;
      }

      /* RESULTS */

      .result-image {
        width: 100%;
        max-height: 430px;

        object-fit: contain;

        background: #03111D;

        border-radius: 12px;

        border: 1px solid #1e293b;
      }

      .result-grid {
        display: grid;

        grid-template-columns:
          repeat(3, 1fr);

        gap: 12px;

        margin-top: 16px;
      }

      .result-box {
        border: 1px solid #234154;

        border-radius: 12px;

        padding: 15px;

        background: #0A2233;
      }

      .result-box strong {
        display: block;
        font-size: 20px;
        margin-top: 4px;
      }

      /* TABLE */

      .table-wrap {
        overflow: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      th,
      td {
        padding: 12px 10px;

        border-bottom: 1px solid #183443;

        text-align: left;

        white-space: nowrap;
      }

      th {
        color: #7FA7B3;

        font-size: 11px;

        text-transform: uppercase;

        letter-spacing: .5px;
      }

      .badge {
        display: inline-flex;
        align-items: center;

        gap: 5px;

        border-radius: 999px;

        padding: 5px 9px;

        font-size: 11px;

        font-weight: 700;

        background: #103947;
        color: #007985;
      }

      .confidence {
        min-width: 120px;
      }

      .bar-track {
        height: 7px;

        background: #234154;

        border-radius: 99px;

        overflow: hidden;
      }

      .bar-fill {
        height: 100%;

        border-radius: 99px;

        background: #008F9C;
      }

      /* HEADINGS */

      .page-heading {
        display: flex;

        justify-content: space-between;

        align-items: flex-start;

        gap: 20px;

        margin-bottom: 22px;
      }

      .page-heading h1 {
        margin: 0 0 5px;

        font-size: 27px;
      }

      .page-heading p {
        margin: 0;
        color: #7FA7B3;
      }

      /* MAP */

      .map-card {
        overflow: hidden;
      }

      .map-container {
        height: 480px;
        width: 100%;
      }

      .map-summary {
        display: grid;

        grid-template-columns:
          repeat(3, 1fr);

        gap: 12px;

        margin-bottom: 14px;
      }

      .map-stat {
        padding: 14px;

        border: 1px solid #234154;

        border-radius: 12px;

        background: #0A2233;
      }

      .map-stat strong {
        display: block;
        font-size: 20px;
        margin-top: 4px;
      }


      .map-details-grid {
        display: grid;
        grid-template-columns: minmax(280px, .85fr) minmax(420px, 1.15fr);
        gap: 18px;
        margin-top: 18px;
      }

      .location-readout {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
      }

      .location-readout > div {
        padding: 14px;
        border: 1px solid #234154;
        border-radius: 12px;
        background: #0A2233;
      }

      .location-readout strong {
        display: block;
        margin-top: 5px;
        font-size: 17px;
      }

      .map-data-note {
        margin-top: 18px;
        padding: 14px 16px;
        border: 1px solid #bfdbfe;
        border-radius: 12px;
        background: #103947;
        color: #1e3a8a;
        font-size: 12px;
        line-height: 1.6;
      }

      /* TWO COLUMN */

      .two-col {
        display: grid;

        grid-template-columns: 1fr 1fr;

        gap: 18px;
      }

      /* COMPOSITION */

      .composition-layout {
        display: grid;

        grid-template-columns:
          1fr 1fr;

        gap: 18px;
      }

      .chart-card {
        min-height: 450px;
      }

      .chart-center {
        text-align: center;
      }

      .chart-center strong {
        font-size: 30px;
        display: block;
      }

      .chart-center span {
        color: #7FA7B3;
        font-size: 12px;
      }

      .category-grid {
        display: grid;

        grid-template-columns:
          repeat(3, 1fr);

        gap: 12px;

        margin-top: 18px;
      }

      .category-card {
        border: 1px solid #234154;

        border-radius: 14px;

        padding: 15px;

        background: white;
      }

      .category-top {
        display: flex;

        justify-content: space-between;

        gap: 8px;

        align-items: center;
      }

      .category-name {
        display: flex;

        align-items: center;

        gap: 8px;

        font-weight: 800;

        font-size: 13px;
      }

      .color-dot {
        width: 10px;
        height: 10px;

        border-radius: 50%;
      }

      .category-percent {
        font-size: 20px;

        font-weight: 800;

        margin: 10px 0 4px;
      }

      .category-count {
        font-size: 12px;
        color: #7FA7B3;
      }

      .warning-note {
        margin-top: 18px;

        padding: 13px 15px;

        border-radius: 12px;

        background: #fffbeb;

        border: 1px solid #fde68a;

        color: #92400e;

        font-size: 12px;

        line-height: 1.55;
      }

      /* HOTSPOT */

      .risk-high {
        color: #b91c1c;
        background: #fee2e2;
      }

      .risk-medium {
        color: #b45309;
        background: #fef3c7;
      }

      .risk-low {
        color: #15803d;
        background: #dcfce7;
      }

      .progress-row {
        margin: 15px 0;
      }

      .progress-label {
        display: flex;

        justify-content: space-between;

        font-size: 12px;

        margin-bottom: 7px;
      }

      .progress-track {
        height: 9px;

        background: #234154;

        border-radius: 99px;

        overflow: hidden;
      }

      .progress-fill {
        height: 100%;

        background: #008F9C;

        border-radius: 99px;
      }

      /* REPORT */

      .report-header {
        background: #071A2A;

        color: white;

        border-radius: 16px;

        padding: 24px;

        margin-bottom: 18px;
      }

      .report-meta {
        display: grid;

        grid-template-columns:
          repeat(4, 1fr);

        gap: 12px;

        margin-top: 18px;
      }

      .report-meta div {
        background: rgba(255,255,255,.08);

        padding: 12px;

        border-radius: 10px;
      }

      .report-meta span {
        color: #89B4C0;

        font-size: 10px;

        display: block;

        margin-bottom: 4px;
      }

      .report-meta strong {
        font-size: 13px;
      }

      /* DATASET */

      .dataset-row {
        display: flex;

        align-items: center;

        justify-content: space-between;

        padding: 15px 0;

        border-bottom: 1px solid #183443;
      }

      .dataset-left {
        display: flex;

        align-items: center;

        gap: 12px;
      }

      .dataset-icon {
        width: 42px;
        height: 42px;

        border-radius: 10px;

        background: #103947;

        color: #008F9C;

        display: grid;

        place-items: center;
      }

      .mobile-menu {
        display: none;
      }

      /* DIGITAL TWIN */
      .digital-twin-stage { position: relative; height: 560px; margin: 0 18px 18px; overflow: hidden; border-radius: 18px; background: radial-gradient(circle at 50% 30%, rgba(14,165,233,.18), transparent 35%), linear-gradient(180deg, #071a2d 0%, #08283d 42%, #0b3b50 100%); border: 1px solid #163b52; perspective: 900px; }
      .twin-grid-lines { position: absolute; inset: 18% 5% 4%; opacity: .22; transform: perspective(500px) rotateX(58deg) scale(1.15); background-image: linear-gradient(rgba(125,211,252,.45) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,.45) 1px, transparent 1px); background-size: 44px 44px; transform-origin: center bottom; }
      .twin-horizon { position: absolute; left: 7%; right: 7%; top: 30%; height: 1px; background: rgba(125,211,252,.5); box-shadow: 0 0 24px rgba(56,189,248,.3); }
      .twin-seafloor { position: absolute; left: -8%; right: -8%; bottom: -16%; height: 58%; transform: perspective(500px) rotateX(58deg); transform-origin: center bottom; background: radial-gradient(ellipse at center, rgba(51,65,85,.7), rgba(15,23,42,.95) 72%); border-top: 1px solid rgba(148,163,184,.35); }
      .twin-depth-label { position: absolute; top: 18px; left: 20px; z-index: 3; font-size: 10px; letter-spacing: 1.2px; color: #bae6fd; font-weight: 800; }
      .twin-survey-zone { position: absolute; z-index: 4; width: 34px; height: 34px; border: 1px dashed rgba(125,211,252,.55); border-radius: 50%; display: grid; place-items: center; color: #bae6fd; font-size: 10px; font-weight: 800; background: rgba(14,116,144,.12); }
      .twin-object { position: absolute; z-index: 8; width: 34px; height: 34px; padding: 0; border: 0; background: transparent; transform: translate(-50%, -50%); }
      .twin-object-core { position: absolute; inset: 9px; border-radius: 50%; background: #67e8f9; box-shadow: 0 0 12px #22d3ee, 0 0 28px rgba(34,211,238,.8); }
      .twin-object-pulse { position: absolute; inset: 1px; border-radius: 50%; border: 1px solid rgba(103,232,249,.8); animation: twinPulse 2s infinite; }
      .twin-object-label { position: absolute; top: 35px; left: 50%; transform: translateX(-50%); white-space: nowrap; font-size: 10px; font-weight: 800; color: #e0f2fe; text-shadow: 0 1px 4px #03111D; pointer-events: none; }
      .twin-object.selected .twin-object-core { background: #facc15; box-shadow: 0 0 16px #facc15, 0 0 36px rgba(250,204,21,.75); }
      .twin-empty { position: absolute; z-index: 7; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 8px; color: #bae6fd; text-align: center; max-width: 330px; }
      .twin-empty span { color: #89B4C0; font-size: 12px; line-height: 1.5; }
      @keyframes twinPulse { 0%,100% { transform: scale(.75); opacity: .75; } 50% { transform: scale(1.25); opacity: .15; } }

      @media (max-width: 1100px) {
        .stats-grid {
          grid-template-columns:
            repeat(2, 1fr);
        }

        .section-grid,
        .composition-layout,
        .two-col {
          grid-template-columns: 1fr;
        }

        .category-grid {
          grid-template-columns:
            repeat(2, 1fr);
        }
      }

      @media (max-width: 800px) {
        .sidebar {
          width: 0;
          height: 100vh;
          min-height: 0;
          padding: 0;
          overflow: hidden;
        }

        .main-area {
          margin-left: 0;
          width: 100%;
        }

        .mobile-menu {
          display: grid;
        }

        .topbar {
          padding: 0 15px;
        }

        .page-content {
          padding: 18px 15px 40px;
        }

        .hero {
          padding: 23px;
          flex-direction: column;
        }

        .stats-grid {
          grid-template-columns: 1fr;
        }

        .report-meta {
          grid-template-columns: 1fr 1fr;
        }

        .category-grid {
          grid-template-columns: 1fr;
        }
      }

      @media print {
        .sidebar,
        .topbar,
        .page-heading button {
          display: none !important;
        }

        .main-area {
          margin-left: 0;
          width: 100%;
        }

        .page-content {
          padding: 0;
        }

        body {
          background: white;
        }
      }
    `}
      /* =========================================================
         AQUA XPLORE — DARK OCEAN / AI SONAR THEME
         Existing layouts and functionality intentionally preserved.
         ========================================================= */

      :root {
        color-scheme: dark;
        --aqua-navy: #061826;
        --aqua-teal: #008F9C;
        --aqua-cyan: #00E5FF;
        --aqua-ice: #EAFBFF;
        --aqua-alert: #45F5C3;
        --aqua-surface: #0A2233;
        --aqua-surface-2: #0D2A3A;
        --aqua-border: #234154;
        --aqua-muted: #7FA7B3;
      }

      body {
        background: #061826 !important;
        color: #EAFBFF !important;
      }

      .app-shell {
        background:
          radial-gradient(circle at 80% 0%, rgba(0,229,255,.055), transparent 28%),
          #061826 !important;
      }

      .sidebar {
        background:
          linear-gradient(180deg, #061826 0%, #071A2A 55%, #061826 100%) !important;
        border-right: 1px solid #183443;
        box-shadow: 8px 0 30px rgba(0,0,0,.18);
      }

      .sidebar::-webkit-scrollbar-track {
        background: #061826 !important;
      }

      .sidebar::-webkit-scrollbar-thumb {
        background: #234A5B !important;
      }

      .sidebar::-webkit-scrollbar-thumb:hover {
        background: #008F9C !important;
      }

      .brand {
        border-bottom: 1px solid rgba(0,229,255,.10);
        margin-bottom: 8px;
      }

      .brand-mark {
        background:
          radial-gradient(circle at 30% 25%, rgba(0,229,255,.55), transparent 35%),
          linear-gradient(135deg, #008F9C 0%, #00E5FF 100%) !important;
        color: #061826 !important;
        box-shadow:
          0 0 0 1px rgba(0,229,255,.25),
          0 0 24px rgba(0,229,255,.20);
      }

      .brand-title {
        color: #EAFBFF !important;
        letter-spacing: .7px;
      }

      .brand-subtitle {
        color: #7FA7B3 !important;
      }

      .nav-label {
        color: #5E8794 !important;
      }

      .nav-item {
        color: #89B4C0 !important;
      }

      .nav-item:hover {
        background: rgba(0,143,156,.12) !important;
        color: #EAFBFF !important;
      }

      .nav-item.active {
        background:
          linear-gradient(90deg, rgba(0,143,156,.28), rgba(0,229,255,.10)) !important;
        color: #00E5FF !important;
        box-shadow: inset 3px 0 0 #00E5FF;
      }

      .main-area {
        background: transparent !important;
      }

      .topbar {
        background: rgba(6,24,38,.92) !important;
        border-bottom: 1px solid #183443 !important;
        backdrop-filter: blur(14px);
      }

      .topbar-title {
        color: #EAFBFF !important;
      }

      .icon-btn {
        background: #0A2233 !important;
        border-color: #234154 !important;
        color: #B8DCE5 !important;
      }

      .icon-btn:hover {
        border-color: #008F9C !important;
        color: #00E5FF !important;
        box-shadow: 0 0 16px rgba(0,229,255,.10);
      }

      .page-content {
        background: transparent !important;
      }

      .page-heading h1,
      .card-title,
      .stat-value,
      .upload-title,
      .category-name,
      .report-meta strong,
      .result-box strong,
      .dataset-left strong,
      .map-stat strong,
      .location-readout strong {
        color: #EAFBFF !important;
      }

      .page-heading p,
      .muted,
      .small,
      .stat-label,
      .category-count {
        color: #7FA7B3 !important;
      }

      .card,
      .stat-card,
      .category-card {
        background:
          linear-gradient(145deg, rgba(10,34,51,.96), rgba(7,26,42,.96)) !important;
        border-color: #234154 !important;
        box-shadow:
          0 10px 28px rgba(0,0,0,.18),
          0 0 0 1px rgba(0,229,255,.015);
      }

      .card-header {
        border-bottom-color: #183443 !important;
      }

      .stat-icon {
        background: rgba(0,229,255,.09) !important;
        color: #00E5FF !important;
        border: 1px solid rgba(0,229,255,.12);
      }

      .btn-primary {
        background: linear-gradient(135deg, #008F9C, #00B8C7) !important;
        color: #061826 !important;
        box-shadow: 0 0 18px rgba(0,229,255,.12);
      }

      .btn-primary:hover {
        background: linear-gradient(135deg, #00A7B5, #00E5FF) !important;
      }

      .btn-light,
      .btn-outline {
        background: #0D2A3A !important;
        border-color: #29495A !important;
        color: #EAFBFF !important;
      }

      .btn-light:hover,
      .btn-outline:hover {
        border-color: #008F9C !important;
        color: #00E5FF !important;
      }

      .upload-zone {
        background:
          radial-gradient(circle at 50% 0%, rgba(0,229,255,.06), transparent 45%),
          #0A2233 !important;
        border-color: #29495A !important;
      }

      .upload-zone:hover {
        border-color: #00E5FF !important;
        background: #0D2A3A !important;
        box-shadow: inset 0 0 28px rgba(0,229,255,.04);
      }

      .upload-icon {
        background: rgba(0,229,255,.09) !important;
        color: #00E5FF !important;
        border: 1px solid rgba(0,229,255,.12);
      }

      .file-pill,
      .result-box,
      .map-stat,
      .location-readout > div,
      .dataset-row {
        background: #0A2233 !important;
        border-color: #234154 !important;
        color: #EAFBFF !important;
      }

      .gps-box {
        background: rgba(0,229,255,.06) !important;
        border-color: rgba(0,229,255,.18) !important;
      }

      .gps-box svg,
      .map-data-note svg {
        color: #00E5FF !important;
      }

      .table-wrap table,
      table {
        color: #EAFBFF !important;
      }

      th,
      td {
        border-bottom-color: #183443 !important;
      }

      th {
        color: #7FA7B3 !important;
      }

      .badge {
        background: rgba(0,229,255,.09) !important;
        color: #00E5FF !important;
        border: 1px solid rgba(0,229,255,.14);
      }

      .bar-track,
      .progress-track {
        background: #183443 !important;
      }

      .bar-fill,
      .progress-fill {
        background: linear-gradient(90deg, #008F9C, #00E5FF) !important;
        box-shadow: 0 0 10px rgba(0,229,255,.18);
      }

      .empty-icon {
        background: rgba(0,229,255,.07) !important;
        color: #00E5FF !important;
      }

      .map-data-note {
        background: rgba(0,229,255,.055) !important;
        border-color: rgba(0,229,255,.16) !important;
        color: #B8DCE5 !important;
      }

      .warning-note {
        background: rgba(245,158,11,.08) !important;
        border-color: rgba(245,158,11,.28) !important;
        color: #F6C76B !important;
      }

      .risk-low {
        color: #45F5C3 !important;
        background: rgba(69,245,195,.09) !important;
      }

      .risk-medium {
        color: #F6C76B !important;
        background: rgba(245,158,11,.09) !important;
      }

      .risk-high {
        color: #FF8B8B !important;
        background: rgba(220,38,38,.10) !important;
      }

      .report-header {
        background:
          radial-gradient(circle at 85% 0%, rgba(0,229,255,.12), transparent 30%),
          linear-gradient(135deg, #071A2A, #082D3D) !important;
        border: 1px solid #163B52;
      }

      .report-meta div {
        background: rgba(0,229,255,.055) !important;
        border: 1px solid rgba(0,229,255,.08);
      }

      .report-meta span {
        color: #7FA7B3 !important;
      }

      .result-image {
        box-shadow: inset 0 0 35px rgba(0,229,255,.04);
      }

      /* Sonar/AI visual language: cyan = active AI/sonar state. */
      .sonar-marker {
        filter: drop-shadow(0 0 8px rgba(0,229,255,.45));
      }

      .sonar-marker > div {
        background: #00E5FF !important;
        border-color: #EAFBFF !important;
        box-shadow:
          0 0 0 3px rgba(0,229,255,.10),
          0 0 18px rgba(0,229,255,.55) !important;
      }

      /* Feature 3 digital-twin surfaces retain their ocean depth,
         while active intelligence accents use electric cyan. */
      .digital-twin-stage {
        border-color: #163B52 !important;
        box-shadow: inset 0 0 55px rgba(0,229,255,.035);
      }

      .twin-grid-lines {
        background-image:
          linear-gradient(rgba(0,229,255,.28) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,229,255,.28) 1px, transparent 1px) !important;
      }

      input,
      textarea,
      select {
        background: #071A2A !important;
        color: #EAFBFF !important;
        border-color: #29495A !important;
      }

      input:focus,
      textarea:focus,
      select:focus {
        outline: none;
        border-color: #00E5FF !important;
        box-shadow: 0 0 0 3px rgba(0,229,255,.08) !important;
      }

      ::selection {
        background: rgba(0,229,255,.28);
        color: #EAFBFF;
      }
</style>
  );
}

/* =========================================================
   SIDEBAR
   ========================================================= */

function Sidebar({ page, setPage }) {
  const items = [
    {
      label: "Dashboard",
      icon: Home,
    },
    {
      label: "Analyze Sonar",
      icon: Target,
    },
    {
      label: "AI Marine Assistant",
      icon: Bot,
    },
    {
      label: "Expert Learning",
      icon: ShieldCheck,
    },
    {
      label: "Survey Map",
      icon: Map,
    },
    {
      label: "Historical Comparison",
      icon: RefreshCw,
    },
    {
      label: "Digital Twin",
      icon: Layers,
    },
    {
      label: "Waste Hotspots",
      icon: ShieldAlert,
    },
    {
      label: "Waste Composition",
      icon: PieChartIcon,
    },
    {
      label: "Datasets",
      icon: Database,
    },
    {
      label: "Reports",
      icon: FileText,
    },
    {
      label: "Settings",
      icon: Settings,
    },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Waves size={22} />
        </div>

        <div>
          <div className="brand-title">
            AQUA XPLORE
          </div>

          <div className="brand-subtitle">
            AI UNDERWATER INTELLIGENCE
          </div>
        </div>
      </div>

      <div className="nav-label">
        Workspace
      </div>

      {items.map((item) => {
        const Icon = item.icon;

        return (
          <button
            key={item.label}
            className={`nav-item ${
              page === item.label
                ? "active"
                : ""
            }`}
            onClick={() =>
              setPage(item.label)
            }
          >
            <Icon size={17} />
            {item.label}
          </button>
        );
      })}
    </aside>
  );
}

/* =========================================================
   TOPBAR
   ========================================================= */

function Topbar({ page }) {
  return (
    <header className="topbar">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button className="icon-btn mobile-menu">
          <Menu size={18} />
        </button>

        <div className="topbar-title">
          {page}
        </div>
      </div>

      <div className="topbar-right">
        <button
          className="icon-btn"
          title="System status"
        >
          <Activity size={18} />
        </button>

        <button
          className="icon-btn"
          title="Notifications"
        >
          <Bell size={18} />
        </button>
      </div>
    </header>
  );
}

/* =========================================================
   DASHBOARD
   ========================================================= */


function AssistantPage({
  question,
  setQuestion,
  response,
  loading,
  error,
  selectedDetectionIndex,
  setSelectedDetectionIndex,
  detections,
  analysisResult,
  surveyScans,
  historicalComparison,
  hotspotResult,
  currentLocation,
  askAssistant,
  submitFeedback,
  feedbackStatus,
  expertNote,
  setExpertNote,
  correctedClass,
  setCorrectedClass,
}) {
  const quickQuestions = [
    "What was detected in this survey?",
    "Which object has highest risk?",
    "Which detections are low confidence?",
    "Why was this detection classified?",
    "What evidence supports the prediction?",
    "Which detections require expert verification?",
    "Which area should be inspected first?",
  ];

  const selectedDetection =
    detections[selectedDetectionIndex] || null;

  const annotatedImage = getAnnotatedUrl(
    analysisResult?.annotated_image
  );

  const boundingBox =
    selectedDetection?.bbox ||
    selectedDetection?.bounding_box ||
    null;

  const [imageSize, setImageSize] = useState({
    width: 0,
    height: 0,
  });

  const confidenceText =
    response?.confidence?.level || "—";

  const evidenceStrength =
    response?.confidence?.evidence_strength || "—";

  const riskScore =
    Number(response?.risk?.risk_score);

  const priority =
    response?.risk?.priority || "—";

  const locationText =
    response?.location ||
    getLocationText(
      analysisResult?.geotag ||
        analysisResult?.location ||
        currentLocation
    );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>AI Marine Intelligence Assistant</h1>
          <p>
            Expert-in-the-loop analysis grounded in AQUA XPLORE
            detections, confidence, location, risk and
            available survey context.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(280px, 0.85fr) minmax(420px, 1.45fr)",
          gap: 18,
          alignItems: "start",
        }}
      >
        <div
          className="card"
          style={{
            position: "sticky",
            top: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                background: "rgba(37,99,235,.10)",
              }}
            >
              <Bot size={22} />
            </div>

            <div>
              <h3 style={{ margin: 0 }}>
                Survey context
              </h3>
              <p
                className="small"
                style={{ margin: "4px 0 0" }}
              >
                Live context from the existing AQUA XPLORE
                session.
              </p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 10,
            }}
          >
            <div>
              <strong>Scan</strong>
              <div className="small">
                {analysisResult?.scan_id ||
                  "No scan analyzed yet"}
              </div>
            </div>

            <div>
              <strong>Image</strong>
              <div className="small">
                {analysisResult?.filename ||
                  "No image selected"}
              </div>
            </div>

            <div>
              <strong>Detections</strong>
              <div className="small">
                {detections.length}
              </div>
            </div>

            <div>
              <strong>Survey location</strong>
              <div className="small">
                {locationText}
              </div>
            </div>

            <div>
              <strong>Historical scans in session</strong>
              <div className="small">
                {surveyScans.length}
              </div>
            </div>

            <div>
              <strong>Hotspot context</strong>
              <div className="small">
                {hotspotResult
                  ? "Available"
                  : "Not available"}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop: "1px solid rgba(148,163,184,.22)",
            }}
          >
            <label
              style={{
                display: "block",
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              Detection to review
            </label>

            <select
              value={selectedDetectionIndex}
              onChange={(event) =>
                setSelectedDetectionIndex(
                  Number(event.target.value)
                )
              }
              disabled={!detections.length}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                background: "white",
              }}
            >
              {detections.length ? (
                detections.map(
                  (detection, index) => (
                    <option
                      key={`${detection.class_name}-${index}`}
                      value={index}
                    >
                      Target {index + 1} —{" "}
                      {detection.class_name} —{" "}
                      {Math.round(
                        detection.confidence_percent
                      )}
                      %
                    </option>
                  )
                )
              ) : (
                <option value={0}>
                  No detections available
                </option>
              )}
            </select>

            {selectedDetection && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 10,
                  background: "#f8fafc",
                }}
              >
                <div className="small">
                  <strong>Class:</strong>{" "}
                  {selectedDetection.class_name}
                </div>
                <div
                  className="small"
                  style={{ marginTop: 5 }}
                >
                  <strong>Confidence:</strong>{" "}
                  {Math.round(
                    selectedDetection.confidence_percent
                  )}
                  %
                </div>
                <div
                  className="small"
                  style={{ marginTop: 5 }}
                >
                  <strong>Bounding box:</strong>{" "}
                  {getBoundingBoxText(
                    selectedDetection
                  )}
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 12,
              background: "#f8fafc",
              border: "1px solid rgba(148,163,184,.22)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              Evidence availability
            </div>
            <div className="small" style={{ lineHeight: 1.65 }}>
              <div>✓ AI detection and class prediction</div>
              <div>✓ Detection bounding box</div>
              <div>
                {locationText && locationText !== "Not available"
                  ? "✓ Survey GPS location"
                  : "○ Survey GPS location unavailable"}
              </div>
              <div>○ Acoustic-shadow measurement unavailable</div>
              <div>○ Target-shape measurement unavailable</div>
              <div>○ Seabed/environment evidence unavailable</div>
            </div>
            <div className="small" style={{ marginTop: 8 }}>
              Unavailable evidence is not inferred or fabricated by the assistant.
            </div>
          </div>

          {annotatedImage && selectedDetection && boundingBox && (
            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 12,
                background: "#f8fafc",
                border: "1px solid rgba(148,163,184,.22)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 10 }}>
                Selected target evidence view
              </div>
              <div className="small" style={{ marginBottom: 10 }}>
                Target {selectedDetectionIndex + 1} — {selectedDetection.class_name}
              </div>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  overflow: "hidden",
                  borderRadius: 10,
                  background: "#0f172a",
                }}
              >
                <img
                  src={annotatedImage}
                  alt="Annotated sonar with selected target"
                  onLoad={(event) =>
                    setImageSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                  style={{ display: "block", width: "100%", height: "auto" }}
                />
                {imageSize.width > 0 && imageSize.height > 0 && (
                  <div
                    aria-label="Selected target bounding box"
                    style={{
                      position: "absolute",
                      left: `${Math.max(0, Number(boundingBox[0])) / imageSize.width * 100}%`,
                      top: `${Math.max(0, Number(boundingBox[1])) / imageSize.height * 100}%`,
                      width: `${Math.max(0, Number(boundingBox[2]) - Number(boundingBox[0])) / imageSize.width * 100}%`,
                      height: `${Math.max(0, Number(boundingBox[3]) - Number(boundingBox[1])) / imageSize.height * 100}%`,
                      border: "3px solid #2563eb",
                      boxSizing: "border-box",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                The blue outline marks the selected target using the image dimensions supplied by the detection context.
              </div>
            </div>
          )}

          {/* =====================================================
              STEP 4 — OPERATIONAL LOCATION + HISTORY CONTEXT
             ===================================================== */}
          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 12,
              background: "#f8fafc",
              border: "1px solid rgba(148,163,184,.22)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              Operational context
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: "white",
                  border: "1px solid rgba(148,163,184,.18)",
                }}
              >
                <div className="small" style={{ fontWeight: 700 }}>
                  Survey coordinate
                </div>
                <div className="small" style={{ marginTop: 5 }}>
                  {locationText}
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Source-scan GPS; not an exact target coordinate.
                </div>
              </div>

              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: "white",
                  border: "1px solid rgba(148,163,184,.18)",
                }}
              >
                <div className="small" style={{ fontWeight: 700 }}>
                  Historical context
                </div>
                <div className="small" style={{ marginTop: 5 }}>
                  {surveyScans.length > 1
                    ? `${surveyScans.length} scans available in this session.`
                    : "No prior comparison scan available in this session."}
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Historical change is reported only when comparable survey data exists.
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                height: 230,
                borderRadius: 10,
                overflow: "hidden",
                border: "1px solid rgba(148,163,184,.25)",
                background: "#e2e8f0",
              }}
            >
              {getLatLon(analysisResult?.geotag || analysisResult?.location || currentLocation) ? (
                <MapContainer
                  center={getLatLon(analysisResult?.geotag || analysisResult?.location || currentLocation)}
                  zoom={11}
                  scrollWheelZoom={false}
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer
                    attribution='&copy; OpenStreetMap contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker
                    position={getLatLon(analysisResult?.geotag || analysisResult?.location || currentLocation)}
                  >
                    <Popup>
                      AQUA XPLORE survey location. This marker represents the scan coordinate, not an exact target position.
                    </Popup>
                  </Marker>
                </MapContainer>
              ) : (
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                    textAlign: "center",
                    padding: 20,
                  }}
                  className="small"
                >
                  Survey GPS unavailable — map context cannot be shown.
                </div>
              )}
            </div>

            {historicalComparison?.comparable && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 10,
                  background: "white",
                  border: "1px solid rgba(148,163,184,.18)",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  Historical comparison
                </div>
                <div className="small">
                  Detection count change: {getChangeLabel(historicalComparison.countDelta)}
                </div>
                <div className="small" style={{ marginTop: 4 }}>
                  Average confidence change: {historicalComparison.confidenceDelta >= 0 ? "+" : ""}{historicalComparison.confidenceDelta.toFixed(1)} percentage points
                </div>
                <div className="small" style={{ marginTop: 4 }}>
                  {historicalComparison.locationNote}
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Comparison is descriptive and does not establish causation or a confirmed waste increase.
                </div>
              </div>
            )}

            {hotspotResult && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 10,
                  background: "white",
                  border: "1px solid rgba(148,163,184,.18)",
                }}
              >
                <div className="small" style={{ fontWeight: 700 }}>
                  Waste hotspot context
                </div>
                <div className="small" style={{ marginTop: 5 }}>
                  Hotspot analysis is available for this session. Use it as supporting context, not as proof that an individual detected target is waste.
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: 18,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                marginBottom: 9,
              }}
            >
              Expert review
            </div>

            <textarea
              value={expertNote}
              onChange={(event) => setExpertNote(event.target.value)}
              placeholder="Optional expert note..."
              rows={3}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                resize: "vertical",
                marginBottom: 10,
              }}
            />

            <select
              value={correctedClass}
              onChange={(event) => setCorrectedClass(event.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                background: "white",
                marginBottom: 10,
              }}
            >
              <option value="">Corrected class (only if class is incorrect)</option>
              {Object.values(CLASS_NAMES).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <button
                className="btn btn-light"
                onClick={() =>
                  submitFeedback(
                    "correct_detection"
                  )
                }
                disabled={!selectedDetection}
              >
                <CheckCircle2 size={16} />
                Correct detection
              </button>

              <button
                className="btn btn-light"
                onClick={() =>
                  submitFeedback(
                    "incorrect_detection"
                  )
                }
                disabled={!selectedDetection}
              >
                <X size={16} />
                Incorrect detection
              </button>

              <button
                className="btn btn-light"
                onClick={() =>
                  submitFeedback(
                    "correct_class"
                  )
                }
                disabled={!selectedDetection}
              >
                <CheckCircle2 size={16} />
                Correct class
              </button>

              <button
                className="btn btn-light"
                onClick={() =>
                  submitFeedback(
                    "incorrect_class"
                  )
                }
                disabled={!selectedDetection}
              >
                <X size={16} />
                Incorrect class
              </button>

              <button
                className="btn btn-light"
                onClick={() =>
                  submitFeedback(
                    "unknown_anomaly"
                  )
                }
                disabled={!selectedDetection}
              >
                <ShieldAlert size={16} />
                Unknown anomaly
              </button>

              <button
                className="btn btn-light"
                onClick={() =>
                  submitFeedback(
                    "requires_further_sonar_inspection"
                  )
                }
                disabled={!selectedDetection}
              >
                <Target size={16} />
                Further sonar
              </button>
            </div>

            {feedbackStatus && (
              <p
                className="small"
                style={{
                  margin: "10px 0 0",
                }}
              >
                {feedbackStatus}
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>
                  Ask the marine analyst
                </h3>
                <p
                  className="small"
                  style={{ margin: "5px 0 0" }}
                >
                  Answers are generated from the supplied
                  AQUA XPLORE context and curated marine-sonar
                  knowledge.
                </p>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 14,
              }}
            >
              {quickQuestions.map(
                (quickQuestion) => (
                  <button
                    key={quickQuestion}
                    className="btn btn-light"
                    style={{
                      fontSize: 12,
                      padding: "8px 10px",
                    }}
                    onClick={() =>
                      askAssistant(
                        quickQuestion
                      )
                    }
                    disabled={loading}
                  >
                    {quickQuestion}
                  </button>
                )
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
              }}
            >
              <input
                value={question}
                onChange={(event) =>
                  setQuestion(
                    event.target.value
                  )
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey
                  ) {
                    event.preventDefault();
                    askAssistant();
                  }
                }}
                placeholder="Ask about detections, evidence, risk, uncertainty or inspection priority..."
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "12px 14px",
                  borderRadius: 10,
                  border:
                    "1px solid #cbd5e1",
                }}
              />

              <button
                className="btn btn-primary"
                onClick={() =>
                  askAssistant()
                }
                disabled={
                  loading ||
                  !question.trim()
                }
              >
                <Send size={16} />
                {loading
                  ? "Analyzing..."
                  : "Ask"}
              </button>
            </div>

            {error && (
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 10,
                  background: "#fff7ed",
                  border:
                    "1px solid #fed7aa",
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div
            className="card"
            style={{
              marginTop: 18,
            }}
          >
            {!response ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <Bot size={24} />
                </div>
                <h3
                  style={{
                    margin: "0 0 7px",
                  }}
                >
                  Assistant findings will appear here
                </h3>
                <p className="small">
                  Analyze a sonar image first, then ask a
                  question to build a grounded marine-intelligence
                  finding.
                </p>
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 18,
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      display: "grid",
                      placeItems: "center",
                      background:
                        "rgba(22,163,74,.10)",
                    }}
                  >
                    <Activity size={20} />
                  </div>

                  <div>
                    <div
                      className="small"
                      style={{
                        fontWeight: 700,
                      }}
                    >
                      AI Marine Intelligence Finding
                    </div>
                    <h2
                      style={{
                        margin: "3px 0 0",
                      }}
                    >
                      {response.finding ||
                        "No finding available"}
                    </h2>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(4, minmax(0, 1fr))",
                    gap: 10,
                    marginBottom: 18,
                  }}
                >
                  <div className="stat-card">
                    <div className="small">
                      AI confidence
                    </div>
                    <strong>
                      {Number.isFinite(
                        Number(
                          response.confidence
                            ?.ai_confidence
                        )
                      )
                        ? `${Math.round(
                            Number(
                              response.confidence
                                .ai_confidence
                            ) * 100
                          )}%`
                        : "—"}
                    </strong>
                  </div>

                  <div className="stat-card">
                    <div className="small">
                      Evidence
                    </div>
                    <strong>
                      {evidenceStrength}
                    </strong>
                  </div>

                  <div className="stat-card">
                    <div className="small">
                      Risk
                    </div>
                    <strong>
                      {Number.isFinite(riskScore)
                        ? riskScore.toFixed(1)
                        : "—"}
                    </strong>
                  </div>

                  <div className="stat-card">
                    <div className="small">
                      Priority
                    </div>
                    <strong>
                      {priority}
                    </strong>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 16,
                  }}
                >
                  <div>
                    <h3>Finding</h3>
                    <p>
                      {response.finding ||
                        "No finding available."}
                    </p>

                    <h3>Evidence</h3>
                    <ul>
                      {(response.evidence || [])
                        .map(
                          (item, index) => (
                            <li key={index}>
                              {item}
                            </li>
                          )
                        )}
                    </ul>
                  </div>

                  <div>
                    <h3>Confidence</h3>
                    <p>
                      <strong>
                        AI confidence:
                      </strong>{" "}
                      {response.confidence
                        ?.ai_confidence ?? "—"}
                    </p>
                    <p>
                      <strong>Level:</strong>{" "}
                      {confidenceText}
                    </p>
                    <p>
                      <strong>
                        Evidence strength:
                      </strong>{" "}
                      {evidenceStrength}
                    </p>

                    <h3>Risk</h3>
                    <p>
                      <strong>
                        Risk score:
                      </strong>{" "}
                      {Number.isFinite(riskScore)
                        ? riskScore.toFixed(1)
                        : "—"}
                    </p>
                    <p>
                      <strong>
                        Environmental risk:
                      </strong>{" "}
                      {response.risk
                        ?.environmental_risk ||
                        "unknown"}
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 16,
                    borderTop:
                      "1px solid rgba(148,163,184,.22)",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "1fr 1fr",
                      gap: 16,
                    }}
                  >
                    <div>
                      <h3>Location</h3>
                      <p>
                        {locationText}
                      </p>
                    </div>

                    <div>
                      <h3>Expert status</h3>
                      <p>
                        {response.expert_status ||
                          "Pending"}
                      </p>
                    </div>
                  </div>

                  {response.uncertainty_alert && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 13,
                        borderRadius: 10,
                        background:
                          "#fff7ed",
                        border:
                          "1px solid #fed7aa",
                      }}
                    >
                      <strong>
                        Uncertainty alert
                      </strong>
                      <div
                        className="small"
                        style={{
                          marginTop: 4,
                        }}
                      >
                        The available evidence is not
                        sufficient to treat the prediction
                        as verified.
                      </div>
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: 14,
                      padding: 14,
                      borderRadius: 10,
                      background: "#f8fafc",
                    }}
                  >
                    <strong>
                      Recommendation
                    </strong>
                    <p
                      style={{
                        margin:
                          "6px 0 0",
                      }}
                    >
                      {response.recommendation ||
                        "Insufficient evidence — expert verification required."}
                    </p>
                  </div>
                </div>

                {Array.isArray(response.knowledge) &&
                  response.knowledge.length > 0 && (
                    <div
                      style={{
                        marginTop: 18,
                        paddingTop: 16,
                        borderTop:
                          "1px solid rgba(148,163,184,.22)",
                      }}
                    >
                      <h3>
                        Retrieved marine-sonar knowledge
                      </h3>

                      <div
                        style={{
                          display: "grid",
                          gap: 10,
                        }}
                      >
                        {response.knowledge.map(
                          (item, index) => (
                            <div
                              key={`${item.source_file}-${index}`}
                              style={{
                                padding: 12,
                                borderRadius: 10,
                                background:
                                  "#f8fafc",
                              }}
                            >
                              <strong>
                                {item.title}
                              </strong>
                              <div
                                className="small"
                                style={{
                                  marginTop: 4,
                                }}
                              >
                                {item.source_file}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                {response.warning && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 12,
                      borderRadius: 10,
                      background:
                        "#f8fafc",
                    }}
                  >
                    {response.warning}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Dashboard({
  setPage,
  analysisResult,
  reportInfo,
}) {
  const detections =
    normalizeDetections(
      analysisResult
    );

  const objectCount =
    detections.length;

  const classes = new Set(
    detections.map(
      (detection) =>
        detection.class_name
    )
  ).size;

  const averageConfidence =
    detections.length
      ? Math.round(
          detections.reduce(
            (sum, detection) =>
              sum +
              detection.confidence_percent,
            0
          ) / detections.length
        )
      : 0;

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Detect what lies beneath
            the surface.
          </h1>

          <p>
            AQUA XPLORE uses AI-powered
            side-scan sonar analysis
            to detect, classify and
            visualize underwater
            targets for faster marine
            surveying.
          </p>
        </div>

        <div className="hero-actions">
          <button
            className="btn btn-light"
            onClick={() =>
              setPage("Analyze Sonar")
            }
          >
            <Upload size={17} />
            Analyze Sonar
          </button>

          <button
            className="btn btn-primary"
            onClick={() =>
              setPage(
                "Waste Composition"
              )
            }
          >
            <PieChartIcon size={17} />
            View Composition
          </button>
        </div>
      </section>

      <div className="stats-grid">
        <StatCard
          icon={Target}
          label="Detected Targets"
          value={objectCount}
        />

        <StatCard
          icon={Layers}
          label="Target Classes"
          value={classes}
        />

        <StatCard
          icon={Gauge}
          label="AI Confidence"
          value={
            detections.length
              ? `${averageConfidence}%`
              : "—"
          }
        />

        <StatCard
          icon={MapPin}
          label="GPS Status"
          value={
            analysisResult
              ? "Available"
              : "Ready"
          }
        />
      </div>

      <div className="section-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              Recent Analysis
            </div>

            <button
              className="btn btn-outline"
              onClick={() =>
                setPage("Analyze Sonar")
              }
            >
              New Scan
            </button>
          </div>

          <div className="card-body">
            {reportInfo ? (
              <div className="dataset-row">
                <div className="dataset-left">
                  <div className="dataset-icon">
                    <Waves size={20} />
                  </div>

                  <div>
                    <strong>
                      {reportInfo.filename}
                    </strong>

                    <div className="muted small">
                      {reportInfo.date} ·{" "}
                      {reportInfo.time}
                    </div>
                  </div>
                </div>

                <span className="badge">
                  <CheckCircle2 size={12} />
                  Analyzed
                </span>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <Target size={22} />
                </div>

                <strong>
                  No sonar scan yet
                </strong>

                <p className="small">
                  Upload a sonar image
                  from Analyze Sonar
                  to begin.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">
              AI Models
            </div>
          </div>

          <div className="card-body">
            <ModelRow
              icon={Target}
              name="YOLO Detector"
              description="Underwater object detection"
              status="Active"
            />

            <ModelRow
              icon={Target}
              name="R-CNN Detector"
              description="Faster R-CNN comparison model"
              status="Active"
            />

            <ModelRow
              icon={Layers}
              name="Segmentation Pipeline"
              description="Ready for integration"
              status="Ready"
            />
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon">
        <Icon size={20} />
      </div>

      <div>
        <div className="stat-label">
          {label}
        </div>

        <div className="stat-value">
          {value}
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  icon: Icon,
  name,
  description,
  status,
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 0",
        borderBottom:
          "1px solid #eef2f7",
      }}
    >
      <div className="dataset-icon">
        <Icon size={19} />
      </div>

      <div style={{ flex: 1 }}>
        <strong
          style={{
            fontSize: 13,
          }}
        >
          {name}
        </strong>

        <div className="muted small">
          {description}
        </div>
      </div>

      <span className="badge">
        {status}
      </span>
    </div>
  );
}

/* =========================================================
   ANALYZE SONAR
   ========================================================= */

function AnalyzePage({
  selectedFile,
  handleFile,
  removeSelectedFile,
  analyzeFile,
  analyzed,
  loading,
  analysisResult,
  rcnnResult,
  rcnnLoading,
  rcnnError,
  yoloLatency,
  rcnnLatency,
  analysisDuration,
  currentLocation,
  locationLoading,
  locationError,

  reviewedDetections,
  setReviewedDetections,
  selectedReview,
  setSelectedReview,
  advancedResult,
  advancedLoading,
  advancedError,
}) {
      const selectDetectionForReview = (detection, index) => {
    setSelectedReview({
      detection,
      index,
    });
  };
  const handleExpertDecision = async (index, decision) => {
  const detection = detections[index];

  if (!detection) {
    return;
  }

  try {
    const response = await fetch(
      "http://127.0.0.1:8000/assistant/feedback",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: decision,
          detection: detection,
          scan_id: analysisResult?.scan_id || null,
          expert_note: "",
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.detail || "Failed to save expert feedback."
      );
    }

    setReviewedDetections((previous) => ({
      ...previous,
      [index]: {
        decision: decision,
        detection: detection,
      },
    }));

    setSelectedReview(null);

  } catch (error) {
    console.error(
      "Expert feedback error:",
      error
    );
  }
};
  const detections =
    normalizeDetections(
      analysisResult
    );

  const annotatedImage =
    getAnnotatedUrl(
      analysisResult?.annotated_image
    );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Analyze Sonar
          </h1>

          <p>
            Upload a side-scan sonar
            image and compare YOLO11n
            with Faster R-CNN.
          </p>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              Sonar Image Upload
            </div>
          </div>

          <div className="card-body">
            <label
              className="upload-zone"
              style={{
                display: "block",
              }}
            >
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) =>
                  handleFile(
                    event.target
                      .files?.[0]
                  )
                }
              />

              <div className="upload-icon">
                <Upload size={25} />
              </div>

              <div className="upload-title">
                {selectedFile
                  ? "Change sonar image"
                  : "Upload sonar image"}
              </div>

              <div className="muted small">
                JPG, JPEG or PNG
                side-scan sonar image
              </div>
            </label>

            {selectedFile && (
              <div className="file-pill">
                <div>
                  <strong
                    style={{
                      fontSize: 13,
                    }}
                  >
                    {selectedFile.name}
                  </strong>

                  <div className="muted small">
                    {(
                      selectedFile.size /
                      1024 /
                      1024
                    ).toFixed(2)}{" "}
                    MB
                  </div>
                </div>

                <button
                  className="icon-btn"
                  onClick={
                    removeSelectedFile
                  }
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <div
              className={`gps-box ${
                locationError
                  ? "gps-error"
                  : ""
              }`}
              style={{
                marginTop: 15,
              }}
            >
              <MapPin size={18} />

              <div>
                <strong
                  style={{
                    fontSize: 13,
                  }}
                >
                  Survey location
                </strong>

                <div
                  className="small"
                  style={{
                    marginTop: 3,
                  }}
                >
                  {locationLoading
                    ? "Getting current GPS location..."
                    : currentLocation
                    ? `${currentLocation.lat.toFixed(
                        6
                      )}, ${currentLocation.lon.toFixed(
                        6
                      )}`
                    : locationError ||
                      "GPS location not available"}
                </div>
              </div>
            </div>

            <button
              className="btn btn-primary"
              style={{
                width: "100%",
                marginTop: 15,
              }}
              disabled={
                !selectedFile ||
                loading
              }
              onClick={analyzeFile}
            >
              {loading ? (
                <>
                  <Loader2 size={17} />
                  Analyzing...
                </>
              ) : (
                <>
                  <Target size={17} />
                  Analyze with YOLO + R-CNN
                </>
              )}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">
              Analysis Result
            </div>

            {analyzed && (
              <span className="badge">
                <CheckCircle2 size={12} />
                Complete
              </span>
            )}
          </div>

          <div className="card-body">
            {!analyzed ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <Target size={22} />
                </div>

                <strong>
                  Waiting for analysis
                </strong>

                <p className="small">
                  Upload a sonar image
                  and click Analyze
                  with YOLO + R-CNN.
                </p>
              </div>
            ) : (
              <>
                {annotatedImage ? (
                  <img
                    className="result-image"
                    src={annotatedImage}
                    alt="YOLO annotated sonar"
                  />
                ) : (
                  <div className="empty-state">
                    Annotated image was
                    not returned by the
                    backend.
                  </div>
                )}

                <div className="result-grid">
                  <div className="result-box">
                    <span className="muted small">
                      Targets
                    </span>

                    <strong>
                      {detections.length}
                    </strong>
                  </div>

                  <div className="result-box">
                    <span className="muted small">
                      Classes
                    </span>

                    <strong>
                      {
                        new Set(
                          detections.map(
                            (d) =>
                              d.class_name
                          )
                        ).size
                      }
                    </strong>
                  </div>

                  <div className="result-box">
                    <span className="muted small">
                      Confidence
                    </span>

                    <strong>
                      {detections.length
                        ? `${Math.round(
                            detections.reduce(
                              (sum, d) =>
                                sum +
                                d.confidence_percent,
                              0
                            ) /
                              detections.length
                          )}%`
                        : "0%"}
                    </strong>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {analyzed && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-header">
            <div>
              <div className="card-title">AI Model Comparison</div>
              <div className="muted small" style={{ marginTop: 4 }}>
                Per-image inference comparison between the two detection pipelines.
              </div>
            </div>
            <span className="badge">YOLO11n vs Faster R-CNN</span>
          </div>
          <div className="card-body">
            {(() => {
              const comparison = getComparisonSummary(analysisResult, rcnnResult, yoloLatency, rcnnLatency);
              const rcnnAvailable = Boolean(rcnnResult);
              return (
                <>
                  <div className="result-grid">
                    <div className="result-box">
                      <span className="muted small">YOLO11n</span>
                      <strong>{comparison.yolo.count} targets</strong>
                      <div className="muted small" style={{ marginTop: 5 }}>Avg. confidence: {Math.round(comparison.yolo.avgConfidence)}%</div>
                      <div className="muted small" style={{ marginTop: 3 }}>Inference: {formatLatency(yoloLatency)}</div>
                    </div>
                    <div className="result-box">
                      <span className="muted small">Faster R-CNN</span>
                      {rcnnLoading ? <strong>Analyzing...</strong> : rcnnAvailable ? (
                        <>
                          <strong>{comparison.rcnn.count} targets</strong>
                          <div className="muted small" style={{ marginTop: 5 }}>Avg. confidence: {Math.round(comparison.rcnn.avgConfidence)}%</div>
                          <div className="muted small" style={{ marginTop: 3 }}>Inference: {formatLatency(rcnnLatency)}</div>
                        </>
                      ) : <strong>Unavailable</strong>}
                    </div>
                    <div className="result-box">
                      <span className="muted small">Class agreement</span>
                      <strong>{rcnnAvailable ? `${comparison.classAgreement}%` : "—"}</strong>
                      <div className="muted small" style={{ marginTop: 5 }}>
                        {rcnnAvailable ? (comparison.sharedClasses.length ? `Shared: ${comparison.sharedClasses.join(", ")}` : "No shared detected classes") : "Waiting for R-CNN result"}
                      </div>
                    </div>
                  </div>

                  <div className="result-grid" style={{ marginTop: 12 }}>
                    <div className="result-box">
                      <span className="muted small">Faster model</span>
                      <strong>{rcnnAvailable ? comparison.fastest : "—"}</strong>
                    </div>
                    <div className="result-box">
                      <span className="muted small">Higher avg. confidence</span>
                      <strong>{rcnnAvailable ? comparison.higherConfidence : "—"}</strong>
                    </div>
                    <div className="result-box">
                      <span className="muted small">Total pipeline time</span>
                      <strong>{formatLatency(analysisDuration)}</strong>
                    </div>
                  </div>

                  <div className="card" style={{ marginTop: 16, border: "1px solid #dbeafe", boxShadow: "none" }}>
                    <div className="card-header">
                      <div>
                        <div className="card-title">Performance &amp; Computational Complexity</div>
                        <div className="muted small" style={{ marginTop: 4 }}>
                          Actual per-image timing from this browser session, plus a simplified architectural complexity view.
                        </div>
                      </div>
                      <span className="badge">Timing + Complexity</span>
                    </div>
                    <div className="card-body">
                      <div className="result-grid">
                        <div className="result-box">
                          <span className="muted small">YOLO11n time</span>
                          <strong>{formatLatency(yoloLatency)}</strong>
                          <div className="muted small" style={{ marginTop: 5 }}>Time complexity: {getTimeComplexity("YOLO11n")}</div>
                          <div className="muted small" style={{ marginTop: 3 }}>{getComplexityDescription("YOLO11n")}</div>
                        </div>
                        <div className="result-box">
                          <span className="muted small">Faster R-CNN time</span>
                          <strong>{formatLatency(rcnnLatency)}</strong>
                          <div className="muted small" style={{ marginTop: 5 }}>Time complexity: {getTimeComplexity("Faster R-CNN")}</div>
                          <div className="muted small" style={{ marginTop: 3 }}>{getComplexityDescription("Faster R-CNN")}</div>
                        </div>
                        <div className="result-box">
                          <span className="muted small">End-to-end analysis time</span>
                          <strong>{formatLatency(analysisDuration)}</strong>
                          <div className="muted small" style={{ marginTop: 5 }}>Measured wall-clock time for the concurrent comparison requests.</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <div className="small" style={{ lineHeight: 1.55 }}>
                          <strong>Complexity note:</strong> P represents image/feature-map processing work; R represents region proposals and H represents ROI processing. These are simplified architectural descriptions, not formal FLOP-level complexity proofs.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 7 }}>SIH presentation note</div>
                    <div className="muted small" style={{ lineHeight: 1.55 }}>
                      YOLO11n is the lightweight detector for rapid sonar screening. Faster R-CNN is an independent two-stage comparison model.
                      The confidence and latency values above are measurements for this uploaded image; they should not be presented as model accuracy or mAP.
                    </div>
                  </div>
                </>
              );
            })()}
            {rcnnError && <div className="gps-box gps-error" style={{ marginTop: 15 }}>
              <div><strong style={{ fontSize: 13 }}>R-CNN comparison unavailable</strong><div className="small" style={{ marginTop: 3 }}>{rcnnError}</div></div>
            </div>}
          </div>
        </div>
      )}

      {analyzed && rcnnResult && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-header">
            <div className="card-title">R-CNN Detection Details</div>
            <span className="badge">Faster R-CNN</span>
          </div>
          <div className="card-body table-wrap">
            {normalizeDetections(rcnnResult).length === 0 ? <div className="empty-state">No objects were detected by Faster R-CNN.</div> : <table>
              <thead><tr><th>#</th><th>Class</th><th>Confidence</th><th>Bounding Box</th><th>Location</th></tr></thead>
              <tbody>{normalizeDetections(rcnnResult).map((detection, index) => <tr key={`rcnn-${detection._index || index}`}>
                <td>{index + 1}</td><td><span className="badge">{detection.class_name}</span></td>
                <td><div className="confidence"><div style={{ fontWeight: 700, marginBottom: 5 }}>{Math.round(detection.confidence_percent)}%</div><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, detection.confidence_percent))}%` }} /></div></div></td>
                <td>{getBoundingBoxText(detection)}</td>
                <td>{getLocationText(detection.location || rcnnResult?.location || rcnnResult?.geotag)}</td>
              </tr>)}</tbody>
            </table>}
          </div>
        </div>
      )}

      {analyzed && (
        <div
          className="card"
          style={{
            marginTop: 18,
          }}
        >
          <div className="card-header">
            <div className="card-title">
              Detection Details
            </div>
          </div>

          <div className="card-body table-wrap">
            {detections.length === 0 ? (
              <div className="empty-state">
                No objects were
                detected in this
                image.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Class</th>
                    <th>Confidence</th>
                    <th>Bounding Box</th>
                    <th>Location</th>
                  </tr>
                </thead>

                <tbody>
                  {detections.map(
                    (detection, index) => (
                      <tr
                        key={
                          detection._index ||
                          index
                        }
                      >
                        <td>
                          {index + 1}
                        </td>

                        <td>
                          <span className="badge">
                            {
                              detection.class_name
                            }
                          </span>
                        </td>

                        <td>
                          <div className="confidence">
                            <div
                              style={{
                                fontWeight: 700,
                                marginBottom: 5,
                              }}
                            >
                              {Math.round(
                                detection.confidence_percent
                              )}
                              %
                            </div>

                            <div className="bar-track">
                              <div
                                className="bar-fill"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    Math.max(
                                      0,
                                      detection.confidence_percent
                                    )
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        </td>

                        <td>
                          {getBoundingBoxText(
                            detection
                          )}
                        </td>

                        <td>
                          {getLocationText(
                            detection.location ||
                              analysisResult?.location ||
                              analysisResult?.geotag
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}
             {/*=====================================================
                FEATURE 2 — EXPERT REVIEW
                ===================================================== */}

            {analysisResult &&
              detections &&
              detections.length > 0 && (
                <div className="expert-review-panel">

                  <h3>Expert Review</h3>

                  <p className="expert-review-subtitle">
                    Review AI detections and provide expert feedback.
                  </p>

                  {detections.map(
                    (detection, index) => (
                      <div
                        key={`review-${index}`}
                        className="expert-review-card"
                      >

                        <div className="expert-review-info">

                          <strong>
                            Detection {index + 1}:{" "}
                            {detection.class_name}
                          </strong>

                          <span>
                            Confidence:{" "}
                            {Math.round(
                              detection.confidence_percent
                            )}
                            %
                          </span>

                          <span>
                            Status:{" "}
                            {reviewedDetections[index]
                              ?.decision ||
                              "Pending Review"}
                          </span>

                        </div>

                        <div className="expert-review-actions">

  <button
    type="button"
    onClick={() =>
      selectDetectionForReview(
        detection,
        index
      )
    }
  >
    Review Detection
  </button>

  {selectedReview &&
    selectedReview.index === index && (
      <div className="expert-decision-buttons">

        <button
          type="button"
          onClick={() =>
            handleExpertDecision(
              index,
              "correct_detection"
            )
          }
        >
          ✅ Correct Detection
        </button>

        <button
          type="button"
          onClick={() =>
            handleExpertDecision(
              index,
              "incorrect_detection"
            )
          }
        >
          ❌ Incorrect Detection
        </button>

        <button
          type="button"
          onClick={() =>
            handleExpertDecision(
              index,
              "unknown_anomaly"
            )
          }
        >
          ⚠️ Unknown Anomaly
        </button>

        <button
          type="button"
          onClick={() =>
            handleExpertDecision(
              index,
              "requires_further_sonar_inspection"
            )
          }
        >
          🔎 Further Sonar Inspection
        </button>

      </div>
    )}

</div>

                      </div>
                    )
                  )}

                </div>
              )}
          </div>
        </div>
      )}
      {(advancedLoading || advancedResult || advancedError) && (
        <AdvancedIntelligencePanel
          result={advancedResult}
          loading={advancedLoading}
          error={advancedError}
        />
      )}
    </>
  );
}

/* =========================================================
   FEATURE 3 — ADVANCED MARINE INTELLIGENCE & DECISION SYSTEM
   ========================================================= */
function AdvancedIntelligencePanel({ result, loading, error }) {
  const [tab, setTab] = useState("overview");
  const [history, setHistory] = useState([]);
  const [graph, setGraph] = useState(null);
  const [synthetic, setSynthetic] = useState({ noise: 20, contrast: 60, shadow_strength: 50 });
  const [syntheticResult, setSyntheticResult] = useState(null);
  const [toolLoading, setToolLoading] = useState(false);

  const detections = Array.isArray(result?.detections) ? result.detections : [];
  const reliability = result?.reliability || {};
  const seabed = result?.seabed || {};
  const timeMachine = result?.time_machine || {};
  const digitalTwin = result?.digital_twin || {};
  const surveyPlan = result?.next_survey_plan || {};
  const cleanup = result?.cleanup_mission || {};
  const hotspot = result?.hotspot_prediction || {};
  const graphInfo = result?.knowledge_graph || {};
  const expert = result?.expert_learning || {};
  const lab = result?.synthetic_sonar_lab || {};

  const loadHistory = async () => {
    setToolLoading(true);
    try {
      const response = await fetch(`${API_URL}/advanced-intelligence/history`);
      const data = await response.json();
      setHistory(Array.isArray(data?.surveys) ? data.surveys : []);
    } catch (_) {
      setHistory([]);
    } finally {
      setToolLoading(false);
    }
  };

  const loadGraph = async () => {
    setToolLoading(true);
    try {
      const response = await fetch(`${API_URL}/advanced-intelligence/knowledge-graph`);
      const data = await response.json();
      setGraph(data?.graph || null);
    } catch (_) {
      setGraph(null);
    } finally {
      setToolLoading(false);
    }
  };

  const runSyntheticLab = async () => {
    setToolLoading(true);
    try {
      const response = await fetch(`${API_URL}/advanced-intelligence/synthetic-lab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(synthetic),
      });
      const data = await response.json();
      setSyntheticResult(data?.simulation || null);
    } catch (_) {
      setSyntheticResult(null);
    } finally {
      setToolLoading(false);
    }
  };

  const tabs = [
    ["overview", "Overview"],
    ["evidence", "Evidence & Risk"],
    ["time", "Ocean Time Machine"],
    ["twin", "4D Digital Twin"],
    ["planning", "Decision Planning"],
    ["graph", "Knowledge Graph"],
    ["lab", "Synthetic Sonar Lab"],
    ["monitor", "Reliability Monitor"],
  ];

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-header">
        <div>
          <div className="card-title">Advanced Marine Intelligence &amp; Decision System</div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Feature 3 — evidence-aware analysis, seabed context, uncertainty, object memory and decision support.
          </div>
        </div>
        <span className="badge">Feature 3</span>
      </div>
      <div className="card-body">
        {loading && (
          <div className="gps-box" style={{ marginBottom: 14 }}>
            <Loader2 size={17} />
            <div><strong style={{ fontSize: 13 }}>Running advanced intelligence...</strong><div className="small" style={{ marginTop: 3 }}>Building evidence, seabed context, risk, fingerprints and survey recommendations.</div></div>
          </div>
        )}
        {error && (
          <div className="gps-box gps-error" style={{ marginBottom: 14 }}>
            <ShieldAlert size={17} />
            <div><strong style={{ fontSize: 13 }}>Feature 3 could not be completed</strong><div className="small" style={{ marginTop: 3 }}>{error}</div></div>
          </div>
        )}
        {result && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
              {tabs.map(([key, label]) => <button key={key} type="button" className={`secondary-btn ${tab === key ? "active" : ""}`} onClick={() => { setTab(key); if (key === "time") loadHistory(); if (key === "graph") loadGraph(); }}>{label}</button>)}
            </div>

            {tab === "overview" && <>
              <div className="result-grid">
                <div className="result-box"><span className="muted small">AI reliability</span><strong>{Number.isFinite(Number(reliability.score)) ? `${Math.round(Number(reliability.score))}%` : "—"}</strong><div className="muted small" style={{ marginTop: 4 }}>{reliability.status || "Prototype assessment"}</div></div>
                <div className="result-box"><span className="muted small">Seabed context</span><strong>{seabed.type || "—"}</strong><div className="muted small" style={{ marginTop: 4 }}>{seabed.guidance || "Prototype rule-based adaptation"}</div></div>
                <div className="result-box"><span className="muted small">Advanced objects</span><strong>{detections.length}</strong><div className="muted small" style={{ marginTop: 4 }}>Evidence-aware records</div></div>
                <div className="result-box"><span className="muted small">Expert learning</span><strong>{expert.feedback_records ?? 0}</strong><div className="muted small" style={{ marginTop: 4 }}>Feedback records connected</div></div>
              </div>
              <div className="result-grid" style={{ marginTop: 16 }}>
                <div className="result-box"><span className="muted small">Ocean Time Machine</span><strong>{timeMachine.historical_scan_count ?? 0} scans</strong><div className="muted small" style={{ marginTop: 4 }}>{timeMachine.summary || "Historical context ready"}</div></div>
                <div className="result-box"><span className="muted small">4D Digital Twin</span><strong>{digitalTwin.object_count ?? detections.length} objects</strong><div className="muted small" style={{ marginTop: 4 }}>{digitalTwin.status || "Prototype state model"}</div></div>
                <div className="result-box"><span className="muted small">Hotspot prediction</span><strong>{hotspot.priority || hotspot.level || "Prototype"}</strong><div className="muted small" style={{ marginTop: 4 }}>{hotspot.note || "Decision-support proxy"}</div></div>
                <div className="result-box"><span className="muted small">Knowledge graph</span><strong>{graphInfo.node_count ?? 0} nodes</strong><div className="muted small" style={{ marginTop: 4 }}>{graphInfo.edge_count ?? 0} relationships</div></div>
              </div>
            </>}

            {tab === "evidence" && <>
              <div className="result-grid">
                <div className="result-box"><span className="muted small">Image reliability</span><strong>{Math.round(Number(reliability.score || 0))}%</strong><div className="muted small" style={{ marginTop: 4 }}>{reliability.recommendation}</div></div>
                <div className="result-box"><span className="muted small">Contrast proxy</span><strong>{Math.round(Number(reliability.contrast_proxy || 0))}</strong><div className="muted small" style={{ marginTop: 4 }}>Image-texture signal</div></div>
                <div className="result-box"><span className="muted small">Shadow-aware targets</span><strong>{detections.filter(d => d.acoustic_shadow?.present).length}</strong><div className="muted small" style={{ marginTop: 4 }}>Prototype shadow heuristic</div></div>
                <div className="result-box"><span className="muted small">High-priority targets</span><strong>{detections.filter(d => d.risk?.risk_level === "High").length}</strong><div className="muted small" style={{ marginTop: 4 }}>Confidence is not risk</div></div>
              </div>
              <div className="table-wrap" style={{ marginTop: 16 }}><table><thead><tr><th>#</th><th>Fingerprint</th><th>Class</th><th>Confidence</th><th>Shadow</th><th>Evidence</th><th>Risk</th><th>Priority</th></tr></thead><tbody>{detections.length ? detections.map((d, i) => <tr key={`advanced-${i}`}><td>{i + 1}</td><td><strong>{d.fingerprint_id || "—"}</strong></td><td>{d.class_name || "Unknown"}</td><td>{Math.round(Number(d.confidence_percent || 0))}%</td><td>{d.acoustic_shadow?.strength || "—"}</td><td>{d.evidence?.strength || "—"} ({Math.round(Number(d.evidence?.evidence_score || 0))})</td><td>{d.risk?.risk_level || "—"} ({Math.round(Number(d.risk?.risk_score || 0))})</td><td>{d.risk?.priority || "—"}</td></tr>) : <tr><td colSpan="8">No detections in this scan.</td></tr>}</tbody></table></div>
              <div className="gps-box" style={{ marginTop: 14 }}><div><strong style={{ fontSize: 13 }}>Evidence guardrail</strong><div className="small" style={{ marginTop: 4 }}>Acoustic-shadow and seabed outputs are prototype image heuristics. They do not estimate physical height, orientation, pollution concentration or hazard severity without calibrated sonar/environment data.</div></div></div>
            </>}

            {tab === "time" && <>
              <div className="card" style={{ boxShadow: "none", border: "1px solid #e2e8f0" }}><div className="card-header"><div><div className="card-title">Ocean Time Machine</div><div className="muted small">Browse stored advanced-intelligence survey states and fingerprint continuity.</div></div><button type="button" className="secondary-btn" onClick={loadHistory}>{toolLoading ? "Loading..." : "Refresh"}</button></div><div className="card-body table-wrap">{history.length ? <table><thead><tr><th>Scan</th><th>Time</th><th>Objects</th><th>Reliability</th><th>Seabed</th></tr></thead><tbody>{history.map(s => <tr key={s.scan_id}><td>{s.scan_id}</td><td>{s.timestamp ? new Date(s.timestamp).toLocaleString() : "—"}</td><td>{s.detections?.length || 0}</td><td>{Math.round(Number(s.reliability?.score || 0))}%</td><td>{s.seabed?.type || "—"}</td></tr>)}</tbody></table> : <div className="empty-state">No stored historical scans yet. Analyze more sonar images to build the timeline.</div>}</div></div>
              <div className="gps-box" style={{ marginTop: 14 }}><div><strong style={{ fontSize: 13 }}>Current comparison</strong><div className="small" style={{ marginTop: 4 }}>{timeMachine.summary || "Historical context ready"} {timeMachine.new_fingerprint_count != null ? `New fingerprint candidates in this scan: ${timeMachine.new_fingerprint_count}.` : ""}</div></div></div>
            </>}

            {tab === "twin" && <>
              <div className="digital-twin-stage" style={{ minHeight: 290 }}><div className="twin-grid-lines" /><div className="twin-depth-label">4D PROTOTYPE STATE — LOCATION + TIME + OBJECT</div><div className="twin-horizon" /><div className="twin-seafloor" />
                {detections.length ? detections.map((d, i) => <div key={`advanced-twin-${i}`} className="twin-object selected" style={{ left: `${18 + (i * 67) / Math.max(1, detections.length - 1 || 1)}%`, top: `${42 + (i % 3) * 14}%` }} title={d.fingerprint_id || "Object"}><span className="twin-object-pulse" /><span className="twin-object-core" /><span className="twin-object-label">{d.class_name || "Unknown"}</span></div>) : <div className="twin-empty"><Layers size={28} /><strong>No twin objects yet</strong><span>Run sonar analysis to populate the 4D state model.</span></div>}
              </div>
              <div className="result-grid" style={{ marginTop: 16 }}><div className="result-box"><span className="muted small">Survey</span><strong>{result.scan_id || "—"}</strong></div><div className="result-box"><span className="muted small">Objects</span><strong>{digitalTwin.object_count ?? detections.length}</strong></div><div className="result-box"><span className="muted small">Latitude</span><strong>{digitalTwin.location?.latitude ?? "—"}</strong></div><div className="result-box"><span className="muted small">Longitude</span><strong>{digitalTwin.location?.longitude ?? "—"}</strong></div></div>
              <div className="gps-box" style={{ marginTop: 14 }}><div><strong style={{ fontSize: 13 }}>Twin boundary</strong><div className="small" style={{ marginTop: 4 }}>The interactive layer tracks survey time, source location and object identity. It does not invent target depth or bathymetric elevation.</div></div></div>
            </>}

            {tab === "planning" && <>
              <div className="result-grid"><div className="result-box"><span className="muted small">Next-survey urgency</span><strong>{surveyPlan.urgency || "—"}</strong><div className="muted small" style={{ marginTop: 4 }}>{surveyPlan.recommendation || "—"}</div></div><div className="result-box"><span className="muted small">Hotspot priority</span><strong>{hotspot.level || hotspot.priority || "—"}</strong><div className="muted small" style={{ marginTop: 4 }}>Score {Number.isFinite(Number(hotspot.score)) ? Math.round(Number(hotspot.score)) : "—"}</div></div></div>
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}><div style={{ padding: 14, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}><strong style={{ fontSize: 13 }}>AI Next-Survey Planner</strong><div className="small" style={{ marginTop: 6, lineHeight: 1.55 }}>{surveyPlan.recommendation || "Prototype survey recommendation generated from current evidence."}</div></div><div style={{ padding: 14, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}><strong style={{ fontSize: 13 }}>Cleanup Mission Planner</strong><div className="small" style={{ marginTop: 6, lineHeight: 1.55 }}>{cleanup.recommendation || cleanup.summary || "Prototype mission-planning guidance; not an operational navigation route."}</div>{cleanup.target_fingerprints?.length ? <div className="small" style={{ marginTop: 7 }}>Prioritized fingerprints: {cleanup.target_fingerprints.join(", ")}</div> : null}</div></div>
              <div className="gps-box" style={{ marginTop: 14 }}><div><strong style={{ fontSize: 13 }}>Planning guardrail</strong><div className="small" style={{ marginTop: 4 }}>These recommendations support human decision-making. They are not autonomous vessel control or certified cleanup instructions.</div></div></div>
            </>}

            {tab === "graph" && <>
              <div className="card" style={{ boxShadow: "none", border: "1px solid #e2e8f0" }}><div className="card-header"><div><div className="card-title">Marine Anomaly Knowledge Graph</div><div className="muted small">Survey → object fingerprint → survey location relationships.</div></div><button type="button" className="secondary-btn" onClick={loadGraph}>{toolLoading ? "Loading..." : "Refresh graph"}</button></div><div className="card-body"><div className="result-grid"><div className="result-box"><span className="muted small">Nodes</span><strong>{graph?.nodes?.length ?? graphInfo.node_count ?? 0}</strong></div><div className="result-box"><span className="muted small">Relationships</span><strong>{graph?.edges?.length ?? graphInfo.edge_count ?? 0}</strong></div></div><div className="table-wrap" style={{ marginTop: 14 }}><table><thead><tr><th>Node</th><th>Type</th><th>Label</th></tr></thead><tbody>{graph?.nodes?.slice(0, 12).map(n => <tr key={n.id}><td>{n.id}</td><td>{n.type}</td><td>{n.label}</td></tr>) || <tr><td colSpan="3">Click “Refresh graph” to load stored relationships.</td></tr>}</tbody></table></div></div></div>
            </>}

            {tab === "lab" && <>
              <div className="card" style={{ boxShadow: "none", border: "1px solid #e2e8f0" }}><div className="card-header"><div><div className="card-title">Synthetic Sonar Laboratory</div><div className="muted small">Controlled parameter simulation for testing reliability logic.</div></div><span className="badge">{lab.status || "Simulation Ready"}</span></div><div className="card-body"><div style={{ display: "grid", gap: 12 }}><label className="small">Noise: {synthetic.noise}<input type="range" min="0" max="100" value={synthetic.noise} onChange={e => setSynthetic({ ...synthetic, noise: Number(e.target.value) })} /></label><label className="small">Contrast: {synthetic.contrast}<input type="range" min="0" max="100" value={synthetic.contrast} onChange={e => setSynthetic({ ...synthetic, contrast: Number(e.target.value) })} /></label><label className="small">Shadow strength: {synthetic.shadow_strength}<input type="range" min="0" max="100" value={synthetic.shadow_strength} onChange={e => setSynthetic({ ...synthetic, shadow_strength: Number(e.target.value) })} /></label><button type="button" className="primary-btn" onClick={runSyntheticLab}>{toolLoading ? "Simulating..." : "Run parameter simulation"}</button></div>{syntheticResult && <div className="result-grid" style={{ marginTop: 16 }}><div className="result-box"><span className="muted small">Projected reliability proxy</span><strong>{Math.round(Number(syntheticResult.projected_reliability_proxy || 0))}%</strong></div><div className="result-box"><span className="muted small">Noise</span><strong>{syntheticResult.noise}</strong></div><div className="result-box"><span className="muted small">Contrast</span><strong>{syntheticResult.contrast}</strong></div><div className="result-box"><span className="muted small">Shadow</span><strong>{syntheticResult.shadow_strength}</strong></div></div>}<div className="gps-box" style={{ marginTop: 14 }}><div><strong style={{ fontSize: 13 }}>Laboratory boundary</strong><div className="small" style={{ marginTop: 4 }}>This does not generate validated synthetic sonar images, retrain YOLO or prove physical sonar performance. It is a controlled prototype simulation.</div></div></div></div></div>
            </>}

            {tab === "monitor" && <>
              <div className="result-grid"><div className="result-box"><span className="muted small">Reliability</span><strong>{Math.round(Number(reliability.score || 0))}%</strong><div className="muted small" style={{ marginTop: 4 }}>{reliability.status}</div></div><div className="result-box"><span className="muted small">Detections</span><strong>{detections.length}</strong><div className="muted small" style={{ marginTop: 4 }}>Current scan</div></div><div className="result-box"><span className="muted small">Unknown anomalies</span><strong>{detections.filter(d => d.is_unknown_anomaly).length}</strong><div className="muted small" style={{ marginTop: 4 }}>Expert review signal</div></div><div className="result-box"><span className="muted small">Expert feedback</span><strong>{expert.feedback_records ?? 0}</strong><div className="muted small" style={{ marginTop: 4 }}>Connected records</div></div></div>
              <div className="table-wrap" style={{ marginTop: 16 }}><table><thead><tr><th>Monitor</th><th>Status</th><th>Interpretation</th></tr></thead><tbody><tr><td>Image quality</td><td>{reliability.status || "—"}</td><td>{reliability.recommendation || "—"}</td></tr><tr><td>Seabed adaptation</td><td>Prototype Active</td><td>{seabed.guidance || "—"}</td></tr><tr><td>Unknown anomaly</td><td>{detections.some(d => d.is_unknown_anomaly) ? "Review Required" : "No flag"}</td><td>Low confidence is a review signal, not proof of a new object.</td></tr><tr><td>Human-in-loop</td><td>{expert.connected ? "Connected" : "Prototype"}</td><td>Expert outcomes can be retained for later model improvement.</td></tr></tbody></table></div>
            </>}

            <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: "#fff7ed", border: "1px solid #fed7aa" }}><div className="small" style={{ lineHeight: 1.55 }}><strong>Prototype scope:</strong> Feature 3 outputs are evidence-aware decision-support prototypes. Acoustic-shadow, seabed, risk, hotspot, cleanup and predictive outputs are not validated physical, pollution, hazard or operational measurements. Synthetic Sonar Laboratory remains a parameter simulation rather than validated image generation.</div></div>
          </>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   SURVEY MAP
   ========================================================= */

function WasteCompositionPage({
  analysisResult,
  reportInfo,
  setPage,
}) {
  const detections =
    normalizeDetections(
      analysisResult
    );

  const composition = useMemo(() => {
    const groups = {};

    detections.forEach(
      (detection) => {
        const sourceClass =
          detection.class_name;

        const category =
          COMPOSITION_MAP[
            sourceClass
          ] ||
          "Other Targets";

        if (!groups[category]) {
          groups[category] = {
            name: category,
            count: 0,
            sourceClasses: new Set(),
          };
        }

        groups[category].count += 1;

        groups[
          category
        ].sourceClasses.add(
          sourceClass
        );
      }
    );

    const total =
      detections.length;

    return Object.values(groups)
      .map((item, index) => ({
        name: item.name,

        count: item.count,

        percentage: total
          ? (item.count / total) *
            100
          : 0,

        color:
          COMPOSITION_COLORS[
            index %
              COMPOSITION_COLORS.length
          ],

        sourceClasses:
          Array.from(
            item.sourceClasses
          ),
      }))
      .sort(
        (a, b) =>
          b.count - a.count
      );
  }, [detections]);

  const chartData =
    composition.map((item) => ({
      name: item.name,
      value: item.count,
    }));

  const manMadeCount =
    detections.filter(
      (detection) =>
        COMPOSITION_MAP[
          detection.class_name
        ] === "Man-made Objects"
    ).length;

  /* No previous analysis */
  if (
    !analysisResult ||
    detections.length === 0
  ) {
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>
              Waste Composition
              Analysis
            </h1>

            <p>
              Composition is
              generated directly
              from the latest YOLO
              detection results.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">
              <PieChartIcon
                size={25}
              />
            </div>

            <h3
              style={{
                margin:
                  "0 0 8px",
              }}
            >
              No detection
              results available
            </h3>

            <p className="small">
              First upload and
              analyze a sonar
              image. AQUA XPLORE will
              automatically read
              the detected YOLO
              objects and create
              the composition
              chart.
            </p>

            <button
              className="btn btn-primary"
              style={{
                marginTop: 12,
              }}
              onClick={() =>
                setPage(
                  "Analyze Sonar"
                )
              }
            >
              <Upload size={17} />
              Go to Analyze Sonar
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Waste Composition
            Analysis
          </h1>

          <p>
            Visual composition
            generated from the
            existing YOLO
            detection results.
          </p>
        </div>

        <button
          className="btn btn-outline"
          onClick={() =>
            setPage(
              "Analyze Sonar"
            )
          }
        >
          <RefreshCw size={16} />
          Analyze Another Scan
        </button>
      </div>

      <div className="composition-layout">
        {/* DONUT CHART */}

        <div className="card chart-card">
          <div className="card-header">
            <div className="card-title">
              Target Composition
            </div>

            <span className="badge">
              {detections.length}{" "}
              detections
            </span>
          </div>

          <div
            className="card-body"
            style={{
              height: 390,
              position: "relative",
            }}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  innerRadius={82}
                  outerRadius={130}
                  paddingAngle={3}
                  labelLine={false}
                  label={({
                    percent,
                  }) =>
                    `${Math.round(
                      percent * 100
                    )}%`
                  }
                >
                  {chartData.map(
                    (
                      entry,
                      index
                    ) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          composition[
                            index
                          ]?.color ||
                          COMPOSITION_COLORS[
                            index %
                              COMPOSITION_COLORS.length
                          ]
                        }
                      />
                    )
                  )}
                </Pie>

                <Tooltip
                  formatter={(
                    value
                  ) => [
                    `${value} target${
                      value === 1
                        ? ""
                        : "s"
                    }`,
                    "Count",
                  ]}
                />

                <Legend />
              </PieChart>
            </ResponsiveContainer>

            <div
              className="chart-center"
              style={{
                position:
                  "absolute",

                left: "50%",
                top: "43%",

                transform:
                  "translate(-50%, -50%)",

                pointerEvents:
                  "none",
              }}
            >
              <strong>
                {detections.length}
              </strong>

              <span>
                Total targets
              </span>
            </div>
          </div>
        </div>

        {/* PERCENTAGE VIEW */}

        <div className="card">
          <div className="card-header">
            <div className="card-title">
              Percentage
              Visualization
            </div>
          </div>

          <div className="card-body">
            {composition.map(
              (item) => (
                <div
                  className="progress-row"
                  key={item.name}
                >
                  <div className="progress-label">
                    <span
                      style={{
                        fontWeight: 700,
                      }}
                    >
                      {item.name}
                    </span>

                    <strong>
                      {item.percentage.toFixed(
                        1
                      )}
                      %
                    </strong>
                  </div>

                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${item.percentage}%`,
                        background:
                          item.color,
                      }}
                    />
                  </div>
                </div>
              )
            )}

            <div
              className="result-grid"
              style={{
                marginTop: 22,
              }}
            >
              <div className="result-box">
                <span className="muted small">
                  Total Targets
                </span>

                <strong>
                  {detections.length}
                </strong>
              </div>

              <div className="result-box">
                <span className="muted small">
                  Man-made
                </span>

                <strong>
                  {manMadeCount}
                </strong>
              </div>

              <div className="result-box">
                <span className="muted small">
                  Man-made Share
                </span>

                <strong>
                  {Math.round(
                    (manMadeCount /
                      detections.length) *
                      100
                  )}
                  %
                </strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CATEGORY CARDS */}

      <div className="category-grid">
        {composition.map(
          (item) => (
            <div
              className="category-card"
              key={item.name}
            >
              <div className="category-top">
                <div className="category-name">
                  <span
                    className="color-dot"
                    style={{
                      background:
                        item.color,
                    }}
                  />

                  {item.name}
                </div>

                <span className="badge">
                  {item.count}
                </span>
              </div>

              <div className="category-percent">
                {item.percentage.toFixed(
                  1
                )}
                %
              </div>

              <div className="category-count">
                Detected classes:{" "}
                {item.sourceClasses.join(
                  ", "
                )}
              </div>
            </div>
          )
        )}
      </div>

      {/* IMPORTANT PROTOTYPE NOTE */}

      <div className="warning-note">
        <strong>
          Prototype classification
          note:
        </strong>{" "}
        this composition is
        calculated from the
        current YOLO target
        classes. Aircraft and
        shipwreck are grouped
        as “Man-made Objects”.
        This does not by itself
        prove that an object is
        physical marine waste.
        For confirmed marine
        debris composition,
        the YOLO model should
        eventually be trained
        using dedicated marine
        waste/debris classes.
      </div>

      {reportInfo && (
        <div
          className="card"
          style={{
            marginTop: 18,
          }}
        >
          <div className="card-header">
            <div className="card-title">
              Source Scan
            </div>
          </div>

          <div className="card-body">
            <div className="dataset-row">
              <div className="dataset-left">
                <div className="dataset-icon">
                  <Waves size={19} />
                </div>

                <div>
                  <strong>
                    {
                      reportInfo.filename
                    }
                  </strong>

                  <div className="muted small">
                    {reportInfo.date}{" "}
                    ·{" "}
                    {reportInfo.time}
                  </div>
                </div>
              </div>

              <span className="badge">
                <CheckCircle2
                  size={12}
                />
                YOLO connected
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HistoricalComparisonPage({
  surveyScans,
  earlierId,
  laterId,
  setEarlierId,
  setLaterId,
  comparison,
}) {
  const earlierScan = surveyScans.find((scan) => String(scan.id) === String(earlierId)) || surveyScans[surveyScans.length - 2] || null;
  const laterScan = surveyScans.find((scan) => String(scan.id) === String(laterId)) || surveyScans[surveyScans.length - 1] || null;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Historical Survey Comparison</h1>
          <p>
            Compare recorded AQUA XPLORE survey detections across two scans without inventing missing historical evidence.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 18 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 14,
          }}
        >
          <div>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 7 }}>
              Earlier survey
            </label>
            <select
              value={earlierId || (surveyScans[surveyScans.length - 2]?.id || "")}
              onChange={(event) => setEarlierId(event.target.value)}
              disabled={surveyScans.length < 2}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1", background: "white" }}
            >
              {surveyScans.length ? surveyScans.map((scan) => (
                <option key={scan.id} value={scan.id}>
                  {scan.date} {scan.time} — {scan.filename}
                </option>
              )) : <option value="">No surveys available</option>}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 7 }}>
              Later survey
            </label>
            <select
              value={laterId || (surveyScans[surveyScans.length - 1]?.id || "")}
              onChange={(event) => setLaterId(event.target.value)}
              disabled={surveyScans.length < 2}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1", background: "white" }}
            >
              {surveyScans.length ? surveyScans.map((scan) => (
                <option key={scan.id} value={scan.id}>
                  {scan.date} {scan.time} — {scan.filename}
                </option>
              )) : <option value="">No surveys available</option>}
            </select>
          </div>
        </div>

        {surveyScans.length < 2 ? (
          <div className="empty-state" style={{ paddingBottom: 20 }}>
            <div className="empty-icon"><RefreshCw size={22} /></div>
            <strong>Not enough historical data</strong>
            <p className="small" style={{ maxWidth: 560, margin: "8px auto 0" }}>
              Analyze at least two sonar images in this session before drawing a historical comparison.
            </p>
          </div>
        ) : (
          <div className="small" style={{ marginTop: 14 }}>
            Earlier: {earlierScan?.filename || "—"} &nbsp;→&nbsp; Later: {laterScan?.filename || "—"}
          </div>
        )}
      </div>

      {comparison?.comparable && (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon"><Target size={20} /></div>
              <div>
                <div className="stat-label">Earlier detections</div>
                <div className="stat-value">{comparison.earlierCount}</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><Target size={20} /></div>
              <div>
                <div className="stat-label">Later detections</div>
                <div className="stat-value">{comparison.laterCount}</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><RefreshCw size={20} /></div>
              <div>
                <div className="stat-label">Detection change</div>
                <div className="stat-value">{getChangeLabel(comparison.countDelta)}</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><Gauge size={20} /></div>
              <div>
                <div className="stat-label">Confidence change</div>
                <div className="stat-value">{comparison.confidenceDelta >= 0 ? "+" : ""}{comparison.confidenceDelta.toFixed(1)}%</div>
              </div>
            </div>
          </div>

          <div className="section-grid">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Class-wise detection change</div>
                <div className="small muted">Later − earlier</div>
              </div>
              <div className="card-body">
                {comparison.classRows.length ? comparison.classRows.map((row) => (
                  <div
                    key={row.className}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.4fr .7fr .7fr .7fr",
                      gap: 10,
                      padding: "12px 0",
                      borderBottom: "1px solid #eef2f7",
                      alignItems: "center",
                    }}
                  >
                    <strong>{row.className}</strong>
                    <span className="small">Earlier: {row.earlier}</span>
                    <span className="small">Later: {row.later}</span>
                    <strong>{getChangeLabel(row.delta)}</strong>
                  </div>
                )) : (
                  <div className="empty-state">No recorded detections in either selected survey.</div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Interpretation guardrails</div>
              </div>
              <div className="card-body">
                <p className="small" style={{ marginTop: 0 }}>
                  {comparison.reason}
                </p>
                <p className="small">
                  Earlier average confidence: {comparison.earlierAvgConfidence.toFixed(1)}%
                </p>
                <p className="small">
                  Later average confidence: {comparison.laterAvgConfidence.toFixed(1)}%
                </p>
                <p className="small">
                  {comparison.locationDistanceKm != null
                    ? `Survey coordinate separation: ${comparison.locationDistanceKm.toFixed(3)} km.`
                    : "Survey coordinate separation could not be calculated."}
                </p>
                <p className="small" style={{ marginBottom: 0 }}>
                  A detection-count difference is a model-output difference, not proof of new debris, removal, or environmental change.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DigitalTwinPage({ analysisResult, surveyScans = [] }) {
  const latestDetections = normalizeDetections(analysisResult);
  const latestLocation = getLatLon(analysisResult?.geotag) || getLatLon(analysisResult?.location);
  const scans = surveyScans.length ? surveyScans : latestLocation ? [{ id: "latest-scan", filename: "Latest sonar scan", date: formatDate(), time: formatTime(), location: latestLocation, detections: latestDetections }] : [];
  const validScans = scans.filter((scan) => scan.location);
  const allDetections = scans.flatMap((scan) => scan.detections || []);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const classCounts = allDetections.reduce((counts, detection) => { const name = detection.class_name || "Unknown"; counts[name] = (counts[name] || 0) + 1; return counts; }, {});
  const highConfidence = allDetections.filter((detection) => detection.confidence_percent >= 80).length;
  const twinObjects = scans.flatMap((scan, scanIndex) => (scan.detections || []).map((detection, detectionIndex) => ({ ...detection, twinId: `${scan.id || scanIndex}-${detectionIndex}`, scanIndex: scanIndex + 1, scan })));
  const objectPosition = (index, total) => { const angle = total ? (index / total) * Math.PI * 2 : 0; const radius = 28 + (index % 3) * 9; return { left: `${50 + Math.cos(angle) * radius}%`, top: `${54 + Math.sin(angle) * radius * 0.45}%` }; };
  return (
    <>
      <div className="page-heading"><div><h1>Digital Twin</h1><p>AI-powered virtual representation of the surveyed seafloor using sonar detections and real survey locations.</p></div><span className="badge"><Layers size={13} /> Intelligent Seafloor Twin</span></div>
      <div className="map-summary">
        <div className="map-stat"><span className="muted small">Survey zones</span><strong>{validScans.length}</strong></div>
        <div className="map-stat"><span className="muted small">Twin objects</span><strong>{twinObjects.length}</strong></div>
        <div className="map-stat"><span className="muted small">High confidence</span><strong>{highConfidence}</strong></div>
        <div className="map-stat"><span className="muted small">Object classes</span><strong>{Object.keys(classCounts).length}</strong></div>
      </div>
      <div className="card">
        <div className="card-header"><div><div className="card-title">3D Seafloor Digital Twin</div><div className="muted small" style={{ marginTop: 3 }}>Prototype twin layer: detected targets are anchored to their source survey locations. It is not a bathymetric depth model.</div></div><span className="badge">{twinObjects.length} target{twinObjects.length === 1 ? "" : "s"} mapped</span></div>
        <div className="digital-twin-stage"><div className="twin-grid-lines" /><div className="twin-depth-label">SURVEYED SEAFLOOR</div><div className="twin-horizon" /><div className="twin-seafloor" />
          {twinObjects.length === 0 ? <div className="twin-empty"><Layers size={28} /><strong>No twin objects yet</strong><span>Analyze a sonar image with GPS enabled to populate the digital twin.</span></div> : twinObjects.map((object, index) => { const position = objectPosition(index, twinObjects.length); const selected = selectedTarget?.twinId === object.twinId; return <button key={object.twinId} className={`twin-object ${selected ? "selected" : ""}`} style={position} onClick={() => setSelectedTarget(object)} title={`${object.class_name} — ${Math.round(object.confidence_percent || 0)}%`}><span className="twin-object-pulse" /><span className="twin-object-core" /><span className="twin-object-label">{object.class_name}</span></button>; })}
          {validScans.map((scan, index) => <div key={`zone-${scan.id || index}`} className="twin-survey-zone" style={{ left: `${18 + (index % 4) * 21}%`, top: `${26 + Math.floor(index / 4) * 16}%` }}>Z{index + 1}</div>)}
        </div>
      </div>
      <div className="map-details-grid" style={{ marginTop: 18 }}>
        <div className="card"><div className="card-header"><div className="card-title">Twin Intelligence</div><span className="badge">Live session</span></div><div className="card-body"><div className="result-grid">{Object.entries(classCounts).map(([name, count]) => <div className="result-box" key={name}><span className="muted small">{name}</span><strong>{count}</strong></div>)}{Object.keys(classCounts).length === 0 && <div className="empty-state" style={{ gridColumn: "1 / -1" }}>Object intelligence will appear here after sonar analysis.</div>}</div></div></div>
        <div className="card"><div className="card-header"><div className="card-title">Selected Twin Target</div><span className="badge">Interactive</span></div><div className="card-body">{selectedTarget ? <><div className="result-grid"><div className="result-box"><span className="muted small">Classification</span><strong>{selectedTarget.class_name}</strong></div><div className="result-box"><span className="muted small">Confidence</span><strong>{Math.round(selectedTarget.confidence_percent)}%</strong></div><div className="result-box"><span className="muted small">Source scan</span><strong>#{selectedTarget.scanIndex}</strong></div><div className="result-box"><span className="muted small">Survey GPS</span><strong>{getLocationText(selectedTarget.scan.location)}</strong></div></div><div className="muted small" style={{ marginTop: 12 }}>Bounding box: {getBoundingBoxText(selectedTarget)}. GPS is the source sonar scan location, not an independently georeferenced target coordinate.</div></> : <div className="empty-state">Click a glowing target in the twin to inspect its AI information.</div>}</div></div>
      </div>
      <div className="card" style={{ marginTop: 18 }}><div className="card-header"><div><div className="card-title">Digital Twin Survey Register</div><div className="muted small" style={{ marginTop: 3 }}>Every twin object remains traceable to its original sonar scan.</div></div></div><div className="card-body table-wrap">{twinObjects.length === 0 ? <div className="empty-state">No survey objects available.</div> : <table><thead><tr><th>#</th><th>Class</th><th>Confidence</th><th>Survey location</th><th>Source scan</th><th>BBox</th></tr></thead><tbody>{twinObjects.map((object, index) => <tr key={`twin-row-${object.twinId}`}><td>{index + 1}</td><td><span className="badge">{object.class_name}</span></td><td>{Math.round(object.confidence_percent)}%</td><td>{getLocationText(object.scan.location)}</td><td>{object.scan.filename || `Scan #${object.scanIndex}`}</td><td>{getBoundingBoxText(object)}</td></tr>)}</tbody></table>}</div></div>
      <div className="gps-box" style={{ marginTop: 18 }}><div><strong style={{ fontSize: 13 }}>Prototype boundary</strong><div className="small" style={{ marginTop: 4 }}>This first Digital Twin version uses real detected objects and survey GPS from AQUA XPLORE. Accurate seafloor elevation, object depth and exact target coordinates require bathymetry or sonar georeferencing data.</div></div></div>
    </>
  );
}

function SurveyMapPage({
  analysisResult,
  reportInfo,
  surveyScans = [],
}) {
  const latestDetections = normalizeDetections(analysisResult);

  const latestLocation =
    getLatLon(analysisResult?.geotag) ||
    getLatLon(analysisResult?.location);

  // Build the location register from real scans collected in this session.
  const scans = surveyScans.length
    ? surveyScans
    : reportInfo
    ? [
        {
          id: reportInfo.scanId,
          filename: reportInfo.filename,
          date: reportInfo.date,
          time: reportInfo.time,
          location: latestLocation,
          detections: latestDetections,
        },
      ]
    : [];

  const validScans = scans.filter((scan) => scan.location);
  const totalTargets = scans.reduce(
    (sum, scan) => sum + (scan.detections?.length || 0),
    0
  );

  const allDetections = scans.flatMap(
    (scan) => scan.detections || []
  );

  const high = allDetections.filter(
    (detection) => detection.confidence_percent >= 80
  ).length;
  const medium = allDetections.filter(
    (detection) =>
      detection.confidence_percent >= 50 &&
      detection.confidence_percent < 80
  ).length;
  const low = allDetections.filter(
    (detection) => detection.confidence_percent < 50
  ).length;

  const classCounts = allDetections.reduce((counts, detection) => {
    const name = detection.class_name || "Unknown";
    counts[name] = (counts[name] || 0) + 1;
    return counts;
  }, {});

  const mapLocation = latestLocation || validScans[validScans.length - 1]?.location;
  const mapCenter = mapLocation || {
    lat: 20.5937,
    lon: 78.9629,
  };

  const locationRows = scans.map((scan, index) => {
    const detections = scan.detections || [];
    const confidences = detections
      .map((detection) => detection.confidence_percent)
      .filter(Number.isFinite);
    const avgConfidence = confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) /
        confidences.length
      : 0;
    const classes = [...new Set(
      detections.map((detection) => detection.class_name).filter(Boolean)
    )];

    return {
      ...scan,
      index: index + 1,
      targetCount: detections.length,
      avgConfidence,
      classes,
    };
  });

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Survey Map</h1>
          <p>
            Location-wise analysis of AI-detected sonar targets from each survey scan.
          </p>
        </div>
      </div>

      <div className="map-summary">
        <div className="map-stat">
          <span className="muted small">Survey locations</span>
          <strong>{validScans.length}</strong>
        </div>
        <div className="map-stat">
          <span className="muted small">Detected targets</span>
          <strong>{totalTargets}</strong>
        </div>
        <div className="map-stat">
          <span className="muted small">High confidence</span>
          <strong>{high}</strong>
        </div>
        <div className="map-stat">
          <span className="muted small">Medium / Low</span>
          <strong>{medium} / {low}</strong>
        </div>
      </div>

      <div className="card map-card">
        <div className="card-header">
          <div>
            <div className="card-title">Location-wise Sonar Target Map</div>
            <div className="muted small" style={{ marginTop: 3 }}>
              Each marker represents the GPS position of a sonar survey scan.
            </div>
          </div>
          <span className="badge">
            <MapPin size={12} />
            {validScans.length} mapped location{validScans.length === 1 ? "" : "s"}
          </span>
        </div>

        <MapContainer
          center={[mapCenter.lat, mapCenter.lon]}
          zoom={validScans.length ? 12 : 5}
          className="map-container"
          scrollWheelZoom
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {validScans.map((scan, index) => {
            const detections = scan.detections || [];
            const location = scan.location;
            return (
              <React.Fragment key={`${scan.id || "scan"}-${index}`}>
                <Marker
                  position={[location.lat, location.lon]}
                  icon={sonarMarker}
                >
                  <Popup>
                    <strong>AQUA XPLORE Survey Scan #{index + 1}</strong>
                    <br />
                    GPS: {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
                    <br />
                    Targets: {detections.length}
                    <br />
                    Classes: {detections.length
                      ? [...new Set(detections.map((d) => d.class_name))].join(", ")
                      : "None"}
                  </Popup>
                </Marker>
                {detections.length > 0 && (
                  <CircleMarker
                    center={[location.lat, location.lon]}
                    radius={20 + Math.min(detections.length * 2, 14)}
                    pathOptions={{
                      color: "#2563eb",
                      fillColor: "#2563eb",
                      fillOpacity: 0.10,
                      weight: 2,
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>

      <div className="map-details-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Detection Composition by Location</div>
            <span className="badge">{Object.keys(classCounts).length} class type{Object.keys(classCounts).length === 1 ? "" : "s"}</span>
          </div>
          <div className="card-body">
            {Object.keys(classCounts).length === 0 ? (
              <div className="empty-state">
                Run a sonar analysis to populate location-wise detection statistics.
              </div>
            ) : (
              <div className="result-grid">
                {Object.entries(classCounts).map(([name, count]) => (
                  <div className="result-box" key={name}>
                    <span className="muted small">{name}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Current Survey Geolocation</div>
            <span className="badge">
              <MapPin size={12} />
              {latestLocation ? "GPS available" : "GPS unavailable"}
            </span>
          </div>
          <div className="card-body">
            {latestLocation ? (
              <div className="location-readout">
                <div>
                  <span className="muted small">Latitude</span>
                  <strong>{latestLocation.lat.toFixed(6)}°</strong>
                </div>
                <div>
                  <span className="muted small">Longitude</span>
                  <strong>{latestLocation.lon.toFixed(6)}°</strong>
                </div>
                <div>
                  <span className="muted small">Targets in latest scan</span>
                  <strong>{latestDetections.length}</strong>
                </div>
              </div>
            ) : (
              <div className="warning-note" style={{ margin: 0 }}>
                No GPS coordinate was returned for the latest scan.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-header">
          <div>
            <div className="card-title">Location-wise Target Register</div>
            <div className="muted small" style={{ marginTop: 3 }}>
              Compare every analyzed survey location using the GPS attached to its source sonar scan.
            </div>
          </div>
          <span className="badge">{locationRows.length} scan{locationRows.length === 1 ? "" : "s"}</span>
        </div>

        <div className="card-body table-wrap">
          {locationRows.length === 0 ? (
            <div className="empty-state">
              Run a sonar analysis to build the location-wise register.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Survey location</th>
                  <th>Targets</th>
                  <th>Detected classes</th>
                  <th>Avg. confidence</th>
                  <th>Source scan</th>
                </tr>
              </thead>
              <tbody>
                {locationRows.map((row) => (
                  <tr key={`${row.id || row.filename}-${row.index}`}>
                    <td>{row.index}</td>
                    <td>
                      {row.location
                        ? `${row.location.lat.toFixed(6)}, ${row.location.lon.toFixed(6)}`
                        : "GPS unavailable"}
                    </td>
                    <td>{row.targetCount}</td>
                    <td>{row.classes.length ? row.classes.join(", ") : "None"}</td>
                    <td>{row.targetCount ? `${row.avgConfidence.toFixed(1)}%` : "—"}</td>
                    <td>
                      <strong>{row.filename || "Sonar scan"}</strong>
                      <div className="muted small">
                        {row.date || "—"} {row.time ? `· ${row.time}` : ""}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="warning-note" style={{ marginTop: 18 }}>
        <strong>Geospatial interpretation:</strong> each detected target inherits the GPS coordinate of its source sonar scan. The displayed image bounding box is an image coordinate, not an independently georeferenced target position. Exact target coordinates require sonar georeferencing or survey-track data.
      </div>
    </>
  );
}

/* =========================================================
   WASTE HOTSPOTS
   ========================================================= */

function WasteHotspotsPage({
  hotspotFile,
  handleHotspotFile,
  analyzeHotspotFile,
  hotspotAnalyzed,
  hotspotLoading,
  hotspotResult,
  hotspotLocation,
  hotspotLocationLoading,
  hotspotLocationError,
  requestHotspotLocation,
}) {
  const hotspotLatLon =
    getLatLon(
      hotspotResult?.geotag
    ) ||
    getLatLon(
      hotspotResult?.location
    ) ||
    hotspotLocation;

  const score = Number(
    hotspotResult?.hotspot_score ??
      0
  );

  const risk =
    hotspotResult?.risk ||
    (score >= 70
      ? "High"
      : score >= 40
      ? "Medium"
      : "Low");

  const riskClass =
    String(risk).toLowerCase() ===
    "high"
      ? "risk-high"
      : String(risk).toLowerCase() ===
        "medium"
      ? "risk-medium"
      : "risk-low";

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Waste Hotspots
          </h1>

          <p>
            Analyze a sonar scan
            for potential hotspot
            areas.
          </p>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              Hotspot Scan
            </div>
          </div>

          <div className="card-body">
            <label
              className="upload-zone"
              style={{
                display: "block",
              }}
            >
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) =>
                  handleHotspotFile(
                    event.target
                      .files?.[0]
                  )
                }
              />

              <div className="upload-icon">
                <ShieldAlert
                  size={25}
                />
              </div>

              <div className="upload-title">
                {hotspotFile
                  ? "Change hotspot image"
                  : "Upload sonar image"}
              </div>

              <div className="muted small">
                Run the hotspot
                analysis
              </div>
            </label>

            {hotspotFile && (
              <div className="file-pill">
                <strong
                  style={{
                    fontSize: 13,
                  }}
                >
                  {hotspotFile.name}
                </strong>
              </div>
            )}

            <div
              className={`gps-box ${
                hotspotLocationError
                  ? "gps-error"
                  : ""
              }`}
              style={{
                marginTop: 15,
              }}
            >
              <MapPin size={18} />

              <div
                style={{
                  flex: 1,
                }}
              >
                <strong
                  style={{
                    fontSize: 13,
                  }}
                >
                  Hotspot GPS
                </strong>

                <div
                  className="small"
                  style={{
                    marginTop: 3,
                  }}
                >
                  {hotspotLocationLoading
                    ? "Getting location..."
                    : hotspotLocation
                    ? `${hotspotLocation.lat.toFixed(
                        6
                      )}, ${hotspotLocation.lon.toFixed(
                        6
                      )}`
                    : hotspotLocationError ||
                      "Not available"}
                </div>
              </div>

              <button
                className="btn btn-outline"
                onClick={
                  requestHotspotLocation
                }
              >
                <MapPin size={14} />
                GPS
              </button>
            </div>

            <button
              className="btn btn-primary"
              style={{
                width: "100%",
                marginTop: 15,
              }}
              disabled={
                !hotspotFile ||
                hotspotLoading
              }
              onClick={
                analyzeHotspotFile
              }
            >
              {hotspotLoading ? (
                <>
                  <Loader2 size={17} />
                  Checking hotspot...
                </>
              ) : (
                <>
                  <ShieldAlert
                    size={17}
                  />
                  Analyze Hotspot
                </>
              )}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">
              Hotspot Result
            </div>

            {hotspotAnalyzed && (
              <span
                className={`badge ${riskClass}`}
              >
                {risk} risk
              </span>
            )}
          </div>

          <div className="card-body">
            {!hotspotAnalyzed ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <ShieldAlert
                    size={22}
                  />
                </div>

                <strong>
                  No hotspot
                  analysis yet
                </strong>

                <p className="small">
                  Upload an image
                  and run hotspot
                  analysis.
                </p>
              </div>
            ) : (
              <>
                <div className="result-grid">
                  <div className="result-box">
                    <span className="muted small">
                      Hotspot Score
                    </span>

                    <strong>
                      {Math.round(
                        score
                      )}
                    </strong>
                  </div>

                  <div className="result-box">
                    <span className="muted small">
                      Risk
                    </span>

                    <strong>
                      {risk}
                    </strong>
                  </div>

                  <div className="result-box">
                    <span className="muted small">
                      Priority
                    </span>

                    <strong>
                      {hotspotResult?.priority ||
                        "Normal"}
                    </strong>
                  </div>
                </div>

                <div className="warning-note">
                  {hotspotResult?.note ||
                    "Hotspot score is a prototype heuristic and should not be treated as confirmed marine waste detection."}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {hotspotAnalyzed &&
        hotspotLatLon && (
          <div
            className="card map-card"
            style={{
              marginTop: 18,
            }}
          >
            <div className="card-header">
              <div className="card-title">
                Hotspot Location
              </div>

              <span className="badge">
                {hotspotLatLon.lat.toFixed(
                  6
                )}
                ,{" "}
                {hotspotLatLon.lon.toFixed(
                  6
                )}
              </span>
            </div>

            <MapContainer
              center={[
                hotspotLatLon.lat,
                hotspotLatLon.lon,
              ]}
              zoom={15}
              className="map-container"
            >
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <Marker
                position={[
                  hotspotLatLon.lat,
                  hotspotLatLon.lon,
                ]}
                icon={sonarMarker}
              >
                <Popup>
                  <strong>
                    Potential hotspot
                  </strong>

                  <br />

                  Score:{" "}
                  {Math.round(
                    score
                  )}

                  <br />

                  Risk: {risk}
                </Popup>
              </Marker>
            </MapContainer>
          </div>
        )}
    </>
  );
}

/* =========================================================
   DATASETS
   ========================================================= */

function DatasetsPage() {
  const datasets = [
    {
      name:
        "SeabedObjects-KLSG / Sonar Dataset",
      type: "Side-scan sonar",
      status: "Connected",
    },
    {
      name:
        "YOLO Training Dataset",
      type: "Object detection",
      status: "Ready",
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Datasets
          </h1>

          <p>
            Manage sonar datasets
            used for AI analysis.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">
            Available Datasets
          </div>

          <span className="badge">
            <Database size={12} />
            {datasets.length} datasets
          </span>
        </div>

        <div className="card-body">
          {datasets.map(
            (dataset) => (
              <div
                className="dataset-row"
                key={dataset.name}
              >
                <div className="dataset-left">
                  <div className="dataset-icon">
                    <Database
                      size={19}
                    />
                  </div>

                  <div>
                    <strong
                      style={{
                        fontSize: 13,
                      }}
                    >
                      {dataset.name}
                    </strong>

                    <div className="muted small">
                      {dataset.type}
                    </div>
                  </div>
                </div>

                <span className="badge">
                  <CheckCircle2
                    size={12}
                  />
                  {dataset.status}
                </span>
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}

/* =========================================================
   REPORTS
   ========================================================= */

function ReportsPage({
  analysisResult,
  reportInfo,
}) {
  const detections =
    normalizeDetections(
      analysisResult
    );

  const printReport = () => {
    window.print();
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Reports
          </h1>

          <p>
            Review and print the
            latest sonar analysis
            report.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={printReport}
          disabled={!analysisResult}
        >
          <FileText size={17} />
          Print / Save PDF
        </button>
      </div>

      {!analysisResult ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">
              <FileText size={23} />
            </div>

            <strong>
              No report available
            </strong>

            <p className="small">
              Analyze a sonar image
              first to generate a
              report.
            </p>
          </div>
        </div>
      ) : (
        <div id="print-report">
          <div className="report-header">
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#93c5fd",
                  }}
                >
                  AQUA XPLORE AI
                  UNDERWATER
                  INTELLIGENCE
                </div>

                <h2
                  style={{
                    margin:
                      "7px 0 4px",
                  }}
                >
                  Sonar Detection
                  Report
                </h2>

                <div
                  style={{
                    color: "#cbd5e1",
                    fontSize: 12,
                  }}
                >
                  AI-powered
                  side-scan sonar
                  object analysis
                </div>
              </div>

              <Waves size={34} />
            </div>

            <div className="report-meta">
              <div>
                <span>
                  Scan ID
                </span>

                <strong>
                  {reportInfo?.scanId ||
                    analysisResult.scan_id ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>
                  Input file
                </span>

                <strong>
                  {reportInfo?.filename ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>
                  Date
                </span>

                <strong>
                  {reportInfo?.date ||
                    formatDate()}
                </strong>
              </div>

              <div>
                <span>
                  Targets
                </span>

                <strong>
                  {detections.length}
                </strong>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">
                Detection Results
              </div>
            </div>

            <div className="card-body table-wrap">
              {detections.length ===
              0 ? (
                <div className="empty-state">
                  No detections
                  returned.
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Class</th>
                      <th>
                        Confidence
                      </th>
                      <th>
                        Bounding Box
                      </th>
                      <th>
                        Location
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {detections.map(
                      (
                        detection,
                        index
                      ) => (
                        <tr
                          key={index}
                        >
                          <td>
                            {index + 1}
                          </td>

                          <td>
                            <strong>
                              {
                                detection.class_name
                              }
                            </strong>
                          </td>

                          <td>
                            {Math.round(
                              detection.confidence_percent
                            )}
                            %
                          </td>

                          <td>
                            {getBoundingBoxText(
                              detection
                            )}
                          </td>

                          <td>
                            {getLocationText(
                              detection.location ||
                                analysisResult.location ||
                                analysisResult.geotag
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              )}
              {/* Expert review is handled in the Analyze Sonar / AI Marine Assistant workflow. */}            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* =========================================================
   SIMPLE PAGE
   ========================================================= */

function SimplePage({
  title,
  description,
  icon: Icon,
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {title}
          </h1>

          <p>
            {description}
          </p>
        </div>
      </div>

      <div className="card">
        <div className="empty-state">
          <div className="empty-icon">
            <Icon size={24} />
          </div>

          <h3
            style={{
              margin:
                "0 0 7px",
            }}
          >
            {title}
          </h3>

          <p className="small">
            This AQUA XPLORE module
            is ready for further
            configuration.
          </p>
        </div>
      </div>
    </>
  );
}

export default App;