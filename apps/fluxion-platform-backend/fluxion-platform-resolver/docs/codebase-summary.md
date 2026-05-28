# Codebase Summary: fluxion-platform-resolver

**Purpose:** AppSync direct Lambda resolver for the Fluxion MDM admin GraphQL API. Dispatches GraphQL operations by `event.info.fieldName` to per-entity handler modules.

**Size:** 1,843 LOC across 18 Python files + requirements.txt.

## Module Inventory

| File | LOC | Responsibility |
|------|-----|-----------------|
| `handler.py` | 52 | Lambda entry point; field dispatch via merged QUERY_HANDLERS + MUTATION_HANDLERS; AppError → GraphQL error |
| `config.py` | 59 | Env vars, lazy boto3 clients (secretsmanager, sqs), root logger setup (side effect on import) |
| `constants.py` | 51 | Action classification (INLINE_UPLOAD, INLINE_ENROLL, SYSTEM_ACTIONS, DEVICE_BOUND_ACTIONS), SQS routing labels, API key format, IMEI length |
| `errors.py` | 55 | Typed exception hierarchy: AppError(code, http_status, message) + 5 subclasses (NotFound, Conflict, BadRequest, Forbidden, Unauthorized, InternalError) |
| `db.py` | 750 | Thin psycopg3 wrapper; single module-global connection with thread-safe lazy init; domain methods grouped by entity (lookups, users, devices, milestones, tacs, message_templates, device_uploads) |
| `auth.py` | 84 | `get_user_from_identity()` (Cognito sub → users row, read-only lookup), `validate_device_bearer()` (DPC api_key check, unused in this Lambda), `get_dpc_shared_key()`, `generate_device_api_key()` |
| `sqs_client.py` | 54 | `enqueue_action()` dispatcher; routes by TARGET_PROCESSOR or TARGET_CHECKIN to correct queue URL |
| `resolvers/__init__.py` | 29 | Aggregates per-entity QUERY_HANDLERS + MUTATION_HANDLERS dicts into module-level exports |
| `resolvers/device.py` | 235 | Queries: `listDevices` (cursor pagination), `device` (by id or imei); Mutations: `uploadImei` (sync, no SQS), `dispatchAction` (validate + enqueue) |
| `resolvers/serializers.py` | 195 | Row → GraphQL shape mappers for all entities; cursor encode/decode (base64 of id+createdAt); Relay-style `connection(edges, total, has_next)` envelope |
| `resolvers/tac.py` | 81 | Query: `listTacs` (cursor pagination); Mutations: `createTac`, `updateTac`, `deleteTac` (soft delete) |
| `resolvers/message_template.py` | 73 | Query: `listMessageTemplates`; Mutations: `createMessageTemplate`, `updateMessageTemplate`, `deleteMessageTemplate` (soft delete) |
| `resolvers/milestone.py` | 39 | Query: `listMilestones` (cursor pagination on device milestones) |
| `resolvers/device_upload.py` | 39 | Query: `listDeviceUploads` (cursor pagination) |
| `resolvers/metadata.py` | 20 | Query: `configMetadata` (returns services, states, actions in one call for admin UI bootstrap) |
| `resolvers/service.py` | 15 | Helper: `list_all_services()` (used by metadata) |
| `resolvers/state.py` | 12 | Helper: `list_all_states()` (used by metadata) |
| `resolvers/action.py` | 11 | Helper: `list_all_actions()` (used by metadata) |
| `requirements.txt` | 2 | psycopg[binary]>=3.2,<4; boto3>=1.34,<2 |

## Handler Registry

### Queries
| Field | File | Handler |
|-------|------|---------|
| `health` | handler.py | inline (returns {status, service, version}) |
| `listDevices` | device.py | `list_devices()` |
| `device` | device.py | `get_device()` |
| `listMilestones` | milestone.py | `list_milestones()` |
| `listMessageTemplates` | message_template.py | `list_message_templates()` |
| `listTacs` | tac.py | `list_tacs()` |
| `listDeviceUploads` | device_upload.py | `list_device_uploads()` |
| `configMetadata` | metadata.py | `config_metadata()` |

### Mutations
| Field | File | Handler | Notes |
|-------|------|---------|-------|
| `uploadImei` | device.py | `upload_imei()` | Synchronous; validates IMEI, TAC lookup, creates device + milestones |
| `dispatchAction` | device.py | `dispatch_action()` | Validate + enqueue to processor; rejects UPLOAD/ENROLL; best-effort busy-check |
| `createMessageTemplate` | message_template.py | `create_message_template()` | Auth required |
| `updateMessageTemplate` | message_template.py | `update_message_template()` | Auth required |
| `deleteMessageTemplate` | message_template.py | `delete_message_template()` | Soft delete; auth required |
| `createTac` | tac.py | `create_tac()` | Auth required |
| `updateTac` | tac.py | `update_tac()` | Auth required |
| `deleteTac` | tac.py | `delete_tac()` | Soft delete; auth required |

## Key Patterns

### Handler Signature
```python
def handler_name(db: Database, args: dict, identity: dict) -> dict | bool | None:
    ...
```
- `db`: Live Database connection (from single global pool)
- `args`: GraphQL arguments dict (camelCase keys)
- `identity`: AppSync identity context (Cognito sub+email)

### Error Handling
Raise `AppError` subclasses (code, http_status, message). `handler.py` catches and converts to GraphQL error: `{errorType, errorMessage, extensions.code}` raised as JSON-encoded Exception.

### Database Access
- Single global connection (`_conn` in db.py), thread-safe lazy init with `threading.Lock`
- All values bound via `%(name)s` (never f-string interpolated)
- `dict_row=True`, `autocommit=True`
- Transactions: `with db.conn.transaction():`

### Pagination
- Cursor = base64(id, createdAt), decoded back to tuple
- Fetch `limit+1` rows to compute `hasNext`, separate count query for total
- Default limit 50, max limit 200

### Serialization
`serializers.py` provides row → GraphQL mappers:
- Snake_case DB columns → camelCase GraphQL
- UUID/datetime stringified (UUID → str, datetime → ISO Z)
- `connection(edges, total, hasNext)` Relay envelope

### Auth
Every mutation calls `_require_user()` → `get_user_from_identity()`:
- Cognito sub → users row (read-only `SELECT`; row provisioned by `scripts/create-admin-user.sh`)
- Missing identity or unprovisioned user → USER_NOT_FOUND error

### SQS Dispatch
`enqueue_action()` routes to processor or checkin queue:
- Body includes target_service, device_id, action_id, command_id, template_id, requested_by_id, extras
- Returns MessageId
