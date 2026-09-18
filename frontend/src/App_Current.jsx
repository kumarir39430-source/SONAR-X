import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
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
  Target,
  Upload,
  Waves,
  X,
} from "lucide-react";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
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

function formatLatency(ms) {
  if (!Number.isFinite(ms)) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
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

  /* Faster R-CNN comparison */
  const [rcnnResult, setRcnnResult] = useState(null);
  const [rcnnLoading, setRcnnLoading] = useState(false);
  const [rcnnError, setRcnnError] = useState("");
  const [yoloLatency, setYoloLatency] = useState(null);
  const [rcnnLatency, setRcnnLatency] = useState(null);
  const [analysisDuration, setAnalysisDuration] = useState(null);

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
        setReportInfo({
          scanId: data.scan_id || `SONAR-${Date.now()}`,
          filename: selectedFile.name,
          date: formatDate(),
          time: formatTime(),
        });
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
              />
            )}

            {page === "Survey Map" && (
              <SurveyMapPage
                analysisResult={
                  analysisResult
                }
                reportInfo={reportInfo}
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
                description="Configure SONAR-X application settings."
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

        background: #f4f7fb;
        color: #0f172a;
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
        background: #f4f7fb;
      }

      /* SIDEBAR */

      .sidebar {
        width: 250px;
        min-height: 100vh;
        position: fixed;
        left: 0;
        top: 0;
        background: #0b1220;
        color: white;
        padding: 22px 14px;
        z-index: 1000;
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
          #2563eb,
          #06b6d4
        );
      }

      .brand-title {
        font-size: 18px;
        font-weight: 800;
        letter-spacing: .4px;
      }

      .brand-subtitle {
        font-size: 9px;
        color: #94a3b8;
        margin-top: 2px;
      }

      .nav-label {
        color: #64748b;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        padding: 10px 12px 7px;
      }

      .nav-item {
        width: 100%;
        border: 0;
        background: transparent;
        color: #94a3b8;

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
        background: #1d4ed8;
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
        border-bottom: 1px solid #e5e7eb;

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
        border: 1px solid #e5e7eb;
        background: white;

        width: 38px;
        height: 38px;

        border-radius: 10px;

        display: grid;
        place-items: center;

        color: #475569;
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
            #0f172a 0%,
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
        color: #cbd5e1;
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
        background: #2563eb;
        color: white;
      }

      .btn-primary:hover {
        background: #1d4ed8;
      }

      .btn-light {
        background: white;
        color: #0f172a;
      }

      .btn-outline {
        background: white;
        border: 1px solid #dbe2ea;
        color: #334155;
      }

      .btn:disabled {
        opacity: .55;
        cursor: not-allowed;
      }

      /* CARDS */

      .card,
      .stat-card {
        background: white;
        border: 1px solid #e5e7eb;
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

        background: #eff6ff;
        color: #2563eb;
      }

      .stat-label {
        font-size: 12px;
        color: #64748b;
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

        border-bottom: 1px solid #eef2f7;

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
        color: #64748b;
      }

      .small {
        font-size: 12px;
      }

      .empty-state {
        padding: 45px 20px;
        text-align: center;
        color: #64748b;
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

        border: 2px dashed #cbd5e1;

        border-radius: 16px;

        padding: 38px 20px;

        text-align: center;

        background: #f8fafc;

        transition: .2s;
      }

      .upload-zone:hover {
        border-color: #60a5fa;
        background: #eff6ff;
      }

      .upload-icon {
        width: 58px;
        height: 58px;

        margin: auto;

        border-radius: 16px;

        background: #dbeafe;
        color: #2563eb;

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

        border: 1px solid #dbe2ea;
        background: white;

        padding: 11px 13px;

        border-radius: 10px;

        margin-top: 14px;
      }

      /* GPS */

      .gps-box {
        padding: 14px;

        border: 1px solid #dbeafe;

        background: #eff6ff;

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

        background: #020617;

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
        border: 1px solid #e2e8f0;

        border-radius: 12px;

        padding: 15px;

        background: #f8fafc;
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

        border-bottom: 1px solid #eef2f7;

        text-align: left;

        white-space: nowrap;
      }

      th {
        color: #64748b;

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

        background: #eff6ff;
        color: #1d4ed8;
      }

      .confidence {
        min-width: 120px;
      }

      .bar-track {
        height: 7px;

        background: #e2e8f0;

        border-radius: 99px;

        overflow: hidden;
      }

      .bar-fill {
        height: 100%;

        border-radius: 99px;

        background: #2563eb;
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
        color: #64748b;
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

        border: 1px solid #e2e8f0;

        border-radius: 12px;

        background: #f8fafc;
      }

      .map-stat strong {
        display: block;
        font-size: 20px;
        margin-top: 4px;
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
        color: #64748b;
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
        border: 1px solid #e2e8f0;

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
        color: #64748b;
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

        background: #e2e8f0;

        border-radius: 99px;

        overflow: hidden;
      }

      .progress-fill {
        height: 100%;

        background: #2563eb;

        border-radius: 99px;
      }

      /* REPORT */

      .report-header {
        background: #0f172a;

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
        color: #94a3b8;

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

        border-bottom: 1px solid #eef2f7;
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

        background: #eff6ff;

        color: #2563eb;

        display: grid;

        place-items: center;
      }

      .mobile-menu {
        display: none;
      }

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
    `}</style>
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
      label: "Survey Map",
      icon: Map,
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
            SONAR-X
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
            SONAR-X uses AI-powered
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
}) {
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
          </div>
        </div>
      )}
    </>
  );
}

/* =========================================================
   WASTE COMPOSITION
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
              image. SONAR-X will
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

/* =========================================================
   SURVEY MAP
   ========================================================= */

function SurveyMapPage({
  analysisResult,
  reportInfo,
}) {
  const detections =
    normalizeDetections(
      analysisResult
    );

  const baseLocation =
    getLatLon(
      analysisResult?.geotag
    ) ||
    getLatLon(
      analysisResult?.location
    );

  const mapCenter =
    baseLocation || {
      lat: 20.5937,
      lon: 78.9629,
    };

  const high =
    detections.filter(
      (detection) =>
        detection.confidence_percent >=
        80
    ).length;

  const medium =
    detections.filter(
      (detection) =>
        detection.confidence_percent >=
          50 &&
        detection.confidence_percent <
          80
    ).length;

  const low =
    detections.filter(
      (detection) =>
        detection.confidence_percent <
        50
    ).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Survey Map
          </h1>

          <p>
            Visualize detected
            sonar targets and
            survey coordinates.
          </p>
        </div>
      </div>

      <div className="map-summary">
        <div className="map-stat">
          <span className="muted small">
            High confidence
          </span>

          <strong>
            {high}
          </strong>
        </div>

        <div className="map-stat">
          <span className="muted small">
            Medium confidence
          </span>

          <strong>
            {medium}
          </strong>
        </div>

        <div className="map-stat">
          <span className="muted small">
            Low confidence
          </span>

          <strong>
            {low}
          </strong>
        </div>
      </div>

      <div className="card map-card">
        <div className="card-header">
          <div>
            <div className="card-title">
              Sonar Target Map
            </div>

            <div
              className="muted small"
              style={{
                marginTop: 3,
              }}
            >
              {reportInfo?.filename ||
                "Latest analysis"}
            </div>
          </div>

          <span className="badge">
            <MapPin size={12} />

            {baseLocation
              ? `${baseLocation.lat.toFixed(
                  5
                )}, ${baseLocation.lon.toFixed(
                  5
                )}`
              : "No GPS"}
          </span>
        </div>

        <MapContainer
          center={[
            mapCenter.lat,
            mapCenter.lon,
          ]}
          zoom={
            baseLocation ? 15 : 5
          }
          className="map-container"
          scrollWheelZoom
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {baseLocation && (
            <Marker
              position={[
                baseLocation.lat,
                baseLocation.lon,
              ]}
              icon={sonarMarker}
            >
              <Popup>
                <strong>
                  SONAR-X Survey
                </strong>

                <br />

                Location:{" "}
                {baseLocation.lat.toFixed(
                  6
                )}
                ,{" "}
                {baseLocation.lon.toFixed(
                  6
                )}
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      {!baseLocation && (
        <div className="warning-note">
          No GPS coordinate was
          returned for this scan.
          Enable browser location
          permission before
          analysis if you want
          the survey map to use
          the survey position.
        </div>
      )}
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
                  SONAR-X AI
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
            </div>
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
            This SONAR-X module
            is ready for further
            configuration.
          </p>
        </div>
      </div>
    </>
  );
}

export default App;