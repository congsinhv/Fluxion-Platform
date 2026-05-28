"""Immutable values shared across modules. No env, no clients, no I/O."""

from __future__ import annotations

# ---- Action classification ----
# Actions NOT dispatchable via the admin `dispatchAction` GraphQL mutation —
# the resolver rejects these two. UPLOAD is fully synchronous (uploadImei
# mutation, no SQS). ENROLL enters through the device-facing enroll Lambda
# (POST /v1/enroll), then flows through the SQS pipeline as a server-applied
# action (see SYSTEM_ACTIONS below) — so this is a dispatch-route guard, not a
# claim that ENROLL never touches SQS.
INLINE_UPLOAD = "UPLOAD"
INLINE_ENROLL = "ENROLL"

# Server-applied actions: reach the processor, no FCM, then get re-enqueued to
# the checkin queue for the APPLIED write + state flip. REGISTER is
# system-initiated; ENROLL is device-initiated (POST /v1/enroll) but still
# applied server-side via this same pipeline — the device needs no /checkin ack
# for the ENROLL transition (it re-engages only on the auto-chained ACTIVATE).
SYSTEM_ACTIONS = frozenset({"REGISTER", "ENROLL"})

# Reaches processor, processor sends FCM, device acks via /v1/checkin.
DEVICE_BOUND_ACTIONS = frozenset(
    {
        "ACTIVATE",
        "LOCK",
        "UNLOCK",
        "NOTIFY_FROM_ACTIVE",
        "NOTIFY_FROM_LOCKED",
        "RELEASE_FROM_ACTIVE",
        "RELEASE_FROM_LOCKED",
    }
)

# Used by checkin to auto-chain ACTIVATE after ENROLL APPLIED.
AUTO_CHAIN_AFTER_APPLIED = {"ENROLL": "ACTIVATE"}

# ---- SQS routing labels (kept in body for log clarity; routing is by queue) ----
TARGET_PROCESSOR = "processor"
TARGET_CHECKIN = "checkin"

# ---- Checkin tuning ----
CHECKIN_INTERVAL_IDLE = 3600
CHECKIN_INTERVAL_PENDING = 60

# ---- DPC API key format ----
API_KEY_PREFIX = "mdm_live_"
API_KEY_TOKEN_LEN = 32

# ---- IMEI ----
IMEI_LENGTH = 15
