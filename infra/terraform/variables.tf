variable "aws_region" {
  description = "AWS region selected for the customer's contractual hosting jurisdiction."
  type        = string
  default     = "eu-west-2"
}

variable "customer_slug" {
  description = "Lower-case non-secret customer installation identifier."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$", var.customer_slug))
    error_message = "customer_slug must be 3-32 lower-case letters, digits, or hyphens."
  }
}

variable "environment" {
  description = "Installation environment name."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "availability_zone" {
  description = "Lightsail availability zone, for example eu-west-2a."
  type        = string
  default     = "eu-west-2a"
}

variable "lightsail_blueprint_id" {
  description = "Reviewed Ubuntu LTS Lightsail blueprint."
  type        = string
  default     = "ubuntu_24_04"
}

variable "lightsail_bundle_id" {
  description = "Capacity-selected Lightsail bundle. Validate against acceptance-test load."
  type        = string
  default     = "medium_3_0"
}

variable "lightsail_key_pair_name" {
  description = "Existing Lightsail SSH key pair name. Private key material is never managed here."
  type        = string
}

variable "ssh_admin_cidrs" {
  description = "Vendor administration CIDRs allowed to reach SSH. Never use 0.0.0.0/0."
  type        = list(string)

  validation {
    condition = (
      length(var.ssh_admin_cidrs) > 0 &&
      !contains(var.ssh_admin_cidrs, "0.0.0.0/0") &&
      !contains(var.ssh_admin_cidrs, "::/0")
    )
    error_message = "Provide at least one restricted administration CIDR; world-open SSH is prohibited."
  }
}

variable "backup_retention_days" {
  description = "Days before daily backup objects expire."
  type        = number
  default     = 35

  validation {
    condition     = var.backup_retention_days >= 30
    error_message = "Backups must be retained for at least 30 days."
  }
}

