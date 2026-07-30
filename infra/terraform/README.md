# Terraform

This configuration provisions a Lightsail instance, static IP, restricted
firewall, private document bucket, and private backup bucket. It deliberately
does not create:

- DNS or TLS configuration, because customer domain control is external;
- SSH private keys;
- IAM access keys or application secrets;
- a Terraform state backend;
- destructive offboarding automation.

Use an encrypted, access-controlled remote state backend. Treat state as
sensitive operational data even though these resources intentionally accept no
secret variables.

Before applying, copy `terraform.tfvars.example` outside source control, select
a bundle validated for the acceptance-test workload, and replace the example
administration CIDR. Run `terraform fmt`, `terraform validate`, and review a
saved plan under the normal change process.

`versions.tf` pins Terraform and the AWS provider to exact reviewed releases.
`.terraform.lock.hcl` records signed provider package checksums for Linux AMD64,
Linux ARM64, and Windows AMD64. Use `terraform init -lockfile=readonly` for
ordinary validation and planning; refresh the lock only as a separately
reviewed dependency upgrade.

S3 server-side encryption uses Amazon-managed AES-256 keys as the no-secret
baseline. A customer contract or risk assessment may require a customer-managed
KMS key; record that as an infrastructure decision before launch.
