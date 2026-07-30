locals {
  installation_name = "stockcontrol-${var.customer_slug}-${var.environment}"
}

resource "aws_lightsail_instance" "application" {
  name              = local.installation_name
  availability_zone = var.availability_zone
  blueprint_id      = var.lightsail_blueprint_id
  bundle_id         = var.lightsail_bundle_id
  key_pair_name     = var.lightsail_key_pair_name

  tags = {
    DataClassification = "CustomerConfidential"
  }
}

resource "aws_lightsail_static_ip" "application" {
  name = "${local.installation_name}-ip"
}

resource "aws_lightsail_static_ip_attachment" "application" {
  static_ip_name = aws_lightsail_static_ip.application.id
  instance_name  = aws_lightsail_instance.application.id
}

resource "aws_lightsail_instance_public_ports" "application" {
  instance_name = aws_lightsail_instance.application.name

  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = var.ssh_admin_cidrs
  }

  port_info {
    protocol          = "tcp"
    from_port         = 80
    to_port           = 80
    cidrs             = ["0.0.0.0/0"]
    cidr_list_aliases = []
  }

  port_info {
    protocol          = "tcp"
    from_port         = 443
    to_port           = 443
    cidrs             = ["0.0.0.0/0"]
    cidr_list_aliases = []
  }
}

resource "aws_s3_bucket" "documents" {
  bucket_prefix = "${local.installation_name}-documents-"
  force_destroy = false

  tags = {
    Purpose            = "Private application documents"
    DataClassification = "CustomerConfidential"
  }
}

resource "aws_s3_bucket" "backups" {
  bucket_prefix = "${local.installation_name}-backups-"
  force_destroy = false

  tags = {
    Purpose            = "Encrypted installation backups"
    DataClassification = "CustomerConfidential"
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  depends_on = [aws_s3_bucket_versioning.backups]

  rule {
    id     = "expire-daily-backups"
    status = "Enabled"

    filter {
      prefix = "daily/"
    }

    expiration {
      days = var.backup_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.backup_retention_days
    }
  }
}

