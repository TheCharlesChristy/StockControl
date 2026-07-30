output "application_static_ip" {
  description = "Create the customer DNS record against this address."
  value       = aws_lightsail_static_ip.application.ip_address
}

output "instance_name" {
  description = "Lightsail instance targeted by the configuration playbook."
  value       = aws_lightsail_instance.application.name
}

output "documents_bucket" {
  description = "Private S3 bucket for application documents."
  value       = aws_s3_bucket.documents.id
}

output "backups_bucket" {
  description = "Private S3 bucket for encrypted backups."
  value       = aws_s3_bucket.backups.id
}

