# Standalone facts-worker image (no host bind mount).
# Used for air-gapped / public-image deploys. Local compose still uses
# python:3.11-slim + volume mount for live edit — see docker-compose.yml.
#
#   docker build -t swarm-facts-worker -f workers/facts-worker/Dockerfile workers/facts-worker
#   # then override: FACTS_WORKER_IMAGE=swarm-facts-worker
#   #   docker compose -f docker-compose.yml -f docker-compose.public-images.yml up -d
#
FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Slim runtime by default (no torch / GLiNER / NLI). Set BUILD_FULL=1 to bake
# requirements-full.txt for NER/NLI-enabled images.
ARG BUILD_FULL=0
COPY requirements.txt requirements-full.txt ./
RUN if [ "$BUILD_FULL" = "1" ]; then \
      pip install --no-cache-dir -r requirements-full.txt; \
    else \
      pip install --no-cache-dir -r requirements.txt; \
    fi

COPY app.py rlm_facts.py extraction_schema.py extraction_schema.yaml ./

EXPOSE 8010
ENV SKIP_GLINER=1
ENV SKIP_NLI=1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010"]
