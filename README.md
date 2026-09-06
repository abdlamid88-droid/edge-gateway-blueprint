# Edge Gateway Blueprint for Industrial IoT (IIoT)

An enterprise-ready, fault-tolerant Edge Gateway blueprint designed for resilient sensor data ingestion, edge persistence, and telemetry dispatching under unstable network conditions.

---

## System Architecture

```mermaid
flowchart TD
    subgraph Edge Layer [Industrial Field / Edge Device]
        Sensors[Physical Sensors: Modbus TCP / KNX / RTU] -->|Raw Telemetry Stream| Daemon[Edge Gateway Daemon]
        
        subgraph Resilient Storage
            Daemon -->|SHA-256 Deduplication| Buffer[(SQLite Buffer: WAL Mode)]
            Buffer -.->|Batch Retrieval: status=pending| Daemon
        end
    end

    subgraph Transport Layer
        Daemon -->|Store & Forward: MQTT QoS 1| Broker[Local / Central MQTT Broker]
    end

    subgraph Upstream Enterprise Layer
        Broker -->|Topic Subscription| Timescale[(TimescaleDB / PostgreSQL)]
        Broker -->|Real-time Metrics| Dashboard[Grafana / SCADA Monitoring]
    end
Architectural Highlights
Store & Forward Resiliency: Continuous telemetry ingestion into an embedded local database buffer during communication blackouts, with automatic batch draining upon link restoration.

SQLite WAL (Write-Ahead Logging): Eliminates database concurrency locks by separating sequential append writes from batch read synchronization pipelines.

QoS 1 Idempotency & Deduplication: Prevents duplicated metric accumulation by computing deterministic SHA-256 payload hashes combined with ON CONFLICT DO NOTHING.

Containerized Workload: Isolated daemon deployment orchestrated alongside Mosquitto MQTT broker via Docker Compose.
