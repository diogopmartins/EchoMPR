#!/usr/bin/env python3
"""
Train a 3D mitral-leaflet segmentation model on MVSeg2023 and export it as
an ONNX file that EchoMPR's "AI segmentation" panel can load.

Data: https://huggingface.co/datasets/pcarnahan/MVSeg2023
  <data>/train/train_001-US.nii.gz, <data>/train/train_001-label.nii.gz, ...
  <data>/val/val_001-US.nii.gz,     <data>/val/val_001-label.nii.gz, ...
  Labels: 0 background, 1 posterior leaflet, 2 anterior leaflet.
  Check the dataset licence before any use beyond research.

Model contract (must match src/utils/aiSegmentation.ts):
  input  float32 [1, 1, D, H, W] = [1, 1, z, y, x], a cube of ROI voxels per
         side at SPACING mm, intensities 0-255 scaled to [0, 1]
  output float32 [1, 3, D, H, W] class scores (argmax = label)

Usage (GPU strongly recommended):
  pip install -r scripts/requirements-train.txt
  python scripts/train_mvseg.py --data /path/to/MVSeg2023 --epochs 300
  # -> runs/mvseg/best.pt and runs/mvseg/mvseg_segresnet_128.onnx

Then in EchoMPR: AI segmentation -> Load .onnx model -> put the crosshair (or
a traced annulus) at the valve centre -> Run on this frame.
"""
import argparse
import glob
import os

import torch
from monai.data import CacheDataset, DataLoader, decollate_batch
from monai.inferers import sliding_window_inference
from monai.losses import DiceCELoss
from monai.metrics import DiceMetric
from monai.networks.nets import SegResNet
from monai.transforms import (
    AsDiscrete,
    Compose,
    EnsureChannelFirstd,
    EnsureTyped,
    LoadImaged,
    RandCropByPosNegLabeld,
    RandFlipd,
    RandRotate90d,
    RandScaleIntensityd,
    RandShiftIntensityd,
    ScaleIntensityRanged,
    SpatialPadd,
    Spacingd,
)

SPACING = 0.6  # mm, isotropic default; enter the same value in the app
ROI = 128  # voxels per side of the exported model input
NUM_CLASSES = 3


def pairs(split_dir):
    items = []
    for image in sorted(glob.glob(os.path.join(split_dir, "*-US.nii.gz"))):
        label = image.replace("-US.nii.gz", "-label.nii.gz")
        if os.path.exists(label):
            items.append({"image": image, "label": label})
    if not items:
        raise SystemExit(f"No *-US.nii.gz / *-label.nii.gz pairs in {split_dir}")
    return items


def transforms(train, roi, spacing):
    # No reorientation: EchoMPR feeds the volume in its own voxel order, so the
    # model should see the files' voxel order too. Random flips and 90° turns
    # on every axis make it robust to how the export was oriented.
    common = [
        LoadImaged(keys=["image", "label"]),
        EnsureChannelFirstd(keys=["image", "label"]),
        Spacingd(keys=["image", "label"], pixdim=(spacing,) * 3, mode=("bilinear", "nearest")),
        ScaleIntensityRanged(keys="image", a_min=0, a_max=255, b_min=0.0, b_max=1.0, clip=True),
        SpatialPadd(keys=["image", "label"], spatial_size=(roi,) * 3),
    ]
    if not train:
        return Compose(common + [EnsureTyped(keys=["image", "label"])])
    return Compose(
        common
        + [
            RandCropByPosNegLabeld(
                keys=["image", "label"],
                label_key="label",
                spatial_size=(roi,) * 3,
                pos=2,
                neg=1,
                num_samples=2,
            ),
            RandFlipd(keys=["image", "label"], prob=0.5, spatial_axis=0),
            RandFlipd(keys=["image", "label"], prob=0.5, spatial_axis=1),
            RandFlipd(keys=["image", "label"], prob=0.5, spatial_axis=2),
            RandRotate90d(keys=["image", "label"], prob=0.5, max_k=3, spatial_axes=(0, 1)),
            RandRotate90d(keys=["image", "label"], prob=0.3, max_k=3, spatial_axes=(1, 2)),
            RandScaleIntensityd(keys="image", factors=0.15, prob=0.5),
            RandShiftIntensityd(keys="image", offsets=0.08, prob=0.5),
            EnsureTyped(keys=["image", "label"]),
        ]
    )


class ZyxWrapper(torch.nn.Module):
    """Accept [N, C, z, y, x] like the app sends; MONAI arrays are [N, C, x, y, z]."""

    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, x):
        x = x.permute(0, 1, 4, 3, 2)
        y = self.net(x)
        return y.permute(0, 1, 4, 3, 2)


def export_onnx(net, path, device, roi, spacing):
    wrapped = ZyxWrapper(net).eval().to(device)
    dummy = torch.zeros(1, 1, roi, roi, roi, device=device)
    torch.onnx.export(
        wrapped,
        dummy,
        path,
        input_names=["image"],
        output_names=["scores"],
        opset_version=17,
        do_constant_folding=True,
    )
    # Newer exporters may write weights to <path>.data; the browser loads one
    # file, so fold everything back into a single self-contained .onnx.
    import onnx

    model = onnx.load(path)
    onnx.save_model(model, path, save_as_external_data=False)
    sidecar = path + ".data"
    if os.path.exists(sidecar):
        os.remove(sidecar)
    print(f"Exported {path}  (input [1,1,{roi},{roi},{roi}] at {spacing} mm, {NUM_CLASSES} classes)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="MVSeg2023 folder containing train/ and val/")
    ap.add_argument("--out", default="runs/mvseg")
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--val-every", type=int, default=5)
    ap.add_argument("--roi", type=int, default=ROI, help="Cube side in voxels (multiple of 8)")
    ap.add_argument("--spacing", type=float, default=SPACING, help="Isotropic spacing in mm")
    ap.add_argument("--export-only", action="store_true", help="Export <out>/best.pt to ONNX and exit")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    net = SegResNet(spatial_dims=3, in_channels=1, out_channels=NUM_CLASSES, init_filters=16, dropout_prob=0.1).to(device)
    best_path = os.path.join(args.out, "best.pt")
    onnx_path = os.path.join(args.out, f"mvseg_segresnet_{args.roi}.onnx")

    if args.export_only:
        net.load_state_dict(torch.load(best_path, map_location=device))
        export_onnx(net, onnx_path, device, args.roi, args.spacing)
        return

    train_ds = CacheDataset(pairs(os.path.join(args.data, "train")), transforms(True, args.roi, args.spacing), cache_rate=1.0, num_workers=4)
    val_ds = CacheDataset(pairs(os.path.join(args.data, "val")), transforms(False, args.roi, args.spacing), cache_rate=1.0, num_workers=4)
    train_dl = DataLoader(train_ds, batch_size=args.batch, shuffle=True, num_workers=4)
    val_dl = DataLoader(val_ds, batch_size=1, num_workers=2)

    loss_fn = DiceCELoss(to_onehot_y=True, softmax=True)
    opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    scaler = torch.cuda.amp.GradScaler(enabled=device.type == "cuda")
    dice = DiceMetric(include_background=False, reduction="mean_batch")
    post_pred = AsDiscrete(argmax=True, to_onehot=NUM_CLASSES)
    post_label = AsDiscrete(to_onehot=NUM_CLASSES)
    best = -1.0

    for epoch in range(1, args.epochs + 1):
        net.train()
        total = 0.0
        for batch in train_dl:
            x, y = batch["image"].to(device), batch["label"].to(device)
            opt.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type, enabled=device.type == "cuda"):
                loss = loss_fn(net(x), y)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            total += loss.item()
        sched.step()
        print(f"epoch {epoch:4d}  loss {total / max(1, len(train_dl)):.4f}")

        if epoch % args.val_every and epoch != args.epochs:
            continue
        net.eval()
        with torch.no_grad():
            for batch in val_dl:
                x, y = batch["image"].to(device), batch["label"].to(device)
                with torch.autocast(device_type=device.type, enabled=device.type == "cuda"):
                    logits = sliding_window_inference(x, (args.roi,) * 3, 2, net, overlap=0.5)
                preds = [post_pred(p) for p in decollate_batch(logits)]
                labels = [post_label(l) for l in decollate_batch(y)]
                dice(y_pred=preds, y=labels)
        per_class = dice.aggregate().tolist()
        dice.reset()
        mean = sum(per_class) / len(per_class)
        print(f"  val Dice posterior {per_class[0]:.3f}  anterior {per_class[1]:.3f}  mean {mean:.3f}")
        if mean > best:
            best = mean
            torch.save(net.state_dict(), best_path)
            print(f"  saved {best_path}")

    net.load_state_dict(torch.load(best_path, map_location=device))
    export_onnx(net, onnx_path, device, args.roi, args.spacing)


if __name__ == "__main__":
    main()
