# Deploys the Compose profile `full` to an existing VPS over SSH: installs Docker from the
# distribution's packages, checks out the repository into <app_dir>/src, writes the env file with secrets generated
# here, builds the images on the server and starts the stack. Provider-agnostic: any VPS with
# Ubuntu/Debian and SSH works.
#
# The generated secrets live in the Terraform state (terraform.tfstate, git-ignored): keep the
# state private, it is the only copy besides the env file on the server.

locals {
  db_roles = ["postgres", "app_admin", "svc_identity", "svc_transit", "svc_accessibility", "svc_places", "reporting"]
  site     = var.domain == "" ? ":80" : var.domain
  origin   = var.domain == "" ? "http://${var.host}" : "https://${var.domain}"

  env_file = join("\n", [
    "# Written by infra/terraform/vps; do not edit on the server (the next apply replaces it).",
    "POSTGRES_DB=heatmap",
    "POSTGRES_USER=postgres",
    "POSTGRES_PASSWORD=${random_password.db["postgres"].result}",
    "DB_PASSWORD_APP_ADMIN=${random_password.db["app_admin"].result}",
    "DB_PASSWORD_SVC_IDENTITY=${random_password.db["svc_identity"].result}",
    "DB_PASSWORD_SVC_TRANSIT=${random_password.db["svc_transit"].result}",
    "DB_PASSWORD_SVC_ACCESSIBILITY=${random_password.db["svc_accessibility"].result}",
    "DB_PASSWORD_SVC_PLACES=${random_password.db["svc_places"].result}",
    "DB_PASSWORD_REPORTING=${random_password.db["reporting"].result}",
    "RABBITMQ_USER=heatmap",
    "RABBITMQ_PASSWORD=${random_password.rabbitmq.result}",
    "SEED_DEMO_PASSWORD=${random_password.demo.result}",
    # Ed25519 key for signing access tokens, one line with \n escapes as identity expects.
    "JWT_PRIVATE_KEY=${replace(trimspace(tls_private_key.jwt.private_key_pem), "\n", "\\n")}",
    "JWT_KEY_ID=vps-1",
    "SITE_ADDRESS=${local.site}",
    "WEB_ORIGIN=${local.origin}",
    # Refresh cookies need HTTPS to be stored by browsers; without a domain sessions do not survive a reload.
    "COOKIE_SECURE=${var.domain == "" ? "false" : "true"}",
    # Own OSRM per city where requested (Compose services osrm-<city>), otherwise the public demo
    # server (osrm_public) or the stand-in; one table request at a time towards the public server.
    "CONTAINER_OSRM_URL_WAW=${local.osrm_url["waw"]}",
    "CONTAINER_OSRM_URL_VNO=${local.osrm_url["vno"]}",
    "CONTAINER_OSRM_PARALLEL=${var.osrm_public ? 1 : 4}",
    "CONTAINER_OSRM_MIN_INTERVAL_MS=${var.osrm_public ? 1000 : 0}",
    "CONTAINER_GEOCODER_URL=${var.geocoder_url == "" ? "http://geocoder-stub:2322" : var.geocoder_url}",
    "",
  ])

  public_osrm = "https://router.project-osrm.org"
  fallback    = var.osrm_public ? local.public_osrm : "http://osrm-stub:5000"
  osrm_url    = { for c in ["waw", "vno"] : c => contains(var.osrm_cities, c) ? "http://osrm-${c}:5000" : local.fallback }

  compose = "docker compose -p heatmap --env-file ${var.app_dir}/.env.vps -f infra/compose/docker-compose.yml -f infra/compose/vps.yml --profile full"
}

resource "random_password" "db" {
  for_each = toset(local.db_roles)
  length   = 32
  special  = false
}

resource "random_password" "rabbitmq" {
  length  = 32
  special = false
}

resource "random_password" "demo" {
  length  = 20
  special = false
}

resource "tls_private_key" "jwt" {
  algorithm = "ED25519"
}

resource "terraform_data" "deploy" {
  # Redeploy when the code version or the configuration changes.
  triggers_replace = [var.git_ref, sha256(local.env_file), var.host, join(",", var.osrm_cities)]

  connection {
    type        = "ssh"
    host        = var.host
    user        = var.ssh_user
    private_key = file(pathexpand(var.ssh_private_key_path))
    timeout     = "2m"
  }

  # 1. Docker Engine, Compose and Buildx from the distribution, git, a firewall that only lets
  #    SSH, HTTP and HTTPS in.
  provisioner "remote-exec" {
    inline = [
      "set -e",
      "export DEBIAN_FRONTEND=noninteractive",
      "sudo apt-get update -q",
      "sudo apt-get install -y -q docker.io docker-compose-v2 docker-buildx git ufw",
      "sudo systemctl enable --now docker",
      "sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw --force enable",
      "sudo mkdir -p ${var.app_dir} && sudo chown ${var.ssh_user} ${var.app_dir}",
    ]
  }

  # 2. The env file (secrets) goes straight to the server, readable by its owner only.
  provisioner "file" {
    content     = local.env_file
    destination = "${var.app_dir}/.env.vps"
  }

  # 3. Code at the requested version, images built on the server, stack started and healthy.
  provisioner "remote-exec" {
    inline = [
      "set -e",
      "chmod 600 ${var.app_dir}/.env.vps",
      "if [ -d ${var.app_dir}/src/.git ]; then git -C ${var.app_dir}/src fetch -q --tags origin; else git clone -q ${var.repository_url} ${var.app_dir}/src; fi",
      "cd ${var.app_dir}/src",
      "git checkout -q --force ${var.git_ref}",
      # A branch moves to its latest commit; a tag or a commit stays as checked out.
      "if git show-ref -q --verify refs/remotes/origin/${var.git_ref}; then git reset -q --hard origin/${var.git_ref}; fi",
      # Own OSRM for the requested cities: data prepared once (download + extract), then the
      # service started by name (profile osrm is not active, naming a service starts it anyway).
      "for city in ${join(" ", var.osrm_cities)}; do [ -f infra/osrm/data/$city/.ready ] || sudo infra/osrm/build.sh $city; sudo ${local.compose} up -d osrm-$city; done",
      "sudo ${local.compose} up -d --build --wait --wait-timeout 900",
      "sudo ${local.compose} ps --format '{{.Service}} {{.Status}}'",
    ]
  }
}
