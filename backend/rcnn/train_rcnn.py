from pathlib import Path
import random
import time

import torch
from torch.utils.data import Dataset, DataLoader
from PIL import Image
from torchvision.transforms import functional as F
from torchvision.models.detection import fasterrcnn_mobilenet_v3_large_320_fpn
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor

# =========================================================
# FAST CPU R-CNN TRAINING FOR SONAR-X
# Dataset: MultiClass_Sonar (4 classes)
# =========================================================

# Project root:
# C:\Users\kumar\Downloads\SONAR-X
BASE_DIR = Path(__file__).resolve().parents[2]
DATASET_DIR = BASE_DIR / "dataset" / "MultiClass_Sonar"
TRAIN_IMAGES = DATASET_DIR / "images" / "train"
TRAIN_LABELS = DATASET_DIR / "labels" / "train"
VAL_IMAGES = DATASET_DIR / "images" / "val"
VAL_LABELS = DATASET_DIR / "labels" / "val"

WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
BEST_MODEL_PATH = WEIGHTS_DIR / "best_rcnn.pth"

# ---------------------------------------------------------
# CPU-FRIENDLY SETTINGS
# ---------------------------------------------------------
NUM_CLASSES = 5       # background + 4 sonar classes
NUM_EPOCHS = 3        # start with 3; increase later if needed
BATCH_SIZE = 1        # Faster R-CNN CPU-friendly batch size
NUM_WORKERS = 0       # Windows: safest and usually fastest for this setup
IMAGE_SIZE = 320      # MobileNet Faster R-CNN is designed for 320px input

# Limit the number of training images for a fast prototype run.
# Set to None to use the complete training dataset.
MAX_TRAIN_IMAGES = 300
MAX_VAL_IMAGES = 100

LEARNING_RATE = 0.005
MOMENTUM = 0.9
WEIGHT_DECAY = 0.0005
SEED = 42

# True = use pretrained MobileNet backbone. First run may download weights.
USE_PRETRAINED = True

random.seed(SEED)
torch.manual_seed(SEED)

# Keep CPU thread usage reasonable on Windows laptops.
CPU_THREADS = max(1, min(4, torch.get_num_threads()))
torch.set_num_threads(CPU_THREADS)


def list_images(folder):
    extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
    return sorted(
        [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in extensions]
    )


class SonarDataset(Dataset):
    """Reads YOLO-format labels and converts them to Faster R-CNN boxes."""

    def __init__(self, image_dir, label_dir, max_images=None):
        self.image_paths = list_images(image_dir)
        if max_images is not None:
            self.image_paths = self.image_paths[:max_images]
        self.label_dir = Path(label_dir)

        if not self.image_paths:
            raise RuntimeError(f"No images found in: {image_dir}")

    def __len__(self):
        return len(self.image_paths)

    def __getitem__(self, index):
        image_path = self.image_paths[index]
        image = Image.open(image_path).convert("RGB")
        width, height = image.size

        boxes = []
        labels = []

        label_path = self.label_dir / f"{image_path.stem}.txt"

        if label_path.exists():
            with open(label_path, "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) != 5:
                        continue

                    class_id, x_center, y_center, box_width, box_height = map(
                        float, parts
                    )

                    # YOLO normalized coordinates -> pixel xyxy
                    x1 = (x_center - box_width / 2) * width
                    y1 = (y_center - box_height / 2) * height
                    x2 = (x_center + box_width / 2) * width
                    y2 = (y_center + box_height / 2) * height

                    x1 = max(0.0, min(x1, width - 1))
                    y1 = max(0.0, min(y1, height - 1))
                    x2 = max(0.0, min(x2, width - 1))
                    y2 = max(0.0, min(y2, height - 1))

                    if x2 > x1 and y2 > y1:
                        boxes.append([x1, y1, x2, y2])
                        # Faster R-CNN labels: 1..4; 0 is background.
                        labels.append(int(class_id) + 1)

        boxes = torch.as_tensor(boxes, dtype=torch.float32).reshape(-1, 4)
        labels = torch.as_tensor(labels, dtype=torch.int64)

        # Faster R-CNN needs these fields in the target dictionary.
        target = {
            "boxes": boxes,
            "labels": labels,
            "image_id": torch.tensor([index], dtype=torch.int64),
        }

        image = F.to_tensor(image)
        return image, target


def collate_fn(batch):
    return tuple(zip(*batch))


def build_model():
    """Small Faster R-CNN variant, much lighter than ResNet-50 FPN on CPU."""
    if USE_PRETRAINED:
        try:
            model = fasterrcnn_mobilenet_v3_large_320_fpn(weights="DEFAULT")
            print("Using pretrained MobileNetV3 Faster R-CNN weights.")
        except Exception as exc:
            print("Could not load/download pretrained weights:", exc)
            print("Falling back to randomly initialized weights.")
            model = fasterrcnn_mobilenet_v3_large_320_fpn(
                weights=None,
                weights_backbone=None,
            )
    else:
        model = fasterrcnn_mobilenet_v3_large_320_fpn(
            weights=None,
            weights_backbone=None,
        )

    # Replace the classifier for our 4 custom classes + background.
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(
        in_features,
        NUM_CLASSES,
    )

    return model


def main():
    print("=" * 60)
    print("SONAR-X FAST CPU R-CNN TRAINING")
    print("=" * 60)
    print(f"Dataset: {DATASET_DIR}")
    print(f"Train images: {TRAIN_IMAGES}")
    print(f"Val images:   {VAL_IMAGES}")
    print(f"Epochs:       {NUM_EPOCHS}")
    print(f"Max train:    {MAX_TRAIN_IMAGES}")
    print(f"Max val:      {MAX_VAL_IMAGES}")
    print(f"CPU threads:  {CPU_THREADS}")
    print("Model:        Faster R-CNN MobileNetV3 320 FPN")
    print("=" * 60)

    train_dataset = SonarDataset(
        TRAIN_IMAGES,
        TRAIN_LABELS,
        max_images=MAX_TRAIN_IMAGES,
    )

    val_dataset = SonarDataset(
        VAL_IMAGES,
        VAL_LABELS,
        max_images=MAX_VAL_IMAGES,
    )

    train_loader = DataLoader(
        train_dataset,
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=NUM_WORKERS,
        collate_fn=collate_fn,
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=NUM_WORKERS,
        collate_fn=collate_fn,
    )

    print(f"Training samples used: {len(train_dataset)}")
    print(f"Validation samples used: {len(val_dataset)}")
    print(f"Batches per epoch: {len(train_loader)}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    model = build_model().to(device)

    # SGD is stable and lightweight for this model.
    params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.SGD(
        params,
        lr=LEARNING_RATE,
        momentum=MOMENTUM,
        weight_decay=WEIGHT_DECAY,
    )

    # Small learning-rate schedule for the short prototype run.
    scheduler = torch.optim.lr_scheduler.StepLR(
        optimizer,
        step_size=max(1, NUM_EPOCHS // 2),
        gamma=0.1,
    )

    best_loss = float("inf")

    for epoch in range(NUM_EPOCHS):
        model.train()
        epoch_loss = 0.0
        start_time = time.time()

        for batch_index, (images, targets) in enumerate(train_loader, start=1):
            images = [img.to(device) for img in images]
            targets = [
                {key: value.to(device) for key, value in target.items()}
                for target in targets
            ]

            optimizer.zero_grad(set_to_none=True)

            loss_dict = model(images, targets)
            losses = sum(loss for loss in loss_dict.values())

            if not torch.isfinite(losses):
                print(f"WARNING: non-finite loss at batch {batch_index}: {losses.item()}")
                continue

            losses.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            optimizer.step()

            epoch_loss += losses.item()

            if batch_index == 1 or batch_index % 25 == 0 or batch_index == len(train_loader):
                print(
                    f"Epoch {epoch + 1}/{NUM_EPOCHS} | "
                    f"Batch {batch_index}/{len(train_loader)} | "
                    f"Loss {losses.item():.4f}"
                )

        average_loss = epoch_loss / max(1, len(train_loader))
        elapsed = time.time() - start_time

        print(
            f"Epoch {epoch + 1}/{NUM_EPOCHS} finished | "
            f"Avg loss: {average_loss:.4f} | "
            f"Time: {elapsed / 60:.1f} min"
        )

        # Save the best checkpoint based on training loss.
        if average_loss < best_loss:
            best_loss = average_loss
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "num_classes": NUM_CLASSES,
                    "best_loss": best_loss,
                    "epoch": epoch + 1,
                    "model_name": "fasterrcnn_mobilenet_v3_large_320_fpn",
                },
                BEST_MODEL_PATH,
            )
            print(f"Saved best model -> {BEST_MODEL_PATH}")

        scheduler.step()

    print("=" * 60)
    print("Training complete.")
    print(f"Best model: {BEST_MODEL_PATH}")
    print("=" * 60)


if __name__ == "__main__":
    main()
