# Marketplace

Global reusable standard apps for client workspaces.

Contents:
- `calendar.json`
- `catalog.json`
- `contacts.json`
- `crm.json`
- `documents.json`
- `field_service.json`
- `jobs.json`
- `maintenance.json`
- `octo_ai.json`
- `outreach.json`
- `sales.json`
- `shop_finance.json`
- `tasks.json`
- `variations.json`

Scripts:
- `python3 manifests/marketplace/install_all.py`
- `python3 manifests/marketplace/seed_dummy_examples.py`

Environment:
- `OCTO_BASE_URL`
- `OCTO_API_TOKEN`
- `OCTO_WORKSPACE_ID`

Use `--dry-run` on either script to preview the install order or seed plan.



export OCTO_BASE_URL="https://octodrop-platform-api.fly.dev"
export OCTO_API_TOKEN="eyJhbGciOiJFUzI1NiIsImtpZCI6ImY1YWFiZTIwLWQzNTktNDZjNy05OTZiLTZiZWU2NGIyZGE1YSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3RqZ2JycG56d2dsb2N6c3pqbmJ0LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJlZjJkNDFmOS0xZmVkLTRkNmEtYjcwMC1mMGZkYzViMzQwMjkiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzc1NDIzOTI5LCJpYXQiOjE3NzU0MjAzMjksImVtYWlsIjoibmlja0BvY3RvZHJvcC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJmaXJzdF9uYW1lIjoiTmljayIsImZ1bGxfbmFtZSI6Ik5pY2sgU2Fuc29tIiwibGFzdF9uYW1lIjoiU2Fuc29tIiwibmFtZSI6Ik5pY2sgU2Fuc29tIiwicGhvbmUiOiIrNjQyMjM0MzE0NTIifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc3NTA5MDY1OX1dLCJzZXNzaW9uX2lkIjoiODcwZTM1YzEtMGIwNS00NzY0LTk4NzAtMTJjNmExNzNkYThlIiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.jPhsoTjwiJiDyvj3N6vvOMwBifM56GHZW3JkSk45RrvVnsxg1_8Ar5RWSa1a7aKdgAeXdOCH35nUddgLQZflrg"
export OCTO_WORKSPACE_ID="1c346031-9227-4d58-b4c2-625d111bdb41"
python3 manifests/marketplace/install_all.py


$env:OCTO_BASE_URL="https://octodrop-platform-api.fly.dev"
$env:OCTO_API_TOKEN=""
$env:OCTO_WORKSPACE_ID="d9c304c8-508a-4713-aa6d-02b01907fd40"
python manifests/marketplace/install_all.py
