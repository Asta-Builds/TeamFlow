variable "railway_token" {
  type        = string
  description = "Railway API token (can also be provided via RAILWAY_TOKEN environment variable)"
  default     = ""
  sensitive   = true
}

variable "project_name" {
  type        = string
  description = "Name of the TeamFlow Railway project"
  default     = "teamflow"
}

variable "environment_name" {
  type        = string
  description = "Deployment environment name on Railway"
  default     = "production"
}
