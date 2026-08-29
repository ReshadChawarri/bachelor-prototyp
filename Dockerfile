FROM python:3.12-slim

WORKDIR /app

COPY writing-pattern-visualizer-v4/backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY . /app

WORKDIR /app/writing-pattern-visualizer-v4/backend

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
