# Infrastructure foundation

This directory is a reviewed starting point for one isolated StockControl
customer installation:

- `terraform/` provisions the non-secret AWS resources.
- `ansible/` configures the Lightsail host after provisioning.

The templates do not contain credentials, private keys, customer data, or real
domains. They are not a push-button production deployment: an operator must
complete the prerequisites, supply immutable application image digests, inject
secrets from an approved encrypted store, and follow the deployment runbook.

## Order of operations

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
