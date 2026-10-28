# FitFusion ML service on a Hugging Face Docker Space.
# The Space holds code only; model artifacts are downloaded at start-up from the
# private model repo named in MODEL_REPO, using the HF_TOKEN Space secret.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MODEL_DIR=/home/user/app/models \
    PORT=7860

RUN useradd -m -u 1000 user
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install -r requirements.txt

COPY --chown=user app ./app
COPY --chown=user hf_entry.py .

USER user
EXPOSE 7860
CMD ["python", "hf_entry.py"]
