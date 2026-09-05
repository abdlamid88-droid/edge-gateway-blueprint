FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY edge_gateway_service.py .

CMD ["python", "-u", "edge_gateway_service.py"]
