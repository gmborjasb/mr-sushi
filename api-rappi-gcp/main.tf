terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4.2"
    }
  }
}

provider "google" {
  project = "rappi-api-501600"
  region  = "us-central1"
}

# Habilitar APIs necesarias en GCP
resource "google_project_service" "cloudfunctions" {
  project = "rappi-api-501600"
  service = "cloudfunctions.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudbuild" {
  project = "rappi-api-501600"
  service = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  project = "rappi-api-501600"
  service = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# Comprimir el código fuente (index.js y package.json)
data "archive_file" "function_zip" {
  type        = "zip"
  output_path = "${path.module}/function-source.zip"
  
  source {
    content  = file("${path.module}/index.js")
    filename = "index.js"
  }
  
  source {
    content  = file("${path.module}/package.json")
    filename = "package.json"
  }
}

# Crear un bucket único (añadimos un sufijo aleatorio para evitar conflictos de nombres)
resource "random_id" "bucket_prefix" {
  byte_length = 4
}

resource "google_storage_bucket" "function_bucket" {
  name     = "rappi-simulator-bucket-${random_id.bucket_prefix.hex}"
  location = "US"
  force_destroy = true
}

# Subir el zip al bucket
resource "google_storage_bucket_object" "function_archive" {
  name   = "source-${data.archive_file.function_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.function_zip.output_path
}

# Crear la Cloud Function (Generación 1)
resource "google_cloudfunctions_function" "rappi_function" {
  name        = "rappi-simulator"
  description = "Webhook del Simulador de Rappi"
  runtime     = "nodejs20"

  available_memory_mb   = 256
  source_archive_bucket = google_storage_bucket.function_bucket.name
  source_archive_object = google_storage_bucket_object.function_archive.name
  
  # El nombre de la función exportada en index.js
  entry_point           = "rappiWebhook"
  
  # Usar un trigger HTTP
  trigger_http          = true

  depends_on = [
    google_project_service.cloudfunctions,
    google_project_service.cloudbuild,
    google_project_service.artifactregistry
  ]
}

# Hacer la función pública (invocable sin autenticación de GCP)
resource "google_cloudfunctions_function_iam_member" "invoker" {
  project        = google_cloudfunctions_function.rappi_function.project
  region         = google_cloudfunctions_function.rappi_function.region
  cloud_function = google_cloudfunctions_function.rappi_function.name

  role   = "roles/cloudfunctions.invoker"
  member = "allUsers"
}

output "webhook_url" {
  value       = google_cloudfunctions_function.rappi_function.https_trigger_url
  description = "URL Pública de tu Simulador Rappi (Serverless)"
}
