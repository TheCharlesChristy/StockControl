# Infrastructure foundation

This directory contains the supported Railway production-MVP deployment and
the legacy AWS installation material:

- `railway/` contains the current per-service configuration and deployment
  runbook.
- `terraform/` and `ansible/` preserve the earlier Lightsail design for
  reference; they are not the production-MVP deployment path.

No infrastructure file contains credentials, private keys, customer data or
real domains. Start with [`railway/README.md`](railway/README.md) for a new
installation.

## Legacy AWS order of operations

1. Create a remote encrypted Terraform state backend outside this repository.
2. Review and apply the Terraform plan with customer-specific non-secret
   variables.
3. Restrict SSH CIDRs before exposing the instance.
4. Point the customer domain at the returned static IP.
5. Create least-privilege S3 credentials for only that customer's document and
   backup buckets. Do not store the credentials in Terraform variables or Git.
6. Create an Ansible inventory and encrypted vault from the examples.
7. Run the Ansible playbook, then complete the first-deployment and
   backup/restore runbooks in `docs/operations/`.

Destruction protection is intentional: S3 buckets use `force_destroy = false`.
Customer offboarding and data deletion require a separately approved,
contract-specific procedure.
