variable "host" {
  description = "Public IP address or host name of the VPS (Ubuntu 24.04 or Debian 12, reachable over SSH)."
  type        = string
}

variable "ssh_user" {
  description = "SSH user with sudo rights (root is fine)."
  type        = string
  default     = "root"
}

variable "ssh_private_key_path" {
  description = "Private key that the VPS accepts for ssh_user."
  type        = string
  default     = "~/.ssh/id_ed25519"
}

variable "repository_url" {
  description = "Git URL the VPS clones (must be readable from the server, e.g. a public HTTPS URL)."
  type        = string
}

variable "git_ref" {
  description = "Branch, tag or commit to deploy. Changing it redeploys."
  type        = string
  default     = "main"
}

variable "domain" {
  description = "Domain pointing at the VPS (A record). Set it to get HTTPS from Caddy and secure cookies; empty serves plain HTTP on the IP."
  type        = string
  default     = ""
}

variable "app_dir" {
  description = "Directory of the checkout on the VPS."
  type        = string
  default     = "/opt/heatmap"
}

variable "osrm_cities" {
  description = "Cities that get their own OSRM (car routing from OpenStreetMap). The data is prepared on the server once (infra/osrm/build.sh, several GB of RAM for waw); other cities use the straight-line stand-in."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.osrm_cities : contains(["waw", "vno"], c)])
    error_message = "osrm_cities may contain \"waw\" and \"vno\"."
  }
}

variable "osrm_public" {
  description = "Cities without their own OSRM use the public demo server router.project-osrm.org instead of the straight-line stand-in (fair use only: one request at a time, no SLA)."
  type        = bool
  default     = false
}

variable "geocoder_url" {
  description = "Photon-compatible geocoder for address search, e.g. https://photon.komoot.io (public, at most one request per second). Empty uses the stand-in that only knows testville."
  type        = string
  default     = ""
}
