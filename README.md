# Industrial IoT (IIoT) Edge Gateway & Store-and-Forward Pipeline

An enterprise-grade, fault-tolerant Edge Gateway daemon engineered for mission-critical Industrial IoT deployments. Provides multi-protocol field device ingestion (Modbus TCP/RTU, KNX IP), robust binary payload decoding with configurable endianness, deterministic SHA-256 deduplication, local durable buffering using SQLite Write-Ahead Logging (WAL) mode, and Store-and-Forward telemetry synchronization with strict MQTT QoS 1 acknowledgement.

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph Field_Devices ["Field Devices & Automation Layer"]
        ModbusSensors["Modbus TCP / RTU Devices<br/>(Chillers, Power Meters, PLCs)"]
        KNXSensors["KNX IP / TP Devices<br/>(Room Climate, Lighting, DPT 9.001)"]
    end

    subgraph Edge_Gateway ["Edge Gateway Daemon (Containerized / Non-Root)"]
        direction TB
        Adapters["Protocol Ingestion Adapters<br/>(Fault-Tolerant & Auto-Reconnecting)"]
        Decoders["Binary Payload Decoders<br/>• Modbus: Big-Endian Bytes / Little-Endian Words (CDAB)<br/>• KNX: DPT 1.001 / DPT 5.001 / DPT 9.001 / DPT 14.xxx"]
        Hasher["Deterministic SHA-256 Message Hasher<br/><code>hash(device_id:metric:timestamp)</code>"]
        
        subgraph Local_Storage ["Local Durable Buffer (WAL Mode)"]
            BufferDB[("SQLite Database<br/>PRAGMA journal_mode=WAL;<br/>ON CONFLICT(hash) DO NOTHING")]
        end

        SyncEngine["Store-and-Forward Dispatch Engine<br/>(Batch Retrieval: status='pending' / synced=0)"]
        
        Adapters --> Decoders
        Decoders --> Hasher
        Hasher -->|Idempotent Insert| BufferDB
        BufferDB -.->|Batch Read| SyncEngine
    end

    subgraph Transport_Layer ["Transport & Cloud Ingestion"]
        MQTTBroker["Eclipse Mosquitto MQTT Broker<br/>(QoS 1 Guaranteed Delivery + Healthchecks)"]
        CloudStorage[("Timeseries / SCADA Storage<br/>TimescaleDB / InfluxDB / AWS IoT")]
    end

    ModbusSensors -->|Raw Registers| Adapters
    KNXSensors -->|Raw Telegrams| Adapters
    SyncEngine -->|Publish QoS 1| MQTTBroker
    MQTTBroker -.->|Strict Delivery ACK (PUBACK)| SyncEngine
    SyncEngine -->|Mark synced=1 / synced_at=NOW| BufferDB
    MQTTBroker -->|Telemetry Stream| CloudStorage

    classDef edge fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef storage fill:#0f172a,stroke:#a855f7,stroke-width:2px,color:#f8fafc;
    classDef transport fill:#0f172a,stroke:#22c55e,stroke-width:2px,color:#f8fafc;
    class Field_Devices,Edge_Gateway edge;
    class Local_Storage storage;
    class Transport_Layer transport;
```

---

## 2. Architectural Justification & Engineering Rationales

### A. Store-and-Forward Durability
Industrial edge networks frequently suffer from communication blackouts due to intermittent cellular (4G/5G) links, satellite latency, or plant network maintenance.
* **Zero Data Loss Guarantee:** When the MQTT broker or cloud link becomes unavailable, the gateway transitions immediately to offline buffer mode. Field telemetry continues to be recorded locally without blocking the ingestion pipeline.
* **Strict Network Receipt Acknowledgement:** Telemetry records remain flagged as `synced=0` (`status='pending'`) until a cryptographic/transport-level acknowledgment (MQTT `PUBACK` under QoS 1) is confirmed. Only then are records marked `synced=1` with an audited `synced_at` timestamp.

### B. SQLite Write-Ahead Logging (WAL) Mode
Standard SQLite operating in rollback journal mode locks the entire database file during write operations, causing pipeline bottlenecks when high-frequency sensor streams collide with batch dispatch readers.
* **Concurrent Lock-Free Operations:** `PRAGMA journal_mode=WAL;` allows concurrent readers to read from the database while the writer appends to the WAL file, eliminating `database is locked` exceptions.
* **Power-Loss & Crash Resilience:** In the event of a sudden industrial power cut, the WAL mechanism prevents database corruption and provides atomic recovery upon reboot.
* **Optimized I/O:** Combined with `PRAGMA synchronous=NORMAL;` and `PRAGMA busy_timeout=5000;`, disk write wear on flash memory/eMMC storage is minimized.

### C. Edge Deduplication & Idempotency
Telemetry retries or field bus retransmissions can flood upstream analytical systems with duplicate data points.
* **Deterministic SHA-256 Hashing:** Every measurement calculates a hash:
  $$\text{hash} = \text{SHA256}(\text{device\_id} \mathbin{\Vert} \text{metric} \mathbin{\Vert} \text{timestamp})$$
* **Idempotent Ingestion:** The database enforces a `UNIQUE(message_hash)` constraint combined with `INSERT ... ON CONFLICT(message_hash) DO NOTHING`. Duplicate packets are discarded at the edge with zero CPU overhead upstream.

### D. Industrial Endianness Handling
Fieldbus protocols (e.g., Modbus) store 32-bit floating-point numbers across two consecutive 16-bit registers:
* **Byte Endianness:** Standard industrial devices transmit each 16-bit register in **Big-Endian byte order** (Most Significant Byte first).
* **Word Endianness:** Many major industrial manufacturers (Schneider, Siemens, Modicon, ABB) transmit 32-bit floats with **Little-Endian word order** (Least Significant Word first, known as `CDAB` or Word-Swapped format).
* The gateway's `ModbusPayloadDecoder` strictly implements this decoding rule, preventing numerical inversion bugs in mission-critical process metrics.

---

## 3. Quickstart & Deployment

### 1. Single-Command Deployment via Docker Compose
Provision the Edge Gateway daemon and Mosquitto MQTT broker with persistent storage and healthchecks:

```bash
docker compose up -d --build
```

### 2. Inspect Live Gateway Telemetry Logs
```bash
docker compose logs -f edge-gateway
```

### 3. Monitor Upstream MQTT Ingestion Stream
```bash
docker exec -it edge_mqtt_broker mosquitto_sub -t "industrial/telemetry" -v
```

### 4. Run Test Suite & Technical Screen Demo
Execute the standalone test suite and live visual demo harness:

```bash
# Run unit tests and interactive telemetry visualizer
python3 tests/test_gateway_pipeline.py

# Or run tests using pytest
pytest tests/
```

---

## 4. Configuration & Environment Variables

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `DB_PATH` | `/data/edge_buffer.db` | Absolute path to the SQLite durable storage file. |
| `MQTT_BROKER` | `mqtt-broker` | Hostname or IP address of the upstream MQTT broker. |
| `MQTT_PORT` | `1883` | Network port for MQTT broker communication. |
| `MQTT_TOPIC` | `industrial/telemetry` | Base MQTT topic for QoS 1 telemetry publications. |
| `BATCH_SIZE` | `10` | Maximum number of pending records to dispatch per sync batch. |
| `POLL_INTERVAL_SEC`| `2.0` | Ingestion and synchronization loop cadence (in seconds). |
| `LOG_LEVEL` | `INFO` | Logging verbosity (`DEBUG`, `INFO`, `WARNING`, `ERROR`). |

---

## 5. Security Hardening

* **Non-Root Execution:** Container runs strictly as an unprivileged user (`appuser`, UID `10001`).
* **Minimal Base Image:** Built on `python:3.11-slim` with zero unnecessary compiler packages in the final stage.
* **Graceful Signal Handling:** Intercepts `SIGTERM` and `SIGINT` to flush pending database transactions and cleanly disconnect network clients.

---

## 6. License
MIT License.
