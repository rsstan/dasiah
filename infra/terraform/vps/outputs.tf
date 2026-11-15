output "url" {
  description = "Address of the deployed page."
  value       = local.origin
}

output "demo_password" {
  description = "Password of the demo accounts (demo.user@example.com, demo.admin@example.com). Show with: terraform output -raw demo_password"
  value       = random_password.demo.result
  sensitive   = true
}
