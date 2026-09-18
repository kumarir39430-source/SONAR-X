from pathlib import Path

import cv2
import torch
from torchvision.models.detection import fasterrcnn_resnet50_fpn
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor


# =========================================================
# SONAR-X R-CNN INFERENCE
# Existing model: Faster R-CNN ResNet-50 FPN
# =========================================================

RCNN_DIR = Path(__file__).resolve().parent
MODEL_PATH = RCNN_DIR / "weights" / "best_rcnn.pth"


# Background = 0
# Dataset classes = 0,1,2,3
# Faster R-CNN classes = 1,2,3,4
CLASS_NAMES = {
    1: "Aircraft",
    2: "Fish",
    3: "Rocks/Stones",
    4: "Shipwreck",
}


NUM_CLASSES = 5

device = torch.device(
    "cuda" if torch.cuda.is_available() else "cpu"
)


print("Loading SONAR-X R-CNN model...")
print("Architecture: Faster R-CNN ResNet-50 FPN")


# ---------------------------------------------------------
# CREATE THE SAME ARCHITECTURE AS THE CHECKPOINT
# ---------------------------------------------------------

model = fasterrcnn_resnet50_fpn(
    weights=None,
    weights_backbone=None
)


# Replace classifier for 5 classes:
# background + 4 SONAR classes
in_features = model.roi_heads.box_predictor.cls_score.in_features

model.roi_heads.box_predictor = FastRCNNPredictor(
    in_features,
    NUM_CLASSES
)


# ---------------------------------------------------------
# LOAD TRAINED CHECKPOINT
# ---------------------------------------------------------

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"R-CNN model weights not found: {MODEL_PATH}"
    )


checkpoint = torch.load(
    str(MODEL_PATH),
    map_location=device
)


if (
    isinstance(checkpoint, dict)
    and "model_state_dict" in checkpoint
):
    state_dict = checkpoint["model_state_dict"]

elif (
    isinstance(checkpoint, dict)
    and "state_dict" in checkpoint
):
    state_dict = checkpoint["state_dict"]

else:
    state_dict = checkpoint


model.load_state_dict(
    state_dict,
    strict=True
)


model.to(device)
model.eval()


print("R-CNN model loaded successfully.")
print(f"R-CNN device: {device}")


# ---------------------------------------------------------
# DETECTION FUNCTION
# ---------------------------------------------------------

def detect_with_rcnn(
    image,
    confidence_threshold=0.50
):
    """
    Run Faster R-CNN detection on an OpenCV image.

    Returns:
        list of detections containing:
        class_id
        class_name
        confidence
        bbox
    """

    if image is None:
        raise ValueError(
            "Input image is None."
        )

    if not hasattr(image, "shape"):
        raise TypeError(
            "Input image must be a NumPy/OpenCV image."
        )


    # OpenCV BGR -> RGB
    rgb_image = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2RGB
    )


    # Convert image to PyTorch tensor
    image_tensor = torch.from_numpy(
        rgb_image
    ).permute(2, 0, 1).float() / 255.0


    image_tensor = image_tensor.to(device)


    # -----------------------------------------------------
    # RUN MODEL
    # -----------------------------------------------------

    with torch.no_grad():
        predictions = model(
            [image_tensor]
        )


    prediction = predictions[0]


    boxes = (
        prediction["boxes"]
        .detach()
        .cpu()
        .numpy()
    )

    labels = (
        prediction["labels"]
        .detach()
        .cpu()
        .numpy()
    )

    scores = (
        prediction["scores"]
        .detach()
        .cpu()
        .numpy()
    )


    detections = []


    # -----------------------------------------------------
    # FILTER RESULTS
    # -----------------------------------------------------

    for box, label, score in zip(
        boxes,
        labels,
        scores
    ):

        confidence = float(score)


        if confidence < confidence_threshold:
            continue


        class_id = int(label)


        if class_id not in CLASS_NAMES:
            continue


        x1, y1, x2, y2 = box.tolist()


        detection = {
            "class_id": class_id,
            "class_name": CLASS_NAMES[class_id],
            "confidence": round(
                confidence,
                4
            ),
            "bbox": [
                int(round(x1)),
                int(round(y1)),
                int(round(x2)),
                int(round(y2))
            ]
        }


        detections.append(
            detection
        )


    return detections