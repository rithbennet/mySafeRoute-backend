Here is the complete, feature-driven To-Do list for your Backend Team (2 Developers). I have prioritized it for a **1-Day MVP** build using **Fastify + Bun**.

### 🛠 Phase 1: Setup & Infrastructure (First 60 Mins)

**Owner: Shared**

- [ ] **Initialize Project**
  - [ ] Run `bun init`.
  - [ ] Install dependencies: `fastify`, `@fastify/cors`, `@fastify/websocket`, `fastify-type-provider-zod`, `zod`, `dotenv`.
  - [ ] Install dev dependencies: `typescript`, `@types/node`.
- [ ] **Configure Environment**
  - [ ] Create `.env` and `.env.example`.
  - [ ] Keys: `PORT`, `ORS_API_KEY` (OpenRouteService), `ADMIN_TOKEN`.
- [ ] **Scaffold Folder Structure** (Modular Monolith)
  - [ ] `src/modules/` (hospitals, incidents, routing, telemetry).
  - [ ] `src/shared/` (store, types, utils).
- [ ] **Setup In-Memory Database**
  - [ ] Create `Database.ts` singleton class.
  - [ ] Define Map/Array stores for `hospitals`, `incidents`, `ambulances`, `hazards`.

---

### 🏥 Phase 2: Domain Data & Seed (Dev A)

**Focus: Static Data & Basic CRUD**

- [ ] **Define Types (Zod Schemas)**
  - [ ] `Hospital`: id, name, location `{lat, lng}`, capabilities `['PCI', 'CT', 'Trauma']`, status, load `(0-100)`.
  - [ ] `Incident`: id, location, triage `('STEMI' | 'Stroke' | ...)` , status.
  - [ ] `Ambulance`: id, callsign, location, status.
- [ ] **Seed Klang Valley Data**
  - [ ] Hardcode 8-10 major hospitals (HKL, UMMC, IJN, Serdang, etc.) with accurate Lat/Lng and capabilities.
  - [ ] Seed 2 mock ambulances (e.g., one in PJ, one in KLCC).
- [ ] **Hospital Endpoints**
  - [ ] `GET /hospitals` (Return full list with status).
  - [ ] `POST /hospitals/:id/status` (Update diverting status & load score).
- [ ] **Ambulance Endpoints**
  - [ ] `GET /ambulances` (Return list).

---

### 🧠 Phase 3: The "Brain" - Routing & Scoring (Dev B)

**Focus: The Logic (The hardest part)**

- [ ] **Routing Adapter Interface**
  - [ ] Create `IRoutingProvider` interface.
  - [ ] Implement `OpenRouteServiceAdapter`.
  - [ ] **Task:** Fetch route from Point A to Point B. Return: `geometry` (GeoJSON), `eta_seconds`, `distance_meters`.
- [ ] **Hazard Logic**
  - [ ] Create `HazardService`.
  - [ ] **Task:** Check if a generated route intersects with any active hazard polygons (simple bounding box check is fine for MVP).
  - [ ] **Task:** If intersect, add Penalty Time (e.g., +10 mins) to ETA.
- [ ] **Hospital Scoring Service**
  - [ ] Implement `calculateScore(incident, hospital)`.
  - [ ] **Logic:**
    1.  **Capability Check:** If Triage=STEMI and Hospital has no PCI -> Score 0.
    2.  **Status Check:** If Hospital is Diverting -> Score 0.
    3.  **Efficiency:** Combine (Normalized Load) + (ETA from Routing Adapter).
  - [ ] **Output:** Return sorted list of best hospitals.

---

### 🚨 Phase 4: Incident Management API (Dev A)

**Focus: Connecting Frontend to Backend**

- [ ] **Create Incident Endpoint**
  - [ ] `POST /incidents`
  - [ ] **Flow:**
    1.  Save Incident to Store.
    2.  Call `HospitalScoringService` to find top 3 hospitals.
    3.  Call `RoutingAdapter` to get route to the #1 hospital.
    4.  Return Incident ID + Recommended Hospital + Route + ETA.
- [ ] **Get Incident Details**
  - [ ] `GET /incidents/:id`
  - [ ] Return current status, assigned ambulance, and ETA.
- [ ] **Assign Ambulance**
  - [ ] `POST /incidents/:id/assign` body: `{ ambulanceId }`.
  - [ ] Update Incident status to `ASSIGNED`.
  - [ ] Update Ambulance status to `BUSY`.

---

### 📡 Phase 5: Real-Time Telemetry (Dev B)

**Focus: WebSockets**

- [ ] **WebSocket Setup**
  - [ ] Register `@fastify/websocket`.
  - [ ] Create endpoint `/ws/telemetry`.
- [ ] **Handle Incoming Messages**
  - [ ] **Type:** `gps_update` -> Update Ambulance coordinates in memory store.
- [ ] **Broadcast Logic**
  - [ ] Create a `broadcastToDispatchers(data)` function.
  - [ ] When Ambulance moves -> Broadcast to Dispatcher Map.
  - [ ] When Incident status changes -> Broadcast to all.

---

### 🚧 Phase 6: Hazards & Manual Overrides (Shared)

**Focus: The Demo "Flex"**

- [ ] **Hazards API**
  - [ ] `GET /hazards` (For map layers).
  - [ ] `POST /hazards` (For Dispatcher to draw a road closure).
- [ ] **Re-Routing Trigger (Stretch Goal)**
  - [ ] Create a simple interval (every 30s) that checks active Incidents.
  - [ ] If a NEW hazard intersects the current route -> Re-calculate route -> Broadcast "Re-routing Alert" via WS.

---

### ✅ Acceptance Criteria for Success

1.  **The Happy Path:**
    - Create Incident (Bukit Bintang, Stroke) -> Returns **HKL** (Has CT/Neuro) as top recommendation.
    - Create Incident (Bukit Bintang, General Trauma) -> Returns **nearest** hospital.
2.  **The Hazard Path:**
    - Create Incident. Route goes through Jalan Tun Razak.
    - Add Manual Hazard (Flood) on Jalan Tun Razak.
    - Create _New_ Incident (same location) -> Route **avoids** Jalan Tun Razak or ETA is significantly higher.
3.  **The Live Update:**
    - Parmaedic App sends GPS.
    - Dispatcher Map moves the marker without page refresh.
