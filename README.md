 # SONAR-X

## Underwater Marine Object Detection and Intelligence System

SONAR-X is an AI-powered underwater intelligence platform designed to analyze Side-Scan Sonar (SSS) data and identify potential man-made objects and underwater anomalies.

The system combines computer vision, deep learning, segmentation, geospatial analysis, and an interactive web dashboard to assist marine authorities and researchers in understanding underwater environments.

## SIH Problem Statement

**SIH26057**

Given underwater Side-Scan Sonar data, automatically identify man-made objects, distinguish them from natural seabed structures, determine their location, estimate detection confidence/severity, and generate actionable information for marine authorities.

## Key Features

- Side-Scan Sonar image analysis
- AI-based underwater object detection
- YOLO-based detection
- R-CNN-based detection
- YOLO segmentation
- Underwater anomaly identification
- Confidence estimation
- Survey map visualization
- Geotagging support
- Waste hotspot analysis
- Waste composition analysis
- Location-wise analysis
- AI Marine Assistant
- Historical comparison
- Digital Twin visualization
- Detection reports
- Interactive marine intelligence dashboard

## Technology Stack

### Frontend

- React
- Vite
- JavaScript
- Lucide React
- HTML/CSS

### Backend

- Python
- FastAPI
- Uvicorn

### AI / Machine Learning

- YOLO
- Faster R-CNN
- ResNet-50 FPN
- YOLO Segmentation
- Computer Vision
- Image Segmentation

## System Architecture

```text
Side-Scan Sonar Data
        |
        v
   Data Processing
        |
        v
+-----------------------+
| AI Detection Models   |
|                       |
| YOLO                  |
| Faster R-CNN          |
+-----------------------+
        |
        v
   Segmentation
        |
        v
Object / Anomaly Analysis
        |
        +----------------+
        |                |
        v                v
 Survey Map         Intelligence
 Visualization      & Reports
        |
        v
Marine Authority Dashboard
SONAR-X/
│
├── backend/
│   ├── assistant/
│   ├── rcnn/
│   ├── segmentation.py
│   ├── advanced_intelligence.py
│   └── main.py
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   │
│   ├── package.json
│   └── vite.config.js
│
├── dataset/
│
├── prepare_dataset.py
├── .gitignore
└── README.md
