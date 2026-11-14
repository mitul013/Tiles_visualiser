# syntax=docker/dockerfile:1
# Room-detection backend (server/detect-server.ts) with the large segmentation model.
#
#   docker build -t room-detect .
#   docker run -p 7860:7860 -e DETECT_ORIGIN=https://your-shop.example room-detect
#
# Hosting options: docs/ROOM-DETECTION.md. Needs about 3.5 GB of RAM and 2+ CPU cores.

# ---- 1. the large segmentation model: reuse a local copy, otherwise export it from its checkpoint
FROM python:3.12-slim AS model
WORKDIR /work
COPY server/ /ctx/server/
COPY scripts/detect/export_models.py /work/
# (exporting takes ~10 min and ~4 GB of RAM, once; the result is cached by Docker)
RUN --mount=type=secret,id=ca,required=false if [ -f /run/secrets/ca ] && [ -s /run/secrets/ca ]; then \
      export PIP_CERT=/run/secrets/ca REQUESTS_CA_BUNDLE=/run/secrets/ca SSL_CERT_FILE=/run/secrets/ca CURL_CA_BUNDLE=/run/secrets/ca; fi; \
    if [ -f /ctx/server/models/room-seg-large.onnx ]; then \
      mkdir -p /out && cp /ctx/server/models/room-seg-large.onnx /out/; \
    else \
      { pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu || pip install --no-cache-dir torch; } && \
      pip install --no-cache-dir "transformers==4.57.6" "huggingface_hub<1.0" onnx onnxruntime safetensors && \
      python export_models.py /out --server; \
    fi

# ---- 2. the service
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
# behind a TLS-inspecting proxy, pass its certificate: docker build --secret id=ca,src=proxy-ca.crt .
RUN --mount=type=secret,id=ca,required=false sh -c 'if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; npm ci --no-audit --no-fund'
COPY tsconfig*.json ./
COPY src/ src/
COPY scripts/detect/ scripts/detect/
COPY server/detect-server.ts server/demo.html server/
COPY public/models/ public/models/
COPY --from=model /out/room-seg-large.onnx server/models/room-seg-large.onnx
ENV PORT=7860 NODE_ENV=production
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server/detect-server.ts"]
