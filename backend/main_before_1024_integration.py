from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from ultralytics import YOLO
from backend.rcnn.inference import detect_with_rcnn
from backend.assistant.api import router as assistant_router
from backend.advanced_intelligence import router as advanced_intelligence_router
from backend.segmentation import router as segmentation_router
from PIL import Image, ImageStat

import io
import os
import uuid
import threading
from datetime import datetime


# ============================================================
# SONAR-X BACKEND
# ============================================================

app = FastAPI(
    title="SONAR-X API",
    description="SONAR-X Underwater Intelligence Backend",
    version="2.0.0"
)


# ============================================================
# AI MARINE INTELLIGENCE ASSISTANT API
# ============================================================

app.include_router(assistant_router)
app.include_router(
    advanced_intelligence_router
)
app.include_router(segmentation_router)

# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# ============================================================
# DIRECTORIES
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_PATH = os.path.join(
    BASE_DIR,
    "runs",
    "runs",
    "multiclass",
    "sonar_4class",
    "weights",
    "best.pt"
)

ANNOTATED_DIR = os.path.join(
    BASE_DIR,
    "annotated"
)

DATASETS_DIR = os.path.join(
    BASE_DIR,
    "datasets"
)

TRAINING_DIR = os.path.join(
    BASE_DIR,
    "runs",
    "training"
)


os.makedirs(ANNOTATED_DIR, exist_ok=True)
os.makedirs(DATASETS_DIR, exist_ok=True)
os.makedirs(TRAINING_DIR, exist_ok=True)


# ============================================================
# STATIC FILES
# ============================================================

app.mount(
    "/annotated",
    StaticFiles(directory=ANNOTATED_DIR),
    name="annotated"
)

app.mount(
    "/datasets-files",
    StaticFiles(directory=DATASETS_DIR),
    name="datasets-files"
)

SEGMENTED_DIR = os.path.join(
    BASE_DIR,
    "segmented"
)
os.makedirs(SEGMENTED_DIR, exist_ok=True)

app.mount(
    "/segmented",
    StaticFiles(directory=SEGMENTED_DIR),
    name="segmented"
)


# ============================================================
# LOAD YOLO MODEL
# ============================================================

print("==========================================")
print("Loading YOLO model...")
print("Model path:", MODEL_PATH)
print("==========================================")


if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(
        f"YOLO model not found at: {MODEL_PATH}"
    )


model = YOLO(MODEL_PATH)

print("YOLO model loaded successfully.")
print("Original model classes:", model.names)


# ============================================================
# SONAR-X CLASS NAMES
# ============================================================

CLASS_NAMES = {
    0: "Aircraft",
    1: "Fish",
    2: "Rocks/Stones",
    3: "Shipwreck",
}


# ============================================================
# UNKNOWN ANOMALY DISCOVERY
# ============================================================

# Prototype threshold:
# Predictions below 40% confidence are flagged
# as potential unknown anomalies.

UNKNOWN_ANOMALY_THRESHOLD = 0.40


# ============================================================
# DEFAULT SURVEY LOCATION
# ============================================================

DEFAULT_LATITUDE = 13.0827
DEFAULT_LONGITUDE = 80.2707


# ============================================================
# TRAINING STATE
# ============================================================

training_state = {
    "status": "Idle",
    "dataset_name": None,
    "epochs": None,
    "model_path": MODEL_PATH,
    "message": "Training pipeline is ready."
}

training_lock = threading.Lock()


# ============================================================
# DATASET HELPERS
# ============================================================

def count_images(folder: str) -> int:

    image_ext = {
        ".jpg",
        ".jpeg",
        ".png",
        ".bmp",
        ".webp",
        ".tif",
        ".tiff"
    }

    count = 0

    for root, _, files in os.walk(folder):

        count += sum(
            1
            for name in files
            if os.path.splitext(name)[1].lower()
            in image_ext
        )

    return count


def find_data_yaml(folder: str):

    candidates = []

    for root, _, files in os.walk(folder):

        for name in files:

            if name.lower() in {
                "data.yaml",
                "data.yml",
                "dataset.yaml",
                "dataset.yml"
            }:

                candidates.append(
                    os.path.join(root, name)
                )

    return candidates[0] if candidates else None


def discover_datasets():

    datasets = []

    if not os.path.isdir(DATASETS_DIR):
        return datasets

    for name in sorted(os.listdir(DATASETS_DIR)):

        folder = os.path.join(
            DATASETS_DIR,
            name
        )

        if not os.path.isdir(folder):
            continue

        yaml_path = find_data_yaml(folder)

        images = count_images(folder)

        datasets.append({

            "name": name,

            "images": images,

            "status": (
                "Ready"
                if yaml_path
                else "Needs data.yaml"
            ),

            "trainable": bool(yaml_path),

            "data_yaml": (
                os.path.relpath(
                    yaml_path,
                    BASE_DIR
                )
                if yaml_path
                else None
            ),

            "path": os.path.relpath(
                folder,
                BASE_DIR
            ),

        })

    return datasets


# ============================================================
# TRAINING PIPELINE
# ============================================================

class TrainingRequest(BaseModel):

    dataset_name: str

    epochs: int = 20


def run_training(
    dataset_name: str,
    data_yaml: str,
    epochs: int
):

    global training_state

    try:

        with training_lock:

            training_state.update({

                "status": "Running",

                "dataset_name": dataset_name,

                "epochs": epochs,

                "message":
                    f"YOLO training started for {dataset_name}.",

            })


        result = model.train(

            data=data_yaml,

            epochs=epochs,

            imgsz=640,

            project=TRAINING_DIR,

            name=(
                f"{dataset_name.replace(' ', '_')}_"
                f"{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            ),

            exist_ok=False,

            verbose=True,

        )


        save_dir = str(
            getattr(
                result,
                "save_dir",
                ""
            )
        )


        best_path = (
            os.path.join(
                save_dir,
                "weights",
                "best.pt"
            )
            if save_dir
            else ""
        )


        with training_lock:

            training_state.update({

                "status": "Completed",

                "model_path": (
                    best_path
                    if os.path.exists(best_path)
                    else MODEL_PATH
                ),

                "message":
                    "YOLO training completed successfully.",

            })


    except Exception as exc:

        with training_lock:

            training_state.update({

                "status": "Failed",

                "message": str(exc),

            })


# ============================================================
# ROOT / HEALTH
# ============================================================

@app.get("/")
def root():

    return {

        "message":
            "SONAR-X Backend is running",

        "model":
            "YOLO11n",

        "classes":
            CLASS_NAMES,

        "geotagging":
            True,

        "dataset_repository":
            True,

        "training_pipeline":
            True,

        "waste_hotspot":
            True,

        "unknown_anomaly_discovery":
            True,

        "unknown_anomaly_threshold":
            UNKNOWN_ANOMALY_THRESHOLD,

        "system":
            "SONAR-X Underwater Intelligence System",

    }


@app.get("/health")
def health():

    return {

        "status":
            "ok",

        "model_loaded":
            True,

        "geotagging_enabled":
            True,

        "dataset_repository_enabled":
            True,

        "training_pipeline_enabled":
            True,

        "waste_hotspot_enabled":
            True,

        "unknown_anomaly_discovery_enabled":
            True,

        "unknown_anomaly_threshold":
            UNKNOWN_ANOMALY_THRESHOLD,

        "classes":
            CLASS_NAMES,

    }


# ============================================================
# DATASET REPOSITORY API
# ============================================================

@app.get("/datasets")
def get_datasets():

    return {

        "success":
            True,

        "repository":
            os.path.relpath(
                DATASETS_DIR,
                BASE_DIR
            ),

        "datasets":
            discover_datasets(),

        "training":
            training_state,

        "message":
            "Dataset repository scanned successfully.",

    }


@app.post("/datasets/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    dataset_name: str = Form(...)
):

    safe_name = "".join(
        ch
        for ch in dataset_name
        if ch.isalnum()
        or ch in "-_ "
    ).strip()


    if not safe_name:

        raise HTTPException(
            status_code=400,
            detail="Invalid dataset name."
        )


    dataset_dir = os.path.join(
        DATASETS_DIR,
        safe_name
    )

    os.makedirs(
        dataset_dir,
        exist_ok=True
    )


    filename = os.path.basename(
        file.filename
        or "uploaded_file"
    )


    destination = os.path.join(
        dataset_dir,
        filename
    )


    contents = await file.read()


    with open(
        destination,
        "wb"
    ) as output:

        output.write(contents)


    return {

        "success":
            True,

        "dataset_name":
            safe_name,

        "file":
            filename,

        "path":
            os.path.relpath(
                destination,
                BASE_DIR
            ),

        "message":
            "Dataset file added to the SONAR-X repository.",

    }


# ============================================================
# YOLO TRAINING API
# ============================================================

@app.post("/training/start")
def start_training(
    request: TrainingRequest
):

    datasets = discover_datasets()


    selected = next(
        (
            d
            for d in datasets
            if d["name"] == request.dataset_name
        ),
        None
    )


    if not selected:

        raise HTTPException(
            status_code=404,
            detail=
                "Dataset not found in the SONAR-X repository."
        )


    if not selected["data_yaml"]:

        raise HTTPException(
            status_code=400,
            detail=
                "This dataset does not contain "
                "data.yaml/data.yml, so YOLO training "
                "cannot start."
        )


    if request.epochs < 1 or request.epochs > 300:

        raise HTTPException(
            status_code=400,
            detail=
                "Epochs must be between 1 and 300."
        )


    if training_state["status"] == "Running":

        raise HTTPException(
            status_code=409,
            detail=
                "A YOLO training job is already running."
        )


    data_yaml = os.path.join(
        BASE_DIR,
        selected["data_yaml"]
    )


    thread = threading.Thread(

        target=run_training,

        args=(
            request.dataset_name,
            data_yaml,
            request.epochs
        ),

        daemon=True,

    )


    thread.start()


    return {

        "success":
            True,

        "status":
            "Running",

        "dataset_name":
            request.dataset_name,

        "epochs":
            request.epochs,

        "model_path":
            MODEL_PATH,

        "message":
            f"YOLO training started for "
            f"{request.dataset_name}.",

    }


@app.get("/training/status")
def get_training_status():

    return training_state


# ============================================================
# ANALYZE SONAR + LIVE GEOTAGGING
# ============================================================

@app.post("/detect")
@app.post("/analyze")
async def analyze_image(

    file: UploadFile = File(...),

    latitude: float = Form(
        DEFAULT_LATITUDE
    ),

    longitude: float = Form(
        DEFAULT_LONGITUDE
    ),

):

    try:

        # ----------------------------------------------------
        # READ IMAGE
        # ----------------------------------------------------

        contents = await file.read()


        image = Image.open(
            io.BytesIO(contents)
        ).convert("RGB")


        # ----------------------------------------------------
        # YOLO INFERENCE
        # ----------------------------------------------------

        results = model.predict(

            source=image,

            conf=0.25,

            iou=0.45,

            imgsz=640,

            verbose=False,

        )


        result = results[0]


        # ----------------------------------------------------
        # DETECTION STORAGE
        # ----------------------------------------------------

        detections = []

        # NEW — Feature 2A
        unknown_anomalies = []


        # ----------------------------------------------------
        # PROCESS YOLO DETECTIONS
        # ----------------------------------------------------

        if result.boxes is not None:

            for box in result.boxes:

                class_id = int(
                    box.cls[0]
                )


                confidence = float(
                    box.conf[0]
                )


                x1, y1, x2, y2 = (
                    box.xyxy[0].tolist()
                )


                # ------------------------------------------------
                # CLASS NAME
                # ------------------------------------------------

                class_name = CLASS_NAMES.get(

                    class_id,

                    model.names.get(
                        class_id,
                        f"Class_{class_id}"
                    )

                )


                # ------------------------------------------------
                # FEATURE 2A
                # UNKNOWN ANOMALY CHECK
                # ------------------------------------------------

                is_unknown_anomaly = (
                    confidence
                    < UNKNOWN_ANOMALY_THRESHOLD
                )


                # ------------------------------------------------
                # BUILD DETECTION
                # ------------------------------------------------

                detection = {

                    "class_id":
                        class_id,

                    "class_name":
                        class_name,

                    "confidence":
                        round(
                            confidence,
                            4
                        ),

                    "confidence_percent":
                        round(
                            confidence * 100,
                            1
                        ),

                    "bbox": [

                        round(x1),

                        round(y1),

                        round(x2),

                        round(y2)

                    ],

                    "bounding_box": {

                        "x1":
                            round(x1),

                        "y1":
                            round(y1),

                        "x2":
                            round(x2),

                        "y2":
                            round(y2),

                    },

                    "location": {

                        "latitude":
                            latitude,

                        "longitude":
                            longitude

                    },


                    # ------------------------------------------------
                    # NEW — UNKNOWN ANOMALY FIELDS
                    # ------------------------------------------------

                    "is_unknown_anomaly":
                        is_unknown_anomaly,

                    "anomaly_status": (

                        "Unknown Anomaly"

                        if is_unknown_anomaly

                        else
                        "Known Class Candidate"

                    ),

                    "anomaly_reason": (

                        "Low AI confidence; "
                        "expert verification is required "
                        "before accepting the predicted class."

                        if is_unknown_anomaly

                        else

                        "AI confidence is above the "
                        "prototype unknown-anomaly threshold."

                    )

                }


                # ------------------------------------------------
                # ADD TO ALL DETECTIONS
                # ------------------------------------------------

                detections.append(
                    detection
                )


                # ------------------------------------------------
                # ADD TO UNKNOWN ANOMALIES
                # ------------------------------------------------

                if is_unknown_anomaly:

                    unknown_anomalies.append(
                        detection
                    )


        # ========================================================
        # ANNOTATED IMAGE
        # ========================================================

        annotated_filename = (
            f"{uuid.uuid4().hex}.jpg"
        )


        annotated_path = os.path.join(
            ANNOTATED_DIR,
            annotated_filename
        )


        annotated_image = result.plot()


        annotated_image = Image.fromarray(
            annotated_image[..., ::-1]
        )


        # Keep the judge-facing result lightweight so the annotated image
        # appears quickly in the browser. Do not alter the source image.
        max_display_width = 1400
        if annotated_image.width > max_display_width:
            scale = max_display_width / annotated_image.width
            annotated_image = annotated_image.resize(
                (max_display_width, max(1, int(annotated_image.height * scale))),
                Image.Resampling.LANCZOS,
            )

        annotated_image.save(
            annotated_path,
            quality=88,
            optimize=True
        )


        # ========================================================
        # HIGHEST CONFIDENCE
        # ========================================================

        highest_confidence = max(

            (
                d["confidence_percent"]
                for d in detections
            ),

            default=0

        )


        # ========================================================
        # SCAN ID
        # ========================================================

        scan_id = (
            f"SONAR-"
            f"{uuid.uuid4().hex[:8].upper()}"
        )


        # ========================================================
        # GEOTAG
        # ========================================================

        geotag = {

            "latitude":
                latitude,

            "longitude":
                longitude,

            "source": (

                "Live browser/device GPS"

                if (
                    latitude != DEFAULT_LATITUDE
                    or
                    longitude != DEFAULT_LONGITUDE
                )

                else
                "Survey Location"

            ),

            "accuracy":
                "Prototype GPS location",

        }


        # ========================================================
        # UNKNOWN ANOMALY MESSAGE
        # ========================================================

        if len(unknown_anomalies) > 0:

            analysis_message = (

                f"Sonar analysis completed. "
                f"{len(unknown_anomalies)} potential "
                f"unknown anomaly/anomalies detected. "
                f"Expert verification is recommended."

            )

        else:

            analysis_message = (

                "Sonar analysis and geotagging "
                "completed successfully. "
                "No low-confidence unknown anomalies "
                "were detected."

            )


        # ========================================================
        # API RESPONSE
        # ========================================================

        return {

            "success":
                True,

            "status":
                "Analysis Completed",

            "scan_id":
                scan_id,

            "filename":
                file.filename,

            "model":
                "YOLO11n SONAR-X",

            "objects_detected":
                len(detections),

            "count":
                len(detections),

            "highest_confidence":
                highest_confidence,

            "detections":
                detections,


            # ====================================================
            # FEATURE 2A — UNKNOWN ANOMALY RESULTS
            # ====================================================

            "unknown_anomaly_count":
                len(unknown_anomalies),

            "unknown_anomalies":
                unknown_anomalies,

            "unknown_anomaly_threshold":
                UNKNOWN_ANOMALY_THRESHOLD,

            "review_required":
                len(unknown_anomalies) > 0,


            # ====================================================
            # ANNOTATED IMAGE
            # ====================================================

            "annotated_image":
                f"/annotated/{annotated_filename}",


            # ====================================================
            # GEOTAGGING
            # ====================================================

            "geotag":
                geotag,

            "location": {

                "latitude":
                    latitude,

                "longitude":
                    longitude

            },


            # ====================================================
            # MESSAGE
            # ====================================================

            "message":
                analysis_message,

        }


    except Exception as exc:

        print(
            "SONAR ANALYSIS ERROR:",
            str(exc)
        )


        return {

            "success":
                False,

            "status":
                "Analysis Failed",

            "error":
                str(exc),

            "objects_detected":
                0,

            "detections":
                [],

            "unknown_anomaly_count":
                0,

            "unknown_anomalies":
                [],

            "unknown_anomaly_threshold":
                UNKNOWN_ANOMALY_THRESHOLD,

            "review_required":
                False,

            "annotated_image":
                None,

        }


# ============================================================
# WASTE HOTSPOT DETECTION + GEOTAGGING
# ============================================================

@app.post("/waste-hotspot")
async def waste_hotspot(

    file: UploadFile = File(...),

    latitude: float = Form(
        DEFAULT_LATITUDE
    ),

    longitude: float = Form(
        DEFAULT_LONGITUDE
    ),

):

    try:

        contents = await file.read()


        image = Image.open(
            io.BytesIO(contents)
        ).convert("RGB")


        # ----------------------------------------------------
        # IMAGE TEXTURE ANALYSIS
        # ----------------------------------------------------

        gray = image.convert("L")


        analysis_image = gray.resize(
            (256, 256)
        )


        stats = ImageStat.Stat(
            analysis_image
        )


        mean_intensity = float(
            stats.mean[0]
        )


        stddev = float(
            stats.stddev[0]
        )


        texture_score = min(
            max(
                stddev / 64.0,
                0.0
            ),
            1.0
        )


        # ----------------------------------------------------
        # YOLO DETECTION
        # ----------------------------------------------------

        results = model.predict(

            source=image,

            conf=0.25,

            iou=0.45,

            imgsz=640,

            verbose=False

        )


        result = results[0]


        detections = []


        if result.boxes is not None:

            for box in result.boxes:

                class_id = int(
                    box.cls[0]
                )


                confidence = float(
                    box.conf[0]
                )


                x1, y1, x2, y2 = (
                    box.xyxy[0].tolist()
                )


                class_name = CLASS_NAMES.get(

                    class_id,

                    model.names.get(
                        class_id,
                        f"Class_{class_id}"
                    )

                )


                detections.append({

                    "class_id":
                        class_id,

                    "class_name":
                        class_name,

                    "confidence":
                        round(
                            confidence,
                            4
                        ),

                    "confidence_percent":
                        round(
                            confidence * 100,
                            1
                        ),

                    "bbox": [

                        round(x1),

                        round(y1),

                        round(x2),

                        round(y2)

                    ],

                })


        # ----------------------------------------------------
        # HOTSPOT SCORE
        # ----------------------------------------------------

        detection_count = len(
            detections
        )


        detection_score = min(
            detection_count / 5.0,
            1.0
        )


        hotspot_score = round(

            min(

                max(

                    (
                        texture_score * 70
                    )
                    +
                    (
                        detection_score * 30
                    ),

                    0

                ),

                100

            ),

            1

        )


        # ----------------------------------------------------
        # RISK
        # ----------------------------------------------------

        if hotspot_score >= 70:

            risk = "High"

            priority = (
                "Immediate Inspection"
            )

            message = (
                "High-priority sonar hotspot "
                "identified for further inspection."
            )


        elif hotspot_score >= 40:

            risk = "Medium"

            priority = (
                "Further Inspection"
            )

            message = (
                "Potential sonar hotspot identified. "
                "Further inspection is recommended."
            )


        else:

            risk = "Low"

            priority = (
                "Routine Monitoring"
            )

            message = (
                "Low-intensity sonar area. "
                "No strong hotspot signal detected."
            )


        hotspot_detected = (
            hotspot_score >= 40
        )


        scan_id = (
            f"HOTSPOT-"
            f"{uuid.uuid4().hex[:8].upper()}"
        )


        # ----------------------------------------------------
        # RESPONSE
        # ----------------------------------------------------

        return {

            "success":
                True,

            "status":
                "Waste Hotspot Analysis Completed",

            "scan_id":
                scan_id,

            "filename":
                file.filename,

            "hotspot_detected":
                hotspot_detected,

            "hotspot":
                hotspot_detected,

            "risk":
                risk,

            "priority":
                priority,

            "hotspot_score":
                hotspot_score,

            "image_mean_intensity":
                round(
                    mean_intensity,
                    2
                ),

            "image_texture_score":
                round(
                    texture_score * 100,
                    1
                ),

            "detected_target_count":
                detection_count,

            "detection_density_score":
                round(
                    detection_score * 100,
                    1
                ),

            "location": {

                "latitude":
                    latitude,

                "longitude":
                    longitude

            },

            "geotag": {

                "latitude":
                    latitude,

                "longitude":
                    longitude,

                "source": (

                    "Live browser/device GPS"

                    if (
                        latitude != DEFAULT_LATITUDE
                        or
                        longitude != DEFAULT_LONGITUDE
                    )

                    else
                    "Survey Location"

                ),

                "accuracy":
                    "Prototype GPS location",

            },

            "sonar_targets":
                detections,

            "message":
                message,

            "note":
                (
                    "Prototype hotspot estimation only. "
                    "The current YOLO model contains "
                    "Aircraft, Fish, Rocks/Stones and "
                    "Shipwreck classes, but no dedicated "
                    "waste class. Therefore this result "
                    "must not be interpreted as confirmed "
                    "waste detection."
                ),

        }


    except Exception as exc:

        print(
            "WASTE HOTSPOT ERROR:",
            str(exc)
        )


        return {

            "success":
                False,

            "status":
                "Waste Hotspot Analysis Failed",

            "error":
                str(exc),

            "hotspot_detected":
                False,

            "hotspot":
                False,

            "risk":
                "Unknown",

            "priority":
                "Unknown",

            "hotspot_score":
                0,

        }


# ============================================================
# GEOTAG API
# ============================================================

@app.get("/geotag")
def get_geotag():

    return {

        "latitude":
            DEFAULT_LATITUDE,

        "longitude":
            DEFAULT_LONGITUDE,

        "source":
            "SONAR-X prototype survey location",

    }


# ============================================================
# WASTE HOTSPOT INFORMATION
# ============================================================

@app.get("/waste-hotspot")
def waste_hotspot_info():

    return {

        "status":
            "Waste Hotspot Detection endpoint is available",

        "method":
            "POST",

        "endpoint":
            "/waste-hotspot",

        "description":
            "Prototype sonar hotspot estimation",

        "features": [

            "Sonar texture analysis",

            "Target density analysis",

            "Hotspot score",

            "Risk classification",

            "Priority classification",

            "GPS geotagging",

            "Survey Map integration in frontend",

        ],

        "warning":
            "Current YOLO model has no dedicated waste class.",

    }


# ============================================================
# R-CNN OBJECT DETECTION
# ============================================================

@app.post("/rcnn-detect")
async def rcnn_detect(

    file: UploadFile = File(...),

    latitude: float = Form(
        DEFAULT_LATITUDE
    ),

    longitude: float = Form(
        DEFAULT_LONGITUDE
    ),

):

    try:

        contents = await file.read()


        image = Image.open(
            io.BytesIO(contents)
        ).convert("RGB")


        result = detect_with_rcnn(

            image,

            confidence_threshold=0.25

        )


        detections = []


        for detection in result["detections"]:

            detection["location"] = {

                "latitude":
                    latitude,

                "longitude":
                    longitude

            }


            detections.append(
                detection
            )


        return {

            "success":
                True,

            "status":
                "R-CNN Analysis Completed",

            "scan_id":
                f"RCNN-{uuid.uuid4().hex[:8].upper()}",

            "filename":
                file.filename,

            "model":
                result["model"],

            "objects_detected":
                result["objects_detected"],

            "count":
                result["count"],

            "highest_confidence":
                result["highest_confidence"],

            "detections":
                detections,

            "geotag": {

                "latitude":
                    latitude,

                "longitude":
                    longitude,

                "source": (

                    "Live browser/device GPS"

                    if (

                        latitude != DEFAULT_LATITUDE
                        or
                        longitude != DEFAULT_LONGITUDE

                    )

                    else
                    "Survey Location"

                ),

                "accuracy":
                    "Prototype GPS location"

            },

            "message":
                "R-CNN sonar analysis completed successfully."

        }


    except Exception as exc:

        print(
            "R-CNN ANALYSIS ERROR:",
            str(exc)
        )


        return {

            "success":
                False,

            "status":
                "R-CNN Analysis Failed",

            "error":
                str(exc),

            "objects_detected":
                0,

            "detections":
                []

        }