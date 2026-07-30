# ADR 0006: Keep source documents private and generate PDFs asynchronously

- Status: Accepted
- Date: 2026-07-29
- Requirements: Product requirements 4, 8, 10, 12.4, and 14.2

## Context

StockControl retains supplier invoices and other purchasing evidence and
generates purchase orders and QR labels as PDFs. Documents can contain personal
or commercially sensitive data and must remain isolated per customer.

## Decision

Store document bytes outside PostgreSQL in a private S3-compatible object store.
Store immutable metadata in PostgreSQL: customer installation, purpose, object
key, original display name, media type, byte length, cryptographic digest,
creator, creation time, retention category, and links to domain records.

Object keys use opaque generated identifiers and never user-provided paths.
Buckets reject public access and use encryption at rest, TLS in transit,
versioning, least-privilege credentials, and separate customer deployments.
The browser never receives bucket credentials. Downloads pass through an
authorised application endpoint or use a short-lived, purpose-scoped signed URL
created only after permission checks and audit recording.

Validate declared and detected media type, file size, and safe filename on
upload. Quarantine uploads until malware scanning succeeds once the production
scanner is selected. No uploaded content is rendered inline with active script
privileges.

Generate purchase-order and label PDFs from versioned templates in an
asynchronous job. Record the template version, input digest, output digest, and
generation status. Reprinting an identity label retains its stable QR target.
PDF generation runs without network access to untrusted resources and with
bounded CPU, memory, and time.

## Consequences

- Database backups and object backups are both required for a complete restore.
- Restore verification must check database-to-object references and digests.
- Retention differs by category: purchasing and VAT-supporting records default
  to at least six years; operational artifacts follow their documented policy.
- Tests cover authorisation, tenant installation isolation, upload validation,
  signed-link expiry, deterministic template inputs, and restore integrity.

## Rejected alternatives

- Public object URLs: bypass application authorisation and audit.
- Database BLOBs: increase database backup and restore burden.
- Client-only PDF generation: makes versioning, auditability, and consistent
  output harder.
