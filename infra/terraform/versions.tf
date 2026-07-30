terraform {
  required_version = "= 1.15.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.56.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Application = "StockControl"
      Customer    = var.customer_slug
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
