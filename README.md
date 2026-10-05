Markdown# Fire-ResQ 🚒

Fire-ResQ is a real-time emergency dispatch and response orchestration system. It enables citizens to trigger emergency SOS alerts, allows fire station command centers to monitor and assign squads, and equips field responders with live coordination tools.

---

## 🏗 Architecture Overview

The system is built as a microservices architecture designed for real-time responsiveness and scalability:

- **Frontend (`web/`)**: Next.js 14 (App Router) styled with Tailwind CSS, utilizing Apollo Client for GraphQL queries, mutations, and WebSocket subscriptions.
- **API Gateway (`gateway/`)**: Apollo Server acting as a federated/unified gateway handling HTTP requests and WebSocket connections (`graphql-ws`).
- **Core Microservices**: Backend services communicating via gRPC for high-throughput RPCs.
- **Event Streaming**: Apache Kafka for distributed event propagation (handling real-time dispatch and status transitions).
- **Database**: PostgreSQL storing squad allocations, team statuses, and incident history.
- **Containerization**: Docker Compose orchestrating databases, message brokers, and backend services.

---

## 🚀 Key Features

- **One-Touch Citizen SOS (`/sos`)**: Rapid incident logging capturing caller coordinates and dispatch triggers.
- **Incident Command Center (`/`)**: Real-time operational dashboard for tracking incoming emergencies, squad readiness, and unit dispatches.
- **Responder Interface (`/responder`)**: Dedicated mobile-responsive view for field units to monitor assigned calls and update mission statuses (`AVAILABLE`, `DISPATCHED`, `ON_SCENE`, `RESOLVED`).
- **Real-Time Subscription Pipeline**: Instant bi-directional state synchronization across mobile field devices and stationary dispatch terminals.

---

## 🛠 Tech Stack

| Domain | Technology |
|---|---|
| **Frontend** | Next.js, React, Tailwind CSS, Apollo Client |
| **Backend & Gateway** | Node.js / TypeScript, Apollo Server, gRPC, Protocol Buffers |
| **Messaging & Cache** | Apache Kafka, Zookeeper |
| **Database** | PostgreSQL |
| **DevOps & Tunnels** | Docker, Docker Compose, Cloudflare Tunnels (`cloudflared`), Vercel |

---

## ⚙️ Local Development Setup

### 1. Prerequisites
- [Docker Desktop](https://www.docker.com/) (running)
- [Node.js](https://nodejs.org/) (v18+)
- [Cloudflared CLI](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) (for public device testing)

### 2. Start Backend Infrastructure
From the repository root:

```bash
docker compose up -d --build
Verify that all containers are healthy:Bashdocker compose ps
The gateway should be running locally at http://localhost:4001/graphql.3. Start Frontend ApplicationNavigate into the web workspace:Bashcd web
npm install
npm run dev
The client will be accessible at http://localhost:3000.🌐 Mobile Testing & Cloudflare Tunnel WorkflowTo test multi-device communication across mobile phones (SOS caller $\leftrightarrow$ Responder $\leftrightarrow$ Station Dashboard) while keeping the backend local:Expose Local Gateway to Public Web:Bashcloudflared tunnel --url http://localhost:4001
Copy the generated HTTPS tunnel URL: https://<subdomain>.trycloudflare.com.Configure Environment Variables:In web/.env.local (or in Vercel project settings):Code snippetNEXT_PUBLIC_GATEWAY_URL=https://<subdomain>[.trycloudflare.com/graphql](https://.trycloudflare.com/graphql)
NEXT_PUBLIC_GATEWAY_WS_URL=wss://<subdomain>[.trycloudflare.com/graphql](https://.trycloudflare.com/graphql)
Production URL:Web App: https://fire-resq.vercel.appCitizen Portal: https://fire-resq.vercel.app/sosResponder Portal: https://fire-resq.vercel.app/responder
