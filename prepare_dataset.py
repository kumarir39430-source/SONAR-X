from pathlib import Path
from PIL import Image
import random
import shutil

# SONAR-X project folder
BASE = Path(r"C:\Users\kumar\Downloads\SONAR-X")

# SubPipe dataset
DATASET = BASE / "dataset" / "SubPipeMiniSSS"

# High-frequency side-scan sonar data
IMAGE_DIR = DATASET / "DATA" / "SSS_HF_images" / "Image"
LABEL_DIR = DATASET / "DATA" / "SSS_HF_images" / "YOLO_Annotation"

# Output YOLO dataset
OUTPUT = BASE / "dataset" / "YOLO_Dataset"

# Create folders
for folder in [
    OUTPUT / "images" / "train",
    OUTPUT / "images" / "val",
    OUTPUT / "labels" / "train",
    OUTPUT / "labels" / "val",
]:
    folder.mkdir(parents=True, exist_ok=True)

# Get YOLO annotation files
label_files = [
    f for f in LABEL_DIR.glob("*.txt")
    if f.name.lower() != "classes.txt"
]

pairs = []

for label_file in label_files:
    stem = label_file.stem
    image_file = IMAGE_DIR / f"{stem}.pbm"

    if image_file.exists():
        pairs.append((image_file, label_file))

print(f"Annotation files found: {len(label_files)}")
print(f"Matching image-label pairs: {len(pairs)}")

# Shuffle
random.seed(42)
random.shuffle(pairs)

# 80% train / 20% validation
split = int(len(pairs) * 0.8)

train_pairs = pairs[:split]
val_pairs = pairs[split:]

print(f"Training pairs: {len(train_pairs)}")
print(f"Validation pairs: {len(val_pairs)}")


def process_pairs(pairs, split_name):

    for image_file, label_file in pairs:

        stem = image_file.stem

        # Convert PBM to JPG
        output_image = (
            OUTPUT / "images" / split_name / f"{stem}.jpg"
        )

        with Image.open(image_file) as img:
            img = img.convert("L")
            img.save(output_image, quality=95)

        # Copy YOLO label
        output_label = (
            OUTPUT / "labels" / split_name / f"{stem}.txt"
        )

        shutil.copy2(label_file, output_label)


print("\nProcessing training images...")
process_pairs(train_pairs, "train")

print("Processing validation images...")
process_pairs(val_pairs, "val")


# Create data.yaml
yaml_content = """path: C:/Users/kumar/Downloads/SONAR-X/dataset/YOLO_Dataset
train: images/train
val: images/val

names:
  0: Pipeline
"""

with open(
    OUTPUT / "data.yaml",
    "w",
    encoding="utf-8"
) as f:
    f.write(yaml_content)

print("\n===================================")
print("DATASET PREPARATION COMPLETED")
print("===================================")
print(f"Dataset: {OUTPUT}")
print(f"data.yaml: {OUTPUT / 'data.yaml'}")