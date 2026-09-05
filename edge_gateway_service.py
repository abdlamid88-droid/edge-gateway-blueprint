import os
import time
import sqlite3
import hashlib
import json
import logging
from datetime import datetime, timezone
import paho.mqtt.client as mqtt

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("EdgeGateway")

DB_PATH = os.getenv("DB_PATH", "/data/edge_buffer.db")
MQTT_BROKER = os.getenv("MQTT_BROKER", "mqtt-broker")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "industrial/telemetry")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", 10))

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        recorded_at TEXT NOT NULL,
        message_hash TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending'
    )
    """)
    conn.commit()
    conn.close()
    logger.info("SQLite storage initialized with WAL mode enabled.")

def generate_hash(device_id: str, metric: str, timestamp_str: str) -> str:
    raw = f"{device_id}:{metric}:{timestamp_str}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def ingest_reading(device_id: str, metric: str, value: float, timestamp_str: str):
    msg_hash = generate_hash(device_id, metric, timestamp_str)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    query = """
    INSERT INTO telemetry (device_id, metric, value, recorded_at, message_hash)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(message_hash) DO NOTHING;
    """
    cursor.execute(query, (device_id, metric, value, timestamp_str, msg_hash))
    conn.commit()
    inserted = cursor.rowcount > 0
    conn.close()
    return inserted, msg_hash

mqtt_connected = False

def on_connect(client, userdata, flags, rc, properties=None):
    global mqtt_connected
    if rc == 0:
        mqtt_connected = True
        logger.info(f"Connected successfully to MQTT Broker ({MQTT_BROKER}:{MQTT_PORT})")
    else:
        mqtt_connected = False
        logger.warning(f"Failed to connect to MQTT Broker, return code {rc}")

def on_disconnect(client, userdata, rc, properties=None):
    global mqtt_connected
    mqtt_connected = False
    logger.warning("Disconnected from MQTT Broker. Running in Offline Store & Forward mode.")

def main():
    init_db()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="edge-gateway-daemon")
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect

    try:
        client.connect_async(MQTT_BROKER, MQTT_PORT, 60)
        client.loop_start()
    except Exception as e:
        logger.error(f"Initial MQTT broker connection failed: {e}")

    logger.info("Edge Gateway Service running. Entering telemetry and sync loop...")

    step = 0
    while True:
        step += 1
        now_iso = datetime.now(timezone.utc).isoformat()
        
        # محاكاة استلام قراءة حساس
        temp_val = 24.0 + (step % 5) * 0.5
        inserted, h = ingest_reading("temp_sensor_01", "temperature_celsius", temp_val, now_iso)
        if inserted:
            logger.info(f"Buffered sensor reading locally. Hash: {h[:8]}")

        # مزامنة البيانات المعلقة عند توفر الاتصال
        if mqtt_connected:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT id, device_id, metric, value, recorded_at, message_hash FROM telemetry WHERE status = 'pending' LIMIT ?", (BATCH_SIZE,))
            batch = cursor.fetchall()

            if batch:
                synced_ids = []
                for row in batch:
                    payload = {
                        "device_id": row[1],
                        "metric": row[2],
                        "value": row[3],
                        "timestamp": row[4],
                        "hash": row[5]
                    }
                    msg_info = client.publish(MQTT_TOPIC, json.dumps(payload), qos=1)
                    msg_info.wait_for_publish(timeout=2.0)
                    if msg_info.is_published():
                        synced_ids.append(row[0])

                if synced_ids:
                    cursor.execute(f"UPDATE telemetry SET status = 'synced' WHERE id IN ({','.join(['?']*len(synced_ids))})", synced_ids)
                    conn.commit()
                    logger.info(f"Forwarded and marked {len(synced_ids)} records as synced via MQTT.")
            conn.close()

        time.sleep(2)

if __name__ == "__main__":
    main()
