from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from PIL import Image, ImageDraw
import io
import os
import json
import uuid
import numpy as np

router = APIRouter(prefix="/segmentation", tags=["Segmentation"])

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SEGMENTED_DIR = os.path.join(BASE_DIR, "segmented")
os.makedirs(SEGMENTED_DIR, exist_ok=True)

_sam_model = None

def _load_sam():
    global _sam_model
    if _sam_model is None:
        from ultralytics import SAM
        print("Loading MobileSAM fast segmentation model...")
        _sam_model = SAM("mobile_sam.pt")
        print("MobileSAM segmentation model loaded successfully.")
    return _sam_model

def _parse_detections(raw):
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid detections JSON: {exc}")
    if isinstance(value, dict):
        value = value.get("detections", [])
    return value if isinstance(value, list) else []

@router.get("/status")
def segmentation_status():
    return {
        "enabled": True,
        "model": "MobileSAM",
        "method": "YOLO bounding-box prompted pixel segmentation",
        "model_loaded": _sam_model is not None,
        "note": "Prototype integration. Mask quality depends on the promptable segmentation model and sonar imagery."
    }

@router.post("/segment")
async def segment_sonar(
    file: UploadFile = File(...),
    detections: str = Form("[]"),
):
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        dets = _parse_detections(detections)

        if not dets:
            return {
                "success": True,
                "status": "No detections to segment",
                "model": "MobileSAM",
                "objects_segmented": 0,
                "segments": [],
                "segmented_image": None,
                "message": "YOLO returned no bounding boxes, so no segmentation prompts were generated."
            }

        boxes = []
        valid_dets = []
        width, height = image.size

        for i, d in enumerate(dets):
            bbox = d.get("bbox") or d.get("bounding_box")
            if isinstance(bbox, dict):
                bbox = [bbox.get("x1"), bbox.get("y1"), bbox.get("x2"), bbox.get("y2")]
            if not bbox or len(bbox) != 4:
                continue
            try:
                x1, y1, x2, y2 = [float(v) for v in bbox]
            except (TypeError, ValueError):
                continue
            x1, x2 = sorted((max(0, min(width - 1, x1)), max(0, min(width - 1, x2))))
            y1, y2 = sorted((max(0, min(height - 1, y1)), max(0, min(height - 1, y2))))
            if x2 <= x1 or y2 <= y1:
                continue
            boxes.append([x1, y1, x2, y2])
            valid_dets.append(d)

        if not boxes:
            raise HTTPException(status_code=400, detail="No valid YOLO bounding boxes were supplied.")

        sam = _load_sam()
        # MobileSAM is dramatically lighter than SAM-B and is much better suited
        # to CPU-only demo environments. Keep the original image for display,
        # but let the model work at a smaller inference size.
        results = sam.predict(
            source=image,
            bboxes=boxes,
            imgsz=320,
            verbose=False,
        )

        result = results[0]
        masks = getattr(result, "masks", None)
        if masks is None or masks.data is None:
            raise RuntimeError("SAM did not return pixel masks for the supplied bounding boxes.")

        mask_data = masks.data.cpu().numpy()
        # mask_data is N x H x W in the model's image space.
        # Resize each mask to the original image dimensions for the returned overlay.
        from PIL import Image as PILImage

        base = image.copy().convert("RGBA")
        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        segments = []
        for i, mask_arr in enumerate(mask_data):
            if i >= len(valid_dets):
                break
            mask_img = PILImage.fromarray((mask_arr > 0.5).astype(np.uint8) * 255)
            mask_img = mask_img.resize(base.size, PILImage.Resampling.NEAREST)
            mask_np = np.array(mask_img) > 127

            rgba = np.zeros((height, width, 4), dtype=np.uint8)
            # Presentation overlay: translucent cyan mask + solid outline.
            rgba[mask_np] = [0, 229, 255, 88]
            mask_layer = PILImage.fromarray(rgba, "RGBA")
            overlay.alpha_composite(mask_layer)

            ys, xs = np.where(mask_np)
            area = int(mask_np.sum())
            if area:
                outline = Image.fromarray((mask_np.astype(np.uint8) * 255))
                bbox = valid_dets[i].get("bbox") or valid_dets[i].get("bounding_box")
                if isinstance(bbox, dict):
                    bbox = [bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]]

                segments.append({
                    "index": i,
                    "class_id": valid_dets[i].get("class_id"),
                    "class_name": valid_dets[i].get("class_name", "Unknown"),
                    "confidence": valid_dets[i].get("confidence"),
                    "confidence_percent": valid_dets[i].get("confidence_percent"),
                    "bbox": [round(float(v)) for v in bbox],
                    "mask_area_pixels": area,
                    "mask_area_percent_of_image": round((area / float(width * height)) * 100, 3),
                    "segmentation": "SAM box-prompted mask"
                })

        final = PILImage.alpha_composite(base, overlay)
        draw = ImageDraw.Draw(final)
        for seg in segments:
            x1, y1, x2, y2 = seg["bbox"]
            label = f'{seg["class_name"]} {seg.get("confidence_percent", 0):.1f}%'
            draw.rectangle((x1, y1, x2, y2), outline=(255, 255, 255, 230), width=2)
            draw.text((x1 + 4, max(2, y1 + 3)), label, fill=(255, 255, 255, 255))

        filename = f"{uuid.uuid4().hex}.png"
        path = os.path.join(SEGMENTED_DIR, filename)
        final.convert("RGB").save(path, quality=95)

        return {
            "success": True,
            "status": "Segmentation Completed",
            "model": "MobileSAM",
            "method": "YOLO bounding-box prompted pixel segmentation",
            "objects_segmented": len(segments),
            "segments": segments,
            "segmented_image": f"/segmented/{filename}",
            "message": "YOLO detections were retained as bounding boxes and used as prompts for fast MobileSAM pixel-level segmentation.",
            "note": "Prototype segmentation integration; masks should be validated against sonar-specific ground truth before scientific or operational use."
        }

    except HTTPException:
        raise
    except Exception as exc:
        print("SEGMENTATION ERROR:", str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
