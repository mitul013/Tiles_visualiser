"""
Rebuild the two room-detection networks in public/models from their public checkpoints.

    pip install torch transformers onnx onnxruntime
    python scripts/detect/export_models.py [work_dir]            # the browser models (public/models)
    node scripts/detect/pack-models.cjs work_dir/room-seg.onnx work_dir/room-depth.onnx work_dir/room-scale.onnx
    python scripts/detect/export_models.py [work_dir] --server   # server only: room-seg-large.onnx

Models (all free for commercial use):
  * segmentation  openmmlab/upernet-convnext-tiny            MIT        ADE20K, 150 classes
  * depth         depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf   Apache-2.0   metric, metres
  * scale         onnx-community/metric3d-vit-small (Metric3D v2, BSD-2-Clause; ONNX export CC0)
                  absolute size of each room; downloaded as ONNX and quantised to 8 bit here

Both are exported with a dynamic input size and their weights quantised to 8 bit (about 4x smaller,
and faster on WebAssembly). Outputs are checked against PyTorch before quantisation.
"""
import os, sys, types, warnings
import numpy as np, torch
from torch import nn
from transformers import AutoModelForDepthEstimation, UperNetForSemanticSegmentation

warnings.filterwarnings('ignore')
SERVER = '--server' in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith('--')]
out = args[0] if args else 'model-export'
os.makedirs(out, exist_ok=True)
# server: UperNet + Swin-L (MIT), clearly better on dark / patterned tiled walls, too big for phones
SEG = os.environ.get('SEG_CHECKPOINT', 'openmmlab/upernet-swin-large' if SERVER else 'openmmlab/upernet-convnext-tiny')
DEP = os.environ.get('DEPTH_CHECKPOINT', 'depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf')


class GridPool(nn.Module):
    """Adaptive average pool to k x k that keeps the ONNX graph size-agnostic: the feature map is
    extended to a multiple of k by repeating its last row / column, then averaged in k x k blocks."""

    def __init__(self, k):
        super().__init__()
        self.k = k

    def forward(self, x):
        k = self.k
        n, c, h, w = x.shape[0], x.shape[1], x.shape[2], x.shape[3]
        hh = (h + k - 1) // k * k
        ww = (w + k - 1) // k * k
        x = x.index_select(2, torch.clamp(torch.arange(hh), max=h - 1)).index_select(3, torch.clamp(torch.arange(ww), max=w - 1))
        return x.reshape(n, c, k, hh // k, k, ww // k).mean((3, 5))


class Seg(nn.Module):
    """logits at 1/4 of the input size (the page upsamples only the few classes it needs)"""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, pixel_values):
        return self.m.decode_head(self.m.backbone(pixel_values).feature_maps)


class Depth(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, pixel_values):
        return self.m(pixel_values=pixel_values).predicted_depth


def head_forward(self, hidden_states, patch_height, patch_width):
    # as upstream, without the int() casts that would freeze the output size into the graph
    x = self.conv1(hidden_states[self.head_in_index])
    x = nn.functional.interpolate(x, (patch_height * self.patch_size, patch_width * self.patch_size), mode='bilinear', align_corners=True)
    x = self.activation1(self.conv2(x))
    x = self.activation2(self.conv3(x)) * self.max_depth
    return x.squeeze(dim=1)


seg = UperNetForSemanticSegmentation.from_pretrained(SEG).eval()
for _, blk in seg.decode_head.psp_modules.named_children():
    k = dict(blk.named_children())['0'].output_size
    k = k if isinstance(k, int) else k[0]
    setattr(blk, '0', GridPool(k))
    if hasattr(blk, 'layers'):
        blk.layers[0] = GridPool(k)
if not SERVER:
    dep = AutoModelForDepthEstimation.from_pretrained(DEP).eval()
    dep.head.forward = types.MethodType(head_forward, dep.head)

import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic

jobs = [('room-seg-large', Seg(seg), (1, 3, 704, 1280), 'logits', {2: 'h', 3: 'w'}, [(704, 1280), (1280, 704), (544, 960)])] if SERVER else [
    ('room-seg', Seg(seg), (1, 3, 448, 768), 'logits', {2: 'h', 3: 'w'}, [(448, 768), (576, 960), (768, 448)]),
    ('room-depth', Depth(dep), (1, 3, 434, 770), 'predicted_depth', {1: 'h', 2: 'w'}, [(434, 770), (770, 434)]),
]
for name, mod, shape, outname, dyn, checks in jobs:
    fp32 = os.path.join(out, f'{name}.fp32.onnx')
    torch.onnx.export(mod, (torch.randn(*shape),), fp32, input_names=['pixel_values'], output_names=[outname], dynamic_axes={'pixel_values': {2: 'height', 3: 'width'}, outname: dyn}, opset_version=17, dynamo=False)
    s = ort.InferenceSession(fp32, providers=['CPUExecutionProvider'])
    for hw in checks:
        x = torch.randn(1, 3, *hw)
        with torch.no_grad():
            ref = mod.eval()(x).numpy()
        diff = float(np.abs(s.run(None, {'pixel_values': x.numpy()})[0] - ref).max())
        print(f'{name} {hw}: max difference from PyTorch {diff:.2e}')
        assert diff < 1e-2, 'export does not match PyTorch'
    quantize_dynamic(fp32, os.path.join(out, f'{name}.onnx'), weight_type=QuantType.QUInt8)
    print(f'{name}: {os.path.getsize(os.path.join(out, name + ".onnx")) / 1e6:.1f} MB')
    os.remove(fp32)

if SERVER:
    print('then copy', os.path.join(out, 'room-seg-large.onnx'), 'to server/models/')
    sys.exit(0)

# absolute-scale network: already published as ONNX, only quantised here
from huggingface_hub import hf_hub_download
m3d = hf_hub_download(os.environ.get('SCALE_REPO', 'onnx-community/metric3d-vit-small'), 'onnx/model.onnx')
quantize_dynamic(m3d, os.path.join(out, 'room-scale.onnx'), weight_type=QuantType.QUInt8)
print(f'room-scale: {os.path.getsize(os.path.join(out, "room-scale.onnx")) / 1e6:.1f} MB')
print('then: node scripts/detect/pack-models.cjs', *(os.path.join(out, f'room-{k}.onnx') for k in ('seg', 'depth', 'scale')))
